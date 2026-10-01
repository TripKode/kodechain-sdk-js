/**
 * Core blockchain types
 */

export type ConsensusType = 'DPOS' | 'PBFT';

export interface ClientConfig {
    nodeUrl: string;
    /**
     * FASE 4 — Failover multi-RPC: lista de endpoints del clúster. Ante un
     * error de conectividad en el nodo actual (VM apagada, SIM celular
     * caída), las peticiones rotan de forma transparente al siguiente nodo
     * vivo de la lista. `nodeUrl` también acepta URLs separadas por coma.
     * Si se provee, gana sobre `nodeUrl`; si no, se usa [nodeUrl].
     */
    nodeUrls?: string[];
    defaultConsensus?: ConsensusType;
    timeout?: number;
    retries?: number;
    headers?: Record<string, string>;
}

export interface NodeInfo {
    version: string;
    chainId: string;
    nodeType: 'bootstrap' | 'pbft' | 'dpos';
    uptime: number;
    peers: number;
    syncStatus: {
        dpos: { height: number; syncing: boolean };
        pbft: { height: number; syncing: boolean };
    };
}

export interface HealthStatus {
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: {
        api: boolean;
        dpos: boolean;
        pbft: boolean;
        database: boolean;
    };
    timestamp: string;
}

export interface Block {
    number: number;
    hash: string;
    parentHash: string;
    timestamp: number;
    transactions: string[];
    validator: string;
    consensus: ConsensusType;
}
