import type { QueryFilter } from 'mongoose';
import { Post } from '../models/postModel.js';
import type { IPost, Platform, PostStatus } from '../models/postModel.js';
import {
    PostMetricSnapshot,
    type IAnalyticsMetrics,
    type IPostMetricSnapshot,
} from '../models/postMetricSnapshotModel.js';
import { SocialConnection } from '../models/socialConnectionModel.js';
import {
    buildAnalyticsBuckets,
    bucketKeyForDate,
    istHourBlock,
    istWeekday,
    type AnalyticsRange,
} from './analyticsDateService.js';

export interface AnalyticsFilters {
    connectionId?: string;
    platform?: Platform;
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
}

export interface ActivityBucket {
    date: string;
    label: string;
    posts: number;
    facebook: number;
    instagram: number;
    reach: number;
    interactions: number;
}

export interface BestTimeBucket {
    day: number;
    dayLabel: string;
    block: number;
    label: string;
    posts: number;
    avgEngagementRate: number | null;
}

export interface MonitorPoint {
    capturedAt: string;
    reach: number;
    views: number;
    interactions: number;
    engagementRate: number | null;
}

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

/**
 * The denominator for a target's engagement rate. Reach is preferred, but a
 * target that only reports views uses views instead of contributing zero
 * reach to a global total.
 */
function rateDenominator(metrics: IAnalyticsMetrics): number {
    if (metrics.reach !== null && metrics.reach > 0) return metrics.reach;
    if (metrics.views !== null && metrics.views > 0) return metrics.views;
    return 0;
}

function rateFrom(interactions: number, denominator: number): number | null {
    return denominator > 0
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
    if (metrics.interactions !== null) return metrics.interactions;
    const values = [
        metrics.likes,
        metrics.comments,
        metrics.shares,
        metrics.saves,
    ].filter((value): value is number => value !== null);
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

    for (const target of targets) {
        postIds.add(target.postId);
        if (target.platform === 'facebook') facebookPosts += 1;
        else instagramPosts += 1;

        const metrics = latest.get(targetKey(target.postId, target.platform))?.metrics;
        if (!metrics) continue;
        const interactionsForTarget = availableInteractions(metrics);
        reach += metrics.reach ?? 0;
        views += metrics.views ?? 0;
        interactions += interactionsForTarget ?? 0;
        likes += metrics.likes ?? 0;
        comments += metrics.comments ?? 0;
        shares += metrics.shares ?? 0;
        saves += metrics.saves ?? 0;
        clicks += metrics.clicks ?? 0;

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
    };
}

