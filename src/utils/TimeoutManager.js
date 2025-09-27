export class TimeoutManager {
    constructor(network = 'testnet') {
        this.network = network;
        this.config = this._getTimeoutConfig(network);
    }

    /**
     * Get timeout configuration based on network
     */
    _getTimeoutConfig(network) {
        const configs = {
            mainnet: {
                sourceTimeout: 3 * 60 * 60 * 1000,    // 3 hours
                destTimeout: 30 * 60 * 1000,          // 30 minutes
                safetyMargin: 30 * 60 * 1000,         // 30 minutes
                minTimeout: 10 * 60 * 1000            // 10 minutes minimum
            },
            testnet: {
                sourceTimeout: 30 * 60 * 1000,        // 30 minutes
                destTimeout: 5 * 60 * 1000,           // 5 minutes
                safetyMargin: 5 * 60 * 1000,          // 5 minutes
                minTimeout: 2 * 60 * 1000             // 2 minutes minimum
            },
            devnet: {
                sourceTimeout: 10 * 60 * 1000,        // 10 minutes
                destTimeout: 2 * 60 * 1000,           // 2 minutes
                safetyMargin: 2 * 60 * 1000,          // 2 minutes
                minTimeout: 1 * 60 * 1000             // 1 minute minimum
            }
        };

        return configs[network] || configs.testnet;
    }

    /**
     * Get default source timeout
     */
    getDefaultSourceTimeout() {
        return this.config.sourceTimeout;
    }

    /**
     * Get default destination timeout
     */
    getDefaultDestTimeout() {
        return this.config.destTimeout;
    }

    /**
     * Get safety margin
     */
    getSafetyMargin() {
        return this.config.safetyMargin;
    }

    /**
     * Calculate optimal timeouts for cross-chain swap
     * @param {number} estimatedExecutionTime - Estimated time for the swap to execute
     */
    calculateOptimalTimeouts(estimatedExecutionTime = 0) {
        const baseDestTimeout = Math.max(
            this.config.destTimeout,
            estimatedExecutionTime + this.config.safetyMargin
        );

        const baseSourceTimeout = baseDestTimeout + this.config.safetyMargin;

        return {
            sourceTimeout: Math.max(baseSourceTimeout, this.config.minTimeout),
            destTimeout: Math.max(baseDestTimeout, this.config.minTimeout),
            safetyMargin: this.config.safetyMargin
        };
    }

    /**
     * Validate timeout configuration
     * @param {number} sourceTimeout - Source chain timeout in milliseconds
     * @param {number} destTimeout - Destination chain timeout in milliseconds
     */
    validateTimeouts(sourceTimeout, destTimeout) {
        // Check minimum timeouts
        if (sourceTimeout < this.config.minTimeout) {
            throw new Error(`Source timeout (${sourceTimeout}ms) is below minimum (${this.config.minTimeout}ms)`);
        }

        if (destTimeout < this.config.minTimeout) {
            throw new Error(`Destination timeout (${destTimeout}ms) is below minimum (${this.config.minTimeout}ms)`);
        }

        // Check safety margin
        const requiredSourceTimeout = destTimeout + this.config.safetyMargin;
        if (sourceTimeout <= requiredSourceTimeout) {
            throw new Error(
                `Source timeout (${sourceTimeout}ms) must be greater than destination timeout (${destTimeout}ms) + safety margin (${this.config.safetyMargin}ms) = ${requiredSourceTimeout}ms`
            );
        }

        return true;
    }

    /**
     * Check if a safe has expired
     * @param {number} startTime - Safe creation timestamp in milliseconds
     * @param {number} lockDuration - Lock duration in milliseconds
     */
    isSafeExpired(startTime, lockDuration) {
        const currentTime = Date.now();
        return currentTime > (startTime + lockDuration);
    }

    /**
     * Get remaining time for a safe
     * @param {number} startTime - Safe creation timestamp in milliseconds
     * @param {number} lockDuration - Lock duration in milliseconds
     */
    getRemainingTime(startTime, lockDuration) {
        const currentTime = Date.now();
        const expiryTime = startTime + lockDuration;
        
        if (currentTime >= expiryTime) {
            return 0;
        }
        
        return expiryTime - currentTime;
    }

    /**
     * Format time duration in human-readable format
     * @param {number} milliseconds - Duration in milliseconds
     */
    formatDuration(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) {
            return `${days}d ${hours % 24}h ${minutes % 60}m`;
        } else if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    /**
     * Create timeout warnings based on remaining time
     * @param {number} remainingTime - Remaining time in milliseconds
     */
    getTimeoutWarnings(remainingTime) {
        const warnings = [];
        const oneHour = 60 * 60 * 1000;
        const thirtyMinutes = 30 * 60 * 1000;
        const fiveMinutes = 5 * 60 * 1000;

        if (remainingTime <= 0) {
            warnings.push({ level: 'critical', message: 'Safe has expired' });
        } else if (remainingTime <= fiveMinutes) {
            warnings.push({ level: 'critical', message: `Safe expires in ${this.formatDuration(remainingTime)}` });
        } else if (remainingTime <= thirtyMinutes) {
            warnings.push({ level: 'warning', message: `Safe expires in ${this.formatDuration(remainingTime)}` });
        } else if (remainingTime <= oneHour) {
            warnings.push({ level: 'info', message: `Safe expires in ${this.formatDuration(remainingTime)}` });
        }

        return warnings;
    }

    /**
     * Get network-specific recommendations
     */
    getNetworkRecommendations() {
        const recommendations = {
            mainnet: [
                'Use longer timeouts to account for network congestion',
                'Consider gas price fluctuations when setting timeouts',
                'Monitor both chains for finality delays'
            ],
            testnet: [
                'Shorter timeouts are acceptable for testing',
                'Be aware of potential network instability',
                'Use for development and testing only'
            ],
            devnet: [
                'Very short timeouts for rapid development',
                'Network may be reset frequently',
                'Not suitable for production use'
            ]
        };

        return recommendations[this.network] || recommendations.testnet;
    }
}