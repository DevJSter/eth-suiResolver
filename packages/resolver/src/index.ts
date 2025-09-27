import express from 'express';
import cors from 'cors';
import { ChainManager } from './blockchain/providers';
import { Database } from './database';
import { ResolverService } from './services/ResolverService';
import { config, validateConfig } from './config';
import { logger, setupGracefulShutdown } from './utils/logger';

// API Routes will be imported dynamically

class ResolverApplication {
  private app: express.Application;
  private chainManager: ChainManager;
  private database: Database;
  private resolverService: ResolverService;

  constructor() {
    this.app = express();
    this.chainManager = new ChainManager();
    this.database = new Database(config.database.url);
    this.resolverService = new ResolverService(this.chainManager, this.database);
  }

  async initialize(): Promise<void> {
    try {
      // Validate configuration
      validateConfig();
      logger.info('Configuration validated successfully');

      // Setup middleware
      this.setupMiddleware();

      // Initialize database
      await this.database.initialize();
      logger.info('Database initialized');

      // Initialize resolver service
      await this.resolverService.initialize();
      logger.info('Resolver service initialized');

      // Setup API routes
      this.setupRoutes();

      // Setup event listeners
      this.setupEventListeners();

      logger.info('Application initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize application:', error);
      throw error;
    }
  }

  private setupMiddleware(): void {
    // CORS
    this.app.use(cors({
      origin: process.env.NODE_ENV === 'production' ? false : true,
      credentials: true
    }));

    // JSON parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Request logging
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      next();
    });
  }

  private setupRoutes(): void {
    // Health check route
    this.app.get('/api/health', async (req, res) => {
      try {
        const resolverRunning = this.resolverService.isRunning();
        const dbHealthy = await this.database.healthCheck();
        const chainConnections = await this.chainManager.checkConnections();
        
        const allHealthy = dbHealthy && resolverRunning && Array.from(chainConnections.values()).every(c => c);
        
        res.status(allHealthy ? 200 : 503).json({
          status: allHealthy ? 'ok' : 'degraded',
          timestamp: new Date().toISOString(),
          services: {
            database: dbHealthy ? 'healthy' : 'unhealthy',
            resolver: resolverRunning ? 'running' : 'stopped',
            chains: Object.fromEntries(
              Array.from(chainConnections.entries()).map(([chain, connected]) => [
                chain, 
                connected ? 'connected' : 'disconnected'
              ])
            )
          }
        });
      } catch (error) {
        res.status(500).json({
          status: 'error',
          timestamp: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Swap status route
    this.app.get('/api/swaps', async (req, res) => {
      try {
        const swaps = await this.resolverService.getAllActiveSwaps();
        res.json({
          success: true,
          data: swaps,
          count: swaps.length
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to fetch swaps',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Individual swap route
    this.app.get('/api/swaps/:swapId', async (req, res) => {
      try {
        const { swapId } = req.params;
        const swap = await this.resolverService.getSwapStatus(swapId);
        
        if (!swap) {
          res.status(404).json({
            success: false,
            error: 'Swap not found'
          });
          return;
        }
        
        res.json({
          success: true,
          data: swap
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to fetch swap',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        name: 'Fusion+ Resolver Service',
        version: '1.0.0',
        status: 'running',
        timestamp: new Date().toISOString()
      });
    });

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.originalUrl} not found`
      });
    });

    // Error handler
    this.app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      logger.error('Unhandled error:', err);
      res.status(500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
      });
    });
  }

  private setupEventListeners(): void {
    // Resolver service events
    this.resolverService.on('swapCreated', (swap) => {
      logger.info('New swap created', { swapId: swap.id });
    });

    this.resolverService.on('swapStatusChanged', ({ swapId, oldStatus, newStatus }) => {
      logger.info('Swap status changed', { swapId, oldStatus, newStatus });
    });

    this.resolverService.on('started', () => {
      logger.info('Resolver service started');
    });

    this.resolverService.on('stopped', () => {
      logger.info('Resolver service stopped');
    });
  }

  async start(): Promise<void> {
    try {
      // Start resolver service
      await this.resolverService.start();

      // Start HTTP server
      const server = this.app.listen(config.api.port, () => {
        logger.info(`HTTP server listening on port ${config.api.port}`);
      });

      // Setup graceful shutdown
      const shutdown = async () => {
        logger.info('Shutting down gracefully...');
        
        server.close(async () => {
          try {
            await this.resolverService.stop();
            await this.database.close();
            await this.chainManager.disconnect();
            logger.info('Graceful shutdown complete');
            process.exit(0);
          } catch (error) {
            logger.error('Error during shutdown:', error);
            process.exit(1);
          }
        });
      };

      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);

      logger.info('🚀 Fusion+ Resolver Service is running!');
    } catch (error) {
      logger.error('Failed to start application:', error);
      throw error;
    }
  }

  // Getters for testing/external access
  getApp(): express.Application {
    return this.app;
  }

  getResolverService(): ResolverService {
    return this.resolverService;
  }

  getDatabase(): Database {
    return this.database;
  }

  getChainManager(): ChainManager {
    return this.chainManager;
  }
}

// Create and export application instance
export const app = new ResolverApplication();

// Start application if this file is run directly
if (require.main === module) {
  setupGracefulShutdown();
  
  app.initialize()
    .then(() => app.start())
    .catch((error) => {
      logger.error('Failed to start application:', error);
      process.exit(1);
    });
}

export default app;