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
    buildPublishedTargetsQuery,
    buildSnapshotQuery,
    uniquePermissionErrors,
    lastSyncedAt,
    rangePreset,
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

function snapshot(overrides: Record<string, unknown> = {}) {
    return {
        postId: 'post-1',
        platform: 'facebook',
        status: 'ok',
        connectionId: 'connection-1',
        pageName: 'Page One',
        capturedAt: new Date('2026-10-24T09:00:00.000Z'),
        metrics: metrics(),
        ...overrides,
    };
}

test('keeps the latest snapshot per post and platform', () => {
    const older = snapshot({
        capturedAt: new Date('2026-10-24T09:00:00.000Z'),
        metrics: metrics({ reach: 100 }),
    });
    const newer = snapshot({
        capturedAt: new Date('2026-10-24T09:05:00.000Z'),
        metrics: metrics({ reach: 200 }),
    });

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

test('uses a per-target denominator when some targets only have views', () => {
    const latest = new Map([
        ['post-1:facebook', { metrics: metrics({ reach: 100, views: null, interactions: 10 }) }],
        [
            'post-2:instagram',
            { metrics: metrics({ reach: null, views: 1000, interactions: 10 }) },
        ],
    ]);

    const summary = summarizeTargets(
        [target(), target({ postId: 'post-2', platform: 'instagram' })] as never[],
        latest as never
    );

    assert.equal(summary.reach, 100);
    assert.equal(summary.views, 1000);
    assert.equal(summary.interactions, 20);
    // 20 interactions over 100 reach + 1000 views = 1.8%, not 20% of reach.
    assert.equal(summary.engagementRate, 1.8);
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

test('uses a per-target denominator for best-time rates', () => {
    const latest = new Map([
        ['post-1:facebook', { metrics: metrics({ reach: 100, views: null, interactions: 10 }) }],
        [
            'post-2:facebook',
            { metrics: metrics({ reach: null, views: 1000, interactions: 10 }) },
        ],
    ]);

    const bestTimes = buildBestTimes(
        [target(), target({ postId: 'post-2' })] as never[],
        latest as never
    );
    // 2026-10-24T09:00Z is Saturday 14:30 IST: day 6, block 4.
    const block = bestTimes.find((value) => value.day === 6 && value.block === 4);
    assert.equal(block?.posts, 2);
    assert.equal(block?.avgEngagementRate, 1.8);
});

test('builds monitor series in five-minute buckets', () => {
    const snapshots = [
        snapshot({
            platform: 'facebook',
            capturedAt: new Date('2026-10-24T09:00:10.000Z'),
            metrics: metrics({ reach: 100, interactions: 10 }),
        }),
        snapshot({
            postId: 'post-2',
            platform: 'instagram',
            capturedAt: new Date('2026-10-24T09:01:20.000Z'),
            metrics: metrics({ reach: 50, interactions: 5 }),
        }),
    ];
    const series = buildMonitorSeries(snapshots as never[]);
    assert.equal(series.all.length, 1);
    assert.equal(series.all[0]?.reach, 150);
    assert.equal(series.all[0]?.interactions, 15);
});

test('deduplicates the same target within a five-minute bucket', () => {
    const snapshots = [
        snapshot({
            platform: 'facebook',
            capturedAt: new Date('2026-10-24T09:00:10.000Z'),
            metrics: metrics({ reach: 100, interactions: 10 }),
        }),
        snapshot({
            platform: 'facebook',
            capturedAt: new Date('2026-10-24T09:02:00.000Z'),
            metrics: metrics({ reach: 200, interactions: 20 }),
        }),
        snapshot({
            postId: 'post-2',
            platform: 'instagram',
            capturedAt: new Date('2026-10-24T09:01:20.000Z'),
            metrics: metrics({ reach: 50, interactions: 5 }),
        }),
    ];

    const series = buildMonitorSeries(snapshots as never[]);
    assert.equal(series.all.length, 1);
    // Latest snapshot for post-1 wins (200), plus Instagram (50).
    assert.equal(series.all[0]?.reach, 250);
    assert.equal(series.all[0]?.interactions, 25);
});

test('sorts monitor series oldest to newest and keeps platforms separate', () => {
    const snapshots = [
        snapshot({
            platform: 'instagram',
            capturedAt: new Date('2026-10-24T09:10:00.000Z'),
            metrics: metrics({ reach: 50, interactions: 5 }),
        }),
        snapshot({
            platform: 'facebook',
            capturedAt: new Date('2026-10-24T09:00:00.000Z'),
            metrics: metrics({ reach: 100, interactions: 10 }),
        }),
    ];

    const series = buildMonitorSeries(snapshots as never[]);
    assert.deepEqual(
        series.all.map((point) => point.capturedAt),
        ['2026-10-24T09:00:00.000Z', '2026-10-24T09:10:00.000Z']
    );
    assert.equal(series.facebook.length, 1);
    assert.equal(series.facebook[0]?.reach, 100);
    assert.equal(series.instagram.length, 1);
    assert.equal(series.instagram[0]?.reach, 50);
});

test('builds a published-target query that includes target publish times', () => {
    const from = new Date('2026-10-01T00:00:00.000Z');
    const to = new Date('2026-10-31T23:59:59.999Z');
    const query = buildPublishedTargetsQuery(
        'user-1',
        { from, to } as never,
        { connectionId: 'connection-1', platform: 'facebook' }
    );

    assert.equal(query.userId, 'user-1');
    assert.deepEqual(query.status, { $in: ['published', 'partial'] });
    assert.equal(query.connectionId, 'connection-1');
    assert.deepEqual(query.$or, [
        { 'targets.publishedAt': { $gte: from, $lte: to } },
        { publishedAt: { $gte: from, $lte: to } },
    ]);
});

test('builds a snapshot query scoped by post ids and range', () => {
    const from = new Date('2026-10-01T00:00:00.000Z');
    const to = new Date('2026-10-31T23:59:59.999Z');
    const query = buildSnapshotQuery(
        'user-1',
        [target(), target({ postId: 'post-2' }), target()] as never[],
        { from, to }
    );

    assert.equal(query?.userId, 'user-1');
    assert.deepEqual(query?.postId, { $in: ['post-1', 'post-2'] });
    assert.deepEqual(query?.publishedAt, { $gte: from, $lte: to });
    assert.equal(buildSnapshotQuery('user-1', []), null);
});

test('scopes permission errors and last-sync time to the selected targets', () => {
    const targets = [target()] as never[];
    const latest = new Map([
        [
            'post-1:facebook',
            snapshot({
                status: 'permission_error',
                capturedAt: new Date('2026-10-24T09:00:00.000Z'),
            }),
        ],
        [
            'post-2:instagram',
            snapshot({
                postId: 'post-2',
                platform: 'instagram',
                status: 'permission_error',
                capturedAt: new Date('2026-10-24T10:00:00.000Z'),
            }),
        ],
    ]) as never;

    const errors = uniquePermissionErrors(targets, latest);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.platform, 'facebook');
    assert.equal(lastSyncedAt(targets, latest), '2026-10-24T09:00:00.000Z');
});

test('derives the range preset from the inclusive day count', () => {
    const day = 86_400_000;
    const start = new Date('2026-09-01T00:00:00.000Z').getTime();
    const makeRange = (days: number) => ({
        from: new Date(start),
        to: new Date(start + days * day - 1),
    });

    assert.equal(rangePreset(makeRange(7)), '7d');
    assert.equal(rangePreset(makeRange(30)), '30d');
    assert.equal(rangePreset(makeRange(60)), '60d');
    assert.equal(rangePreset(makeRange(90)), '90d');
    assert.equal(rangePreset(makeRange(14)), 'custom');
});
