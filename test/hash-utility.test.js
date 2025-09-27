import { describe, it, expect } from '@jest/globals';
import { HashUtility } from '../src/utils/HashUtility.js';

describe('Hash Utility Unit Tests', () => {
    let hashUtility;

    beforeAll(() => {
        hashUtility = new HashUtility();
    });

    describe('Hash Generation', () => {
        it('should generate consistent keccak256 hashes', () => {
            const secret = 'test-secret-123';
            const hash1 = hashUtility.keccak256(secret);
            const hash2 = hashUtility.keccak256(secret);

            expect(hash1).toHaveLength(32);
            expect(hash1).toEqual(hash2);
            expect(Buffer.isBuffer(hash1)).toBe(true);
        });

        it('should generate consistent sha256 hashes', () => {
            const secret = 'test-secret-123';
            const hash1 = hashUtility.sha256(secret);
            const hash2 = hashUtility.sha256(secret);

            expect(hash1).toHaveLength(32);
            expect(hash1).toEqual(hash2);
            expect(Buffer.isBuffer(hash1)).toBe(true);
        });

        it('should generate different hashes for different algorithms', () => {
            const secret = 'test-secret-123';
            const keccakHash = hashUtility.keccak256(secret);
            const sha256Hash = hashUtility.sha256(secret);

            expect(keccakHash).not.toEqual(sha256Hash);
        });
    });

    describe('Secret Verification', () => {
        it('should verify keccak256 secrets correctly', () => {
            const secret = 'verification-test';
            const hash = hashUtility.keccak256(secret);

            expect(hashUtility.verifySecretKeccak256(secret, hash)).toBe(true);
            expect(hashUtility.verifySecretKeccak256('wrong-secret', hash)).toBe(false);
        });

        it('should verify sha256 secrets correctly', () => {
            const secret = 'verification-test';
            const hash = hashUtility.sha256(secret);

            expect(hashUtility.verifySecretSha256(secret, hash)).toBe(true);
            expect(hashUtility.verifySecretSha256('wrong-secret', hash)).toBe(false);
        });
    });

    describe('Random Secret Generation', () => {
        it('should generate random secrets', () => {
            const secret1 = hashUtility.generateRandomSecret();
            const secret2 = hashUtility.generateRandomSecret();

            expect(secret1).toHaveLength(64); // 32 bytes as hex
            expect(secret2).toHaveLength(64);
            expect(secret1).not.toEqual(secret2);
            expect(typeof secret1).toBe('string');
            expect(typeof secret2).toBe('string');
        });

        it('should generate secrets with valid hex characters', () => {
            const secret = hashUtility.generateRandomSecret();
            const hexRegex = /^[0-9a-f]{64}$/i;
            
            expect(hexRegex.test(secret)).toBe(true);
        });
    });

    describe('Hash Format Conversions', () => {
        it('should convert hashes to hex strings', () => {
            const secret = 'test-conversion';
            const hash = hashUtility.keccak256(secret);
            const hexString = hashUtility.toHexString(hash);

            expect(typeof hexString).toBe('string');
            expect(hexString).toHaveLength(64); // 64 hex chars
            expect(hexString).toMatch(/^[0-9a-f]{64}$/i);
        });

        it('should convert hex strings to hash buffers', () => {
            const secret = 'test-conversion';
            const originalHash = hashUtility.keccak256(secret);
            const hexString = hashUtility.toHexString(originalHash);
            const convertedHash = hashUtility.fromHexString(hexString);

            expect(Buffer.isBuffer(convertedHash)).toBe(true);
            expect(convertedHash).toEqual(originalHash);
        });

        it('should create Ethereum-compatible hash strings', () => {
            const secret = 'test-ethereum';
            const hash = hashUtility.keccak256(secret);
            const ethHash = hashUtility.toEthereumHash(hash);

            expect(typeof ethHash).toBe('string');
            expect(ethHash).toHaveLength(66); // '0x' + 64 hex chars
            expect(ethHash).toMatch(/^0x[0-9a-f]{64}$/i);
        });
    });
});