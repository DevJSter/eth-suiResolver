import { ethers } from 'ethers';
import { SuiClient } from '@mysten/sui.js/client';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { logger } from '../utils/logger';
import { config } from '../config';
import { ChainType } from '../types';

export interface ChainProvider {
  readonly chainType: ChainType;
  connect(): Promise<void>;
  isConnected(): boolean;
  getBlockNumber(): Promise<number>;
  estimateGas(tx: any): Promise<string>;
  sendTransaction(tx: any): Promise<string>;
  waitForTransaction(txHash: string, confirmations?: number): Promise<any>;
  disconnect(): Promise<void>;
}

export class EthereumProvider implements ChainProvider {
  readonly chainType = ChainType.ETHEREUM;
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private connected: boolean = false;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.ethereum.rpcUrl);
    this.wallet = new ethers.Wallet(config.ethereum.privateKey, this.provider);
  }

  async connect(): Promise<void> {
    try {
      // Test connection
      await this.provider.getNetwork();
      this.connected = true;
      logger.info('Connected to Ethereum network');
    } catch (error) {
      logger.error('Failed to connect to Ethereum network:', error);
      throw error;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getBlockNumber(): Promise<number> {
    return await this.provider.getBlockNumber();
  }

  async estimateGas(tx: any): Promise<string> {
    const estimate = await this.wallet.estimateGas(tx);
    return estimate.toString();
  }

  async sendTransaction(tx: any): Promise<string> {
    const response = await this.wallet.sendTransaction(tx);
    return response.hash;
  }

  async waitForTransaction(txHash: string, confirmations: number = 1): Promise<any> {
    return await this.provider.waitForTransaction(txHash, confirmations);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    logger.info('Disconnected from Ethereum network');
  }

  // Ethereum-specific methods
  getWallet(): ethers.Wallet {
    return this.wallet;
  }

  getProvider(): ethers.JsonRpcProvider {
    return this.provider;
  }

  async getContract(address: string, abi: any): Promise<ethers.Contract> {
    return new ethers.Contract(address, abi, this.wallet);
  }

  async getBalance(address?: string): Promise<string> {
    const addr = address || this.wallet.address;
    const balance = await this.provider.getBalance(addr);
    return ethers.formatEther(balance);
  }

  async getGasPrice(): Promise<string> {
    const feeData = await this.provider.getFeeData();
    return feeData.gasPrice?.toString() || config.ethereum.gasPrice;
  }

  async getNonce(): Promise<number> {
    return await this.provider.getTransactionCount(this.wallet.address, 'pending');
  }
}

export class SuiProvider implements ChainProvider {
  readonly chainType = ChainType.SUI;
  private client: SuiClient;
  private keypair: Ed25519Keypair;
  private connected: boolean = false;

  constructor() {
    this.client = new SuiClient({ url: config.sui.rpcUrl });
    this.keypair = Ed25519Keypair.fromSecretKey(
      Buffer.from(config.sui.privateKey.replace('0x', ''), 'hex')
    );
  }

  async connect(): Promise<void> {
    try {
      // Test connection
      await this.client.getLatestSuiSystemState();
      this.connected = true;
      logger.info('Connected to Sui network');
    } catch (error) {
      logger.error('Failed to connect to Sui network:', error);
      throw error;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getBlockNumber(): Promise<number> {
    const checkpoint = await this.client.getLatestCheckpointSequenceNumber();
    return parseInt(checkpoint);
  }

  async estimateGas(tx: TransactionBlock): Promise<string> {
    const dryRun = await this.client.dryRunTransactionBlock({
      transactionBlock: await tx.build({ client: this.client }),
    });
    
    if (dryRun.effects.status.status === 'failure') {
      throw new Error(`Transaction simulation failed: ${dryRun.effects.status.error}`);
    }
    
    return dryRun.effects.gasUsed?.computationCost.toString() || config.sui.gasBudget.toString();
  }

  async sendTransaction(tx: TransactionBlock): Promise<string> {
    const result = await this.client.signAndExecuteTransactionBlock({
      transactionBlock: tx,
      signer: this.keypair,
      options: {
        showEffects: true,
        showEvents: true,
      },
    });
    
    if (result.effects?.status.status === 'failure') {
      throw new Error(`Transaction failed: ${result.effects.status.error}`);
    }
    
    return result.digest;
  }

  async waitForTransaction(txHash: string, confirmations: number = 1): Promise<any> {
    // Sui transactions are final once included in a checkpoint
    // So we just wait for the transaction to be finalized
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds timeout
    
    while (attempts < maxAttempts) {
      try {
        const result = await this.client.getTransactionBlock({
          digest: txHash,
          options: {
            showEffects: true,
            showEvents: true,
          },
        });
        
        if (result.effects?.status.status === 'success') {
          return result;
        } else if (result.effects?.status.status === 'failure') {
          throw new Error(`Transaction failed: ${result.effects.status.error}`);
        }
      } catch (error) {
        if (attempts === maxAttempts - 1) {
          throw error;
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    
    throw new Error('Transaction confirmation timeout');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    logger.info('Disconnected from Sui network');
  }

  // Sui-specific methods
  getClient(): SuiClient {
    return this.client;
  }

  getKeypair(): Ed25519Keypair {
    return this.keypair;
  }

  getAddress(): string {
    return this.keypair.getPublicKey().toSuiAddress();
  }

  async getBalance(address?: string): Promise<string> {
    const addr = address || this.getAddress();
    const balance = await this.client.getBalance({
      owner: addr,
      coinType: '0x2::sui::SUI',
    });
    
    return (BigInt(balance.totalBalance) / BigInt(1_000_000_000)).toString(); // Convert MIST to SUI
  }

  async getGasCoins(amount?: string): Promise<any[]> {
    const coins = await this.client.getCoins({
      owner: this.getAddress(),
      coinType: '0x2::sui::SUI',
    });
    
    if (amount) {
      const requiredAmount = BigInt(amount);
      let totalAmount = BigInt(0);
      const selectedCoins = [];
      
      for (const coin of coins.data) {
        selectedCoins.push(coin);
        totalAmount += BigInt(coin.balance);
        
        if (totalAmount >= requiredAmount) {
          break;
        }
      }
      
      if (totalAmount < requiredAmount) {
        throw new Error('Insufficient SUI balance for gas');
      }
      
      return selectedCoins;
    }
    
    return coins.data;
  }

  async getObject(objectId: string): Promise<any> {
    return await this.client.getObject({
      id: objectId,
      options: {
        showType: true,
        showContent: true,
        showDisplay: true,
      },
    });
  }

  async getObjectsOwnedByAddress(address?: string): Promise<any[]> {
    const addr = address || this.getAddress();
    const objects = await this.client.getOwnedObjects({
      owner: addr,
      options: {
        showType: true,
        showContent: true,
      },
    });
    
    return objects.data;
  }
}

export class ChainManager {
  private providers: Map<ChainType, ChainProvider> = new Map();

  constructor() {
    this.providers.set(ChainType.ETHEREUM, new EthereumProvider());
    this.providers.set(ChainType.SUI, new SuiProvider());
  }

  async initialize(): Promise<void> {
    for (const [chainType, provider] of this.providers) {
      try {
        await provider.connect();
        logger.info(`Initialized ${chainType} provider`);
      } catch (error) {
        logger.error(`Failed to initialize ${chainType} provider:`, error);
        throw error;
      }
    }
  }

  getProvider(chainType: ChainType): ChainProvider {
    const provider = this.providers.get(chainType);
    if (!provider) {
      throw new Error(`Provider not found for chain type: ${chainType}`);
    }
    return provider;
  }

  getEthereumProvider(): EthereumProvider {
    return this.getProvider(ChainType.ETHEREUM) as EthereumProvider;
  }

  getSuiProvider(): SuiProvider {
    return this.getProvider(ChainType.SUI) as SuiProvider;
  }

  async getAllBlockNumbers(): Promise<Map<ChainType, number>> {
    const blockNumbers = new Map<ChainType, number>();
    
    for (const [chainType, provider] of this.providers) {
      try {
        const blockNumber = await provider.getBlockNumber();
        blockNumbers.set(chainType, blockNumber);
      } catch (error) {
        logger.error(`Failed to get block number for ${chainType}:`, error);
      }
    }
    
    return blockNumbers;
  }

  async checkConnections(): Promise<Map<ChainType, boolean>> {
    const connections = new Map<ChainType, boolean>();
    
    for (const [chainType, provider] of this.providers) {
      connections.set(chainType, provider.isConnected());
    }
    
    return connections;
  }

  async disconnect(): Promise<void> {
    for (const [chainType, provider] of this.providers) {
      try {
        await provider.disconnect();
        logger.info(`Disconnected ${chainType} provider`);
      } catch (error) {
        logger.error(`Failed to disconnect ${chainType} provider:`, error);
      }
    }
  }
}