import { Types, type PipelineStage, type QueryFilter } from 'mongoose';
import { ImportedPost, type IImportedPost } from '../models/importedPostModel.js';
import { Post } from '../models/postModel.js';
import type { IPost, MediaType, Platform, PostStatus } from '../models/postModel.js';
import {
    PostMetricSnapshot,
    type IAnalyticsMetrics,
    type IPostMetricSnapshot,
} from '../models/postMetricSnapshotModel.js';
import { SocialConnection } from '../models/socialConnectionModel.js';
import {
    buildAnalyticsBuckets,
    bucketKeyForDate,
    istHour,
    istHourBlock,
    istWeekday,
    previousAnalyticsRange,
    type AnalyticsRange,
} from './analyticsDateService.js';

export type ContentSource = 'metabru' | 'native';

export interface AnalyticsFilters {
    connectionId?: string;
    platform?: Platform;
    /** Only image posts or only reels. */
    mediaType?: MediaType;
    /** Only posts made in Meta-Bru, or only posts made directly on Facebook or Instagram. */
    source?: ContentSource;
}

export interface PublishedTarget {
    postId: string;
    connectionId: string;
    pageId: string;
    pageName: string;
    platform: Platform;
    externalId: string;
    publishedAt: Date;
    caption: string;
    mediaUrl: string;
    postStatus: PostStatus;
    instagramUsername: string;
    mediaType: MediaType;
    /** Reel length in seconds; null for images. */
    mediaDuration: number | null;
    /** Facebook Reels: the video id their insights are read from. */
    videoId: string;
    sharedToStory: boolean;
    hasTextOverlay: boolean;
    /** Story shares of this post, for the Share to Story button. */
    storyTargets: Array<{ platform: Platform; status: string; error: string }>;
    /** When the Page token was last stored by a Meta login, if known. */
    tokenUpdatedAt: Date | null;
    /** Permissions Meta granted at that login. Empty when unknown. */
    grantedScopes: string[];
    /** Made in Meta-Bru, or published directly on Facebook or Instagram. */
    source: ContentSource;
    /** Link to the post on Meta, when known (posts made outside Meta-Bru). */
    permalink: string;
}

export interface PermissionErrorSummary {
    connectionId: string;
    pageName: string;
    /** The first platform that reported the error for this Page. */
    platform: Platform;
    platforms: Platform[];
    /** Meta's own error message, sanitized. */
    error: string;
    /** Insight permissions the last Meta login did not grant. */
    missingScopes: string[];
    /**
     * True when reconnecting is expected to fix the error: the Page has not
     * been reconnected since insights were added, or a permission is missing.
     * False when Meta still refuses after a full reconnect, which needs a Meta
     * app or Page-role fix instead.
     */
    reconnectRequired: boolean;
}

export interface AnalyticsSummary {
    posts: number;
    facebookPosts: number;
    instagramPosts: number;
    reach: number;
    views: number;
    interactions: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    clicks: number;
    engagementRate: number | null;
    /** Distinct reels among `posts`. */
    reels: number;
    /** Average watch time per reel target, when Meta reported it. */
    avgWatchTimeMs: number | null;
    /** How much of each reel people watched on average, 0-100. */
    watchedPercent: number | null;
}

export interface ActivityBucket {
    date: string;
    label: string;
    posts: number;
    facebook: number;
    instagram: number;
    reach: number;
    views: number;
    interactions: number;
}

export interface BestTimeBucket {
    day: number;
    dayLabel: string;
    block: number;
    label: string;
    posts: number;
    /** Only once 2 or more posts share the slot; tips rely on this. */
    avgEngagementRate: number | null;
    /** The rate from however many posts the slot has, for the heatmap. */
    engagementRate: number | null;
}

export interface MonitorPoint {
    capturedAt: string;
    reach: number;
    views: number;
    interactions: number;
    engagementRate: number | null;
}

const MAX_POST_PAGE = 10_000;

/** Permissions Meta requires to read insights for each platform. */
export const INSIGHT_SCOPES: Record<Platform, string[]> = {
    facebook: ['pages_read_engagement', 'read_insights'],
    instagram: [
        'instagram_basic',
        'instagram_manage_insights',
        'pages_read_engagement',
    ],
};

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const BLOCK_LABELS = [
    '00:00–03:00 IST',
    '03:00–06:00 IST',
    '06:00–09:00 IST',
    '09:00–12:00 IST',
    '12:00–15:00 IST',
    '15:00–18:00 IST',
    '18:00–21:00 IST',
    '21:00–24:00 IST',
];

export function targetKey(postId: string, platform: Platform): string {
    return `${postId}:${platform}`;
}

/**
 * A snapshot captured before the Page's latest Meta login describes the old
 * token. Its errors no longer apply and it should be refreshed.
 */
export function snapshotPredatesToken(
    snapshot: { capturedAt: Date },
    target: Pick<PublishedTarget, 'tokenUpdatedAt'>
): boolean {
    return Boolean(
        target.tokenUpdatedAt && snapshot.capturedAt < target.tokenUpdatedAt
    );
}

export function missingInsightScopes(
    target: Pick<PublishedTarget, 'grantedScopes' | 'platform'>
): string[] {
    const granted = target.grantedScopes ?? [];
    if (granted.length === 0) return [];
    return INSIGHT_SCOPES[target.platform].filter(
        (scope) => !granted.includes(scope)
    );
}

export function latestSnapshotsByTarget(
    snapshots: IPostMetricSnapshot[]
): Map<string, IPostMetricSnapshot> {
    const latest = new Map<string, IPostMetricSnapshot>();
    for (const snapshot of snapshots) {
        const key = targetKey(String(snapshot.postId), snapshot.platform);
        const current = latest.get(key);
        if (!current || snapshot.capturedAt > current.capturedAt) {
            latest.set(key, snapshot);
        }
    }
    return latest;
}

function finiteOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function finiteOrZero(value: unknown): number {
    return finiteOrNull(value) ?? 0;
}

/**
 * The denominator for a target's engagement rate. Reach is preferred, but a
 * target that only reports views uses views instead of contributing zero
 * reach to a global total.
 */
function rateDenominator(metrics: IAnalyticsMetrics): number {
    const reach = finiteOrNull(metrics.reach);
    if (reach !== null && reach > 0) return reach;
    const views = finiteOrNull(metrics.views);
    if (views !== null && views > 0) return views;
    return 0;
}

function rateFrom(interactions: number, denominator: number): number | null {
    return Number.isFinite(interactions) &&
        Number.isFinite(denominator) &&
        denominator > 0
        ? Math.round((interactions / denominator) * 1000) / 10
        : null;
}

/**
 * The interaction numerator for a target. Meta does not always return the
 * aggregate `interactions` metric, so fall back to summing the components that
 * are available. Returning null (rather than 0) keeps an unknown target out of
 * the rate denominator instead of diluting the overall rate.
 */
function availableInteractions(metrics: IAnalyticsMetrics): number | null {
    const aggregate = finiteOrNull(metrics.interactions);
    if (aggregate !== null) return aggregate;
    const values = [
        metrics.likes,
        metrics.comments,
        metrics.shares,
        metrics.saves,
    ]
        .map((value) => finiteOrNull(value))
        .filter((value): value is number => value !== null);
    return values.length > 0
        ? values.reduce((sum, value) => sum + value, 0)
        : null;
}

