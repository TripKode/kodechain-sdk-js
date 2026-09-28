/**
 * Transaction history queries
 */

import { KodeChainClient } from '../core';
import { Transaction, ConsensusType } from '../types';
import { validateAddress } from '../utils';
import { ChainExplorer } from '../explorer/ChainExplorer';

export interface TransactionHistoryOptions {
    offset?: number;
    limit?: number;
    consensus?: ConsensusType;
    startBlock?: number;
    endBlock?: number;
}

export class TransactionHistory {
    private client: KodeChainClient;

    constructor(client: KodeChainClient) {
        this.client = client;
    }

    /**
     * Get transaction history for an address
     */
    async getHistory(
        address: string,
        options?: TransactionHistoryOptions
    ): Promise<Transaction[]> {
        validateAddress(address);
        const explorer = new ChainExplorer(this.client);
        const chains: ConsensusType[] = options?.consensus
            ? [options.consensus]
            : ['DPOS', 'PBFT'];
        const moves: Transaction[] = [];
        for (const chain of chains) {
            const { blocks } = await explorer.listBlocks(chain);
            for (const b of blocks) {
                if (options?.startBlock !== undefined && b.index < options.startBlock) continue;
                if (options?.endBlock !== undefined && b.index > options.endBlock) continue;
                for (const tx of b.transactions || []) {
                    if (
                        tx.from?.toLowerCase() === address.toLowerCase() ||
                        tx.to?.toLowerCase() === address.toLowerCase()
                    ) {
                        moves.push({ ...tx, block: b.index, consensus: chain } as unknown as Transaction);
                    }
                }
            }
        }
        moves.sort((a: any, b: any) => (b.block ?? 0) - (a.block ?? 0));
        const offset = options?.offset || 0;
        const limit = options?.limit || 50;
        return moves.slice(offset, offset + limit);
    }

    /**
     * Get sent transactions
     */
    async getSentTransactions(
        address: string,
        options?: TransactionHistoryOptions
    ): Promise<Transaction[]> {
        validateAddress(address);

        const all = await this.getHistory(address, options);
        return all.filter((tx: any) => tx.from?.toLowerCase() === address.toLowerCase());
    }

    /**
     * Get received transactions
     */
    async getReceivedTransactions(
        address: string,
        options?: TransactionHistoryOptions
    ): Promise<Transaction[]> {
        validateAddress(address);

        const all = await this.getHistory(address, options);
        return all.filter((tx: any) => tx.to?.toLowerCase() === address.toLowerCase());
    }

    /**
     * Get transaction by hash (searches recent blocks of both chains).
     */
    async getTransaction(hash: string): Promise<Transaction | null> {
        const explorer = new ChainExplorer(this.client);
        const found = await explorer.findTransaction(hash);
        return (found ? { ...found.tx, consensus: found.chain, block: found.block } : null) as unknown as Transaction | null;
    }
}
