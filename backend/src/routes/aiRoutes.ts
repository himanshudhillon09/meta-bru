import express from 'express';
import {
    createAiImage,
    draftCaption,
    draftOverlayText,
    listClaudeModelOptions,
    listModels,
} from '../controllers/aiController.js';
import { protect } from '../middlewares/authMiddleware.js';
import { aiLimiter, aiModelsLimiter } from '../middlewares/rateLimiters.js';

const router = express.Router();

router.use(protect);

// Listing models costs no AI quota, so it has its own, looser limit.
router.get('/models', aiModelsLimiter, listModels);
router.get('/claude-models', aiModelsLimiter, listClaudeModelOptions);
router.post('/caption', aiLimiter, draftCaption);
router.post('/image', aiLimiter, createAiImage);
router.post('/overlay-text', aiLimiter, draftOverlayText);

export default router;
