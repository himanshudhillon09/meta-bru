import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env.js';
import { Post } from '../models/postModel.js';
import { SocialConnection } from '../models/socialConnectionModel.js';
import type { ISocialConnection } from '../models/socialConnectionModel.js';
import { User } from '../models/userModel.js';
import {
    isConnectionBusy,
    shouldRecomputeScheduleOnReconnect,
    STALE_LOCK_MS,
} from '../services/connectionLifecycleService.js';
import { getMetaCredentials } from '../services/credentialService.js';
import { encryptSecret } from '../services/cryptoService.js';
import {
    exchangeCodeForToken,
    exchangeForLongLivedToken,
    fetchAuthenticatedUser,
    fetchPageAccounts,
    fetchPermissionStatus,
    getOAuthUrl,
    resolveMetaRedirectUri,
    type MetaPageAccount,
    type MetaPermissionStatus,
} from '../services/metaService.js';
import { computeNextRunAt, isValidTimezone } from '../services/timeService.js';
import { AppError } from '../utils/errors.js';
import { parseBody } from '../utils/validation.js';

// Keep OAuth state tokens from being usable as application access tokens.
const META_OAUTH_STATE_SECRET = `${env.jwtSecret}:meta_oauth`;

const completeOAuthSchema = z.object({
    code: z.string().min(1),
    state: z.string().min(1),
});

const updateConnectionSchema = z.object({
    dailyTime: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'dailyTime must be HH:mm')
        .optional(),
    timezone: z.string().min(1).max(64).optional(),
    publishToFacebook: z.boolean().optional(),
    publishToInstagram: z.boolean().optional(),
    isActive: z.boolean().optional(),
});

async function findOwnedConnection(id: string, userId: string) {
    if (!/^[a-f\d]{24}$/i.test(id)) {
        throw new AppError(400, 'Invalid connection ID', 'INVALID_ID');
    }

    const connection = await SocialConnection.findOne({ _id: id, userId });
    if (!connection) {
        throw new AppError(404, 'Connection not found', 'CONNECTION_NOT_FOUND');
    }
    return connection;
}

async function queuedCountFor(connectionId: string): Promise<number> {
    return Post.countDocuments({ connectionId, status: 'queued' });
}

function connectionResponse(
    connection: ISocialConnection,
    queuedCount: number
): Record<string, unknown> {
    const safe = connection.toObject() as Record<string, unknown>;
    delete safe.pageAccessTokenEnc;
    return { ...safe, queuedCount };
}

export async function listConnections(req: Request, res: Response): Promise<void> {
    const connections = await SocialConnection.find({ userId: req.user.id })
        .select('-pageAccessTokenEnc')
        .sort({ createdAt: -1 });

    const counts = await Promise.all(
        connections.map((connection) =>
            queuedCountFor(connection._id.toString())
        )
    );

    res.json({
        success: true,
        connections: connections.map((connection, index) =>
            connectionResponse(connection, counts[index] ?? 0)
        ),
    });
}

export async function startMetaOAuth(req: Request, res: Response): Promise<void> {
    const meta = await getMetaCredentials(req.user.id);
    const redirectUri = resolveMetaRedirectUri(req);

    const requestedTimezone = req.query.timezone;
    const timezone =
        typeof requestedTimezone === 'string' && isValidTimezone(requestedTimezone)
            ? requestedTimezone
            : env.defaultTimezone;

    const state = jwt.sign(
        {
            id: req.user.id,
            purpose: 'meta_oauth',
            timezone,
            appId: meta.appId,
            redirectUri,
        },
        META_OAUTH_STATE_SECRET,
        { expiresIn: '10m' }
    );

    res.json({
        success: true,
        url: getOAuthUrl({ ...meta, redirectUri }, state),
    });
}

