import { Provider } from './Provider';
import { Signer } from './Signer';
import { GasManager } from '../gas';
import { NetworkManager } from './NetworkManager';
import { KDCManager } from './KDCManager';
import { AuthManager } from './AuthManager';
import {
    ClientConfig,
    NodeInfo,
    HealthStatus,
    Block,
    ConsensusType,
} from '../types';
import { CONSTANTS, DEFAULT_CONSENSUS, validateRequired } from '../utils';

import { ValidatorManager } from '../consensus/ValidatorManager';
import { DVMManager } from './DVMManager';
import { SmartAccountManager } from './SmartAccountManager';
import { FaucetManager } from '../faucet/FaucetManager';
import { MempoolManager } from '../mempool/MempoolManager';
import { ChainExplorer } from '../explorer/ChainExplorer';
import { TransactionsManager } from '../transactions/TransactionsManager';
import { DPOS } from '../consensus/DPOS';
import { PBFT } from '../consensus/PBFT';

export class KodeChainClient {
    private provider: Provider;
    private signer: Signer;
    public gas: GasManager;
    public network: NetworkManager;
    public kdc: KDCManager;
    public auth: AuthManager;
    public validators: ValidatorManager;
    public dvm: DVMManager;
    public smartAccounts: SmartAccountManager;
    public faucet: FaucetManager;
    public mempool: MempoolManager;
    public explorer: ChainExplorer;
    public transactions: TransactionsManager;
    public dpos: DPOS;
    public pbft: PBFT;
    private config: ClientConfig;
    private connected: boolean = false;

    constructor(config: ClientConfig) {
        validateRequired(config.nodeUrl, 'nodeUrl');

        this.config = {
            defaultConsensus: DEFAULT_CONSENSUS,
            timeout: CONSTANTS.DEFAULT_TIMEOUT,
            retries: CONSTANTS.DEFAULT_RETRIES,
            ...config,
        };

        // FASE 4 — Failover multi-RPC: lista de endpoints del clúster.
        // nodeUrls gana si se provee; nodeUrl también acepta comas.
        const nodeUrls = this.resolveNodeUrls(this.config);

        this.provider = new Provider({
            baseURL: nodeUrls[0],
            baseURLs: nodeUrls,
            timeout: this.config.timeout,
            retries: this.config.retries,
            headers: this.config.headers,
        });

        this.signer = new Signer();
        this.gas = new GasManager(this);
        this.network = new NetworkManager(this);
        this.kdc = new KDCManager(this);
        this.auth = new AuthManager(this);
        this.validators = new ValidatorManager(this);
        this.dvm = new DVMManager(this);
        this.smartAccounts = new SmartAccountManager(this);
        this.faucet = new FaucetManager(this);
        this.mempool = new MempoolManager(this);
        this.explorer = new ChainExplorer(this);
        this.transactions = new TransactionsManager(this);
        this.dpos = new DPOS(this);
        this.pbft = new PBFT(this);
    }

    /**
     * FASE 4 — Failover multi-RPC: normaliza la lista de endpoints del
     * clúster a partir de config.nodeUrls (prioridad) o config.nodeUrl
     * (acepta URLs separadas por coma, p. ej. la env KDC_RPC_URLS).
     */
    private resolveNodeUrls(config: ClientConfig): string[] {
        const raw = config.nodeUrls && config.nodeUrls.length > 0
            ? config.nodeUrls
            : [config.nodeUrl];

        const seen = new Set<string>();
        const urls: string[] = [];
        for (const entry of raw) {
            for (const piece of String(entry).split(',')) {
                const url = piece.trim().replace(/\/+$/, '');
                if (url && !seen.has(url)) {
                    seen.add(url);
                    urls.push(url);
                }
            }
        }
        if (urls.length === 0) {
            throw new Error('Se requiere al menos un endpoint (nodeUrl o nodeUrls)');
        }
        return urls;
    }

    /**
     * FASE 4 — Failover multi-RPC: sondea /api/node/health de TODOS los
     * endpoints en paralelo y apunta el cliente al nodo con MENOR latencia.
     * Llamar al inicializar la app; la rotación ante caídas funciona aun
     * sin llamar esto (arranca en la primera URL de la lista).
     */
    async selectFastestNode(): Promise<string> {
        return this.provider.selectFastestNode();
    }

