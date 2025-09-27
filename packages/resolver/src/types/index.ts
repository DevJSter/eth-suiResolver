export enum SwapStatus {
  PENDING = 'pending',
  USER_LOCKED = 'user_locked',
  RESOLVER_LOCKED = 'resolver_locked',
  BOTH_LOCKED = 'both_locked',
  USER_CLAIMED = 'user_claimed',
  RESOLVER_CLAIMED = 'resolver_claimed',
  COMPLETED = 'completed',
  FAILED = 'failed',
  REFUNDED = 'refunded',
  EXPIRED = 'expired'
}

export enum ChainType {
  ETHEREUM = 'ethereum',
  SUI = 'sui'
}

export interface SwapRequest {
  id: string;
  userAddress: string;
  resolverAddress: string;
  sourceChain: ChainType;
  destinationChain: ChainType;
  sourceToken: string;
  destinationToken: string;
  sourceAmount: string;
  destinationAmount: string;
  secretHash: string;
  secret?: string;
  userTimelock: number;
  resolverTimelock: number;
  status: SwapStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface HTLCInfo {
  id: string;
  swapId: string;
  chain: ChainType;
  sender: string;
  beneficiary: string;
  token: string;
  amount: string;
  hashLock: string;
  timelock: number;
  claimed: boolean;
  refunded: boolean;
  txHash: string;
  blockNumber?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SecretReveal {
  id: string;
  swapId: string;
  htlcId: string;
  secret: string;
  secretHash: string;
  revealedBy: string;
  chain: ChainType;
  txHash: string;
  blockNumber?: number;
  revealedAt: Date;
}

export interface ResolverStake {
  resolver: string;
  chain: ChainType;
  amount: string;
  txHash: string;
  blockNumber?: number;
  stakedAt: Date;
}

export interface SwapMetrics {
  totalSwaps: number;
  completedSwaps: number;
  failedSwaps: number;
  totalVolume: string;
  profitGenerated: string;
  averageCompletionTime: number;
  activeSwaps: number;
}

export interface ChainConfig {
  name: string;
  type: ChainType;
  rpcUrl: string;
  escrowAddress?: string;
  packageId?: string;
  confirmations: number;
  blockTime: number;
  gasPriceMultiplier: number;
}

export interface EventLog {
  id: string;
  chain: ChainType;
  event: string;
  txHash: string;
  blockNumber: number;
  address: string;
  data: any;
  processedAt?: Date;
  createdAt: Date;
}