async function upsertPagesForUser(
    userId: string,
    pages: MetaPageAccount[],
    timezone: string
): Promise<void> {
    for (const page of pages) {
        const instagram = page.instagram_business_account
            ? {
                  id: page.instagram_business_account.id,
                  username: page.instagram_business_account.username || '',
                  profilePictureUrl:
                      page.instagram_business_account.profile_picture_url || '',
              }
            : null;

        const existing = await SocialConnection.findOne({
            userId,
            pageId: page.id,
        });

        if (existing) {
            const hadInstagram = Boolean(existing.instagram?.id);
            const previousStatus = existing.tokenStatus;

            existing.pageName = page.name;
            existing.pageAccessTokenEnc = encryptSecret(page.access_token);
            existing.tokenStatus = 'active';
            existing.instagram = instagram;
            existing.lastError = '';

            if (instagram && !hadInstagram) {
                existing.publishToInstagram = true;
            }
            if (!instagram) {
                existing.publishToInstagram = false;
            }

            if (!existing.isActive) {
                existing.nextRunAt = null;
            } else if (
                shouldRecomputeScheduleOnReconnect(
                    previousStatus,
                    existing.isActive
                )
            ) {
                existing.nextRunAt = computeNextRunAt(
                    existing.dailyTime,
                    existing.timezone
                );
            } else if (!existing.nextRunAt) {
                existing.nextRunAt = computeNextRunAt(
                    existing.dailyTime,
                    existing.timezone
                );
            }

            await existing.save();
        } else {
            await SocialConnection.create({
                userId,
                pageId: page.id,
                pageName: page.name,
                pageAccessTokenEnc: encryptSecret(page.access_token),
                tokenStatus: 'active',
                instagram,
                dailyTime: '09:00',
                timezone,
                publishToFacebook: true,
                publishToInstagram: Boolean(instagram),
                nextRunAt: computeNextRunAt('09:00', timezone),
            });
        }
    }
}

export async function metaOAuthCallback(req: Request, res: Response): Promise<void> {
    const redirectError = (message: string): void => {
        res.set('Cache-Control', 'no-store');
        res.redirect(
            `${env.frontendUrl}/connections?error=${encodeURIComponent(message)}`
        );
    };

    const oauthError = req.query.error;
    if (typeof oauthError === 'string' && oauthError) {
        redirectError(
            typeof req.query.error_description === 'string'
                ? req.query.error_description
                : oauthError
        );
        return;
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!code || !state) {
        redirectError('missing_code');
        return;
    }

    // Validate the signed state before handing the code to the frontend. The
    // frontend finishes the exchange with the authenticated user's token, so
    // an attacker cannot link a victim's Pages to a different account.
    try {
        const decoded = jwt.verify(state, META_OAUTH_STATE_SECRET) as {
            id?: string;
            purpose?: string;
        };
        if (!decoded.id || decoded.purpose !== 'meta_oauth') {
            redirectError('invalid_state');
            return;
        }
    } catch {
        redirectError('invalid_or_expired_state');
        return;
    }

    // Put the one-time code in the fragment so it is not sent to the frontend
    // server, access logs, or third-party assets.
    res.set('Cache-Control', 'no-store');
    res.redirect(
        `${env.frontendUrl}/connections#${new URLSearchParams({ code, state }).toString()}`
    );
}

