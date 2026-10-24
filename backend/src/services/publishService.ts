import type { IPost, IPostTarget, Platform, PostStatus } from '../models/postModel.js';
import { SocialConnection } from '../models/socialConnectionModel.js';
import type { ISocialConnection } from '../models/socialConnectionModel.js';
import { AppError } from '../utils/errors.js';
import { getMetaCredentials } from './credentialService.js';
import { decryptSecret } from './cryptoService.js';
import {
    MetaApiError,
    createInstagramContainer,
    getInstagramContainerStatus,
    getInstagramPublishingUsage,
    publishFacebookPhoto,
    publishInstagramContainer,
} from './metaService.js';

export interface PublishOptions {
    /** Limit publishing to specific platforms (used when retrying only failed targets). */
    platforms?: Platform[];
}

function selectedPlatforms(post: IPost, options: PublishOptions): Platform[] {
    if (options.platforms && options.platforms.length > 0) {
        return options.platforms;
    }

    const platforms: Platform[] = [];
    if (post.platforms.facebook) platforms.push('facebook');
    if (post.platforms.instagram) platforms.push('instagram');
    return platforms;
}

async function markConnectionNeedsReauth(
    connection: ISocialConnection,
    message: string
): Promise<void> {
    const result = await SocialConnection.updateOne(
        { _id: connection._id, tokenStatus: { $ne: 'disconnected' } },
        { $set: { tokenStatus: 'needs_reauth', lastError: message } }
    );

    if (result.matchedCount > 0) {
        connection.tokenStatus = 'needs_reauth';
        connection.lastError = message;
    }
}

function ensureTarget(post: IPost, platform: Platform): IPostTarget {
    let target = post.targets.find((item) => item.platform === platform);
    if (!target) {
        target = {
            platform,
            status: 'pending',
            externalId: '',
            creationId: '',
            error: '',
            publishedAt: null,
        };
        post.targets.push(target);
        target = post.targets[post.targets.length - 1] as IPostTarget;
    }
    return target;
}

function deriveStatus(targets: IPostTarget[]): PostStatus {
    if (targets.length === 0) return 'failed';
    if (targets.every((target) => target.status === 'published')) return 'published';
    if (targets.some((target) => target.status === 'published')) return 'partial';
    return 'failed';
}

async function waitForInstagramContainer(
    containerId: string,
    accessToken: string
): Promise<void> {
    // Images usually finish immediately. Poll for up to a minute; if the
    // container is still processing after that, fail the target so it can be
    // retried rather than holding the scheduler lock indefinitely.
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const status = await getInstagramContainerStatus(containerId, accessToken);
        if (status === 'FINISHED' || status === 'PUBLISHED') return;
        if (status === 'ERROR' || status === 'EXPIRED') {
            throw new MetaApiError(`Instagram container is ${status}`, 502);
        }
        await new Promise((resolve) => setTimeout(resolve, 3_000));
    }

    throw new MetaApiError('Instagram container was not ready in time', 504);
}

async function publishToFacebook(
    post: IPost,
    connection: ISocialConnection,
    accessToken: string,
    target: IPostTarget
): Promise<void> {
    if (!post.mediaUrl) {
        throw new MetaApiError('Facebook publishing requires an image', 400);
    }

    // New uploads store a Cloudinary JPEG delivery URL. Legacy/external posts
    // fall back to the original public URL.
    const imageUrl = post.mediaJpegUrl || post.mediaUrl;

    const result = await publishFacebookPhoto({
        pageId: connection.pageId,
        pageToken: accessToken,
        imageUrl,
        caption: post.caption,
    });

    target.status = 'published';
    target.externalId = result.post_id || result.id;
    target.publishedAt = new Date();
}

