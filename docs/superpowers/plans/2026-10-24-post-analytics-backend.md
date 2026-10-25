# Post Analytics Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the stored analytics foundation: IST ranges, metric snapshots, Meta insight fetching, aggregation, sync, cached AI tips, and authenticated API routes.

**Architecture:** Meta calls happen only in `POST /api/analytics/sync`. Results are normalized and stored in `PostMetricSnapshot` per Page/post/platform/capture time. Read endpoints aggregate stored snapshots and never call Meta.

**Tech Stack:** TypeScript, Express 5, Mongoose 9, Zod 4, Luxon, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-24-post-analytics-design.md`

---

## Task 1: IST date ranges and buckets

**Files:**
- Create: `backend/src/services/analyticsDateService.ts`
- Test: `backend/src/services/analyticsDateService.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const {
    parseAnalyticsRange,
    buildAnalyticsBuckets,
    bucketKeyForDate,
    istWeekday,
    istHourBlock,
} = await import('./analyticsDateService.js');

test('converts an IST day to inclusive UTC boundaries', () => {
    const range = parseAnalyticsRange('2026-10-24', '2026-10-24');
    assert.equal(range.from.toISOString(), '2026-10-23T18:30:00.000Z');
    assert.equal(range.to.toISOString(), '2026-10-24T18:29:59.999Z');
});

test('rejects reversed and oversized ranges', () => {
    assert.throws(() => parseAnalyticsRange('2026-10-25', '2026-10-24'), /before/);
    assert.throws(
        () => parseAnalyticsRange('2024-01-01', '2026-10-24'),
        /730/
    );
});

test('uses daily buckets up to 60 days and weekly buckets after that', () => {
    const daily = parseAnalyticsRange('2026-10-01', '2026-10-30');
    const weekly = parseAnalyticsRange('2026-07-01', '2026-10-24');

    assert.equal(daily.granularity, 'day');
    assert.equal(weekly.granularity, 'week');
    assert.equal(buildAnalyticsBuckets(daily).length, 30);
    assert.ok(buildAnalyticsBuckets(weekly).length < 20);
});

test('groups by IST weekday and three-hour block', () => {
    const lateWednesday = new Date('2026-10-21T15:30:00.000Z'); // 21:00 IST Wed
    assert.equal(istWeekday(lateWednesday), 3);
    assert.equal(istHourBlock(lateWednesday), 7);
    assert.equal(bucketKeyForDate(lateWednesday, 'day'), '2026-10-21');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && node --import tsx --test src/services/analyticsDateService.test.ts`
Expected: FAIL because `analyticsDateService.ts` does not exist.

- [ ] **Step 3: Implement the service**

```ts
import { DateTime } from 'luxon';
import { AppError } from '../utils/errors.js';

export const ANALYTICS_TIMEZONE = 'Asia/Kolkata';
export const MAX_RANGE_DAYS = 730;

export interface AnalyticsRange {
    from: Date;
    to: Date;
    fromKey: string;
    toKey: string;
    granularity: 'day' | 'week';
}

export interface AnalyticsBucket {
    key: string;
    label: string;
    start: Date;
    end: Date;
}

function ist(value: Date | string): DateTime {
    return typeof value === 'string'
        ? DateTime.fromISO(value, { zone: ANALYTICS_TIMEZONE })
        : DateTime.fromJSDate(value, { zone: 'utc' }).setZone(ANALYTICS_TIMEZONE);
}

export function parseAnalyticsRange(from: string, to: string): AnalyticsRange {
    const start = ist(from).startOf('day');
    const end = ist(to).endOf('day');

    if (!start.isValid || !end.isValid) {
        throw new AppError(400, 'from and to must be valid YYYY-MM-DD dates', 'INVALID_RANGE');
    }
    if (start > end) {
        throw new AppError(400, 'from must be on or before to', 'INVALID_RANGE');
    }

    const today = DateTime.now().setZone(ANALYTICS_TIMEZONE).endOf('day');
    const clampedEnd = end > today ? today : end;
    if (start > clampedEnd) {
        throw new AppError(400, 'from must be on or before today', 'INVALID_RANGE');
    }

    const days = Math.floor(clampedEnd.startOf('day').diff(start.startOf('day'), 'days').days) + 1;
    if (days > MAX_RANGE_DAYS) {
        throw new AppError(400, `Range cannot exceed ${MAX_RANGE_DAYS} days`, 'INVALID_RANGE');
    }

    return {
        from: start.toUTC().toJSDate(),
        to: clampedEnd.toUTC().toJSDate(),
        fromKey: start.toFormat('yyyy-MM-dd'),
        toKey: clampedEnd.toFormat('yyyy-MM-dd'),
        granularity: days > 60 ? 'week' : 'day',
    };
}

export function toIstDayKey(value: Date): string {
    return ist(value).toFormat('yyyy-MM-dd');
}

export function toIstDayLabel(key: string): string {
    return ist(key).toFormat('d LLL');
}

export function startOfIstWeek(value: Date | string): DateTime {
    const dt = ist(value).startOf('day');
    return dt.minus({ days: dt.weekday - 1 });
}

export function toIstWeekKey(value: Date): string {
    return startOfIstWeek(value).toFormat('yyyy-MM-dd');
}

export function toIstWeekLabel(key: string): string {
    return `Week of ${ist(key).toFormat('d LLL')}`;
}

export function istWeekday(value: Date): number {
    return ist(value).weekday;
}

export function istHourBlock(value: Date): number {
    return Math.floor(ist(value).hour / 3);
}

export function bucketKeyForDate(value: Date, granularity: 'day' | 'week'): string {
    return granularity === 'day' ? toIstDayKey(value) : toIstWeekKey(value);
}

export function buildAnalyticsBuckets(range: AnalyticsRange): AnalyticsBucket[] {
    const buckets: AnalyticsBucket[] = [];
    let cursor =
        range.granularity === 'day'
            ? ist(range.fromKey).startOf('day')
            : startOfIstWeek(range.fromKey);
    const last = ist(range.toKey).startOf('day');

    while (cursor <= last) {
        const end =
            range.granularity === 'day'
                ? cursor.endOf('day')
                : cursor.plus({ days: 6 }).endOf('day');
        buckets.push({
            key: cursor.toFormat('yyyy-MM-dd'),
            label:
                range.granularity === 'day'
                    ? cursor.toFormat('d LLL')
                    : `Week of ${cursor.toFormat('d LLL')}`,
            start: cursor.toUTC().toJSDate(),
            end: end.toUTC().toJSDate(),
        });
        cursor = cursor.plus(range.granularity === 'day' ? { days: 1 } : { weeks: 1 });
    }

    return buckets;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && node --import tsx --test src/services/analyticsDateService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/analyticsDateService.ts backend/src/services/analyticsDateService.test.ts
git commit -m "feat: add analytics IST date helpers"
```

---

## Task 2: Snapshot and AI cache models

**Files:**
- Create: `backend/src/models/postMetricSnapshotModel.ts`
- Create: `backend/src/models/analyticsAiInsightModel.ts`

- [ ] **Step 1: Create the snapshot model**

```ts
import mongoose from 'mongoose';
import type { Platform } from './postModel.js';

export type SnapshotStatus = 'ok' | 'partial' | 'unavailable' | 'permission_error';

export interface IAnalyticsMetrics {
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
    reach: number | null;
    views: number | null;
    clicks: number | null;
    interactions: number | null;
    engagementRate: number | null;
}

export interface IPostMetricSnapshot extends mongoose.Document {
    userId: mongoose.Types.ObjectId;
    connectionId: mongoose.Types.ObjectId;
    pageId: string;
    pageName: string;
    postId: mongoose.Types.ObjectId;
    platform: Platform;
    externalId: string;
    publishedAt: Date;
    capturedAt: Date;
    metrics: IAnalyticsMetrics;
    availableMetrics: string[];
    status: SnapshotStatus;
    error: string;
    createdAt: Date;
    updatedAt: Date;
}

export const emptyAnalyticsMetrics = (): IAnalyticsMetrics => ({
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    reach: null,
    views: null,
    clicks: null,
    interactions: null,
    engagementRate: null,
});

const metricsSchema = new mongoose.Schema<IAnalyticsMetrics>(
    {
        likes: { type: Number, default: null },
        comments: { type: Number, default: null },
        shares: { type: Number, default: null },
        saves: { type: Number, default: null },
        reach: { type: Number, default: null },
        views: { type: Number, default: null },
        clicks: { type: Number, default: null },
        interactions: { type: Number, default: null },
        engagementRate: { type: Number, default: null },
    },
    { _id: false }
);

const snapshotSchema = new mongoose.Schema<IPostMetricSnapshot>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        connectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialConnection', required: true, index: true },
        pageId: { type: String, required: true },
        pageName: { type: String, default: '' },
        postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
        platform: { type: String, enum: ['facebook', 'instagram'], required: true },
        externalId: { type: String, default: '' },
        publishedAt: { type: Date, required: true, index: true },
        capturedAt: { type: Date, required: true, index: true },
        metrics: { type: metricsSchema, default: emptyAnalyticsMetrics },
        availableMetrics: { type: [String], default: [] },
        status: {
            type: String,
            enum: ['ok', 'partial', 'unavailable', 'permission_error'],
            default: 'unavailable',
        },
        error: { type: String, default: '' },
    },
    { timestamps: true }
);

snapshotSchema.index({ userId: 1, publishedAt: -1 });
snapshotSchema.index({ userId: 1, connectionId: 1, publishedAt: -1 });
snapshotSchema.index({ postId: 1, platform: 1, capturedAt: -1 });
snapshotSchema.index({ userId: 1, platform: 1, publishedAt: -1 });

export const PostMetricSnapshot = mongoose.model<IPostMetricSnapshot>(
    'PostMetricSnapshot',
    snapshotSchema
);
```

- [ ] **Step 2: Create the AI cache model**

```ts
import mongoose from 'mongoose';

export type AnalyticsTipSeverity = 'info' | 'success' | 'warning';

export interface IAnalyticsTip {
    title: string;
    body: string;
    severity: AnalyticsTipSeverity;
    actionLabel: string;
    actionHref: string;
}

export interface IAnalyticsAiInsight extends mongoose.Document {
    userId: mongoose.Types.ObjectId;
    scopeKey: string;
    connectionId: mongoose.Types.ObjectId | null;
    rangeKey: string;
    dataHash: string;
    tips: IAnalyticsTip[];
    model: string;
    generatedAt: Date;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const tipSchema = new mongoose.Schema<IAnalyticsTip>(
    {
        title: { type: String, required: true },
        body: { type: String, required: true },
        severity: { type: String, enum: ['info', 'success', 'warning'], default: 'info' },
        actionLabel: { type: String, default: '' },
        actionHref: { type: String, default: '' },
    },
    { _id: false }
);

const insightSchema = new mongoose.Schema<IAnalyticsAiInsight>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        scopeKey: { type: String, required: true },
        connectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialConnection', default: null },
        rangeKey: { type: String, required: true },
        dataHash: { type: String, required: true },
        tips: { type: [tipSchema], default: [] },
        model: { type: String, default: '' },
        generatedAt: { type: Date, required: true },
        expiresAt: { type: Date, required: true },
    },
    { timestamps: true }
);

