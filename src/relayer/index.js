import { RelayerService } from './RelayerService.js';
import { CrossChainEscrowManager } from '../core/CrossChainEscrowManager.js';
import { logger } from '../utils/logger.js';
import dotenv from 'dotenv';

dotenv.config();

async function startRelayer() {
    try {
        logger.info('Starting standalone relayer service...');

        console.log(`ETH RPC URL: ${process.env.ETH_RPC_URL}`);
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
        logger.info('Escrow manager initialized for relayer');

        // Start the relayer service
        const relayer = new RelayerService(escrowManager);
        await relayer.start();

        logger.info('Relayer service is now running...');

        // Graceful shutdown
        process.on('SIGINT', async () => {
            logger.info('Shutting down relayer service...');
            await relayer.stop();
            await escrowManager.shutdown();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            logger.info('Shutting down relayer service...');
            await relayer.stop();
            await escrowManager.shutdown();
            process.exit(0);
        });

        // Keep the process alive
        setInterval(() => {
            const stats = relayer.getStatistics();
            logger.debug('Relayer statistics:', stats);
        }, 60000); // Log stats every minute

    } catch (error) {
        logger.error('Failed to start relayer service:', error);
        process.exit(1);
    }
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    startRelayer();
}