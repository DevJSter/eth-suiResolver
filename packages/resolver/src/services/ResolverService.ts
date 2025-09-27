import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { ChainManager, EthereumProvider, SuiProvider } from '../blockchain/providers';
import { logger, logSwapEvent, logError, logSwapStatus } from '../utils/logger';
import { config } from '../config';
import { 
  SwapRequest, 
  SwapStatus, 
  ChainType, 
  HTLCInfo 
} from '../types';
import { Database } from '../database';

// Contract ABIs (simplified for example)
const SWAP_ESCROW_FACTORY_ABI = [
  "function createSwapEscrow(bytes32 swapId, address resolver, bytes32 secretHash, uint256 userTimelock, uint256 resolverTimelock) external returns (address)",
  "function isAuthorizedResolver(address resolver) external view returns (bool)",
  "function registerResolver() external payable",
  "event SwapEscrowCreated(bytes32 indexed swapId, address indexed escrowAddress, address indexed userAddress, address resolverAddress)",
  "event ResolverRegistered(address indexed resolver, uint256 stakeAmount)"
];

const SWAP_ESCROW_ABI = [
  "function lockUserSide(address token, uint256 amount) external payable",
  "function lockResolverSide(address token, uint256 amount) external payable", 
  "function claimFunds(string calldata secret, uint8 side) external",
  "function refundFunds(uint8 side) external",
  "function getStatus() external view returns (bool userLocked, bool userClaimed, bool userRefunded, bool resolverLocked, bool resolverClaimed, bool resolverRefunded, bool secretRevealed, bool destroyed)",
  "function canClaim(uint8 side) external view returns (bool)",
  "function canRefund(uint8 side) external view returns (bool)",
  "function userSide() external view returns (address locker, address beneficiary, address token, uint256 amount, bytes32 secretHash, uint256 timelock, bool locked, bool claimed, bool refunded)",
  "function resolverSide() external view returns (address locker, address beneficiary, address token, uint256 amount, bytes32 secretHash, uint256 timelock, bool locked, bool claimed, bool refunded)",
  "event EscrowLocked(address indexed locker, address indexed beneficiary, address token, uint256 amount, bytes32 secretHash, uint256 timelock)",
  "event EscrowClaimed(address indexed claimer, string secret, uint256 amount)",
  "event EscrowRefunded(address indexed refundee, uint256 amount)"
];

export class ResolverService extends EventEmitter {
  private chainManager: ChainManager;
  private database: Database;
  private running: boolean = false;
  private activeSwaps: Map<string, SwapRequest> = new Map();
  private monitoringIntervals: Map<string, NodeJS.Timeout> = new Map();
  
  // Contract instances
  private ethFactoryContract?: ethers.Contract;
  private suiPackageId: string;
  private suiFactoryId: string;

  constructor(chainManager: ChainManager, database: Database) {
    super();
    this.chainManager = chainManager;
    this.database = database;
    this.suiPackageId = config.sui.packageId;
    this.suiFactoryId = config.sui.swapEscrowFactoryId;
  }

  async initialize(): Promise<void> {
    try {
      logger.info('Initializing Resolver Service...');
      
      // Initialize chain connections
      await this.chainManager.initialize();
      
      // Setup Ethereum contracts
      const ethProvider = this.chainManager.getEthereumProvider();
      this.ethFactoryContract = await ethProvider.getContract(
        config.ethereum.escrowAddress,
        SWAP_ESCROW_FACTORY_ABI
      );
      
      // Register as resolver on both chains if not already registered
      await this.registerAsResolver();
      
      // Load active swaps from database
      await this.loadActiveSwaps();
      
      logger.info('Resolver Service initialized successfully');
    } catch (error) {
      logError('resolver', error as Error);
      throw error;
    }
  }

