import { CrossChainEscrowManager } from '../src/core/CrossChainEscrowManager.js';
import { HashUtility } from '../src/utils/HashUtility.js';
import { logger } from '../src/utils/logger.js';
import dotenv from 'dotenv';

dotenv.config();

async function crossChainSwapExample() {
    const hashUtility = new HashUtility();
    
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
        network: 'testnet'
    });

    try {
        await escrowManager.initialize();
        logger.info('Escrow manager initialized');

        // Example: Alice (ETH) ↔ Bob (SUI) Swap
        
        // Step 1: Generate a random secret
        const secret = hashUtility.generateRandomSecret();
        logger.info('Generated secret:', secret);

        // Step 2: Alice creates Ethereum safe, Bob creates Sui safe
        const swapParams = {
            secret: secret,
            sourceChain: 'ethereum',
            destChain: 'sui',
            sourceToken: '0x...', // USDC address on Ethereum
            destToken: '0x2::sui::SUI',
            sourceAmount: '100000000', // 100 USDC (6 decimals)
            destAmount: '100000000000', // 100 SUI (9 decimals)
            sourceOwner: '0xAliceAddress',
            destOwner: '0xBobAddress',
            sourceLockDuration: 30 * 60 * 1000, // 30 minutes
            destLockDuration: 5 * 60 * 1000 // 5 minutes
        };

        const crossChainSafe = await escrowManager.createCrossChainSafe(swapParams);
        logger.info('Cross-chain safe pair created:', crossChainSafe);

        // Step 3: Alice reveals secret to claim SUI
        // This would be done by Alice's client
        logger.info('Alice can now withdraw SUI by revealing the secret');
        
        // Step 4: Relayer automatically claims ETH for Bob
        // This happens automatically via the relayer service
        logger.info('Relayer will automatically withdraw ETH for Bob when Alice reveals the secret');

        // Example of manual withdrawal (if needed)
        // const withdrawResult = await escrowManager.withdrawFromSafe('sui', crossChainSafe.destSafe.id, secret);
        // logger.info('Manual withdrawal result:', withdrawResult);

    } catch (error) {
        logger.error('Cross-chain swap example failed:', error);
    } finally {
        await escrowManager.shutdown();
    }
}

async function singleChainSafeExample() {
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
        network: 'testnet'
    });

    try {
        await escrowManager.initialize();
        logger.info('Escrow manager initialized for single-chain example');

        // Create a single-chain safe on Ethereum
        const ethSafeParams = {
            chain: 'ethereum',
            secret: 'my-secret-password',
            token: '0x...', // USDT address
            amount: '50000000', // 50 USDT (6 decimals)
            beneficiary: '0xBeneficiaryAddress',
            lockDuration: 24 * 60 * 60 * 1000, // 24 hours
            useKeccak256: true // Gas efficient for single-chain
        };

        const ethSafe = await escrowManager.createSingleChainSafe(ethSafeParams);
        logger.info('Ethereum safe created:', ethSafe);

        // Create a single-chain safe on Sui
        const suiSafeParams = {
            chain: 'sui',
            secret: 'another-secret',
            token: '0x2::sui::SUI',
            amount: '50000000000', // 50 SUI (9 decimals)
            beneficiary: '0xSuiBeneficiaryAddress',
            lockDuration: 12 * 60 * 60 * 1000, // 12 hours
            useKeccak256: true
        };

        const suiSafe = await escrowManager.createSingleChainSafe(suiSafeParams);
        logger.info('Sui safe created:', suiSafe);

        // Get safe information
        const ethSafeInfo = await escrowManager.getSafeInfo('ethereum', ethSafe.address);
        logger.info('Ethereum safe info:', ethSafeInfo);

    } catch (error) {
        logger.error('Single-chain safe example failed:', error);
    } finally {
        await escrowManager.shutdown();
    }
}

// Run examples
async function runExamples() {
    logger.info('Running Cross-Chain Safe Escrow Examples');
    
    // Uncomment the example you want to run
    await crossChainSwapExample();
    // await singleChainSafeExample();
}

runExamples().catch(console.error);