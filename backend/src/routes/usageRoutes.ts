import express from 'express';
import {
    getUsage,
    updateClaudeLimits,
    updateGeminiLimits,
} from '../controllers/usageController.js';
import { protect } from '../middlewares/authMiddleware.js';
import { analyticsReadLimiter } from '../middlewares/rateLimiters.js';

const router = express.Router();

router.use(protect);
router.get('/', analyticsReadLimiter, getUsage);
router.put('/gemini-limits', analyticsReadLimiter, updateGeminiLimits);
router.put('/claude-limits', analyticsReadLimiter, updateClaudeLimits);

export default router;
