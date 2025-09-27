import { EthereumSafeManager } from './EthereumSafeManager.js';
import { SuiSafeManager } from './SuiSafeManager.js';
import { HashUtility } from '../utils/HashUtility.js';
import { TimeoutManager } from '../utils/TimeoutManager.js';
import { logger } from '../utils/logger.js';

export class CrossChainEscrowManager {
    constructor(config) {
        this.config = config;
        this.ethereumManager = null;
        this.suiManager = null;
        this.hashUtility = new HashUtility();
        this.timeoutManager = new TimeoutManager(config.network);
        this.isInitialized = false;
    }

    async initialize() {
        try {
            // Initialize Ethereum manager
            this.ethereumManager = new EthereumSafeManager(this.config.ethereum);
            await this.ethereumManager.initialize();

            // Initialize Sui manager
            this.suiManager = new SuiSafeManager(this.config.sui);
            await this.suiManager.initialize();

            this.isInitialized = true;
            logger.info('CrossChainEscrowManager initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize CrossChainEscrowManager:', error);
            throw error;
        }
    }

    /**
     * Create a cross-chain safe pair
     * @param {Object} params - Safe creation parameters
     * @param {string} params.secret - The secret string
     * @param {string} params.sourceChain - 'ethereum' or 'sui'
     * @param {string} params.destChain - 'ethereum' or 'sui'
     * @param {string} params.sourceToken - Token address/type
     * @param {string} params.destToken - Token address/type
     * @param {string} params.sourceAmount - Amount to lock on source
     * @param {string} params.destAmount - Amount to lock on destination
     * @param {string} params.sourceOwner - Source chain owner address
     * @param {string} params.destOwner - Destination chain owner address
     * @param {number} params.sourceLockDuration - Source chain timeout (ms)
     * @param {number} params.destLockDuration - Destination chain timeout (ms)
     */
    async createCrossChainSafe(params) {
        this._checkInitialized();

        const {
            secret,
            sourceChain,
            destChain,
            sourceToken,
            destToken,
            sourceAmount,
            destAmount,
            sourceOwner,
            destOwner,
            sourceLockDuration,
            destLockDuration
        } = params;

        // Validate timeout configuration
        this.timeoutManager.validateTimeouts(sourceLockDuration, destLockDuration);

        // Generate sha256 hash for cross-chain compatibility
        const secretHash = this.hashUtility.sha256(secret);

        try {
            let sourceSafe, destSafe;

            // Create source chain safe
            if (sourceChain === 'ethereum') {
                sourceSafe = await this.ethereumManager.createSafeSha256({
                    token: sourceToken,
                    amount: sourceAmount,
                    secretHash,
                    beneficiary: destOwner,
                    lockDuration: sourceLockDuration
                });
            } else if (sourceChain === 'sui') {
                sourceSafe = await this.suiManager.createSafeSha256({
                    coinType: sourceToken,
                    amount: sourceAmount,
                    secretHash,
                    beneficiary: destOwner,
                    lockDuration: sourceLockDuration
                });
            } else {
                throw new Error(`Unsupported source chain: ${sourceChain}`);
            }

            // Create destination chain safe
            if (destChain === 'ethereum') {
                destSafe = await this.ethereumManager.createSafeSha256({
                    token: destToken,
                    amount: destAmount,
                    secretHash,
                    beneficiary: sourceOwner,
                    lockDuration: destLockDuration
                });
            } else if (destChain === 'sui') {
                destSafe = await this.suiManager.createSafeSha256({
                    coinType: destToken,
                    amount: destAmount,
                    secretHash,
                    beneficiary: sourceOwner,
                    lockDuration: destLockDuration
                });
            } else {
                throw new Error(`Unsupported destination chain: ${destChain}`);
            }

            const result = {
                secretHash: secretHash.toString('hex'),
                sourceSafe,
                destSafe,
                sourceChain,
                destChain,
                createdAt: new Date().toISOString()
            };

            logger.info('Cross-chain safe pair created:', {
                secretHash: result.secretHash,
                sourceChain,
                destChain
            });

            return result;

        } catch (error) {
            logger.error('Failed to create cross-chain safe:', error);
            throw error;
        }
    }

