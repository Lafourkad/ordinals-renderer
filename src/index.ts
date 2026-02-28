import { PluginBase } from '@btc-vision/plugin-sdk';
import type { IPluginContext, IPluginRouter, IPluginHttpRequest } from '@btc-vision/plugin-sdk';
import { getContract, JSONRpcProvider } from 'opnet';
import { OP_721_ABI } from 'opnet';
import type { IOP721Contract, TokenURI } from 'opnet';
import { networks } from '@btc-vision/bitcoin';
import { OrdClient } from './services/OrdClient.js';
import type { IRendererConfig, IOP721Metadata } from './types/index.js';

// ─── Contract Interface ────────────────────────────────────────────────────────

/** OrdinalsVault uses the standard OP721 ABI — tokenURI(tokenId) is already included */
interface IOrdinalsVaultRenderer extends IOP721Contract {
    tokenURI(tokenId: bigint): Promise<TokenURI>;
}

// ─── Response Types ────────────────────────────────────────────────────────────

interface IContentResponse {
    readonly contentType: string;
    readonly data: string; // base64-encoded inscription content
    readonly inscriptionId: string;
    readonly tokenId: string;
}

interface IErrorResponse {
    readonly error: string;
}

type HandlerResult<T> = T | IErrorResponse;

// ─── Plugin ───────────────────────────────────────────────────────────────────

/**
 * OrdinalsVault Renderer Plugin
 *
 * Exposes HTTP endpoints on the OPNet node to resolve and serve
 * Ordinals inscription content. Reads `tokenURI(tokenId)` from the
 * OrdinalsVault OP721 contract, then proxies content from the local ord node.
 *
 * Routes (namespaced under `permissions.api.basePath`):
 *   GET /metadata/:tokenId  → OP721-compatible JSON metadata
 *   GET /content/:tokenId   → Raw content as base64 + contentType
 *
 * The `data` field in `/content` is base64-encoded. Callers must decode it
 * with `Buffer.from(data, 'base64')` or `atob(data)` before rendering.
 *
 * Plugin config (plugin.config.json):
 * ```json
 * {
 *   "vaultContractAddress": "op1q...",
 *   "ordNodeUrl":           "http://localhost:80",
 *   "opnetRpcUrl":          "https://mainnet.opnet.org/json-rpc",
 *   "network":              "mainnet",
 *   "collectionName":       "My Ordinals Collection",
 *   "collectionDescription": "Bridged Ordinals on OPNet"
 * }
 * ```
 */
export default class OrdinalsRendererPlugin extends PluginBase {
    private ordClient!: OrdClient;
    private provider!: JSONRpcProvider;
    private config!: IRendererConfig;

    public override async onLoad(context: IPluginContext): Promise<void> {
        await super.onLoad(context);

        const config = this.context.config.get<IRendererConfig>('renderer');
        if (config === undefined) {
            throw new Error('OrdinalsRenderer: missing "renderer" config section');
        }

        this.config = config;

        const network = config.network === 'mainnet' ? networks.bitcoin : networks.regtest;

        this.provider = new JSONRpcProvider(config.opnetRpcUrl, network);
        this.ordClient = new OrdClient(config.ordNodeUrl);

        this.context.logger.info('OrdinalsRenderer loaded — serving inscription content');
    }

    /**
     * Registers HTTP routes. Called once during plugin startup.
     *
     * Note: handler strings must be method names on this class.
     *
     * @param router - Plugin router (routes namespaced under plugin base path)
     */
    public override registerRoutes(router: IPluginRouter): void {
        router.get('/metadata/:tokenId', 'handleMetadata');
        router.get('/content/:tokenId', 'handleContent');
    }

    public override async onUnload(): Promise<void> {
        this.context.logger.info('OrdinalsRenderer unloading');
        await this.provider.close();
        await super.onUnload();
    }

    // ─── Route Handlers ─────────────────────────────────────────────────────────

