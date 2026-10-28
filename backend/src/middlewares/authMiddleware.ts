import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/userModel.js';

interface AuthRequest extends Request {
    user?: any;
    tokenIssuedAt?: number;
}

function unauthorized(res: Response, message: string, code: string): void {
    res.status(401).json({ success: false, code, message });
}

export const protect = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer') ? header.split(' ')[1] : '';

    if (!token) {
        unauthorized(res, 'Not authorized, token missing', 'TOKEN_MISSING');
        return;
    }

    // Only a bad or expired token is a 401. The client treats 401 as "signed
    // out", so failures after this point (for example a database hiccup) must
    // surface as server errors instead of ending the session.
    let decoded: any;
    try {
        decoded = jwt.verify(token, env.jwtSecret);
    } catch (error) {
        const expired = error instanceof jwt.TokenExpiredError;
        unauthorized(
            res,
            expired
                ? 'Session expired. Please sign in again.'
                : 'Not authorized, token failed',
            expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID'
        );
        return;
    }

    if (!decoded?.id || decoded.purpose) {
        unauthorized(res, 'Not authorized, token failed', 'TOKEN_INVALID');
        return;
    }

    // Add user to request (fetch from DB without password). A lookup failure
    // propagates to the error handler as a 5xx.
    req.user = await User.findById(decoded.id);
    req.tokenIssuedAt = typeof decoded.iat === 'number' ? decoded.iat : 0;

    if (!req.user) {
        unauthorized(res, 'Not authorized, user not found', 'USER_NOT_FOUND');
        return;
    }

    if (!req.user.isActive) {
        res.status(403).json({
            success: false,
            code: 'ACCOUNT_INACTIVE',
            message: 'Your account is inactive',
        });
        return;
    }

    const presentedVersion =
        typeof decoded.tokenVersion === 'number'
            ? decoded.tokenVersion
            : 0;
    const currentVersion =
        typeof req.user.tokenVersion === 'number'
            ? req.user.tokenVersion
            : 0;

    if (presentedVersion !== currentVersion) {
        unauthorized(
            res,
            'Session expired. Please sign in again.',
            'SESSION_REVOKED'
        );
        return;
    }

    if (req.user.mustChangePassword) {
        const path =
            (req.originalUrl || '')
                .split('?')[0]
                ?.replace(/\/+$/, '') || '';
        const allowed =
            (req.method === 'GET' && path === '/api/auth/me') ||
            (req.method === 'PATCH' && path === '/api/auth/password') ||
            (req.method === 'GET' && path === '/api/auth/logout');

        if (!allowed) {
            res.status(403).json({
                success: false,
                code: 'PASSWORD_CHANGE_REQUIRED',
                message: 'You must change your password before continuing.',
            });
            return;
        }
    }

    next();
};

// Middleware to restrict access based on roles
export const authorize = (...roles: string[]) => {
    return (req: any, res: Response, next: NextFunction) => {
        if (!req.user || !roles.includes(req.user.role)) {
            res.status(403).json({
                success: false,
                message: `User role ${req.user?.role || 'unknown'} is not authorized to access this route`
            });
            return;
        }
        next();
    };
};
