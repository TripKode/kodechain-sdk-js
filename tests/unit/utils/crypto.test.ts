import { crypto, deriveAddressHex, generateQuantumHashHex } from '../../../src/utils/crypto';
import { Wallet } from '../../../src/accounts/Wallet';
import { KodeChainClient } from '../../../src/core/KodeChainClient';

describe('ML-DSA-65 Cryptography', () => {
    const client = new KodeChainClient({ nodeUrl: 'http://localhost:8080' });

    test('should generate valid ML-DSA-65 key pair from seed', () => {
        const seed = crypto.randomBytes(32);
        const { publicKey, secretKey } = crypto.ml_dsa65.keygen(seed);

        expect(publicKey).toBeDefined();
        expect(secretKey).toBeDefined();
        expect(publicKey.length).toBeGreaterThan(1000); // ML-DSA-65 public keys are large
    });

    test('generateQuantumHashHex should be deterministic', () => {
        const data = new Uint8Array([1, 2, 3, 4]);
        const h1 = generateQuantumHashHex(data);
        const h2 = generateQuantumHashHex(data);
        expect(h1).toBe(h2);
    });

    test('should sign and verify a message', () => {
        const seed = crypto.randomBytes(32);
        const { publicKey, secretKey } = crypto.ml_dsa65.keygen(seed);
        const message = Buffer.from('Hello KodeChain');

        const signature = crypto.ml_dsa65.sign(message, secretKey);
        const isValid = crypto.ml_dsa65.verify(signature, message, publicKey);

        expect(isValid).toBe(true);
    });

    test('Wallet should correctly derive address from public key', () => {
        const wallet = Wallet.createRandom(client);
        const pubKey = wallet.getPublicKey();
        const address = wallet.address;
        // canonical engine scheme: 0x + last 40 hex of QSH(pubkey) in KDC-ADDR domain
        const expected = deriveAddressHex(Buffer.from(pubKey.slice(2), 'hex'));

        expect(address).toBe(expected);
        expect(address).toMatch(/^0x[0-9a-f]{40}$/);
    });

    test('Wallet should sign and produce a valid signature format', async () => {
        const wallet = Wallet.createRandom(client);
        const message = 'Test Message';
        const signature = await wallet.sign(message);

        expect(signature.startsWith('0x')).toBe(true);
        expect(signature.length).toBeGreaterThan(6000); // ML-DSA-65 signatures are ~3300 bytes -> hex ~6600
    });
});
