import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env.js';
import { User } from '../models/userModel.js';
import { SocialConnection } from '../models/socialConnectionModel.js';
import { generateTemporaryPassword } from '../services/passwordService.js';
import { isValidTimezone } from '../services/timeService.js';
import { AppError } from '../utils/errors.js';
import { parseBody } from '../utils/validation.js';

function publicUser(user: any) {
    return {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        timezone: user.timezone,
        brandProfile: user.brandProfile || {},
        mustChangePassword: Boolean(user.mustChangePassword),
    };
}

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
                mustChangePassword: false,
                token: generateToken(
                    user._id.toString(),
                    user.tokenVersion ?? 0
                )
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
                mustChangePassword: Boolean(user.mustChangePassword),
                token: generateToken(
                    user._id.toString(),
                    user.tokenVersion ?? 0
                )
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
            user: publicUser(user),
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
        const users = await User.find({})
            .select(
                'name email role isActive timezone mustChangePassword createdAt updatedAt'
            )
            .sort({ createdAt: -1 });
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
    email: z
        .preprocess(
            (value) =>
                typeof value === 'string'
                    ? value.trim().toLowerCase()
                    : value,
            z.email().max(254)
        )
        .optional(),
    currentPassword: z.string().max(128).optional(),
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

    if (parsed.email && parsed.email !== user.email) {
        if (!parsed.currentPassword) {
            throw new AppError(
                400,
                'Enter your current password to change your email.',
                'CURRENT_PASSWORD_REQUIRED'
            );
        }

        const userWithPassword = await User.findById(req.user.id).select(
            '+password'
        );
        if (
            !userWithPassword ||
            !(await (userWithPassword as any).matchPassword(
                parsed.currentPassword
            ))
        ) {
            throw new AppError(
                400,
                'Current password is incorrect.',
                'INVALID_CURRENT_PASSWORD'
            );
        }

        const existing = await User.findOne({
            email: parsed.email,
            _id: { $ne: user._id },
        });
        if (existing) {
            throw new AppError(
                409,
                'Email is already in use.',
                'EMAIL_IN_USE'
            );
        }

        user.email = parsed.email;
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

    try {
        await user.save();
    } catch (error: any) {
        if (error?.code === 11000) {
            throw new AppError(
                409,
                'Email is already in use.',
                'EMAIL_IN_USE'
            );
        }
        throw error;
    }

    res.json({
        success: true,
        user: publicUser(user),
    });
};

const passwordChangeSchema = z.object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(6).max(128),
});

// @desc    Change the authenticated user's password
// @route   PATCH /api/auth/password
// @access  Private
export const changePassword = async (req: Request, res: Response) => {
    const parsed = parseBody(passwordChangeSchema, req);
    const user = await User.findById(req.user.id).select('+password');

    if (!user) {
        throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
    }

    if (!(await (user as any).matchPassword(parsed.currentPassword))) {
        throw new AppError(
            400,
            'Current password is incorrect.',
            'INVALID_CURRENT_PASSWORD'
        );
    }

    if (parsed.currentPassword === parsed.newPassword) {
        throw new AppError(
            400,
            'New password must be different from the current password.',
            'PASSWORD_UNCHANGED'
        );
    }

    user.password = parsed.newPassword;
    user.mustChangePassword = false;
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await user.save();

    res.json({
        success: true,
        token: generateToken(user._id.toString(), user.tokenVersion),
        user: publicUser(user),
    });
};

// @desc    Reset another user's password (Admin only)
// @route   PATCH /api/auth/users/:id/password
// @access  Private/Admin
export const resetUserPassword = async (req: any, res: Response) => {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) {
        throw new AppError(400, 'Invalid user ID', 'INVALID_USER_ID');
    }

    if (req.params.id.toLowerCase() === String(req.user.id).toLowerCase()) {
        throw new AppError(
            400,
            'Use your own Profile to change your password.',
            'USE_PROFILE_PASSWORD_CHANGE'
        );
    }

    const user = await User.findById(req.params.id);
    if (!user) {
        throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
    }

    const temporaryPassword = generateTemporaryPassword();
    user.password = temporaryPassword;
    user.mustChangePassword = true;
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await user.save();

    res.json({
        success: true,
        temporaryPassword,
        user: publicUser(user),
    });
};

// Generate JWT
const generateToken = (id: string, tokenVersion = 0) => {
    return jwt.sign({ id, tokenVersion }, env.jwtSecret, {
        expiresIn: '30d',
    });
};
