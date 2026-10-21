import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env.js';
import { User } from '../models/userModel.js';
import { SocialConnection } from '../models/socialConnectionModel.js';
import { isValidTimezone } from '../services/timeService.js';
import { AppError } from '../utils/errors.js';
import { parseBody } from '../utils/validation.js';

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
export const registerUser = async (req: Request, res: Response) => {
    try {
        const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
        const email =
            typeof req.body.email === 'string'
                ? req.body.email.trim().toLowerCase()
                : '';
        const password =
            typeof req.body.password === 'string' ? req.body.password : '';

        if (!name || name.length > 80) {
            res.status(400).json({
                success: false,
                message: 'Name is required and must be 80 characters or fewer',
            });
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            res.status(400).json({
                success: false,
                message: 'Please provide a valid email address',
            });
            return;
        }
        if (password.length < 6 || password.length > 128) {
            res.status(400).json({
                success: false,
                message: 'Password must be between 6 and 128 characters',
            });
            return;
        }

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
                timezone: user.timezone,
                brandProfile: user.brandProfile || {},
                token: generateToken(user._id.toString())
            });
        } else {
            res.status(400).json({ success: false, message: 'Invalid user data' });
        }
    } catch (error: any) {
        if (error?.code === 11000) {
            res.status(400).json({ success: false, message: 'User already exists' });
            return;
        }
        console.error('[auth] Request failed:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// @desc    Authenticate a user
// @route   POST /api/auth/login
// @access  Public
export const loginUser = async (req: Request, res: Response) => {
    try {
        const email =
            typeof req.body.email === 'string'
                ? req.body.email.trim().toLowerCase()
                : '';
        const password =
            typeof req.body.password === 'string' ? req.body.password : '';

        if (!email || !password) {
            res.status(400).json({
                success: false,
                message: 'Email and password are required',
            });
            return;
        }

        // Check for user email
        const user = await User.findOne({ email }).select('+password');

        if (user && (await (user as any).matchPassword(password))) {
            if (!user.isActive) {
                res.status(403).json({ success: false, message: 'Your account is currently inactive. Please contact support.' });
                return;
            }

            res.json({
                success: true,
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                isActive: user.isActive,
                timezone: user.timezone,
                brandProfile: user.brandProfile || {},
                token: generateToken(user._id.toString())
            });
        } else {
            res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
    } catch (error: any) {
        console.error('[auth] Request failed:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// @desc    Get user data
// @route   GET /api/auth/me
// @access  Private
export const getMe = async (req: any, res: Response) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            res.status(404).json({ success: false, message: 'User not found' });
            return;
        }
        res.status(200).json({
            success: true,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                isActive: user.isActive,
                timezone: user.timezone,
                brandProfile: user.brandProfile || {}
            }
        });
    } catch (error: any) {
        console.error('[auth] Request failed:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// @desc    Logout user
// @route   GET /api/auth/logout
// @access  Private
export const logoutUser = async (req: Request, res: Response) => {
    res.status(200).json({ success: true, message: 'Logged out successfully' });
};

// @desc    Get all users (Admin only)
// @route   GET /api/auth/users
// @access  Private/Admin
export const getUsers = async (req: Request, res: Response) => {
    try {
        const users = await User.find({}).sort({ createdAt: -1 });
        res.json({ success: true, users });
    } catch (error: any) {
        console.error('[auth] Request failed:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// @desc    Update user status (Admin only)
// @route   PATCH /api/auth/users/:id/status
// @access  Private/Admin
export const updateUserStatus = async (req: any, res: Response) => {
    try {
        if (!/^[a-f\d]{24}$/i.test(req.params.id)) {
            res.status(400).json({ success: false, message: 'Invalid user ID' });
            return;
        }
        if (req.params.id.toLowerCase() === String(req.user.id).toLowerCase()) {
            res.status(400).json({ success: false, message: 'You cannot change your own account status' });
            return;
        }

        if (
            req.body.isActive !== undefined &&
            typeof req.body.isActive !== 'boolean'
        ) {
            res.status(400).json({
                success: false,
                message: 'isActive must be a boolean',
            });
            return;
        }

        const user = await User.findById(req.params.id);
        if (user) {
            user.isActive =
                typeof req.body.isActive === 'boolean'
                    ? req.body.isActive
                    : !user.isActive;
            await user.save();

            // A deactivated user must not keep publishing through the scheduler.
            if (!user.isActive) {
                await SocialConnection.updateMany(
                    { userId: user._id },
                    { $set: { isActive: false } }
                );
            }

            res.json({ success: true, user });
        } else {
            res.status(404).json({ success: false, message: 'User not found' });
        }
    } catch (error: any) {
        console.error('[auth] Request failed:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// @desc    Update profile and brand settings
// @route   PATCH /api/auth/profile
// @access  Private
const profileSchema = z.object({
    name: z.string().trim().min(1).max(80).optional(),
    timezone: z.string().min(1).max(64).optional(),
    brandProfile: z
        .object({
            niche: z.string().trim().max(200).optional(),
            tone: z.string().trim().max(100).optional(),
            audience: z.string().trim().max(300).optional(),
            keywords: z.string().trim().max(300).optional(),
        })
        .optional(),
});

export const updateProfile = async (req: Request, res: Response) => {
    const parsed = parseBody(profileSchema, req);

    if (parsed.timezone && !isValidTimezone(parsed.timezone)) {
        throw new AppError(400, 'Invalid IANA timezone', 'INVALID_TIMEZONE');
    }

    const user = await User.findById(req.user.id);
    if (!user) {
        throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
    }

    if (parsed.name !== undefined) user.name = parsed.name;
    if (parsed.timezone !== undefined) user.timezone = parsed.timezone;

    if (parsed.brandProfile) {
        const current = (user.brandProfile || {}) as {
            niche?: string;
            tone?: string;
            audience?: string;
            keywords?: string;
        };
        user.brandProfile = {
            niche: parsed.brandProfile.niche ?? current.niche ?? '',
            tone:
                parsed.brandProfile.tone ??
                current.tone ??
                'friendly and engaging',
            audience: parsed.brandProfile.audience ?? current.audience ?? '',
            keywords: parsed.brandProfile.keywords ?? current.keywords ?? '',
        };
    }

    await user.save();

    res.json({
        success: true,
        user: {
            id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            isActive: user.isActive,
            timezone: user.timezone,
            brandProfile: user.brandProfile,
        },
    });
};

// Generate JWT
const generateToken = (id: string) => {
    return jwt.sign({ id }, env.jwtSecret, {
        expiresIn: '30d',
    });
};
