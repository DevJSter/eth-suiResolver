import { SuiClient, getFullnodeUrl } from '@mysten/sui.js/client';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { fromB64 } from '@mysten/sui.js/utils';
import { logger } from '../utils/logger.js';

export class SuiSafeManager {
    constructor(config) {
        this.config = config;
        this.client = null;
        this.signer = null;
        this.isInitialized = false;
    }

    async initialize() {
        try {
            // Initialize client
            this.client = new SuiClient({ 
                url: this.config.rpcUrl || getFullnodeUrl('devnet') 
            });
            
            // Initialize signer from private key
            const privateKeyBytes = fromB64(this.config.privateKey);
            this.signer = Ed25519Keypair.fromSecretKey(privateKeyBytes);
            
            // Test connection
            await this.client.getLatestSuiSystemState();
            
            this.isInitialized = true;
            logger.info('SuiSafeManager initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize SuiSafeManager:', error);
            throw error;
        }
    }

    /**
     * Create a safe with keccak256 hash (single-chain)
     */
    async createSafe({ coinType, amount, secret, beneficiary, lockDuration }) {
        this._checkInitialized();

        try {
            const txb = new TransactionBlock();
            
            // Split coins for the safe
            const coin = txb.splitCoins(txb.gas, [txb.pure(amount)]);
            
            // Create and register safe
            txb.moveCall({
                target: `${this.config.packageId}::safe_record::create_and_register_safe`,
                typeArguments: [coinType],
                arguments: [
                    txb.object(this.config.registryId),
                    coin,
                    txb.pure(beneficiary),
                    txb.pure(secret),
                    txb.pure(lockDuration)
                ]
            });

            const result = await this.client.signAndExecuteTransactionBlock({
                signer: this.signer,
                transactionBlock: txb,
                options: {
                    showEffects: true,
                    showEvents: true,
                    showObjectChanges: true
                }
            });

            const safeOwnerCap = this._extractOwnerCapFromResult(result);
            const safeId = this._extractSafeIdFromEvents(result);

            logger.info('Sui safe created (keccak256):', { safeId, digest: result.digest });

            return {
                id: safeId,
                ownerCap: safeOwnerCap,
                digest: result.digest,
                useSha256: false
            };

        } catch (error) {
            logger.error('Failed to create Sui safe (keccak256):', error);
            throw error;
        }
    }

    /**
     * Create a safe with sha256 hash (cross-chain compatible)
     */
    async createSafeSha256({ coinType, amount, secretHash, beneficiary, lockDuration }) {
        this._checkInitialized();

        try {
            const txb = new TransactionBlock();
            
            // Split coins for the safe
            const coin = txb.splitCoins(txb.gas, [txb.pure(amount)]);
            
            // Create safe with pre-computed hash
            txb.moveCall({
                target: `${this.config.packageId}::safe_escrow::create_safe_sha256`,
                typeArguments: [coinType],
                arguments: [
                    coin,
                    txb.pure(beneficiary),
                    txb.pure(Array.from(secretHash)),
                    txb.pure(lockDuration),
                    txb.object('0x6') // Clock object
                ]
            });

            // Register in registry (create metadata)
            txb.moveCall({
                target: `${this.config.packageId}::safe_record::create_and_register_safe_with_hash`,
                typeArguments: [coinType],
                arguments: [
                    txb.object(this.config.registryId),
                    coin,
                    txb.pure(beneficiary),
                    txb.pure(Array.from(secretHash)),
                    txb.pure(lockDuration),
                    txb.pure(true), // use_sha256
                    txb.object('0x6') // Clock object
                ]
            });

            const result = await this.client.signAndExecuteTransactionBlock({
                signer: this.signer,
                transactionBlock: txb,
                options: {
                    showEffects: true,
                    showEvents: true,
                    showObjectChanges: true
                }
            });

            const safeOwnerCap = this._extractOwnerCapFromResult(result);
            const safeId = this._extractSafeIdFromEvents(result);

            logger.info('Sui safe created (sha256):', { safeId, digest: result.digest });

            return {
                id: safeId,
                ownerCap: safeOwnerCap,
                digest: result.digest,
                useSha256: true
            };

        } catch (error) {
            logger.error('Failed to create Sui safe (sha256):', error);
            throw error;
        }
    }

    /**
     * Withdraw from a safe by revealing the secret
     */
    async withdraw(safeId, secret) {
        this._checkInitialized();

        try {
            const txb = new TransactionBlock();
            
            const withdrawnCoin = txb.moveCall({
                target: `${this.config.packageId}::safe_escrow::withdraw`,
                typeArguments: ['0x2::sui::SUI'], // Assuming SUI coin
                arguments: [
                    txb.object(safeId),
                    txb.pure(secret)
                ]
            });

            // Transfer the withdrawn coin to the signer
            txb.transferObjects([withdrawnCoin], txb.pure(this.signer.getPublicKey().toSuiAddress()));

            const result = await this.client.signAndExecuteTransactionBlock({
                signer: this.signer,
                transactionBlock: txb,
                options: {
                    showEffects: true,
                    showEvents: true
                }
            });

            logger.info('Sui safe withdrawal successful:', { safeId, digest: result.digest });

            return {
                digest: result.digest,
                secret
            };

        } catch (error) {
            logger.error('Failed to withdraw from Sui safe:', error);
            throw error;
        }
    }

