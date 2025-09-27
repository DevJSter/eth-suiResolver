import sqlite3 from 'sqlite3';
import { SwapRequest, HTLCInfo, SecretReveal, SwapStatus, ChainType } from '../types';
import { logger, logError } from '../utils/logger';

export class Database {
  private db: sqlite3.Database | null = null;
  private dbPath: string;

  constructor(dbPath: string = './resolver.db') {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          logError('database', err);
          reject(err);
          return;
        }

        logger.info('Connected to SQLite database');
        this.createTables()
          .then(() => resolve())
          .catch(reject);
      });
    });
  }

  private async createTables(): Promise<void> {
    const tables = [
      `CREATE TABLE IF NOT EXISTS swaps (
        id TEXT PRIMARY KEY,
        userAddress TEXT NOT NULL,
        resolverAddress TEXT NOT NULL,
        sourceChain TEXT NOT NULL,
        destinationChain TEXT NOT NULL,
        sourceToken TEXT NOT NULL,
        destinationToken TEXT NOT NULL,
        sourceAmount TEXT NOT NULL,
        destinationAmount TEXT NOT NULL,
        secretHash TEXT NOT NULL,
        secret TEXT,
        userTimelock INTEGER NOT NULL,
        resolverTimelock INTEGER NOT NULL,
        status TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      )`,
      
      `CREATE TABLE IF NOT EXISTS htlcs (
        id TEXT PRIMARY KEY,
        swapId TEXT NOT NULL,
        chain TEXT NOT NULL,
        sender TEXT NOT NULL,
        beneficiary TEXT NOT NULL,
        token TEXT NOT NULL,
        amount TEXT NOT NULL,
        hashLock TEXT NOT NULL,
        timelock INTEGER NOT NULL,
        claimed BOOLEAN DEFAULT 0,
        refunded BOOLEAN DEFAULT 0,
        txHash TEXT NOT NULL,
        blockNumber INTEGER,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        FOREIGN KEY (swapId) REFERENCES swaps (id)
      )`,
      
      `CREATE TABLE IF NOT EXISTS secret_reveals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        swapId TEXT NOT NULL,
        htlcId TEXT NOT NULL,
        secret TEXT NOT NULL,
        secretHash TEXT NOT NULL,
        revealedBy TEXT NOT NULL,
        chain TEXT NOT NULL,
        txHash TEXT NOT NULL,
        blockNumber INTEGER,
        revealedAt INTEGER NOT NULL,
        FOREIGN KEY (swapId) REFERENCES swaps (id)
      )`,
      
      `CREATE TABLE IF NOT EXISTS resolver_stakes (
        resolver TEXT NOT NULL,
        chain TEXT NOT NULL,
        amount TEXT NOT NULL,
        txHash TEXT NOT NULL,
        blockNumber INTEGER,
        stakedAt INTEGER NOT NULL,
        PRIMARY KEY (resolver, chain)
      )`,
      
      `CREATE TABLE IF NOT EXISTS event_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chain TEXT NOT NULL,
        event TEXT NOT NULL,
        txHash TEXT NOT NULL,
        blockNumber INTEGER NOT NULL,
        address TEXT NOT NULL,
        data TEXT NOT NULL,
        processedAt INTEGER,
        createdAt INTEGER NOT NULL
      )`
    ];

    for (const table of tables) {
      await this.runQuery(table);
    }

    // Create indexes
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_swaps_status ON swaps (status)',
      'CREATE INDEX IF NOT EXISTS idx_swaps_created ON swaps (createdAt)',
      'CREATE INDEX IF NOT EXISTS idx_htlcs_swap ON htlcs (swapId)',
      'CREATE INDEX IF NOT EXISTS idx_htlcs_chain ON htlcs (chain)',
      'CREATE INDEX IF NOT EXISTS idx_events_chain ON event_logs (chain)',
      'CREATE INDEX IF NOT EXISTS idx_events_block ON event_logs (blockNumber)'
    ];

    for (const index of indexes) {
      await this.runQuery(index);
    }

    logger.info('Database tables created successfully');
  }

  private runQuery(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      this.db.run(sql, params, function(err) {
        if (err) {
          logError('database', err, { sql, params });
          reject(err);
        } else {
          resolve(this);
        }
      });
    });
  }

  private getQuery(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      this.db.get(sql, params, (err, row) => {
        if (err) {
          logError('database', err, { sql, params });
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  private allQuery(sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      this.db.all(sql, params, (err, rows) => {
        if (err) {
          logError('database', err, { sql, params });
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Swap operations
  async createSwap(swap: SwapRequest): Promise<void> {
    const sql = `
      INSERT INTO swaps (
        id, userAddress, resolverAddress, sourceChain, destinationChain,
        sourceToken, destinationToken, sourceAmount, destinationAmount,
        secretHash, secret, userTimelock, resolverTimelock, status,
        createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const params = [
      swap.id,
      swap.userAddress,
      swap.resolverAddress,
      swap.sourceChain,
      swap.destinationChain,
      swap.sourceToken,
      swap.destinationToken,
      swap.sourceAmount,
      swap.destinationAmount,
      swap.secretHash,
      swap.secret || null,
      swap.userTimelock,
      swap.resolverTimelock,
      swap.status,
      swap.createdAt.getTime(),
      swap.updatedAt.getTime()
    ];

    await this.runQuery(sql, params);
  }

  async updateSwap(swap: SwapRequest): Promise<void> {
    const sql = `
      UPDATE swaps SET
        userAddress = ?, resolverAddress = ?, sourceChain = ?, destinationChain = ?,
        sourceToken = ?, destinationToken = ?, sourceAmount = ?, destinationAmount = ?,
        secretHash = ?, secret = ?, userTimelock = ?, resolverTimelock = ?,
        status = ?, updatedAt = ?
      WHERE id = ?
    `;
    
    const params = [
      swap.userAddress,
      swap.resolverAddress,
      swap.sourceChain,
      swap.destinationChain,
      swap.sourceToken,
      swap.destinationToken,
      swap.sourceAmount,
      swap.destinationAmount,
      swap.secretHash,
      swap.secret || null,
      swap.userTimelock,
      swap.resolverTimelock,
      swap.status,
      swap.updatedAt.getTime(),
      swap.id
    ];

    await this.runQuery(sql, params);
  }

  async getSwap(swapId: string): Promise<SwapRequest | null> {
    const sql = 'SELECT * FROM swaps WHERE id = ?';
    const row = await this.getQuery(sql, [swapId]);
    
    if (!row) return null;
    
    return this.rowToSwapRequest(row);
  }

  async getActiveSwaps(): Promise<SwapRequest[]> {
    const sql = `
      SELECT * FROM swaps 
      WHERE status NOT IN ('completed', 'failed', 'expired')
      ORDER BY createdAt ASC
    `;
    
    const rows = await this.allQuery(sql);
    return rows.map(row => this.rowToSwapRequest(row));
  }

  async getSwapsByStatus(status: SwapStatus): Promise<SwapRequest[]> {
    const sql = 'SELECT * FROM swaps WHERE status = ? ORDER BY createdAt ASC';
    const rows = await this.allQuery(sql, [status]);
    return rows.map(row => this.rowToSwapRequest(row));
  }

  private rowToSwapRequest(row: any): SwapRequest {
    return {
      id: row.id,
      userAddress: row.userAddress,
      resolverAddress: row.resolverAddress,
      sourceChain: row.sourceChain as ChainType,
      destinationChain: row.destinationChain as ChainType,
      sourceToken: row.sourceToken,
      destinationToken: row.destinationToken,
      sourceAmount: row.sourceAmount,
      destinationAmount: row.destinationAmount,
      secretHash: row.secretHash,
      secret: row.secret,
      userTimelock: row.userTimelock,
      resolverTimelock: row.resolverTimelock,
      status: row.status as SwapStatus,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt)
    };
  }

  // HTLC operations
  async createHTLC(htlc: HTLCInfo): Promise<void> {
    const sql = `
      INSERT INTO htlcs (
        id, swapId, chain, sender, beneficiary, token, amount,
        hashLock, timelock, claimed, refunded, txHash, blockNumber,
        createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const params = [
      htlc.id,
      htlc.swapId,
      htlc.chain,
      htlc.sender,
      htlc.beneficiary,
      htlc.token,
      htlc.amount,
      htlc.hashLock,
      htlc.timelock,
      htlc.claimed ? 1 : 0,
      htlc.refunded ? 1 : 0,
      htlc.txHash,
      htlc.blockNumber,
      htlc.createdAt.getTime(),
      htlc.updatedAt.getTime()
    ];

    await this.runQuery(sql, params);
  }

  async updateHTLC(htlc: HTLCInfo): Promise<void> {
    const sql = `
      UPDATE htlcs SET
        swapId = ?, chain = ?, sender = ?, beneficiary = ?, token = ?,
        amount = ?, hashLock = ?, timelock = ?, claimed = ?, refunded = ?,
        txHash = ?, blockNumber = ?, updatedAt = ?
      WHERE id = ?
    `;
    
    const params = [
      htlc.swapId,
      htlc.chain,
      htlc.sender,
      htlc.beneficiary,
      htlc.token,
      htlc.amount,
      htlc.hashLock,
      htlc.timelock,
      htlc.claimed ? 1 : 0,
      htlc.refunded ? 1 : 0,
      htlc.txHash,
      htlc.blockNumber,
      htlc.updatedAt.getTime(),
      htlc.id
    ];

    await this.runQuery(sql, params);
  }

  async getHTLCsBySwap(swapId: string): Promise<HTLCInfo[]> {
    const sql = 'SELECT * FROM htlcs WHERE swapId = ?';
    const rows = await this.allQuery(sql, [swapId]);
    return rows.map(row => this.rowToHTLC(row));
  }

  private rowToHTLC(row: any): HTLCInfo {
    return {
      id: row.id,
      swapId: row.swapId,
      chain: row.chain as ChainType,
      sender: row.sender,
      beneficiary: row.beneficiary,
      token: row.token,
      amount: row.amount,
      hashLock: row.hashLock,
      timelock: row.timelock,
      claimed: Boolean(row.claimed),
      refunded: Boolean(row.refunded),
      txHash: row.txHash,
      blockNumber: row.blockNumber,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt)
    };
  }

  // Secret reveal operations
  async recordSecretReveal(reveal: SecretReveal): Promise<void> {
    const sql = `
      INSERT INTO secret_reveals (
        swapId, htlcId, secret, secretHash, revealedBy, chain,
        txHash, blockNumber, revealedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const params = [
      reveal.swapId,
      reveal.htlcId,
      reveal.secret,
      reveal.secretHash,
      reveal.revealedBy,
      reveal.chain,
      reveal.txHash,
      reveal.blockNumber,
      reveal.revealedAt.getTime()
    ];

    await this.runQuery(sql, params);
  }

  async getSecretReveal(swapId: string): Promise<SecretReveal | null> {
    const sql = 'SELECT * FROM secret_reveals WHERE swapId = ? ORDER BY revealedAt DESC LIMIT 1';
    const row = await this.getQuery(sql, [swapId]);
    
    if (!row) return null;
    
    return {
      id: row.id.toString(),
      swapId: row.swapId,
      htlcId: row.htlcId,
      secret: row.secret,
      secretHash: row.secretHash,
      revealedBy: row.revealedBy,
      chain: row.chain as ChainType,
      txHash: row.txHash,
      blockNumber: row.blockNumber,
      revealedAt: new Date(row.revealedAt)
    };
  }

  // Cleanup operations
  async cleanupOldSwaps(olderThanDays: number = 30): Promise<number> {
    const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    
    const result = await this.runQuery(
      `DELETE FROM swaps WHERE status IN ('completed', 'failed', 'expired') AND updatedAt < ?`,
      [cutoffTime]
    );
    
    return result.changes || 0;
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve();
        return;
      }

      this.db.close((err) => {
        if (err) {
          logError('database', err);
          reject(err);
        } else {
          logger.info('Database connection closed');
          this.db = null;
          resolve();
        }
      });
    });
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      await this.getQuery('SELECT 1');
      return true;
    } catch (error) {
      logError('database', error as Error);
      return false;
    }
  }
}