import { PluginBase } from '@btc-vision/plugin-sdk';
import type { IPluginContext, IPluginRouter, IPluginHttpRequest } from '@btc-vision/plugin-sdk';
import { getContract, JSONRpcProvider, OP_721_ABI } from 'opnet';
import type { IOP721Contract, TokenURI } from 'opnet';
import { networks } from '@btc-vision/bitcoin';
import { OrdClient } from './services/OrdClient.js';
import type { IRendererConfig, IOP721Metadata } from './types/index.js';

// ─── Contract Interface ────────────────────────────────────────────────────────

interface IOP721WithTokenURI extends IOP721Contract {
    tokenURI(tokenId: bigint): Promise<TokenURI>;
}

// ─── Response Types ────────────────────────────────────────────────────────────

interface IContentResponse {
    readonly contractAddress: string;
    readonly tokenId: string;
    readonly inscriptionId: string;
    readonly contentType: string;
    readonly data: string; // base64-encoded inscription content
}

interface IErrorResponse {
    readonly error: string;
}

type HandlerResult<T> = T | IErrorResponse;

// ─── Plugin ───────────────────────────────────────────────────────────────────

/**
 * Ordinals Renderer Plugin
 *
 * Serves inscription content for ANY OP721 contract whose `tokenURI(tokenId)`
 * returns a valid Ordinals inscription ID (e.g. "abc123...i0").
 *
 * Routes (namespaced under plugin base path):
 *   GET /metadata/:contractAddress/:tokenId  → OP721 metadata JSON
 *   GET /content/:contractAddress/:tokenId   → inscription content as base64
 *
 * Example:
 *   GET /plugins/ordinals-renderer/content/op1q.../42
 *
 * Plugin config (plugin.config.json):
 * ```json
 * {
 *   "renderer": {
 *     "ordNodeUrl":  "http://localhost:80",
 *     "opnetRpcUrl": "https://mainnet.opnet.org/json-rpc",
 *     "network":     "mainnet"
 *   }
 * }
 * ```
 */
export default class OrdinalsRendererPlugin extends PluginBase {
    private ordClient!: OrdClient;
    private provider!: JSONRpcProvider;

    public override async onLoad(context: IPluginContext): Promise<void> {
        await super.onLoad(context);

        const config = this.context.config.get<IRendererConfig>('renderer');
        if (config === undefined) {
            throw new Error('OrdinalsRenderer: missing "renderer" config section');
        }

        const network = config.network === 'mainnet' ? networks.bitcoin : networks.regtest;

        this.provider = new JSONRpcProvider(config.opnetRpcUrl, network);
        this.ordClient = new OrdClient(config.ordNodeUrl);

        this.context.logger.info('OrdinalsRenderer loaded — serving inscription content for any OP721');
    }

    public override registerRoutes(router: IPluginRouter): void {
        router.get('/metadata/:contractAddress/:tokenId', 'handleMetadata');
        router.get('/content/:contractAddress/:tokenId', 'handleContent');
    }

    public override async onUnload(): Promise<void> {
        this.context.logger.info('OrdinalsRenderer unloading');
        await this.provider.close();
        await super.onUnload();
    }

    // ─── Route Handlers ─────────────────────────────────────────────────────────

    /**
     * Returns OP721 metadata for a given contract + tokenId.
     *
     * Works with any OP721 contract whose tokenURI() returns an inscription ID.
     *
     * Response:
     * ```json
     * {
     *   "name":         "Contract #42",
     *   "description":  "",
     *   "image":        "content/op1q.../42",
     *   "external_url": "https://ordinals.com/inscription/abc...i0",
     *   "attributes":   [...]
     * }
     * ```
     */
    public async handleMetadata(
        request: IPluginHttpRequest,
    ): Promise<HandlerResult<IOP721Metadata>> {
        const contractAddress = request.params['contractAddress'];
        const tokenId = this.parseTokenId(request.params['tokenId']);

        if (contractAddress === undefined || contractAddress.length === 0) {
            return { error: 'Missing contractAddress' };
        }
        if (tokenId === null) {
            return { error: 'Invalid tokenId — must be a non-negative integer' };
        }

        const inscriptionId = await this.resolveInscriptionId(contractAddress, tokenId);
        if (inscriptionId === null) {
            return { error: 'Token not found, not minted, or tokenURI is not an inscription ID' };
        }

        const inscription = await this.ordClient.getInscription(inscriptionId);

        const metadata: IOP721Metadata = {
            name: `${contractAddress.slice(0, 10)}... #${tokenId.toString()}`,
            description: '',
            image: `content/${contractAddress}/${tokenId.toString()}`,
            external_url: `https://ordinals.com/inscription/${inscriptionId}`,
            attributes: [
                { trait_type: 'Inscription ID', value: inscriptionId },
                { trait_type: 'Contract', value: contractAddress },
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
     * Returns raw inscription content as base64-encoded data.
     *
     * Works with any OP721 contract whose tokenURI() returns an inscription ID.
     *
     * Response:
     * ```json
     * {
     *   "contractAddress": "op1q...",
     *   "tokenId":         "42",
     *   "inscriptionId":   "abc...i0",
     *   "contentType":     "image/webp",
     *   "data":            "<base64>"
     * }
     * ```
     */
    public async handleContent(
        request: IPluginHttpRequest,
    ): Promise<HandlerResult<IContentResponse>> {
        const contractAddress = request.params['contractAddress'];
        const tokenId = this.parseTokenId(request.params['tokenId']);

        if (contractAddress === undefined || contractAddress.length === 0) {
            return { error: 'Missing contractAddress' };
        }
        if (tokenId === null) {
            return { error: 'Invalid tokenId' };
        }

        const inscriptionId = await this.resolveInscriptionId(contractAddress, tokenId);
        if (inscriptionId === null) {
            return { error: 'Token not found, not minted, or tokenURI is not an inscription ID' };
        }

        const content = await this.ordClient.getInscriptionContent(inscriptionId);
        if (content === null) {
            return { error: 'Inscription content not found in local ord node' };
        }

        return {
            contractAddress,
            tokenId: tokenId.toString(),
            inscriptionId,
            contentType: content.contentType,
            data: Buffer.from(content.data).toString('base64'),
        };
    }

    // ─── Private Helpers ────────────────────────────────────────────────────────

    /**
     * Calls tokenURI(tokenId) on any OP721 contract and returns the inscription ID.
     *
     * Returns null if the token doesn't exist, is not minted, or the URI is empty/invalid.
     *
     * @param contractAddress - OP721 contract address
     * @param tokenId - Token ID
     */
    private async resolveInscriptionId(
        contractAddress: string,
        tokenId: bigint,
    ): Promise<string | null> {
        try {
            const contract = getContract<IOP721WithTokenURI>(
                contractAddress,
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

    private parseTokenId(raw: string | undefined): bigint | null {
        if (raw === undefined || raw.length === 0) return null;
        try {
            const n = BigInt(raw);
            return n >= 0n ? n : null;
        } catch {
            return null;
        }
    }
}
