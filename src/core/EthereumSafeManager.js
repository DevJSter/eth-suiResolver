import { ethers } from 'ethers';
import { logger } from '../utils/logger.js';

// ABI for SafeRecord contract
const SAFE_RECORD_ABI = [
    'function createSafe(address _token, uint256 _amount, string memory _secret, address _beneficiary, uint256 _lockDuration) public returns (address)',
    'function createSafeSha256(address _token, uint256 _amount, string memory _secret, address _beneficiary, uint256 _lockDuration) public returns (address)',
    'function createSafeWithHash(address _token, uint256 _amount, bytes32 _hash, address _beneficiary, uint256 _lockDuration, bool _useSha256) public returns (address)',
    'function getSafesByHash(bytes32 _hash) external view returns (address[] memory)',
    'function getSafeMetadata(address _safeAddress) external view returns (tuple(address,address,address,uint256,bytes32,uint256,uint256,bool,bool))',
    'function getActiveSafes() external view returns (address[] memory)',
    'function deactivateSafe(address _safeAddress) external',
    'event SafeRegistered(address indexed safeAddress, address indexed owner, address indexed beneficiary, uint256 amount, bytes32 secretHash, address registryAddress)'
];

// ABI for SafeEscrow contract
const SAFE_ESCROW_ABI = [
    'function withdraw(string memory _secret) external',
    'function refund() external',
    'function getSafeInfo() external view returns (address,address,uint256,bytes32,uint256,uint256,bool,bool,bool,string memory)',
    'function isLockExpired() external view returns (bool)',
    'function isSafeAvailable() external view returns (bool)',
    'function getTimeLeft() external view returns (uint256)',
    'event SafeWithdrawn(address indexed safeAddress, address indexed withdrawer, address indexed beneficiary, uint256 amount, string secret)',
    'event SafeRefunded(address indexed safeAddress, address indexed owner, uint256 amount)'
];

// ABI for ERC20 token
const ERC20_ABI = [
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function allowance(address owner, address spender) external view returns (uint256)',
    'function balanceOf(address account) external view returns (uint256)',
    'function transfer(address to, uint256 amount) external returns (bool)'
];

export class EthereumSafeManager {
    constructor(config) {
        this.config = config;
        this.provider = null;
        this.signer = null;
        this.safeRecordContract = null;
        this.isInitialized = false;
    }

    async initialize() {
        try {
            // Initialize provider
            this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
            
            // Initialize signer
            this.signer = new ethers.Wallet(this.config.privateKey, this.provider);
            
            // Initialize contracts
            this.safeRecordContract = new ethers.Contract(
                this.config.safeRecordAddress,
                SAFE_RECORD_ABI,
                this.signer
            );

            // Test connection
            await this.provider.getNetwork();
            
            this.isInitialized = true;
            logger.info('EthereumSafeManager initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize EthereumSafeManager:', error);
            throw error;
        }
    }

    /**
     * Create a safe with keccak256 hash (gas efficient for single-chain)
     */
    async createSafe({ token, amount, secret, beneficiary, lockDuration }) {
        this._checkInitialized();

        try {
            // Check and approve token if needed
            await this._ensureTokenApproval(token, amount);

            const tx = await this.safeRecordContract.createSafe(
                token,
                amount,
                secret,
                beneficiary,
                lockDuration
            );

            const receipt = await tx.wait();
            const safeAddress = this._extractSafeAddressFromReceipt(receipt);

            logger.info('Ethereum safe created (keccak256):', { safeAddress, tx: tx.hash });

            return {
                address: safeAddress,
                txHash: tx.hash,
                blockNumber: receipt.blockNumber,
                useSha256: false
            };

        } catch (error) {
            logger.error('Failed to create Ethereum safe (keccak256):', error);
            throw error;
        }
    }

    /**
     * Create a safe with sha256 hash (cross-chain compatible)
     */
    async createSafeSha256({ token, amount, secretHash, beneficiary, lockDuration }) {
        this._checkInitialized();

        try {
            // Check and approve token if needed
            await this._ensureTokenApproval(token, amount);

            const tx = await this.safeRecordContract.createSafeWithHash(
                token,
                amount,
                secretHash,
                beneficiary,
                lockDuration,
                true // useSha256 = true
            );

            const receipt = await tx.wait();
            const safeAddress = this._extractSafeAddressFromReceipt(receipt);

            logger.info('Ethereum safe created (sha256):', { safeAddress, tx: tx.hash });

            return {
                address: safeAddress,
                txHash: tx.hash,
                blockNumber: receipt.blockNumber,
                useSha256: true
            };

        } catch (error) {
            logger.error('Failed to create Ethereum safe (sha256):', error);
            throw error;
        }
    }