export function summarizeTargets(
    targets: PublishedTarget[],
    latest: Map<string, IPostMetricSnapshot>
): AnalyticsSummary {
    const postIds = new Set<string>();
    let facebookPosts = 0;
    let instagramPosts = 0;
    let reach = 0;
    let views = 0;
    let interactions = 0;
    let likes = 0;
    let comments = 0;
    let shares = 0;
    let saves = 0;
    let clicks = 0;
    let rateInteractions = 0;
    let rateDenominatorTotal = 0;
    const reelIds = new Set<string>();
    const watchTimes: number[] = [];
    const watchedShares: number[] = [];

    for (const target of targets) {
        postIds.add(target.postId);
        if (target.mediaType === 'reel') reelIds.add(target.postId);
        if (target.platform === 'facebook') facebookPosts += 1;
        else instagramPosts += 1;

        const metrics = latest.get(targetKey(target.postId, target.platform))?.metrics;
        if (!metrics) continue;
        const watchTime = finiteOrNull(metrics.avgWatchTimeMs);
        if (target.mediaType === 'reel' && watchTime !== null && watchTime > 0) {
            watchTimes.push(watchTime);
            if (target.mediaDuration) {
                watchedShares.push(Math.min(1, watchTime / (target.mediaDuration * 1000)));
            }
        }
        const interactionsForTarget = availableInteractions(metrics);
        reach += finiteOrZero(metrics.reach);
        views += finiteOrZero(metrics.views);
        interactions += interactionsForTarget ?? 0;
        likes += finiteOrZero(metrics.likes);
        comments += finiteOrZero(metrics.comments);
        shares += finiteOrZero(metrics.shares);
        saves += finiteOrZero(metrics.saves);
        clicks += finiteOrZero(metrics.clicks);

        const denominator = rateDenominator(metrics);
        if (denominator > 0 && interactionsForTarget !== null) {
            rateInteractions += interactionsForTarget;
            rateDenominatorTotal += denominator;
        }
    }

    return {
        posts: postIds.size,
        facebookPosts,
        instagramPosts,
        reach,
        views,
        interactions,
        likes,
        comments,
        shares,
        saves,
        clicks,
        engagementRate: rateFrom(rateInteractions, rateDenominatorTotal),
        reels: reelIds.size,
        avgWatchTimeMs: watchTimes.length > 0 ? Math.round(mean(watchTimes)) : null,
        watchedPercent:
            watchedShares.length > 0 ? Math.round(mean(watchedShares) * 1000) / 10 : null,
    };
}

