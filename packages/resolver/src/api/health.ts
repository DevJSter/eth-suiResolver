import express from 'express';
import { app } from '../index';

const router = express.Router();

// Health check endpoint
router.get('/', async (req, res) => {
  try {
    const database = app.getDatabase();
    const chainManager = app.getChainManager();
    const resolverService = app.getResolverService();

    // Check database health
    const dbHealthy = await database.healthCheck();
    
    // Check chain connections
    const chainConnections = await chainManager.checkConnections();
    
    // Check resolver service status
    const resolverRunning = resolverService.isRunning();

    const health = {
      status: 'ok',
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
    };

    const allHealthy = dbHealthy && resolverRunning && Array.from(chainConnections.values()).every(c => c);
    
    if (!allHealthy) {
      health.status = 'degraded';
    }

    res.status(allHealthy ? 200 : 503).json(health);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Detailed health check
router.get('/detailed', async (req, res) => {
  try {
    const database = app.getDatabase();
    const chainManager = app.getChainManager();
    const resolverService = app.getResolverService();

    // Get chain block numbers
    const blockNumbers = await chainManager.getAllBlockNumbers();
    
    // Get resolver stats
    const stats = resolverService.getStats();

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      details: {
        resolver: {
          running: resolverService.isRunning(),
          stats
        },
        chains: {
          blockNumbers: Object.fromEntries(blockNumbers.entries()),
          connections: Object.fromEntries(
            (await chainManager.checkConnections()).entries()
          )
        },
        database: {
          healthy: await database.healthCheck()
        },
        system: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          nodeVersion: process.version
        }
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

export default router;