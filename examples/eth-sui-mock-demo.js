#!/usr/bin/env node

import { HashUtility } from '../src/utils/HashUtility.js';
import { logger } from '../src/utils/logger.js';

/**
 * Simplified demo script showing cross-chain request and resolution flow
 * This runs in pure simulation mode without requiring blockchain connections
 */

async function runCrossChainMockDemo() {
    logger.info('🚀 Starting Cross-Chain ETH ↔ SUI Mock Demo');
    logger.info('📝 This demo simulates the complete cross-chain resolution flow');

    const hashUtility = new HashUtility();

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

    try {
        // Step 1: Generate shared secret
        logger.info('\n🔐 Generating shared secret for atomic swap...');
        const secret = hashUtility.generateRandomSecret();
        const secretHash = hashUtility.sha256(secret);
        logger.info(`Secret: ${secret.substring(0, 20)}...`);
        logger.info(`Secret hash: ${Buffer.from(secretHash).toString('hex').substring(0, 20)}...`);

        // Step 2: Demonstrate the cross-chain flow
        await demonstrateCrossChainFlow({
            scenario: demoScenario,
            secret,
            secretHash,
            hashUtility
        });

        logger.info('\n🎉 Cross-Chain Mock Demo Completed Successfully!');
        logger.info('\n💡 To run with real blockchain connections:');
        logger.info('   1. Set environment variables: ETH_RPC_URL, SUI_RPC_URL, ETH_PRIVATE_KEY, SUI_PRIVATE_KEY');
        logger.info('   2. Deploy contracts to testnet');
        logger.info('   3. Run: npm start');

    } catch (error) {
        logger.error('❌ Demo failed:', error.message);
    }
}

