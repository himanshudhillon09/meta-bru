import type { Request, Response } from 'express';
import { z } from 'zod';
import {
    Post,
    type IPost,
    type IPostTarget,
    type Platform,
    type PostStatus,
} from '../models/postModel.js';
import { SocialConnection } from '../models/socialConnectionModel.js';
import type {
    ConnectionTokenStatus,
    ISocialConnection,
} from '../models/socialConnectionModel.js';
import {
    STALE_LOCK_MS,
    canPublishWithStatus,
} from '../services/connectionLifecycleService.js';
import { publishPost } from '../services/publishService.js';
import { AppError } from '../utils/errors.js';
import { parseBody } from '../utils/validation.js';

const platformSchema = z.object({
    facebook: z.boolean().default(true),
    instagram: z.boolean().default(false),
});

const createPostSchema = z.object({
    connectionId: z.string().min(1),
    caption: z.string().trim().min(1, 'Caption is required').max(2200),
    mediaUrl: z
        .string()
        .url('mediaUrl must be a public URL')
        .refine(
            (value) => /^https?:\/\//i.test(value),
            'mediaUrl must use http or https'
        ),
    mediaJpegUrl: z
        .string()
        .url('mediaJpegUrl must be a public URL')
        .refine(
            (value) => /^https?:\/\//i.test(value),
            'mediaJpegUrl must use http or https'
        )
        .optional()
        .default(''),
    mediaPublicId: z.string().max(300).optional().default(''),
    platforms: platformSchema,
    action: z.enum(['draft', 'queue', 'now']).default('queue'),
});

const updatePostSchema = z.object({
    caption: z.string().trim().min(1).max(2200).optional(),
    action: z.enum(['draft', 'queue']).optional(),
});

const ALLOWED_STATUSES = [
    'draft',
    'queued',
    'publishing',
    'published',
    'partial',
    'failed',
] as const;

function buildTargets(platforms: { facebook: boolean; instagram: boolean }): IPostTarget[] {
    const targets: IPostTarget[] = [];
    if (platforms.facebook) {
        targets.push({
            platform: 'facebook',
            status: 'pending',
            externalId: '',
            creationId: '',
            error: '',
            publishedAt: null,
        });
    }
    if (platforms.instagram) {
        targets.push({
            platform: 'instagram',
            status: 'pending',
            externalId: '',
            creationId: '',
            error: '',
            publishedAt: null,
        });
    }
    return targets;
}

async function ownedPost(id: string, userId: string) {
    if (!/^[a-f\d]{24}$/i.test(id)) {
        throw new AppError(400, 'Invalid post ID', 'INVALID_ID');
    }

    const post = await Post.findOne({ _id: id, userId });
    if (!post) {
        throw new AppError(404, 'Post not found', 'POST_NOT_FOUND');
    }
    return post;
}

function assertConnectionCanPublish(
    connection: { tokenStatus: ConnectionTokenStatus },
    action: 'publish' | 'retry' = 'publish'
): void {
    if (canPublishWithStatus(connection.tokenStatus)) return;

    if (connection.tokenStatus === 'disconnected') {
        throw new AppError(
            409,
            'This Page is disconnected. Reconnect it before publishing.',
            'PAGE_DISCONNECTED'
        );
    }

    throw new AppError(
        409,
        `This Page needs to be reconnected before ${
            action === 'retry' ? 'retrying' : 'publishing'
        }.`,
        'RECONNECT_REQUIRED'
    );
}

/**
 * Atomically claims a post for publishing. The status check and update happen
 * in one Mongo operation, so a manual action cannot race the scheduler or a
 * second browser tab into a duplicate publish.
 */
async function claimPost(
    postId: string,
    userId: string,
    allowedStatuses: PostStatus[]
) {
    const post = await Post.findOneAndUpdate(
        {
            _id: postId,
            userId,
            status: { $in: allowedStatuses },
        },
        { $set: { status: 'publishing' } },
        { new: true }
    );

    if (!post) {
        throw new AppError(
            409,
            'This post is already being processed',
            'POST_LOCKED'
        );
    }

    return post;
}

async function claimConnectionForPublish(
    connectionId: string,
    userId: string,
    action: 'publish' | 'retry' = 'publish'
): Promise<{ connection: ISocialConnection; lockedAt: Date }> {
    const now = new Date();
    const staleLock = new Date(now.getTime() - STALE_LOCK_MS);

    const connection = await SocialConnection.findOneAndUpdate(
        {
            _id: connectionId,
            userId,
            tokenStatus: 'active',
            $or: [{ lockedAt: null }, { lockedAt: { $lt: staleLock } }],
        },
        { $set: { lockedAt: now } },
        { new: true }
    ).select('+pageAccessTokenEnc');

    if (connection) {
        return { connection, lockedAt: now };
    }

    const existing = await SocialConnection.findOne({
        _id: connectionId,
        userId,
    });
    if (!existing) {
        throw new AppError(404, 'Connection not found', 'CONNECTION_NOT_FOUND');
    }

    assertConnectionCanPublish(existing, action);

    throw new AppError(
        409,
        'This Page is busy publishing another post. Try again shortly.',
        'CONNECTION_BUSY'
    );
}