    /**
     * Refund a safe after timeout
     */
    async refund(safeId, ownerCapId) {
        this._checkInitialized();

        try {
            const txb = new TransactionBlock();
            
            const refundedCoin = txb.moveCall({
                target: `${this.config.packageId}::safe_escrow::refund`,
                typeArguments: ['0x2::sui::SUI'], // Assuming SUI coin
                arguments: [
                    txb.object(safeId),
                    txb.object(ownerCapId),
                    txb.object('0x6') // Clock object
                ]
            });

            // Transfer the refunded coin to the signer
            txb.transferObjects([refundedCoin], txb.pure(this.signer.getPublicKey().toSuiAddress()));

            const result = await this.client.signAndExecuteTransactionBlock({
                signer: this.signer,
                transactionBlock: txb,
                options: {
                    showEffects: true,
                    showEvents: true
                }
            });

            logger.info('Sui safe refund successful:', { safeId, digest: result.digest });

            return {
                digest: result.digest
            };

        } catch (error) {
            logger.error('Failed to refund Sui safe:', error);
            throw error;
        }
    }

    /**
     * Get safe information
     */
    async getSafeInfo(safeId) {
        this._checkInitialized();

        try {
            const safeObject = await this.client.getObject({
                id: safeId,
                options: { showContent: true }
            });

            if (!safeObject.data || !safeObject.data.content) {
                throw new Error('Safe not found or has no content');
            }

            const fields = safeObject.data.content.fields;

            return {
                owner: fields.owner,
                beneficiary: fields.beneficiary,
                amount: fields.locked_coin.fields.balance,
                secretHash: fields.secret_hash,
                startTime: Number(fields.start_time),
                lockDuration: Number(fields.lock_duration),
                isWithdrawn: fields.is_withdrawn,
                isRefunded: fields.is_refunded,
                useSha256: fields.use_sha256
            };

        } catch (error) {
            logger.error('Failed to get Sui safe info:', error);
            throw error;
        }
    }

    /**
     * Get safe by hash from registry
     */
    async getSafeByHash(_hash) {
        this._checkInitialized();

        try {
            // This would require calling a view function on the registry
            // For now, we'll return null as a placeholder
            logger.warn('getSafeByHash not fully implemented for Sui');
            return null;
        } catch (error) {
            logger.error('Failed to get Sui safe by hash:', error);
            throw error;
        }
    }

    /**
     * Get all active safes
     */
    async getActiveSafes() {
        this._checkInitialized();

        try {
            // This would require calling a view function on the registry
            // For now, we'll return empty array as a placeholder
            logger.warn('getActiveSafes not fully implemented for Sui');
            return [];
        } catch (error) {
            logger.error('Failed to get active Sui safes:', error);
            throw error;
        }
    }

    /**
     * Listen for SafeWithdrawn events
     */
    onSafeWithdrawn(callback) {
        if (!this.client) return;

        // Subscribe to SafeWithdrawn events
        const eventFilter = {
            Package: this.config.packageId,
            Module: 'safe_escrow',
            EventType: 'SafeWithdrawn'
        };

        this.client.subscribeEvent({
            filter: eventFilter,
            onMessage: (event) => {
                try {
                    const parsedEvent = {
                        safeId: event.parsedJson.safe_id,
                        withdrawer: event.parsedJson.withdrawer,
                        beneficiary: event.parsedJson.beneficiary,
                        amount: event.parsedJson.amount,
                        secret: event.parsedJson.secret,
                        digest: event.id.txDigest,
                        timestampMs: event.timestampMs
                    };

                    callback(parsedEvent);
                } catch (error) {
                    logger.error('Error parsing SafeWithdrawn event:', error);
                }
            }
        });
    }

    /**
     * Extract owner capability from transaction result
     */
    _extractOwnerCapFromResult(result) {
        const ownerCap = result.objectChanges?.find(change => 
            change.type === 'created' && 
            change.objectType.includes('SafeOwnerCap')
        );
        return ownerCap?.objectId || null;
    }

    /**
     * Extract safe ID from events
     */
    _extractSafeIdFromEvents(result) {
        const safeCreatedEvent = result.events?.find(event => 
            event.type.includes('SafeCreated')
        );
        return safeCreatedEvent?.parsedJson?.safe_id || null;
    }

    _checkInitialized() {
        if (!this.isInitialized) {
            throw new Error('SuiSafeManager not initialized');
        }
    }

    async shutdown() {
        // Close any active subscriptions
        logger.info('SuiSafeManager shut down');
    }
}