function mean(values: number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function buildActivity(
    targets: PublishedTarget[],
    latest: Map<string, IPostMetricSnapshot>,
    range: Pick<AnalyticsRange, 'fromKey' | 'toKey' | 'granularity'>
): ActivityBucket[] {
    const buckets = buildAnalyticsBuckets(range);
    const byKey = new Map(
        buckets.map((bucket) => [
            bucket.key,
            {
                ...bucket,
                postIds: new Set<string>(),
                facebook: 0,
                instagram: 0,
                reach: 0,
                views: 0,
                interactions: 0,
            },
        ])
    );

    for (const target of targets) {
        const key = bucketKeyForDate(target.publishedAt, range.granularity);
        const bucket = byKey.get(key);
        if (!bucket) continue;
        bucket.postIds.add(target.postId);
        if (target.platform === 'facebook') bucket.facebook += 1;
        else bucket.instagram += 1;
        const metrics = latest.get(targetKey(target.postId, target.platform))?.metrics;
        if (metrics) {
            bucket.reach += finiteOrZero(metrics.reach);
            bucket.views += finiteOrZero(metrics.views);
            bucket.interactions += availableInteractions(metrics) ?? 0;
        }
    }

    return buckets.map((bucket) => {
        const value = byKey.get(bucket.key)!;
        return {
            date: bucket.key,
            label: bucket.label,
            posts: value.postIds.size,
            facebook: value.facebook,
            instagram: value.instagram,
            reach: value.reach,
            views: value.views,
            interactions: value.interactions,
        };
    });
}

export interface PageSummary {
    connectionId: string;
    pageName: string;
    instagramUsername: string;
    totals: AnalyticsSummary;
    facebook: AnalyticsSummary;
    instagram: AnalyticsSummary;
}

/** Each Page's results, highest reach first, for comparing Pages. */
export function summarizeByPage(
    targets: PublishedTarget[],
    latest: Map<string, IPostMetricSnapshot>
): PageSummary[] {
    const byPage = new Map<string, PublishedTarget[]>();
    for (const target of targets) {
        byPage.set(target.connectionId, [...(byPage.get(target.connectionId) ?? []), target]);
    }
    return [...byPage.entries()]
        .map(([connectionId, pageTargets]) => ({
            connectionId,
            pageName: pageTargets[0]?.pageName || 'Page',
            instagramUsername: pageTargets[0]?.instagramUsername || '',
            totals: summarizeTargets(pageTargets, latest),
            facebook: summarizeTargets(
                pageTargets.filter((target) => target.platform === 'facebook'),
                latest
            ),
            instagram: summarizeTargets(
                pageTargets.filter((target) => target.platform === 'instagram'),
                latest
            ),
        }))
        .sort((a, b) => b.totals.reach - a.totals.reach);
}

export interface TopPost {
    postId: string;
    source: ContentSource;
    caption: string;
    mediaUrl: string;
    mediaType: MediaType;
    pageName: string;
    platforms: Platform[];
    publishedAt: string;
    reach: number;
    views: number;
    interactions: number;
    engagementRate: number | null;
}

/** Posts need this much reach before a high engagement rate counts. */
const MIN_REACH_FOR_RATE = 10;

/**
 * The best posts in the range, Facebook and Instagram copies combined: by
 * reach, and by engagement rate among posts that reached enough people.
 */
export function topPosts(
    targets: PublishedTarget[],
    latest: Map<string, IPostMetricSnapshot>,
    limit = 5
): { byReach: TopPost[]; byEngagement: TopPost[] } {
    const posts = new Map<string, TopPost & { rateInteractions: number; rateDenominator: number }>();
    for (const target of targets) {
        const metrics = latest.get(targetKey(target.postId, target.platform))?.metrics;
        if (!metrics) continue;
        const post = posts.get(target.postId) ?? {
            postId: target.postId,
            source: target.source,
            caption: target.caption.slice(0, 160),
            mediaUrl: target.mediaUrl,
            mediaType: target.mediaType,
            pageName: target.pageName,
            platforms: [],
            publishedAt: target.publishedAt.toISOString(),
            reach: 0,
            views: 0,
            interactions: 0,
            engagementRate: null,
            rateInteractions: 0,
            rateDenominator: 0,
        };
        if (!post.platforms.includes(target.platform)) post.platforms.push(target.platform);
        if (target.publishedAt.toISOString() < post.publishedAt) {
            post.publishedAt = target.publishedAt.toISOString();
        }
        const interactions = availableInteractions(metrics);
        post.reach += finiteOrZero(metrics.reach);
        post.views += finiteOrZero(metrics.views);
        post.interactions += interactions ?? 0;
        const denominator = rateDenominator(metrics);
        if (denominator > 0 && interactions !== null) {
            post.rateInteractions += interactions;
            post.rateDenominator += denominator;
        }
        posts.set(target.postId, post);
    }

    const rows = [...posts.values()].map(({ rateInteractions, rateDenominator, ...post }) => ({
        ...post,
        engagementRate: rateFrom(rateInteractions, rateDenominator),
    }));
    return {
        byReach: rows
            .filter((post) => post.reach > 0 || post.views > 0)
            .sort((a, b) => b.reach - a.reach || b.views - a.views)
            .slice(0, limit),
        byEngagement: rows
            .filter((post) => post.engagementRate !== null && post.reach >= MIN_REACH_FOR_RATE)
            .sort((a, b) => (b.engagementRate ?? 0) - (a.engagementRate ?? 0))
            .slice(0, limit),
    };
}

export function buildBestTimes(
    targets: PublishedTarget[],
    latest: Map<string, IPostMetricSnapshot>
): BestTimeBucket[] {
    const buckets = new Map<
        string,
        {
            postIds: Set<string>;
            rateInteractions: number;
            rateDenominator: number;
        }
    >();

    for (const target of targets) {
        const day = istWeekday(target.publishedAt);
        const block = istHourBlock(target.publishedAt);
        const key = `${day}:${block}`;
        const value = buckets.get(key) ?? {
            postIds: new Set<string>(),
            rateInteractions: 0,
            rateDenominator: 0,
        };
        value.postIds.add(target.postId);
        const metrics = latest.get(targetKey(target.postId, target.platform))?.metrics;
        if (metrics) {
            const denominator = rateDenominator(metrics);
            const interactions = availableInteractions(metrics);
            if (denominator > 0 && interactions !== null) {
                value.rateInteractions += interactions;
                value.rateDenominator += denominator;
            }
        }
        buckets.set(key, value);
    }

    const result: BestTimeBucket[] = [];
    for (let day = 1; day <= 7; day += 1) {
        for (let block = 0; block < 8; block += 1) {
            const value = buckets.get(`${day}:${block}`) ?? {
                postIds: new Set<string>(),
                rateInteractions: 0,
                rateDenominator: 0,
            };
            result.push({
                day,
                dayLabel: DAY_LABELS[day - 1] || '',
                block,
                label: BLOCK_LABELS[block] || '',
                posts: value.postIds.size,
                avgEngagementRate:
                    value.postIds.size >= 2
                        ? rateFrom(value.rateInteractions, value.rateDenominator)
                        : null,
                engagementRate: rateFrom(value.rateInteractions, value.rateDenominator),
            });
        }
    }
    return result;
}

export function buildMonitorSeries(
    snapshots: IPostMetricSnapshot[]
): {
    all: MonitorPoint[];
    facebook: MonitorPoint[];
    instagram: MonitorPoint[];
} {
    const bucket = (date: Date) =>
        new Date(Math.floor(date.getTime() / 300_000) * 300_000).toISOString();

    function build(platform?: Platform): MonitorPoint[] {
        const grouped = new Map<
            string,
            { targets: Map<string, IPostMetricSnapshot> }
        >();

        for (const snapshot of snapshots) {
            if (platform && snapshot.platform !== platform) continue;
            const bucketKey = bucket(snapshot.capturedAt);
            let value = grouped.get(bucketKey);
            if (!value) {
                value = { targets: new Map() };
                grouped.set(bucketKey, value);
            }
            // Keep only the latest snapshot per target within the bucket so a
            // retry or double-click cannot double-count the same target.
            const key = targetKey(String(snapshot.postId), snapshot.platform);
            const current = value.targets.get(key);
            if (!current || snapshot.capturedAt > current.capturedAt) {
                value.targets.set(key, snapshot);
            }
        }

        return [...grouped.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([capturedAt, value]) => {
                let reach = 0;
                let views = 0;
                let interactions = 0;
                let rateInteractions = 0;
                let rateDenominatorTotal = 0;

                for (const snapshot of value.targets.values()) {
                    const metrics = snapshot.metrics;
                    if (!metrics) continue;
                    const interactionsForTarget = availableInteractions(metrics);
                    reach += finiteOrZero(metrics.reach);
                    views += finiteOrZero(metrics.views);
                    interactions += interactionsForTarget ?? 0;
                    const denominator = rateDenominator(metrics);
                    if (denominator > 0 && interactionsForTarget !== null) {
                        rateInteractions += interactionsForTarget;
                        rateDenominatorTotal += denominator;
                    }
                }

                return {
                    capturedAt,
                    reach,
                    views,
                    interactions,
                    engagementRate: rateFrom(
                        rateInteractions,
                        rateDenominatorTotal
                    ),
                };
            });
    }

    return { all: build(), facebook: build('facebook'), instagram: build('instagram') };
}

export function buildPublishedTargetsQuery(
    userId: string,
    range: Pick<AnalyticsRange, 'from' | 'to'>,
    filters: AnalyticsFilters
): Record<string, unknown> {
    const query: Record<string, unknown> = {
        userId,
        status: { $in: ['published', 'partial'] },
        // A post may have been published before the range while one of its
        // targets was published inside it. Match both the post and target
        // publish times, then filter precisely in loadPublishedTargets.
        $or: [
            { 'targets.publishedAt': { $gte: range.from, $lte: range.to } },
            { publishedAt: { $gte: range.from, $lte: range.to } },
        ],
    };
    if (filters.connectionId) query.connectionId = filters.connectionId;
    Object.assign(query, mediaTypeMatch(filters.mediaType));
    return query;
}

/** Older posts have no mediaType and are images. */
export function mediaTypeMatch(mediaType: MediaType | undefined): Record<string, unknown> {
    if (mediaType === 'reel') return { mediaType: 'reel' };
    if (mediaType === 'image') return { mediaType: { $ne: 'reel' } };
    return {};
}

interface PostLike {
    _id?: { toString(): string };
    connectionId?: unknown;
    connection?: ConnectionLike | null;
    populated?: (path: string) => unknown;
    caption?: string;
    mediaUrl?: string;
    mediaType?: 'image' | 'reel';
    mediaCoverUrl?: string;
    mediaDuration?: number;
    hasTextOverlay?: boolean;
    status?: PostStatus;
    publishedAt?: Date | null;
    targets?: Array<{
        platform: Platform;
        status: string;
        externalId?: string;
        creationId?: string;
        publishedAt?: Date | null;
    }>;
    storyTargets?: Array<{ platform: Platform; status: string; error?: string }>;
}

interface ConnectionLike {
    _id?: { toString(): string };
    userId?: unknown;
    pageName?: string;
    pageId?: string;
    instagram?: { username?: string } | null;
    tokenUpdatedAt?: Date | null;
    grantedScopes?: string[];
}

function rawConnectionId(post: PostLike): unknown {
    const populated =
        typeof post.populated === 'function'
            ? post.populated('connectionId')
            : undefined;
    return populated ?? post.connectionId;
}

function targetsFromPost(
    post: PostLike,
    connection: ConnectionLike | null,
    filters: AnalyticsFilters,
    range: Pick<AnalyticsRange, 'from' | 'to'>
): PublishedTarget[] {
    if (!post._id) return [];
    const rawId = rawConnectionId(post);
    const connectionId = connection?._id
        ? String(connection._id)
        : rawId
          ? String(rawId)
          : '';
    if (!connectionId) return [];
    const mediaType: MediaType = post.mediaType === 'reel' ? 'reel' : 'image';
    if (filters.mediaType && filters.mediaType !== mediaType) return [];
    const targets: PublishedTarget[] = [];
    for (const target of post.targets ?? []) {
        if (target.status !== 'published') continue;
        if (filters.platform && target.platform !== filters.platform) continue;
        const publishedAt = target.publishedAt || post.publishedAt;
        if (!publishedAt || publishedAt < range.from || publishedAt > range.to) {
            continue;
        }
        targets.push({
            postId: String(post._id),
            connectionId,
            pageId: connection?.pageId || '',
            pageName: connection?.pageName || 'Connected page',
            platform: target.platform,
            externalId: target.externalId || '',
            publishedAt,
            caption: post.caption || '',
            // A reel's mediaUrl is an MP4; previews need its cover image.
            mediaUrl:
                post.mediaType === 'reel'
                    ? post.mediaCoverUrl || ''
                    : post.mediaUrl || '',
            postStatus: post.status || 'published',
            instagramUsername: connection?.instagram?.username || '',
            mediaType,
            mediaDuration:
                mediaType === 'reel' && post.mediaDuration ? post.mediaDuration : null,
            // A Facebook reel keeps its video id from the upload in creationId.
            videoId:
                mediaType === 'reel' && target.platform === 'facebook'
                    ? target.creationId || target.externalId || ''
                    : '',
            sharedToStory: (post.storyTargets ?? []).some(
                (story) => story.platform === target.platform && story.status === 'published'
            ),
            hasTextOverlay: Boolean(post.hasTextOverlay),
            storyTargets: (post.storyTargets ?? []).map((story) => ({
                platform: story.platform,
                status: story.status,
                error: story.error || '',
            })),
            tokenUpdatedAt: connection?.tokenUpdatedAt ?? null,
            grantedScopes: connection?.grantedScopes ?? [],
            source: 'metabru',
            permalink: '',
        });
    }
    return targets;
}

/**
 * Posts and reels published on the user's Pages outside Meta-Bru, as targets
 * so every summary, chart, and insights sync treats them like any other.
 */
export async function loadImportedTargets(
    userId: string,
    range: Pick<AnalyticsRange, 'from' | 'to'>,
    filters: AnalyticsFilters
): Promise<PublishedTarget[]> {
    if (filters.source === 'metabru') return [];
    const query: Record<string, unknown> = {
        userId,
        kind: filters.mediaType === 'reel' ? 'reel' : filters.mediaType === 'image' ? 'post' : { $in: ['post', 'reel'] },
        publishedAt: { $gte: range.from, $lte: range.to },
    };
    if (filters.connectionId) query.connectionId = filters.connectionId;
    if (filters.platform) query.platform = filters.platform;
    const [imported, connections] = await Promise.all([
        ImportedPost.find(query as QueryFilter<IImportedPost>).sort({ publishedAt: -1 }).lean<IImportedPost[]>(),
        SocialConnection.find({ userId }, 'pageName pageId instagram tokenUpdatedAt grantedScopes').lean<
            Array<ConnectionLike & { _id: { toString(): string } }>
        >(),
    ]);
    const byId = new Map(connections.map((connection) => [String(connection._id), connection]));
    return imported.flatMap((item) => {
        const connection = byId.get(String(item.connectionId));
        if (!connection) return [];
        const reel = item.kind === 'reel';
        return [
            {
                postId: String(item._id),
                connectionId: String(item.connectionId),
                pageId: connection.pageId || '',
                pageName: connection.pageName || 'Connected page',
                platform: item.platform,
                externalId: item.externalId,
                publishedAt: item.publishedAt,
                caption: item.caption,
                mediaUrl: item.mediaUrl,
                postStatus: 'published' as PostStatus,
                instagramUsername: connection.instagram?.username || '',
                mediaType: (reel ? 'reel' : 'image') as MediaType,
                mediaDuration: null,
                videoId: reel && item.platform === 'facebook' ? item.videoId || item.externalId : '',
                sharedToStory: false,
                hasTextOverlay: false,
                storyTargets: [],
                tokenUpdatedAt: connection.tokenUpdatedAt ?? null,
                grantedScopes: connection.grantedScopes ?? [],
                source: 'native' as ContentSource,
                permalink: item.permalink,
            },
        ];
    });
}

export async function loadPublishedTargets(
    userId: string,
    range: AnalyticsRange,
    filters: AnalyticsFilters
): Promise<PublishedTarget[]> {
    const [own, imported] = await Promise.all([
        filters.source === 'native' ? Promise.resolve([]) : loadOwnTargets(userId, range, filters),
        loadImportedTargets(userId, range, filters),
    ]);
    return [...own, ...imported].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}

async function loadOwnTargets(
    userId: string,
    range: AnalyticsRange,
    filters: AnalyticsFilters
): Promise<PublishedTarget[]> {
    const posts = await Post.find(
        buildPublishedTargetsQuery(userId, range, filters) as QueryFilter<IPost>
    )
        .populate(
            'connectionId',
            'pageName pageId instagram userId tokenUpdatedAt grantedScopes'
        )
        .sort({ publishedAt: -1 });

    const targets: PublishedTarget[] = [];
    for (const post of posts) {
        const raw = post as unknown as PostLike;
        const connection = (post.connectionId as unknown as ConnectionLike | null) ?? null;
        // A populated connection must belong to the requesting user before its
        // Page details are trusted; otherwise fall back to the raw id only.
        const ownedConnection =
            connection && (!connection.userId || String(connection.userId) === userId)
                ? connection
                : null;
        targets.push(...targetsFromPost(raw, ownedConnection, filters, range));
    }
    return targets;
}

export function buildSnapshotQuery(
    userId: string,
    targets: PublishedTarget[],
    range?: Pick<AnalyticsRange, 'from' | 'to'>
): Record<string, unknown> | null {
    const postIds = [...new Set(targets.map((target) => target.postId))];
    if (postIds.length === 0) return null;

    const query: Record<string, unknown> = {
        userId,
        postId: { $in: postIds },
    };
    if (range) {
        query.publishedAt = { $gte: range.from, $lte: range.to };
    }
    return query;
}

export async function loadSnapshots(
    userId: string,
    targets: PublishedTarget[],
    range?: Pick<AnalyticsRange, 'from' | 'to'>
): Promise<IPostMetricSnapshot[]> {
    const query = buildSnapshotQuery(userId, targets, range);
    if (!query) return [];
    return PostMetricSnapshot.find(query as QueryFilter<IPostMetricSnapshot>).sort({
        capturedAt: -1,
    });
}

/**
 * Returns only the newest snapshot per post/platform, so overview and posts
 * endpoints never load every historical snapshot for a target.
 */
export function buildLatestSnapshotsPipeline(
    userId: string,
    targets: PublishedTarget[],
    range?: Pick<AnalyticsRange, 'from' | 'to'>
): PipelineStage[] {
    const postIds = [...new Set(targets.map((target) => target.postId))].map(
        (postId) => new Types.ObjectId(postId)
    );
    const match: Record<string, unknown> = {
        userId: new Types.ObjectId(userId),
        postId: { $in: postIds },
    };
    if (range) {
        match.publishedAt = { $gte: range.from, $lte: range.to };
    }
    return [
        { $match: match },
        { $sort: { postId: 1, platform: 1, capturedAt: -1 } },
        {
            $group: {
                _id: { postId: '$postId', platform: '$platform' },
                doc: { $first: '$$ROOT' },
            },
        },
        { $replaceRoot: { newRoot: '$doc' } },
    ];
}

export async function loadLatestSnapshots(
    userId: string,
    targets: PublishedTarget[],
    range?: Pick<AnalyticsRange, 'from' | 'to'>
): Promise<IPostMetricSnapshot[]> {
    if (targets.length === 0) return [];
    return PostMetricSnapshot.aggregate<IPostMetricSnapshot>(
        buildLatestSnapshotsPipeline(userId, targets, range)
    );
}

const MONITOR_HISTORY_DAYS = 90;
const MONITOR_SNAPSHOT_LIMIT = 50_000;
export const MONITOR_TARGET_LIMIT = 100;

/**
 * The live monitor is a recent-history view. The overview remains the
 * full-range historical view, so this bounds the monitor to a rolling window
 * and the most recent MONITOR_TARGET_LIMIT targets in the selected scope.
 * Queries are issued per target so each one can use the
 * (postId, platform, capturedAt) index, and the total row count stays bounded
 * by MONITOR_SNAPSHOT_LIMIT.
 */
export async function loadMonitorSnapshots(
    userId: string,
    targets: PublishedTarget[],
    range: AnalyticsRange
): Promise<IPostMetricSnapshot[]> {
    const uniqueTargets = new Map<string, PublishedTarget>();
    for (const target of targets) {
        uniqueTargets.set(targetKey(target.postId, target.platform), target);
    }
    const monitorTargets = [...uniqueTargets.values()]
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
        .slice(0, MONITOR_TARGET_LIMIT);
    if (monitorTargets.length === 0) return [];
    const cutoff = new Date(Date.now() - MONITOR_HISTORY_DAYS * 86_400_000);
    const capturedAt = { $gte: cutoff > range.from ? cutoff : range.from };
    const perTargetLimit = Math.max(
        1,
        Math.floor(MONITOR_SNAPSHOT_LIMIT / monitorTargets.length)
    );
    const results = await Promise.all(
        monitorTargets.map((target) =>
            PostMetricSnapshot.find({
                userId,
                postId: target.postId,
                platform: target.platform,
                publishedAt: { $gte: range.from, $lte: range.to },
                capturedAt,
            } as QueryFilter<IPostMetricSnapshot>)
                .sort({ capturedAt: -1 })
                .limit(perTargetLimit)
        )
    );
    return results.flat();
}

export function monitorSeriesTruncated(targets: PublishedTarget[]): boolean {
    return (
        new Set(targets.map((target) => targetKey(target.postId, target.platform)))
            .size > MONITOR_TARGET_LIMIT
    );
}

export function uniquePermissionErrors(
    targets: PublishedTarget[],
    latest: Map<string, IPostMetricSnapshot>
): PermissionErrorSummary[] {
    const targetsByKey = new Map(
        targets.map((target) => [targetKey(target.postId, target.platform), target])
    );
    const byConnection = new Map<string, PermissionErrorSummary>();
    for (const [key, snapshot] of latest) {
        const target = targetsByKey.get(key);
        if (!target) continue;
        if (snapshot.status !== 'permission_error') continue;
        // The Page was reconnected after this error was recorded, so the error
        // belongs to the old token. The next sync re-checks it.
        if (snapshotPredatesToken(snapshot, target)) continue;

        const connectionId = String(snapshot.connectionId);
        const missingScopes = missingInsightScopes(target);
        const existing = byConnection.get(connectionId);
        // A Page shares one connection across Facebook and Instagram. Report
        // it once, keeping the first encountered snapshot's platform.
        if (existing) {
            if (!existing.platforms.includes(snapshot.platform)) {
                existing.platforms.push(snapshot.platform);
            }
            existing.error = existing.error || snapshot.error || '';
            for (const scope of missingScopes) {
                if (!existing.missingScopes.includes(scope)) {
                    existing.missingScopes.push(scope);
                }
            }
            existing.reconnectRequired =
                !target.tokenUpdatedAt || existing.missingScopes.length > 0;
            continue;
        }
        byConnection.set(connectionId, {
            connectionId,
            pageName: snapshot.pageName,
            platform: snapshot.platform,
            platforms: [snapshot.platform],
            error: snapshot.error || '',
            missingScopes,
            reconnectRequired:
                !target.tokenUpdatedAt || missingScopes.length > 0,
        });
    }
    return [...byConnection.values()];
}

export function lastSyncedAt(
    targets: PublishedTarget[],
    latest: Map<string, IPostMetricSnapshot>
): string | null {
    const targetKeys = new Set(
        targets.map((target) => targetKey(target.postId, target.platform))
    );
    let newest: Date | null = null;
    for (const [key, snapshot] of latest) {
        if (!targetKeys.has(key)) continue;
        if (!newest || snapshot.capturedAt > newest) newest = snapshot.capturedAt;
    }
    return newest ? newest.toISOString() : null;
}

function staleCount(
    targets: PublishedTarget[],
    latest: Map<string, IPostMetricSnapshot>,
    minutes: number
): number {
    const before = Date.now() - minutes * 60_000;
    return targets.filter((target) => {
        const snapshot = latest.get(targetKey(target.postId, target.platform));
        return (
            !snapshot ||
            snapshot.capturedAt.getTime() < before ||
            snapshotPredatesToken(snapshot, target)
        );
    }).length;
}

function remainingTargets(
    targets: PublishedTarget[],
    latest: Map<string, IPostMetricSnapshot>
): number {
    return targets.filter(
        (target) => !latest.has(targetKey(target.postId, target.platform))
    ).length;
}

export function rangePreset(
    range: Pick<AnalyticsRange, 'from' | 'to'>
): '7d' | '30d' | '60d' | '90d' | 'custom' {
    const days = Math.round(
        (range.to.getTime() - range.from.getTime()) / 86_400_000
    );
    if (days === 7) return '7d';
    if (days === 30) return '30d';
    if (days === 60) return '60d';
    if (days === 90) return '90d';
    return 'custom';
}

export async function resolvePageName(
    userId: string,
    connectionId: string,
    targets: PublishedTarget[]
): Promise<string> {
    const fromTargets = targets[0]?.pageName;
    if (fromTargets) return fromTargets;
    const connection = await SocialConnection.findOne(
        { _id: connectionId, userId },
        'pageName'
    );
    return connection?.pageName || 'Page';
}

/** Totals for the same number of days before `range`, for deltas. */
async function previousPeriod(
    userId: string,
    range: AnalyticsRange,
    filters: AnalyticsFilters
): Promise<{ range: { from: string; to: string }; totals: AnalyticsSummary } | null> {
    const previous = previousAnalyticsRange(range);
    if (!previous) return null;
    const targets = await loadPublishedTargets(userId, previous, filters);
    const snapshots = await loadLatestSnapshots(userId, targets, previous);
    return {
        range: { from: previous.fromKey, to: previous.toKey },
        totals: summarizeTargets(targets, latestSnapshotsByTarget(snapshots)),
    };
}

export async function getAnalyticsOverview(
    userId: string,
    range: AnalyticsRange,
    filters: AnalyticsFilters,
    /** Also total the period before, for "vs previous period". */
    options: { compare?: boolean } = {}
) {
    const [targets, previous] = await Promise.all([
        loadPublishedTargets(userId, range, filters),
        options.compare ? previousPeriod(userId, range, filters) : Promise.resolve(null),
    ]);
    const snapshots = await loadLatestSnapshots(userId, targets, range);
    const latest = latestSnapshotsByTarget(snapshots);
    const summary = summarizeTargets(targets, latest);

    const byPlatform = {
        facebook: summarizeTargets(
            targets.filter((target) => target.platform === 'facebook'),
            latest
        ),
        instagram: summarizeTargets(
            targets.filter((target) => target.platform === 'instagram'),
            latest
        ),
    };

    return {
        byContentType: summarizeByContentType(targets, latest),
        range: {
            from: range.fromKey,
            to: range.toKey,
            preset: rangePreset(range),
            timezone: 'Asia/Kolkata',
        },
        totals: summary,
        previous,
        byPlatform,
        byPage: summarizeByPage(targets, latest),
        bySource: {
            metabru: summarizeTargets(targets.filter((target) => target.source === 'metabru'), latest),
            native: summarizeTargets(targets.filter((target) => target.source === 'native'), latest),
        },
        topPosts: topPosts(targets, latest),
        activity: buildActivity(targets, latest, range),
        bestTimes: buildBestTimes(targets, latest),
        sync: {
            lastSyncedAt: lastSyncedAt(targets, latest),
            staleTargets: staleCount(targets, latest, 15),
            remainingTargets: remainingTargets(targets, latest),
            // Read again after a reconnect even if today's refresh already ran.
            reconnectPending: targets.filter((target) => {
                const snapshot = latest.get(targetKey(target.postId, target.platform));
                return snapshot !== undefined && snapshotPredatesToken(snapshot, target);
            }).length,
            permissionErrors: uniquePermissionErrors(targets, latest),
        },
    };
}

/** Image posts and reels summarized separately, for the format comparison. */
export function summarizeByContentType(
    targets: PublishedTarget[],
    latest: Map<string, IPostMetricSnapshot>
): { image: AnalyticsSummary; reel: AnalyticsSummary } {
    return {
        image: summarizeTargets(
            targets.filter((target) => target.mediaType === 'image'),
            latest
        ),
        reel: summarizeTargets(
            targets.filter((target) => target.mediaType === 'reel'),
            latest
        ),
    };
}

function nextSyncAt(now = Date.now()): string {
    const interval = 5 * 60_000;
    return new Date(Math.floor(now / interval) * interval + interval).toISOString();
}

export async function getAnalyticsMonitor(
    userId: string,
    range: AnalyticsRange,
    filters: AnalyticsFilters
) {
    const targets = await loadPublishedTargets(userId, range, filters);
    const [latestSnapshots, snapshots] = await Promise.all([
        loadLatestSnapshots(userId, targets, range),
        loadMonitorSnapshots(userId, targets, range),
    ]);
    const latest = latestSnapshotsByTarget(latestSnapshots);
    const summary = summarizeTargets(targets, latest);
    const targetKeys = new Set(
        targets.map((target) => targetKey(target.postId, target.platform))
    );
    const series = buildMonitorSeries(
        snapshots.filter((snapshot) =>
            targetKeys.has(targetKey(String(snapshot.postId), snapshot.platform))
        )
    );

    const recentPosts = [...targets]
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
        .slice(0, 5)
        .map((target) => ({
            postId: target.postId,
            caption: target.caption,
            mediaUrl: target.mediaUrl,
            pageName: target.pageName,
            platform: target.platform,
            mediaType: target.mediaType,
            mediaDuration: target.mediaDuration,
            publishedAt: target.publishedAt.toISOString(),
            metrics: latest.get(targetKey(target.postId, target.platform))?.metrics ?? null,
        }));

    const pageName = filters.connectionId
        ? await resolvePageName(userId, filters.connectionId, targets)
        : 'All Pages';

    return {
        scope: {
            connectionId: filters.connectionId || null,
            pageName,
        },
        summary,
        series,
        seriesTruncated: monitorSeriesTruncated(targets),
        recentPosts,
        sync: {
            lastSyncedAt: lastSyncedAt(targets, latest),
            nextSyncAt: nextSyncAt(),
            staleTargets: staleCount(targets, latest, 5),
            permissionErrors: uniquePermissionErrors(targets, latest),
        },
    };
}

export async function getAnalyticsPosts(
    userId: string,
    range: AnalyticsRange,
    filters: AnalyticsFilters,
    page: number,
    limit: number
) {
    const safePage = Math.min(MAX_POST_PAGE, Math.max(1, Math.floor(page) || 1));
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit) || 25));
    // Posts made outside Meta-Bru live in their own collection, so the page is
    // cut after merging both: newest first, a post's copies kept together.
    const allTargets = await loadPublishedTargets(userId, range, filters);
    const order: string[] = [];
    const newest = new Map<string, number>();
    for (const target of allTargets) {
        const time = target.publishedAt.getTime();
        if (!newest.has(target.postId)) order.push(target.postId);
        newest.set(target.postId, Math.max(newest.get(target.postId) ?? 0, time));
    }
    order.sort((a, b) => (newest.get(b) ?? 0) - (newest.get(a) ?? 0));
    const total = order.length;
    const pageIds = new Set(order.slice((safePage - 1) * safeLimit, safePage * safeLimit));
    const targets = allTargets.filter((target) => pageIds.has(target.postId));
    const snapshots = await loadLatestSnapshots(userId, targets, range);
    const latest = latestSnapshotsByTarget(snapshots);
    const grouped = new Map<string, PublishedTarget[]>();

    for (const target of targets) {
        const list = grouped.get(target.postId) ?? [];
        list.push(target);
        grouped.set(target.postId, list);
    }

    const posts = [...grouped.entries()]
        .map(([postId, postTargets]) => ({
            postId,
            caption: postTargets[0]?.caption || '',
            mediaUrl: postTargets[0]?.mediaUrl || '',
            mediaType: postTargets[0]?.mediaType || 'image',
            mediaDuration: postTargets[0]?.mediaDuration ?? null,
            storyTargets: postTargets[0]?.storyTargets ?? [],
            status: postTargets[0]?.postStatus || 'published',
            source: postTargets[0]?.source ?? 'metabru',
            permalink: postTargets[0]?.permalink || '',
            connection: {
                id: postTargets[0]?.connectionId || '',
                pageId: postTargets[0]?.pageId || '',
                pageName: postTargets[0]?.pageName || '',
                instagramUsername: postTargets[0]?.instagramUsername || '',
            },
            latestPublishedAt: Math.max(
                ...postTargets.map((target) => target.publishedAt.getTime())
            ),
            targets: postTargets.map((target) => {
                const snapshot = latest.get(targetKey(target.postId, target.platform));
                const outdatedError =
                    snapshot !== undefined &&
                    snapshot.status === 'permission_error' &&
                    snapshotPredatesToken(snapshot, target);
                const status = outdatedError
                    ? 'unavailable'
                    : snapshot?.status || 'unavailable';
                return {
                    platform: target.platform,
                    externalId: target.externalId,
                    publishedAt: target.publishedAt.toISOString(),
                    metrics: snapshot?.metrics ?? null,
                    availableMetrics: snapshot?.availableMetrics ?? [],
                    snapshotAt: snapshot?.capturedAt.toISOString() || null,
                    metricsAt: snapshot
                        ? (snapshot.metricsCapturedAt ?? snapshot.capturedAt).toISOString()
                        : null,
                    status,
                    error: outdatedError
                        ? 'Page reconnected. Insights refresh on the next sync.'
                        : snapshot?.error || '',
                    reconnectRequired:
                        status === 'permission_error' &&
                        (!target.tokenUpdatedAt ||
                            missingInsightScopes(target).length > 0),
                };
            }),
        }))
        .sort((a, b) => b.latestPublishedAt - a.latestPublishedAt);

    const start = (safePage - 1) * safeLimit;
    const pagePosts = posts.map(({ latestPublishedAt, ...post }) => post);

    return {
        posts: pagePosts,
        page: safePage,
        limit: safeLimit,
        total,
        hasMore: start + safeLimit < total,
    };
}