export async function completeMetaOAuth(req: Request, res: Response): Promise<void> {
    const { code, state } = parseBody(completeOAuthSchema, req);

    let decoded: {
        id?: string;
        purpose?: string;
        timezone?: string;
        appId?: string;
        redirectUri?: string;
    };
    try {
        decoded = jwt.verify(state, META_OAUTH_STATE_SECRET) as typeof decoded;
    } catch {
        throw new AppError(
            400,
            'Meta login expired. Please start the connection again.',
            'OAUTH_STATE_INVALID'
        );
    }

    if (!decoded.id || decoded.purpose !== 'meta_oauth') {
        throw new AppError(400, 'Invalid Meta login state', 'OAUTH_STATE_INVALID');
    }
    if (decoded.id !== req.user.id) {
        throw new AppError(
            403,
            'This Meta login was started by a different account. Start the connection again from this account.',
            'OAUTH_STATE_MISMATCH'
        );
    }

    const user = await User.findById(req.user.id).select('isActive');
    if (!user?.isActive) {
        throw new AppError(403, 'Your account is inactive', 'ACCOUNT_INACTIVE');
    }

    const meta = await getMetaCredentials(req.user.id);
    if (!decoded.appId || decoded.appId !== meta.appId) {
        throw new AppError(
            400,
            'Your Meta app credentials changed during login. Start the connection again.',
            'OAUTH_APP_MISMATCH'
        );
    }

    const redirectUri = decoded.redirectUri || resolveMetaRedirectUri(req);
    const credentials = { ...meta, redirectUri };

    try {
        const shortLivedToken = await exchangeCodeForToken(code, credentials);
        const longLivedToken = await exchangeForLongLivedToken(
            shortLivedToken,
            credentials
        );
        const [pages, permissions, me] = await Promise.all([
            fetchPageAccounts(longLivedToken),
            fetchPermissionStatus(longLivedToken).catch(
                (error: unknown): MetaPermissionStatus | null => {
                    console.warn(
                        '[meta-oauth] Could not read permission status:',
                        error instanceof Error ? error.message : error
                    );
                    return null;
                }
            ),
            fetchAuthenticatedUser(longLivedToken),
        ]);

        if (pages.length === 0) {
            const accountLabel = me
                ? `${me.name || 'Facebook account'} (${me.id})`
                : 'the authenticated Facebook account';
            const granted =
                permissions && permissions.granted.length > 0
                    ? permissions.granted.join(', ')
                    : 'none';
            const declined =
                permissions && permissions.declined.length > 0
                    ? permissions.declined.join(', ')
                    : 'none';
            const notGranted = permissions
                ? env.meta.scopes.filter(
                      (scope) => !permissions.granted.includes(scope)
                  )
                : [];

            let permissionDetail = ' Meta did not report permission status.';
            if (permissions) {
                permissionDetail = ` Granted permissions: ${granted}. Declined: ${declined}.`;
                if (notGranted.length > 0) {
                    permissionDetail += ` Not granted: ${notGranted.join(', ')}.`;
                }
            }

            const needsBusinessManagement =
                notGranted.includes('business_management');
            const businessHint = needsBusinessManagement
                ? ' This Page appears to be managed by a Meta Business Portfolio: grant business_management and select the business that owns the Page in the consent dialog.'
                : '';
            const hint =
                permissions && notGranted.length === 0
                    ? ' Meta granted every requested permission, so this is a Page-role, business-selection, or wrong-account issue. Make sure you are logged into the Facebook account that directly manages the Page, select the correct Business Portfolio for business_management, or assign that account a Page role in Business Manager, then reconnect.'
                    : ` Make sure you are logged into the Facebook account that manages the Page, select the Page in the consent dialog, and grant every requested permission. If a permission is not granted, enable it for your Meta app under App Review → Permissions and Features, then reconnect.${businessHint}`;

            console.warn(
                `[meta-oauth] No Pages returned for ${accountLabel}. granted=${granted}; declined=${declined}; notGranted=${
                    notGranted.join(', ') || 'none'
                }`
            );

            throw new AppError(
                400,
                `No Facebook Pages were returned for ${accountLabel}.${permissionDetail}${hint}`,
                'NO_PAGES_FOUND'
            );
        }

        const timezone =
            decoded.timezone && isValidTimezone(decoded.timezone)
                ? decoded.timezone
                : env.defaultTimezone;

        await upsertPagesForUser(req.user.id, pages, timezone);
        res.json({ success: true, connected: pages.length });
    } catch (error) {
        if (error instanceof AppError) throw error;
        console.error('[meta-oauth] Completion failed:', error);
        throw new AppError(
            502,
            error instanceof Error ? error.message : 'Could not connect Meta account',
            'META_OAUTH_FAILED'
        );
    }
}

