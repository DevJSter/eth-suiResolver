import { ethers } from 'ethers';
import { SuiClient, getFullnodeUrl } from '@mysten/sui.js/client';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import dotenv from 'dotenv';

dotenv.config();

export interface Config {
  // Network settings
  nodeEnv: string;
  
  // Ethereum configuration
  ethereum: {
    rpcUrl: string;
    privateKey: string;
    escrowAddress: string;
    gasLimit: number;
    gasPrice: string;
  };
  
  // Sui configuration
  sui: {
    rpcUrl: string;
    privateKey: string;
    packageId: string;
    swapEscrowFactoryId: string;
    resolverRegistryId: string;
    secretRegistryId: string;
    gasBudget: number;
  };
  
  // Resolver settings
  resolver: {
    stakeAmount: string;
    minProfitMargin: number;
    maxConcurrentSwaps: number;
    address: string;
  };
  
  // Database settings
  database: {
    url: string;
  };
  
  // Redis settings
  redis: {
    url: string;
  };
  
  // API settings
  api: {
    port: number;
    apiKey: string;
  };
  
  // Monitoring settings
  monitoring: {
    logLevel: string;
    metricsPort: number;
  };
  
  // Safety settings
  safety: {
    maxSwapAmount: string;
    minTimelockBuffer: number;
  };
}

export const config: Config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  
  ethereum: {
    rpcUrl: process.env.ETHEREUM_RPC_URL || 'http://localhost:8545',
    privateKey: process.env.ETHEREUM_PRIVATE_KEY || '',
    escrowAddress: process.env.ETHEREUM_ESCROW_ADDRESS || '',
    gasLimit: parseInt(process.env.ETHEREUM_GAS_LIMIT || '500000'),
    gasPrice: process.env.ETHEREUM_GAS_PRICE || '20000000000',
  },
  
  sui: {
    rpcUrl: process.env.SUI_RPC_URL || 'https://fullnode.devnet.sui.io:443',
    privateKey: process.env.SUI_PRIVATE_KEY || '',
    packageId: process.env.SUI_PACKAGE_ID || '',
    swapEscrowFactoryId: process.env.SUI_SWAP_ESCROW_FACTORY_ID || '',
    resolverRegistryId: process.env.SUI_RESOLVER_REGISTRY_ID || '',
    secretRegistryId: process.env.SUI_SECRET_REGISTRY_ID || '',
    gasBudget: parseInt(process.env.SUI_GAS_BUDGET || '10000000'),
  },
  
  resolver: {
    stakeAmount: process.env.RESOLVER_STAKE_AMOUNT || '1000000000',
    minProfitMargin: parseFloat(process.env.MIN_PROFIT_MARGIN || '0.1'),
    maxConcurrentSwaps: parseInt(process.env.MAX_CONCURRENT_SWAPS || '10'),
    address: process.env.RESOLVER_ADDRESS || '',
  },
  
  database: {
    url: process.env.DATABASE_URL || './resolver.db',
  },
  
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  
  api: {
    port: parseInt(process.env.PORT || '3000'),
    apiKey: process.env.API_KEY || '',
  },
  
  monitoring: {
    logLevel: process.env.LOG_LEVEL || 'info',
    metricsPort: parseInt(process.env.METRICS_PORT || '9090'),
  },
  
  safety: {
    maxSwapAmount: process.env.MAX_SWAP_AMOUNT || '100000000000000000000',
    minTimelockBuffer: parseInt(process.env.MIN_TIMELOCK_BUFFER || '1800000'),
  },
};

// Validation function
export function validateConfig(): void {
  const required = [
    'ETHEREUM_PRIVATE_KEY',
    'ETHEREUM_ESCROW_ADDRESS',
    'SUI_PRIVATE_KEY',
    'SUI_PACKAGE_ID',
    'SUI_SWAP_ESCROW_FACTORY_ID',
    'SUI_RESOLVER_REGISTRY_ID',
    'SUI_SECRET_REGISTRY_ID',
    'RESOLVER_ADDRESS',
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Validate Ethereum private key format
  try {
    new ethers.Wallet(config.ethereum.privateKey);
  } catch (error) {
    throw new Error('Invalid Ethereum private key format');
  }

  // Validate Sui private key format
  try {
    Ed25519Keypair.fromSecretKey(Buffer.from(config.sui.privateKey.replace('0x', ''), 'hex'));
  } catch (error) {
    throw new Error('Invalid Sui private key format');
  }
}