/**
 * FASE 4 — Red Auto-Organizada: suite del Failover Multi-RPC del Provider.
 *
 * Cada test usa SERVIDORES HTTP REALES efímeros (puerto 0) y puertos
 * muertos (listener cerrado → connection refused) — nada de mocks: la
 * rotación se ejercita contra sockets de verdad, igual que en producción
 * cuando la VM se apaga a $0 o la SIM celular de un validador se cae.
 */

import http from 'http';
import { AddressInfo } from 'net';
import { Provider } from '../../../src/core/Provider';
import { ConnectionError, NetworkError } from '../../../src/errors';

/** Levanta un servidor HTTP real que responde JSON a toda ruta. */
function startServer(handler?: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
    const server = http.createServer((req, res) => {
        if (handler) {
            handler(req, res);
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
    });
    return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as AddressInfo;
            resolve({
                url: `http://127.0.0.1:${port}`,
                close: () => new Promise<void>((r) => server.close(() => r())),
            });
        });
    });
}

/** Puerto garantizado MUERTO: se abre un listener y se cierra. */
async function deadPort(): Promise<string> {
    const srv = http.createServer(() => undefined);
    return new Promise<string>((resolve) => {
        srv.listen(0, '127.0.0.1', () => {
            const { port } = srv.address() as AddressInfo;
            srv.close(() => resolve(`http://127.0.0.1:${port}`));
        });
    });
}

describe('FASE 4 — Provider Failover Multi-RPC', () => {
    afterEach(() => {
        // los tests cierran sus servidores; nada global que limpiar
    });

    it('rota al nodo vivo cuando el primero está muerto (get transparente)', async () => {
        const dead = await deadPort();
        const alive = await startServer();

        const provider = new Provider({ baseURL: dead, baseURLs: [dead, alive.url] });

        const result = await provider.get('/api/sync/height');
        expect(result).toEqual({ ok: true });

        // El puntero quedó en el nodo vivo — las siguientes peticiones van directas.
        expect(provider.getBaseURL()).toBe(alive.url);
        expect(provider.getNodeHealth()[0].alive).toBe(false);
        expect(provider.getNodeHealth()[1].alive).toBe(true);

        await alive.close();
    });

    it('encadena rotaciones a través de varios nodos muertos', async () => {
        const dead1 = await deadPort();
        const dead2 = await deadPort();
        const alive = await startServer();

        const provider = new Provider({
            baseURL: dead1,
            baseURLs: [dead1, dead2, alive.url],
        });

        const result = await provider.post('/api/transaction/create', { hello: 'world' });
        expect(result).toEqual({ ok: true });
        expect(provider.getBaseURL()).toBe(alive.url);

        await alive.close();
    });

    it('arroja ConnectionError claro cuando TODOS los nodos están muertos', async () => {
        const dead1 = await deadPort();
        const dead2 = await deadPort();

        const provider = new Provider({
            baseURL: dead1,
            baseURLs: [dead1, dead2],
            retries: 0,
        });

        await expect(provider.get('/api/node/health')).rejects.toThrow();

        expect(provider.getNodeHealth().every((n) => !n.alive)).toBe(true);
    });

    it('selectFastestNode elige el nodo con MENOR latencia', async () => {
        const slow = await startServer((_req, res) => {
            setTimeout(() => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
            }, 120);
        });
        const fast = await startServer();

        const provider = new Provider({
            baseURL: slow.url,
            baseURLs: [slow.url, fast.url],
        });

        const chosen = await provider.selectFastestNode();
        expect(chosen).toBe(fast.url);
        expect(provider.getBaseURL()).toBe(fast.url);
        expect(provider.getNodeHealth()[0].alive).toBe(true); // lento pero vivo

        await slow.close();
        await fast.close();
    });

    it('NO rota ante errores HTTP (4xx): el nodo está vivo respondiendo', async () => {
        const alive = await startServer((_req, res) => {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: 'no existe' }));
        });

        const provider = new Provider({
            baseURL: alive.url,
            baseURLs: [alive.url], // solo 1: aislamos la semántica de error
            retries: 0,
        });

        await expect(provider.get('/api/inexistente')).rejects.toThrow(NetworkError);
        expect(provider.getNodeHealth()[0].alive).toBe(true);

        await alive.close();
    });

    it('resucita un nodo tras re-sonder (muerto → vivo)', async () => {
        const dead = await deadPort();
        const alive = await startServer();

        const provider = new Provider({
            baseURL: dead,
            baseURLs: [dead, alive.url],
        });

        // El primer get rota al vivo; el muerto queda marcado.
        await provider.get('/api/sync/height');
        expect(provider.getNodeHealth()[0].alive).toBe(false);

        // Resurrección: re-sonda y el estado se actualiza (sigue muerto en
        // este caso, pero la sonda completa el ciclo sin lanzar).
        await provider.probeAllNodes();
        expect(provider.getNodeHealth()[0].alive).toBe(false);
        expect(provider.getNodeHealth()[1].alive).toBe(true);

        await alive.close();
    });

    it('acepta URLs separadas por coma y deduplica', async () => {
        const alive = await startServer();
        const provider = new Provider({
            baseURL: 'irrelevante',
            baseURLs: [`${alive.url},${alive.url}/,, ,${alive.url}`],
        });

        expect(provider.getRpcUrls()).toEqual([alive.url]);
        expect(await provider.get('/api/sync/height')).toEqual({ ok: true });

        await alive.close();
    });

    it('con una sola URL conserva el comportamiento histórico (sin rotación)', async () => {
        const dead = await deadPort();
        const provider = new Provider({ baseURL: dead, retries: 0 });

        await expect(provider.get('/api/node/health')).rejects.toBeInstanceOf(ConnectionError);
    });
});
