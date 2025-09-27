import express from 'express';
import cors from 'cors';
import { ethers } from 'ethers';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

class ETHWSUISwapService {
    constructor() {
        this.app = express();
        this.port = process.env.PORT || 3000;
        this.provider = null;
        this.wallet = null;
        this.wsuiToken = null;
        this.ethWSUISwap = null;
        this.activeSwaps = new Map();
        
        this.setupMiddleware();
        this.setupRoutes();
    }

    setupMiddleware() {
        this.app.use(cors());
        this.app.use(express.json());
        
        // Logging middleware
        this.app.use((req, res, next) => {
            console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
            next();
        });
    }

    async initialize() {
        try {
            // Setup provider and wallet
            const rpcUrl = process.env.ETH_RPC_URL || 'http://localhost:8545';
            this.provider = new ethers.JsonRpcProvider(rpcUrl);
            
            if (process.env.PRIVATE_KEY) {
                this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
                console.log(`🔑 Wallet connected: ${this.wallet.address}`);
            }

            // Load deployed contract addresses
            await this.loadContracts();
            
            console.log('✅ ETH-wSUI Swap Service initialized');
        } catch (error) {
            console.error('❌ Failed to initialize service:', error);
            throw error;
        }
    }

    async loadContracts() {
        try {
            const network = process.env.NETWORK || 'localhost';
            const deploymentPath = `./deployments/${network}.json`;
            
            if (fs.existsSync(deploymentPath)) {
                const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
                
                // Load contract ABIs (simplified - in production load from artifacts)
                const wsuiTokenABI = [
                    'function balanceOf(address) view returns (uint256)',
                    'function approve(address, uint256) returns (bool)',
                    'function mint(address, uint256, bytes32)',
                    'function burn(address, uint256, string)',
                    'event Mint(address indexed, uint256, bytes32 indexed)',
                    'event Burn(address indexed, uint256, string)'
                ];

                const ethWSUISwapABI = [
                    'function initiateETHToWSUI(bytes32, address, uint256, uint256) payable',
                    'function initiateWSUIToETH(bytes32, address, uint256, uint256, uint256)',
                    'function withdraw(bytes32, bytes32)',
                    'function refund(bytes32)',
                    'function getSwap(bytes32) view returns (bytes32, uint256, uint256, address, address, uint256, bool, bool, uint8)',
                    'function isWithdrawable(bytes32, bytes32) view returns (bool)',
                    'function isRefundable(bytes32) view returns (bool)',
                    'event SwapInitiated(bytes32 indexed, bytes32 indexed, address indexed, address, uint256, uint256, uint256, uint8)',
                    'event SwapWithdrawn(bytes32 indexed, address indexed, bytes32)',
                    'event SwapRefunded(bytes32 indexed, address indexed)'
                ];

                this.wsuiToken = new ethers.Contract(
                    deployment.contracts.WSUIToken,
                    wsuiTokenABI,
                    this.provider
                );

                this.ethWSUISwap = new ethers.Contract(
                    deployment.contracts.ETHWSUISwap,
                    ethWSUISwapABI,
                    this.provider
                );

                console.log(`📄 Contracts loaded for network: ${network}`);
                console.log(`🪙 wSUI Token: ${deployment.contracts.WSUIToken}`);
                console.log(`🔄 ETH-wSUI Swap: ${deployment.contracts.ETHWSUISwap}`);
            } else {
                console.warn(`⚠️ No deployment found for network: ${network}`);
            }
        } catch (error) {
            console.error('❌ Failed to load contracts:', error);
        }
    }

