import express from 'express';
import {
    completeMetaOAuth,
    disconnectConnection,
    listConnections,
    metaOAuthCallback,
    startMetaOAuth,
    updateConnection,
} from '../controllers/connectionController.js';
import {
    deleteBrandLogo,
    getBrandLogo,
    uploadBrandLogo,
} from '../controllers/brandLogoController.js';
import { protect } from '../middlewares/authMiddleware.js';
import { mediaLimiter } from '../middlewares/rateLimiters.js';
import { uploadImageMiddleware } from '../middlewares/uploadMiddleware.js';

const router = express.Router();

router.get('/meta/callback', metaOAuthCallback);
router.post('/meta/complete', protect, completeMetaOAuth);
router.get('/meta/start', protect, startMetaOAuth);
router.get('/', protect, listConnections);
router.patch('/:id', protect, updateConnection);
router.delete('/:id', protect, disconnectConnection);

// Each Page's logo, embedded in the frame of its new post images.
router.get('/:id/brand-logo', protect, getBrandLogo);
router.post('/:id/brand-logo', protect, mediaLimiter, uploadImageMiddleware, uploadBrandLogo);
router.delete('/:id/brand-logo', protect, deleteBrandLogo);

export default router;
