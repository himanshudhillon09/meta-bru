import type { IPostTarget } from '../models/postModel.js';
import { getCloudinaryCredentials } from './credentialService.js';
import { waitForDerivative } from './mediaDerivativeService.js';
import {
    MetaApiError,
    facebookPhotoStoryApi,
    facebookVideoApi,
    getInstagramPublishingUsage,
    instagramMediaApi,
    type FacebookPhotoStoryApi,
    type FacebookVideoApi,
    type FacebookVideoEdge,
    type FacebookVideoStatus,
    type InstagramContainerState,
    type InstagramMediaApi,
} from './metaService.js';
import {
    pollUntil,
    systemClock,
    type Clock,
    type Deadline,
} from './pollService.js';

export const INSTAGRAM_VIDEO_WAIT_MS = 5 * 60 * 1000;
export const INSTAGRAM_IMAGE_WAIT_MS = 60 * 1000;
export const FACEBOOK_REEL_STATUS_WAIT_MS = 2 * 60 * 1000;
const META_POLL_MS = 10_000;

type InstagramUsage = (
    igUserId: string,
    accessToken: string
) => Promise<{ quotaUsage: number; quotaTotal: number }>;

/** Everything a reel or Story publish needs from outside. Tests swap these. */
export interface MetaMediaDeps {
    instagram: InstagramMediaApi;
    instagramUsage: InstagramUsage;
    facebookVideo: FacebookVideoApi;
    facebookPhoto: FacebookPhotoStoryApi;
    waitForDerivative: (url: string, deadline: Deadline) => Promise<boolean>;
    cloudName: (userId: string) => Promise<string>;
    clock: Clock;
}

export const defaultMetaMediaDeps: MetaMediaDeps = {
    instagram: instagramMediaApi,
    instagramUsage: getInstagramPublishingUsage,
    facebookVideo: facebookVideoApi,
    facebookPhoto: facebookPhotoStoryApi,
    waitForDerivative: (url, deadline) => waitForDerivative(url, deadline),
    cloudName: async (userId) => (await getCloudinaryCredentials(userId)).cloudName,
    clock: systemClock,
};

export function markTargetPublished(target: IPostTarget, externalId: string): void {
    target.status = 'published';
    if (externalId) target.externalId = externalId;
    target.error = '';
    target.publishedAt = new Date();
}

export async function assertInstagramQuota(
    igUserId: string,
    accessToken: string,
    usageFor: InstagramUsage = getInstagramPublishingUsage
): Promise<void> {
    const usage = await usageFor(igUserId, accessToken);
    if (usage.quotaUsage >= usage.quotaTotal) {
        throw new MetaApiError(
            `Instagram publishing limit reached (${usage.quotaUsage}/${usage.quotaTotal} in 24h)`,
            429
        );
    }
}

export interface InstagramContainerJob {
    igUserId: string;
    accessToken: string;
    /** Container fields such as media_type and video_url. */
    params: Record<string, string | number>;
    /** Holds the container id between attempts. */
    target: IPostTarget;
    waitMs: number;
    stillProcessingMessage: string;
}

/**
 * Creates or resumes an Instagram container and publishes it once Meta has
 * processed it. The container id stays on the target, so a retry after a
 * timeout publishes the same container instead of creating a duplicate.
 */
export async function publishInstagramContainerJob(
    job: InstagramContainerJob,
    api: InstagramMediaApi,
    deadline: Deadline
): Promise<void> {
    const { igUserId, accessToken, target } = job;

    if (target.creationId) {
        const existing = await api.containerState(target.creationId, accessToken);
        if (existing.statusCode === 'PUBLISHED') {
            // An earlier attempt published it but its response was lost.
            markTargetPublished(target, '');
            return;
        }
        if (existing.statusCode === 'ERROR' || existing.statusCode === 'EXPIRED') {
            target.creationId = '';
        }
    }

    if (!target.creationId) {
        target.creationId = await api.createContainer(igUserId, accessToken, job.params);
    }
    const creationId = target.creationId;

    const state = await pollUntil<InstagramContainerState>(
        async () => {
            const current = await api.containerState(creationId, accessToken);
            return current.statusCode === 'IN_PROGRESS' ||
                current.statusCode === 'UNKNOWN'
                ? { done: false }
                : { done: true, value: current };
        },
        { intervalMs: META_POLL_MS, timeoutMs: job.waitMs, deadline }
    );

    if (!state) {
        throw new MetaApiError(job.stillProcessingMessage, 504);
    }
    if (state.statusCode === 'PUBLISHED') {
        markTargetPublished(target, '');
        return;
    }
    if (state.statusCode !== 'FINISHED') {
        target.creationId = '';
        throw new MetaApiError(
            state.status || `Instagram container is ${state.statusCode}`,
            422
        );
    }

    const mediaId = await api.publishContainer(igUserId, accessToken, creationId);
    markTargetPublished(target, mediaId);
}

export interface FacebookVideoJob {
    pageId: string;
    accessToken: string;
    edge: FacebookVideoEdge;
    /** Public URL Meta downloads the video from. */
    fileUrl: string;
    finishParams: Record<string, string>;
    /** Holds the Facebook video id between attempts. */
    target: IPostTarget;
    /** Reels keep processing after finish; poll this long for errors. 0 skips. */
    statusWaitMs: number;
}

/**
 * Publishes a hosted video to a Page edge (Reels or video Stories) with the
 * start, upload, finish flow. The video id stays on the target, so a retry
 * resumes a video Meta already has instead of posting it again.
 */
export async function publishFacebookVideoJob(
    job: FacebookVideoJob,
    api: FacebookVideoApi,
    deadline: Deadline
): Promise<void> {
    const { pageId, accessToken, edge, target } = job;
    let alreadyFinished = false;

    if (target.creationId) {
        const existing = await api.status(target.creationId, accessToken);
        if (existing.publishing === 'complete') {
            markTargetPublished(target, target.creationId);
            return;
        }
        if (existing.error || existing.uploading !== 'complete') {
            // Meta rejected or never received the earlier upload.
            target.creationId = '';
        } else {
            alreadyFinished = existing.publishing === 'in_progress';
        }
    }

    if (!target.creationId) {
        const session = await api.start(pageId, accessToken, edge);
        target.creationId = session.videoId;
        await api.upload(session.uploadUrl, accessToken, job.fileUrl);
    }
    const videoId = target.creationId;

    let postId = '';
    if (!alreadyFinished) {
        ({ postId } = await api.finish(pageId, accessToken, edge, {
            video_id: videoId,
            ...job.finishParams,
        }));
    }

    if (job.statusWaitMs > 0) {
        const status = await pollUntil<FacebookVideoStatus>(
            async () => {
                const current = await api.status(videoId, accessToken);
                return current.error || current.publishing === 'complete'
                    ? { done: true, value: current }
                    : { done: false };
            },
            { intervalMs: META_POLL_MS, timeoutMs: job.statusWaitMs, deadline }
        );

        if (status?.error) {
            target.creationId = '';
            // 422: Meta rejected the video, so nothing was published.
            throw new MetaApiError(status.error, 422);
        }
    }

    markTargetPublished(target, postId || videoId);
}
