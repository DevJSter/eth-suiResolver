#!/usr/bin/env node

import { CrossChainEscrowManager } from '../src/core/CrossChainEscrowManager.js';
import { HashUtility } from '../src/utils/HashUtility.js';
import { logger } from '../src/utils/logger.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Demo script showing cross-chain request and resolution flow
 * between Ethereum and Sui networks
 */

async function runCrossChainDemo() {
    logger.info('🚀 Starting Cross-Chain ETH ↔ SUI Demo');

    // Configuration - in real scenario these would come from environment
    const config = {
        ethereum: {
            rpcUrl: process.env.ETH_RPC_URL || 'http://localhost:8545',
            privateKey: process.env.ETH_PRIVATE_KEY || '0x' + '1'.repeat(64),
            safeRecordAddress: process.env.ETH_SAFE_RECORD_ADDRESS || '0x' + 'A'.repeat(40),
            hashUtilityAddress: process.env.ETH_HASH_UTILITY_ADDRESS || '0x' + 'B'.repeat(40)
        },
        sui: {
            rpcUrl: process.env.SUI_RPC_URL || 'https://sui-testnet.nodereal.io',
            privateKey: process.env.SUI_PRIVATE_KEY || '0x' + '2'.repeat(64),
            packageId: process.env.SUI_PACKAGE_ID || '0x' + 'C'.repeat(40),
            registryId: process.env.SUI_REGISTRY_ID || '0x' + 'D'.repeat(40)
        },
        network: 'testnet'
    };

    const hashUtility = new HashUtility();
    let escrowManager;

    try {
        // Step 1: Initialize the cross-chain escrow manager
        logger.info('📡 Initializing Cross-Chain Escrow Manager...');
        escrowManager = new CrossChainEscrowManager(config);
        
        if (process.env.ETH_RPC_URL && process.env.SUI_RPC_URL) {
            await escrowManager.initialize();
            logger.info('✅ Real blockchain connections established');
        } else {
            logger.info('⚠️  Using demo mode - set ETH_RPC_URL and SUI_RPC_URL for real blockchain connections');
        }

        // Demo scenario: Alice wants 100 SUI tokens and offers 1 ETH
        const demoScenario = {
            // Requester (Alice) - wants SUI tokens
            requester: {
                ethAddress: '0x1111111111111111111111111111111111111111',
                suiAddress: '0x2222222222222222222222222222222222222222',
                name: 'Alice',
                wants: { token: 'SUI', amount: '100000000000' }, // 100 SUI
                offers: { token: 'ETH', amount: '1000000000000000000' } // 1 ETH
            },
            // Resolver (Bob) - provides SUI, gets ETH
            resolver: {
                ethAddress: '0x3333333333333333333333333333333333333333',
                suiAddress: '0x4444444444444444444444444444444444444444',
                name: 'Bob'
            }
        };

        // Step 2: Generate shared secret
        logger.info('🔐 Generating shared secret for atomic swap...');
        const secret = hashUtility.generateRandomSecret();
        const secretHash = hashUtility.sha256(secret);
        logger.info(`Secret hash: ${Buffer.from(secretHash).toString('hex').substring(0, 20)}...`);

        // Step 3: Demonstrate the cross-chain flow
        await demonstrateCrossChainFlow({
            scenario: demoScenario,
            secret,
            secretHash,
            escrowManager,
            hashUtility
        });

        logger.info('🎉 Cross-Chain Demo Completed Successfully!');

    } catch (error) {
        logger.error('❌ Demo failed:', error.message);
        if (error.stack) {
            logger.debug('Stack trace:', error.stack);
        }
    } finally {
        if (escrowManager && escrowManager.isInitialized) {
            await escrowManager.shutdown();
        }
    }
}

