import express from 'express';
import {
    createVideoSignature,
    deleteMedia,
    discardImage,
    getStorageOverview,
    previewText,
    registerVideo,
    uploadMedia,
} from '../controllers/mediaController.js';
import { protect } from '../middlewares/authMiddleware.js';
import {
    mediaLimiter,
    storageLimiter,
    textPreviewLimiter,
} from '../middlewares/rateLimiters.js';
import { uploadImageMiddleware } from '../middlewares/uploadMiddleware.js';

const router = express.Router();

router.get('/storage', protect, storageLimiter, getStorageOverview);
router.post('/delete', protect, storageLimiter, deleteMedia);
router.post('/upload', protect, mediaLimiter, uploadImageMiddleware, uploadMedia);
router.post('/discard', protect, mediaLimiter, discardImage);
router.post('/video-signature', protect, mediaLimiter, createVideoSignature);
router.post('/videos', protect, mediaLimiter, registerVideo);
router.post('/text-preview', protect, textPreviewLimiter, previewText);

export default router;