insightSchema.index({ userId: 1, scopeKey: 1, rangeKey: 1, generatedAt: -1 });
insightSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AnalyticsAiInsight = mongoose.model<IAnalyticsAiInsight>(
    'AnalyticsAiInsight',
    insightSchema
);
```

- [ ] **Step 3: Build the backend**

Run: `cd backend && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/models/postMetricSnapshotModel.ts backend/src/models/analyticsAiInsightModel.ts
git commit -m "feat: add analytics snapshot and AI cache models"
```

---

## Task 3: Meta insights service

**Files:**
- Modify: `backend/src/services/metaService.ts` — export `GraphRequestOptions` and `graphRequest`.
- Create: `backend/src/services/metaInsightsService.ts`
- Test: `backend/src/services/metaInsightsService.test.ts`

- [ ] **Step 1: Export the Graph request helper**

Change:

```ts
interface GraphRequestOptions {
```

to:

```ts
export interface GraphRequestOptions {
```

Change:

```ts
async function graphRequest<T>(
```

to:

```ts
export async function graphRequest<T>(
```

- [ ] **Step 2: Write the failing tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { MetaApiError } = await import('./metaService.js');
const { fetchFacebookMetrics, fetchInstagramMetrics } = await import(
    './metaInsightsService.js'
);

test('normalizes Facebook fields and insights', async () => {
    const request = async (path: string) => {
        if (path.endsWith('/insights')) {
            return {
                data: [
                    { name: 'post_media_view', values: [{ value: 3100 }] },
                    { name: 'post_total_media_view_unique', total_value: { value: 2400 } },
                    { name: 'post_clicks', values: [{ value: 32 }] },
                ],
            };
        }
        return {
            reactions: { summary: { total_count: 120 } },
            comments: { summary: { total_count: 14 } },
            shares: { count: 8 },
        };
    };

    const result = await fetchFacebookMetrics('post-1', 'token', request);
    assert.equal(result.metrics.likes, 120);
    assert.equal(result.metrics.reach, 2400);
    assert.equal(result.metrics.views, 3100);
    assert.equal(result.metrics.clicks, 32);
    assert.equal(result.metrics.interactions, 142);
    assert.equal(result.status, 'ok');
});

test('retries Facebook insights when one metric is invalid', async () => {
    let insightCalls = 0;
    const request = async (path: string) => {
        if (path.endsWith('/insights')) {
            insightCalls += 1;
            if (insightCalls === 1) {
                throw new MetaApiError('invalid metric', 400, 100);
            }
            return {
                data: [
                    { name: 'post_media_view', values: [{ value: 100 }] },
                    { name: 'post_total_media_view_unique', total_value: { value: 80 } },
                ],
            };
        }
        return {};
    };

    const result = await fetchFacebookMetrics('post-1', 'token', request);
    assert.equal(insightCalls, 2);
    assert.equal(result.metrics.views, 100);
    assert.equal(result.metrics.reach, 80);
    assert.equal(result.status, 'partial');
});

test('marks Facebook permission errors without losing field metrics', async () => {
    const request = async (path: string) => {
        if (path.endsWith('/insights')) {
            throw new MetaApiError('permission denied', 403, 200);
        }
        return { reactions: { summary: { total_count: 3 } } };
    };

    const result = await fetchFacebookMetrics('post-1', 'token', request);
    assert.equal(result.metrics.likes, 3);
    assert.equal(result.status, 'permission_error');
});

test('normalizes Instagram insights and falls back to media fields', async () => {
    let insightCalls = 0;
    const request = async (path: string) => {
        if (path.endsWith('/insights')) {
            insightCalls += 1;
            if (insightCalls === 1) {
                throw new MetaApiError('invalid metric', 400, 100);
            }
            return {
                data: [
                    { name: 'reach', values: [{ value: 500 }] },
                    { name: 'likes', values: [{ value: 40 }] },
                    { name: 'comments', values: [{ value: 5 }] },
                ],
            };
        }
        return { like_count: 40, comments_count: 5 };
    };

    const result = await fetchInstagramMetrics('media-1', 'token', request);
    assert.equal(insightCalls, 2);
    assert.equal(result.metrics.reach, 500);
    assert.equal(result.metrics.likes, 40);
    assert.equal(result.metrics.comments, 5);
    assert.equal(result.status, 'partial');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd backend && node --import tsx --test src/services/metaInsightsService.test.ts`
Expected: FAIL because `metaInsightsService.ts` does not exist.

- [ ] **Step 4: Implement the service**

```ts
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

export type GraphRequestFn = <T>(
    path: string,
    options?: GraphRequestOptions
) => Promise<T>;

export interface NormalizedInsightMetrics {
    metrics: IAnalyticsMetrics;
    availableMetrics: string[];
    status: SnapshotStatus;
    error: string;
}

function numberOrNull(value: unknown): number | null {
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
        const fields = await request<{
            reactions?: { summary?: { total_count?: number } };
            comments?: { summary?: { total_count?: number } };
            shares?: { count?: number };
        }>(postId, {
            accessToken: pageToken,
            params: {
                fields:
                    'reactions.summary(total_count),comments.summary(total_count),shares',
            },
        });
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
            const fields = await request<{
                like_count?: number;
                comments_count?: number;
            }>(mediaId, {
                accessToken,
                params: { fields: 'like_count,comments_count' },
            });
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && node --import tsx --test src/services/metaInsightsService.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/metaService.ts backend/src/services/metaInsightsService.ts backend/src/services/metaInsightsService.test.ts
git commit -m "feat: add Meta insights normalization"
```

---

## Task 4: Analytics aggregation service

**Files:**
- Create: `backend/src/services/analyticsService.ts`
- Test: `backend/src/services/analyticsService.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import type { IAnalyticsMetrics } from '../models/postMetricSnapshotModel.js';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const {
    latestSnapshotsByTarget,
    summarizeTargets,
    buildActivity,
    buildBestTimes,
    buildMonitorSeries,
} = await import('./analyticsService.js');

function metrics(overrides: Partial<IAnalyticsMetrics> = {}): IAnalyticsMetrics {
    return {
        likes: 10,
        comments: 2,
        shares: 1,
        saves: 0,
        reach: 100,
        views: 150,
        clicks: 3,
        interactions: 13,
        engagementRate: 13,
        ...overrides,
    };
}

function target(overrides: Record<string, unknown> = {}) {
    return {
        postId: 'post-1',
        connectionId: 'connection-1',
        pageId: 'page-1',
        pageName: 'Page One',
        platform: 'facebook',
        externalId: 'external-1',
        publishedAt: new Date('2026-10-24T09:00:00.000Z'),
        caption: 'A short caption',
        mediaUrl: 'https://example.com/image.jpg',
        postStatus: 'published',
        instagramUsername: '',
        ...overrides,
    };
}

test('keeps the latest snapshot per post and platform', () => {
    const older = {
        postId: 'post-1',
        platform: 'facebook',
        capturedAt: new Date('2026-10-24T09:00:00.000Z'),
        metrics: metrics({ reach: 100 }),
    };
    const newer = {
        postId: 'post-1',
        platform: 'facebook',
        capturedAt: new Date('2026-10-24T09:05:00.000Z'),
        metrics: metrics({ reach: 200 }),
    };

    const latest = latestSnapshotsByTarget([older, newer] as never[]);
    assert.equal(latest.get('post-1:facebook')?.metrics.reach, 200);
});

test('summarizes reach, interactions, and weighted engagement rate', () => {
    const latest = new Map([
        ['post-1:facebook', { metrics: metrics({ reach: 100, interactions: 13 }) }],
        ['post-2:instagram', { metrics: metrics({ reach: 300, interactions: 27 }) }],
    ]);

    const summary = summarizeTargets(
        [target(), target({ postId: 'post-2', platform: 'instagram' })] as never[],
        latest as never
    );

    assert.equal(summary.posts, 2);
    assert.equal(summary.reach, 400);
    assert.equal(summary.interactions, 40);
    assert.equal(summary.engagementRate, 10);
});

test('zero-fills activity buckets', () => {
    const range = {
        fromKey: '2026-10-23',
        toKey: '2026-10-25',
        granularity: 'day' as const,
    };
    const activity = buildActivity(
        [target()] as never[],
        new Map([['post-1:facebook', { metrics: metrics() }]]) as never,
        range
    );

    assert.equal(activity.length, 3);
    assert.equal(activity[0]?.posts, 0);
    assert.equal(activity[1]?.posts, 1);
});

test('builds all 56 best-time blocks', () => {
    const bestTimes = buildBestTimes(
        [target(), target({ postId: 'post-2' })] as never[],
        new Map() as never
    );
    assert.equal(bestTimes.length, 56);
});

test('builds monitor series in five-minute buckets', () => {
    const snapshots = [
        { platform: 'facebook', capturedAt: new Date('2026-10-24T09:00:10.000Z'), metrics: metrics({ reach: 100, interactions: 10 }) },
        { platform: 'instagram', capturedAt: new Date('2026-10-24T09:01:20.000Z'), metrics: metrics({ reach: 50, interactions: 5 }) },
    ];
    const series = buildMonitorSeries(snapshots as never[]);
    assert.equal(series.all.length, 1);
    assert.equal(series.all[0]?.reach, 150);
    assert.equal(series.all[0]?.interactions, 15);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --import tsx --test src/services/analyticsService.test.ts`
Expected: FAIL because `analyticsService.ts` does not exist.

- [ ] **Step 3: Implement the aggregation core**

Create `analyticsService.ts` with these exported pieces:

```ts
import { Post } from '../models/postModel.js';
import type { Platform, PostStatus } from '../models/postModel.js';
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

function sumAvailable(values: Array<number | null>): number {
    return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function weightedRate(interactions: number, reach: number, views: number): number | null {
    const denominator = reach > 0 ? reach : views > 0 ? views : 0;
    return denominator > 0
        ? Math.round((interactions / denominator) * 1000) / 10
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

    for (const target of targets) {
        postIds.add(target.postId);
        if (target.platform === 'facebook') facebookPosts += 1;
        else instagramPosts += 1;

        const metrics = latest.get(targetKey(target.postId, target.platform))?.metrics;
        if (!metrics) continue;
        reach += metrics.reach ?? 0;
        views += metrics.views ?? 0;
        interactions += metrics.interactions ?? 0;
        likes += metrics.likes ?? 0;
        comments += metrics.comments ?? 0;
        shares += metrics.shares ?? 0;
        saves += metrics.saves ?? 0;
        clicks += metrics.clicks ?? 0;
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
        engagementRate: weightedRate(interactions, reach, views),
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
            bucket.interactions += metrics.interactions ?? 0;
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
        { posts: number; interactions: number; reach: number; views: number }
    >();

    for (const target of targets) {
        const day = istWeekday(target.publishedAt);
        const block = istHourBlock(target.publishedAt);
        const key = `${day}:${block}`;
        const value = buckets.get(key) ?? {
            posts: 0,
            interactions: 0,
            reach: 0,
            views: 0,
        };
        value.posts += 1;
        const metrics = latest.get(targetKey(target.postId, target.platform))?.metrics;
        if (metrics) {
            value.interactions += metrics.interactions ?? 0;
            value.reach += metrics.reach ?? 0;
            value.views += metrics.views ?? 0;
        }
        buckets.set(key, value);
    }

    const result: BestTimeBucket[] = [];
    for (let day = 1; day <= 7; day += 1) {
        for (let block = 0; block < 8; block += 1) {
            const value = buckets.get(`${day}:${block}`) ?? {
                posts: 0,
                interactions: 0,
                reach: 0,
                views: 0,
            };
            result.push({
                day,
                dayLabel: DAY_LABELS[day - 1] || '',
                block,
                label: BLOCK_LABELS[block] || '',
                posts: value.posts,
                avgEngagementRate:
                    value.posts >= 2
                        ? weightedRate(value.interactions, value.reach, value.views)
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
            { reach: number; views: number; interactions: number }
        >();
        for (const snapshot of snapshots) {
            if (platform && snapshot.platform !== platform) continue;
            const key = bucket(snapshot.capturedAt);
            const value = grouped.get(key) ?? {
                reach: 0,
                views: 0,
                interactions: 0,
            };
            value.reach += snapshot.metrics.reach ?? 0;
            value.views += snapshot.metrics.views ?? 0;
            value.interactions += snapshot.metrics.interactions ?? 0;
            grouped.set(key, value);
        }
        return [...grouped.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([capturedAt, value]) => ({
                capturedAt,
                reach: value.reach,
                views: value.views,
                interactions: value.interactions,
                engagementRate: weightedRate(
                    value.interactions,
                    value.reach,
                    value.views
                ),
            }));
    }

    return { all: build(), facebook: build('facebook'), instagram: build('instagram') };
}
```

- [ ] **Step 4: Add data loading and response builders**

Append to `analyticsService.ts`:

```ts
export async function loadPublishedTargets(
    userId: string,
    range: AnalyticsRange,
    filters: AnalyticsFilters
): Promise<PublishedTarget[]> {
    const query: Record<string, unknown> = {
        userId,
        status: { $in: ['published', 'partial'] },
        publishedAt: { $gte: range.from, $lte: range.to },
    };
    if (filters.connectionId) query.connectionId = filters.connectionId;

    const posts = await Post.find(query)
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

export async function loadSnapshots(
    userId: string,
    targets: PublishedTarget[]
): Promise<IPostMetricSnapshot[]> {
    const postIds = [...new Set(targets.map((target) => target.postId))];
    if (postIds.length === 0) return [];
    return PostMetricSnapshot.find({
        userId,
        postId: { $in: postIds },
    }).sort({ capturedAt: -1 });
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

function lastSyncedAt(
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

export async function getAnalyticsOverview(
    userId: string,
    range: AnalyticsRange,
    filters: AnalyticsFilters
) {
    const targets = await loadPublishedTargets(userId, range, filters);
    const snapshots = await loadSnapshots(userId, targets);
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
            preset: 'custom',
            timezone: 'Asia/Kolkata',
        },
        totals: summary,
        byPlatform,
        activity: buildActivity(targets, latest, range),
        bestTimes: buildBestTimes(targets, latest),
        sync: {
            lastSyncedAt: lastSyncedAt(targets, latest),
            staleTargets: staleCount(targets, latest, 15),
            remainingTargets: 0,
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
    const snapshots = await loadSnapshots(userId, targets);
    const latest = latestSnapshotsByTarget(snapshots);
    const summary = summarizeTargets(targets, latest);
    const series = buildMonitorSeries(snapshots);

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

    return {
        scope: {
            connectionId: filters.connectionId || null,
            pageName: filters.connectionId
                ? targets[0]?.pageName || 'Page'
                : 'All Pages',
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
    const snapshots = await loadSnapshots(userId, targets);
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
```

- [ ] **Step 5: Add rule-based tips and AI payload**

Append:

```ts
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

    const pageNames = new Set(input.permissionErrors.map((error) => error.pageName));
    if (pageNames.size > 0) {
        const count = pageNames.size;
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

The implemented `buildAnalyticsAiPayload` lives in
`backend/src/services/analyticsService.ts`. Its input shape is:

```ts
topPosts: Array<{
    postId: string;
    caption: string;
    reach: number;
    views: number | null;
    interactions: number | null;
}>;
```

The implementation dedupes cross-posted entries by `postId`, combines
reach/views/interactions, computes the engagement rate with the reach→views
denominator, trims captions to 120 characters, and strips IDs and full captions
from the payload.
```

- [ ] **Step 6: Run the tests and build**

Run: `cd backend && node --import tsx --test src/services/analyticsService.test.ts && npm run build`
Expected: PASS and build succeeds.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/analyticsService.ts backend/src/services/analyticsService.test.ts
git commit -m "feat: add analytics aggregation service"
```

## Task 5: Sync service

**Files:**
- Create: `backend/src/services/analyticsSyncService.ts`
- Test: `backend/src/services/analyticsSyncService.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { selectStaleTargets, syncCapForMode } = await import(
    './analyticsSyncService.js'
);

test('selects newest stale targets first and respects the cap', () => {
    const targets = [
        { postId: 'old', platform: 'facebook', publishedAt: new Date('2026-10-01') },
        { postId: 'new', platform: 'facebook', publishedAt: new Date('2026-10-24') },
        { postId: 'mid', platform: 'facebook', publishedAt: new Date('2026-10-10') },
    ];
    const selected = selectStaleTargets(targets as never[], new Map(), 'stale', new Date('2026-10-24T12:00:00Z'));
    assert.deepEqual(selected.map((target) => target.postId), ['new', 'mid', 'old']);
});

test('uses 20 targets for stale sync and 10 for live sync', () => {
    assert.equal(syncCapForMode('stale'), 20);
    assert.equal(syncCapForMode('live'), 10);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --import tsx --test src/services/analyticsSyncService.test.ts`
Expected: FAIL because `analyticsSyncService.ts` does not exist.

- [ ] **Step 3: Implement the service**

```ts
import { SocialConnection } from '../models/socialConnectionModel.js';
import { PostMetricSnapshot } from '../models/postMetricSnapshotModel.js';
import { decryptSecret } from './cryptoService.js';
import {
    latestSnapshotsByTarget,
    loadLatestSnapshots,
    loadPublishedTargets,
    targetKey,
    type AnalyticsFilters,
    type PublishedTarget,
} from './analyticsService.js';
import type { AnalyticsRange } from './analyticsDateService.js';
import {
    fetchFacebookMetrics,
    fetchInstagramMetrics,
    type NormalizedInsightMetrics,
} from './metaInsightsService.js';
import { MetaApiError } from './metaService.js';

export type SyncMode = 'stale' | 'live';

export interface SyncResult {
    synced: number;
    failed: number;
    skipped: number;
    remaining: number;
    permissionErrors: Array<{ connectionId: string; pageName: string; platform: string }>;
    lastSyncedAt: string | null;
}

export function syncCapForMode(mode: SyncMode): number {
    return mode === 'live' ? 10 : 20;
}

export function selectStaleTargets(
    targets: PublishedTarget[],
    latest: Map<string, { capturedAt: Date }>,
    mode: SyncMode,
    now: Date
): PublishedTarget[] {
    const staleMinutes = mode === 'live' ? 5 : 15;
    const before = now.getTime() - staleMinutes * 60_000;
    return targets
        .filter((target) => {
            const snapshot = latest.get(targetKey(target.postId, target.platform));
            return !snapshot || snapshot.capturedAt.getTime() < before;
        })
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}

async function mapWithConcurrency<T, R>(
    values: T[],
    limit: number,
    worker: (value: T) => Promise<R>
): Promise<R[]> {
    const results: R[] = [];
    let index = 0;
    async function run(): Promise<void> {
        while (index < values.length) {
            const current = index;
            index += 1;
            const value = values[current];
            if (value !== undefined) results[current] = await worker(value);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, values.length) }, run));
    return results;
}

async function upsertSnapshot(
    userId: string,
    target: PublishedTarget,
    result: NormalizedInsightMetrics
): Promise<void> {
    const now = new Date();
    const existing = await PostMetricSnapshot.findOne({
        postId: target.postId,
        platform: target.platform,
        capturedAt: { $gte: new Date(now.getTime() - 60_000) },
    });

    const data = {
        userId,
        connectionId: target.connectionId,
        pageId: target.pageId,
        pageName: target.pageName,
        postId: target.postId,
        platform: target.platform,
        externalId: target.externalId,
        publishedAt: target.publishedAt,
        capturedAt: now,
        metrics: result.metrics,
        availableMetrics: result.availableMetrics,
        status: result.status,
        error: result.error,
    };

    if (existing) {
        await PostMetricSnapshot.updateOne({ _id: existing._id }, { $set: data });
    } else {
        await PostMetricSnapshot.create(data);
    }
}

export async function syncAnalytics(
    userId: string,
    range: AnalyticsRange,
    filters: AnalyticsFilters,
    mode: SyncMode
): Promise<SyncResult> {
    const targets = await loadPublishedTargets(userId, range, filters);
    const snapshots = await loadLatestSnapshots(userId, targets, range);
    const latest = latestSnapshotsByTarget(snapshots);
    const stale = selectStaleTargets(targets, latest, mode, new Date());
    const selected = stale.slice(0, syncCapForMode(mode));

    const connectionIds = [...new Set(selected.map((target) => target.connectionId))];
    const connections = await SocialConnection.find({
        _id: { $in: connectionIds },
        userId,
    }).select('+pageAccessTokenEnc');
    const connectionMap = new Map(
        connections.map((connection) => [String(connection._id), connection])
    );

    let failed = 0;
    let skipped = 0;
    let synced = 0;
    const permissionErrors: SyncResult['permissionErrors'] = [];

    await mapWithConcurrency(selected, 3, async (target) => {
        if (!target.externalId) {
            skipped += 1;
            return;
        }
        const connection = connectionMap.get(target.connectionId);
        if (!connection) {
            skipped += 1;
            return;
        }

        let token: string;
        try {
            token = decryptSecret(connection.pageAccessTokenEnc);
        } catch {
            failed += 1;
            await SocialConnection.updateOne(
                { _id: connection._id },
                {
                    $set: {
                        tokenStatus: 'needs_reauth',
                        lastError: 'Stored Page token could not be decrypted. Reconnect this Page.',
                    },
                }
            );
            return;
        }

        try {
            const result =
                target.platform === 'facebook'
                    ? await fetchFacebookMetrics(target.externalId, token)
                    : await fetchInstagramMetrics(target.externalId, token);
            await upsertSnapshot(userId, target, result);
            synced += 1;
            if (result.status === 'permission_error') {
                permissionErrors.push({
                    connectionId: target.connectionId,
                    pageName: target.pageName,
                    platform: target.platform,
                });
            }
        } catch (error) {
            failed += 1;
            if (error instanceof MetaApiError && error.isTokenError) {
                await SocialConnection.updateOne(
                    { _id: connection._id },
                    {
                        $set: {
                            tokenStatus: 'needs_reauth',
                            lastError: 'Meta access token is invalid or was revoked. Reconnect this Page.',
                        },
                    }
                );
            }
        }
    });

    return {
        synced,
        failed,
        skipped,
        remaining: Math.max(0, stale.length - selected.length),
        permissionErrors,
        lastSyncedAt: new Date().toISOString(),
    };
}
```

- [ ] **Step 4: Run the tests and build**

Run: `cd backend && node --import tsx --test src/services/analyticsSyncService.test.ts && npm run build`
Expected: PASS and build succeeds.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/analyticsSyncService.ts backend/src/services/analyticsSyncService.test.ts
git commit -m "feat: add analytics sync service"
```

---

## Task 6: Cached AI tips service

**Files:**
- Create: `backend/src/services/analyticsAiService.ts`
- Test: `backend/src/services/analyticsAiService.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { parseAnalyticsAiTips, buildAnalyticsAiPrompt } = await import(
    './analyticsAiService.js'
);

test('parses and normalizes AI tips', () => {
    const tips = parseAnalyticsAiTips(JSON.stringify({
        tips: [
            {
                title: 'Post on Wednesday evenings',
                body: 'Your 18:00–21:00 IST posts perform best.',
                severity: 'success',
                actionLabel: 'Open composer',
                actionHref: '/composer',
            },
        ],
    }));

    assert.equal(tips.length, 1);
    assert.equal(tips[0]?.title, 'Post on Wednesday evenings');
    assert.equal(tips[0]?.severity, 'success');
});

test('rejects invalid AI JSON', () => {
    assert.throws(() => parseAnalyticsAiTips('not json'), /invalid/i);
});

test('prompt includes the scope and timing data', () => {
    const prompt = buildAnalyticsAiPrompt({
        scopeName: 'Page One',
        range: { from: '2026-09-25', to: '2026-10-24' },
        summary: { posts: 4 },
        bestTimes: [{ dayLabel: 'Wed', label: '18:00–21:00 IST', posts: 3 }],
    } as never);

    assert.match(prompt, /Page One/);
    assert.match(prompt, /Wednesday|Wed/);
    assert.match(prompt, /18:00/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --import tsx --test src/services/analyticsAiService.test.ts`
Expected: FAIL because `analyticsAiService.ts` does not exist.

- [ ] **Step 3: Implement the service**

```ts
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { AnalyticsAiInsight, type IAnalyticsTip } from '../models/analyticsAiInsightModel.js';
import { AppError } from '../utils/errors.js';
import { getGeminiCredentials } from './credentialService.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const CACHE_HOURS = 6;

export function buildAnalyticsAiPrompt(payload: Record<string, unknown>): string {
    return [
        'You are a social media analyst for Meta-Bru.',
        'Use only the data below. Do not invent metrics.',
        'Return strict JSON: {"tips":[{"title":"","body":"","severity":"info|success|warning","actionLabel":"","actionHref":""}]}.',
        'Return 3 to 5 tips. Keep each body under 240 characters.',
        'Use IST timing when recommending a posting time.',
        'If there is not enough data, say so instead of guessing.',
        'Action links must be internal paths beginning with /.',
        '',
        JSON.stringify(payload),
    ].join('\n');
}

export function parseAnalyticsAiTips(rawText: string): IAnalyticsTip[] {
    const cleaned = rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

    let parsed: unknown;
    try {
        parsed = JSON.parse(cleaned);
    } catch {
        throw new AppError(502, 'AI returned invalid JSON', 'AI_TIPS_INVALID');
    }

    const tips = (parsed as { tips?: unknown }).tips;
    if (!Array.isArray(tips)) {
        throw new AppError(502, 'AI returned no tips', 'AI_TIPS_INVALID');
    }

    const normalized: IAnalyticsTip[] = [];
    for (const tip of tips) {
        if (!tip || typeof tip !== 'object') continue;
        const value = tip as Record<string, unknown>;
        if (typeof value.title !== 'string' || typeof value.body !== 'string') continue;
        const severity =
            value.severity === 'success' || value.severity === 'warning'
                ? value.severity
                : 'info';
        const actionHref =
            typeof value.actionHref === 'string' && value.actionHref.startsWith('/')
                ? value.actionHref
                : '';
        normalized.push({
            title: value.title.trim().slice(0, 120),
            body: value.body.trim().slice(0, 240),
            severity,
            actionLabel:
                typeof value.actionLabel === 'string'
                    ? value.actionLabel.trim().slice(0, 40)
                    : '',
            actionHref,
        });
    }

    if (normalized.length === 0) {
        throw new AppError(502, 'AI returned no usable tips', 'AI_TIPS_INVALID');
    }
    return normalized.slice(0, 5);
}

function hashPayload(payload: unknown): string {
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export async function getCachedAnalyticsAiInsight(
    userId: string,
    scopeKey: string,
    rangeKey: string,
    dataHash: string
) {
    return AnalyticsAiInsight.findOne({
        userId,
        scopeKey,
        rangeKey,
        dataHash,
        expiresAt: { $gt: new Date() },
    }).sort({ generatedAt: -1 });
}

export async function generateAnalyticsAiInsight(
    userId: string,
    scopeKey: string,
    rangeKey: string,
    payload: Record<string, unknown>,
    connectionId: string | null
) {
    const dataHash = hashPayload(payload);
    const cached = await getCachedAnalyticsAiInsight(userId, scopeKey, rangeKey, dataHash);
    if (cached) return { insight: cached, cached: true };

    const credentials = await getGeminiCredentials(userId);
    const prompt = buildAnalyticsAiPrompt(payload);
    let response: Response;
    try {
        response = await fetch(
            `${GEMINI_BASE}/models/${encodeURIComponent(env.gemini.textModel)}:generateContent`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': credentials.apiKey,
                },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.4,
                        responseMimeType: 'application/json',
                        maxOutputTokens: 2048,
                        ...(env.gemini.textModel.includes('flash')
                            ? { thinkingConfig: { thinkingBudget: 0 } }
                            : {}),
                    },
                }),
                signal: AbortSignal.timeout(30_000),
            }
        );
    } catch (error) {
        throw new AppError(
            502,
            error instanceof Error ? `Could not reach Gemini: ${error.message}` : 'Could not reach Gemini',
            'AI_TIPS_FAILED'
        );
    }

    const data = (await response.json().catch(() => ({}))) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        error?: { message?: string };
    };
    if (!response.ok || data.error) {
        throw new AppError(
            502,
            data.error?.message || 'Gemini analytics analysis failed',
            'AI_TIPS_FAILED'
        );
    }

    const rawText = data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || '')
        .join('')
        .trim();
    if (!rawText) {
        throw new AppError(502, 'Gemini returned an empty analysis', 'AI_TIPS_EMPTY');
    }

    const tips = parseAnalyticsAiTips(rawText);
    const now = new Date();
    const insight = await AnalyticsAiInsight.create({
        userId,
        scopeKey,
        connectionId,
        rangeKey,
        dataHash,
        tips,
        model: env.gemini.textModel,
        generatedAt: now,
        expiresAt: new Date(now.getTime() + CACHE_HOURS * 60 * 60_000),
    });

    return { insight, cached: false };
}
```

- [ ] **Step 4: Run the tests and build**

Run: `cd backend && node --import tsx --test src/services/analyticsAiService.test.ts && npm run build`
Expected: PASS and build succeeds.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/analyticsAiService.ts backend/src/services/analyticsAiService.test.ts
git commit -m "feat: add cached analytics AI tips"
```

---

## Task 7: Controller, routes, and rate limits

**Files:**
- Modify: `backend/src/utils/validation.ts` — add `parseQuery`.
- Modify: `backend/src/middlewares/rateLimiters.ts` — add analytics limiters.
- Create: `backend/src/controllers/analyticsController.ts`
- Create: `backend/src/routes/analyticsRoutes.ts`
- Modify: `backend/src/index.ts` — mount `/api/analytics`.
- Test: `backend/src/controllers/analyticsController.test.ts`

- [ ] **Step 1: Add query parsing and limiters**

In `validation.ts`:

```ts
export function parseQuery<T extends z.ZodTypeAny>(schema: T, req: Request): z.infer<T> {
    const result = schema.safeParse(req.query);
    if (!result.success) {
        const message = result.error.issues
            .map((issue) => `${issue.path.join('.') || 'query'}: ${issue.message}`)
            .join('; ');
        throw new AppError(400, message, 'VALIDATION_ERROR');
    }
    return result.data;
}
```

In `rateLimiters.ts`:

```ts
export const analyticsReadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: userKey,
    message: {
        success: false,
        message: 'Analytics request limit reached. Try again in a few minutes.',
    },
});

export const analyticsSyncLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: userKey,
    message: {
        success: false,
        message: 'Analytics sync limit reached. Try again in a few minutes.',
    },
});
```

- [ ] **Step 2: Write the failing controller test**

```ts
import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { overview } = await import('./analyticsController.js');
const { Post } = await import('../models/postModel.js');
const { PostMetricSnapshot } = await import(
    '../models/postMetricSnapshotModel.js'
);