async function publishToInstagram(
    post: IPost,
    connection: ISocialConnection,
    accessToken: string,
    target: IPostTarget
): Promise<void> {
    const igUserId = connection.instagram?.id;
    if (!igUserId) {
        throw new MetaApiError(
            'No Instagram Business account is linked to this Facebook Page',
            400
        );
    }

    const imageUrl = post.mediaJpegUrl || post.mediaUrl;
    if (!imageUrl) {
        throw new MetaApiError('Instagram requires a public image URL', 400);
    }

    const usage = await getInstagramPublishingUsage(igUserId, accessToken);
    if (usage.quotaUsage >= usage.quotaTotal) {
        throw new MetaApiError(
            `Instagram publishing limit reached (${usage.quotaUsage}/${usage.quotaTotal} in 24h)`,
            429
        );
    }

    if (!target.creationId) {
        target.creationId = await createInstagramContainer({
            igUserId,
            accessToken,
            imageUrl,
            caption: post.caption,
        });
    }

    try {
        const mediaId = await publishInstagramContainer({
            igUserId,
            accessToken,
            creationId: target.creationId,
        });
        target.externalId = mediaId;
        target.status = 'published';
        target.publishedAt = new Date();
        return;
    } catch (error) {
        // 9007 / 2207027 means the container is not publishable yet, but the
        // same error is also returned for expired or already-published
        // containers. Ask Meta for the actual status before deciding.
        if (error instanceof MetaApiError && error.code === 9007) {
            let status = await getInstagramContainerStatus(
                target.creationId,
                accessToken
            );

            if (status === 'PUBLISHED') {
                // The previous request published it but its response was lost.
                target.status = 'published';
                target.publishedAt = new Date();
                return;
            }

            if (status === 'EXPIRED' || status === 'ERROR') {
                target.creationId = await createInstagramContainer({
                    igUserId,
                    accessToken,
                    imageUrl,
                    caption: post.caption,
                });
                status = await getInstagramContainerStatus(
                    target.creationId,
                    accessToken
                );
                if (status === 'PUBLISHED') {
                    target.status = 'published';
                    target.publishedAt = new Date();
                    return;
                }
            }

            if (status !== 'FINISHED' && status !== 'PUBLISHED') {
                await waitForInstagramContainer(target.creationId, accessToken);
            }

            const mediaId = await publishInstagramContainer({
                igUserId,
                accessToken,
                creationId: target.creationId,
            });
            target.externalId = mediaId;
            target.status = 'published';
            target.publishedAt = new Date();
            return;
        }
        throw error;
    }
}

/**
 * Publishes a post to its selected platforms. The caller must provide a
 * connection fetched with `+pageAccessTokenEnc`.
 */
export async function publishPost(
    post: IPost,
    connection: ISocialConnection,
    options: PublishOptions = {}
): Promise<IPost> {
    const platforms = selectedPlatforms(post, options);
    if (platforms.length === 0) {
        post.status = 'failed';
        post.lastError = 'No publishing platforms selected';
        await post.save();
        return post;
    }

    try {
        // Publishing always uses the owning user's Meta app. If they have not
        // configured one, do not fall back to a legacy/shared app or a stale
        // Page token.
        await getMetaCredentials(String(post.userId));
    } catch (error) {
        if (
            !(error instanceof AppError) ||
            (error.code !== 'META_NOT_CONFIGURED' &&
                error.code !== 'CREDENTIALS_UNREADABLE')
        ) {
            throw error;
        }

        post.status = 'failed';
        post.lastError =
            error.code === 'META_NOT_CONFIGURED'
                ? 'Add your Meta app credentials under Profile and reconnect this Page.'
                : 'Stored credentials could not be decrypted. Re-enter them under Profile and reconnect this Page.';
        await markConnectionNeedsReauth(connection, post.lastError);
        await post.save();
        return post;
    }

    let accessToken: string;
    try {
        accessToken = decryptSecret(connection.pageAccessTokenEnc);
    } catch {
        post.status = deriveStatus(post.targets);
        post.lastError =
            'Stored Page token could not be decrypted. Reconnect this Page.';
        await markConnectionNeedsReauth(
            connection,
            'Stored Page token could not be decrypted. Reconnect this Page.'
        );
        await post.save();
        return post;
    }

    post.status = 'publishing';
    post.attempts += 1;
    post.lastError = '';

    const targets = platforms.map((platform) => ensureTarget(post, platform));
    for (const target of targets) {
        target.status = 'publishing';
        target.error = '';
    }
    await post.save();

    for (const target of targets) {
        try {
            if (target.platform === 'facebook') {
                await publishToFacebook(post, connection, accessToken, target);
            } else {
                await publishToInstagram(post, connection, accessToken, target);
            }
        } catch (error) {
            const message =
                error instanceof Error ? error.message : 'Unknown publishing error';
            target.status = 'failed';
            const ambiguousFacebookFailure =
                target.platform === 'facebook' &&
                (!(error instanceof MetaApiError) ||
                    error.status === 0 ||
                    error.status >= 500);
            target.error = ambiguousFacebookFailure
                ? `${message} Check the Page before retrying to avoid a duplicate.`
                : message;

            if (error instanceof MetaApiError && error.isTokenError) {
                await markConnectionNeedsReauth(
                    connection,
                    'Meta access token is invalid or was revoked. Reconnect this Page.'
                );
            }
        }

        // Persist each target as it finishes so a crash between Facebook and
        // Instagram does not lose the fact that one platform already published.
        await post.save();
    }

    const allTargets = post.targets;
    const failures = allTargets.filter((target) => target.status === 'failed');
    post.status = deriveStatus(allTargets);
    post.lastError = failures.map((target) => `${target.platform}: ${target.error}`).join(' | ');
    if (allTargets.some((target) => target.status === 'published')) {
        post.publishedAt = new Date();
    }

    await post.save();
    return post;
}
