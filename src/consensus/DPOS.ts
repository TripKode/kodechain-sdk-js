/**
 * DPOS chain-scoped operations (real engine endpoints).
 */

import { KodeChainClient } from '../core';
import { ChainExplorer } from '../explorer/ChainExplorer';

export class DPOS {
    private client: KodeChainClient;
    private explorer: ChainExplorer;

    constructor(client: KodeChainClient) {
        this.client = client;
        this.explorer = new ChainExplorer(client);
    }

    /**
     * Get DPOS chain height
     */
    async getHeight(): Promise<number> {
        return this.client.getBlockHeight('DPOS');
    }

    /**
     * Get latest DPOS blocks (paginated, newest last in response order).
     */
    async getRecentBlocks(limit = 20, offset = 0): Promise<{ blocks: any[]; total: number }> {
        return this.explorer.listBlocks('DPOS', { limit, offset });
    }

    /**
     * DPOS statistics computed from live chain data
     * (the old /api/blockchain/dpos/stats endpoint does not exist).
     */
    async getStats(): Promise<{
        height: number;
        recentBlocks: number;
        transactionsInWindow: number;
        emptyBlocks: number;
    }> {
        const height = await this.getHeight();
        const { blocks } = await this.explorer.listBlocks('DPOS', { limit: 100 });
        let txs = 0;
        for (const b of blocks) txs += (b.transactions || []).length;
        return {
            height,
            recentBlocks: blocks.length,
            transactionsInWindow: txs,
            emptyBlocks: blocks.length - blocks.filter((b) => (b.transactions || []).length > 0).length,
        };
    }
}
