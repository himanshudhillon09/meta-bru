import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/userModel.js';

interface AuthRequest extends Request {
    user?: any;
}

export const protect = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            // Get token from header
            token = req.headers.authorization.split(' ')[1];

            if (!token) {
                res.status(401).json({ success: false, message: 'Not authorized, no token' });
                return;
            }

            // Verify token
            const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'secret');

            // Add user to request (fetch from DB without password)
            req.user = await User.findById(decoded.id);

            if (!req.user) {
                res.status(401).json({ success: false, message: 'Not authorized, user not found' });
                return;
            }

            if (!req.user.isActive) {
                res.status(403).json({ success: false, message: 'Your account is inactive' });
                return;
            }

            next();
        } catch (error) {
            console.error(error);
            res.status(401).json({ success: false, message: 'Not authorized, token failed' });
        }
    } else {
        res.status(401).json({ success: false, message: 'Not authorized, token missing' });
    }
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
