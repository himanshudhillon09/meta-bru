import express from 'express';
import {
    createAiImage,
    draftCaption,
    draftOverlayText,
} from '../controllers/aiController.js';
import { protect } from '../middlewares/authMiddleware.js';
import { aiLimiter } from '../middlewares/rateLimiters.js';

const router = express.Router();

router.use(protect, aiLimiter);

router.post('/caption', draftCaption);
router.post('/image', createAiImage);
router.post('/overlay-text', draftOverlayText);

export default router;
