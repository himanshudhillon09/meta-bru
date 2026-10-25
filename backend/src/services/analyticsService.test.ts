import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import type { IAnalyticsMetrics } from '../models/postMetricSnapshotModel.js';
import type { AnalyticsRange, AnalyticsSummary } from './analyticsService.js';

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
    loadPublishedTargets,
    getAnalyticsOverview,
    getAnalyticsMonitor,
    getAnalyticsPosts,
    buildRuleBasedTips,
    buildAnalyticsAiPayload,
} = await import('./analyticsService.js');

const { Post } = await import('../models/postModel.js');
const { PostMetricSnapshot } = await import('../models/postMetricSnapshotModel.js');
const { SocialConnection } = await import('../models/socialConnectionModel.js');

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

function post(overrides: Record<string, unknown> = {}) {
    return {
        _id: 'post-1',
        connectionId: {
            _id: 'connection-1',
            pageName: 'Page One',
            pageId: 'page-1',
            instagram: { username: 'pageone' },
        },
        caption: 'A short caption',
        mediaUrl: 'https://example.com/image.jpg',
        status: 'published',
        publishedAt: new Date('2026-10-05T09:00:00.000Z'),
        targets: [
            {
                platform: 'facebook',
                status: 'published',
                externalId: 'external-1',
                publishedAt: new Date('2026-10-05T09:00:00.000Z'),
            },
        ],
        ...overrides,
    };
}

function summary(overrides: Partial<AnalyticsSummary> = {}): AnalyticsSummary {
    return {
        posts: 0,
        facebookPosts: 0,
        instagramPosts: 0,
        reach: 0,
        views: 0,
        interactions: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
        clicks: 0,
        engagementRate: null,
        ...overrides,
    };
}

function analyticsRange(fromKey: string, toKey: string): AnalyticsRange {
    return {
        fromKey,
        toKey,
        from: new Date(`${fromKey}T00:00:00+05:30`),
        to: new Date(`${toKey}T23:59:59.999+05:30`),
        granularity: 'day',
    };
}

function mockPostFind(posts: unknown[]) {
    return mock.method(Post, 'find', () => ({
        populate: () => ({ sort: async () => posts }),
    }));
}

function mockSnapshotFind(snapshots: unknown[]) {
    return mock.method(PostMetricSnapshot, 'find', () => ({
        sort: async () => snapshots,
    }));
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

test('deduplicates permission errors per Page across platforms', () => {
    const targets = [target(), target({ platform: 'instagram' })] as never[];
    const latest = new Map([
        [
            'post-1:facebook',
            snapshot({ status: 'permission_error', platform: 'facebook' }),
        ],
        [
            'post-1:instagram',
            snapshot({
                status: 'permission_error',
                platform: 'instagram',
                connectionId: 'connection-1',
            }),
        ],
    ]) as never;

    const errors = uniquePermissionErrors(targets, latest);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.connectionId, 'connection-1');
    assert.equal(errors[0]?.pageName, 'Page One');
    // The first encountered snapshot wins for that Page.
    assert.equal(errors[0]?.platform, 'facebook');
});

test('keeps targets with unknown interactions out of the rate denominator', () => {
    const latest = new Map([
        [
            'post-1:facebook',
            { metrics: metrics({ reach: 100, views: null, interactions: 13 }) },
        ],
        [
            'post-2:instagram',
            {
                metrics: metrics({
                    reach: 1000,
                    views: null,
                    interactions: null,
                    likes: null,
                    comments: null,
                    shares: null,
                    saves: null,
                }),
            },
        ],
    ]);

    const result = summarizeTargets(
        [target(), target({ postId: 'post-2', platform: 'instagram' })] as never[],
        latest as never
    );

    assert.equal(result.interactions, 13);
    // 13 / 100 = 13%, not 13 / 1100 = 1.2%.
    assert.equal(result.engagementRate, 13);
});

