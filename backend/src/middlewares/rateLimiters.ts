import rateLimit from 'express-rate-limit';

export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 50,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many attempts. Please try again in a few minutes.',
    },
});

function userKey(req: { user?: { id?: string } }): string {
    return req.user?.id || 'anonymous';
}

export const aiLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: userKey,
    message: {
        success: false,
        message: 'AI assist limit reached. Try again in an hour.',
    },
});

export const mediaLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 40,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: userKey,
    message: {
        success: false,
        message: 'Upload limit reached. Try again in an hour.',
    },
});