    /** FASE 4: lista de endpoints configurados para failover. */
    getRpcUrls(): string[] {
        return this.provider.getRpcUrls();
    }

    /**
     * FASE 4: sondea /api/node/health de TODOS los endpoints en paralelo y
     * actualiza el estado vivo/latencia sin mover el puntero. Para
     * dashboards de red y verificación de clúster.
     */
    async probeAllNodes(): Promise<void> {
        await this.provider.probeAllNodes();
    }

    /** FASE 4: endpoint actualmente en uso por el puntero del failover. */
    getCurrentNodeUrl(): string {
        return this.provider.getBaseURL();
    }

    /** FASE 4: snapshot de salud/latencia por nodo (para dashboards de red). */
    getNodeHealth(): Array<{ url: string; alive: boolean; latencyMs: number | null }> {
        return this.provider.getNodeHealth();
    }

    /**
     * Connect to the node
     */
    async connect(): Promise<void> {
        try {
            await this.getHealth();
            this.connected = true;
        } catch (error) {
            this.connected = false;
            throw error;
        }
    }

    /**
     * Disconnect from the node
     */
    disconnect(): void {
        this.connected = false;
    }

    /**
     * Check if connected
     */
    isConnected(): boolean {
        return this.connected;
    }

    /**
     * Get node information
     */
    async getNodeInfo(): Promise<NodeInfo> {
        const response = await this.provider.get<{ status: NodeInfo }>('/api/node/status');
        return response.status;
    }

    /**
     * Get node health status
     */
    async getHealth(): Promise<HealthStatus> {
        const response = await this.provider.get<{ health: HealthStatus }>('/api/node/health');
        return response.health;
    }

    /**
     * Get block height for a specific chain
     */
    async getBlockHeight(chain?: ConsensusType): Promise<number> {
        const consensus = chain || this.config.defaultConsensus!;

        // Try /api/sync/height first as it's the standard for the sync layer
        try {
            const response = await this.provider.get<{ height: number }>(`/api/sync/height?chain=${consensus.toLowerCase()}`);
            return response.height;
        } catch {
            // Fallback to blockchain status
            const status = await this.getBlockchainStatus();
            const chainInfo = consensus === 'DPOS' ? status.status.dpos_chain : status.status.pbft_chain;
            return chainInfo.block_height;
        }
    }

    /**
     * Get blockchain status
     */
    async getBlockchainStatus(): Promise<any> {
        return this.provider.get('/api/blockchain/status');
    }

    /**
     * Get block by height
     */
    async getBlock(height: number, chain?: ConsensusType): Promise<Block> {
        const consensus = chain || this.config.defaultConsensus!;
        return this.provider.get<Block>(
            `/api/blockchain/block?number=${height}&chain=${consensus.toLowerCase()}`
        );
    }

    /**
     * Get latest block
     */
    async getLatestBlock(chain?: ConsensusType): Promise<Block> {
        const consensus = chain || this.config.defaultConsensus!;
        const response = await this.provider.get<{ blocks: Block[] }>(
            `/api/blockchain/all-blocks?limit=1&chain=${consensus.toLowerCase()}`
        );
        return response.blocks[0];
    }

    /**
     * Get balance for an address
     */
    async getBalance(address: string, _chain?: ConsensusType): Promise<string> {
        const response = await this.provider.get<{ account: any }>(
            `/api/smart-accounts/${address}`
        );

        const account = response.account;
        if (!account || !account.balances) {
            return '0';
        }

        // KDC is the native token
        const b = account.balances['KDC'] || account.balances['kdc'];
        if (b && b.amount) {
            return b.amount.toString();
        }

        return '0';
    }

    /**
     * Get the provider instance
     */
    getProvider(): Provider {
        return this.provider;
    }

    /**
     * Get the signer instance
     */
    getSigner(): Signer {
        return this.signer;
    }

    /**
     * Get the gas manager instance
     */
    getGasManager(): GasManager {
        return this.gas;
    }

    /**
     * Get the client configuration
     */
    getConfig(): ClientConfig {
        return { ...this.config };
    }
}