test('falls back to interaction components when the aggregate is null', () => {
    const latest = new Map([
        [
            'post-1:facebook',
            {
                metrics: metrics({
                    reach: 100,
                    views: null,
                    interactions: null,
                    likes: 5,
                    comments: 3,
                    shares: null,
                    saves: null,
                }),
            },
        ],
        [
            'post-2:instagram',
            { metrics: metrics({ reach: 1000, views: null, interactions: 13 }) },
        ],
    ]);

    const result = summarizeTargets(
        [target(), target({ postId: 'post-2', platform: 'instagram' })] as never[],
        latest as never
    );

    // 5 + 3 = 8 on the first target, plus 13 on the second.
    assert.equal(result.interactions, 21);
    assert.equal(result.engagementRate, 1.9);
});

test('returns a null monitor engagement rate when interactions are unknown', () => {
    const series = buildMonitorSeries([
        snapshot({
            metrics: metrics({
                reach: 1000,
                interactions: null,
                likes: null,
                comments: null,
                shares: null,
                saves: null,
            }),
        }),
    ] as never[]);

    assert.equal(series.all[0]?.interactions, 0);
    assert.equal(series.all[0]?.engagementRate, null);
});

test('counts cross-posted targets as one post in best-time samples', () => {
    const publishedAt = new Date('2026-10-24T09:00:00.000Z');
    const bestTimes = buildBestTimes(
        [
            target({ publishedAt }),
            target({ platform: 'instagram', publishedAt }),
        ] as never[],
        new Map() as never
    );
    // 2026-10-24T09:00Z is Saturday 14:30 IST: day 6, block 4.
    const block = bestTimes.find((value) => value.day === 6 && value.block === 4);
    assert.equal(block?.posts, 1);
    assert.equal(block?.avgEngagementRate, null);
});

test('adds publishing frequency and longest gap to the AI payload', () => {
    const range = analyticsRange('2026-10-01', '2026-10-30');
    const activity = buildActivity(
        [
            target({
                postId: 'post-1',
                publishedAt: new Date('2026-10-01T09:00:00.000Z'),
            }),
            target({
                postId: 'post-2',
                publishedAt: new Date('2026-10-01T11:00:00.000Z'),
            }),
            target({
                postId: 'post-3',
                publishedAt: new Date('2026-10-10T09:00:00.000Z'),
            }),
        ] as never[],
        new Map() as never,
        range
    );

    const payload = buildAnalyticsAiPayload({
        range,
        scopeName: 'Page One',
        summary: summary({ posts: 3 }),
        byPlatform: { facebook: summary(), instagram: summary() },
        activity,
        bestTimes: [],
        permissionErrors: [],
        topPosts: [],
        brandProfile: {},
    });

    assert.deepEqual(payload.publishingFrequency, {
        posts: 3,
        activeBuckets: 2,
        buckets: 30,
        postsPerBucket: 0.1,
        postsPerActiveBucket: 1.5,
    });
    assert.equal(payload.longestGapDays, 8);
});

test('strips connection identifiers from the AI permission payload', () => {
    const permissionErrors = [
        {
            pageName: 'Page One',
            connectionId: 'connection-1',
            platform: 'facebook',
        },
    ] as unknown as Array<{ pageName: string }>;

    const payload = buildAnalyticsAiPayload({
        range: analyticsRange('2026-10-01', '2026-10-30'),
        scopeName: 'Page One',
        summary: summary(),
        byPlatform: { facebook: summary(), instagram: summary() },
        activity: [],
        bestTimes: [],
        permissionErrors,
        topPosts: [],
        brandProfile: {},
    });

    assert.deepEqual(payload.permissionErrors, [{ pageName: 'Page One' }]);
});

