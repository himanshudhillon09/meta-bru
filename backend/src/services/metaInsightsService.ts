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

function numberOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function metricValue(data: unknown, name: string): number | null {
    const entries = (data as {
        data?: Array<{
            name?: string;
            values?: Array<{ value?: unknown }>;
            total_value?: { value?: unknown };
        }>;
    })?.data;
    const entry = entries?.find((item) => item.name === name);
    if (!entry) return null;
    if (entry.total_value?.value !== undefined) {
        return numberOrNull(entry.total_value.value);
    }
    return numberOrNull(entry.values?.[0]?.value);
}

function isInvalidMetricError(error: unknown): boolean {
    return (
        error instanceof MetaApiError &&
        error.code === 100 &&
        /valid insights metric|invalid metric|nonexisting field|unsupported/i.test(error.message)
    );
}

function isPermissionError(error: unknown): boolean {
    return (
        error instanceof MetaApiError &&
        (error.code === 200 ||
            error.code === 10 ||
            (error.code === 100 &&
                /permission|insufficient|not authorized|requires/i.test(error.message)))
    );
}

function isTokenError(error: unknown): boolean {
    return (
        error instanceof MetaApiError &&
        (error.isTokenError || error.code === 190 || error.code === 102)
    );
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Meta insights request failed';
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
    ].filter((key) => metrics[key as keyof IAnalyticsMetrics] !== null);

    const interactionValues = [
        metrics.likes,
        metrics.comments,
        metrics.shares,
        metrics.saves,
    ].filter((value): value is number => value !== null);
    metrics.interactions = interactionValues.length
        ? interactionValues.reduce((sum, value) => sum + value, 0)
        : null;

    const denominator =
        metrics.reach !== null && metrics.reach > 0
            ? metrics.reach
            : metrics.views !== null && metrics.views > 0
              ? metrics.views
              : null;
    metrics.engagementRate =
        metrics.interactions !== null && denominator
            ? Math.round((metrics.interactions / denominator) * 1000) / 10
            : null;

    const resolvedStatus: SnapshotStatus =
        status === 'permission_error'
            ? 'permission_error'
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
    let permissionError = false;
    let lastError = '';

    try {
        const fields = (await request(postId, {
            accessToken: pageToken,
            params: {
                fields:
                    'reactions.summary(total_count),comments.summary(total_count),shares',
            },
        })) as {
            reactions?: { summary?: { total_count?: number | null } };
            comments?: { summary?: { total_count?: number | null } };
            shares?: { count?: number | null };
        };
        metrics.likes = numberOrNull(fields.reactions?.summary?.total_count);
        metrics.comments = numberOrNull(fields.comments?.summary?.total_count);
        metrics.shares = numberOrNull(fields.shares?.count);
    } catch (error) {
        if (isTokenError(error)) throw error;
        if (isPermissionError(error)) permissionError = true;
        else lastError = errorMessage(error);
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
            break;
        } catch (error) {
            if (isTokenError(error)) throw error;
            if (isPermissionError(error)) {
                permissionError = true;
                break;
            }
            if (!isInvalidMetricError(error)) {
                lastError = errorMessage(error);
                break;
            }
        }
    }

    return finalize(
        metrics,
        permissionError ? 'permission_error' : 'partial',
        lastError,
        ['likes', 'comments', 'shares', 'reach', 'views', 'clicks']
    );
}

export async function fetchInstagramMetrics(
    mediaId: string,
    accessToken: string,
    request: GraphRequestFn = graphRequest
): Promise<NormalizedInsightMetrics> {
    const metrics = emptyAnalyticsMetrics();
    let permissionError = false;
    let lastError = '';

    const ladders = [
        'reach,views,likes,comments,shares,saved',
        'reach,views,likes,comments,shares',
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
            break;
        } catch (error) {
            if (isTokenError(error)) throw error;
            if (isPermissionError(error)) {
                permissionError = true;
                break;
            }
            if (!isInvalidMetricError(error)) {
                lastError = errorMessage(error);
                break;
            }
        }
    }

    if (metrics.views === null) {
        try {
            const legacy = await request(`${mediaId}/insights`, {
                accessToken,
                params: { metric: 'impressions' },
            });
            metrics.views = metricValue(legacy, 'impressions');
        } catch {
            // Legacy impressions are optional.
        }
    }

    if (metrics.likes === null || metrics.comments === null) {
        try {
            const fields = (await request(mediaId, {
                accessToken,
                params: { fields: 'like_count,comments_count' },
            })) as {
                like_count?: number | null;
                comments_count?: number | null;
            };
            metrics.likes = numberOrNull(fields.like_count);
            metrics.comments = numberOrNull(fields.comments_count);
        } catch (error) {
            if (isTokenError(error)) throw error;
            if (isPermissionError(error)) permissionError = true;
            else lastError = errorMessage(error);
        }
    }

    return finalize(
        metrics,
        permissionError ? 'permission_error' : 'partial',
        lastError,
        ['likes', 'comments', 'shares', 'saves', 'reach', 'views']
    );
}