async function releaseConnectionLock(
    connectionId: string,
    lockedAt: Date
): Promise<void> {
    try {
        await SocialConnection.updateOne(
            { _id: connectionId, lockedAt },
            { $set: { lockedAt: null } }
        );
    } catch (error) {
        console.error(
            `[posts] Could not release connection lock for ${connectionId}:`,
            error
        );
    }
}

export async function createPost(req: Request, res: Response): Promise<void> {
    const parsed = parseBody(createPostSchema, req);

    if (!/^[a-f\d]{24}$/i.test(parsed.connectionId)) {
        throw new AppError(400, 'Invalid connection ID', 'INVALID_ID');
    }

    const connection = await SocialConnection.findOne({
        _id: parsed.connectionId,
        userId: req.user.id,
    }).select('+pageAccessTokenEnc');

    if (!connection) {
        throw new AppError(404, 'Connection not found', 'CONNECTION_NOT_FOUND');
    }
    assertConnectionCanPublish(connection);
    if (!parsed.platforms.facebook && !parsed.platforms.instagram) {
        throw new AppError(400, 'Select at least one platform', 'NO_PLATFORMS');
    }
    if (parsed.platforms.instagram) {
        if (!connection.instagram?.id) {
            throw new AppError(
                400,
                'This Page has no linked Instagram Business account',
                'INSTAGRAM_NOT_LINKED'
            );
        }
        if (!parsed.mediaPublicId) {
            throw new AppError(
                400,
                'Instagram requires an image uploaded through Meta-Bru',
                'CLOUDINARY_MEDIA_REQUIRED'
            );
        }
    }

    if (parsed.action === 'now') {
        const { connection: claimedConnection, lockedAt } =
            await claimConnectionForPublish(
                connection._id.toString(),
                req.user.id
            );

        try {
            const post = await Post.create({
                userId: req.user.id,
                connectionId: claimedConnection._id,
                caption: parsed.caption,
                mediaUrl: parsed.mediaUrl,
                mediaJpegUrl: parsed.mediaJpegUrl,
                mediaPublicId: parsed.mediaPublicId,
                platforms: parsed.platforms,
                status: 'publishing',
                targets: buildTargets(parsed.platforms),
            });

            await publishPost(post, claimedConnection);
            res.status(201).json({ success: true, post });
        } finally {
            await releaseConnectionLock(
                claimedConnection._id.toString(),
                lockedAt
            );
        }
        return;
    }

    const post = await Post.create({
        userId: req.user.id,
        connectionId: connection._id,
        caption: parsed.caption,
        mediaUrl: parsed.mediaUrl,
        mediaJpegUrl: parsed.mediaJpegUrl,
        mediaPublicId: parsed.mediaPublicId,
        platforms: parsed.platforms,
        status: parsed.action === 'draft' ? 'draft' : 'queued',
        targets: buildTargets(parsed.platforms),
    });

    res.status(201).json({ success: true, post });
}

export async function listPosts(req: Request, res: Response): Promise<void> {
    const filter: Record<string, unknown> = { userId: req.user.id };

    if (typeof req.query.status === 'string' && req.query.status) {
        if (!ALLOWED_STATUSES.includes(req.query.status as (typeof ALLOWED_STATUSES)[number])) {
            throw new AppError(400, 'Invalid status filter', 'INVALID_STATUS');
        }
        filter.status = req.query.status;
    }

    if (typeof req.query.connectionId === 'string' && req.query.connectionId) {
        if (!/^[a-f\d]{24}$/i.test(req.query.connectionId)) {
            throw new AppError(400, 'Invalid connection ID', 'INVALID_ID');
        }
        filter.connectionId = req.query.connectionId;
    }

    const limitValue = Number(req.query.limit);
    const limit = Number.isFinite(limitValue)
        ? Math.min(Math.max(Math.trunc(limitValue), 1), 200)
        : 100;

    const posts = await Post.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate('connectionId', 'pageName pageId instagram tokenStatus');

    res.json({ success: true, posts });
}

