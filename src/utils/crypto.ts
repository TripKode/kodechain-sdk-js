import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { Buffer } from 'buffer';

/**
 * Helper to convert string to Uint8Array using UTF-8 encoding.
 */
function utf8ToBytes(str: string): Uint8Array {
    return Buffer.from(str, 'utf8');
}

/**
 * Hardened sponge hash (KSP-6B) — EXACT port of the engine's
 * security/quantum_signer.go: multi-rate padding, 24 rounds with round
 * constants, modular-addition non-linearity, and domain separation.
 *
 * The previous port matched only the pre-hardening sponge (linear, no
 * padding, no domains) and produced DIFFERENT hashes than the engine.
 */
const ROUND_CONSTANTS: number[] = [
    0x6a, 0x09, 0xe6, 0x67, 0xf3, 0xbc, 0xc9, 0x0b,
    0xbb, 0x67, 0xae, 0x85, 0x84, 0xca, 0xa7, 0x3b,
    0x3c, 0x6e, 0xf3, 0x72, 0xa5, 0x4f, 0xf5, 0x3a,
];

/** Domain separation tags (must match engine's Domain* constants). */
export const DomainKSEL8 = 'KSEL-8';
export const DomainAddress = 'KDC-ADDR';
export const DomainCreate = 'KDC-CREATE';
export const DomainKVIID = 'KVI-ID';
export const DomainKVMQSH = 'KVM-QSH';

class SpongeHash {
    private state: Uint8Array = new Uint8Array(32);
    private pos: number = 0;

    absorb(data: Uint8Array): void {
        for (const b of data) {
            this.state[this.pos] ^= b;
            this.pos++;
            if (this.pos === 32) {
                this.permute();
                this.pos = 0;
            }
        }
    }

    /** Multi-rate padding + final permutation (call once after absorb). */
    finish(): void {
        if (this.pos === 32) {
            this.permute();
            this.pos = 0;
        }
        this.state[this.pos] ^= 0x01;
        this.state[31] ^= 0x80;
        this.permute();
        this.pos = 0;
    }

    /**
     * Domain barrier: permutes the state when the position is mid-block,
     * sealing the previously absorbed segment (domain tag) before new
     * data is absorbed. Matches Go's `if pos != 0 { permute; pos = 0 }`.
     */
    barrier(): void {
        if (this.pos !== 0) {
            this.permute();
            this.pos = 0;
        }
    }

    private permute(): void {
        const st = this.state;
        for (let r = 0; r < 24; r++) {
            for (let i = 0; i < 32; i++) {
                const next = st[(i + 1) % 32];
                st[i] ^= next ^ st[(i + 7) % 32] ^ ROUND_CONSTANTS[(r + i) % 24];
                const rot = ((r + i) % 8) + 1;
                st[i] = (((st[i] << rot) | (st[i] >>> (8 - rot))) & 0xff);
                st[i] = (st[i] + next) & 0xff; // mod 256: non-linear over GF(2)
            }
        }
    }

    squeeze(length: number): Uint8Array {
        const result = new Uint8Array(length);
        for (let i = 0; i < length; i++) {
            if (this.pos === 32) {
                this.permute();
                this.pos = 0;
            }
            result[i] = this.state[this.pos];
            this.pos++;
        }
        return result;
    }
}

/**
 * Generates a quantum-resistant hash using the custom SpongeHash
 * Matches the Node Validator's implementation
 */
export function generateQuantumHash(data: string | Uint8Array): Uint8Array {
    let bytes: Uint8Array;
    if (typeof data === 'string') {
        if (data.startsWith('0x')) {
            bytes = Buffer.from(data.slice(2), 'hex');
        } else {
            bytes = utf8ToBytes(data);
        }
    } else {
        bytes = data;
    }
    const sponge = new SpongeHash();
    sponge.absorb(bytes);
    sponge.finish();
    return sponge.squeeze(32);
}

/**
 * Generate a quantum hash in hex format
 */
export function generateQuantumHashHex(data: string | Uint8Array): string {
    return '0x' + Buffer.from(generateQuantumHash(data)).toString('hex');
}

/**
 * Tagged (domain-separated) quantum hash. The domain is absorbed as an
 * initial block and permuted before the data — values from different
 * domains can never collide by construction.
 */
export function generateQuantumHashTagged(domain: string, data: string | Uint8Array): Uint8Array {
    const bytes: Uint8Array = typeof data === 'string'
        ? (data.startsWith('0x') ? Buffer.from(data.slice(2), 'hex') : utf8ToBytes(data))
        : data;
    const sponge = new SpongeHash();
    sponge.absorb(utf8ToBytes(domain));
    sponge.barrier();
    sponge.absorb(bytes);
    sponge.finish();
    return sponge.squeeze(32);
}


/**
 * Generate a tagged quantum hash in hex format
 */
export function generateQuantumHashTaggedHex(domain: string, data: string | Uint8Array): string {
    return '0x' + Buffer.from(generateQuantumHashTagged(domain, data)).toString('hex');
}

/**
 * KSEL-8 selector: first 4 bytes of the QSH of the canonical signature
 * in the KSEL-8 domain (matches engine + kottg compiler).
 */
export function generateKSEL8(signature: string): string {
    return generateQuantumHashTaggedHex(DomainKSEL8, signature).slice(0, 10); // 0x + 8 hex
}

/**
 * Canonical wallet address: QSH(publicKey) in the KDC-ADDR domain,
 * LAST 40 hex with 0x prefix (matches engine AddressFromPublicKeyHex).
 */
export function deriveAddressHex(publicKey: Uint8Array): string {
    const full = generateQuantumHashTaggedHex(DomainAddress, publicKey);
    return '0x' + full.slice(-40);
}

/**
 * Keccak-256 hash
 */
export function keccak256(data: string | Uint8Array): string {
    const bytes = typeof data === 'string'
        ? Buffer.from(data.startsWith('0x') ? data.slice(2) : data, 'hex')
        : data;
    return '0x' + Buffer.from(keccak_256(bytes)).toString('hex');
}

/**
 * Encode function signature (first 4 bytes of SHA256 per Node Validator specs)
 */
export function encodeFunctionSignature(signature: string): string {
    const hash = sha256(Buffer.from(signature));
    return '0x' + Buffer.from(hash.slice(0, 4)).toString('hex');
}

/**
 * Generate random hex string
 */
export function randomHex(length: number): string {
    const bytes = randomBytes(length);
    return '0x' + Buffer.from(bytes).toString('hex');
}

/**
 * Convert string to hex
 */
export function stringToHex(str: string): string {
    return '0x' + Buffer.from(str, 'utf8').toString('hex');
}

/**
 * Convert hex to string
 */
export function hexToString(hex: string): string {
    const stripped = hex.startsWith('0x') ? hex.slice(2) : hex;
    return Buffer.from(stripped, 'hex').toString('utf8');
}

/**
 * ML-DSA-65 specific utilities
 */
export const crypto = {
    ml_dsa65,
    randomBytes,
};
