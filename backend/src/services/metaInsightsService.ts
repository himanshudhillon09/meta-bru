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

function metricValue(data: unknown, name: string): number | null {
    if (typeof data !== 'object' || data === null) return null;
    const entries = (data as { data?: unknown }).data;
    if (!Array.isArray(entries)) return null;

    const entry = entries.find(
        (item): item is InsightEntry =>
            typeof item === 'object' &&
            item !== null &&
            (item as InsightEntry).name === name
    );
    if (!entry) return null;

    const totalValue = entry.total_value?.value;
    if (totalValue !== null && totalValue !== undefined) {
        return numberOrNull(totalValue);
    }

    if (!Array.isArray(entry.values)) return null;
    const firstValue = entry.values[0] as { value?: unknown } | undefined;
    return numberOrNull(firstValue?.value);
}

function isInvalidMetricError(error: unknown): boolean {
    return (
        error instanceof MetaApiError &&
        /valid insights metric|invalid(?:\s+insights)?\s+metric|metric(?:s)?\s+(?:is|are)?\s*(?:invalid|not valid|unknown|unsupported)|unknown metric|nonexisting field|unsupported metric/i.test(
            error.message
        )
    );
}

function isMetricUnavailableError(error: unknown): boolean {
    return (
        error instanceof MetaApiError &&
        /at least \d+ likes|requires.*likes|not enough data|too few|insufficient data/i.test(
            error.message
        )
    );
}

function isPermissionError(error: unknown): boolean {
    return (
        error instanceof MetaApiError &&
        (error.code === 200 ||
            error.code === 10 ||
            (error.code === 100 &&
                /permission|insufficient|not authorized/i.test(error.message)))
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
    let permissionError = false;
    let networkError = false;
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
        if (!(error instanceof MetaApiError)) throw error;
        if (isTokenError(error)) throw error;
        if (isPermissionError(error)) permissionError = true;
        else {
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
            break;
        } catch (error) {
            if (!(error instanceof MetaApiError)) throw error;
            if (isTokenError(error)) throw error;
            if (isPermissionError(error)) {
                permissionError = true;
                break;
            }
            if (isInvalidMetricError(error)) continue;
            if (isMetricUnavailableError(error)) {
                lastError = '';
                break;
            }
            if (isNetworkError(error)) networkError = true;
            lastError = errorMessage(error);
            break;
        }
    }

    return finalize(
        metrics,
        permissionError
            ? 'permission_error'
            : networkError
              ? 'unavailable'
              : 'partial',
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
    let networkError = false;
    let lastError = '';
    let ladderSucceeded = false;
    let terminalError = false;

    const ladders = [
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
            ladderSucceeded = true;
            break;
        } catch (error) {
            if (!(error instanceof MetaApiError)) throw error;
            if (isTokenError(error)) throw error;
            if (isPermissionError(error)) {
                permissionError = true;
                terminalError = true;
                break;
            }
            if (isInvalidMetricError(error)) continue;
            if (isMetricUnavailableError(error)) {
                lastError = '';
                terminalError = true;
                break;
            }
            if (isNetworkError(error)) networkError = true;
            terminalError = true;
            lastError = errorMessage(error);
            break;
        }
    }

    const handleOptionalError = (error: unknown): void => {
        if (!(error instanceof MetaApiError)) throw error;
        if (isTokenError(error)) throw error;
        if (isInvalidMetricError(error)) return;
        if (!ladderSucceeded) {
            if (isPermissionError(error)) permissionError = true;
            else if (isNetworkError(error)) networkError = true;
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
                metrics.likes = numberOrNull(fields.like_count);
            }
            if (metrics.comments === null) {
                metrics.comments = numberOrNull(fields.comments_count);
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
        lastError,
        ['likes', 'comments', 'shares', 'saves', 'reach', 'views']
    );
}
