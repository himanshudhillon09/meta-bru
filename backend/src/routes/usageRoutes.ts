import express from 'express';
import { getUsage, updateGeminiLimits } from '../controllers/usageController.js';
import { protect } from '../middlewares/authMiddleware.js';
import { analyticsReadLimiter } from '../middlewares/rateLimiters.js';

const router = express.Router();

router.use(protect);
router.get('/', analyticsReadLimiter, getUsage);
router.put('/gemini-limits', analyticsReadLimiter, updateGeminiLimits);

export default router;