export async function updateConnection(req: Request, res: Response): Promise<void> {
    const parsed = parseBody(updateConnectionSchema, req);
    const connection = await findOwnedConnection(String(req.params.id), req.user.id);

    if (parsed.timezone && !isValidTimezone(parsed.timezone)) {
        throw new AppError(400, 'Invalid IANA timezone', 'INVALID_TIMEZONE');
    }

    if (parsed.dailyTime !== undefined) connection.dailyTime = parsed.dailyTime;
    if (parsed.timezone !== undefined) connection.timezone = parsed.timezone;
    if (parsed.publishToFacebook !== undefined) {
        connection.publishToFacebook = parsed.publishToFacebook;
    }
    if (parsed.publishToInstagram !== undefined) {
        if (parsed.publishToInstagram && !connection.instagram?.id) {
            throw new AppError(
                400,
                'This Page has no linked Instagram Business account',
                'INSTAGRAM_NOT_LINKED'
            );
        }
        connection.publishToInstagram = parsed.publishToInstagram;
    }
    if (parsed.isActive !== undefined) connection.isActive = parsed.isActive;

    if (!connection.publishToFacebook && !connection.publishToInstagram) {
        throw new AppError(
            400,
            'Select at least one platform to publish to',
            'NO_PLATFORMS'
        );
    }

    if (!connection.isActive || connection.tokenStatus !== 'active') {
        connection.nextRunAt = null;
    } else if (
        parsed.dailyTime !== undefined ||
        parsed.timezone !== undefined ||
        parsed.isActive === true ||
        !connection.nextRunAt
    ) {
        connection.nextRunAt = computeNextRunAt(
            connection.dailyTime,
            connection.timezone
        );
    }

    await connection.save();

    const queuedCount = await queuedCountFor(connection._id.toString());
    res.json({
        success: true,
        connection: connectionResponse(connection, queuedCount),
    });
}

export async function disconnectConnection(req: Request, res: Response): Promise<void> {
    const connection = await findOwnedConnection(String(req.params.id), req.user.id);

    if (connection.tokenStatus === 'disconnected') {
        const queuedCount = await queuedCountFor(connection._id.toString());
        res.json({
            success: true,
            message: 'Page already disconnected. Queued posts are kept.',
            connection: connectionResponse(connection, queuedCount),
            queuedCount,
        });
        return;
    }

    const publishing = await Post.findOne({
        connectionId: connection._id,
        status: 'publishing',
    })
        .sort({ updatedAt: -1 })
        .select('updatedAt');

    const now = new Date();
    const staleLock = new Date(now.getTime() - STALE_LOCK_MS);

    if (
        isConnectionBusy(
            connection.lockedAt,
            publishing?.updatedAt ?? null,
            now
        )
    ) {
        throw new AppError(
            409,
            'Wait for the current post to finish before disconnecting this Page.',
            'POST_IN_PROGRESS'
        );
    }

    const updated = await SocialConnection.findOneAndUpdate(
        {
            _id: connection._id,
            userId: req.user.id,
            tokenStatus: { $ne: 'disconnected' },
            $or: [{ lockedAt: null }, { lockedAt: { $lt: staleLock } }],
        },
        {
            $set: {
                pageAccessTokenEnc: '',
                tokenStatus: 'disconnected',
                nextRunAt: null,
                lockedAt: null,
                lastError: '',
            },
        },
        { new: true, runValidators: true }
    ).select('-pageAccessTokenEnc');

    if (!updated) {
        const latest = await SocialConnection.findOne({
            _id: connection._id,
            userId: req.user.id,
        });

        if (!latest) {
            throw new AppError(404, 'Connection not found', 'CONNECTION_NOT_FOUND');
        }

        if (latest.tokenStatus === 'disconnected') {
            const queuedCount = await queuedCountFor(latest._id.toString());
            res.json({
                success: true,
                message: 'Page already disconnected. Queued posts are kept.',
                connection: connectionResponse(latest, queuedCount),
                queuedCount,
            });
            return;
        }

        throw new AppError(
            409,
            'Wait for the current post to finish before disconnecting this Page.',
            'POST_IN_PROGRESS'
        );
    }

    const queuedCount = await queuedCountFor(updated._id.toString());
    res.json({
        success: true,
        message: 'Page disconnected. Queued posts are kept.',
        connection: connectionResponse(updated, queuedCount),
        queuedCount,
    });
}