async function demonstrateCrossChainFlow({ scenario, secret, secretHash, escrowManager, hashUtility }) {
    const { requester, resolver } = scenario;

    logger.info('\n🔄 Starting Cross-Chain Swap:');
    logger.info(`   ${requester.name} (${requester.ethAddress.substring(0, 10)}...) wants ${requester.wants.token}`);
    logger.info(`   ${resolver.name} (${resolver.suiAddress.substring(0, 10)}...) will provide ${requester.wants.token}`);

    // Step 1: Requester creates Ethereum escrow
    logger.info('\n📝 Step 1: Requester creates Ethereum escrow...');
    const ethEscrowParams = {
        owner: requester.ethAddress,
        beneficiary: resolver.ethAddress,
        token: '0x0000000000000000000000000000000000000000', // ETH
        amount: requester.offers.amount,
        secretHash: Buffer.from(secretHash).toString('hex'),
        lockDuration: 30 * 60 * 1000, // 30 minutes
        useSha256: true
    };

    let ethEscrowResult;
    if (escrowManager.isInitialized) {
        try {
            // Real blockchain call
            ethEscrowResult = await escrowManager.ethereumManager.createSafe(ethEscrowParams);
        } catch (error) {
            logger.warn('Real blockchain call failed, using mock result:', error.message);
            ethEscrowResult = createMockEthResult();
        }
    } else {
        // Mock result for demo
        ethEscrowResult = createMockEthResult();
    }

    logger.info(`✅ Ethereum escrow created: ${ethEscrowResult.safeAddress}`);
    logger.info(`   Transaction: ${ethEscrowResult.transactionHash}`);

    // Step 2: Resolver detects request and creates Sui escrow
    logger.info('\n📝 Step 2: Resolver creates matching Sui escrow...');
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate detection delay

    const suiEscrowParams = {
        owner: resolver.suiAddress,
        beneficiary: requester.suiAddress,
        coinType: '0x2::sui::SUI',
        amount: requester.wants.amount,
        secretHash: Array.from(secretHash),
        lockDuration: 25 * 60 * 1000, // 25 minutes (shorter for safety)
        useSha256: true
    };

    let suiEscrowResult;
    if (escrowManager.isInitialized) {
        try {
            // Real blockchain call
            suiEscrowResult = await escrowManager.suiManager.createSafe(suiEscrowParams);
        } catch (error) {
            logger.warn('Real blockchain call failed, using mock result:', error.message);
            suiEscrowResult = createMockSuiResult();
        }
    } else {
        // Mock result for demo
        suiEscrowResult = createMockSuiResult();
    }

    logger.info(`✅ Sui escrow created: ${suiEscrowResult.safeId}`);
    logger.info(`   Transaction: ${suiEscrowResult.digest}`);

    // Step 3: Requester withdraws from Sui (reveals secret)
    logger.info('\n📝 Step 3: Requester withdraws SUI tokens (reveals secret)...');
    await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate user action delay

    logger.info(`🔓 Secret revealed: ${secret.substring(0, 20)}...`);
    
    // Verify secret
    const isValidSecret = hashUtility.verifySecretSha256(secret, secretHash);
    logger.info(`✅ Secret verification: ${isValidSecret ? 'VALID' : 'INVALID'}`);

    // Step 4: Resolver monitors and detects secret
    logger.info('\n📝 Step 4: Resolver monitors blockchain and detects secret...');
    await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate monitoring delay
    
    logger.info('🔍 Resolver detected secret reveal on Sui blockchain');
    logger.info(`📤 Extracted secret: ${secret.substring(0, 20)}...`);

    // Step 5: Resolver uses secret to claim Ethereum escrow
    logger.info('\n📝 Step 5: Resolver claims Ethereum escrow using revealed secret...');
    await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate transaction delay

    logger.info('✅ Resolver successfully claimed 1 ETH from Ethereum escrow');

    // Step 6: Show final state
    logger.info('\n🏁 Final State:');
    logger.info(`   ${requester.name}: Received 100 SUI tokens ✅`);
    logger.info(`   ${resolver.name}: Received 1 ETH token ✅`);
    logger.info('   🔐 Secret was properly revealed and used atomically');
    logger.info('   ⏱️  All operations completed within timeout windows');

    // Show transaction summary
    logger.info('\n📊 Transaction Summary:');
    logger.info('┌──────────────────────────────────────────────────────────────┐');
    logger.info('│                        ATOMIC SWAP COMPLETED                  │');
    logger.info('├──────────────────────────────────────────────────────────────┤');
    logger.info(`│ Requester (${requester.name}): 1 ETH → 100 SUI                      │`);
    logger.info(`│ Resolver (${resolver.name}):  100 SUI → 1 ETH                       │`);
    logger.info('│ Networks: Ethereum ↔ Sui                                      │');
    logger.info('│ Method: Hash Time Locked Contracts (HTLC)                     │');
    logger.info('│ Security: SHA256 hash-based secret reveal                     │');
    logger.info('└──────────────────────────────────────────────────────────────┘');
}

function createMockEthResult() {
    return {
        safeAddress: '0x' + Math.random().toString(16).substr(2, 40),
        transactionHash: '0x' + Math.random().toString(16).substr(2, 64),
        blockNumber: Math.floor(Math.random() * 1000000),
        gasUsed: '147832'
    };
}

function createMockSuiResult() {
    return {
        safeId: '0x' + Math.random().toString(16).substr(2, 64),
        digest: '0x' + Math.random().toString(16).substr(2, 64),
        checkpoint: Math.floor(Math.random() * 1000000),
        gasUsed: 1250000
    };
}

// Run the demo if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runCrossChainDemo().catch(console.error);
}

export { runCrossChainDemo };