/**
 * Mempool manager — pending transactions and stats for both chains.
 * Engine endpoints: GET /api/mempool/pending, GET /api/transaction/mempool/stats
 */

import { KodeChainClient } from '../core';
import { ConsensusType } from '../types';

export interface MempoolPending {
    dpos: { count: number; pending: any[] };
    pbft: { count: number; pending: any[] };
    success: boolean;
    total_count: number;
}

export interface MempoolStats {
    stats: {
        dpos: { size: number; max_size: number; consensus_type: string };
        pbft: { size: number; max_size: number; consensus_type: string };
        total_transactions: number;
    };
    success: boolean;
}

export class MempoolManager {
    private client: KodeChainClient;

    constructor(client: KodeChainClient) {
        this.client = client;
    }

    /**
     * Pending transactions of both mempools.
     */
    async getPending(): Promise<MempoolPending> {
        return this.client.getProvider().get<MempoolPending>('/api/mempool/pending');
    }

    /**
     * Mempool statistics (sizes, limits).
     */
    async getStats(): Promise<MempoolStats> {
        return this.client.getProvider().get<MempoolStats>('/api/transaction/mempool/stats');
    }

    /**
     * Find a transaction by hash in the pending pools.
     * Returns { chain, tx } or null when not pending (likely already mined).
     */
    async findPending(hash: string): Promise<{ chain: ConsensusType; tx: any } | null> {
        const pending = await this.getPending();
        for (const chain of ['dpos', 'pbft'] as const) {
            const list = (pending as any)[chain]?.pending || [];
            for (const tx of list) {
                if (tx.hash === hash) {
                    return { chain: chain.toUpperCase() as ConsensusType, tx };
                }
            }
        }
        return null;
    }
}