export function buildActivity(
    targets: PublishedTarget[],
    latest: Map<string, IPostMetricSnapshot>,
    range: Pick<AnalyticsRange, 'fromKey' | 'toKey' | 'granularity'>
): ActivityBucket[] {
    const buckets = buildAnalyticsBuckets(range as AnalyticsRange);
    const byKey = new Map(
        buckets.map((bucket) => [
            bucket.key,
            {
                ...bucket,
                postIds: new Set<string>(),
                facebook: 0,
                instagram: 0,
                reach: 0,
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
            bucket.reach += metrics.reach ?? 0;
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
            interactions: value.interactions,
        };
    });
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
                    const interactionsForTarget = availableInteractions(metrics);
                    reach += metrics.reach ?? 0;
                    views += metrics.views ?? 0;
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
    return query;
}

export async function loadPublishedTargets(
    userId: string,
    range: AnalyticsRange,
    filters: AnalyticsFilters
): Promise<PublishedTarget[]> {
    const posts = await Post.find(
        buildPublishedTargetsQuery(userId, range, filters) as QueryFilter<IPost>
    )
        .populate('connectionId', 'pageName pageId instagram')
        .sort({ publishedAt: -1 });

    const targets: PublishedTarget[] = [];
    for (const post of posts) {
        const connection = post.connectionId as unknown as {
            _id?: { toString(): string };
            pageName?: string;
            pageId?: string;
            instagram?: { username?: string } | null;
        };
        if (!connection || !connection._id) continue;

        for (const target of post.targets) {
            if (target.status !== 'published') continue;
            if (filters.platform && target.platform !== filters.platform) continue;
            const publishedAt = target.publishedAt || post.publishedAt;
            if (!publishedAt || publishedAt < range.from || publishedAt > range.to) {
                continue;
            }
            targets.push({
                postId: String(post._id),
                connectionId: String(connection._id),
                pageId: connection.pageId || '',
                pageName: connection.pageName || 'Connected page',
                platform: target.platform,
                externalId: target.externalId,
                publishedAt,
                caption: post.caption,
                mediaUrl: post.mediaUrl,
                postStatus: post.status,
                instagramUsername: connection.instagram?.username || '',
            });
        }
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

export function uniquePermissionErrors(
    targets: PublishedTarget[],
    latest: Map<string, IPostMetricSnapshot>
): Array<{ connectionId: string; pageName: string; platform: Platform }> {
    const targetKeys = new Set(
        targets.map((target) => targetKey(target.postId, target.platform))
    );
    const seen = new Set<string>();
    const errors: Array<{ connectionId: string; pageName: string; platform: Platform }> = [];
    for (const [key, snapshot] of latest) {
        if (!targetKeys.has(key)) continue;
        if (snapshot.status !== 'permission_error') continue;
        const connectionId = String(snapshot.connectionId);
        // A Page shares one connection across Facebook and Instagram. Dedupe by
        // connection so one reconnect action is surfaced once, keeping the first
        // encountered snapshot's platform for that Page.
        if (seen.has(connectionId)) continue;
        seen.add(connectionId);
        errors.push({
            connectionId,
            pageName: snapshot.pageName,
            platform: snapshot.platform,
        });
    }
    return errors;
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
        return !snapshot || snapshot.capturedAt.getTime() < before;
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

async function resolvePageName(
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

export async function getAnalyticsOverview(
    userId: string,
    range: AnalyticsRange,
    filters: AnalyticsFilters
) {
    const targets = await loadPublishedTargets(userId, range, filters);
    const snapshots = await loadSnapshots(userId, targets, range);
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
        range: {
            from: range.fromKey,
            to: range.toKey,
            preset: rangePreset(range),
            timezone: 'Asia/Kolkata',
        },
        totals: summary,
        byPlatform,
        activity: buildActivity(targets, latest, range),
        bestTimes: buildBestTimes(targets, latest),
        sync: {
            lastSyncedAt: lastSyncedAt(targets, latest),
            staleTargets: staleCount(targets, latest, 15),
            remainingTargets: remainingTargets(targets, latest),
            permissionErrors: uniquePermissionErrors(targets, latest),
        },
    };
}

export async function getAnalyticsMonitor(
    userId: string,
    range: AnalyticsRange,
    filters: AnalyticsFilters
) {
    const targets = await loadPublishedTargets(userId, range, filters);
    const snapshots = await loadSnapshots(userId, targets, range);
    const latest = latestSnapshotsByTarget(snapshots);
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
        recentPosts,
        sync: {
            lastSyncedAt: lastSyncedAt(targets, latest),
            nextSyncAt: new Date(Date.now() + 5 * 60_000).toISOString(),
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
    const targets = await loadPublishedTargets(userId, range, filters);
    const snapshots = await loadSnapshots(userId, targets, range);
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
            status: postTargets[0]?.postStatus || 'published',
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
                return {
                    platform: target.platform,
                    externalId: target.externalId,
                    publishedAt: target.publishedAt.toISOString(),
                    metrics: snapshot?.metrics ?? null,
                    availableMetrics: snapshot?.availableMetrics ?? [],
                    snapshotAt: snapshot?.capturedAt.toISOString() || null,
                    status: snapshot?.status || 'unavailable',
                    error: snapshot?.error || '',
                };
            }),
        }))
        .sort((a, b) => b.latestPublishedAt - a.latestPublishedAt);

    const start = (page - 1) * limit;
    const pagePosts = posts.slice(start, start + limit).map(({ latestPublishedAt, ...post }) => post);

    return {
        posts: pagePosts,
        page,
        limit,
        total: posts.length,
        hasMore: start + limit < posts.length,
    };
}

export interface RuleBasedTip {
    id: string;
    title: string;
    body: string;
    severity: 'info' | 'success' | 'warning';
    actionLabel: string;
    actionHref: string;
}

