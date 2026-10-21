import express from 'express';
import {
    adminConnections,
    adminOverview,
    adminPosts,
} from '../controllers/adminController.js';
import { authorize, protect } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(protect, authorize('admin'));

router.get('/overview', adminOverview);
router.get('/connections', adminConnections);
router.get('/posts', adminPosts);

export default router;
