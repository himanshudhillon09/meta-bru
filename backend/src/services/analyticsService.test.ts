import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import type { IAnalyticsMetrics } from '../models/postMetricSnapshotModel.js';
import type { AnalyticsRange } from './analyticsDateService.js';
import type { AnalyticsSummary } from './analyticsService.js';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const {
    latestSnapshotsByTarget,
    summarizeTargets,
    buildActivity,
    buildBestTimes,
    buildMonitorSeries,
    buildPublishedTargetsQuery,
    buildPublishedTargetsPagePipeline,
    buildSnapshotQuery,
    buildLatestSnapshotsPipeline,
    uniquePermissionErrors,
    lastSyncedAt,
    rangePreset,
    loadPublishedTargets,
    loadMonitorSnapshots,
    monitorSeriesTruncated,
    getAnalyticsOverview,
    getAnalyticsMonitor,
    getAnalyticsPosts,
    buildRuleBasedTips,
    buildAnalyticsAiPayload,
} = await import('./analyticsService.js');

const { Post } = await import('../models/postModel.js');
const { PostMetricSnapshot } = await import('../models/postMetricSnapshotModel.js');
const { SocialConnection } = await import('../models/socialConnectionModel.js');

const USER_ID = '64b000000000000000000001';
const CONNECTION_ID = '64b000000000000000000002';
const POST_1 = '64b000000000000000000010';
const POST_2 = '64b000000000000000000011';
const POST_OUTSIDE = '64b000000000000000000012';

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

function aiPayload(
    overrides: Partial<Parameters<typeof buildAnalyticsAiPayload>[0]> = {}
) {
    return buildAnalyticsAiPayload({
        range: analyticsRange('2026-10-01', '2026-10-30'),
        scopeName: 'Page One',
        summary: summary(),
        byPlatform: { facebook: summary(), instagram: summary() },
        activity: [],
        bestTimes: [],
        permissionErrors: [],
        topPosts: [],
        brandProfile: {},
        ...overrides,
    });
}

function mockPostFind(posts: unknown[]) {
    return mock.method(Post, 'find', () => ({
        populate: () => ({ sort: async () => posts }),
    }));
}

function mockPostAggregate(
    handler: (pipeline: Record<string, unknown>[]) => unknown[]
) {
    return mock.method(Post, 'aggregate', (pipeline: Record<string, unknown>[]) =>
        Promise.resolve(handler(pipeline))
    );
}

function mockSnapshotAggregate(snapshots: unknown[]) {
    return mock.method(PostMetricSnapshot, 'aggregate', () =>
        Promise.resolve(snapshots)
    );
}

