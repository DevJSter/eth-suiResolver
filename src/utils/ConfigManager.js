export class ConfigManager {
    constructor() {
        this.config = this._loadConfig();
    }

    _loadConfig() {
        return {
            // Network configuration
            network: process.env.NETWORK || 'testnet',
            
            // Ethereum configuration
            ethereum: {
                rpcUrl: process.env.ETH_RPC_URL,
                privateKey: process.env.ETH_PRIVATE_KEY,
                safeRecordAddress: process.env.ETH_SAFE_RECORD_ADDRESS,
                hashUtilityAddress: process.env.ETH_HASH_UTILITY_ADDRESS,
                gasLimit: parseInt(process.env.ETH_GAS_LIMIT) || 200000,
                gasPrice: process.env.ETH_GAS_PRICE,
                maxFeePerGas: process.env.ETH_MAX_FEE_PER_GAS,
                maxPriorityFeePerGas: process.env.ETH_MAX_PRIORITY_FEE_PER_GAS
            },
            
            // Sui configuration
            sui: {
                rpcUrl: process.env.SUI_RPC_URL,
                privateKey: process.env.SUI_PRIVATE_KEY,
                packageId: process.env.SUI_PACKAGE_ID,
                registryId: process.env.SUI_REGISTRY_ID,
                gasBudget: parseInt(process.env.SUI_GAS_BUDGET) || 100000000
            },
            
            // Relayer configuration
            relayer: {
                enabled: process.env.RELAYER_ENABLED === 'true',
                interval: parseInt(process.env.RELAYER_INTERVAL) || 5000,
                retryAttempts: parseInt(process.env.RELAYER_RETRY_ATTEMPTS) || 3,
                retryDelay: parseInt(process.env.RELAYER_RETRY_DELAY) || 5000
            },
            
            // Timeout configuration
            timeouts: {
                mainnet: {
                    source: parseInt(process.env.MAINNET_SOURCE_TIMEOUT) || 10800000, // 3 hours
                    dest: parseInt(process.env.MAINNET_DEST_TIMEOUT) || 1800000, // 30 minutes
                },
                testnet: {
                    source: parseInt(process.env.TESTNET_SOURCE_TIMEOUT) || 1800000, // 30 minutes
                    dest: parseInt(process.env.TESTNET_DEST_TIMEOUT) || 300000, // 5 minutes
                }
            },
            
            // Monitoring configuration
            monitoring: {
                enabled: process.env.MONITORING_ENABLED === 'true',
                webhookUrl: process.env.WEBHOOK_URL,
                alertThreshold: parseInt(process.env.ALERT_THRESHOLD) || 1000000
            },
            
            // Logging configuration
            logging: {
                level: process.env.LOG_LEVEL || 'info',
                toFile: process.env.LOG_TO_FILE === 'true',
                directory: process.env.LOG_DIR || './logs'
            }
        };
    }

    // Getters for easy access
    getEthereumConfig() {
        return this.config.ethereum;
    }

    getSuiConfig() {
        return this.config.sui;
    }

    getRelayerConfig() {
        return this.config.relayer;
    }

    getTimeoutConfig(network = null) {
        const targetNetwork = network || this.config.network;
        return this.config.timeouts[targetNetwork] || this.config.timeouts.testnet;
    }

    getMonitoringConfig() {
        return this.config.monitoring;
    }

    getLoggingConfig() {
        return this.config.logging;
    }

    // Validation methods
    validateEthereumConfig() {
        const eth = this.config.ethereum;
        const required = ['rpcUrl', 'privateKey', 'safeRecordAddress'];
        
        for (const field of required) {
            if (!eth[field]) {
                throw new Error(`Missing required Ethereum config: ${field}`);
            }
        }
        
        return true;
    }

    validateSuiConfig() {
        const sui = this.config.sui;
        const required = ['rpcUrl', 'privateKey', 'packageId', 'registryId'];
        
        for (const field of required) {
            if (!sui[field]) {
                throw new Error(`Missing required Sui config: ${field}`);
            }
        }
        
        return true;
    }

    validateConfig() {
        try {
            this.validateEthereumConfig();
            this.validateSuiConfig();
            return { valid: true };
        } catch (error) {
            return { valid: false, error: error.message };
        }
    }

    // Environment-specific configurations
    isProduction() {
        return this.config.network === 'mainnet';
    }

    isDevelopment() {
        return this.config.network === 'devnet';
    }

    isTestnet() {
        return this.config.network === 'testnet';
    }

    // Update configuration at runtime
    updateConfig(updates) {
        this.config = { ...this.config, ...updates };
    }

    // Get all configuration
    getFullConfig() {
        return { ...this.config };
    }
}

// Singleton instance
export const configManager = new ConfigManager();