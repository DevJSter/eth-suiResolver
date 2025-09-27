import dotenv from 'dotenv';
import { CrossChainEscrowManager } from './core/CrossChainEscrowManager.js';
import { RelayerService } from './relayer/RelayerService.js';
import { logger } from './utils/logger.js';

dotenv.config();

async function main() {
    try {
        logger.info('Starting Cross-Chain Safe Escrow System');
        
        // Initialize the escrow manager
        const escrowManager = new CrossChainEscrowManager({
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
            network: process.env.NETWORK || 'testnet'
        });

        await escrowManager.initialize();
        logger.info('Escrow manager initialized successfully');

        // Start relayer if enabled
        if (process.env.RELAYER_ENABLED === 'true') {
            const relayer = new RelayerService(escrowManager);
            await relayer.start();
            logger.info('Relayer service started');
        }

        // Keep the process running
        process.on('SIGINT', async () => {
            logger.info('Shutting down gracefully...');
            await escrowManager.shutdown();
            process.exit(0);
        });

    } catch (error) {
        logger.error('Failed to start application:', error);
        process.exit(1);
    }
}

main();