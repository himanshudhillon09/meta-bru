import express from 'express';
import { createAiImage, draftCaption } from '../controllers/aiController.js';
import { protect } from '../middlewares/authMiddleware.js';
import { aiLimiter } from '../middlewares/rateLimiters.js';

const router = express.Router();

router.use(protect, aiLimiter);

router.post('/caption', draftCaption);
router.post('/image', createAiImage);

export default router;
