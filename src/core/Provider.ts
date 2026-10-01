/**
 * HTTP Provider for KodeChain API communication
 *
 * FASE 4 — Red Auto-Organizada: Failover Multi-RPC.
 * El Provider acepta una LISTA de endpoints y rota de forma atómica al
 * siguiente nodo vivo ante errores de conectividad (VM apagada a $0, SIM
 * celular caída, reinicio de validador). La rotación es transparente para
 * la capa de aplicación: la misma petición se retransmite contra el
 * siguiente nodo sin propagar el error a la UI.
 *
 * - Conexión inicial: `selectFastestNode()` sondea /api/node/health en
 *   paralelo y apunta al nodo con MENOR latencia (round-trip).
 * - Rotación: ConnectionError/TimeoutError marcan el nodo caído y avanzan
 *   el puntero; los errores HTTP (4xx/5xx) NO rotan — el nodo responde,
 *   es un error de aplicación.
 * - Resurrección: si TODOS los nodos aparecen caídos, se re-sondea la
 *   lista una vez antes de rendirse.
 * - Back-compat: con una sola URL el comportamiento es el histórico
 *   (retry con backoff contra el mismo nodo).
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import { NetworkError, TimeoutError, ConnectionError } from '../errors';
import { CONSTANTS } from '../utils';

export interface ProviderConfig {
    baseURL: string;
    /**
     * Lista completa de endpoints del clúster (failover). Acepta también
     * URLs separadas por coma dentro de cada entrada. Si se omite se usa
     * [baseURL] (comportamiento histórico).
     */
    baseURLs?: string[];
    timeout?: number;
    retries?: number;
    headers?: Record<string, string>;
}

/** Endpoint real de salud del motor (ligero, sin trabajo). */
const HEALTH_PATH = '/api/node/health';
/** Timeout corto para las sondas de salud: un nodo lento NO debe usarse. */
const PROBE_TIMEOUT_MS = 2500;

interface NodeHealth {
    url: string;
    alive: boolean;
    latencyMs: number | null;
    lastProbeAt: number;
}

export class Provider {
    private client: AxiosInstance;
    private retries: number;
    private nodes: NodeHealth[];
    private currentIndex: number;
    /** Single-flight: peticiones concurrentes comparten la misma sonda. */
    private probing: Promise<void> | null;

    constructor(config: ProviderConfig) {
        this.retries = config.retries ?? CONSTANTS.DEFAULT_RETRIES;

        this.nodes = this.resolveUrls(config).map((url) => ({
            url,
            alive: true,
            latencyMs: null,
            lastProbeAt: 0,
        }));
        this.currentIndex = 0;
        this.probing = null;

        this.client = axios.create({
            baseURL: this.nodes[0].url,
            timeout: config.timeout ?? CONSTANTS.DEFAULT_TIMEOUT,
            headers: {
                'Content-Type': 'application/json',
                ...config.headers,
            },
        });

        this.setupInterceptors();
    }

