import type { IPost, IPostTarget, Platform } from '../models/postModel.js';
import type { ISocialConnection } from '../models/socialConnectionModel.js';
import { storyImageUrl, storyVideoUrl } from './mediaDerivativeService.js';
import {
    INSTAGRAM_IMAGE_WAIT_MS,
    INSTAGRAM_VIDEO_WAIT_MS,
    assertInstagramQuota,
    markTargetPublished,
    publishFacebookVideoJob,
    publishInstagramContainerJob,
    type MetaMediaDeps,
} from './metaMediaJobs.js';
import { MetaApiError } from './metaService.js';
import type { Deadline } from './pollService.js';

export interface StoryShare {
    post: IPost;
    connection: ISocialConnection;
    accessToken: string;
    /** Requested platforms; storyPlatforms decides which are attempted. */
    platforms: Platform[];
    deadline: Deadline;
    /** Called when Meta rejects the Page token. */
    onTokenError: () => Promise<void>;
}

interface StoryMedia {
    kind: 'image' | 'video';
    url: string;
}

/** Platforms where the post itself published and its Story has not yet. */
export function storyPlatforms(
    post: Pick<IPost, 'targets' | 'storyTargets'>,
    requested: Platform[]
): Platform[] {
    return [...new Set(requested)].filter(
        (platform) =>
            post.targets.some(
                (target) => target.platform === platform && target.status === 'published'
            ) &&
            !(post.storyTargets ?? []).some(
                (target) => target.platform === platform && target.status === 'published'
            )
    );
}

function ensureStoryTarget(post: IPost, platform: Platform): IPostTarget {
    let target = post.storyTargets.find((item) => item.platform === platform);
    if (!target) {
        post.storyTargets.push({
            platform,
            status: 'pending',
            externalId: '',
            creationId: '',
            error: '',
            publishedAt: null,
        });
        target = post.storyTargets[post.storyTargets.length - 1] as IPostTarget;
    }
    return target;
}

async function storyMedia(
    post: IPost,
    deps: MetaMediaDeps,
    deadline: Deadline
): Promise<StoryMedia> {
    if (!post.mediaPublicId) {
        throw new MetaApiError('Stories need an image uploaded through Meta-Bru.', 400);
    }

    const cloudName = await deps.cloudName(String(post.userId));
    if (post.mediaType !== 'reel') {
        return { kind: 'image', url: storyImageUrl(cloudName, post.mediaPublicId) };
    }

    const url = storyVideoUrl(cloudName, post.mediaPublicId);
    if (!(await deps.waitForDerivative(url, deadline))) {
        throw new MetaApiError(
            'Cloudinary is still preparing this Story. Share it again in a few minutes.',
            425
        );
    }
    return { kind: 'video', url };
}

async function shareToInstagram(
    connection: ISocialConnection,
    accessToken: string,
    media: StoryMedia,
    target: IPostTarget,
    deps: MetaMediaDeps,
    deadline: Deadline
): Promise<void> {
    const igUserId = connection.instagram?.id;
    if (!igUserId) {
        throw new MetaApiError(
            'No Instagram Business account is linked to this Facebook Page',
            400
        );
    }

    await assertInstagramQuota(igUserId, accessToken, deps.instagramUsage);
    await publishInstagramContainerJob(
        {
            igUserId,
            accessToken,
            target,
            params:
                media.kind === 'video'
                    ? { media_type: 'STORIES', video_url: media.url }
                    : { media_type: 'STORIES', image_url: media.url },
            waitMs: media.kind === 'video' ? INSTAGRAM_VIDEO_WAIT_MS : INSTAGRAM_IMAGE_WAIT_MS,
            stillProcessingMessage:
                'Instagram is still processing this Story. Share it again in a few minutes.',
        },
        deps.instagram,
        deadline
    );
}

async function shareToFacebook(
    connection: ISocialConnection,
    accessToken: string,
    media: StoryMedia,
    target: IPostTarget,
    deps: MetaMediaDeps,
    deadline: Deadline
): Promise<void> {
    if (media.kind === 'video') {
        // video_stories finish returns the Story's post_id, so no status poll.
        await publishFacebookVideoJob(
            {
                pageId: connection.pageId,
                accessToken,
                edge: 'video_stories',
                fileUrl: media.url,
                finishParams: {},
                target,
                statusWaitMs: 0,
            },
            deps.facebookVideo,
            deadline
        );
        return;
    }

    const photoId = await deps.facebookPhoto.uploadUnpublished(
        connection.pageId,
        accessToken,
        media.url
    );
    const story = await deps.facebookPhoto.publishStory(
        connection.pageId,
        accessToken,
        photoId
    );
    markTargetPublished(target, story.postId || photoId);
}

/**
 * Shares a published post or reel to Stories. Each platform succeeds or fails
 * on its own, and the post's own status, lastError, and publishedAt never
 * change.
 */
export async function publishStories(
    share: StoryShare,
    deps: MetaMediaDeps
): Promise<void> {
    const { post, connection, accessToken, deadline } = share;
    const platforms = storyPlatforms(post, share.platforms);
    if (platforms.length === 0) return;

    const targets = platforms.map((platform) => ensureStoryTarget(post, platform));
    for (const target of targets) {
        target.status = 'publishing';
        target.error = '';
    }
    await post.save();

    let media: StoryMedia | null = null;
    let mediaError: unknown = null;
    try {
        media = await storyMedia(post, deps, deadline);
    } catch (error) {
        mediaError = error;
    }

    for (const target of targets) {
        try {
            if (!media) throw mediaError;
            if (deadline.expired()) {
                throw new MetaApiError('Ran out of time. Share this Story again from Queue.', 425);
            }

            if (target.platform === 'instagram') {
                await shareToInstagram(connection, accessToken, media, target, deps, deadline);
            } else {
                await shareToFacebook(connection, accessToken, media, target, deps, deadline);
            }
        } catch (error) {
            target.status = 'failed';
            target.error = error instanceof Error ? error.message : 'Story sharing failed';
            if (error instanceof MetaApiError && error.isTokenError) {
                await share.onTokenError();
            }
        }

        // Save each Story as it finishes, as publishing does for targets.
        await post.save();
    }
}