export async function updatePost(req: Request, res: Response): Promise<void> {
    const parsed = parseBody(updatePostSchema, req);
    const existing = await ownedPost(String(req.params.id), req.user.id);

    const updates: Record<string, unknown> = {};
    if (parsed.caption !== undefined) {
        updates.caption = parsed.caption;
        // A caption change makes any existing Instagram container stale. Keep
        // failed containers on a plain retry so a previously published
        // container can still be detected instead of creating a duplicate.
        updates.targets = existing.targets.map((target) => ({
            platform: target.platform,
            status: target.status,
            externalId: target.externalId,
            creationId:
                target.platform === 'instagram' && target.status !== 'published'
                    ? ''
                    : target.creationId,
            error: target.error,
            publishedAt: target.publishedAt,
        }));
    }
    if (parsed.action !== undefined) {
        updates.status = parsed.action === 'queue' ? 'queued' : 'draft';
    }

    if (Object.keys(updates).length === 0) {
        res.json({ success: true, post: existing });
        return;
    }

    // Only mutate posts that are still editable. Checking status and saving in
    // one operation prevents an edit from overwriting the scheduler's claim.
    const post = await Post.findOneAndUpdate(
        {
            _id: existing._id,
            userId: req.user.id,
            status: { $in: ['draft', 'queued', 'failed'] },
        },
        { $set: updates },
        { new: true, runValidators: true }
    );

    if (!post) {
        throw new AppError(409, 'This post can no longer be edited', 'POST_LOCKED');
    }

    res.json({ success: true, post });
}

export async function deletePost(req: Request, res: Response): Promise<void> {
    const existing = await ownedPost(String(req.params.id), req.user.id);

    if (existing.status === 'published' || existing.status === 'partial') {
        throw new AppError(
            409,
            'Published posts cannot be deleted from Meta-Bru',
            'POST_LOCKED'
        );
    }

    // Delete atomically so a scheduler claim cannot race the delete.
    const post = await Post.findOneAndDelete({
        _id: existing._id,
        userId: req.user.id,
        status: { $in: ['draft', 'queued', 'failed'] },
    });

    if (!post) {
        throw new AppError(409, 'This post is currently publishing', 'POST_LOCKED');
    }

    res.json({ success: true, message: 'Post deleted' });
}

export async function publishNow(req: Request, res: Response): Promise<void> {
    const post = await ownedPost(String(req.params.id), req.user.id);

    if (post.status === 'publishing') {
        throw new AppError(409, 'This post is already publishing', 'POST_LOCKED');
    }
    if (post.status === 'published') {
        throw new AppError(409, 'This post is already published', 'POST_LOCKED');
    }

    // If any platform already published, only retry the remaining targets;
    // republishing both would duplicate the successful post. This also protects
    // against legacy records with a "failed" status but a published target.
    const hasPublishedTarget = post.targets.some(
        (target) => target.status === 'published'
    );
    const retryPlatforms = hasPublishedTarget
        ? post.targets
              .filter((target) => target.status !== 'published')
              .map((target) => target.platform as Platform)
        : undefined;

    if (retryPlatforms && retryPlatforms.length === 0) {
        throw new AppError(400, 'Nothing left to publish', 'NOTHING_TO_RETRY');
    }

    const { connection, lockedAt } = await claimConnectionForPublish(
        post.connectionId.toString(),
        req.user.id
    );

    try {
        const allowedStatuses: PostStatus[] =
            post.status === 'partial'
                ? ['partial']
                : ['draft', 'queued', 'failed'];
        const claimed = await claimPost(
            post._id.toString(),
            req.user.id,
            allowedStatuses
        );

        await publishPost(
            claimed,
            connection,
            retryPlatforms ? { platforms: retryPlatforms } : {}
        );
        res.json({ success: true, post: claimed });
    } finally {
        await releaseConnectionLock(connection._id.toString(), lockedAt);
    }
}

export async function retryPost(req: Request, res: Response): Promise<void> {
    const post = await ownedPost(String(req.params.id), req.user.id);

    if (post.status !== 'failed' && post.status !== 'partial') {
        throw new AppError(
            400,
            'Only failed or partially published posts can be retried',
            'POST_NOT_RETRYABLE'
        );
    }

    // Any target that did not successfully publish is eligible. This also
    // recovers targets left in "pending"/"publishing" by an interrupted run.
    const retryPlatforms = post.targets
        .filter((target) => target.status !== 'published')
        .map((target) => target.platform as Platform);

    if (retryPlatforms.length === 0) {
        throw new AppError(400, 'No failed platforms to retry', 'NOTHING_TO_RETRY');
    }

    const { connection, lockedAt } = await claimConnectionForPublish(
        post.connectionId.toString(),
        req.user.id,
        'retry'
    );

    try {
        const claimed = await claimPost(post._id.toString(), req.user.id, [
            'failed',
            'partial',
        ]);

        await publishPost(claimed, connection, {
            platforms: retryPlatforms,
        });
        res.json({ success: true, post: claimed });
    } finally {
        await releaseConnectionLock(connection._id.toString(), lockedAt);
    }
}
