import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
    const value = process.env[name];
    if (!value || !value.trim()) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value.trim();
}

function optional(name: string): string {
    return (process.env[name] || '').trim();
}

function numberFromEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}

const clientUrls = (process.env.CLIENT_URL || 'http://localhost:3000,http://localhost:3001')
    .split(',')
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter(Boolean);

const tokenEncryptionKey = required('TOKEN_ENCRYPTION_KEY');
if (!/^[a-f\d]{64}$/i.test(tokenEncryptionKey)) {
    throw new Error(
        'TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). Generate one with: openssl rand -hex 32'
    );
}

const jwtSecret = required('JWT_SECRET');
if (jwtSecret.length < 32) {
    throw new Error(
        'JWT_SECRET must be at least 32 characters. Generate one with: openssl rand -hex 32'
    );
}

const frontendUrl = (
    optional('FRONTEND_URL') ||
    clientUrls[0] ||
    'http://localhost:3000'
).replace(/\/$/, '');

const defaultTimezone = process.env.APP_DEFAULT_TIMEZONE || 'Asia/Kolkata';
try {
    new Intl.DateTimeFormat('en-US', { timeZone: defaultTimezone }).format();
} catch {
    throw new Error(
        `APP_DEFAULT_TIMEZONE must be a valid IANA timezone (received: ${defaultTimezone})`
    );
}

export const env = {
    port: numberFromEnv('PORT', 5001),
    mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
    dbName: process.env.DB_NAME || 'meta-bru',
    jwtSecret,
    tokenEncryptionKey,
    clientUrls,
    /** Where OAuth callbacks send the browser (must be a frontend origin). */
    frontendUrl,
    defaultTimezone,
    meta: {
        appId: optional('META_APP_ID'),
        appSecret: optional('META_APP_SECRET'),
        redirectUri: optional('META_REDIRECT_URI'),
        graphVersion: process.env.META_GRAPH_VERSION || 'v26.0',
        scopes:
            process.env.META_SCOPES ||
            [
                'pages_show_list',
                'pages_read_engagement',
                'pages_manage_posts',
                'instagram_basic',
                'instagram_content_publish',
            ].join(','),
    },
    cloudinary: {
        cloudName: optional('CLOUDINARY_CLOUD_NAME'),
        apiKey: optional('CLOUDINARY_API_KEY'),
        apiSecret: optional('CLOUDINARY_API_SECRET'),
    },
    gemini: {
        apiKey: optional('GEMINI_API_KEY'),
        textModel: process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash',
        imageModel: process.env.GEMINI_IMAGE_MODEL || 'imagen-4.0-generate-001',
    },
    scheduler: {
        enabled: process.env.SCHEDULER_ENABLED !== 'false',
        graceMinutes: Math.max(0, numberFromEnv('SCHEDULER_GRACE_MINUTES', 180)),
        intervalMs: 60_000,
    },
};

export const isMetaConfigured = Boolean(
    env.meta.appId && env.meta.appSecret && env.meta.redirectUri
);

export const isCloudinaryConfigured = Boolean(
    env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret
);

export const isGeminiConfigured = Boolean(env.gemini.apiKey);

if (!isMetaConfigured) {
    console.warn('[config] Meta app credentials are missing. Connection and publishing endpoints will return 503.');
}
if (!isCloudinaryConfigured) {
    console.warn('[config] Cloudinary credentials are missing. Media upload and AI image endpoints will return 503.');
}
if (!isGeminiConfigured) {
    console.warn('[config] GEMINI_API_KEY is missing. AI assist endpoints will return 503.');
}
