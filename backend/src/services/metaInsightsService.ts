import {
    MetaApiError,
    graphRequest,
    type GraphRequestOptions,
} from './metaService.js';
import {
    emptyAnalyticsMetrics,
    type IAnalyticsMetrics,
    type SnapshotStatus,
} from '../models/postMetricSnapshotModel.js';
import { emptyStoryMetrics, type IStoryMetrics } from '../models/storyMetricSnapshotModel.js';

export type GraphRequestFn = (
    path: string,
    options?: GraphRequestOptions
) => Promise<unknown>;

export interface NormalizedInsightMetrics {
    metrics: IAnalyticsMetrics;
    availableMetrics: string[];
    status: SnapshotStatus;
    error: string;
}

interface InsightEntry {
    name?: unknown;
    values?: unknown;
    total_value?: { value?: unknown };
}

function numberOrNull(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) &&
            value >= 0 &&
            value <= Number.MAX_SAFE_INTEGER
            ? value
            : null;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!/^\+?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) return null;
        const number = Number(trimmed);
        return Number.isFinite(number) && number <= Number.MAX_SAFE_INTEGER
            ? number
            : null;
    }
    return null;
}

function insightEntry(data: unknown, name: string): InsightEntry | null {
    if (typeof data !== 'object' || data === null) return null;
    const entries = (data as { data?: unknown }).data;
    if (!Array.isArray(entries)) return null;

    const entry = entries.find(
        (item): item is InsightEntry =>
            typeof item === 'object' &&
            item !== null &&
            (item as InsightEntry).name === name
    );
    return entry ?? null;
}

function firstInsightValue(entry: InsightEntry): unknown {
    if (!Array.isArray(entry.values)) return undefined;
    const firstValue = entry.values[0];
    if (typeof firstValue !== 'object' || firstValue === null) return undefined;
    return (firstValue as { value?: unknown }).value;
}

function metricValue(data: unknown, name: string): number | null {
    const entry = insightEntry(data, name);
    if (!entry) return null;

    const total = numberOrNull(entry.total_value?.value);
    if (total !== null) return total;
    return numberOrNull(firstInsightValue(entry));
}

/**
 * Reads a metric whose value is a breakdown object, such as
 * `{ like: 10, love: 2 }`. Meta omits zero keys, so a present object with a
 * missing key means zero.
 */
function metricBreakdown(
    data: unknown,
    name: string
): Record<string, number> | null {
    const entry = insightEntry(data, name);
    if (!entry) return null;

    for (const candidate of [entry.total_value?.value, firstInsightValue(entry)]) {
        if (
            typeof candidate !== 'object' ||
            candidate === null ||
            Array.isArray(candidate)
        ) {
            continue;
        }
        const breakdown: Record<string, number> = {};
        for (const [key, value] of Object.entries(candidate)) {
            const number = numberOrNull(value);
            if (number !== null) breakdown[key] = number;
        }
        return breakdown;
    }
    return null;
}

function breakdownTotal(breakdown: Record<string, number>): number | null {
    const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
    return Number.isSafeInteger(total) ? total : null;
}

/** Sums the breakdown keys that match, such as every COMMENT action type. */
function breakdownMatching(breakdown: Record<string, number>, pattern: RegExp): number {
    return Object.entries(breakdown)
        .filter(([key]) => pattern.test(key))
        .reduce((sum, [, value]) => sum + value, 0);
}

function isInvalidMetricError(error: unknown): boolean {
    return (
        error instanceof MetaApiError &&
        /valid insights metric|invalid(?:\s+insights)?\s+metric|metric(?:s)?\s+(?:is|are)?\s*(?:invalid|not valid|unknown|unsupported)|unknown metric|nonexisting field|unsupported metric|param metric\[\d+\] must be one of/i.test(
            error.message
        )
    );
}

function isMetricUnavailableError(error: unknown): boolean {
    return (
        error instanceof MetaApiError &&
        /at least \d+ likes|requires.*\d+ likes/i.test(error.message)
    );
}