export function buildRuleBasedTips(input: {
    summary: AnalyticsSummary;
    byPlatform: { facebook: AnalyticsSummary; instagram: AnalyticsSummary };
    bestTimes: BestTimeBucket[];
    activity: ActivityBucket[];
    permissionErrors: Array<{ pageName: string }>;
    posts: Array<{ caption: string; engagementRate: number | null }>;
}): RuleBasedTip[] {
    const tips: RuleBasedTip[] = [];
    const overallRate = input.summary.engagementRate;

    if (input.summary.posts === 0) {
        return [{
            id: 'no-posts',
            title: 'No published posts in this range',
            body: 'Publish a post or widen the date range to start building analytics.',
            severity: 'info',
            actionLabel: 'Open composer',
            actionHref: '/composer',
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
            actionLabel: 'Open composer',
            actionHref: '/composer',
        });
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
            actionLabel: 'Open composer',
            actionHref: '/composer',
        });
    }

    const daysWithPosts = input.activity.filter((bucket) => bucket.posts > 0);
    if (daysWithPosts.length > 1) {
        let longestGap = 0;
        for (let index = 1; index < daysWithPosts.length; index += 1) {
            const previous = new Date(`${daysWithPosts[index - 1]?.date}T00:00:00+05:30`);
            const current = new Date(`${daysWithPosts[index]?.date}T00:00:00+05:30`);
            longestGap = Math.max(
                longestGap,
                Math.round((current.getTime() - previous.getTime()) / 86_400_000) - 1
            );
        }
        if (longestGap >= 7) {
            tips.push({
                id: 'gap',
                title: 'You had a long posting gap',
                body: `Your longest gap in this range was ${longestGap} days. A steady cadence can help reach stay consistent.`,
                severity: 'warning',
                actionLabel: 'Open queue',
                actionHref: '/queue',
            });
        }
    }

    const topPost = [...input.posts]
        .filter((post) => post.engagementRate !== null)
        .sort((a, b) => (b.engagementRate || 0) - (a.engagementRate || 0))[0];
    if (topPost && topPost.engagementRate !== null) {
        tips.push({
            id: 'top-post',
            title: 'Your top post is worth repeating',
            body: `Your best post earned ${topPost.engagementRate}% engagement. Reuse its angle or format in a future post.`,
            severity: 'success',
            actionLabel: 'Open composer',
            actionHref: '/composer',
        });
    }

    if (input.permissionErrors.length > 0) {
        const count = input.permissionErrors.length;
        tips.push({
            id: 'permissions',
            title: 'Reconnect to unlock reach data',
            body: `${count} Page${count === 1 ? '' : 's'} ${count === 1 ? 'needs' : 'need'} insight permission. Reconnect to load complete engagement data.`,
            severity: 'warning',
            actionLabel: 'Open connections',
            actionHref: '/connections',
        });
    }

    return tips.slice(0, 6);
}

function publishingFrequency(activity: ActivityBucket[]) {
    const posts = activity.reduce((sum, bucket) => sum + bucket.posts, 0);
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

export function buildAnalyticsAiPayload(input: {
    range: AnalyticsRange;
    scopeName: string;
    summary: AnalyticsSummary;
    byPlatform: { facebook: AnalyticsSummary; instagram: AnalyticsSummary };
    activity: ActivityBucket[];
    bestTimes: BestTimeBucket[];
    permissionErrors: Array<{ pageName: string }>;
    topPosts: Array<{ caption: string; reach: number; interactions: number; engagementRate: number | null }>;
    brandProfile: Record<string, string | undefined>;
}) {
    return {
        range: { from: input.range.fromKey, to: input.range.toKey, timezone: 'Asia/Kolkata' },
        scopeName: input.scopeName,
        summary: input.summary,
        byPlatform: input.byPlatform,
        activity: input.activity,
        publishingFrequency: publishingFrequency(input.activity),
        longestGapDays: longestGapDays(input.activity, input.range.granularity),
        bestTimes: input.bestTimes.filter((bucket) => bucket.posts > 0),
        permissionErrors: input.permissionErrors.map((error) => ({
            pageName: error.pageName,
        })),
        topPosts: [...input.topPosts]
            .sort((a, b) => b.reach - a.reach)
            .slice(0, 5)
            .map((post) => ({
                caption: post.caption.slice(0, 120),
                reach: post.reach,
                interactions: post.interactions,
                engagementRate: post.engagementRate,
            })),
        topEngagementPosts: [...input.topPosts]
            .filter((post) => post.engagementRate !== null)
            .sort(
                (a, b) =>
                    (b.engagementRate || 0) - (a.engagementRate || 0)
            )
            .slice(0, 5)
            .map((post) => ({
                caption: post.caption.slice(0, 120),
                reach: post.reach,
                interactions: post.interactions,
                engagementRate: post.engagementRate,
            })),
        brandProfile: input.brandProfile,
    };
}
