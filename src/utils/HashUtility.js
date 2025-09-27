import crypto from 'crypto';

export class HashUtility {
    /**
     * Calculate keccak256 hash from string (Ethereum native)
     */
    keccak256(input) {
        if (typeof input === 'string') {
            return crypto.createHash('sha3-256').update(input, 'utf8').digest();
        }
        return crypto.createHash('sha3-256').update(input).digest();
    }

    /**
     * Calculate sha256 hash from string (cross-chain compatible)
     */
    sha256(input) {
        if (typeof input === 'string') {
            return crypto.createHash('sha256').update(input, 'utf8').digest();
        }
        return crypto.createHash('sha256').update(input).digest();
    }

    /**
     * Calculate keccak256 hash from bytes
     */
    keccak256FromBytes(data) {
        return crypto.createHash('sha3-256').update(data).digest();
    }

    /**
     * Calculate sha256 hash from bytes
     */
    sha256FromBytes(data) {
        return crypto.createHash('sha256').update(data).digest();
    }

    /**
     * Verify if a secret matches the given hash (keccak256)
     */
    verifySecretKeccak256(secret, expectedHash) {
        const computedHash = this.keccak256(secret);
        return computedHash.equals(expectedHash);
    }

    /**
     * Verify if a secret matches the given hash (sha256)
     */
    verifySecretSha256(secret, expectedHash) {
        const computedHash = this.sha256(secret);
        return computedHash.equals(expectedHash);
    }

    /**
     * Batch hash calculation for multiple secrets (keccak256)
     */
    batchKeccak256(secrets) {
        return secrets.map(secret => this.keccak256(secret));
    }

    /**
     * Batch hash calculation for multiple secrets (sha256)
     */
    batchSha256(secrets) {
        return secrets.map(secret => this.sha256(secret));
    }

    /**
     * Generate a random secret
     */
    generateRandomSecret(length = 32) {
        return crypto.randomBytes(length).toString('hex');
    }

    /**
     * Generate a random secret as bytes
     */
    generateRandomSecretBytes(length = 32) {
        return crypto.randomBytes(length);
    }

    /**
     * Convert hash to hex string
     */
    toHexString(hash) {
        return hash.toString('hex');
    }

    /**
     * Convert hex string to buffer
     */
    fromHexString(hexString) {
        return Buffer.from(hexString.replace('0x', ''), 'hex');
    }

    /**
     * Create Ethereum-compatible hash (with 0x prefix)
     */
    toEthereumHash(hash) {
        return '0x' + this.toHexString(hash);
    }

    /**
     * Create Sui-compatible hash (as byte array)
     */
    toSuiHash(hash) {
        return Array.from(hash);
    }
}