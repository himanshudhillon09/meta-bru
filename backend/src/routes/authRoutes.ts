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
import {
    getCredentials,
    removeCloudinaryCredentials,
    removeGeminiCredentials,
    removeMetaCredentials,
    saveCloudinaryCredentials,
    saveGeminiCredentials,
    saveMetaCredentials,
} from '../controllers/credentialController.js';
import { protect, authorize } from '../middlewares/authMiddleware.js';
import { authLimiter } from '../middlewares/rateLimiters.js';

const router = express.Router();

router.post('/register', authLimiter, registerUser);
router.post('/login', authLimiter, loginUser);
router.get('/me', protect, getMe);
router.get('/logout', protect, logoutUser);
router.patch('/profile', protect, updateProfile);

// Per-user integration credentials. These endpoints never return secrets.
router.get('/credentials', protect, getCredentials);
router.put('/credentials/meta', protect, saveMetaCredentials);
router.delete('/credentials/meta', protect, removeMetaCredentials);
router.put('/credentials/cloudinary', protect, saveCloudinaryCredentials);
router.delete('/credentials/cloudinary', protect, removeCloudinaryCredentials);
router.put('/credentials/gemini', protect, saveGeminiCredentials);
router.delete('/credentials/gemini', protect, removeGeminiCredentials);

// Admin routes
router.get('/users', protect, authorize('admin'), getUsers);
router.patch('/users/:id/status', protect, authorize('admin'), updateUserStatus);

export default router;
