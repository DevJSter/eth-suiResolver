import { describe, it, beforeAll, afterAll, expect } from '@jest/globals';
import { CrossChainEscrowManager } from '../src/core/CrossChainEscrowManager.js';
import { HashUtility } from '../src/utils/HashUtility.js';
import { RelayerService } from '../src/relayer/RelayerService.js';
import dotenv from 'dotenv';

dotenv.config();

describe('Cross-Chain Safe Escrow Integration Tests', () => {
    let escrowManager;
    let hashUtility;
    let relayer;
    // let skipTests = false;

    beforeAll(async () => {
        // Skip tests if environment is not configured
        if (!process.env.ETH_RPC_URL || !process.env.SUI_RPC_URL) {
            console.log('Skipping integration tests - environment not configured');
            // skipTests = true;
            return;
        }

        try {
            hashUtility = new HashUtility();
            
            escrowManager = new CrossChainEscrowManager({
                ethereum: {
                    rpcUrl: process.env.ETH_RPC_URL,
                    privateKey: process.env.ETH_PRIVATE_KEY,
                    safeRecordAddress: process.env.ETH_SAFE_RECORD_ADDRESS,
                    hashUtilityAddress: process.env.ETH_HASH_UTILITY_ADDRESS
                },
                sui: {
                    rpcUrl: process.env.SUI_RPC_URL,
                    privateKey: process.env.SUI_PRIVATE_KEY,
                    packageId: process.env.SUI_PACKAGE_ID,
                    registryId: process.env.SUI_REGISTRY_ID
                },
                network: 'testnet'
            });

            await escrowManager.initialize();
        } catch (error) {
            console.log('Failed to initialize test environment:', error.message);
            // skipTests = true;
        }
    });

    afterAll(async () => {
        if (escrowManager) {
            await escrowManager.shutdown();
        }
        if (relayer) {
            await relayer.stop();
        }
    });

    describe('Hash Utility', () => {
        it('should generate consistent hashes', () => {
            const secret = 'test-secret-123';
            const keccakHash = hashUtility.keccak256(secret);
            const sha256Hash = hashUtility.sha256(secret);

            expect(keccakHash).toHaveLength(32);
            expect(sha256Hash).toHaveLength(32);
            expect(keccakHash).not.toEqual(sha256Hash);

            // Verify consistency
            const keccakHash2 = hashUtility.keccak256(secret);
            const sha256Hash2 = hashUtility.sha256(secret);

            expect(keccakHash).toEqual(keccakHash2);
            expect(sha256Hash).toEqual(sha256Hash2);
        });

        it('should verify secrets correctly', () => {
            const secret = 'verification-test';
            const keccakHash = hashUtility.keccak256(secret);
            const sha256Hash = hashUtility.sha256(secret);

            expect(hashUtility.verifySecretKeccak256(secret, keccakHash)).toBe(true);
            expect(hashUtility.verifySecretSha256(secret, sha256Hash)).toBe(true);
            expect(hashUtility.verifySecretKeccak256('wrong', keccakHash)).toBe(false);
            expect(hashUtility.verifySecretSha256('wrong', sha256Hash)).toBe(false);
        });

        it('should generate random secrets', () => {
            const secret1 = hashUtility.generateRandomSecret();
            const secret2 = hashUtility.generateRandomSecret();

            expect(secret1).toHaveLength(64); // 32 bytes as hex
            expect(secret2).toHaveLength(64);
            expect(secret1).not.toEqual(secret2);
        });
    });

    describe('CrossChainEscrowManager Initialization', () => {
        it('should initialize successfully', () => {
            expect(escrowManager.isInitialized).toBe(true);
        });

        it('should have valid ethereum manager', () => {
            expect(escrowManager.ethereumManager).toBeDefined();
            expect(escrowManager.ethereumManager.isInitialized).toBe(true);
        });

        it('should have valid sui manager', () => {
            expect(escrowManager.suiManager).toBeDefined();
            expect(escrowManager.suiManager.isInitialized).toBe(true);
        });
    });

    describe('Single Chain Safe Creation', () => {
        it('should create ethereum safe with keccak256', async () => {
            if (!process.env.TEST_TOKEN_ADDRESS) {
                console.log('Skipping ethereum safe test - no test token configured');
                return;
            }

            const safeParams = {
                chain: 'ethereum',
                secret: 'test-secret-eth',
                token: process.env.TEST_TOKEN_ADDRESS,
                amount: '1000000', // 1 USDC (6 decimals)
                beneficiary: '0x742d35Cc6635C0532925a3b8D76C8d026E5b84A1',
                lockDuration: 5 * 60 * 1000, // 5 minutes
                useKeccak256: true
            };

            const safe = await escrowManager.createSingleChainSafe(safeParams);

            expect(safe).toBeDefined();
            expect(safe.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
            expect(safe.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
            expect(safe.useSha256).toBe(false);
        }, 30000);

        it('should create sui safe with keccak256', async () => {
            const safeParams = {
                chain: 'sui',
                secret: 'test-secret-sui',
                token: '0x2::sui::SUI',
                amount: '1000000000', // 1 SUI (9 decimals)
                beneficiary: '0x742d35Cc6635C0532925a3b8D76C8d026E5b84A1',
                lockDuration: 5 * 60 * 1000, // 5 minutes
                useKeccak256: true
            };

            const safe = await escrowManager.createSingleChainSafe(safeParams);

            expect(safe).toBeDefined();
            expect(safe.id).toMatch(/^0x[a-fA-F0-9]{64}$/);
            expect(safe.digest).toMatch(/^[A-Za-z0-9+/=]+$/);
            expect(safe.useSha256).toBe(false);
        }, 30000);
    });

    describe('Cross Chain Safe Creation', () => {
        it('should create cross-chain safe pair', async () => {
            if (!process.env.TEST_TOKEN_ADDRESS) {
                console.log('Skipping cross-chain test - no test token configured');
                return;
            }

            const secret = hashUtility.generateRandomSecret();
            const swapParams = {
                secret,
                sourceChain: 'ethereum',
                destChain: 'sui',
                sourceToken: process.env.TEST_TOKEN_ADDRESS,
                destToken: '0x2::sui::SUI',
                sourceAmount: '1000000', // 1 USDC
                destAmount: '1000000000', // 1 SUI
                sourceOwner: '0x742d35Cc6635C0532925a3b8D76C8d026E5b84A1',
                destOwner: '0x742d35Cc6635C0532925a3b8D76C8d026E5b84A1',
                sourceLockDuration: 10 * 60 * 1000, // 10 minutes
                destLockDuration: 5 * 60 * 1000 // 5 minutes
            };

            const crossChainSafe = await escrowManager.createCrossChainSafe(swapParams);

            expect(crossChainSafe).toBeDefined();
            expect(crossChainSafe.secretHash).toMatch(/^[a-fA-F0-9]{64}$/);
            expect(crossChainSafe.sourceSafe).toBeDefined();
            expect(crossChainSafe.destSafe).toBeDefined();
            expect(crossChainSafe.sourceChain).toBe('ethereum');
            expect(crossChainSafe.destChain).toBe('sui');
        }, 60000);
    });

    describe('Relayer Service', () => {
        it('should initialize relayer service', async () => {
            relayer = new RelayerService(escrowManager);
            
            expect(relayer).toBeDefined();
            expect(relayer.isRunning).toBe(false);

            await relayer.start();
            expect(relayer.isRunning).toBe(true);

            const stats = relayer.getStatistics();
            expect(stats.isRunning).toBe(true);
            expect(stats.retryAttempts).toBeGreaterThan(0);
        });
    });

    describe('Error Handling', () => {
        it('should handle invalid timeout configuration', async () => {
            const invalidParams = {
                secret: 'test',
                sourceChain: 'ethereum',
                destChain: 'sui',
                sourceToken: '0x123',
                destToken: '0x2::sui::SUI',
                sourceAmount: '1000000',
                destAmount: '1000000000',
                sourceOwner: '0x742d35Cc6635C0532925a3b8D76C8d026E5b84A1',
                destOwner: '0x742d35Cc6635C0532925a3b8D76C8d026E5b84A1',
                sourceLockDuration: 1000, // Too short
                destLockDuration: 5000
            };

            await expect(escrowManager.createCrossChainSafe(invalidParams))
                .rejects.toThrow();
        });

        it('should handle unsupported chain', async () => {
            const invalidParams = {
                chain: 'bitcoin',
                secret: 'test',
                token: '0x123',
                amount: '1000000',
                beneficiary: '0x742d35Cc6635C0532925a3b8D76C8d026E5b84A1',
                lockDuration: 5 * 60 * 1000
            };

            await expect(escrowManager.createSingleChainSafe(invalidParams))
                .rejects.toThrow('Unsupported chain: bitcoin');
        });

        it('should handle missing initialization', async () => {
            const uninitializedManager = new CrossChainEscrowManager({});
            
            await expect(uninitializedManager.createSingleChainSafe({}))
                .rejects.toThrow('not initialized');
        });
    });
});