const postModel = Post as unknown as {
    find: (...args: unknown[]) => unknown;
};
const snapshotModel = PostMetricSnapshot as unknown as {
    find: (...args: unknown[]) => unknown;
};

function request(query: Record<string, string>): Request {
    return { query, user: { id: 'user-1' } } as unknown as Request;
}

function response(): { res: Response; json: ReturnType<typeof mock.fn> } {
    const json = mock.fn();
    return { res: { json } as unknown as Response, json };
}

afterEach(() => mock.restoreAll());

test('overview scopes to the authenticated user', async () => {
    let receivedQuery: Record<string, unknown> = {};
    mock.method(postModel, 'find', (query: Record<string, unknown>) => {
        receivedQuery = query;
        return {
            populate: () => ({
                sort: async () => [],
            }),
        };
    });
    mock.method(snapshotModel, 'find', () => ({
        sort: async () => [],
    }));

    const { res, json } = response();
    await overview(
        request({ from: '2026-09-25', to: '2026-10-24' }),
        res
    );

    assert.equal(receivedQuery.userId, 'user-1');
    assert.equal(json.mock.callCount(), 1);
});

test('overview rejects a userId query parameter', async () => {
    const { res } = response();
    await assert.rejects(
        () => overview(
            request({
                from: '2026-09-25',
                to: '2026-10-24',
                userId: 'someone-else',
            }),
            res
        ),
        /userId/
    );
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && node --import tsx --test src/controllers/analyticsController.test.ts`
Expected: FAIL because the controller does not exist.

- [ ] **Step 4: Implement the controller and routes**

`analyticsController.ts`:

```ts
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
    buildAnalyticsAiPayload,
    buildBestTimes,
    buildRuleBasedTips,
    buildActivity,
    getAnalyticsMonitor,
    getAnalyticsOverview,
    getAnalyticsPosts,
    loadLatestSnapshots,
    loadPublishedTargets,
    latestSnapshotsByTarget,
    resolvePageName,
    summarizeTargets,
    uniquePermissionErrors,
} from '../services/analyticsService.js';
import { parseAnalyticsRange } from '../services/analyticsDateService.js';
import { syncAnalytics } from '../services/analyticsSyncService.js';
import {
    generateAnalyticsAiInsight,
    getCachedAnalyticsAiInsight,
} from '../services/analyticsAiService.js';
import { parseBody, parseQuery } from '../utils/validation.js';

const rangeQuerySchema = z
    .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        connectionId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
        platform: z.enum(['facebook', 'instagram']).optional(),
        userId: z.never().optional(),
    })
    .strict();

