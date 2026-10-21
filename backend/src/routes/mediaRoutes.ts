import express from 'express';
import { uploadMedia } from '../controllers/mediaController.js';
import { protect } from '../middlewares/authMiddleware.js';
import { mediaLimiter } from '../middlewares/rateLimiters.js';
import { uploadImageMiddleware } from '../middlewares/uploadMiddleware.js';

const router = express.Router();

router.post('/upload', protect, mediaLimiter, uploadImageMiddleware, uploadMedia);

export default router;
