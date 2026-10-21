import { env } from '../config/env.js';
import { SocialConnection } from '../models/socialConnectionModel.js';
import { User } from '../models/userModel.js';
import { AppError } from '../utils/errors.js';
import { decryptSecret, encryptSecret } from './cryptoService.js';

export interface MetaCredentials {
    appId: string;
    appSecret: string;
}

export interface CloudinaryCredentials {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
}

export interface GeminiCredentials {
    apiKey: string;
}

export interface CredentialStore {
    meta?: MetaCredentials;
    cloudinary?: CloudinaryCredentials;
    gemini?: GeminiCredentials;
}

export interface CredentialStatus {
    storageError: string;
    meta: {
        configured: boolean;
        appId: string;
        appSecretConfigured: boolean;
        redirectUri: string;
        scopes: string[];
        connectionsCount: number;
        needsReauthCount: number;
    };
    cloudinary: {
        configured: boolean;
        cloudName: string;
        apiKeyConfigured: boolean;
        apiSecretConfigured: boolean;
    };
    gemini: {
        configured: boolean;
    };
}

function requiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`Invalid credential field: ${field}`);
    }
    return value.trim();
}

function optionalObject(value: unknown, field: string): Record<string, unknown> | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Invalid credential field: ${field}`);
    }
    return value as Record<string, unknown>;
}

/**
 * Decrypts and validates the credential blob. Exported so the format can be
 * covered by unit tests without touching the database.
 */
export function parseCredentialStore(payload: string): CredentialStore {
    if (!payload) return {};

    let parsed: unknown;
    try {
        parsed = JSON.parse(decryptSecret(payload));
    } catch {
        throw new Error('Invalid encrypted credential payload');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid credential payload');
    }

    const record = parsed as Record<string, unknown>;
    const store: CredentialStore = {};

    const meta = optionalObject(record.meta, 'meta');
    if (meta) {
        store.meta = {
            appId: requiredString(meta.appId, 'meta.appId'),
            appSecret: requiredString(meta.appSecret, 'meta.appSecret'),
        };
    }

    const cloudinary = optionalObject(record.cloudinary, 'cloudinary');
    if (cloudinary) {
        store.cloudinary = {
            cloudName: requiredString(cloudinary.cloudName, 'cloudinary.cloudName'),
            apiKey: requiredString(cloudinary.apiKey, 'cloudinary.apiKey'),
            apiSecret: requiredString(cloudinary.apiSecret, 'cloudinary.apiSecret'),
        };
    }

    const gemini = optionalObject(record.gemini, 'gemini');
    if (gemini) {
        store.gemini = {
            apiKey: requiredString(gemini.apiKey, 'gemini.apiKey'),
        };
    }

    return store;
}

async function readStore(
    userId: string,
    tolerateCorrupt = false
): Promise<CredentialStore> {
    const user = await User.findById(userId).select('+credentialsEnc');
    if (!user) {
        throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
    }

    const payload =
        typeof (user as unknown as { credentialsEnc?: string }).credentialsEnc === 'string'
            ? (user as unknown as { credentialsEnc?: string }).credentialsEnc || ''
            : '';

    if (!payload) return {};

    try {
        return parseCredentialStore(payload);
    } catch {
        if (tolerateCorrupt) return {};
        throw new AppError(
            500,
            'Stored credentials could not be decrypted. Re-enter them under Profile.',
            'CREDENTIALS_UNREADABLE'
        );
    }
}

async function saveStore(userId: string, store: CredentialStore): Promise<void> {
    const hasCredentials = Boolean(
        store.meta || store.cloudinary || store.gemini
    );
    const credentialsEnc = hasCredentials
        ? encryptSecret(JSON.stringify(store))
        : '';

    await User.updateOne(
        { _id: userId },
        { $set: { credentialsEnc } }
    );
}

async function markConnectionsForReconnect(userId: string): Promise<void> {
    await SocialConnection.updateMany(
        { userId },
        {
            $set: {
                tokenStatus: 'needs_reauth',
                lastError:
                    'Meta app credentials changed. Reconnect this Page with your Meta app.',
            },
        }
    );
}

export async function getMetaCredentials(userId: string): Promise<MetaCredentials> {
    const store = await readStore(userId);
    if (!store.meta) {
        throw new AppError(
            503,
            'Meta app credentials are not configured. Add your Meta App ID and App Secret under Profile.',
            'META_NOT_CONFIGURED'
        );
    }
    return store.meta;
}

export async function getCloudinaryCredentials(
    userId: string
): Promise<CloudinaryCredentials> {
    const store = await readStore(userId);
    if (!store.cloudinary) {
        throw new AppError(
            503,
            'Cloudinary credentials are not configured. Add your Cloudinary cloud name, API key and API secret under Profile.',
            'MEDIA_NOT_CONFIGURED'
        );
    }
    return store.cloudinary;
}

export async function getGeminiCredentials(userId: string): Promise<GeminiCredentials> {
    const store = await readStore(userId);
    if (!store.gemini) {
        throw new AppError(
            503,
            'Gemini API key is not configured. Add your own key under Profile.',
            'AI_NOT_CONFIGURED'
        );
    }
    return store.gemini;
}

export async function getCredentialStatus(
    userId: string,
    redirectUri: string
): Promise<CredentialStatus> {
    let store: CredentialStore = {};
    let storageError = '';

    try {
        store = await readStore(userId);
    } catch (error) {
        if (error instanceof AppError && error.code === 'CREDENTIALS_UNREADABLE') {
            storageError = error.message;
        } else {
            throw error;
        }
    }

    const [connectionsCount, needsReauthCount] = await Promise.all([
        SocialConnection.countDocuments({ userId }),
        SocialConnection.countDocuments({ userId, tokenStatus: 'needs_reauth' }),
    ]);

    return {
        storageError,
        meta: {
            configured: Boolean(store.meta),
            appId: store.meta?.appId || '',
            appSecretConfigured: Boolean(store.meta?.appSecret),
            redirectUri,
            scopes: env.meta.scopes,
            connectionsCount,
            needsReauthCount,
        },
        cloudinary: {
            configured: Boolean(store.cloudinary),
            cloudName: store.cloudinary?.cloudName || '',
            apiKeyConfigured: Boolean(store.cloudinary?.apiKey),
            apiSecretConfigured: Boolean(store.cloudinary?.apiSecret),
        },
        gemini: {
            configured: Boolean(store.gemini),
        },
    };
}

export async function updateMetaCredentials(
    userId: string,
    input: { appId: string; appSecret?: string }
): Promise<void> {
    const current = await readStore(userId, true);
    const providedAppSecret = input.appSecret?.trim() || '';

    if (
        current.meta &&
        current.meta.appId !== input.appId &&
        !providedAppSecret
    ) {
        throw new AppError(
            400,
            'Enter the App Secret for the new Meta app. A secret from a different app cannot be reused.',
            'VALIDATION_ERROR'
        );
    }

    const appSecret = providedAppSecret || current.meta?.appSecret || '';

    if (!appSecret) {
        throw new AppError(
            400,
            'Meta App Secret is required the first time you save Meta credentials.',
            'VALIDATION_ERROR'
        );
    }

    const changed =
        current.meta?.appId !== input.appId ||
        current.meta?.appSecret !== appSecret;

    await saveStore(userId, {
        ...current,
        meta: {
            appId: input.appId,
            appSecret,
        },
    });

    if (changed) {
        await markConnectionsForReconnect(userId);
    }
}

export async function updateCloudinaryCredentials(
    userId: string,
    input: { cloudName: string; apiKey?: string; apiSecret?: string }
): Promise<void> {
    const current = await readStore(userId, true);
    const providedApiKey = input.apiKey?.trim() || '';
    const providedApiSecret = input.apiSecret?.trim() || '';

    if (
        current.cloudinary &&
        current.cloudinary.cloudName !== input.cloudName &&
        (!providedApiKey || !providedApiSecret)
    ) {
        throw new AppError(
            400,
            'Enter the API key and API secret for the new Cloudinary cloud. Credentials from a different cloud cannot be reused.',
            'VALIDATION_ERROR'
        );
    }

    const apiKey = providedApiKey || current.cloudinary?.apiKey || '';
    const apiSecret =
        providedApiSecret || current.cloudinary?.apiSecret || '';

    if (!apiKey || !apiSecret) {
        throw new AppError(
            400,
            'Cloudinary API key and API secret are required the first time you save Cloudinary credentials.',
            'VALIDATION_ERROR'
        );
    }

    await saveStore(userId, {
        ...current,
        cloudinary: {
            cloudName: input.cloudName,
            apiKey,
            apiSecret,
        },
    });
}

export async function updateGeminiCredentials(
    userId: string,
    input: { apiKey: string }
): Promise<void> {
    const current = await readStore(userId, true);
    await saveStore(userId, {
        ...current,
        gemini: { apiKey: input.apiKey },
    });
}

export async function clearMetaCredentials(userId: string): Promise<void> {
    const current = await readStore(userId, true);
    delete current.meta;
    await saveStore(userId, current);
    await markConnectionsForReconnect(userId);
}

export async function clearCloudinaryCredentials(userId: string): Promise<void> {
    const current = await readStore(userId, true);
    delete current.cloudinary;
    await saveStore(userId, current);
}

export async function clearGeminiCredentials(userId: string): Promise<void> {
    const current = await readStore(userId, true);
    delete current.gemini;
    await saveStore(userId, current);
}