function isMetricDataUnavailableError(error: unknown): boolean {
    return (
        error instanceof MetaApiError &&
        /not enough data|too few|insufficient data/i.test(error.message)
    );
}

function isPermissionError(error: unknown): boolean {
    return (
        error instanceof MetaApiError &&
        (error.code === 200 ||
            error.code === 10 ||
            (error.code === 100 &&
                /permission|insufficient (?:permission|privilege|scope|access|authorization|rights)|not authorized/i.test(
                    error.message
                )))
    );
}

function isTokenError(error: unknown): boolean {
    return (
        error instanceof MetaApiError &&
        (error.isTokenError || error.code === 190 || error.code === 102)
    );
}

function isRateLimitError(error: unknown): boolean {
    return (
        error instanceof MetaApiError &&
        (error.code === 4 ||
            error.code === 17 ||
            error.code === 32 ||
            error.code === 613)
    );
}

function isNetworkError(error: unknown): boolean {
    return (
        error instanceof MetaApiError &&
        !isRateLimitError(error) &&
        error.status === 0
    );
}

export function sanitizeErrorMessage(message: string): string {
    return message
        .replace(
            /(["'])(access[_-]?token|client[_-]?secret|fb[_-]?exchange[_-]?token)\1(\s*:\s*)(["'])[^"']*\4/gi,
            (
                _match,
                keyQuote: string,
                key: string,
                separator: string,
                valueQuote: string
            ) =>
                `${keyQuote}${key}${keyQuote}${separator}${valueQuote}[redacted]${valueQuote}`
        )
        .replace(
            /(access[_-]?token|client[_-]?secret|fb[_-]?exchange[_-]?token)(\s*[:=]\s*)(["'])[^"']*\3/gi,
            (
                _match,
                key: string,
                separator: string,
                valueQuote: string
            ) => `${key}${separator}${valueQuote}[redacted]${valueQuote}`
        )
        .replace(
            /(access[_-]?token|client[_-]?secret|fb[_-]?exchange[_-]?token)(=|%3D|:)(\s*)[^&\s"'<>]+/gi,
            (
                _match,
                key: string,
                separator: string,
                spacing: string
            ) => `${key}${separator}${spacing}[redacted]`
        )
        .replace(/\bEAA[A-Za-z0-9_-]{20,}\b/g, '[redacted]')
        .replace(/(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/gi, '$1')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500);
}

function errorMessage(error: unknown): string {
    return sanitizeErrorMessage(
        error instanceof Error ? error.message : 'Meta insights request failed'
    );
}

function finalize(
    metrics: IAnalyticsMetrics,
    status: SnapshotStatus,
    error: string,
    expected: string[]
): NormalizedInsightMetrics {
    const availableMetrics = [
        'likes',
        'comments',
        'shares',
        'saves',
        'reach',
        'views',
        'clicks',
        'avgWatchTimeMs',
        'totalWatchTimeMs',
    ].filter((key) => metrics[key as keyof IAnalyticsMetrics] !== null);

    const interactionValues = [
        metrics.likes,
        metrics.comments,
        metrics.shares,
        metrics.saves,
    ].filter((value): value is number => value !== null);
    const interactionSum = interactionValues.reduce(
        (sum, value) => sum + value,
        0
    );
    metrics.interactions =
        interactionValues.length > 0 && Number.isSafeInteger(interactionSum)
            ? interactionSum
            : null;

    const denominator =
        metrics.reach !== null && metrics.reach > 0
            ? metrics.reach
            : metrics.views !== null && metrics.views > 0
              ? metrics.views
              : null;
    const engagementRate =
        metrics.interactions !== null && denominator
            ? Math.round((metrics.interactions / denominator) * 1000) / 10
            : null;
    metrics.engagementRate =
        engagementRate !== null && Number.isFinite(engagementRate)
            ? engagementRate
            : null;

    const resolvedStatus: SnapshotStatus =
        status === 'permission_error' || status === 'unavailable'
            ? status
            : availableMetrics.length === 0
              ? 'unavailable'
              : expected.every((key) => metrics[key as keyof IAnalyticsMetrics] !== null)
                ? 'ok'
                : 'partial';

    return { metrics, availableMetrics, status: resolvedStatus, error };
}

export async function fetchFacebookMetrics(
    postId: string,
    pageToken: string,
    request: GraphRequestFn = graphRequest
): Promise<NormalizedInsightMetrics> {
    const metrics = emptyAnalyticsMetrics();
    let fieldsFailed = false;
    let fieldsPermissionError = false;
    let insightsPermissionError = false;
    let insightsSucceeded = false;
    let networkError = false;
    let permissionMessage = '';
    let lastError = '';

    try {
        const fields = (await request(postId, {
            accessToken: pageToken,
            params: {
                fields:
                    'reactions.limit(0).summary(total_count),comments.limit(0).summary(total_count),shares',
            },
        })) as {
            reactions?: { summary?: { total_count?: number | null } };
            comments?: { summary?: { total_count?: number | null } };
            shares?: { count?: number | null };
        };
        metrics.likes = numberOrNull(fields?.reactions?.summary?.total_count);
        metrics.comments = numberOrNull(
            fields?.comments?.summary?.total_count
        );
        metrics.shares = numberOrNull(fields?.shares?.count);
    } catch (error) {
        if (!(error instanceof MetaApiError)) throw error;
        if (isTokenError(error)) throw error;
        fieldsFailed = true;
        if (isPermissionError(error)) {
            fieldsPermissionError = true;
            permissionMessage = errorMessage(error);
        } else {
            if (isNetworkError(error)) networkError = true;
            lastError = errorMessage(error);
        }
    }

    const ladders = [
        'post_media_view,post_total_media_view_unique,post_clicks',
        'post_media_view,post_total_media_view_unique',
        'post_media_view',
    ];

    for (const metric of ladders) {
        try {
            const data = await request(`${postId}/insights`, {
                accessToken: pageToken,
                params: { metric, period: 'lifetime' },
            });
            metrics.views = metricValue(data, 'post_media_view');
            metrics.reach = metricValue(data, 'post_total_media_view_unique');
            metrics.clicks = metricValue(data, 'post_clicks');
            insightsSucceeded = true;
            break;
        } catch (error) {
            if (!(error instanceof MetaApiError)) throw error;
            if (isTokenError(error)) throw error;
            if (isPermissionError(error)) {
                insightsPermissionError = true;
                permissionMessage = permissionMessage || errorMessage(error);
                break;
            }
            if (isMetricUnavailableError(error)) break;
            if (isMetricDataUnavailableError(error)) continue;
            if (isInvalidMetricError(error)) continue;
            if (isNetworkError(error)) networkError = true;
            lastError = errorMessage(error);
            break;
        }
    }

    // Reactions, comments, and shares on the post object can be blocked by
    // Page permissions that insights do not need. When that request failed but
    // insights work, read the same counts from post insights instead.
    if (fieldsFailed && insightsSucceeded) {
        const engagementLadders = [
            'post_reactions_by_type_total,post_activity_by_action_type',
            'post_reactions_by_type_total',
        ];
        for (const metric of engagementLadders) {
            try {
                const data = await request(`${postId}/insights`, {
                    accessToken: pageToken,
                    params: { metric, period: 'lifetime' },
                });
                const reactions = metricBreakdown(
                    data,
                    'post_reactions_by_type_total'
                );
                const activity = metricBreakdown(
                    data,
                    'post_activity_by_action_type'
                );
                if (reactions) metrics.likes = breakdownTotal(reactions);
                else if (activity) metrics.likes = activity.like ?? 0;
                if (activity) {
                    metrics.comments = activity.comment ?? 0;
                    metrics.shares = activity.share ?? 0;
                }
                break;
            } catch (error) {
                if (!(error instanceof MetaApiError)) throw error;
                if (isTokenError(error)) throw error;
                if (isMetricDataUnavailableError(error)) continue;
                if (isInvalidMetricError(error)) continue;
                break;
            }
        }
    }

    // A blocked fields request only counts as a permission failure when the
    // insights fallback could not recover any engagement counts.
    const engagementMissing =
        metrics.likes === null &&
        metrics.comments === null &&
        metrics.shares === null;
    const permissionError =
        insightsPermissionError || (fieldsPermissionError && engagementMissing);

    return finalize(
        metrics,
        permissionError
            ? 'permission_error'
            : networkError
              ? 'unavailable'
              : 'partial',
        permissionError ? permissionMessage : lastError,
        ['likes', 'comments', 'shares', 'reach', 'views', 'clicks']
    );
}

/**
 * Facebook Reels are video objects, so their numbers come from the video's own
 * insights (plays, reach, watch time) rather than Page post insights.
 */
export async function fetchFacebookReelMetrics(
    videoId: string,
    pageToken: string,
    request: GraphRequestFn = graphRequest
): Promise<NormalizedInsightMetrics> {
    const metrics = emptyAnalyticsMetrics();
    let permissionError = false;
    let networkError = false;
    let permissionMessage = '';
    let lastError = '';

    const ladders = [
        'blue_reels_play_count,post_impressions_unique,post_video_avg_time_watched,post_video_view_time,post_video_likes_by_reaction_type,post_video_social_actions',
        'blue_reels_play_count,post_impressions_unique,post_video_avg_time_watched,post_video_view_time',
        'blue_reels_play_count,post_impressions_unique',
        'post_impressions_unique',
    ];

    for (const metric of ladders) {
        try {
            const data = await request(`${videoId}/video_insights`, {
                accessToken: pageToken,
                params: { metric, period: 'lifetime' },
            });
            metrics.views = metricValue(data, 'blue_reels_play_count');
            metrics.reach = metricValue(data, 'post_impressions_unique');
            metrics.avgWatchTimeMs = metricValue(data, 'post_video_avg_time_watched');
            metrics.totalWatchTimeMs = metricValue(data, 'post_video_view_time');
            const reactions = metricBreakdown(data, 'post_video_likes_by_reaction_type');
            if (reactions) metrics.likes = breakdownTotal(reactions);
            const actions = metricBreakdown(data, 'post_video_social_actions');
            if (actions) {
                metrics.comments = breakdownMatching(actions, /comment/i);
                metrics.shares = breakdownMatching(actions, /share/i);
            }
            break;
        } catch (error) {
            if (!(error instanceof MetaApiError)) throw error;
            if (isTokenError(error)) throw error;
            if (isPermissionError(error)) {
                permissionError = true;
                permissionMessage = errorMessage(error);
                break;
            }
            if (isMetricUnavailableError(error)) break;
            if (isMetricDataUnavailableError(error)) continue;
            if (isInvalidMetricError(error)) continue;
            if (isNetworkError(error)) networkError = true;
            lastError = errorMessage(error);
            break;
        }
    }

    // Likes and comments are also counted on the video itself.
    if (!permissionError && (metrics.likes === null || metrics.comments === null)) {
        try {
            const fields = (await request(videoId, {
                accessToken: pageToken,
                params: {
                    fields: 'likes.limit(0).summary(total_count),comments.limit(0).summary(total_count)',
                },
            })) as {
                likes?: { summary?: { total_count?: number | null } };
                comments?: { summary?: { total_count?: number | null } };
            };
            if (metrics.likes === null) {
                metrics.likes = numberOrNull(fields?.likes?.summary?.total_count);
            }
            if (metrics.comments === null) {
                metrics.comments = numberOrNull(fields?.comments?.summary?.total_count);
            }
        } catch (error) {
            if (!(error instanceof MetaApiError)) throw error;
            if (isTokenError(error)) throw error;
            lastError = lastError || errorMessage(error);
        }
    }

    return finalize(
        metrics,
        permissionError
            ? 'permission_error'
            : networkError
              ? 'unavailable'
              : 'partial',
        permissionError ? permissionMessage : lastError,
        ['likes', 'comments', 'shares', 'reach', 'views', 'avgWatchTimeMs']
    );
}

export function fetchInstagramMetrics(
    mediaId: string,
    accessToken: string,
    request: GraphRequestFn = graphRequest
): Promise<NormalizedInsightMetrics> {
    return instagramMetrics(mediaId, accessToken, request, false);
}

/** Instagram Reels add watch time to the usual media insights. */
export function fetchInstagramReelMetrics(
    mediaId: string,
    accessToken: string,
    request: GraphRequestFn = graphRequest
): Promise<NormalizedInsightMetrics> {
    return instagramMetrics(mediaId, accessToken, request, true);
}

async function instagramMetrics(
    mediaId: string,
    accessToken: string,
    request: GraphRequestFn,
    reel: boolean
): Promise<NormalizedInsightMetrics> {
    const metrics = emptyAnalyticsMetrics();
    let permissionError = false;
    let networkError = false;
    let permissionMessage = '';
    let lastError = '';
    let ladderSucceeded = false;
    let terminalError = false;

    const ladders = [
        ...(reel
            ? ['reach,views,likes,comments,shares,saved,ig_reels_avg_watch_time,ig_reels_video_view_total_time']
            : []),
        'reach,views,likes,comments,shares,saved',
        'reach,likes,comments,shares,saved',
        'reach,likes,comments',
        'reach',
    ];

    for (const metric of ladders) {
        try {
            const data = await request(`${mediaId}/insights`, {
                accessToken,
                params: { metric },
            });
            metrics.reach = metricValue(data, 'reach');
            metrics.views = metricValue(data, 'views');
            metrics.likes = metricValue(data, 'likes');
            metrics.comments = metricValue(data, 'comments');
            metrics.shares = metricValue(data, 'shares');
            metrics.saves = metricValue(data, 'saved');
            metrics.avgWatchTimeMs = metricValue(data, 'ig_reels_avg_watch_time');
            metrics.totalWatchTimeMs = metricValue(data, 'ig_reels_video_view_total_time');
            ladderSucceeded = true;
            break;
        } catch (error) {
            if (!(error instanceof MetaApiError)) throw error;
            if (isTokenError(error)) throw error;
            if (isPermissionError(error)) {
                permissionError = true;
                permissionMessage = errorMessage(error);
                terminalError = true;
                break;
            }
            if (isMetricUnavailableError(error)) {
                terminalError = true;
                break;
            }
            if (isMetricDataUnavailableError(error)) continue;
            if (isInvalidMetricError(error)) continue;
            if (isNetworkError(error)) networkError = true;
            terminalError = true;
            lastError = errorMessage(error);
            break;
        }
    }

    const handleOptionalError = (error: unknown): void => {
        if (!(error instanceof MetaApiError)) throw error;
        if (isTokenError(error)) throw error;
        if (isMetricUnavailableError(error)) return;
        if (isMetricDataUnavailableError(error)) return;
        if (isInvalidMetricError(error)) return;
        if (!ladderSucceeded) {
            if (isPermissionError(error)) {
                permissionError = true;
                permissionMessage = permissionMessage || errorMessage(error);
            } else if (isNetworkError(error)) networkError = true;
        }
        lastError = errorMessage(error);
    };

    if (!terminalError && metrics.views === null) {
        try {
            const legacy = await request(`${mediaId}/insights`, {
                accessToken,
                params: { metric: 'impressions' },
            });
            metrics.views = metricValue(legacy, 'impressions');
        } catch (error) {
            handleOptionalError(error);
        }
    }

    if (
        !terminalError &&
        (metrics.likes === null || metrics.comments === null)
    ) {
        try {
            const fields = (await request(mediaId, {
                accessToken,
                params: { fields: 'like_count,comments_count' },
            })) as {
                like_count?: number | null;
                comments_count?: number | null;
            };
            if (metrics.likes === null) {
                metrics.likes = numberOrNull(fields?.like_count);
            }
            if (metrics.comments === null) {
                metrics.comments = numberOrNull(fields?.comments_count);
            }
        } catch (error) {
            handleOptionalError(error);
        }
    }

    return finalize(
        metrics,
        permissionError
            ? 'permission_error'
            : networkError
              ? 'unavailable'
              : 'partial',
        permissionError ? permissionMessage || lastError : lastError,
        reel
            ? ['likes', 'comments', 'shares', 'saves', 'reach', 'views', 'avgWatchTimeMs']
            : ['likes', 'comments', 'shares', 'saves', 'reach', 'views']
    );
}

export interface NormalizedStoryMetrics {
    metrics: IStoryMetrics;
    status: SnapshotStatus;
    error: string;
}

const FEW_VIEWERS_MESSAGE =
    'Fewer than 5 people have viewed this Story, so Meta hides its numbers.';

/** Meta answers with error 10 when fewer than 5 accounts viewed a Story. */
function isFewViewersError(error: unknown): boolean {
    return error instanceof MetaApiError && /not enough viewers/i.test(error.message);
}

/**
 * Instagram returns navigation broken down by action type, either as
 * `total_value.breakdowns[].results[]` or as a plain value object.
 */
function navigationBreakdown(data: unknown): Record<string, number> | null {
    const entry = insightEntry(data, 'navigation');
    if (!entry) return null;

    const breakdowns = (entry.total_value as { breakdowns?: unknown } | undefined)?.breakdowns;
    if (Array.isArray(breakdowns)) {
        const counts: Record<string, number> = {};
        for (const breakdown of breakdowns) {
            const results = (breakdown as { results?: unknown })?.results;
            if (!Array.isArray(results)) continue;
            for (const result of results) {
                const key = (result as { dimension_values?: unknown[] })?.dimension_values?.[0];
                const value = numberOrNull((result as { value?: unknown })?.value);
                if (typeof key === 'string' && value !== null) {
                    counts[key.toLowerCase()] = (counts[key.toLowerCase()] ?? 0) + value;
                }
            }
        }
        return counts;
    }

    const plain = metricBreakdown(data, 'navigation');
    return plain
        ? Object.fromEntries(Object.entries(plain).map(([key, value]) => [key.toLowerCase(), value]))
        : null;
}

function finalizeStory(
    metrics: IStoryMetrics,
    status: SnapshotStatus,
    error: string
): NormalizedStoryMetrics {
    const anyMetric = Object.values(metrics).some((value) => value !== null);
    const resolved: SnapshotStatus =
        status === 'permission_error' || status === 'unavailable'
            ? status
            : !anyMetric
              ? 'unavailable'
              : metrics.reach !== null && metrics.views !== null
                ? 'ok'
                : 'partial';
    return { metrics, status: resolved, error };
}

/** Story insights while the Story is live: reach, views, replies, and taps. */
export async function fetchInstagramStoryMetrics(
    mediaId: string,
    accessToken: string,
    request: GraphRequestFn = graphRequest
): Promise<NormalizedStoryMetrics> {
    const metrics = emptyStoryMetrics();
    let status: SnapshotStatus = 'partial';
    let lastError = '';
    let succeeded = false;

    const ladders = [
        'reach,views,replies,shares,total_interactions',
        'reach,views,replies',
        'reach,replies',
        'reach',
    ];

    for (const metric of ladders) {
        try {
            const data = await request(`${mediaId}/insights`, {
                accessToken,
                params: { metric },
            });
            metrics.reach = metricValue(data, 'reach');
            metrics.views = metricValue(data, 'views');
            metrics.replies = metricValue(data, 'replies');
            metrics.shares = metricValue(data, 'shares');
            metrics.interactions = metricValue(data, 'total_interactions');
            succeeded = true;
            break;
        } catch (error) {
            if (!(error instanceof MetaApiError)) throw error;
            if (isTokenError(error)) throw error;
            // Checked before permissions: both use error code 10.
            if (isFewViewersError(error)) {
                return finalizeStory(metrics, 'unavailable', FEW_VIEWERS_MESSAGE);
            }
            if (isPermissionError(error)) {
                status = 'permission_error';
                lastError = errorMessage(error);
                break;
            }
            if (isMetricDataUnavailableError(error)) continue;
            if (isInvalidMetricError(error)) continue;
            if (isNetworkError(error)) status = 'unavailable';
            lastError = errorMessage(error);
            break;
        }
    }

    if (succeeded) {
        try {
            const data = await request(`${mediaId}/insights`, {
                accessToken,
                params: { metric: 'navigation', breakdown: 'story_navigation_action_type' },
            });
            const navigation = navigationBreakdown(data);
            if (navigation) {
                metrics.tapsForward = navigation.tap_forward ?? 0;
                metrics.tapsBack = navigation.tap_back ?? 0;
                metrics.exits = navigation.tap_exit ?? 0;
                metrics.swipesForward = navigation.swipe_forward ?? 0;
            }
        } catch (error) {
            if (!(error instanceof MetaApiError)) throw error;
            if (isTokenError(error)) throw error;
            // Navigation is optional; keep the main numbers.
        }
    }

    return finalizeStory(metrics, status, lastError);
}

/**
 * Facebook Page Story insights. Meta's Story metrics are newer and thinner
 * than post insights, so each name is tried in turn until one is accepted.
 */
export async function fetchFacebookStoryMetrics(
    storyId: string,
    pageToken: string,
    request: GraphRequestFn = graphRequest
): Promise<NormalizedStoryMetrics> {
    const metrics = emptyStoryMetrics();
    let status: SnapshotStatus = 'partial';
    let lastError = '';

    // The names Meta accepts for Page Stories, newest first. It rejects the
    // whole request when any one name is unknown, so each set is all-or-nothing.
    const ladders = [
        'story_media_view,story_total_media_view_unique,pages_fb_story_replies,pages_fb_story_shares,story_interaction',
        'story_media_view,story_total_media_view_unique',
        'page_story_impressions_by_story_id,page_story_impressions_by_story_id_unique',
    ];

    for (const metric of ladders) {
        try {
            const data = await request(`${storyId}/insights`, {
                accessToken: pageToken,
                params: { metric },
            });
            metrics.reach =
                metricValue(data, 'story_total_media_view_unique') ??
                metricValue(data, 'page_story_impressions_by_story_id_unique');
            metrics.views =
                metricValue(data, 'story_media_view') ??
                metricValue(data, 'page_story_impressions_by_story_id');
            metrics.replies = metricValue(data, 'pages_fb_story_replies');
            metrics.shares = metricValue(data, 'pages_fb_story_shares');
            metrics.interactions = metricValue(data, 'story_interaction');
            break;
        } catch (error) {
            if (!(error instanceof MetaApiError)) throw error;
            if (isTokenError(error)) throw error;
            if (isFewViewersError(error)) {
                return finalizeStory(metrics, 'unavailable', FEW_VIEWERS_MESSAGE);
            }
            if (isPermissionError(error)) {
                status = 'permission_error';
                lastError = errorMessage(error);
                break;
            }
            if (isMetricDataUnavailableError(error)) continue;
            if (isInvalidMetricError(error)) continue;
            if (isNetworkError(error)) status = 'unavailable';
            lastError = errorMessage(error);
            break;
        }
    }

    return finalizeStory(metrics, status, lastError);
}