  async start(): Promise<void> {
    if (this.running) {
      logger.warn('Resolver Service is already running');
      return;
    }

    try {
      this.running = true;
      
      // Start monitoring existing swaps
      for (const [swapId, swap] of this.activeSwaps) {
        this.startSwapMonitoring(swapId, swap);
      }
      
      // Start listening for new swap requests
      this.startEventListening();
      
      logger.info('Resolver Service started');
      this.emit('started');
    } catch (error) {
      this.running = false;
      logError('resolver', error as Error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    try {
      this.running = false;
      
      // Stop all monitoring intervals
      for (const [swapId, interval] of this.monitoringIntervals) {
        clearInterval(interval);
      }
      this.monitoringIntervals.clear();
      
      // Stop event listening
      this.stopEventListening();
      
      // Disconnect from chains
      await this.chainManager.disconnect();
      
      logger.info('Resolver Service stopped');
      this.emit('stopped');
    } catch (error) {
      logError('resolver', error as Error);
      throw error;
    }
  }

  private async registerAsResolver(): Promise<void> {
    try {
      // Register on Ethereum
      const ethProvider = this.chainManager.getEthereumProvider();
      const isRegistered = await this.ethFactoryContract!.isAuthorizedResolver(
        ethProvider.getWallet().address
      );
      
      if (!isRegistered) {
        logger.info('Registering as resolver on Ethereum...');
        const tx = await this.ethFactoryContract!.registerResolver({
          value: ethers.parseEther(config.resolver.stakeAmount)
        });
        await tx.wait();
        logger.info('Successfully registered as resolver on Ethereum');
      }

      // Register on Sui
      const suiProvider = this.chainManager.getSuiProvider();
      
      try {
        // Check if already registered by trying to get factory object and see if our address is in resolvers
        logger.info('Checking if already registered on Sui...');
        const factoryObject = await suiProvider.getObject(this.suiFactoryId);
        
        // For now, assume we might already be registered and try registration
        logger.info('Registering as resolver on Sui...');
        
        const txb = new TransactionBlock();
        // Convert ETH amount to SUI MIST (1 SUI = 1e9 MIST)
        const stakeAmountMIST = Math.floor(parseFloat(config.resolver.stakeAmount) * 1e9);
        const stakeCoin = txb.splitCoins(txb.gas, [stakeAmountMIST]);
        
        txb.moveCall({
          target: `${this.suiPackageId}::sui_swap_escrow::register_resolver`,
          arguments: [
            txb.object(this.suiFactoryId),
            stakeCoin,
          ],
        });

        const result = await suiProvider.sendTransaction(txb);
        await suiProvider.waitForTransaction(result);
        
        logger.info('Successfully registered as resolver on Sui');
      } catch (suiError: any) {
        // If registration fails, it might be because we're already registered
        if (suiError.message && suiError.message.includes('already')) {
          logger.info('Already registered as resolver on Sui');
        } else {
          logger.warn('Sui registration failed, continuing anyway:', suiError.message);
        }
      }
    } catch (error) {
      logError('resolver', error as Error, { action: 'registerAsResolver' });
      throw error;
    }
  }

  private async loadActiveSwaps(): Promise<void> {
    try {
      const activeSwaps = await this.database.getActiveSwaps();
      
      for (const swap of activeSwaps) {
        this.activeSwaps.set(swap.id, swap);
        logSwapEvent('loaded', swap.id, { status: swap.status });
      }
      
      logger.info(`Loaded ${this.activeSwaps.size} active swaps`);
    } catch (error) {
      logError('resolver', error as Error, { action: 'loadActiveSwaps' });
      throw error;
    }
  }

  private startEventListening(): void {
    try {
      // Listen for Ethereum events
      this.ethFactoryContract!.on('SwapEscrowCreated', this.handleEthereumSwapCreated.bind(this));
      
      // Listen for Sui events (would need to implement event subscription)
      // For now, we'll use polling
      this.startSuiEventPolling();
      
      logger.info('Started event listening');
    } catch (error) {
      logError('resolver', error as Error, { action: 'startEventListening' });
      throw error;
    }
  }

  private stopEventListening(): void {
    try {
      // Stop Ethereum event listening
      this.ethFactoryContract!.removeAllListeners();
      
      logger.info('Stopped event listening');
    } catch (error) {
      logError('resolver', error as Error, { action: 'stopEventListening' });
    }
  }

  private async startSuiEventPolling(): Promise<void> {
    // Simplified Sui event polling - in production would use WebSocket subscriptions
    const pollInterval = setInterval(async () => {
      try {
        await this.pollSuiEvents();
      } catch (error) {
        logError('resolver', error as Error, { action: 'pollSuiEvents' });
      }
    }, 5000); // Poll every 5 seconds

    this.monitoringIntervals.set('sui-events', pollInterval);
  }

  private async pollSuiEvents(): Promise<void> {
    // Implementation would query Sui events and process new escrow creations
    // This is a placeholder for the actual implementation
  }

  private async handleEthereumSwapCreated(
    swapId: string,
    escrowAddress: string,
    userAddress: string,
    resolverAddress: string
  ): Promise<void> {
    try {
      // Check if this resolver should handle this swap
      const ethProvider = this.chainManager.getEthereumProvider();
      if (resolverAddress.toLowerCase() !== ethProvider.getWallet().address.toLowerCase()) {
        return; // Not our swap
      }

      // Get escrow details from the deployed contract
      const escrowContract = new ethers.Contract(escrowAddress, SWAP_ESCROW_ABI, ethProvider.getProvider());
      const userSide = await escrowContract.userSide();
      const resolverSide = await escrowContract.resolverSide();
      const secretHash = userSide.secretHash;
      const userTimelock = BigInt(userSide.timelock);
      const resolverTimelock = BigInt(resolverSide.timelock);

      logSwapEvent('new_swap_detected', swapId, {
        chain: 'ethereum',
        userAddress,
        resolverAddress,
        escrowAddress
      });

      // Create swap request in database
      const swapRequest: SwapRequest = {
        id: swapId,
        userAddress,
        resolverAddress,
        sourceChain: ChainType.ETHEREUM,
        destinationChain: ChainType.SUI,
        sourceToken: '0x0', // ETH
        destinationToken: '0x2::sui::SUI',
        sourceAmount: '0', // Will be updated when user locks
        destinationAmount: '0', // Will be calculated
        secretHash,
        userTimelock: Number(userTimelock),
        resolverTimelock: Number(resolverTimelock),
        status: SwapStatus.PENDING,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await this.database.createSwap(swapRequest);
      this.activeSwaps.set(swapId, swapRequest);
      
      // Start monitoring this swap
      this.startSwapMonitoring(swapId, swapRequest);
      
      this.emit('swapCreated', swapRequest);
    } catch (error) {
      logError('resolver', error as Error, { 
        action: 'handleEthereumSwapCreated',
        swapId 
      });
    }
  }

  private startSwapMonitoring(swapId: string, swap: SwapRequest): void {
    const monitorInterval = setInterval(async () => {
      try {
        await this.monitorSwap(swapId, swap);
      } catch (error) {
        logError('resolver', error as Error, { 
          action: 'monitorSwap',
          swapId 
        });
      }
    }, 10000); // Monitor every 10 seconds

    this.monitoringIntervals.set(swapId, monitorInterval);
  }

  private async monitorSwap(swapId: string, swap: SwapRequest): Promise<void> {
    const currentSwap = this.activeSwaps.get(swapId);
    if (!currentSwap) return;

    switch (currentSwap.status) {
      case SwapStatus.PENDING:
        await this.handlePendingSwap(swapId, currentSwap);
        break;
      
      case SwapStatus.USER_LOCKED:
        await this.handleUserLockedSwap(swapId, currentSwap);
        break;
      
      case SwapStatus.RESOLVER_LOCKED:
      case SwapStatus.BOTH_LOCKED:
        await this.handleBothLockedSwap(swapId, currentSwap);
        break;
      
      case SwapStatus.USER_CLAIMED:
        await this.handleUserClaimedSwap(swapId, currentSwap);
        break;
      
      default:
        // Swap is complete or failed, stop monitoring
        this.stopSwapMonitoring(swapId);
        break;
    }
  }

  private async handlePendingSwap(swapId: string, swap: SwapRequest): Promise<void> {
    // Check if user has locked funds on source chain
    const userLocked = await this.checkUserLocked(swap);
    
    if (userLocked) {
      await this.updateSwapStatus(swapId, SwapStatus.USER_LOCKED);
      logSwapEvent('user_locked', swapId);
    }
    
    // Check for expiration
    if (Date.now() > swap.userTimelock) {
      await this.updateSwapStatus(swapId, SwapStatus.EXPIRED);
      logSwapEvent('swap_expired', swapId);
    }
  }

  private async handleUserLockedSwap(swapId: string, swap: SwapRequest): Promise<void> {
    try {
      // User has locked, now resolver should create matching escrow and lock on destination chain
      await this.createAndLockResolverSide(swapId, swap);
      await this.updateSwapStatus(swapId, SwapStatus.BOTH_LOCKED);
      logSwapEvent('resolver_locked', swapId);
    } catch (error) {
      logError('resolver', error as Error, { 
        action: 'handleUserLockedSwap',
        swapId 
      });
    }
  }

  private async handleBothLockedSwap(swapId: string, swap: SwapRequest): Promise<void> {
    // Both sides locked, monitor for claims
    const userClaimed = await this.checkUserClaimed(swap);
    const resolverClaimed = await this.checkResolverClaimed(swap);
    
    if (userClaimed && !resolverClaimed) {
      // User claimed, resolver should claim too using revealed secret
      await this.claimResolverSide(swapId, swap);
      await this.updateSwapStatus(swapId, SwapStatus.COMPLETED);
      logSwapEvent('swap_completed', swapId);
    } else if (resolverClaimed && !userClaimed) {
      await this.updateSwapStatus(swapId, SwapStatus.RESOLVER_CLAIMED);
    }
  }

  private async handleUserClaimedSwap(swapId: string, swap: SwapRequest): Promise<void> {
    // Check if resolver has claimed
    const resolverClaimed = await this.checkResolverClaimed(swap);
    
    if (resolverClaimed) {
      await this.updateSwapStatus(swapId, SwapStatus.COMPLETED);
      logSwapEvent('swap_completed', swapId);
    }
  }

  private async checkUserLocked(swap: SwapRequest): Promise<boolean> {
    // Implementation to check if user has locked funds
    // Would query the escrow contract on the source chain
    return false; // Placeholder
  }

  private async checkUserClaimed(swap: SwapRequest): Promise<boolean> {
    // Implementation to check if user has claimed funds
    return false; // Placeholder
  }

  private async checkResolverClaimed(swap: SwapRequest): Promise<boolean> {
    // Implementation to check if resolver has claimed funds
    return false; // Placeholder
  }

  private async createAndLockResolverSide(swapId: string, swap: SwapRequest): Promise<void> {
    // Implementation to create escrow on destination chain and lock resolver funds
    logSwapEvent('creating_resolver_escrow', swapId);
    
    if (swap.destinationChain === ChainType.SUI) {
      await this.createSuiEscrowAndLock(swapId, swap);
    } else {
      await this.createEthereumEscrowAndLock(swapId, swap);
    }
  }

  private async createSuiEscrowAndLock(swapId: string, swap: SwapRequest): Promise<void> {
    const suiProvider = this.chainManager.getSuiProvider();
    
    // Create escrow on Sui
    const txb = new TransactionBlock();
    
    txb.moveCall({
      target: `${this.suiPackageId}::sui_swap_escrow::create_swap_escrow`,
      arguments: [
        txb.object(this.suiFactoryId),
        txb.pure(Array.from(Buffer.from(swapId.replace('0x', ''), 'hex'))),
        txb.pure(swap.userAddress),
        txb.pure(Array.from(Buffer.from(swap.secretHash.replace('0x', ''), 'hex'))),
        txb.pure(swap.resolverTimelock),
        txb.pure(swap.userTimelock),
        txb.object('0x6'), // Clock object
      ],
    });

    const result = await suiProvider.sendTransaction(txb);
    const receipt = await suiProvider.waitForTransaction(result);
    
    // Extract escrow ID from events
    // Then lock resolver funds...
  }

  private async createEthereumEscrowAndLock(swapId: string, swap: SwapRequest): Promise<void> {
    // Implementation for Ethereum escrow creation and locking
  }

  private async claimResolverSide(swapId: string, swap: SwapRequest): Promise<void> {
    // Implementation to claim resolver funds using revealed secret
    logSwapEvent('claiming_resolver_funds', swapId);
  }

  private async updateSwapStatus(swapId: string, newStatus: SwapStatus): Promise<void> {
    const swap = this.activeSwaps.get(swapId);
    if (!swap) return;

    const oldStatus = swap.status;
    swap.status = newStatus;
    swap.updatedAt = new Date();

    await this.database.updateSwap(swap);
    this.activeSwaps.set(swapId, swap);

    logSwapStatus(swapId, oldStatus, newStatus);
    this.emit('swapStatusChanged', { swapId, oldStatus, newStatus, swap });
  }

  private stopSwapMonitoring(swapId: string): void {
    const interval = this.monitoringIntervals.get(swapId);
    if (interval) {
      clearInterval(interval);
      this.monitoringIntervals.delete(swapId);
    }
    
    // Remove from active swaps if completed
    const swap = this.activeSwaps.get(swapId);
    if (swap && [SwapStatus.COMPLETED, SwapStatus.FAILED, SwapStatus.EXPIRED].includes(swap.status)) {
      this.activeSwaps.delete(swapId);
    }
  }

  // Public methods for external interaction
  async getSwapStatus(swapId: string): Promise<SwapRequest | null> {
    return this.activeSwaps.get(swapId) || null;
  }

  async getAllActiveSwaps(): Promise<SwapRequest[]> {
    return Array.from(this.activeSwaps.values());
  }

  async forceRefund(swapId: string): Promise<void> {
    // Emergency refund mechanism
    const swap = this.activeSwaps.get(swapId);
    if (!swap) {
      throw new Error(`Swap ${swapId} not found`);
    }

    // Implementation to force refund both sides
    logSwapEvent('force_refund', swapId);
  }

  isRunning(): boolean {
    return this.running;
  }

  getStats() {
    const swaps = Array.from(this.activeSwaps.values());
    return {
      totalActiveSwaps: swaps.length,
      pendingSwaps: swaps.filter(s => s.status === SwapStatus.PENDING).length,
      lockedSwaps: swaps.filter(s => [SwapStatus.USER_LOCKED, SwapStatus.BOTH_LOCKED].includes(s.status)).length,
      completedToday: 0, // Would query database
      isRunning: this.running
    };
  }
}