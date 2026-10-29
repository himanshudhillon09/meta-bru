import type { QueryFilter } from 'mongoose';
import { Post, type IPost, type MediaType, type Platform } from '../models/postModel.js';
import type { SnapshotStatus } from '../models/postMetricSnapshotModel.js';
import {
    StoryMetricSnapshot,
    type IStoryMetricSnapshot,
    type IStoryMetrics,
} from '../models/storyMetricSnapshotModel.js';
import type { AnalyticsRange } from './analyticsDateService.js';
import { mediaTypeMatch, type AnalyticsFilters } from './analyticsService.js';
import { STORY_INSIGHT_WINDOW_MS } from './storySyncService.js';

const STORY_LIFETIME_MS = 24 * 60 * 60_000;
const MAX_STORY_POSTS = 200;

export interface StorySummary {
    stories: number;
    /** Stories still inside Meta's 24-hour window. */
    live: number;
    reach: number;
    views: number;
    replies: number;
    shares: number;
    interactions: number;
    tapsForward: number;
    tapsBack: number;
    exits: number;
    swipesForward: number;
    /** Exits as a share of views, 0-100. Lower is better. */
    exitRate: number | null;
}

export interface StoryRow {
    postId: string;
    caption: string;
    mediaUrl: string;
    mediaType: MediaType;
    platform: Platform;
    pageName: string;
    publishedAt: string;
    expiresAt: string;
    live: boolean;
    metrics: IStoryMetrics | null;
    metricsAt: string | null;
    status: SnapshotStatus | 'waiting';
    error: string;
}

interface PopulatedConnection {
    pageName?: string;
    userId?: unknown;
}

function sum(rows: StoryRow[], key: keyof IStoryMetrics): number {
    return rows.reduce((total, row) => total + (row.metrics?.[key] ?? 0), 0);
}

export function summarizeStories(rows: StoryRow[], now = Date.now()): StorySummary {
    const views = sum(rows, 'views');
    const exits = sum(rows, 'exits');
    const withExits = rows.some((row) => row.metrics?.exits !== null && row.metrics?.exits !== undefined);
    return {
        stories: rows.length,
        live: rows.filter((row) => new Date(row.expiresAt).getTime() > now).length,
        reach: sum(rows, 'reach'),
        views,
        replies: sum(rows, 'replies'),
        shares: sum(rows, 'shares'),
        interactions: sum(rows, 'interactions'),
        tapsForward: sum(rows, 'tapsForward'),
        tapsBack: sum(rows, 'tapsBack'),
        exits,
        swipesForward: sum(rows, 'swipesForward'),
        exitRate: withExits && views > 0 ? Math.round((exits / views) * 1000) / 10 : null,
    };
}

/**
 * Every Story shared in the range, newest first, with the last insights saved
 * for it. A Story with no snapshot yet is "waiting" while it is live.
 */
export async function getStoryAnalytics(
    userId: string,
    range: Pick<AnalyticsRange, 'from' | 'to'>,
    filters: AnalyticsFilters,
    now = new Date()
): Promise<{ summary: StorySummary; stories: StoryRow[] }> {
    const posts = await Post.find({
        userId,
        storyTargets: {
            $elemMatch: {
                status: 'published',
                publishedAt: { $gte: range.from, $lte: range.to },
                ...(filters.platform ? { platform: filters.platform } : {}),
            },
        },
        ...(filters.connectionId ? { connectionId: filters.connectionId } : {}),
        ...mediaTypeMatch(filters.mediaType),
    } as QueryFilter<IPost>)
        .populate('connectionId', 'pageName userId')
        .select('caption mediaUrl mediaType mediaCoverUrl storyTargets connectionId')
        .limit(MAX_STORY_POSTS);

    const snapshots = await StoryMetricSnapshot.find({
        userId,
        postId: { $in: posts.map((post) => post._id) },
    } as QueryFilter<IStoryMetricSnapshot>);
    const byKey = new Map(
        snapshots.map((snapshot) => [`${snapshot.postId}:${snapshot.platform}`, snapshot])
    );

    const rows: StoryRow[] = [];
    for (const post of posts) {
        const connection = post.connectionId as unknown as PopulatedConnection | null;
        const pageName =
            connection && String(connection.userId) === userId ? connection.pageName || '' : '';
        for (const target of post.storyTargets ?? []) {
            if (target.status !== 'published' || !target.publishedAt) continue;
            if (target.publishedAt < range.from || target.publishedAt > range.to) continue;
            if (filters.platform && target.platform !== filters.platform) continue;

            const snapshot = byKey.get(`${post._id}:${target.platform}`);
            const expiresAt = new Date(target.publishedAt.getTime() + STORY_LIFETIME_MS);
            const live = expiresAt > now;
            const syncable = now.getTime() - target.publishedAt.getTime() < STORY_INSIGHT_WINDOW_MS;
            rows.push({
                postId: String(post._id),
                caption: post.caption,
                mediaUrl: post.mediaType === 'reel' ? post.mediaCoverUrl || '' : post.mediaUrl,
                mediaType: post.mediaType === 'reel' ? 'reel' : 'image',
                platform: target.platform,
                pageName,
                publishedAt: target.publishedAt.toISOString(),
                expiresAt: expiresAt.toISOString(),
                live,
                metrics: snapshot?.metricsCapturedAt ? snapshot.metrics : null,
                metricsAt: snapshot?.metricsCapturedAt?.toISOString() ?? null,
                status: snapshot ? snapshot.status : syncable ? 'waiting' : 'unavailable',
                error: snapshot
                    ? snapshot.error
                    : syncable
                      ? ''
                      : 'This Story expired before Meta-Bru could read its insights.',
            });
        }
    }

    rows.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    return { summary: summarizeStories(rows, now.getTime()), stories: rows };
}