test('loads targets by target publish time and legacy post publish time', async (t) => {
    t.after(() => mock.restoreAll());
    const range = analyticsRange('2026-10-01', '2026-10-31');
    let capturedQuery: Record<string, unknown> | undefined;
    const posts = [
        post({
            _id: 'post-1',
            publishedAt: new Date('2026-09-01T09:00:00.000Z'),
            targets: [
                {
                    platform: 'facebook',
                    status: 'published',
                    externalId: 'external-1',
                    publishedAt: new Date('2026-10-05T09:00:00.000Z'),
                },
            ],
        }),
        post({
            _id: 'post-2',
            publishedAt: new Date('2026-10-10T09:00:00.000Z'),
            targets: [
                {
                    platform: 'instagram',
                    status: 'published',
                    externalId: 'external-2',
                    publishedAt: null,
                },
            ],
        }),
    ];

    mock.method(Post, 'find', (query: Record<string, unknown>) => {
        capturedQuery = query;
        return { populate: () => ({ sort: async () => posts }) };
    });

    const targets = await loadPublishedTargets('user-1', range, {});

    assert.equal(targets.length, 2);
    assert.equal(targets[0]?.postId, 'post-1');
    assert.equal(targets[0]?.publishedAt.toISOString(), '2026-10-05T09:00:00.000Z');
    assert.equal(targets[1]?.postId, 'post-2');
    assert.equal(targets[1]?.publishedAt.toISOString(), '2026-10-10T09:00:00.000Z');
    assert.deepEqual(capturedQuery?.$or, [
        { 'targets.publishedAt': { $gte: range.from, $lte: range.to } },
        { publishedAt: { $gte: range.from, $lte: range.to } },
    ]);
});

test('builds an overview response with remaining targets from mocked data', async (t) => {
    t.after(() => mock.restoreAll());
    const range = analyticsRange('2026-10-01', '2026-10-30');
    mockPostFind([
        post({
            _id: 'post-1',
            publishedAt: new Date('2026-10-05T09:00:00.000Z'),
        }),
        post({
            _id: 'post-2',
            publishedAt: new Date('2026-10-06T09:00:00.000Z'),
            targets: [
                {
                    platform: 'instagram',
                    status: 'published',
                    externalId: 'external-2',
                    publishedAt: new Date('2026-10-06T09:00:00.000Z'),
                },
            ],
        }),
    ]);
    mockSnapshotFind([
        snapshot({
            postId: 'post-1',
            platform: 'facebook',
            capturedAt: new Date('2026-10-07T09:00:00.000Z'),
            metrics: metrics({ reach: 100, interactions: 13 }),
        }),
    ]);

    const overview = await getAnalyticsOverview('user-1', range, {});

    assert.equal(overview.totals.posts, 2);
    assert.equal(overview.totals.reach, 100);
    assert.equal(overview.totals.interactions, 13);
    assert.equal(overview.range.preset, '30d');
    assert.equal(overview.range.from, '2026-10-01');
    assert.equal(overview.range.to, '2026-10-30');
    assert.equal(overview.activity.length, 30);
    assert.equal(overview.bestTimes.length, 56);
    assert.equal(overview.sync.lastSyncedAt, '2026-10-07T09:00:00.000Z');
    assert.equal(overview.sync.remainingTargets, 1);
    assert.deepEqual(overview.sync.permissionErrors, []);
});

test('scopes monitor series and deduplicates same-Page permission errors', async (t) => {
    t.after(() => mock.restoreAll());
    const range = analyticsRange('2026-10-01', '2026-10-31');
    mockPostFind([
        post({
            _id: 'post-1',
            publishedAt: new Date('2026-10-05T09:00:00.000Z'),
            targets: [
                {
                    platform: 'facebook',
                    status: 'published',
                    externalId: 'external-1',
                    publishedAt: new Date('2026-10-05T09:00:00.000Z'),
                },
                {
                    platform: 'instagram',
                    status: 'published',
                    externalId: 'external-2',
                    publishedAt: new Date('2026-10-05T09:00:00.000Z'),
                },
            ],
        }),
    ]);
    mockSnapshotFind([
        snapshot({
            postId: 'post-1',
            platform: 'facebook',
            status: 'permission_error',
            capturedAt: new Date('2026-10-06T09:00:00.000Z'),
        }),
        snapshot({
            postId: 'post-1',
            platform: 'instagram',
            status: 'permission_error',
            capturedAt: new Date('2026-10-06T09:00:00.000Z'),
        }),
        snapshot({
            postId: 'post-outside',
            platform: 'facebook',
            capturedAt: new Date('2026-10-06T09:05:00.000Z'),
            metrics: metrics({ reach: 999 }),
        }),
    ]);

    const monitor = await getAnalyticsMonitor('user-1', range, {
        connectionId: 'connection-1',
    });

    assert.equal(monitor.scope.pageName, 'Page One');
    assert.equal(monitor.sync.permissionErrors.length, 1);
    assert.equal(monitor.sync.permissionErrors[0]?.platform, 'facebook');
    // The out-of-scope snapshot would create a second bucket if it leaked in.
    assert.equal(monitor.series.all.length, 1);
    assert.equal(monitor.series.all[0]?.reach, 200);
});

