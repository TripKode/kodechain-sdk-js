/**
 * Validator Manager
 */

import { KodeChainClient } from '../core';
import type { Validator, RegisterValidatorOptions, TransactionReceipt } from '../types';
import { validateAddress, validateRequired } from '../utils';

export class ValidatorManager {
    private client: KodeChainClient;

    constructor(client: KodeChainClient) {
        this.client = client;
    }

    /**
     * List all validators
     */
    async list(): Promise<Validator[]> {
        const response = await this.client
            .getProvider()
            .get<{ validators: Validator[] }>('/api/validator/list');

        return response.validators;
    }

    /**
     * Validators with on-chain stake: merges the registry (stake_amount,
     * is_active, consensus) with the smart-account buckets (KDC balance +
     * KDC_STAKED lock — the physical on-chain lock). This is the table the
     * explorer renders: what the contract says vs what the chain holds.
     */
    async getWithStake(): Promise<Array<Validator & {
        onchainKDC: string;
        onchainStaked: string;
        stakeMatch: boolean;
    }>> {
        const validators = await this.list();
        return Promise.all(
            validators.map(async (v: any) => {
                let onchainKDC = '0';
                let onchainStaked = '0';
                try {
                    const acc = await this.client.smartAccounts.getAccount(v.address);
                    const balances = acc?.account?.balances || acc?.balances || {};
                    onchainKDC = String(balances.KDC?.amount ?? '0');
                    onchainStaked = String(balances.KDC_STAKED?.amount ?? '0');
                } catch {
                    /* account not synced on this node — keep zeros */
                }
                const registered = String(v.stake_amount ?? v.total_stake ?? '0');
                return {
                    ...v,
                    onchainKDC,
                    onchainStaked,
                    stakeMatch: onchainStaked === registered,
                };
            })
        );
    }

    /**
     * Get a specific validator
     */
    async get(address: string): Promise<Validator> {
        validateAddress(address);
        const response = await this.client.getProvider().get<{ validator: Validator }>(`/api/validator/${address}`);
        return response.validator;
    }

    /**
     * Register a new validator
     */
    async register(options: RegisterValidatorOptions): Promise<TransactionReceipt> {
        validateRequired(options.address, 'address');
        validateRequired(options.name, 'name');
        validateRequired(options.stakeAmount, 'stakeAmount');
        validateAddress(options.address);

        return this.client.getProvider().post<TransactionReceipt>('/api/validator/register', {
            validator_address: options.address,
            validator_name: options.name,
            consensus_type: options.consensusType,
            stake_amount: options.stakeAmount,
            description: options.description || '',
            http_url: options.httpUrl || '',
            node_id: options.nodeId || '',
        });
    }

    /**
     * Activate a validator
     */
    async activate(address: string): Promise<TransactionReceipt> {
        validateAddress(address);
        return this.client
            .getProvider()
            .post<TransactionReceipt>(`/api/validator/activate`, {
                validator_address: address
            });
    }

    /**
     * Deactivate a validator
     */
    async deactivate(address: string): Promise<TransactionReceipt> {
        validateAddress(address);
        return this.client
            .getProvider()
            .post<TransactionReceipt>(`/api/validator/deactivate`, {
                validator_address: address
            });
    }

    /**
     * Load validator pool from genesis
     */
    async loadPool(): Promise<any> {
        return this.client.getProvider().post('/api/validator/load-pool');
    }

    /**
     * Get validator pool info
     */
    async getPool(): Promise<any> {
        return this.client.getProvider().get('/api/validator/pool');
    }

    /**
     * Get bootstrap node info
     */
    async getBootstrap(): Promise<any> {
        return this.client.getProvider().get('/api/validator/bootstrap');
    }

    /**
     * Activate bootstrap node
     */
    async activateBootstrap(): Promise<any> {
        return this.client.getProvider().post('/api/validator/bootstrap/activate');
    }

    /**
     * Get active validators
     */
    async getActive(): Promise<Validator[]> {
        const response = await this.client.getProvider().get<{ validators: Validator[] }>('/api/staking/validators/active');
        return response.validators;
    }

    /**
     * Get validators by consensus type
     */
    async getByConsensus(consensusType: 'DPOS' | 'PBFT'): Promise<Validator[]> {
        const response = await this.client.getProvider().get<{ validators: Validator[] }>(`/api/staking/validators/active?consensus_type=${consensusType}`);
        return response.validators;
    }

    /**
     * Get passive delegation statistics
     */
    async getPassiveDelegationStats(): Promise<any> {
        return this.client.getProvider().get('/api/passive-delegation/stats');
    }

    /**
     * Create a passive delegation
     */
    async createPassiveDelegation(delegatorAddress: string, validatorAddress: string, amount: string): Promise<any> {
        return this.client.getProvider().post('/api/passive-delegation/create', {
            delegator_address: delegatorAddress,
            validator_address: validatorAddress,
            stake_amount: amount
        });
    }

    /**
     * Get distribution of rewards
     */
    async getRewards(): Promise<any> {
        return this.client.getProvider().get('/api/staking/rewards');
    }

    /**
     * Trigger reward distribution (privileged)
     */
    async distributeRewards(): Promise<any> {
        return this.client.getProvider().post('/api/rewards/distribute');
    }

    /**
     * Get top validators by stake
     */
    async getTopByStake(limit: number = 10): Promise<Validator[]> {
        const validators = await this.list();
        return validators
            .sort((a, b) => parseFloat(b.stakedAmount) - parseFloat(a.stakedAmount))
            .slice(0, limit);
    }
}
