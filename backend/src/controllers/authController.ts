import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/userModel.js';

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
export const registerUser = async (req: Request, res: Response) => {
    try {
        const { name, email, password } = req.body;

        // Check if user exists
        const userExists = await User.findOne({ email });

        if (userExists) {
            res.status(400).json({ success: false, message: 'User already exists' });
            return;
        }

        // Create user
        const user = await User.create({
            name,
            email,
            password,
            role: 'user'
        });

        if (user) {
            res.status(201).json({
                success: true,
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                isActive: user.isActive,
                token: generateToken(user._id.toString())
            });
        } else {
            res.status(400).json({ success: false, message: 'Invalid user data' });
        }
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Authenticate a user
// @route   POST /api/auth/login
// @access  Public
export const loginUser = async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;

        // Check for user email
        const user = await User.findOne({ email }).select('+password');

        if (user && (await (user as any).matchPassword(password))) {
            if (!user.isActive) {
                res.status(403).json({ success: false, message: 'Your account has been deactivated. Please contact support.' });
                return;
            }

            res.json({
                success: true,
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                isActive: user.isActive,
                token: generateToken(user._id.toString())
            });
        } else {
            res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get user data
// @route   GET /api/auth/me
// @access  Private
export const getMe = async (req: any, res: Response) => {
    try {
        const user = await User.findById(req.user.id);
        res.status(200).json({
            success: true,
            user: {
                id: user?._id,
                name: user?.name,
                email: user?.email,
                role: user?.role,
                isActive: user?.isActive
            }
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Logout user
// @route   GET /api/auth/logout
// @access  Private
export const logoutUser = async (req: Request, res: Response) => {
    res.status(200).json({ success: true, message: 'Logged out successfully' });
};

// Generate JWT
const generateToken = (id: string) => {
    return jwt.sign({ id }, process.env.JWT_SECRET || 'secret', {
        expiresIn: '30d',
    });
};
