import type { IOrdInscription } from '../types/index.js';

/**
 * HTTP client for the local ord node REST API.
 * Used by the renderer plugin to serve inscription content and metadata.
 */
export class OrdClient {
    private readonly baseUrl: string;

    public constructor(baseUrl: string) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }

    /**
     * Fetches inscription metadata from the local ord node.
     *
     * @param inscriptionId - Inscription ID (e.g. "abc123...i0")
     * @returns Inscription metadata or null on 404
     */
    public async getInscription(inscriptionId: string): Promise<IOrdInscription | null> {
        const url = `${this.baseUrl}/inscription/${inscriptionId}`;

        const response = await fetch(url, {
            headers: { Accept: 'application/json' },
        });

        if (response.status === 404) {
            return null;
        }

        if (!response.ok) {
            throw new Error(
                `Ord /inscription/${inscriptionId} returned ${response.status.toString()}`,
            );
        }

        return (await response.json()) as IOrdInscription;
    }

    /**
     * Fetches the raw content of an inscription.
     *
     * @param inscriptionId - Inscription ID
     * @returns Content buffer and Content-Type header, or null on 404
     */
    public async getInscriptionContent(
        inscriptionId: string,
    ): Promise<{ readonly data: ArrayBuffer; readonly contentType: string } | null> {
        const url = `${this.baseUrl}/inscription/${inscriptionId}/content`;

        const response = await fetch(url);

        if (response.status === 404) {
            return null;
        }

        if (!response.ok) {
            throw new Error(
                `Ord /inscription/${inscriptionId}/content returned ${response.status.toString()}`,
            );
        }

        const contentType = response.headers.get('Content-Type') ?? 'application/octet-stream';
        const data = await response.arrayBuffer();

        return { data, contentType };
    }
}
