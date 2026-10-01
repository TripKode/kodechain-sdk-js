/**
 * Chain explorer — block listing, heights and address history across both
 * consensus chains (DPOS + PBFT).
 *
 * NOTE: the engine exposes recent blocks per chain but no per-account
 * transaction endpoint, so address history is built by scanning the
 * exposed blocks (same technique as block explorers over windowed APIs).
 *
 * Engine endpoints:
 *   GET /api/block/all            (header X-Consensus-Type: DPOS|PBFT)
 *   GET /api/sync/height          (header X-Consensus-Type: DPOS|PBFT)
 */

import { KodeChainClient } from '../core';
import { ConsensusType } from '../types';
import { validateAddress } from '../utils';

export interface ChainBlock {
    index: number;
    timestamp: string | number;
    type: string;
    hash: string;
    previousHash?: string;
    nonce?: number;
    signature?: string;
    validator?: string;
    validatorAddress?: string;
    validatorNodeId?: string;
    validatorPublicKey?: string;
    merkleRoot?: string;
    stateRoot?: string;
    difficulty?: number;
    data?: any;
    transactions?: ChainTransaction[];
}

export interface ChainTransaction {
    hash: string;
    type: string;
    from: string;
    to: string;
    value?: string;
    amount?: string;
    data?: any;
    timestamp?: number;
    gasLimit?: number;
    gasPrice?: string;
}

export interface AddressMovement {
    chain: ConsensusType;
    block: number;
    hash: string;
    from: string;
    to: string;
    type: string;
    amountProton: string;
    status: 'mined';
}

export class ChainExplorer {
    private client: KodeChainClient;

    constructor(client: KodeChainClient) {
        this.client = client;
    }

    /**
     * Recent blocks of a chain (engine window: last ~100 DPOS blocks,
     * full PBFT history while short).
     */
    async listBlocks(
        chain: ConsensusType,
        options?: { limit?: number; offset?: number }
    ): Promise<{ blocks: ChainBlock[]; total: number }> {
        const params: Record<string, string> = {};
        if (options?.limit !== undefined) params.limit = String(options.limit);
        if (options?.offset !== undefined) params.offset = String(options.offset);
        const response = await this.client
            .getProvider()
            .get<{ blocks: ChainBlock[]; total: number }>('/api/block/all', {
                headers: { 'X-Consensus-Type': chain },
                params,
            });
        return {
            blocks: response.blocks || [],
            total: response.total ?? (response.blocks || []).length,
        };
    }

    /**
     * Current heights of both chains.
     */
    async getHeights(): Promise<{ dpos: number; pbft: number }> {
        const [dpos, pbft] = await Promise.all([
            this.client.getBlockHeight('DPOS'),
            this.client.getBlockHeight('PBFT'),
        ]);
        return { dpos, pbft };
    }

    /**
     * Find a transaction by hash scanning recent blocks of both chains.
     * Returns null when not found (too old for the window, or unknown hash).
     */
    async findTransaction(
        hash: string,
        chains?: ConsensusType[]
    ): Promise<{ chain: ConsensusType; block: number; blockHash: string; tx: ChainTransaction } | null> {
        // NOTE: only scan chains the target node actually serves — a
        // single-chain node answers any header with its own chain, which
        // would otherwise mislabel blocks (seen live: DPOS blocks as PBFT).
        for (const chain of chains ?? (['DPOS', 'PBFT'] as ConsensusType[])) {
            const { blocks } = await this.listBlocks(chain);
            for (const b of blocks) {
                for (const tx of b.transactions || []) {
                    if (tx.hash === hash) {
                        return { chain, block: b.index, blockHash: b.hash, tx };
                    }
                }
            }
        }
        return null;
    }

    /**
     * Address history: every transaction where the address is sender or
     * recipient, across both chains, newest block first.
     */
    async scanAddressHistory(address: string, chains?: ConsensusType[]): Promise<AddressMovement[]> {
        validateAddress(address);
        const needle = address.toLowerCase();
        const out: AddressMovement[] = [];

        for (const chain of chains ?? (['DPOS', 'PBFT'] as ConsensusType[])) {
            const { blocks } = await this.listBlocks(chain);
            for (const b of blocks) {
                for (const tx of b.transactions || []) {
                    if ((tx.from || '').toLowerCase() === needle || (tx.to || '').toLowerCase() === needle) {
                        out.push({
                            chain,
                            block: b.index,
                            hash: tx.hash,
                            from: tx.from,
                            to: tx.to,
                            type: tx.type,
                            amountProton: String(tx.value ?? tx.amount ?? ''),
                            status: 'mined',
                        });
                    }
                }
            }
        }

        out.sort((a, b) => b.block - a.block);
        return out;
    }
}