export type TipCategory = 'timing' | 'format' | 'content' | 'consistency' | 'growth';

export interface RuleBasedTip {
    id: string;
    title: string;
    body: string;
    severity: 'info' | 'success' | 'warning';
    category: TipCategory;
    actionLabel: string;
    actionHref: string;
    /** A ready-to-make post or reel that acts on the tip. */
    idea: { format: 'post' | 'reel'; topic: string } | null;
}

/** The first line of a caption, short enough to reuse as an AI topic. */
function captionTopic(caption: string): string {
    const firstLine = caption.split('\n').find((line) => line.trim()) ?? '';
    return firstLine.replace(/#\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 150);
}

function seconds(ms: number): string {
    return `${Math.round(ms / 100) / 10}s`;
}

export function buildRuleBasedTips(input: {
    summary: AnalyticsSummary;
    byPlatform: { facebook: AnalyticsSummary; instagram: AnalyticsSummary };
    byContentType: { image: AnalyticsSummary; reel: AnalyticsSummary };
    bestTimes: BestTimeBucket[];
    activity: ActivityBucket[];
    permissionErrors: Array<{ pageName: string; reconnectRequired?: boolean }>;
    posts: Array<{ caption: string; mediaType: MediaType; engagementRate: number | null }>;
    /** Story totals for the same range. */
    stories?: { stories: number; exitRate: number | null };
    granularity: 'day' | 'week';
}): RuleBasedTip[] {
    const tips: RuleBasedTip[] = [];
    const overallRate = input.summary.engagementRate;

    if (input.summary.posts === 0) {
        return [{
            id: 'no-posts',
            title: 'No published posts in this range',
            body: 'Publish a post or widen the date range to start building analytics.',
            severity: 'info',
            category: 'consistency',
            actionLabel: 'Open composer',
            actionHref: '/composer',
            idea: null,
        }];
    }

    const best = input.bestTimes
        .filter((bucket) => bucket.posts >= 2 && bucket.avgEngagementRate !== null)
        .sort((a, b) => (b.avgEngagementRate || 0) - (a.avgEngagementRate || 0))[0];

    if (best && overallRate && best.avgEngagementRate) {
        const multiplier = Math.round((best.avgEngagementRate / overallRate) * 10) / 10;
        tips.push({
            id: 'best-time',
            title: `${best.dayLabel} ${best.label} works best`,
            body: `Your ${best.dayLabel} ${best.label} posts average ${best.avgEngagementRate}% engagement, ${multiplier}× your overall average.`,
            severity: multiplier >= 1.2 ? 'success' : 'info',
            category: 'timing',
            actionLabel: 'Open connections',
            actionHref: '/connections',
            idea: null,
        });
    }

    // Reels against image posts, once there are a few of each.
    const images = input.byContentType.image;
    const reels = input.byContentType.reel;
    if (
        images.posts >= 2 &&
        reels.posts >= 2 &&
        images.engagementRate !== null &&
        reels.engagementRate !== null
    ) {
        const reelsWin = reels.engagementRate >= images.engagementRate;
        const high = Math.max(reels.engagementRate, images.engagementRate);
        const low = Math.min(reels.engagementRate, images.engagementRate);
        const multiplier = low > 0 ? Math.round((high / low) * 10) / 10 : 0;
        const reachPerReel = Math.round(reels.reach / reels.posts);
        const reachPerImage = Math.round(images.reach / images.posts);
        tips.push({
            id: 'format',
            title: reelsWin ? 'Reels are your strongest format' : 'Image posts beat your reels',
            body: `${reelsWin ? 'Reels' : 'Image posts'} average ${high}% engagement versus ${low}%${
                multiplier >= 1.1 ? ` (${multiplier}×)` : ''
            }. Reach per post: reels ${reachPerReel.toLocaleString('en-IN')}, images ${reachPerImage.toLocaleString('en-IN')}.`,
            severity: multiplier >= 1.2 ? 'success' : 'info',
            category: 'format',
            actionLabel: reelsWin ? 'Make a reel' : 'Open composer',
            actionHref: reelsWin ? '/reels' : '/composer',
            idea: null,
        });
    } else if (images.posts >= 3 && reels.posts === 0) {
        tips.push({
            id: 'format',
            title: 'Try a reel',
            body: `All ${images.posts} posts in this range are images. Reels are shown to people who don't follow you yet, so a short reel can widen your reach.`,
            severity: 'info',
            category: 'format',
            actionLabel: 'Make a reel',
            actionHref: '/reels',
            idea: null,
        });
    }

    // Watch time tells whether reels hold attention.
    if (reels.posts >= 1 && reels.watchedPercent !== null && reels.avgWatchTimeMs !== null) {
        if (reels.watchedPercent < 35) {
            tips.push({
                id: 'watch-time',
                title: 'Viewers leave your reels early',
                body: `People watch ${reels.watchedPercent}% of your reels on average (${seconds(
                    reels.avgWatchTimeMs
                )}). Show the payoff in the first 2 seconds, add text on screen, or keep reels under 15 seconds.`,
                severity: 'warning',
                category: 'content',
                actionLabel: 'Make a reel',
                actionHref: '/reels',
                idea: null,
            });
        } else if (reels.watchedPercent >= 60) {
            tips.push({
                id: 'watch-time',
                title: 'Your reels hold attention',
                body: `People watch ${reels.watchedPercent}% of your reels on average (${seconds(
                    reels.avgWatchTimeMs
                )}). Keep the same pacing and length.`,
                severity: 'success',
                category: 'content',
                actionLabel: 'Make a reel',
                actionHref: '/reels',
                idea: null,
            });
        }
    }

    const facebookRate = input.byPlatform.facebook.engagementRate;
    const instagramRate = input.byPlatform.instagram.engagementRate;
    if (
        input.byPlatform.facebook.posts >= 2 &&
        input.byPlatform.instagram.posts >= 2 &&
        facebookRate !== null &&
        instagramRate !== null
    ) {
        const winner = instagramRate >= facebookRate ? 'Instagram' : 'Facebook';
        const winnerRate = Math.max(facebookRate, instagramRate);
        const loserRate = Math.min(facebookRate, instagramRate);
        const multiplier = loserRate > 0 ? Math.round((winnerRate / loserRate) * 10) / 10 : 0;
        tips.push({
            id: 'platform',
            title: `${winner} is your stronger platform`,
            body: `${winner} averages ${winnerRate}% engagement versus ${loserRate}% on the other platform${multiplier ? `, about ${multiplier}× better` : ''}.`,
            severity: 'success',
            category: 'growth',
            actionLabel: 'Open composer',
            actionHref: '/composer',
            idea: null,
        });
    }

    const daysWithPosts = input.activity.filter((bucket) => bucket.posts > 0);
    if (daysWithPosts.length > 1) {
        const span = input.granularity === 'week' ? 7 : 1;
        let longestGap = 0;
        for (let index = 1; index < daysWithPosts.length; index += 1) {
            const previous = new Date(`${daysWithPosts[index - 1]?.date}T00:00:00+05:30`);
            const current = new Date(`${daysWithPosts[index]?.date}T00:00:00+05:30`);
            longestGap = Math.max(
                longestGap,
                Math.round((current.getTime() - previous.getTime()) / 86_400_000) -
                    span
            );
        }
        if (longestGap >= 7) {
            tips.push({
                id: 'gap',
                title: 'You had a long posting gap',
                body: `Your longest gap in this range was ${longestGap} days. A steady cadence can help reach stay consistent.`,
                severity: 'warning',
                category: 'consistency',
                actionLabel: 'Open queue',
                actionHref: '/queue',
                idea: null,
            });
        }
    }

    // Stories give each post a second chance with followers.
    const stories = input.stories;
    if (stories && input.summary.posts >= 3 && stories.stories === 0) {
        tips.push({
            id: 'stories',
            title: 'Share your posts to Stories',
            body: `None of your ${input.summary.posts} posts in this range were shared to Stories. A Story puts each post in front of your followers a second time.`,
            severity: 'info',
            category: 'growth',
            actionLabel: 'Open activity',
            actionHref: '/activity',
            idea: null,
        });
    } else if (stories && stories.exitRate !== null && stories.exitRate >= 20) {
        tips.push({
            id: 'stories',
            title: 'People leave your Stories early',
            body: `${stories.exitRate}% of Story views ended with an exit. Share your strongest posts and reels to Stories, and keep text large and readable.`,
            severity: 'warning',
            category: 'content',
            actionLabel: 'Open activity',
            actionHref: '/activity',
            idea: null,
        });
    }

    const topPost = [...input.posts]
        .filter((post) => post.engagementRate !== null)
        .sort((a, b) => (b.engagementRate || 0) - (a.engagementRate || 0))[0];
    if (topPost && topPost.engagementRate !== null) {
        const topic = captionTopic(topPost.caption);
        const reel = topPost.mediaType === 'reel';
        tips.push({
            id: 'top-post',
            title: `Your top ${reel ? 'reel' : 'post'} is worth repeating`,
            body: `Your best ${reel ? 'reel' : 'post'} earned ${topPost.engagementRate}% engagement${
                topic ? `: "${topic.slice(0, 70)}${topic.length > 70 ? '…' : ''}"` : ''
            }. Make another on the same angle.`,
            severity: 'success',
            category: 'content',
            actionLabel: reel ? 'Make a reel' : 'Open composer',
            actionHref: reel ? '/reels' : '/composer',
            idea: topic ? { format: reel ? 'reel' : 'post', topic: `A fresh take on: ${topic}` } : null,
        });
    }

    const reconnectPages = new Set(
        input.permissionErrors
            .filter((error) => error.reconnectRequired !== false)
            .map((error) => error.pageName)
    );
    const blockedPages = new Set(
        input.permissionErrors
            .filter((error) => error.reconnectRequired === false)
            .map((error) => error.pageName)
    );
    if (reconnectPages.size > 0) {
        const count = reconnectPages.size;
        tips.push({
            id: 'permissions',
            title: 'Reconnect to unlock reach data',
            body: `${count} Page${count === 1 ? '' : 's'} ${count === 1 ? 'needs' : 'need'} insight permission. Reconnect to load complete engagement data.`,
            severity: 'warning',
            category: 'growth',
            actionLabel: 'Open connections',
            actionHref: '/connections',
            idea: null,
        });
    } else if (blockedPages.size > 0) {
        const count = blockedPages.size;
        tips.push({
            id: 'permissions',
            title: 'Meta is still blocking insights',
            body: `${count} Page${count === 1 ? ' was' : 's were'} reconnected, but Meta still refuses insights. Check the Meta app permissions and your Page access; the banner above shows Meta's exact message.`,
            severity: 'warning',
            category: 'growth',
            actionLabel: 'Open connections',
            actionHref: '/connections',
            idea: null,
        });
    }

    return tips.slice(0, 8);
}

function publishingFrequency(activity: ActivityBucket[], uniquePosts: number) {
    const posts = uniquePosts;
    const activeBuckets = activity.filter((bucket) => bucket.posts > 0).length;
    const round1 = (value: number) => Math.round(value * 10) / 10;
    return {
        posts,
        activeBuckets,
        buckets: activity.length,
        postsPerBucket: activity.length > 0 ? round1(posts / activity.length) : 0,
        postsPerActiveBucket:
            activeBuckets > 0 ? round1(posts / activeBuckets) : 0,
    };
}

function longestGapDays(
    activity: ActivityBucket[],
    granularity: 'day' | 'week'
): number {
    const active = activity.filter((bucket) => bucket.posts > 0);
    if (active.length < 2) return 0;
    const span = granularity === 'week' ? 7 : 1;
    let longest = 0;
    for (let index = 1; index < active.length; index += 1) {
        const previous = new Date(`${active[index - 1]?.date}T00:00:00+05:30`);
        const current = new Date(`${active[index]?.date}T00:00:00+05:30`);
        longest = Math.max(
            longest,
            Math.round((current.getTime() - previous.getTime()) / 86_400_000) -
                span
        );
    }
    return longest;
}

export interface AnalyticsAiPostInput {
    postId: string;
    caption: string;
    mediaType: MediaType;
    mediaDuration: number | null;
    publishedAt: Date;
    sharedToStory: boolean;
    hasTextOverlay: boolean;
    metrics: IAnalyticsMetrics | null;
}

/**
 * One row per post for the AI, with the traits it can compare between strong
 * and weak posts. A cross-posted post appears once per platform; those rows are
 * combined, and the rate keeps its own numerator/denominator so a target that
 * reports only views contributes views rather than a zero reach.
 */
function aiPostRows(posts: AnalyticsAiPostInput[]) {
    const byPost = new Map<
        string,
        {
            post: AnalyticsAiPostInput;
            reach: number;
            views: number;
            interactions: number;
            rateInteractions: number;
            rateDenominator: number;
            watchTimes: number[];
        }
    >();

    for (const post of posts) {
        const row = byPost.get(post.postId) ?? {
            post,
            reach: 0,
            views: 0,
            interactions: 0,
            rateInteractions: 0,
            rateDenominator: 0,
            watchTimes: [],
        };
        if (post.publishedAt < row.post.publishedAt) row.post = { ...row.post, publishedAt: post.publishedAt };
        row.post = {
            ...row.post,
            sharedToStory: row.post.sharedToStory || post.sharedToStory,
        };
        const metrics = post.metrics;
        if (metrics) {
            const reach = finiteOrZero(metrics.reach);
            const views = finiteOrZero(metrics.views);
            const interactions = availableInteractions(metrics);
            row.reach += reach;
            row.views += views;
            row.interactions += interactions ?? 0;
            const denominator = rateDenominator(metrics);
            if (denominator > 0 && interactions !== null) {
                row.rateInteractions += interactions;
                row.rateDenominator += denominator;
            }
            const watch = finiteOrNull(metrics.avgWatchTimeMs);
            if (watch !== null && watch > 0) row.watchTimes.push(watch);
        }
        byPost.set(post.postId, row);
    }

    return [...byPost.values()].map((row) => {
        const { post } = row;
        const avgWatchMs = row.watchTimes.length > 0 ? mean(row.watchTimes) : null;
        return {
            format: post.mediaType,
            lengthSec: post.mediaDuration,
            caption: post.caption.replace(/\s+/g, ' ').trim().slice(0, 160),
            captionLength: post.caption.length,
            hashtags: (post.caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length,
            textOnImage: post.hasTextOverlay,
            sharedToStory: post.sharedToStory,
            day: DAY_LABELS[istWeekday(post.publishedAt) - 1] || '',
            hourIST: istHour(post.publishedAt),
            reach: row.reach,
            views: row.views,
            interactions: row.interactions,
            engagementRate: rateFrom(row.rateInteractions, row.rateDenominator),
            avgWatchSec: avgWatchMs === null ? null : Math.round(avgWatchMs / 100) / 10,
            watchedPercent:
                avgWatchMs !== null && post.mediaDuration
                    ? Math.min(100, Math.round((avgWatchMs / (post.mediaDuration * 10)) * 10) / 10)
                    : null,
        };
    });
}

export function buildAnalyticsAiPayload(input: {
    range: AnalyticsRange;
    scopeName: string;
    summary: AnalyticsSummary;
    byPlatform: { facebook: AnalyticsSummary; instagram: AnalyticsSummary };
    byContentType: { image: AnalyticsSummary; reel: AnalyticsSummary };
    /** Story totals (reach, views, replies, taps, exit rate) for the range. */
    stories?: object;
    activity: ActivityBucket[];
    bestTimes: BestTimeBucket[];
    permissionErrors: Array<{ pageName: string }>;
    posts: AnalyticsAiPostInput[];
    brandProfile: Record<string, string | undefined>;
}) {
    const rows = aiPostRows(input.posts);
    const rated = rows.filter((row) => row.engagementRate !== null && row.reach + row.views > 0);
    const byEngagement = [...rated].sort(
        (a, b) => (b.engagementRate || 0) - (a.engagementRate || 0)
    );
    const best = byEngagement.slice(0, 5);
    const weakest = byEngagement.slice(5).slice(-5).reverse();

    const permissionPages = new Set(
        input.permissionErrors.map((error) => error.pageName)
    );

    return {
        range: { from: input.range.fromKey, to: input.range.toKey, timezone: 'Asia/Kolkata' },
        scopeName: input.scopeName,
        summary: input.summary,
        byPlatform: input.byPlatform,
        byContentType: input.byContentType,
        stories: input.stories ?? null,
        activity: input.activity.filter((bucket) => bucket.posts > 0),
        publishingFrequency: publishingFrequency(input.activity, input.summary.posts),
        longestGapDays: longestGapDays(input.activity, input.range.granularity),
        bestTimes: input.bestTimes.filter((bucket) => bucket.posts > 0),
        permissionErrors: [...permissionPages].map((pageName) => ({ pageName })),
        topReachPosts: [...rows].sort((a, b) => b.reach - a.reach).slice(0, 5),
        bestEngagementPosts: best,
        weakestPosts: weakest,
        brandProfile: input.brandProfile,
    };
}