    /**
     * Normaliza la lista de URLs: acepta baseURLs múltiple, comas dentro de
     * cada entrada, recorta espacios y barras finales, deduplica.
     */
    private resolveUrls(config: ProviderConfig): string[] {
        const raw = config.baseURLs && config.baseURLs.length > 0
            ? config.baseURLs
            : [config.baseURL];

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
            throw new Error('Provider requiere al menos una baseURL válida');
        }
        return urls;
    }

    private setupInterceptors(): void {
        // Request interceptor
        this.client.interceptors.request.use(
            (config) => {
                return config;
            },
            (error) => {
                return Promise.reject(this.handleError(error));
            }
        );

        // Response interceptor
        this.client.interceptors.response.use(
            (response) => {
                return response;
            },
            (error) => {
                return Promise.reject(this.handleError(error));
            }
        );
    }

    private handleError(error: AxiosError): Error {
        if (error.code === 'ECONNABORTED') {
            return new TimeoutError('Request timeout', { originalError: error.message });
        }

        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            return new ConnectionError('Connection failed', { originalError: error.message });
        }

        if (error.response) {
            return new NetworkError((error.response.data as any)?.message || error.message, {
                status: error.response.status,
                data: error.response.data,
            });
        }

        return new NetworkError(error.message, { originalError: error });
    }

    async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
        return this.request<T>({ ...config, method: 'GET', url });
    }

    async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
        return this.request<T>({ ...config, method: 'POST', url, data });
    }

    async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
        return this.request<T>({ ...config, method: 'PUT', url, data });
    }

    async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
        return this.request<T>({ ...config, method: 'DELETE', url });
    }

    private async request<T>(config: AxiosRequestConfig, attempt: number = 0): Promise<T> {
        try {
            const response = await this.client.request<T>(config);
            return response.data;
        } catch (error) {
            // FASE 4 — Failover multi-RPC: error de conectividad = nodo
            // caído (no un error de aplicación). Marcar, rotar al siguiente
            // nodo VIVO y retransmitir la misma petición de forma atómica.
            if (
                this.nodes.length > 1 &&
                this.isConnectivityError(error) &&
                attempt < this.maxRotationAttempts()
            ) {
                this.markCurrentNodeDead();
                if (this.rotateToNextAliveNode()) {
                    this.syncBaseURL();
                    return this.request<T>(config, attempt + 1);
                }
                // Todos marcados caídos → re-sonda de resurrección (una vez)
                // y reintenta sobre cualquier nodo que haya revivido.
                await this.probeAllNodes();
                if (this.rotateToNextAliveNode()) {
                    this.syncBaseURL();
                    return this.request<T>(config, attempt + 1);
                }
            }

            if (attempt < this.retries && this.shouldRetry(error)) {
                await this.delay(CONSTANTS.RETRY_DELAY * (attempt + 1));
                return this.request<T>(config, attempt + 1);
            }
            throw error;
        }
    }

    /**
     * Sólo los errores de CONECTIVIDAD rotan. Un 4xx/5xx es una respuesta
     * del servidor (el nodo está vivo) y se comporta como el flujo
     * histórico: retry contra el mismo nodo.
     *
     * En Node los fallos de transporte llegan como ConnectionError/
     * TimeoutError (ECONNREFUSED/ECONNABORTED). En Workers/navegador el
     * fetch muere sin status: un NetworkError SIN details.status es un
     * fallo de transporte (nodo caído) y TAMBIÉN rota.
     */
    private isConnectivityError(error: any): boolean {
        if (error instanceof ConnectionError || error instanceof TimeoutError) {
            return true;
        }
        if (error instanceof NetworkError) {
            const details = (error as any).details || {};
            return details.status === undefined;
        }
        return false;
    }

    /** Presupuesto de rotación: cada nodo vivo puede recibir la petición una vez. */
    private maxRotationAttempts(): number {
        return this.nodes.length;
    }

    private markCurrentNodeDead(): void {
        this.nodes[this.currentIndex].alive = false;
        this.nodes[this.currentIndex].latencyMs = null;
    }

    /** Puntero atómico al siguiente nodo vivo (búsqueda circular). */
    private rotateToNextAliveNode(): boolean {
        for (let step = 1; step <= this.nodes.length; step++) {
            const idx = (this.currentIndex + step) % this.nodes.length;
            if (this.nodes[idx].alive) {
                this.currentIndex = idx;
                return true;
            }
        }
        return false;
    }

    private syncBaseURL(): void {
        this.client.defaults.baseURL = this.nodes[this.currentIndex].url;
    }

    /**
     * Sonda de salud en paralelo contra TODOS los endpoints. Mide el
     * round-trip real de /api/node/health y actualiza el estado vivo/latencia.
     */
    async probeAllNodes(): Promise<void> {
        if (this.probing) {
            return this.probing;
        }
        this.probing = (async () => {
            await Promise.all(
                this.nodes.map(async (node) => {
                    const startedAt = Date.now();
                    try {
                        await axios.get(node.url + HEALTH_PATH, {
                            timeout: PROBE_TIMEOUT_MS,
                        });
                        node.alive = true;
                        node.latencyMs = Date.now() - startedAt;
                    } catch {
                        node.alive = false;
                        node.latencyMs = null;
                    }
                    node.lastProbeAt = Date.now();
                })
            );
        })();
        try {
            await this.probing;
        } finally {
            this.probing = null;
        }
    }

    /**
     * Selecciona el nodo con MENOR latencia (round-trip de la sonda de
     * salud) y apunta el cliente ahí. Llamar al inicializar la app para
     * arrancar en el nodo más rápido; la rotación reacciona ante caídas
     * incluso sin llamar esto (arranca en la primera URL de la lista).
     */
    async selectFastestNode(): Promise<string> {
        await this.probeAllNodes();

        let best = -1;
        for (let i = 0; i < this.nodes.length; i++) {
            const node = this.nodes[i];
            if (!node.alive || node.latencyMs === null) continue;
            if (best < 0 || node.latencyMs < this.nodes[best].latencyMs!) {
                best = i;
            }
        }

        // Ningún nodo sano: mantener el puntero (la rotación/retry
        // existente producirá el error final claro).
        if (best < 0) {
            return this.nodes[this.currentIndex].url;
        }

        this.currentIndex = best;
        this.syncBaseURL();
        return this.nodes[best].url;
    }

    private shouldRetry(error: any): boolean {
        // Retry on network errors and 5xx server errors
        if (error instanceof NetworkError) {
            return true;
        }
        if (error instanceof TimeoutError) {
            return true;
        }
        if (error instanceof ConnectionError) {
            return true;
        }
        return false;
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    getBaseURL(): string {
        return this.client.defaults.baseURL || '';
    }

    /** FASE 4: lista completa de endpoints configurados. */
    getRpcUrls(): string[] {
        return this.nodes.map((n) => n.url);
    }

    /** FASE 4: snapshot de salud por nodo (para dashboards/UI de red). */
    getNodeHealth(): Array<{ url: string; alive: boolean; latencyMs: number | null }> {
        return this.nodes.map((n) => ({
            url: n.url,
            alive: n.alive,
            latencyMs: n.latencyMs,
        }));
    }
}