const postsQuerySchema = rangeQuerySchema.extend({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
});

const syncBodySchema = rangeQuerySchema.extend({
    mode: z.enum(['stale', 'live']).default('stale'),
});
const tipsBodySchema = rangeQuerySchema;

function rangeAndFilters(input: z.infer<typeof rangeQuerySchema>) {
    return {
        range: parseAnalyticsRange(input.from, input.to),
        filters: {
            ...(input.connectionId ? { connectionId: input.connectionId } : {}),
            ...(input.platform ? { platform: input.platform } : {}),
        },
    };
}

export async function overview(req: Request, res: Response): Promise<void> {
    const input = parseQuery(rangeQuerySchema, req);
    const { range, filters } = rangeAndFilters(input);
    const data = await getAnalyticsOverview(req.user!.id, range, filters);
    res.json({ success: true, ...data });
}

export async function monitor(req: Request, res: Response): Promise<void> {
    const input = parseQuery(rangeQuerySchema, req);
    const { range, filters } = rangeAndFilters(input);
    const data = await getAnalyticsMonitor(req.user!.id, range, filters);
    res.json({ success: true, ...data });
}

export async function listPosts(req: Request, res: Response): Promise<void> {
    const input = parseQuery(postsQuerySchema, req);
    const { range, filters } = rangeAndFilters(input);
    const data = await getAnalyticsPosts(
        req.user!.id,
        range,
        filters,
        input.page,
        input.limit
    );
    res.json({ success: true, ...data });
}