    /**
     * Withdraw from a safe by revealing the secret
     */
    async withdraw(safeAddress, secret) {
        this._checkInitialized();

        try {
            const safeContract = new ethers.Contract(safeAddress, SAFE_ESCROW_ABI, this.signer);
            
            const tx = await safeContract.withdraw(secret);
            const receipt = await tx.wait();

            logger.info('Ethereum safe withdrawal successful:', { safeAddress, tx: tx.hash });

            return {
                txHash: tx.hash,
                blockNumber: receipt.blockNumber,
                secret
            };

        } catch (error) {
            logger.error('Failed to withdraw from Ethereum safe:', error);
            throw error;
        }
    }

    /**
     * Refund a safe after timeout
     */
    async refund(safeAddress) {
        this._checkInitialized();

        try {
            const safeContract = new ethers.Contract(safeAddress, SAFE_ESCROW_ABI, this.signer);
            
            const tx = await safeContract.refund();
            const receipt = await tx.wait();

            logger.info('Ethereum safe refund successful:', { safeAddress, tx: tx.hash });

            return {
                txHash: tx.hash,
                blockNumber: receipt.blockNumber
            };

        } catch (error) {
            logger.error('Failed to refund Ethereum safe:', error);
            throw error;
        }
    }

    /**
     * Get safe information
     */
    async getSafeInfo(safeAddress) {
        this._checkInitialized();

        try {
            const safeContract = new ethers.Contract(safeAddress, SAFE_ESCROW_ABI, this.provider);
            const info = await safeContract.getSafeInfo();

            return {
                owner: info[0],
                beneficiary: info[1],
                amount: info[2].toString(),
                secretHash: info[3],
                startTime: Number(info[4]),
                lockDuration: Number(info[5]),
                isWithdrawn: info[6],
                isRefunded: info[7],
                useSha256: info[8],
                revealedSecret: info[9]
            };

        } catch (error) {
            logger.error('Failed to get Ethereum safe info:', error);
            throw error;
        }
    }

    /**
     * Get safes by hash
     */
    async getSafesByHash(hash) {
        this._checkInitialized();

        try {
            const hashBytes = typeof hash === 'string' ? hash : ethers.hexlify(hash);
            return await this.safeRecordContract.getSafesByHash(hashBytes);
        } catch (error) {
            logger.error('Failed to get Ethereum safes by hash:', error);
            throw error;
        }
    }

    /**
     * Get all active safes
     */
    async getActiveSafes() {
        this._checkInitialized();

        try {
            return await this.safeRecordContract.getActiveSafes();
        } catch (error) {
            logger.error('Failed to get active Ethereum safes:', error);
            throw error;
        }
    }

    /**
     * Listen for SafeWithdrawn events
     */
    onSafeWithdrawn(callback) {
        if (!this.provider) return;

        // Listen for SafeWithdrawn events from any SafeEscrow contract
        const filter = {
            topics: [ethers.id('SafeWithdrawn(address,address,address,uint256,string)')]
        };

        this.provider.on(filter, async (log) => {
            try {
                const iface = new ethers.Interface(SAFE_ESCROW_ABI);
                const parsedLog = iface.parseLog(log);
                
                const event = {
                    safeAddress: parsedLog.args[0],
                    withdrawer: parsedLog.args[1],
                    beneficiary: parsedLog.args[2],
                    amount: parsedLog.args[3].toString(),
                    secret: parsedLog.args[4],
                    txHash: log.transactionHash,
                    blockNumber: log.blockNumber
                };

                callback(event);
            } catch (error) {
                logger.error('Error parsing SafeWithdrawn event:', error);
            }
        });
    }

    /**
     * Ensure token approval for the safe record contract
     */
    async _ensureTokenApproval(tokenAddress, amount) {
        try {
            const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.signer);
            
            const currentAllowance = await tokenContract.allowance(
                this.signer.address,
                this.config.safeRecordAddress
            );

            if (currentAllowance < amount) {
                logger.info('Approving token transfer...');
                const approveTx = await tokenContract.approve(
                    this.config.safeRecordAddress,
                    amount
                );
                await approveTx.wait();
                logger.info('Token approval successful');
            }
        } catch (error) {
            logger.error('Failed to ensure token approval:', error);
            throw error;
        }
    }

    /**
     * Extract safe address from transaction receipt
     */
    _extractSafeAddressFromReceipt(receipt) {
        const safeRegisteredEvent = receipt.logs.find(log => {
            try {
                const iface = new ethers.Interface(SAFE_RECORD_ABI);
                const parsedLog = iface.parseLog(log);
                return parsedLog.name === 'SafeRegistered';
            } catch {
                return false;
            }
        });

        if (safeRegisteredEvent) {
            const iface = new ethers.Interface(SAFE_RECORD_ABI);
            const parsedLog = iface.parseLog(safeRegisteredEvent);
            return parsedLog.args[0]; // safeAddress
        }

        throw new Error('SafeRegistered event not found in transaction receipt');
    }

    _checkInitialized() {
        if (!this.isInitialized) {
            throw new Error('EthereumSafeManager not initialized');
        }
    }

    async shutdown() {
        if (this.provider) {
            this.provider.removeAllListeners();
        }
        logger.info('EthereumSafeManager shut down');
    }
}