import express from 'express';
import { app } from '../index';

const router = express.Router();

// Get all active swaps
router.get('/', async (req, res) => {
  try {
    const resolverService = app.getResolverService();
    const swaps = await resolverService.getAllActiveSwaps();
    
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

// Get specific swap by ID
router.get('/:swapId', async (req, res) => {
  try {
    const { swapId } = req.params;
    const resolverService = app.getResolverService();
    const swap = await resolverService.getSwapStatus(swapId);
    
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

// Force refund a swap (emergency)
router.post('/:swapId/refund', async (req, res) => {
  try {
    const { swapId } = req.params;
    const resolverService = app.getResolverService();
    
    await resolverService.forceRefund(swapId);
    
    res.json({
      success: true,
      message: 'Refund initiated'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to initiate refund',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get resolver statistics
router.get('/stats/overview', async (req, res) => {
  try {
    const resolverService = app.getResolverService();
    const stats = resolverService.getStats();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch stats',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;