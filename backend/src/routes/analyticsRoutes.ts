import express from 'express';
import {
    generateTips,
    listPosts,
    monitor,
    overview,
    stories,
    sync,
    tips,
} from '../controllers/analyticsController.js';
import { protect } from '../middlewares/authMiddleware.js';
import {
    aiLimiter,
    analyticsReadLimiter,
    analyticsSyncLimiter,
} from '../middlewares/rateLimiters.js';

const router = express.Router();

router.use(protect);
router.get('/overview', analyticsReadLimiter, overview);
router.get('/monitor', analyticsReadLimiter, monitor);
router.get('/posts', analyticsReadLimiter, listPosts);
router.get('/stories', analyticsReadLimiter, stories);
router.post('/sync', analyticsSyncLimiter, sync);
router.get('/tips', analyticsReadLimiter, tips);
router.post('/tips', aiLimiter, generateTips);

export default router;