async function demonstrateCrossChainFlow({ scenario, secret, secretHash, hashUtility }) {
    const { requester, resolver } = scenario;

    logger.info('\n🔄 Starting Cross-Chain Swap:');
    logger.info(`   ${requester.name} (${requester.ethAddress.substring(0, 10)}...) wants ${requester.wants.token}`);
    logger.info(`   ${resolver.name} (${resolver.suiAddress.substring(0, 10)}...) will provide ${requester.wants.token}`);

    // Step 1: Requester creates Ethereum escrow
    logger.info('\n📝 Step 1: Requester creates Ethereum escrow...');
    await simulateDelay(500, 'Creating Ethereum transaction');
    
    const ethEscrowResult = {
        safeAddress: '0x' + Math.random().toString(16).substr(2, 40),
        transactionHash: '0x' + Math.random().toString(16).substr(2, 64),
        blockNumber: Math.floor(Math.random() * 1000000) + 18500000,
        gasUsed: '147832',
        timestamp: Date.now()
    };

    logger.info('✅ Ethereum escrow created successfully');
    logger.info(`   Safe Address: ${ethEscrowResult.safeAddress}`);
    logger.info(`   Transaction: ${ethEscrowResult.transactionHash}`);
    logger.info(`   Block: ${ethEscrowResult.blockNumber}`);
    logger.info(`   Amount: 1 ETH locked for ${resolver.name}`);

    // Step 2: Resolver detects request and creates Sui escrow
    logger.info('\n📝 Step 2: Resolver detects request and creates matching Sui escrow...');
    await simulateDelay(800, 'Monitoring Ethereum events');
    await simulateDelay(600, 'Creating Sui transaction');

    const suiEscrowResult = {
        safeId: '0x' + Math.random().toString(16).substr(2, 64),
        digest: '0x' + Math.random().toString(16).substr(2, 64),
        checkpoint: Math.floor(Math.random() * 500000) + 15000000,
        gasUsed: 1250000,
        timestamp: Date.now()
    };

    logger.info('✅ Sui escrow created successfully');
    logger.info(`   Safe ID: ${suiEscrowResult.safeId}`);
    logger.info(`   Transaction: ${suiEscrowResult.digest}`);
    logger.info(`   Checkpoint: ${suiEscrowResult.checkpoint}`);
    logger.info(`   Amount: 100 SUI locked for ${requester.name}`);

    // Step 3: Requester withdraws from Sui (reveals secret)
    logger.info('\n📝 Step 3: Requester withdraws SUI tokens...');
    await simulateDelay(1200, 'Requester submitting withdrawal transaction');
    
    // Verify secret before withdrawal
    const isValidSecret = hashUtility.verifySecretSha256(secret, secretHash);
    if (!isValidSecret) {
        throw new Error('Invalid secret - withdrawal would fail');
    }

    const suiWithdrawResult = {
        transactionHash: '0x' + Math.random().toString(16).substr(2, 64),
        revealedSecret: secret,
        amount: '100000000000',
        recipient: requester.suiAddress,
        timestamp: Date.now()
    };

    logger.info('✅ SUI withdrawal successful');
    logger.info(`   🔓 Secret revealed: ${secret.substring(0, 20)}...`);
    logger.info(`   💰 ${requester.name} received 100 SUI tokens`);
    logger.info('   📤 Secret now visible on Sui blockchain');

    // Step 4: Resolver monitors and detects secret
    logger.info('\n📝 Step 4: Resolver monitors Sui blockchain for secret reveal...');
    await simulateDelay(300, 'Scanning Sui transaction logs');
    await simulateDelay(200, 'Extracting secret from transaction data');
    
    logger.info('🔍 Resolver detected secret reveal!');
    logger.info(`📥 Extracted secret: ${secret.substring(0, 20)}...`);
    
    // Verify the extracted secret
    const extractedSecretValid = hashUtility.verifySecretSha256(secret, secretHash);
    logger.info(`✅ Secret verification: ${extractedSecretValid ? 'VALID' : 'INVALID'}`);

    // Step 5: Resolver uses secret to claim Ethereum escrow
    logger.info('\n📝 Step 5: Resolver claims Ethereum escrow using revealed secret...');
    await simulateDelay(1000, 'Resolver submitting Ethereum withdrawal');

    const ethWithdrawResult = {
        transactionHash: '0x' + Math.random().toString(16).substr(2, 64),
        amount: '1000000000000000000',
        recipient: resolver.ethAddress,
        gasUsed: '89432',
        timestamp: Date.now()
    };

    logger.info('✅ ETH withdrawal successful');
    logger.info(`   💰 ${resolver.name} received 1 ETH token`);
    logger.info('   🔐 Same secret used for both withdrawals');

    // Step 6: Show final state and verification
    logger.info('\n🏁 Final State Verification:');
    
    // Verify timing constraints
    const totalTime = Date.now() - ethEscrowResult.timestamp;
    const timeoutWindow = 30 * 60 * 1000; // 30 minutes
    const timeRemaining = timeoutWindow - totalTime;
    
    logger.info(`   ⏱️  Total execution time: ${Math.round(totalTime/1000)}s`);
    logger.info(`   ⏱️  Time remaining before timeout: ${Math.round(timeRemaining/1000/60)}min`);
    
    logger.info(`   ✅ ${requester.name}: Successfully received 100 SUI tokens`);
    logger.info(`   ✅ ${resolver.name}: Successfully received 1 ETH token`);
    logger.info('   ✅ Secret was properly revealed and used atomically');
    logger.info('   ✅ All operations completed within timeout windows');
    logger.info('   ✅ No funds were lost or stuck');

    // Show detailed transaction flow
    logger.info('\n📊 Transaction Flow Summary:');
    logger.info('┌─────────────────────────────────────────────────────────────────────┐');
    logger.info('│                     ATOMIC CROSS-CHAIN SWAP COMPLETED                 │');
    logger.info('├─────────────────────────────────────────────────────────────────────┤');
    logger.info(`│ 1. ${requester.name} locks 1 ETH on Ethereum → ${resolver.name}                     │`);
    logger.info(`│ 2. ${resolver.name} locks 100 SUI on Sui → ${requester.name}                        │`);
    logger.info(`│ 3. ${requester.name} reveals secret to claim 100 SUI                         │`);
    logger.info(`│ 4. ${resolver.name} uses same secret to claim 1 ETH                          │`);
    logger.info('├─────────────────────────────────────────────────────────────────────┤');
    logger.info('│ Networks: Ethereum ↔ Sui                                             │');
    logger.info('│ Method: Hash Time Locked Contracts (HTLC)                            │');
    logger.info('│ Security: SHA256 hash-based atomic reveals                           │');
    logger.info('│ Result: Trustless cross-chain asset exchange ✅                      │');
    logger.info('└─────────────────────────────────────────────────────────────────────┘');

    // Show what would happen in failure scenarios
    logger.info('\n🛡️  Security Features Demonstrated:');
    logger.info('   🔒 Hash-locked: Only correct secret can unlock funds');
    logger.info('   ⏰ Time-locked: Funds auto-refund after timeout');
    logger.info('   🔗 Cross-chain: Works across different blockchain networks');
    logger.info('   ⚛️  Atomic: Either both swaps succeed or both fail');
    logger.info('   🚫 Trustless: No third party can steal or block funds');
}

async function simulateDelay(ms, operation) {
    logger.info(`   ⏳ ${operation}...`);
    await new Promise(resolve => setTimeout(resolve, ms));
}

// Run the demo if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runCrossChainMockDemo().catch(console.error);
}

export { runCrossChainMockDemo };