export async function sync(req: Request, res: Response): Promise<void> {
    const input = parseBody(syncBodySchema, req);
    const { range, filters } = rangeAndFilters(input);
    const data = await syncAnalytics(req.user!.id, range, filters, input.mode);
    res.json({ success: true, ...data });
}

export async function tips(req: Request, res: Response): Promise<void> {
    const input = parseQuery(rangeQuerySchema, req);
    const { range, filters } = rangeAndFilters(input);
    const targets = await loadPublishedTargets(req.user!.id, range, filters);
    const snapshots = await loadLatestSnapshots(req.user!.id, targets, range);
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
    const activity = buildActivity(targets, latest, range);
    const bestTimes = buildBestTimes(targets, latest);
    const permissionErrors = uniquePermissionErrors(targets, latest);
    const posts = targets.map((target) => ({
        caption: target.caption,
        engagementRate:
            latest.get(`${target.postId}:${target.platform}`)?.metrics.engagementRate ?? null,
    }));
    const ruleBased = buildRuleBasedTips({
        summary,
        byPlatform,
        bestTimes,
        activity,
        permissionErrors,
        posts,
        granularity: range.granularity,
    });
    const scopeKey = filters.connectionId || 'all';
    const rangeKey = `${range.fromKey}:${range.toKey}:${filters.platform || 'all'}`;
    const scopeName = filters.connectionId
        ? await resolvePageName(req.user!.id, filters.connectionId, targets)
        : 'All Pages';
    const payload = buildAnalyticsAiPayload({
        range,
        scopeName,
        summary,
        byPlatform,
        activity,
        bestTimes,
        permissionErrors,
        topPosts: targets.map((target) => ({
            postId: target.postId,
            caption: target.caption,
            reach: latest.get(`${target.postId}:${target.platform}`)?.metrics.reach ?? 0,
            views: latest.get(`${target.postId}:${target.platform}`)?.metrics.views ?? null,
            interactions:
                latest.get(`${target.postId}:${target.platform}`)?.metrics.interactions ?? null,
        })),
        brandProfile: req.user!.brandProfile || {},
    });
    const cached = await getCachedAnalyticsAiInsight(
        req.user!.id,
        scopeKey,
        rangeKey,
        hashForPayload(payload)
    );
    res.json({
        success: true,
        ruleBased,
        ai: cached
            ? {
                  cached: true,
                  generatedAt: cached.generatedAt.toISOString(),
                  expiresAt: cached.expiresAt.toISOString(),
                  model: cached.model,
                  tips: cached.tips,
              }
            : null,
    });
}

