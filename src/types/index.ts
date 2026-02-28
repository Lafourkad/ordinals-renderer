/** Renderer plugin config */
export interface IRendererConfig {
    readonly ordNodeUrl: string;
    readonly opnetRpcUrl: string;
    readonly network: 'mainnet' | 'regtest';
}

/** OP721 token metadata response */
export interface IOP721Metadata {
    readonly name: string;
    readonly description: string;
    readonly image: string;
    readonly external_url?: string;
    readonly attributes?: readonly IMetadataAttribute[];
}

export interface IMetadataAttribute {
    readonly trait_type: string;
    readonly value: string | number;
}

/** Ord inscription metadata response from GET /inscription/{id} */
export interface IOrdInscription {
    readonly id: string;
    readonly content_type: string;
    readonly content_length: number;
    readonly timestamp: number;
    readonly genesis_height: number;
    readonly genesis_transaction: string;
    readonly address: string;
    readonly number: number;
}
