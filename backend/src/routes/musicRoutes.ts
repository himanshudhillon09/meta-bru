import express from 'express';
import {
    addTrack,
    createTrackSignature,
    deleteTrack,
    listTracks,
    searchInstagramMusic,
} from '../controllers/musicController.js';
import { protect } from '../middlewares/authMiddleware.js';
import { mediaLimiter, musicLimiter } from '../middlewares/rateLimiters.js';

const router = express.Router();

router.get('/tracks', protect, musicLimiter, listTracks);
router.post('/tracks/signature', protect, mediaLimiter, createTrackSignature);
router.post('/tracks', protect, mediaLimiter, addTrack);
router.delete('/tracks/:id', protect, musicLimiter, deleteTrack);
router.get('/instagram', protect, musicLimiter, searchInstagramMusic);

export default router;
