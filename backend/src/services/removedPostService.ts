import type { QueryFilter, Types } from 'mongoose';
import { PostMetricSnapshot, type IPostMetricSnapshot } from '../models/postMetricSnapshotModel.js';
import { Post, type IPost, type Platform } from '../models/postModel.js';
import { StoryMetricSnapshot } from '../models/storyMetricSnapshotModel.js';
import { deletePostMediaIfUnused } from './cloudinaryStorageService.js';
import type { GraphRequestFn } from './metaInsightsService.js';
import { MetaApiError, graphRequest } from './metaService.js';

/**
 * Meta answers the same way for a deleted post and for one the token cannot
 * see: "Object ... does not exist, cannot be loaded due to missing
 * permissions". Only this wording is worth a closer look.
 */
export function looksRemoved(message: string): boolean {
    return /does not exist/i.test(message);
}

function isMissingObject(error: unknown): boolean {
    return (
        error instanceof MetaApiError &&
        ((error.code === 100 && error.subcode === 33) || /does not exist/i.test(error.message))
    );
}

export type RemovalCheck = 'deleted' | 'exists' | 'unknown';

/**
 * Decides whether a published post was deleted on Facebook or Instagram. The
 * post itself must be missing while the same token can still read the Page's
 * posts (or the Instagram account's media); otherwise it may only be a
 * permission problem, and nothing is removed.
 */
export async function checkRemovedOnMeta(
    target: { platform: Platform; objectId: string; accountId: string },
    accessToken: string,
    request: GraphRequestFn = graphRequest
): Promise<RemovalCheck> {
    if (!target.objectId || !target.accountId) return 'unknown';

    try {
        await request(target.objectId, { accessToken, params: { fields: 'id' } });
        return 'exists';
    } catch (error) {
        if (!(error instanceof MetaApiError)) throw error;
        if (error.isTokenError) throw error;
        if (!isMissingObject(error)) return 'unknown';
    }

    const control =
        target.platform === 'facebook'
            ? `${target.accountId}/published_posts`
            : `${target.accountId}/media`;
    try {
        await request(control, { accessToken, params: { fields: 'id', limit: 1 } });
        return 'deleted';
    } catch (error) {
        if (error instanceof MetaApiError && error.isTokenError) throw error;
        return 'unknown';
    }
}

/** Removes a deleted post's insight history so Analytics stops counting it. */
export async function deletePostAnalytics(userId: string, postIds: Types.ObjectId[]): Promise<void> {
    if (postIds.length === 0) return;
    await Promise.all([
        PostMetricSnapshot.deleteMany({ userId, postId: { $in: postIds } }),
        StoryMetricSnapshot.deleteMany({ userId, postId: { $in: postIds } }),
    ]);
}

export interface RemovedSummary {
    /** Posts deleted from Meta-Bru because nothing of them is left on Meta. */
    postsDeleted: number;
    /** Platform copies dropped from posts that are still live elsewhere. */
    copiesDropped: number;
    /** Cloudinary files deleted because no other post uses them. */
    mediaDeleted: number;
}

/**
 * Flushes posts the user deleted on Facebook or Instagram. A post still live
 * on the other platform keeps that platform; one with nothing left is deleted
 * with its Analytics history and, when unused, its Cloudinary file.
 */
export async function removeDeletedTargets(
    userId: string,
    removed: Array<{ postId: string; platform: Platform }>
): Promise<RemovedSummary> {
    const summary: RemovedSummary = { postsDeleted: 0, copiesDropped: 0, mediaDeleted: 0 };
    const byPost = new Map<string, Set<Platform>>();
    for (const item of removed) {
        const platforms = byPost.get(item.postId) ?? new Set<Platform>();
        platforms.add(item.platform);
        byPost.set(item.postId, platforms);
    }

    for (const [postId, platforms] of byPost) {
        const post = await Post.findOne({ _id: postId, userId } as QueryFilter<IPost>);
        // A post publishing right now is owned by the publish run.
        if (!post || post.status === 'publishing') continue;

        const remaining = post.targets.filter((target) => !platforms.has(target.platform));
        await PostMetricSnapshot.deleteMany({
            userId,
            postId: post._id,
            platform: { $in: [...platforms] },
        } as QueryFilter<IPostMetricSnapshot>);

        if (remaining.some((target) => target.status === 'published')) {
            summary.copiesDropped += post.targets.length - remaining.length;
            post.set('targets', remaining);
            for (const platform of platforms) post.set(`platforms.${platform}`, false);
            await post.save();
            continue;
        }

        const deleted = await Post.findOneAndDelete({
            _id: post._id,
            userId,
            status: { $ne: 'publishing' },
        } as QueryFilter<IPost>);
        if (!deleted) continue;
        summary.postsDeleted += 1;
        await deletePostAnalytics(userId, [deleted._id]);
        const cleanup = await deletePostMediaIfUnused(userId, {
            publicId: deleted.mediaPublicId,
            resourceType: deleted.mediaType === 'reel' ? 'video' : 'image',
        });
        if (cleanup.mediaDeleted) summary.mediaDeleted += 1;
        // A photo reel also leaves the image it was made from.
        if (deleted.photo?.publicId) {
            await deletePostMediaIfUnused(userId, {
                publicId: deleted.photo.publicId,
                resourceType: 'image',
            });
        }
    }

    return summary;
}
