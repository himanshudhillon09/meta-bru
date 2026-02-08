import express from 'express';
import { registerUser, loginUser, getMe, logoutUser, getUsers, updateUserStatus } from '../controllers/authController.js';
import { protect, authorize } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.get('/me', protect, getMe);
router.get('/logout', protect, logoutUser);

// Admin routes
router.get('/users', protect, authorize('admin'), getUsers);
router.patch('/users/:id/status', protect, authorize('admin'), updateUserStatus);

export default router;
