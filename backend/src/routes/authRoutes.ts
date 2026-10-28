import express from 'express';
import {
    registerUser,
    loginUser,
    getMe,
    logoutUser,
    getUsers,
    updateUserStatus,
    updateProfile,
    changePassword,
    resetUserPassword,
} from '../controllers/authController.js';
import {
    getCredentials,
    removeCloudinaryCredentials,
    removeGeminiCredentials,
    removeMetaCredentials,
    revealCredentials,
    saveCloudinaryCredentials,
    saveGeminiCredentials,
    saveMetaCredentials,
} from '../controllers/credentialController.js';
import {
    deleteBrandLogo,
    getBrandLogo,
    uploadBrandLogo,
} from '../controllers/brandLogoController.js';
import { protect, authorize } from '../middlewares/authMiddleware.js';
import {
    authLimiter,
    mediaLimiter,
    passwordLimiter,
} from '../middlewares/rateLimiters.js';
import { uploadImageMiddleware } from '../middlewares/uploadMiddleware.js';

const router = express.Router();

router.post('/register', authLimiter, registerUser);
router.post('/login', authLimiter, loginUser);
router.get('/me', protect, getMe);
router.get('/logout', protect, logoutUser);
router.patch('/profile', protect, passwordLimiter, updateProfile);
router.patch('/password', protect, passwordLimiter, changePassword);

// Per-user integration credentials. These endpoints never return secrets.
router.get('/credentials', protect, getCredentials);
router.post(
    '/credentials/reveal',
    protect,
    passwordLimiter,
    revealCredentials
);
router.put('/credentials/meta', protect, saveMetaCredentials);
router.delete('/credentials/meta', protect, removeMetaCredentials);
router.put('/credentials/cloudinary', protect, saveCloudinaryCredentials);
router.delete('/credentials/cloudinary', protect, removeCloudinaryCredentials);
router.put('/credentials/gemini', protect, saveGeminiCredentials);
router.delete('/credentials/gemini', protect, removeGeminiCredentials);

// Brand logo embedded in the frame of every new post image.
router.get('/brand-logo', protect, getBrandLogo);
router.post(
    '/brand-logo',
    protect,
    mediaLimiter,
    uploadImageMiddleware,
    uploadBrandLogo
);
router.delete('/brand-logo', protect, deleteBrandLogo);

// Admin routes
router.get('/users', protect, authorize('admin'), getUsers);
router.patch('/users/:id/status', protect, authorize('admin'), updateUserStatus);
router.patch(
    '/users/:id/password',
    protect,
    authorize('admin'),
    resetUserPassword
);

export default router;