export async function generateTips(req: Request, res: Response): Promise<void> {
    const input = parseBody(tipsBodySchema, req);
    const { range, filters } = rangeAndFilters(input);
    const targets = await loadPublishedTargets(req.user!.id, range, filters);
    const snapshots = await loadLatestSnapshots(req.user!.id, targets, range);
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
    const activity = buildActivity(targets, latest, range);
    const bestTimes = buildBestTimes(targets, latest);
    const permissionErrors = uniquePermissionErrors(targets, latest);
    const scopeName = filters.connectionId
        ? await resolvePageName(req.user!.id, filters.connectionId, targets)
        : 'All Pages';
    const payload = buildAnalyticsAiPayload({
        range,
        scopeName,
        summary,
        byPlatform,
        activity,
        bestTimes,
        permissionErrors,
        topPosts: targets.map((target) => ({
            postId: target.postId,
            caption: target.caption,
            reach: latest.get(`${target.postId}:${target.platform}`)?.metrics.reach ?? 0,
            views: latest.get(`${target.postId}:${target.platform}`)?.metrics.views ?? null,
            interactions:
                latest.get(`${target.postId}:${target.platform}`)?.metrics.interactions ?? null,
        })),
        brandProfile: req.user!.brandProfile || {},
    });
    const scopeKey = filters.connectionId || 'all';
    const rangeKey = `${range.fromKey}:${range.toKey}:${filters.platform || 'all'}`;
    const result = await generateAnalyticsAiInsight(
        req.user!.id,
        scopeKey,
        rangeKey,
        payload,
        filters.connectionId || null
    );
    res.json({
        success: true,
        cached: result.cached,
        insight: {
            generatedAt: result.insight.generatedAt.toISOString(),
            expiresAt: result.insight.expiresAt.toISOString(),
            model: result.insight.model,
            tips: result.insight.tips,
        },
    });
}

