import { logger } from '../utils/logger.js';
import { HashUtility } from '../utils/HashUtility.js';

export class RelayerService {
    constructor(escrowManager) {
        this.escrowManager = escrowManager;
        this.hashUtility = new HashUtility();
        this.isRunning = false;
        this.retryAttempts = parseInt(process.env.RELAYER_RETRY_ATTEMPTS) || 3;
        this.retryDelay = 5000; // 5 seconds
    }

    async start() {
        if (this.isRunning) {
            logger.warn('Relayer service is already running');
            return;
        }

        try {
            this.isRunning = true;
            
            // Set up event listeners
            this._setupEthereumEventListeners();
            this._setupSuiEventListeners();
            
            logger.info('Relayer service started successfully');
        } catch (error) {
            logger.error('Failed to start relayer service:', error);
            this.isRunning = false;
            throw error;
        }
    }

    async stop() {
        this.isRunning = false;
        logger.info('Relayer service stopped');
    }

    /**
     * Set up Ethereum event listeners
     */
    _setupEthereumEventListeners() {
        this.escrowManager.onEthereumSafeWithdrawn(async (event) => {
            if (!this.isRunning) return;

            logger.info('Ethereum SafeWithdrawn event detected:', {
                safeAddress: event.safeAddress,
                secret: event.secret,
                txHash: event.txHash
            });

            try {
                // Find corresponding Sui safe with the same hash
                const secretHash = this.hashUtility.sha256(event.secret);
                const suiSafeId = await this.escrowManager.findSafesByHash('sui', secretHash);

                if (suiSafeId) {
                    await this._withdrawFromSuiSafeWithRetry(suiSafeId, event.secret);
                } else {
                    logger.info('No corresponding Sui safe found for hash:', secretHash.toString('hex'));
                }

            } catch (error) {
                logger.error('Error processing Ethereum SafeWithdrawn event:', error);
            }
        });
    }

    /**
     * Set up Sui event listeners
     */
    _setupSuiEventListeners() {
        this.escrowManager.onSuiSafeWithdrawn(async (event) => {
            if (!this.isRunning) return;

            logger.info('Sui SafeWithdrawn event detected:', {
                safeId: event.safeId,
                secret: event.secret,
                digest: event.digest
            });

            try {
                // Find corresponding Ethereum safes with the same hash
                const secretHash = this.hashUtility.sha256(event.secret);
                const ethSafes = await this.escrowManager.findSafesByHash('ethereum', secretHash);

                if (ethSafes && ethSafes.length > 0) {
                    for (const ethSafeAddress of ethSafes) {
                        await this._withdrawFromEthereumSafeWithRetry(ethSafeAddress, event.secret);
                    }
                } else {
                    logger.info('No corresponding Ethereum safes found for hash:', secretHash.toString('hex'));
                }

            } catch (error) {
                logger.error('Error processing Sui SafeWithdrawn event:', error);
            }
        });
    }

    /**
     * Withdraw from Ethereum safe with retry logic
     */
    async _withdrawFromEthereumSafeWithRetry(safeAddress, secret) {
        for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
            try {
                logger.info(`Attempting to withdraw from Ethereum safe (attempt ${attempt}/${this.retryAttempts}):`, safeAddress);
                
                await this.escrowManager.withdrawFromSafe('ethereum', safeAddress, secret);
                
                logger.info('Successfully withdrew from Ethereum safe:', safeAddress);
                return;

            } catch (error) {
                logger.error(`Failed to withdraw from Ethereum safe (attempt ${attempt}/${this.retryAttempts}):`, error);
                
                if (attempt < this.retryAttempts) {
                    await this._delay(this.retryDelay * attempt); // Exponential backoff
                } else {
                    logger.error('Max retry attempts reached for Ethereum safe withdrawal:', safeAddress);
                }
            }
        }
    }

    /**
     * Withdraw from Sui safe with retry logic
     */
    async _withdrawFromSuiSafeWithRetry(safeId, secret) {
        for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
            try {
                logger.info(`Attempting to withdraw from Sui safe (attempt ${attempt}/${this.retryAttempts}):`, safeId);
                
                await this.escrowManager.withdrawFromSafe('sui', safeId, secret);
                
                logger.info('Successfully withdrew from Sui safe:', safeId);
                return;

            } catch (error) {
                logger.error(`Failed to withdraw from Sui safe (attempt ${attempt}/${this.retryAttempts}):`, error);
                
                if (attempt < this.retryAttempts) {
                    await this._delay(this.retryDelay * attempt); // Exponential backoff
                } else {
                    logger.error('Max retry attempts reached for Sui safe withdrawal:', safeId);
                }
            }
        }
    }

    /**
     * Delay utility function
     */
    _delay(milliseconds) {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    }

    /**
     * Check if a safe is available for withdrawal
     */
    async _isSafeAvailable(chain, safeId) {
        try {
            const safeInfo = await this.escrowManager.getSafeInfo(chain, safeId);
            return !safeInfo.isWithdrawn && !safeInfo.isRefunded;
        } catch (error) {
            logger.error('Error checking safe availability:', error);
            return false;
        }
    }

    /**
     * Monitor and report relayer statistics
     */
    getStatistics() {
        return {
            isRunning: this.isRunning,
            retryAttempts: this.retryAttempts,
            retryDelay: this.retryDelay
        };
    }
}