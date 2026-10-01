/**
 * PBFT chain-scoped operations (real engine endpoints).
 */

import { KodeChainClient } from '../core';
import { ChainExplorer } from '../explorer/ChainExplorer';

export class PBFT {
    private client: KodeChainClient;
    private explorer: ChainExplorer;

    constructor(client: KodeChainClient) {
        this.client = client;
        this.explorer = new ChainExplorer(client);
    }

    /**
     * Get PBFT chain height
     */
    async getHeight(): Promise<number> {
        return this.client.getBlockHeight('PBFT');
    }

    /**
     * Get latest PBFT blocks (paginated).
     */
    async getRecentBlocks(limit = 20, offset = 0): Promise<{ blocks: any[]; total: number }> {
        return this.explorer.listBlocks('PBFT', { limit, offset });
    }

    /**
     * PBFT statistics computed from live chain data
     * (the old /api/blockchain/pbft/stats endpoint does not exist).
     */
    async getStats(): Promise<{
        height: number;
        recentBlocks: number;
        transactionsInWindow: number;
        emptyBlocks: number;
    }> {
        const height = await this.getHeight();
        const { blocks } = await this.explorer.listBlocks('PBFT', { limit: 100 });
        let txs = 0;
        for (const b of blocks) txs += (b.transactions || []).length;
        return {
            height,
            recentBlocks: blocks.length,
            transactionsInWindow: txs,
            emptyBlocks: blocks.length - blocks.filter((b) => (b.transactions || []).length > 0).length,
        };
    }

    /**
     * PBFT consensus status: height + recent finality signal.
     * PBFT only mines on demand — height advances per confirmed record.
     */
    async getConsensusStatus(): Promise<{ height: number; mining: string }> {
        const height = await this.getHeight();
        return { height, mining: 'on-demand (per confirmed record)' };
    }
}