    setupRoutes() {
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                contracts: {
                    wsuiToken: this.wsuiToken?.target || 'not loaded',
                    ethWSUISwap: this.ethWSUISwap?.target || 'not loaded'
                }
            });
        });

        // Get swap quote
        this.app.post('/quote', async (req, res) => {
            try {
                const { fromToken, toToken, amount } = req.body;
                
                if (!['ETH', 'wSUI'].includes(fromToken) || !['ETH', 'wSUI'].includes(toToken)) {
                    return res.status(400).json({ error: 'Unsupported token pair' });
                }

                if (fromToken === toToken) {
                    return res.status(400).json({ error: 'Cannot swap same token' });
                }

                // Simple 1:1000 ratio for demo (ETH:wSUI)
                const ethToWsuiRate = 1000;
                let outputAmount;

                if (fromToken === 'ETH') {
                    outputAmount = (parseFloat(amount) * ethToWsuiRate).toString();
                } else {
                    outputAmount = (parseFloat(amount) / ethToWsuiRate).toString();
                }

                res.json({
                    fromToken,
                    toToken,
                    inputAmount: amount,
                    outputAmount,
                    rate: fromToken === 'ETH' ? ethToWsuiRate : 1/ethToWsuiRate,
                    fee: '0.3%',
                    estimatedGas: '150000'
                });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Initiate swap
        this.app.post('/swap/initiate', async (req, res) => {
            try {
                const { 
                    fromToken, 
                    toToken, 
                    inputAmount, 
                    outputAmount, 
                    participantAddress,
                    timelock 
                } = req.body;

                if (!this.wallet) {
                    return res.status(400).json({ error: 'Wallet not configured' });
                }

                // Generate secret and hash
                const secret = ethers.randomBytes(32);
                const secretHash = ethers.sha256(secret);

                // Create swap ID
                const swapId = ethers.keccak256(
                    ethers.solidityPacked(
                        ['address', 'address', 'bytes32', 'uint256'],
                        [this.wallet.address, participantAddress, secretHash, Date.now()]
                    )
                );

                // Store swap info
                this.activeSwaps.set(swapId, {
                    secret: ethers.hexlify(secret),
                    secretHash,
                    fromToken,
                    toToken,
                    inputAmount,
                    outputAmount,
                    initiator: this.wallet.address,
                    participant: participantAddress,
                    timelock,
                    status: 'initiated',
                    createdAt: new Date().toISOString()
                });

                res.json({
                    swapId,
                    secretHash,
                    status: 'initiated',
                    message: 'Swap initiated successfully. Participant can now withdraw using the secret.'
                });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Get swap status
        this.app.get('/swap/:swapId', async (req, res) => {
            try {
                const { swapId } = req.params;
                const swapInfo = this.activeSwaps.get(swapId);

                if (!swapInfo) {
                    return res.status(404).json({ error: 'Swap not found' });
                }

                // Check on-chain status if contracts are available
                let onChainStatus = null;
                if (this.ethWSUISwap) {
                    try {
                        const onChainSwap = await this.ethWSUISwap.getSwap(swapId);
                        onChainStatus = {
                            exists: onChainSwap[0] !== '0x0000000000000000000000000000000000000000000000000000000000000000',
                            withdrawn: onChainSwap[6],
                            refunded: onChainSwap[7]
                        };
                    } catch (error) {
                        console.warn('Failed to get on-chain status:', error.message);
                    }
                }

                res.json({
                    swapId,
                    ...swapInfo,
                    onChainStatus
                });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Withdraw from swap
        this.app.post('/swap/:swapId/withdraw', async (req, res) => {
            try {
                const { swapId } = req.params;
                const { secret } = req.body;

                const swapInfo = this.activeSwaps.get(swapId);
                if (!swapInfo) {
                    return res.status(404).json({ error: 'Swap not found' });
                }

                // Verify secret
                const computedHash = ethers.sha256(secret);
                if (computedHash !== swapInfo.secretHash) {
                    return res.status(400).json({ error: 'Invalid secret' });
                }

                // Update swap status
                swapInfo.status = 'withdrawn';
                swapInfo.withdrawnAt = new Date().toISOString();
                this.activeSwaps.set(swapId, swapInfo);

                res.json({
                    swapId,
                    status: 'withdrawn',
                    secret,
                    message: 'Swap withdrawn successfully'
                });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // List active swaps
        this.app.get('/swaps', (req, res) => {
            const swaps = Array.from(this.activeSwaps.entries()).map(([id, info]) => ({
                swapId: id,
                ...info
            }));

            res.json({
                totalSwaps: swaps.length,
                swaps
            });
        });

        // Demo route for testing
        this.app.post('/demo/create-swap', async (req, res) => {
            try {
                // Create a demo swap for testing
                const secret = ethers.randomBytes(32);
                const secretHash = ethers.sha256(secret);
                const swapId = ethers.randomBytes(32);

                const demoSwap = {
                    secret: ethers.hexlify(secret),
                    secretHash,
                    fromToken: 'ETH',
                    toToken: 'wSUI',
                    inputAmount: '1',
                    outputAmount: '1000',
                    initiator: '0x1234567890123456789012345678901234567890',
                    participant: '0x0987654321098765432109876543210987654321',
                    timelock: Math.floor(Date.now() / 1000) + 3600,
                    status: 'demo',
                    createdAt: new Date().toISOString()
                };

                this.activeSwaps.set(ethers.hexlify(swapId), demoSwap);

                res.json({
                    swapId: ethers.hexlify(swapId),
                    secret: ethers.hexlify(secret),
                    secretHash,
                    message: 'Demo swap created for testing',
                    ...demoSwap
                });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
    }

    async start() {
        await this.initialize();
        
        this.app.listen(this.port, () => {
            console.log(`🚀 ETH-wSUI Swap Service running on port ${this.port}`);
            console.log(`📡 API endpoints available at http://localhost:${this.port}`);
            console.log(`🏥 Health check: http://localhost:${this.port}/health`);
        });
    }
}

// Start the service if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const service = new ETHWSUISwapService();
    service.start().catch(console.error);
}

export { ETHWSUISwapService };