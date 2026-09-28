import { Buffer } from 'buffer';
import { Wallet } from '../accounts/Wallet';
import { crypto, deriveAddressHex } from '../utils';

/**
 * Signer class for transaction signing and verification
 */
export class Signer {
    private wallet?: Wallet;

    /**
     * Set the wallet to be used for signing
     */
    setWallet(wallet: Wallet): void {
        this.wallet = wallet;
    }

    /**
     * Sign a transaction
     */
    async signTransaction(transaction: any): Promise<string> {
        if (!this.wallet) {
            throw new Error('No wallet provided to signer. Registration or login required.');
        }

        return this.wallet.sign(JSON.stringify(transaction));
    }

    /**
     * Sign a message
     */
    async signMessage(message: string): Promise<string> {
        if (!this.wallet) {
            throw new Error('No wallet provided to signer. Registration or login required.');
        }

        return this.wallet.sign(message);
    }

    /**
     * Verify a signature against a public key
     */
    async verify(message: string | Uint8Array, signature: string | Uint8Array, publicKey: string | Uint8Array): Promise<boolean> {
        const msgBytes = typeof message === 'string' ? Buffer.from(message) : message;
        const sigBytes = typeof signature === 'string'
            ? Buffer.from(signature.startsWith('0x') ? signature.slice(2) : signature, 'hex')
            : signature;
        const pubBytes = typeof publicKey === 'string'
            ? Buffer.from(publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey, 'hex')
            : publicKey;

        return crypto.ml_dsa65.verify(sigBytes, msgBytes, pubBytes);
    }

    /**
     * "Recover" address (simply derivation from public key in ML-DSA)
     */
    async recoverAddress(_message: string, _signature: string, publicKey: string): Promise<string> {
        return deriveAddressHex(Buffer.from(publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey, 'hex'));
    }
}
