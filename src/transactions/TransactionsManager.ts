/**
 * Transactions manager — submit transactions to the mempool of their chain.
 * The consensus router assigns the chain by policy (TRANSFER→DPOS,
 * critical records→PBFT), so the caller only declares intent.
 *
 * Engine endpoint: POST /api/transaction/create
 */

import { KodeChainClient } from '../core';
import { validateAddress } from '../utils';

export interface CreateTransferRequest {
    from: string;
    to: string;
    /** Exact amount in proton as decimal string (1 KDC = 1e18). */
    amountProton: string;
    gasPrice?: number;
    gasLimit?: number;
}

export interface CreateCriticalRecordRequest {
    from: string;
    record: string;
    detail?: string;
}

export interface SubmitResponse {
    success: boolean;
    transaction?: {
        hash: string;
        from: string;
        to: string;
        amount_proton?: string;
        type: string;
    };
    error?: string;
}

export class TransactionsManager {
    private client: KodeChainClient;

    constructor(client: KodeChainClient) {
        this.client = client;
    }

    /**
     * Submit a KDC transfer (mined by DPOS consensus).
     */
    async createTransfer(req: CreateTransferRequest): Promise<SubmitResponse> {
        validateAddress(req.from);
        validateAddress(req.to);
        return this.client.getProvider().post<SubmitResponse>('/api/transaction/create', {
            type: 'transfer',
            from: req.from,
            to: req.to,
            amount_proton: req.amountProton,
            gasPrice: req.gasPrice ?? 1_000_000_000,
            ...(req.gasLimit !== undefined ? { gasLimit: req.gasLimit } : {}),
        });
    }

    /**
     * Submit a critical record (mined by PBFT consensus, instant finality).
     */
    async createCriticalRecord(req: CreateCriticalRecordRequest): Promise<SubmitResponse> {
        validateAddress(req.from);
        return this.client.getProvider().post<SubmitResponse>('/api/transaction/create', {
            type: 'critical',
            from: req.from,
            to: req.from,
            amount_proton: '1',
            data: { record: req.record, detail: req.detail ?? '' },
            gasPrice: 1_000_000_000,
        });
    }
}
