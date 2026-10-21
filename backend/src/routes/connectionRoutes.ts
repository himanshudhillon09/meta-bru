import express from 'express';
import {
    completeMetaOAuth,
    deleteConnection,
    listConnections,
    metaOAuthCallback,
    startMetaOAuth,
    updateConnection,
} from '../controllers/connectionController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.get('/meta/callback', metaOAuthCallback);
router.post('/meta/complete', protect, completeMetaOAuth);
router.get('/meta/start', protect, startMetaOAuth);
router.get('/', protect, listConnections);
router.patch('/:id', protect, updateConnection);
router.delete('/:id', protect, deleteConnection);

export default router;