    /**
     * Create a single-chain safe
     * @param {Object} params - Safe creation parameters
     */
    async createSingleChainSafe(params) {
        this._checkInitialized();

        const { chain, secret, token, amount, beneficiary, lockDuration, useKeccak256 = true } = params;

        try {
            let safe;

            if (chain === 'ethereum') {
                if (useKeccak256) {
                    safe = await this.ethereumManager.createSafe({
                        token,
                        amount,
                        secret,
                        beneficiary,
                        lockDuration
                    });
                } else {
                    const secretHash = this.hashUtility.sha256(secret);
                    safe = await this.ethereumManager.createSafeSha256({
                        token,
                        amount,
                        secretHash,
                        beneficiary,
                        lockDuration
                    });
                }
            } else if (chain === 'sui') {
                if (useKeccak256) {
                    safe = await this.suiManager.createSafe({
                        coinType: token,
                        amount,
                        secret,
                        beneficiary,
                        lockDuration
                    });
                } else {
                    const secretHash = this.hashUtility.sha256(secret);
                    safe = await this.suiManager.createSafeSha256({
                        coinType: token,
                        amount,
                        secretHash,
                        beneficiary,
                        lockDuration
                    });
                }
            } else {
                throw new Error(`Unsupported chain: ${chain}`);
            }

            logger.info('Single-chain safe created:', { chain, safe });
            return safe;

        } catch (error) {
            logger.error('Failed to create single-chain safe:', error);
            throw error;
        }
    }

    /**
     * Withdraw from a safe by revealing the secret
     */
    async withdrawFromSafe(chain, safeId, secret) {
        this._checkInitialized();

        try {
            let result;

            if (chain === 'ethereum') {
                result = await this.ethereumManager.withdraw(safeId, secret);
            } else if (chain === 'sui') {
                result = await this.suiManager.withdraw(safeId, secret);
            } else {
                throw new Error(`Unsupported chain: ${chain}`);
            }

            logger.info('Safe withdrawal successful:', { chain, safeId });
            return result;

        } catch (error) {
            logger.error('Failed to withdraw from safe:', error);
            throw error;
        }
    }

    /**
     * Refund a safe after timeout
     */
    async refundSafe(chain, safeId) {
        this._checkInitialized();

        try {
            let result;

            if (chain === 'ethereum') {
                result = await this.ethereumManager.refund(safeId);
            } else if (chain === 'sui') {
                result = await this.suiManager.refund(safeId);
            } else {
                throw new Error(`Unsupported chain: ${chain}`);
            }

            logger.info('Safe refund successful:', { chain, safeId });
            return result;

        } catch (error) {
            logger.error('Failed to refund safe:', error);
            throw error;
        }
    }

    /**
     * Get safe information
     */
    async getSafeInfo(chain, safeId) {
        this._checkInitialized();

        try {
            if (chain === 'ethereum') {
                return await this.ethereumManager.getSafeInfo(safeId);
            } else if (chain === 'sui') {
                return await this.suiManager.getSafeInfo(safeId);
            } else {
                throw new Error(`Unsupported chain: ${chain}`);
            }
        } catch (error) {
            logger.error('Failed to get safe info:', error);
            throw error;
        }
    }

    /**
     * Find safes by hash
     */
    async findSafesByHash(chain, hash) {
        this._checkInitialized();

        try {
            if (chain === 'ethereum') {
                return await this.ethereumManager.getSafesByHash(hash);
            } else if (chain === 'sui') {
                return await this.suiManager.getSafeByHash(hash);
            } else {
                throw new Error(`Unsupported chain: ${chain}`);
            }
        } catch (error) {
            logger.error('Failed to find safes by hash:', error);
            throw error;
        }
    }

    /**
     * Get all active safes
     */
    async getActiveSafes(chain) {
        this._checkInitialized();

        try {
            if (chain === 'ethereum') {
                return await this.ethereumManager.getActiveSafes();
            } else if (chain === 'sui') {
                return await this.suiManager.getActiveSafes();
            } else {
                throw new Error(`Unsupported chain: ${chain}`);
            }
        } catch (error) {
            logger.error('Failed to get active safes:', error);
            throw error;
        }
    }

    // Event listeners for relayer
    onEthereumSafeWithdrawn(callback) {
        if (this.ethereumManager) {
            this.ethereumManager.onSafeWithdrawn(callback);
        }
    }

    onSuiSafeWithdrawn(callback) {
        if (this.suiManager) {
            this.suiManager.onSafeWithdrawn(callback);
        }
    }

    _checkInitialized() {
        if (!this.isInitialized) {
            throw new Error('CrossChainEscrowManager not initialized. Call initialize() first.');
        }
    }

    async shutdown() {
        try {
            if (this.ethereumManager) {
                await this.ethereumManager.shutdown();
            }
            if (this.suiManager) {
                await this.suiManager.shutdown();
            }
            logger.info('CrossChainEscrowManager shut down successfully');
        } catch (error) {
            logger.error('Error during shutdown:', error);
        }
    }
}