test('resolves the selected Page name when the monitor scope has no targets', async (t) => {
    t.after(() => mock.restoreAll());
    const range = analyticsRange('2026-10-01', '2026-10-31');
    mockPostFind([]);
    mock.method(SocialConnection, 'findOne', () => ({ pageName: 'Empty Page' }));

    const monitor = await getAnalyticsMonitor('user-1', range, {
        connectionId: 'connection-1',
    });

    assert.equal(monitor.scope.connectionId, 'connection-1');
    assert.equal(monitor.scope.pageName, 'Empty Page');
});

test('groups posts per post, sorts by latest publish, and paginates', async (t) => {
    t.after(() => mock.restoreAll());
    const range = analyticsRange('2026-10-01', '2026-10-31');
    mockPostFind([
        post({
            _id: 'post-1',
            publishedAt: new Date('2026-10-10T09:00:00.000Z'),
            targets: [
                {
                    platform: 'facebook',
                    status: 'published',
                    externalId: 'external-1',
                    publishedAt: new Date('2026-10-10T09:00:00.000Z'),
                },
                {
                    platform: 'instagram',
                    status: 'published',
                    externalId: 'external-2',
                    publishedAt: new Date('2026-10-11T09:00:00.000Z'),
                },
            ],
        }),
        post({
            _id: 'post-2',
            publishedAt: new Date('2026-10-15T09:00:00.000Z'),
            targets: [
                {
                    platform: 'facebook',
                    status: 'published',
                    externalId: 'external-3',
                    publishedAt: new Date('2026-10-15T09:00:00.000Z'),
                },
            ],
        }),
    ]);
    mockSnapshotFind([]);

    const first = await getAnalyticsPosts('user-1', range, {}, 1, 1);
    assert.equal(first.total, 2);
    assert.equal(first.posts.length, 1);
    assert.equal(first.posts[0]?.postId, 'post-2');
    assert.equal(first.hasMore, true);

    const second = await getAnalyticsPosts('user-1', range, {}, 2, 1);
    assert.equal(second.posts.length, 1);
    assert.equal(second.posts[0]?.postId, 'post-1');
    assert.equal(second.hasMore, false);
});

test('returns the no-posts tip when the range has no posts', () => {
    const tips = buildRuleBasedTips({
        summary: summary(),
        byPlatform: { facebook: summary(), instagram: summary() },
        bestTimes: [],
        activity: [],
        permissionErrors: [],
        posts: [],
    });

    assert.equal(tips.length, 1);
    assert.equal(tips[0]?.id, 'no-posts');
});

test('uses singular grammar for one Page with permission errors', () => {
    const tips = buildRuleBasedTips({
        summary: summary({ posts: 1, facebookPosts: 1 }),
        byPlatform: { facebook: summary({ posts: 1 }), instagram: summary() },
        bestTimes: [],
        activity: [
            {
                date: '2026-10-01',
                label: '1 Oct',
                posts: 1,
                facebook: 1,
                instagram: 0,
                reach: 0,
                interactions: 0,
            },
        ],
        permissionErrors: [{ pageName: 'Page One' }],
        posts: [],
    });

    assert.equal(tips.length, 1);
    assert.equal(tips[0]?.id, 'permissions');
    assert.match(tips[0]?.body || '', /1 Page needs/);
});
