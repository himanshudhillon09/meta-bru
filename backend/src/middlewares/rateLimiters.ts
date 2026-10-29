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

export const passwordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: userKey,
    message: {
        success: false,
        message:
            'Too many sensitive account attempts. Try again in a few minutes.',
    },
});

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

export const aiModelsLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: userKey,
    message: {
        success: false,
        message: 'Model list limit reached. Try again in a few minutes.',
    },
});

export const storageLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: userKey,
    message: {
        success: false,
        message:
            'Storage request limit reached. Try again in a few minutes.',
    },
});

// Composer previews refresh as the user types, so this is looser than uploads.
export const textPreviewLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 150,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: userKey,
    message: {
        success: false,
        message: 'Preview limit reached. Try again in a few minutes.',
    },
});

export const analyticsReadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: userKey,
    message: {
        success: false,
        message:
            'Analytics request limit reached. Try again in a few minutes.',
    },
});

export const analyticsSyncLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: userKey,
    message: {
        success: false,
        message: 'Analytics sync limit reached. Try again in a few minutes.',
    },
});