    /**
     * Serves OP721-compatible JSON metadata.
     *
     * Response shape:
     * ```json
     * {
     *   "name":         "Collection #1",
     *   "description":  "...",
     *   "image":        "content/1",
     *   "external_url": "https://ordinals.com/inscription/abc...i0",
     *   "attributes":   [...]
     * }
     * ```
     *
     * @param request - HTTP request (params.tokenId)
     * @returns OP721 metadata object or error object
     */
    public async handleMetadata(
        request: IPluginHttpRequest,
    ): Promise<HandlerResult<IOP721Metadata>> {
        const tokenId = this.parseTokenId(request.params['tokenId']);
        if (tokenId === null) {
            return { error: 'Invalid tokenId — must be a non-negative integer' };
        }

        const inscriptionId = await this.resolveInscriptionId(tokenId);
        if (inscriptionId === null) {
            return { error: 'Token not found or inscription not set' };
        }

        const inscription = await this.ordClient.getInscription(inscriptionId);

        const metadata: IOP721Metadata = {
            name: `${this.config.collectionName} #${tokenId.toString()}`,
            description: this.config.collectionDescription,
            image: `content/${tokenId.toString()}`,
            external_url: `https://ordinals.com/inscription/${inscriptionId}`,
            attributes: [
                { trait_type: 'Inscription ID', value: inscriptionId },
                ...(inscription !== null
                    ? [
                          { trait_type: 'Inscription Number', value: inscription.number },
                          { trait_type: 'Content Type', value: inscription.content_type },
                          { trait_type: 'Genesis Block', value: inscription.genesis_height },
                      ]
                    : []),
            ],
        };

        return metadata;
    }

    /**
     * Serves the raw inscription content as base64-encoded data.
     *
     * Response shape:
     * ```json
     * {
     *   "contentType":   "image/webp",
     *   "data":          "<base64>",
     *   "inscriptionId": "abc...i0",
     *   "tokenId":       "42"
     * }
     * ```
     *
     * @param request - HTTP request (params.tokenId)
     * @returns Content response or error object
     */
    public async handleContent(
        request: IPluginHttpRequest,
    ): Promise<HandlerResult<IContentResponse>> {
        const tokenId = this.parseTokenId(request.params['tokenId']);
        if (tokenId === null) {
            return { error: 'Invalid tokenId' };
        }

        const inscriptionId = await this.resolveInscriptionId(tokenId);
        if (inscriptionId === null) {
            return { error: 'Token not found or inscription not set' };
        }

        const content = await this.ordClient.getInscriptionContent(inscriptionId);
        if (content === null) {
            return { error: 'Inscription content not found in ord' };
        }

        return {
            contentType: content.contentType,
            data: Buffer.from(content.data).toString('base64'),
            inscriptionId,
            tokenId: tokenId.toString(),
        };
    }

    // ─── Private Helpers ────────────────────────────────────────────────────────

    /**
     * Resolves a tokenId → inscriptionId by calling `tokenURI()` on the contract.
     *
     * @param tokenId - OP721 token ID
     * @returns Inscription ID string, or null if not found / not set
     */
    private async resolveInscriptionId(tokenId: bigint): Promise<string | null> {
        try {
            const contract = getContract<IOrdinalsVaultRenderer>(
                this.config.vaultContractAddress,
                OP_721_ABI,
                this.provider,
                this.provider.network,
            );

            const result = await contract.tokenURI(tokenId);

            if ('error' in result) {
                return null;
            }

            const uri = result.properties['uri'] as string | undefined;
            return uri !== undefined && uri.length > 0 ? uri : null;
        } catch {
            return null;
        }
    }

    /**
     * Parses a tokenId URL param string → bigint. Returns null on invalid input.
     *
     * @param raw - Raw string from URL params
     * @returns Non-negative bigint, or null
     */
    private parseTokenId(raw: string | undefined): bigint | null {
        if (raw === undefined || raw.length === 0) {
            return null;
        }
        try {
            const n = BigInt(raw);
            return n >= 0n ? n : null;
        } catch {
            return null;
        }
    }
}
