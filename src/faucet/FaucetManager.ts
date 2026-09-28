/**
 * Faucet manager — testnet KDC faucet (1000 KDC per request, 1h cooldown).
 * Engine endpoint: POST /api/testnet/faucet { recipientAddress }
 */

import { KodeChainClient } from '../core';
import { validateAddress } from '../utils';

export interface FaucetResponse {
    success: boolean;
    message?: string;
    transactionHash?: string;
    amount?: string;
    error?: string;
}

export class FaucetManager {
    private client: KodeChainClient;

    constructor(client: KodeChainClient) {
        this.client = client;
    }

    /**
     * Request testnet funds for an address.
     * The transaction is mined by DPOS consensus; funds arrive in ~15s.
     */
    async requestFunds(address: string): Promise<FaucetResponse> {
        validateAddress(address);
        return this.client.getProvider().post<FaucetResponse>('/api/testnet/faucet', {
            recipientAddress: address,
        });
    }
}
