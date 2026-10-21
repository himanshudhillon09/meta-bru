import express from 'express';
import {
    registerUser,
    loginUser,
    getMe,
    logoutUser,
    getUsers,
    updateUserStatus,
    updateProfile,
} from '../controllers/authController.js';
import { protect, authorize } from '../middlewares/authMiddleware.js';
import { authLimiter } from '../middlewares/rateLimiters.js';

const router = express.Router();

router.post('/register', authLimiter, registerUser);
router.post('/login', authLimiter, loginUser);
router.get('/me', protect, getMe);
router.get('/logout', protect, logoutUser);
router.patch('/profile', protect, updateProfile);

// Admin routes
router.get('/users', protect, authorize('admin'), getUsers);
router.patch('/users/:id/status', protect, authorize('admin'), updateUserStatus);

export default router;