function mockSnapshotFind(
    snapshots: unknown[],
    captures: Array<{ query: Record<string, unknown>; limit: number }> = []
) {
    return mock.method(
        PostMetricSnapshot,
        'find',
        (query: Record<string, unknown>) => ({
            sort: () => ({
                limit: async (value: number) => {
                    captures.push({ query, limit: value });
                    return snapshots;
                },
            }),
        })
    );
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

test('builds a bounded latest-snapshot aggregation pipeline', () => {
    const from = new Date('2026-10-01T00:00:00.000Z');
    const to = new Date('2026-10-31T23:59:59.999Z');
    const pipeline = buildLatestSnapshotsPipeline(
        USER_ID,
        [target({ postId: POST_1, connectionId: CONNECTION_ID })] as never[],
        { from, to }
    );

    const match = pipeline[0]?.$match as {
        userId: Types.ObjectId;
        postId: { $in: Types.ObjectId[] };
        publishedAt: { $gte: Date; $lte: Date };
    };
    assert.equal(match.userId.toHexString(), USER_ID);
    assert.deepEqual(
        match.postId.$in.map((id) => id.toHexString()),
        [POST_1]
    );
    assert.deepEqual(match.publishedAt, { $gte: from, $lte: to });
    assert.deepEqual(pipeline[1], {
        $sort: { postId: 1, platform: 1, capturedAt: -1 },
    });
    assert.deepEqual(pipeline[2], {
        $group: {
            _id: { postId: '$postId', platform: '$platform' },
            doc: { $first: '$$ROOT' },
        },
    });
    assert.deepEqual(pipeline[3], { $replaceRoot: { newRoot: '$doc' } });
});

test('builds a paginated published-targets pipeline scoped by user', () => {
    const range = analyticsRange('2026-10-01', '2026-10-31');
    const pipeline = buildPublishedTargetsPagePipeline(
        USER_ID,
        range,
        { connectionId: CONNECTION_ID },
        2,
        10
    );

    const match = pipeline[0]?.$match as {
        userId: Types.ObjectId;
        connectionId: Types.ObjectId;
    };
    assert.equal(match.userId.toHexString(), USER_ID);
    assert.equal(match.connectionId.toHexString(), CONNECTION_ID);

    const addFields = pipeline[1]?.$addFields as {
        latestPublishedAt: Record<string, unknown>;
    };
    assert.ok(addFields.latestPublishedAt);
    assert.deepEqual(pipeline[2], { $match: { latestPublishedAt: { $ne: null } } });

    const facet = pipeline[3]?.$facet as {
        metadata: Record<string, unknown>[];
        data: Record<string, unknown>[];
    };
    assert.deepEqual(facet.metadata, [{ $count: 'total' }]);
    assert.deepEqual(facet.data[0], {
        $sort: { latestPublishedAt: -1, _id: -1 },
    });
    assert.deepEqual(facet.data[1], { $skip: 10 });
    assert.deepEqual(facet.data[2], { $limit: 10 });

    const lookup = facet.data[3]?.$lookup as {
        from: string;
        let: { connectionId: string };
        pipeline: Record<string, unknown>[];
    };
    assert.equal(lookup.from, SocialConnection.collection.name);
    const lookupMatch = lookup.pipeline[0]?.$match as {
        $expr: { $and: Array<Record<string, unknown>> };
    };
    const userCondition = lookupMatch.$expr.$and[1] as {
        $eq: [string, Types.ObjectId];
    };
    assert.equal(userCondition.$eq[0], '$userId');
    assert.equal(userCondition.$eq[1].toHexString(), USER_ID);
    assert.deepEqual(lookup.pipeline[1]?.$project, {
        pageName: 1,
        pageId: 1,
        instagram: 1,
        userId: 1,
        tokenUpdatedAt: 1,
        grantedScopes: 1,
    });
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

test('falls back to the raw connection id when the populated connection is missing', async (t) => {
    t.after(() => mock.restoreAll());
    const range = analyticsRange('2026-10-01', '2026-10-31');
    mockPostFind([
        post({
            _id: POST_1,
            connectionId: null,
            populated: (path: string) =>
                path === 'connectionId' ? CONNECTION_ID : undefined,
            publishedAt: new Date('2026-10-05T09:00:00.000Z'),
        }),
    ]);

    const targets = await loadPublishedTargets(USER_ID, range, {});

    assert.equal(targets.length, 1);
    assert.equal(targets[0]?.pageName, 'Connected page');
    assert.equal(targets[0]?.connectionId, CONNECTION_ID);
});

test('ignores a populated connection that belongs to another user', async (t) => {
    t.after(() => mock.restoreAll());
    const range = analyticsRange('2026-10-01', '2026-10-31');
    mockPostFind([
        post({
            _id: POST_1,
            connectionId: {
                _id: CONNECTION_ID,
                userId: '64b000000000000000000009',
                pageName: 'Connected page',
                pageId: 'page-1',
                instagram: { username: 'pageone' },
            },
            populated: (path: string) =>
                path === 'connectionId' ? CONNECTION_ID : undefined,
            publishedAt: new Date('2026-10-05T09:00:00.000Z'),
        }),
    ]);

    const targets = await loadPublishedTargets(USER_ID, range, {});

    assert.equal(targets.length, 1);
    assert.equal(targets[0]?.pageName, 'Connected page');
    assert.equal(targets[0]?.pageId, '');
    assert.equal(targets[0]?.instagramUsername, '');
});

test('builds an overview response with remaining targets from mocked data', async (t) => {
    t.after(() => mock.restoreAll());
    const range = analyticsRange('2026-10-01', '2026-10-30');
    mockPostFind([
        post({
            _id: POST_1,
            publishedAt: new Date('2026-10-05T09:00:00.000Z'),
        }),
        post({
            _id: POST_2,
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
    mockSnapshotAggregate([
        snapshot({
            postId: POST_1,
            platform: 'facebook',
            capturedAt: new Date('2026-10-07T09:00:00.000Z'),
            metrics: metrics({ reach: 100, interactions: 13 }),
        }),
    ]);

    const overview = await getAnalyticsOverview(USER_ID, range, {});

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
            _id: POST_1,
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
    // The summary comes from the latest snapshot per target, which can differ
    // from the newest point in the bounded monitor series.
    mockSnapshotAggregate([
        snapshot({
            postId: POST_1,
            platform: 'facebook',
            status: 'permission_error',
            capturedAt: new Date('2026-10-06T09:00:00.000Z'),
            metrics: metrics({ reach: 250, interactions: 25 }),
        }),
        snapshot({
            postId: POST_1,
            platform: 'instagram',
            status: 'permission_error',
            capturedAt: new Date('2026-10-06T09:00:00.000Z'),
            metrics: metrics({ reach: 250, interactions: 25 }),
        }),
    ]);
    mockSnapshotFind([
        snapshot({
            postId: POST_1,
            platform: 'facebook',
            status: 'permission_error',
            capturedAt: new Date('2026-10-06T09:00:00.000Z'),
            metrics: metrics({ reach: 100, interactions: 10 }),
        }),
        snapshot({
            postId: POST_1,
            platform: 'instagram',
            status: 'permission_error',
            capturedAt: new Date('2026-10-06T09:00:00.000Z'),
            metrics: metrics({ reach: 100, interactions: 10 }),
        }),
        snapshot({
            postId: POST_OUTSIDE,
            platform: 'facebook',
            capturedAt: new Date('2026-10-06T09:05:00.000Z'),
            metrics: metrics({ reach: 999 }),
        }),
    ]);

    const monitor = await getAnalyticsMonitor(USER_ID, range, {
        connectionId: 'connection-1',
    });

    assert.equal(monitor.scope.pageName, 'Page One');
    assert.equal(monitor.sync.permissionErrors.length, 1);
    assert.equal(monitor.sync.permissionErrors[0]?.platform, 'facebook');
    // Summary uses the latest snapshots (250 + 250)...
    assert.equal(monitor.summary.reach, 500);
    // ...while the series is built from the monitor find query (100 + 100) and
    // drops the out-of-scope snapshot that would add 999.
    assert.equal(monitor.series.all.length, 1);
    assert.equal(monitor.series.all[0]?.reach, 200);
    assert.equal(monitor.seriesTruncated, false);
});

test('queries monitor snapshots per target with a bounded limit', async (t) => {
    t.after(() => mock.restoreAll());
    const range = analyticsRange('2026-10-01', '2026-10-31');
    mockPostFind([
        post({
            _id: POST_1,
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
    mockSnapshotAggregate([]);
    const captures: Array<{ query: Record<string, unknown>; limit: number }> = [];
    mockSnapshotFind([], captures);

    await getAnalyticsMonitor(USER_ID, range, {});

    assert.equal(captures.length, 2);
    for (const capture of captures) {
        assert.equal(capture.query.userId, USER_ID);
        assert.equal(capture.query.postId, POST_1);
        assert.ok(
            capture.query.platform === 'facebook' ||
                capture.query.platform === 'instagram'
        );
        const capturedAt = capture.query.capturedAt as { $gte: Date };
        assert.ok(capturedAt.$gte instanceof Date);
        // 50_000 rows split across the two targets.
        assert.equal(capture.limit, 25_000);
    }
});

test('caps monitor history to the most recent 100 targets', async (t) => {
    t.after(() => mock.restoreAll());
    const range = analyticsRange('2026-10-01', '2026-10-31');
    const targets = Array.from({ length: 101 }, (_, index) =>
        target({
            postId: `post-${index}`,
            platform: index % 2 === 0 ? 'facebook' : 'instagram',
            publishedAt: new Date(
                Date.UTC(2026, 9, 1) + index * 86_400_000
            ),
        })
    );
    const captures: Array<{ query: Record<string, unknown>; limit: number }> = [];
    mockSnapshotFind([], captures);

    await loadMonitorSnapshots(USER_ID, targets as never, range);

    assert.equal(captures.length, 100);
    assert.equal(captures[0]?.query.postId, 'post-100');
    assert.equal(captures.some((capture) => capture.query.postId === 'post-0'), false);
    assert.equal(monitorSeriesTruncated(targets as never), true);
    assert.equal(monitorSeriesTruncated(targets.slice(0, 100) as never), false);
    for (const capture of captures) {
        // 50_000 rows split across the 100 capped targets.
        assert.equal(capture.limit, 500);
    }
});

test('resolves the selected Page name when the monitor scope has no targets', async (t) => {
    t.after(() => mock.restoreAll());
    const range = analyticsRange('2026-10-01', '2026-10-31');
    mockPostFind([]);
    mock.method(SocialConnection, 'findOne', () => ({ pageName: 'Empty Page' }));

    const monitor = await getAnalyticsMonitor(USER_ID, range, {
        connectionId: 'connection-1',
    });

    assert.equal(monitor.scope.connectionId, 'connection-1');
    assert.equal(monitor.scope.pageName, 'Empty Page');
});

test('groups posts per post, sorts by latest publish, and paginates', async (t) => {
    t.after(() => mock.restoreAll());
    const range = analyticsRange('2026-10-01', '2026-10-31');
    const connection = {
        _id: CONNECTION_ID,
        pageName: 'Page One',
        pageId: 'page-1',
        instagram: { username: 'pageone' },
    };
    const postOne = post({
        _id: POST_1,
        connection,
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
    });
    const postTwo = post({
        _id: POST_2,
        connection,
        publishedAt: new Date('2026-10-15T09:00:00.000Z'),
        targets: [
            {
                platform: 'facebook',
                status: 'published',
                externalId: 'external-3',
                publishedAt: new Date('2026-10-15T09:00:00.000Z'),
            },
        ],
    });

    mockPostAggregate((pipeline) => {
        // Mirror the $skip stage so the mock only returns the requested window;
        // getAnalyticsPosts maps the rows straight through without slicing.
        const facet = (pipeline[3] as {
            $facet: { data: Record<string, unknown>[] };
        }).$facet;
        const skip = (facet.data[1] as { $skip: number }).$skip;
        return [{ metadata: [{ total: 2 }], data: skip === 0 ? [postTwo] : [postOne] }];
    });
    mockSnapshotAggregate([]);

    const first = await getAnalyticsPosts(USER_ID, range, {}, 1, 1);
    assert.equal(first.total, 2);
    assert.equal(first.page, 1);
    assert.equal(first.limit, 1);
    assert.equal(first.posts.length, 1);
    assert.equal(first.posts[0]?.postId, POST_2);
    assert.equal(first.posts[0]?.targets.length, 1);
    assert.equal(first.hasMore, true);

    const second = await getAnalyticsPosts(USER_ID, range, {}, 2, 1);
    assert.equal(second.total, 2);
    assert.equal(second.page, 2);
    assert.equal(second.posts.length, 1);
    assert.equal(second.posts[0]?.postId, POST_1);
    // The page loader already paginated, so both platforms on post 1 are kept.
    assert.equal(second.posts[0]?.targets.length, 2);
    assert.equal(second.hasMore, false);
});

test('clamps the requested page and limit to safe bounds', async (t) => {
    t.after(() => mock.restoreAll());
    const range = analyticsRange('2026-10-01', '2026-10-31');
    let capturedPipeline: Record<string, unknown>[] = [];
    mockPostAggregate((pipeline) => {
        capturedPipeline = pipeline;
        return [{ metadata: [{ total: 0 }], data: [] }];
    });
    mockSnapshotAggregate([]);

    const defaults = await getAnalyticsPosts(USER_ID, range, {}, 0, 0);
    assert.equal(defaults.page, 1);
    assert.equal(defaults.limit, 25);

    const huge = await getAnalyticsPosts(USER_ID, range, {}, 999_999, 10);
    assert.equal(huge.page, 10_000);
    const facet = capturedPipeline[3]?.$facet as {
        data: Record<string, unknown>[];
    };
    assert.deepEqual(facet.data[1], { $skip: (10_000 - 1) * 10 });
});

test('returns the no-posts tip when the range has no posts', () => {
    const tips = buildRuleBasedTips({
        summary: summary(),
        byPlatform: { facebook: summary(), instagram: summary() },
        bestTimes: [],
        activity: [],
        permissionErrors: [],
        posts: [],
        granularity: 'day',
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
        granularity: 'day',
    });

    assert.equal(tips.length, 1);
    assert.equal(tips[0]?.id, 'permissions');
    assert.match(tips[0]?.body || '', /1 Page needs/);
});

test('skips null metrics in the monitor series instead of throwing', () => {
    const series = buildMonitorSeries([snapshot({ metrics: null })] as never[]);

    assert.equal(series.all.length, 1);
    assert.equal(series.all[0]?.reach, 0);
    assert.equal(series.all[0]?.engagementRate, null);
});

test('treats partial metrics as an unknown rate in summaries', () => {
    const latest = new Map([
        ['post-1:facebook', { metrics: { reach: 100 } as never }],
    ]);

    const result = summarizeTargets([target()] as never[], latest as never);

    assert.equal(result.reach, 100);
    assert.equal(result.engagementRate, null);
});

test('treats partial metrics as an unknown rate in the monitor series', () => {
    const series = buildMonitorSeries([
        snapshot({ metrics: { reach: 100 } as never }),
    ] as never[]);

    assert.equal(series.all[0]?.reach, 100);
    assert.equal(series.all[0]?.engagementRate, null);
});

test('treats non-finite and non-numeric metric values as zero', () => {
    const malformed = (reach: unknown) =>
        ({
            likes: NaN,
            comments: '5',
            shares: Infinity,
            saves: NaN,
            reach,
            views: Infinity,
            clicks: '7',
            interactions: NaN,
            engagementRate: '13',
        }) as never;

    const targets = [
        target({ postId: 'post-1' }),
        target({ postId: 'post-2' }),
        target({ postId: 'post-3' }),
    ] as never[];
    const latest = new Map([
        ['post-1:facebook', { metrics: malformed(NaN) }],
        ['post-2:facebook', { metrics: malformed(Infinity) }],
        ['post-3:facebook', { metrics: malformed('100') }],
    ]) as never;

    const result = summarizeTargets(targets, latest);
    assert.equal(result.reach, 0);
    assert.equal(result.views, 0);
    assert.equal(result.interactions, 0);
    assert.equal(result.likes, 0);
    assert.equal(result.comments, 0);
    assert.equal(result.shares, 0);
    assert.equal(result.saves, 0);
    assert.equal(result.clicks, 0);
    assert.equal(result.engagementRate, null);

    const activity = buildActivity(targets, latest, {
        fromKey: '2026-10-24',
        toKey: '2026-10-24',
        granularity: 'day' as const,
    });
    assert.equal(activity[0]?.reach, 0);
    assert.equal(activity[0]?.interactions, 0);

    const series = buildMonitorSeries([
        snapshot({ postId: 'post-1', metrics: malformed(NaN) }),
        snapshot({ postId: 'post-2', metrics: malformed(Infinity) }),
        snapshot({ postId: 'post-3', metrics: malformed('100') }),
    ] as never[]);
    assert.equal(series.all[0]?.reach, 0);
    assert.equal(series.all[0]?.views, 0);
    assert.equal(series.all[0]?.interactions, 0);
    assert.equal(series.all[0]?.engagementRate, null);
});

test('reports a weekly posting gap in weeks rather than days', () => {
    const bucket = (date: string, posts: number) => ({
        date,
        label: date,
        posts,
        facebook: posts,
        instagram: 0,
        reach: 0,
        interactions: 0,
    });

    const tips = buildRuleBasedTips({
        summary: summary({ posts: 2, facebookPosts: 2 }),
        byPlatform: { facebook: summary({ posts: 2 }), instagram: summary() },
        bestTimes: [],
        activity: [bucket('2026-01-05', 1), bucket('2026-01-19', 1)],
        permissionErrors: [],
        posts: [],
        granularity: 'week',
    });

    const gap = tips.find((tip) => tip.id === 'gap');
    assert.ok(gap);
    assert.match(gap.body, /7 days/);
});

test('deduplicates the permission tip by Page name', () => {
    const tips = buildRuleBasedTips({
        summary: summary({ posts: 1, facebookPosts: 1 }),
        byPlatform: { facebook: summary({ posts: 1 }), instagram: summary() },
        bestTimes: [],
        activity: [],
        permissionErrors: [{ pageName: 'Page One' }, { pageName: 'Page One' }],
        posts: [],
        granularity: 'day',
    });

    const permissions = tips.find((tip) => tip.id === 'permissions');
    assert.ok(permissions);
    assert.match(permissions.body, /^1 Page needs/);
});

test('deduplicates cross-posted entries in the AI payload top posts', () => {
    const payload = buildAnalyticsAiPayload({
        range: analyticsRange('2026-10-01', '2026-10-30'),
        scopeName: 'Page One',
        summary: summary({ posts: 1 }),
        byPlatform: { facebook: summary(), instagram: summary() },
        activity: [],
        bestTimes: [],
        permissionErrors: [],
        topPosts: [
            {
                postId: POST_1,
                caption: 'Cross post',
                reach: 100,
                views: null,
                interactions: 10,
            },
            {
                postId: POST_1,
                caption: 'Cross post',
                reach: 300,
                views: null,
                interactions: 30,
            },
        ],
        brandProfile: {},
    });

    assert.equal(payload.topPosts.length, 1);
    assert.equal(payload.topPosts[0]?.reach, 400);
    assert.equal(payload.topPosts[0]?.interactions, 40);
    assert.equal(payload.topPosts[0]?.engagementRate, 10);
    assert.equal(payload.topEngagementPosts.length, 1);
});

test('keeps unknown AI interactions out of the engagement ranking', () => {
    const payload = aiPayload({
        topPosts: [
            {
                postId: POST_1,
                caption: 'Unknown interactions',
                reach: 100,
                views: null,
                interactions: null,
            },
        ],
    });

    assert.equal(payload.topPosts[0]?.engagementRate, null);
    assert.equal(payload.topEngagementPosts.length, 0);
});

test('keeps non-finite AI interactions out of the engagement ranking', () => {
    for (const interactions of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const payload = aiPayload({
            topPosts: [
                {
                    postId: POST_1,
                    caption: 'Non-finite interactions',
                    reach: 100,
                    views: null,
                    interactions,
                },
            ],
        });

        assert.equal(payload.topPosts[0]?.engagementRate, null);
        assert.equal(payload.topEngagementPosts.length, 0);
    }
});

test('uses views as the AI top-post denominator when reach is zero', () => {
    const payload = aiPayload({
        topPosts: [
            {
                postId: POST_1,
                caption: 'View-only reel',
                reach: 0,
                views: 1000,
                interactions: 10,
            },
        ],
    });

    assert.equal(payload.topPosts[0]?.engagementRate, 1);
    assert.equal(payload.topEngagementPosts.length, 1);
    assert.equal(payload.topEngagementPosts[0]?.engagementRate, 1);
});

test('combines reach and view denominators across a cross-posted AI post', () => {
    const payload = aiPayload({
        topPosts: [
            {
                postId: POST_1,
                caption: 'Cross post',
                reach: 100,
                views: null,
                interactions: 10,
            },
            {
                postId: POST_1,
                caption: 'Cross post',
                reach: 0,
                views: 1000,
                interactions: 10,
            },
        ],
    });

    assert.equal(payload.topPosts.length, 1);
    assert.equal(payload.topPosts[0]?.reach, 100);
    assert.equal(payload.topPosts[0]?.interactions, 20);
    // 20 interactions over 100 reach + 1000 views = 1.8%.
    assert.equal(payload.topPosts[0]?.engagementRate, 1.8);
});

test('keeps AI top posts with identical captions when the post ids differ', () => {
    const payload = aiPayload({
        topPosts: [
            {
                postId: POST_1,
                caption: 'Same caption',
                reach: 100,
                views: null,
                interactions: 10,
            },
            {
                postId: POST_2,
                caption: 'Same caption',
                reach: 100,
                views: null,
                interactions: 20,
            },
        ],
    });

    assert.equal(payload.topPosts.length, 2);
});

test('deduplicates AI permission errors by Page name', () => {
    const payload = aiPayload({
        permissionErrors: [
            { pageName: 'Page One' },
            { pageName: 'Page One' },
            { pageName: 'Page Two' },
        ],
    });

    assert.deepEqual(payload.permissionErrors, [
        { pageName: 'Page One' },
        { pageName: 'Page Two' },
    ]);
});

test('uses the unique post count for publishing frequency', () => {
    const payload = buildAnalyticsAiPayload({
        range: analyticsRange('2026-10-01', '2026-10-30'),
        scopeName: 'Page One',
        summary: summary({ posts: 1 }),
        byPlatform: { facebook: summary(), instagram: summary() },
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
            {
                date: '2026-10-02',
                label: '2 Oct',
                posts: 1,
                facebook: 0,
                instagram: 1,
                reach: 0,
                interactions: 0,
            },
        ],
        bestTimes: [],
        permissionErrors: [],
        topPosts: [],
        brandProfile: {},
    });

    assert.deepEqual(payload.publishingFrequency, {
        posts: 1,
        activeBuckets: 2,
        buckets: 2,
        postsPerBucket: 0.5,
        postsPerActiveBucket: 0.5,
    });
});

test('ignores permission errors recorded before the Page was reconnected', () => {
    const targets = [
        target({ tokenUpdatedAt: new Date('2026-10-24T10:00:00.000Z') }),
    ] as never[];
    const latest = new Map([
        [
            'post-1:facebook',
            snapshot({
                status: 'permission_error',
                capturedAt: new Date('2026-10-24T09:00:00.000Z'),
            }),
        ],
    ]) as never;

    assert.deepEqual(uniquePermissionErrors(targets, latest), []);
});

test('only asks for a reconnect when reconnecting can fix the permission error', () => {
    const errorSnapshot = (platform: string) =>
        snapshot({
            platform,
            status: 'permission_error',
            error: '(#10) Application does not have permission for this action',
            capturedAt: new Date('2026-10-24T11:00:00.000Z'),
        });
    const allScopes = [
        'pages_read_engagement',
        'read_insights',
        'instagram_basic',
        'instagram_manage_insights',
    ];
    const reconnectedAt = new Date('2026-10-24T10:00:00.000Z');

    const never = uniquePermissionErrors(
        [target()] as never[],
        new Map([['post-1:facebook', errorSnapshot('facebook')]]) as never
    );
    assert.equal(never[0]?.reconnectRequired, true);

    const missing = uniquePermissionErrors(
        [
            target({
                tokenUpdatedAt: reconnectedAt,
                grantedScopes: ['pages_read_engagement'],
            }),
        ] as never[],
        new Map([['post-1:facebook', errorSnapshot('facebook')]]) as never
    );
    assert.equal(missing[0]?.reconnectRequired, true);
    assert.deepEqual(missing[0]?.missingScopes, ['read_insights']);

    const blocked = uniquePermissionErrors(
        [
            target({ tokenUpdatedAt: reconnectedAt, grantedScopes: allScopes }),
            target({
                platform: 'instagram',
                tokenUpdatedAt: reconnectedAt,
                grantedScopes: allScopes,
            }),
        ] as never[],
        new Map([
            ['post-1:facebook', errorSnapshot('facebook')],
            ['post-1:instagram', errorSnapshot('instagram')],
        ]) as never
    );
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0]?.reconnectRequired, false);
    assert.deepEqual(blocked[0]?.platforms, ['facebook', 'instagram']);
    assert.equal(
        blocked[0]?.error,
        '(#10) Application does not have permission for this action'
    );
});

test('marks outdated permission errors on posts as waiting for a sync', async (t) => {
    t.after(() => mock.restoreAll());
    const range = analyticsRange('2026-10-01', '2026-10-31');
    const reconnectedAt = new Date('2026-10-12T09:00:00.000Z');
    const connection = {
        _id: CONNECTION_ID,
        pageName: 'Page One',
        pageId: 'page-1',
        instagram: { username: 'pageone' },
        tokenUpdatedAt: reconnectedAt,
        grantedScopes: [],
    };
    mockPostAggregate(() => [
        {
            metadata: [{ total: 1 }],
            data: [
                post({
                    _id: POST_1,
                    connection,
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
                            publishedAt: new Date('2026-10-10T09:00:00.000Z'),
                        },
                    ],
                }),
            ],
        },
    ]);
    mockSnapshotAggregate([
        snapshot({
            postId: POST_1,
            platform: 'facebook',
            status: 'permission_error',
            error: '(#10) old token',
            capturedAt: new Date('2026-10-11T09:00:00.000Z'),
        }),
        snapshot({
            postId: POST_1,
            platform: 'instagram',
            status: 'permission_error',
            error: '(#10) still blocked',
            capturedAt: new Date('2026-10-13T09:00:00.000Z'),
            metricsCapturedAt: new Date('2026-10-09T09:00:00.000Z'),
        }),
    ]);

    const result = await getAnalyticsPosts(USER_ID, range, {}, 1, 25);
    const [facebook, instagram] = result.posts[0]?.targets ?? [];
    assert.equal(facebook?.status, 'unavailable');
    assert.match(facebook?.error || '', /reconnected/i);
    assert.equal(facebook?.reconnectRequired, false);
    assert.equal(facebook?.metricsAt, '2026-10-11T09:00:00.000Z');

    assert.equal(instagram?.status, 'permission_error');
    assert.equal(instagram?.error, '(#10) still blocked');
    // Reconnected with unknown scopes: reconnecting again will not help.
    assert.equal(instagram?.reconnectRequired, false);
    assert.equal(instagram?.metricsAt, '2026-10-09T09:00:00.000Z');
});

test('separates reconnect tips from permission errors a reconnect cannot fix', () => {
    const base = {
        summary: summary({ posts: 1, facebookPosts: 1 }),
        byPlatform: { facebook: summary({ posts: 1 }), instagram: summary() },
        bestTimes: [],
        activity: [],
        posts: [],
        granularity: 'day' as const,
    };

    const blocked = buildRuleBasedTips({
        ...base,
        permissionErrors: [{ pageName: 'Page One', reconnectRequired: false }],
    });
    assert.equal(blocked[0]?.id, 'permissions');
    assert.equal(blocked[0]?.title, 'Meta is still blocking insights');

    const reconnect = buildRuleBasedTips({
        ...base,
        permissionErrors: [
            { pageName: 'Page One', reconnectRequired: false },
            { pageName: 'Page Two', reconnectRequired: true },
        ],
    });
    assert.equal(reconnect[0]?.title, 'Reconnect to unlock reach data');
    assert.match(reconnect[0]?.body || '', /1 Page needs/);
});

test('uses the reel cover as the media preview', async (t) => {
    t.after(() => mock.restoreAll());
    const range = analyticsRange('2026-10-01', '2026-10-31');
    mockPostFind([
        post({
            _id: POST_1,
            mediaType: 'reel',
            mediaUrl: 'https://res.cloudinary.com/demo/video/upload/reel.mp4',
            mediaCoverUrl: 'https://res.cloudinary.com/demo/video/upload/so_1/reel.jpg',
            publishedAt: new Date('2026-10-05T09:00:00.000Z'),
        }),
    ]);

    const targets = await loadPublishedTargets(USER_ID, range, {});

    assert.ok(targets.length > 0);
    assert.equal(
        targets[0]?.mediaUrl,
        'https://res.cloudinary.com/demo/video/upload/so_1/reel.jpg'
    );
});
