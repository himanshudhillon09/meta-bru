import type { QueryFilter } from 'mongoose';
import { ImportedPost, type IImportedPost } from '../models/importedPostModel.js';
import { Post, type IPost, type Platform } from '../models/postModel.js';
import {
    SocialConnection,
    type ISocialConnection,
} from '../models/socialConnectionModel.js';
import {
    StoryMetricSnapshot,
    type IStoryMetricSnapshot,
} from '../models/storyMetricSnapshotModel.js';
import { decryptSecret } from './cryptoService.js';
import {
    fetchFacebookStoryMetrics,
    fetchInstagramStoryMetrics,
    sanitizeErrorMessage,
    type NormalizedStoryMetrics,
} from './metaInsightsService.js';

/** Meta keeps Story insights for 24 hours; a little slack covers late syncs. */
export const STORY_INSIGHT_WINDOW_MS = 25 * 60 * 60_000;

/** How often the scheduler refreshes live Stories. */
export const STORY_SYNC_INTERVAL_MS = 30 * 60_000;

const MAX_STORIES_PER_SYNC = 200;

export interface StorySyncDependencies {
    fetchFacebook?: typeof fetchFacebookStoryMetrics;
    fetchInstagram?: typeof fetchInstagramStoryMetrics;
}

export interface StorySyncResult {
    synced: number;
    failed: number;
}

interface LiveStory {
    userId: string;
    connectionId: string;
    postId: string;
    platform: Platform;
    externalId: string;
    publishedAt: Date;
}

function liveStories(posts: IPost[], since: Date): LiveStory[] {
    const stories: LiveStory[] = [];
    for (const post of posts) {
        for (const target of post.storyTargets ?? []) {
            if (target.status !== 'published' || !target.externalId) continue;
            if (!target.publishedAt || target.publishedAt < since) continue;
            stories.push({
                userId: String(post.userId),
                connectionId: String(post.connectionId),
                postId: String(post._id),
                platform: target.platform,
                externalId: target.externalId,
                publishedAt: target.publishedAt,
            });
        }
    }
    return stories;
}

async function saveSnapshot(
    story: LiveStory,
    result: NormalizedStoryMetrics,
    now: Date
): Promise<void> {
    const previous = await StoryMetricSnapshot.findOne({
        postId: story.postId,
        platform: story.platform,
        userId: story.userId,
    } as QueryFilter<IStoryMetricSnapshot>);

    // An expired Story or a failed call returns nothing: keep the last numbers.
    const hasMetrics = Object.values(result.metrics).some((value) => value !== null);
    const keepPrevious = !hasMetrics && previous?.metricsCapturedAt;

    await StoryMetricSnapshot.updateOne(
        { postId: story.postId, platform: story.platform, userId: story.userId } as QueryFilter<IStoryMetricSnapshot>,
        {
            $set: {
                connectionId: story.connectionId,
                externalId: story.externalId,
                publishedAt: story.publishedAt,
                capturedAt: now,
                ...(keepPrevious
                    ? {}
                    : {
                          metrics: result.metrics,
                          metricsCapturedAt: hasMetrics ? now : null,
                      }),
                status: keepPrevious ? previous.status : result.status,
                error: sanitizeErrorMessage(result.error),
            },
        },
        { upsert: true }
    );
}

/**
 * Refreshes insights for every Story still inside Meta's 24-hour window, for
 * one user or (from the scheduler) for everyone. Each Page token is decrypted
 * once; Pages that need a reconnect are skipped.
 */
export async function syncStoryInsights(
    options: { userId?: string; now?: Date } = {},
    deps: StorySyncDependencies = {}
): Promise<StorySyncResult> {
    const now = options.now ?? new Date();
    const since = new Date(now.getTime() - STORY_INSIGHT_WINDOW_MS);
    const fetchFacebook = deps.fetchFacebook ?? fetchFacebookStoryMetrics;
    const fetchInstagram = deps.fetchInstagram ?? fetchInstagramStoryMetrics;

    const posts = await Post.find({
        ...(options.userId ? { userId: options.userId } : {}),
        storyTargets: {
            $elemMatch: { status: 'published', publishedAt: { $gte: since } },
        },
    } as QueryFilter<IPost>)
        .select('userId connectionId storyTargets')
        .limit(MAX_STORIES_PER_SYNC);

    // Stories posted directly on Facebook or Instagram, found by the import.
    const imported = await ImportedPost.find({
        ...(options.userId ? { userId: options.userId } : {}),
        kind: 'story',
        publishedAt: { $gte: since },
    } as QueryFilter<IImportedPost>)
        .select('userId connectionId platform externalId publishedAt')
        .limit(MAX_STORIES_PER_SYNC)
        .lean<IImportedPost[]>();

    const stories = [
        ...liveStories(posts, since),
        ...imported.map((story) => ({
            userId: String(story.userId),
            connectionId: String(story.connectionId),
            postId: String(story._id),
            platform: story.platform,
            externalId: story.externalId,
            publishedAt: story.publishedAt,
        })),
    ];
    if (stories.length === 0) return { synced: 0, failed: 0 };

    const connections = await SocialConnection.find({
        _id: { $in: [...new Set(stories.map((story) => story.connectionId))] },
        tokenStatus: 'active',
    } as QueryFilter<ISocialConnection>).select('+pageAccessTokenEnc userId');

    const tokens = new Map<string, string>();
    for (const connection of connections) {
        try {
            tokens.set(String(connection._id), decryptSecret(connection.pageAccessTokenEnc));
        } catch {
            // A token that cannot be decrypted needs a reconnect; skip its Stories.
        }
    }
    const owners = new Map(
        connections.map((connection) => [String(connection._id), String(connection.userId)])
    );

    let synced = 0;
    let failed = 0;
    for (const story of stories) {
        const token = tokens.get(story.connectionId);
        // The Page must still belong to the Story's owner.
        if (!token || owners.get(story.connectionId) !== story.userId) continue;
        try {
            const result =
                story.platform === 'instagram'
                    ? await fetchInstagram(story.externalId, token)
                    : await fetchFacebook(story.externalId, token);
            await saveSnapshot(story, result, now);
            synced += 1;
        } catch (error) {
            failed += 1;
            console.error(
                `[stories] Insights failed for ${story.platform} Story ${story.postId}:`,
                error instanceof Error ? sanitizeErrorMessage(error.message) : error
            );
        }
    }

    return { synced, failed };
}
