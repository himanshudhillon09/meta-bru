import express from 'express';
import {
    deleteMedia,
    getStorageOverview,
    uploadMedia,
} from '../controllers/mediaController.js';
import { protect } from '../middlewares/authMiddleware.js';
import {
    mediaLimiter,
    storageLimiter,
} from '../middlewares/rateLimiters.js';
import { uploadImageMiddleware } from '../middlewares/uploadMiddleware.js';

const router = express.Router();

router.get('/storage', protect, storageLimiter, getStorageOverview);
router.post('/delete', protect, storageLimiter, deleteMedia);
router.post('/upload', protect, mediaLimiter, uploadImageMiddleware, uploadMedia);

export default router;
