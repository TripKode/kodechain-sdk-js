import { KodeChainClient } from '../core';
import { validateAddress, deriveAddressHex, crypto } from '../utils';
import { Buffer } from 'buffer';

export class Wallet {
    private client: KodeChainClient;
    public readonly address: string;
    private secretKey?: Uint8Array;
    private publicKey: Uint8Array;

    constructor(address: string, client: KodeChainClient, publicKey: Uint8Array, secretKey?: Uint8Array) {
        validateAddress(address);
        this.address = address;
        this.client = client;
        this.secretKey = secretKey;
        this.publicKey = publicKey;
    }

    /**
     * Create a new random wallet
     */
    static createRandom(client: KodeChainClient): Wallet {
        const seed = crypto.randomBytes(32);
        const { publicKey, secretKey } = crypto.ml_dsa65.keygen(seed);
        const address = deriveAddressHex(publicKey);  // canonical: QSH(pubkey) last-40 hex (KDC-ADDR)

        return new Wallet(address, client, publicKey, secretKey);
    }

    /**
     * Import a wallet from a private seed (32 bytes)
     */
    static fromSeed(seed: string | Uint8Array, client: KodeChainClient): Wallet {
        const seedBytes = typeof seed === 'string'
            ? Buffer.from(seed.startsWith('0x') ? seed.slice(2) : seed, 'hex')
            : seed;

        if (seedBytes.length !== 32) {
            throw new Error('ML-DSA-65 seed must be 32 bytes.');
        }

        const { publicKey, secretKey } = crypto.ml_dsa65.keygen(seedBytes);
        const address = deriveAddressHex(publicKey);  // canonical: QSH(pubkey) last-40 hex (KDC-ADDR)

        return new Wallet(address, client, publicKey, secretKey);
    }

    /**
     * Import wallet from full secret key (ML-DSA-65 secret key bytes)
     */
    static fromSecretKey(secretKeyHex: string, client: KodeChainClient): Wallet {
        const secretKeyBytes = typeof secretKeyHex === 'string'
            ? Buffer.from(secretKeyHex.startsWith('0x') ? secretKeyHex.slice(2) : secretKeyHex, 'hex')
            : secretKeyHex;

        // ML-DSA-65 secret key is 4032 bytes
        if (secretKeyBytes.length !== 4032) {
            throw new Error('ML-DSA-65 secret key must be 4032 bytes.');
        }

        // Derive public key from secret key using ML-DSA-65
        const publicKey = crypto.ml_dsa65.getPublicKey(secretKeyBytes);
        const address = deriveAddressHex(publicKey);  // canonical: QSH(pubkey) last-40 hex (KDC-ADDR)

        return new Wallet(address, client, publicKey, secretKeyBytes);
    }

    /**
     * Compatibility helper: Try to import from either seed (32 bytes) or full secret key (4032 bytes)
     */
    static fromPrivateKey(privateKey: string, client: KodeChainClient): Wallet {
        const keyBytes = typeof privateKey === 'string'
            ? Buffer.from(privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey, 'hex')
            : privateKey;

        // Check if it's a seed (32 bytes) or full secret key (4032 bytes)
        if (keyBytes.length === 32) {
            return this.fromSeed(privateKey, client);
        } else if (keyBytes.length === 4032) {
            return this.fromSecretKey(privateKey, client);
        } else {
            throw new Error(`Invalid private key length: ${keyBytes.length} bytes. Expected 32 (seed) or 4032 (secret key).`);
        }
    }

    /**
     * Sign data with the ML-DSA-65 secret key
     */
    async sign(data: string | Uint8Array): Promise<string> {
        if (!this.secretKey) {
            throw new Error('Wallet not initialized with a secret key. Cannot sign.');
        }

        const bytes = typeof data === 'string' ? Buffer.from(data) : data;
        const signature = crypto.ml_dsa65.sign(bytes, this.secretKey);

        return '0x' + Buffer.from(signature).toString('hex');
    }

    /**
     * Get wallet balance
     */
    async getBalance(chain?: 'DPOS' | 'PBFT'): Promise<string> {
        return this.client.getBalance(this.address, chain);
    }

    /**
     * Get the secret key in hex
     */
    getPrivateKey(): string | undefined {
        return this.secretKey ? '0x' + Buffer.from(this.secretKey).toString('hex') : undefined;
    }

    /**
     * Get public key in hex
     */
    getPublicKey(): string {
        return '0x' + Buffer.from(this.publicKey).toString('hex');
    }

    /**
     * Send KDC to another address (mined by consensus).
     * @param to destination wallet address (0x + 40 hex)
     * @param amountProton exact amount in proton as decimal string (1 KDC = 1e18)
     * Engine endpoint: POST /api/transaction/create (TRANSFER → DPOS policy)
     */
    async sendTransaction(to: string, amountProton: string, chain?: 'DPOS' | 'PBFT'): Promise<any> {
        validateAddress(to);
        void chain;
        return this.client.getProvider().post('/api/transaction/create', {
            type: 'transfer',
            from: this.address,
            to,
            amount_proton: amountProton,
            gasPrice: 1_000_000_000,
        });
    }
}