function hashForPayload(payload: unknown): string {
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
```

`analyticsRoutes.ts`:

```ts
import express from 'express';
import {
    generateTips,
    listPosts,
    monitor,
    overview,
    sync,
    tips,
} from '../controllers/analyticsController.js';
import { protect } from '../middlewares/authMiddleware.js';
import {
    aiLimiter,
    analyticsReadLimiter,
    analyticsSyncLimiter,
} from '../middlewares/rateLimiters.js';

const router = express.Router();

router.use(protect);
router.get('/overview', analyticsReadLimiter, overview);
router.get('/monitor', analyticsReadLimiter, monitor);
router.get('/posts', analyticsReadLimiter, listPosts);
router.post('/sync', analyticsSyncLimiter, sync);
router.get('/tips', analyticsReadLimiter, tips);
router.post('/tips', aiLimiter, generateTips);

export default router;
```

In `index.ts`:

```ts
import analyticsRoutes from './routes/analyticsRoutes.js';
```

and:

```ts
app.use('/api/analytics', analyticsRoutes);
```

- [ ] **Step 5: Run the controller test and build**

Run: `cd backend && node --import tsx --test src/controllers/analyticsController.test.ts && npm run build`
Expected: PASS and build succeeds.

- [ ] **Step 6: Commit**

```bash
git add backend/src/utils/validation.ts backend/src/middlewares/rateLimiters.ts backend/src/controllers/analyticsController.ts backend/src/controllers/analyticsController.test.ts backend/src/routes/analyticsRoutes.ts backend/src/index.ts
git commit -m "feat: add analytics API routes"
```

---

## Task 8: OAuth scopes and deployment docs

**Files:**
- Modify: `backend/src/config/env.ts`
- Modify: `backend/.env.example`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `frontend/src/app/settings/page.tsx`

- [ ] **Step 1: Add insight scopes to defaults**

In `backend/src/config/env.ts`, add to the default scope array:

```ts
'read_insights',
'instagram_manage_insights',
```

Place them after `pages_read_engagement`.

- [ ] **Step 2: Update the environment example**

In `backend/.env.example`, update the commented scope list to:

```text
# META_SCOPES=pages_show_list,pages_read_engagement,read_insights,pages_manage_posts,business_management,instagram_basic,instagram_content_publish,instagram_manage_insights
```

- [ ] **Step 3: Update deployment docs**

In `docs/DEPLOYMENT.md`, add under the Meta permissions list:

```markdown
- `read_insights` — required for Facebook post reach and view insights.
- `instagram_manage_insights` — required for Instagram media insights.
```

- [ ] **Step 4: Warn in Profile when scopes are missing**

In `frontend/src/app/settings/page.tsx`, after the scopes list, add:

```tsx
{credentialStatus?.meta.configured &&
!credentialStatus.meta.scopes.includes('read_insights') ? (
    <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
        Add <code>read_insights</code> and{' '}
        <code>instagram_manage_insights</code> to your Meta app and
        reconnect your Pages to enable analytics.
    </div>
) : null}
```

- [ ] **Step 5: Build and verify**

Run: `cd backend && npm run build`
Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/config/env.ts backend/.env.example docs/DEPLOYMENT.md frontend/src/app/settings/page.tsx
git commit -m "feat: request Meta insight scopes"
```

---

## Backend verification

Run:

```bash
cd backend
npm run build
npm test
```

Expected: build succeeds and all tests pass.

Manual API smoke test after the frontend is ready:

1. Start the backend and frontend.
2. Reconnect a Page.
3. Publish or use an existing published post.
4. Call `GET /api/analytics/overview?from=...&to=...`.
5. Call `POST /api/analytics/sync` with `{"from":"...","to":"...","mode":"stale"}`.
6. Confirm a `PostMetricSnapshot` document exists in MongoDB.
7. Call `GET /api/analytics/posts` and confirm the target metrics and IST timestamps.
