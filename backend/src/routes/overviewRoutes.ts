import express from 'express';
import { getOverview } from '../controllers/overviewController.js';
import { protect } from '../middlewares/authMiddleware.js';
import { analyticsReadLimiter } from '../middlewares/rateLimiters.js';

const router = express.Router();

router.use(protect);
router.get('/', analyticsReadLimiter, getOverview);

export default router;
