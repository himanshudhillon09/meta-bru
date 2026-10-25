import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import type { AnalyticsRange } from './analyticsDateService.js';
import type { PublishedTarget } from './analyticsService.js';
import type { IAnalyticsMetrics } from '../models/postMetricSnapshotModel.js';
import type { NormalizedInsightMetrics } from './metaInsightsService.js';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { selectStaleTargets, syncCapForMode, syncAnalytics } = await import(
    './analyticsSyncService.js'
);
const { Post } = await import('../models/postModel.js');
const { PostMetricSnapshot } = await import(
    '../models/postMetricSnapshotModel.js'
);
const { SocialConnection } = await import('../models/socialConnectionModel.js');
const { MetaApiError } = await import('./metaService.js');
const { encryptSecret } = await import('./cryptoService.js');

const USER_ID = '64b000000000000000000001';
const CONNECTION_ID = '64b000000000000000000002';
const OTHER_CONNECTION_ID = '64b000000000000000000003';
const POST_ID = '64b000000000000000000010';
const EXISTING_SNAPSHOT_ID = '64b000000000000000000020';
const PUBLISHED_AT = new Date('2026-10-20T09:00:00.000Z');
const FIXED_NOW = new Date('2026-10-24T12:00:00.000Z');

function objectId(index: number): string {
    return `64b${index.toString(16).padStart(21, '0')}`;
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

function metrics(overrides: Partial<IAnalyticsMetrics> = {}): IAnalyticsMetrics {
    return {
        likes: 5,
        comments: 1,
        shares: 0,
        saves: 0,
        reach: 100,
        views: 120,
        clicks: 0,
        interactions: 6,
        engagementRate: 6,
        ...overrides,
    };
}

function insight(
    overrides: Partial<NormalizedInsightMetrics> = {}
): NormalizedInsightMetrics {
    return {
        metrics: metrics(),
        availableMetrics: ['likes', 'comments', 'reach', 'views'],
        status: 'ok',
        error: '',
        ...overrides,
    };
}

function staleTarget(
    postId: string,
    publishedAt: string,
    overrides: Partial<PublishedTarget> = {}
): PublishedTarget {
    return {
        postId,
        connectionId: 'connection-1',
        pageId: 'page-1',
        pageName: 'Page One',
        platform: 'facebook',
        externalId: 'external-1',
        publishedAt: new Date(publishedAt),
        caption: '',
        mediaUrl: '',
        postStatus: 'published',
        instagramUsername: '',
        ...overrides,
    };
}

function populatedConnection(overrides: Record<string, unknown> = {}) {
    return {
        _id: CONNECTION_ID,
        userId: USER_ID,
        pageName: 'Page One',
        pageId: 'page-1',
        instagram: { username: 'pageone' },
        ...overrides,
    };
}

function targetPost(overrides: Record<string, unknown> = {}) {
    return {
        _id: POST_ID,
        connectionId: populatedConnection(),
        caption: 'A caption',
        mediaUrl: '',
        status: 'published',
        publishedAt: PUBLISHED_AT,
        targets: [
            {
                platform: 'facebook',
                status: 'published',
                externalId: 'fb-1',
                publishedAt: PUBLISHED_AT,
            },
            {
                platform: 'instagram',
                status: 'published',
                externalId: 'ig-1',
                publishedAt: PUBLISHED_AT,
            },
        ],
        ...overrides,
    };
}

function facebookOnlyPost(overrides: Record<string, unknown> = {}) {
    return targetPost({
        targets: [
            {
                platform: 'facebook',
                status: 'published',
                externalId: 'fb-1',
                publishedAt: PUBLISHED_AT,
            },
        ],
        ...overrides,
    });
}

function connection(overrides: Record<string, unknown> = {}) {
    return {
        _id: CONNECTION_ID,
        userId: USER_ID,
        pageId: 'page-1',
        pageName: 'Page One',
        pageAccessTokenEnc: encryptSecret('page-token'),
        tokenStatus: 'active',
        ...overrides,
    };
}

function mockTargets(posts: unknown[]) {
    return mock.method(Post, 'find', () => ({
        populate: () => ({ sort: async () => posts }),
    }));
}

function mockLatestSnapshots(snapshots: unknown[]) {
    return mock.method(PostMetricSnapshot, 'aggregate', () =>
        Promise.resolve(snapshots)
    );
}

function mockConnections(connections: unknown[]) {
    return mock.method(SocialConnection, 'find', () => ({
        select: async () => connections,
    }));
}

function mockSnapshotWrites(existing: unknown = null) {
    const captured = {
        findOne: [] as Array<Record<string, unknown>>,
        create: [] as Array<Record<string, unknown>>,
        updateOne: [] as Array<{
            query: Record<string, unknown>;
            update: Record<string, unknown>;
        }>,
    };

    mock.method(
        PostMetricSnapshot,
        'findOne',
        (query: Record<string, unknown>) => {
            captured.findOne.push(query);
            return Promise.resolve(existing);
        }
    );
    mock.method(
        PostMetricSnapshot,
        'create',
        (data: Record<string, unknown>) => {
            captured.create.push(data);
            return Promise.resolve(data);
        }
    );
    mock.method(
        PostMetricSnapshot,
        'updateOne',
        (
            query: Record<string, unknown>,
            update: Record<string, unknown>
        ) => {
            captured.updateOne.push({ query, update });
            return Promise.resolve({});
        }
    );

    return captured;
}

function mockConnectionUpdates() {
    const updates: Array<{
        query: Record<string, unknown>;
        update: Record<string, unknown>;
    }> = [];

    mock.method(
        SocialConnection,
        'updateOne',
        (
            query: Record<string, unknown>,
            update: Record<string, unknown>
        ) => {
            updates.push({ query, update });
            return Promise.resolve({ matchedCount: 1 });
        }
    );

    return updates;
}

test('selects newest stale targets first', () => {
    const targets = [
        staleTarget('old', '2026-10-01T09:00:00.000Z'),
        staleTarget('new', '2026-10-24T09:00:00.000Z'),
        staleTarget('mid', '2026-10-10T09:00:00.000Z'),
    ];

    const selected = selectStaleTargets(
        targets,
        new Map(),
        'stale',
        new Date('2026-10-24T12:00:00.000Z')
    );

    assert.deepEqual(
        selected.map((target) => target.postId),
        ['new', 'mid', 'old']
    );
});

test('applies the stale and live age thresholds', () => {
    const now = new Date('2026-10-24T12:00:00.000Z');
    const targets = [
        staleTarget('post-4', '2026-10-24T11:56:00.000Z'),
        staleTarget('post-10', '2026-10-24T11:50:00.000Z'),
        staleTarget('post-20', '2026-10-24T11:40:00.000Z'),
        staleTarget('post-none', '2026-10-24T11:00:00.000Z'),
    ];
    const latest = new Map([
        ['post-4:facebook', { capturedAt: new Date(now.getTime() - 4 * 60_000) }],
        ['post-10:facebook', { capturedAt: new Date(now.getTime() - 10 * 60_000) }],
        ['post-20:facebook', { capturedAt: new Date(now.getTime() - 20 * 60_000) }],
    ]);

    // Stale uses 15 minutes: the 10-minute snapshot is still fresh, the
    // 20-minute snapshot and the missing snapshot are stale.
    assert.deepEqual(
        selectStaleTargets(targets, latest, 'stale', now).map(
            (target) => target.postId
        ),
        ['post-20', 'post-none']
    );

    // Live uses 5 minutes: the 10-minute snapshot is stale too.
    assert.deepEqual(
        selectStaleTargets(targets, latest, 'live', now).map(
            (target) => target.postId
        ),
        ['post-10', 'post-20', 'post-none']
    );
});

test('uses 20 targets for stale sync and 10 for live sync', () => {
    assert.equal(syncCapForMode('stale'), 20);
    assert.equal(syncCapForMode('live'), 10);
});

test('syncs targets, writes snapshots, and decrypts once per connection', async (t) => {
    t.after(() => mock.restoreAll());

    let tokenReads = 0;
    const pageConnection = connection();
    const encryptedToken = encryptSecret('page-token');
    Object.defineProperty(pageConnection, 'pageAccessTokenEnc', {
        enumerable: true,
        get() {
            tokenReads += 1;
            return encryptedToken;
        },
    });

    mockTargets([targetPost()]);
    mockLatestSnapshots([]);
    mockConnections([pageConnection]);
    const writes = mockSnapshotWrites(null);
    const connectionUpdates = mockConnectionUpdates();

    const facebookCalls: Array<[string, string]> = [];
    const instagramCalls: Array<[string, string]> = [];
    const fetchFacebook = async (postId: string, token: string) => {
        facebookCalls.push([postId, token]);
        return insight();
    };
    const fetchInstagram = async (postId: string, token: string) => {
        instagramCalls.push([postId, token]);
        return insight({ status: 'partial' });
    };

    const result = await syncAnalytics(
        USER_ID,
        analyticsRange('2026-10-01', '2026-10-31'),
        {},
        'stale',
        { fetchFacebook, fetchInstagram, now: () => FIXED_NOW }
    );

    assert.deepEqual(result, {
        synced: 2,
        failed: 0,
        skipped: 0,
        remaining: 0,
        permissionErrors: [],
        lastSyncedAt: FIXED_NOW.toISOString(),
    });

    // One Page token decrypted once even though two targets share the Page.
    assert.equal(tokenReads, 1);
    assert.deepEqual(facebookCalls, [['fb-1', 'page-token']]);
    assert.deepEqual(instagramCalls, [['ig-1', 'page-token']]);
    assert.equal(connectionUpdates.length, 0);
    assert.equal(writes.create.length, 2);
    assert.equal(writes.updateOne.length, 0);

    const facebookWrite = writes.create.find(
        (data) => data.platform === 'facebook'
    );
    assert.ok(facebookWrite);
    assert.equal(facebookWrite.userId, USER_ID);
    assert.equal(facebookWrite.connectionId, CONNECTION_ID);
    assert.equal(facebookWrite.postId, POST_ID);
    assert.equal(facebookWrite.pageId, 'page-1');
    assert.equal(facebookWrite.pageName, 'Page One');
    assert.equal(facebookWrite.externalId, 'fb-1');
    assert.deepEqual(facebookWrite.publishedAt, PUBLISHED_AT);
    assert.deepEqual(facebookWrite.capturedAt, FIXED_NOW);
    assert.equal(facebookWrite.status, 'ok');
    assert.deepEqual(facebookWrite.metrics, insight().metrics);
    assert.deepEqual(facebookWrite.availableMetrics, insight().availableMetrics);
    assert.equal(facebookWrite.error, '');

    const instagramWrite = writes.create.find(
        (data) => data.platform === 'instagram'
    );
    assert.ok(instagramWrite);
    assert.equal(instagramWrite.externalId, 'ig-1');
    assert.equal(instagramWrite.status, 'partial');
});

test('stores permission_error snapshots and reports one error per Page', async (t) => {
    t.after(() => mock.restoreAll());

    mockTargets([targetPost()]);
    mockLatestSnapshots([]);
    mockConnections([connection()]);
    const writes = mockSnapshotWrites(null);
    const connectionUpdates = mockConnectionUpdates();

    const fetchFacebook = async () => insight({ status: 'permission_error' });
    const fetchInstagram = async () => insight({ status: 'permission_error' });

    const result = await syncAnalytics(
        USER_ID,
        analyticsRange('2026-10-01', '2026-10-31'),
        {},
        'stale',
        { fetchFacebook, fetchInstagram, now: () => FIXED_NOW }
    );

    assert.equal(result.synced, 2);
    assert.equal(result.failed, 0);
    assert.equal(result.permissionErrors.length, 1);
    assert.equal(result.permissionErrors[0]?.connectionId, CONNECTION_ID);
    assert.equal(result.permissionErrors[0]?.pageName, 'Page One');
    assert.ok(
        ['facebook', 'instagram'].includes(
            String(result.permissionErrors[0]?.platform)
        )
    );
    assert.equal(connectionUpdates.length, 0);
    assert.equal(writes.create.length, 2);
    assert.deepEqual(
        writes.create.map((data) => data.status),
        ['permission_error', 'permission_error']
    );
});

test('skips targets without an external id or an owned connection', async (t) => {
    t.after(() => mock.restoreAll());

    const noExternalId = targetPost({
        _id: objectId(11),
        targets: [
            {
                platform: 'facebook',
                status: 'published',
                externalId: '',
                publishedAt: PUBLISHED_AT,
            },
        ],
    });
    const noConnection = targetPost({
        _id: objectId(12),
        connectionId: populatedConnection({
            _id: OTHER_CONNECTION_ID,
            pageName: 'Other Page',
            pageId: 'page-2',
        }),
        targets: [
            {
                platform: 'facebook',
                status: 'published',
                externalId: 'fb-2',
                publishedAt: PUBLISHED_AT,
            },
        ],
    });

    mockTargets([noExternalId, noConnection]);
    mockLatestSnapshots([]);
    mockConnections([connection()]);
    const writes = mockSnapshotWrites(null);

    let fetches = 0;
    const fetchFacebook = async () => {
        fetches += 1;
        return insight();
    };

    const result = await syncAnalytics(
        USER_ID,
        analyticsRange('2026-10-01', '2026-10-31'),
        {},
        'stale',
        { fetchFacebook, now: () => FIXED_NOW }
    );

    assert.equal(result.synced, 0);
    assert.equal(result.failed, 0);
    assert.equal(result.skipped, 2);
    assert.equal(result.remaining, 0);
    assert.equal(fetches, 0);
    assert.equal(writes.create.length, 0);
});

test('marks the connection needs_reauth when the stored token cannot be decrypted', async (t) => {
    t.after(() => mock.restoreAll());

    mockTargets([facebookOnlyPost()]);
    mockLatestSnapshots([]);
    mockConnections([
        connection({ pageAccessTokenEnc: 'not-a-valid-encrypted-token' }),
    ]);
    mockSnapshotWrites(null);
    const connectionUpdates = mockConnectionUpdates();

    let fetches = 0;
    const fetchFacebook = async () => {
        fetches += 1;
        return insight();
    };

    const result = await syncAnalytics(
        USER_ID,
        analyticsRange('2026-10-01', '2026-10-31'),
        {},
        'stale',
        { fetchFacebook, now: () => FIXED_NOW }
    );

    assert.equal(result.synced, 0);
    assert.equal(result.failed, 1);
    assert.equal(result.skipped, 0);
    assert.equal(fetches, 0);
    assert.equal(connectionUpdates.length, 1);

    const update = connectionUpdates[0];
    assert.ok(update);
    assert.equal(update.query._id, CONNECTION_ID);
    assert.equal(update.query.userId, USER_ID);
    assert.equal(
        (update.update.$set as Record<string, unknown>).tokenStatus,
        'needs_reauth'
    );
    const lastError = String(
        (update.update.$set as Record<string, unknown>).lastError
    );
    assert.match(lastError, /reconnect/i);
    assert.ok(!lastError.includes('not-a-valid-encrypted-token'));
});

test('marks the connection needs_reauth on a Meta token error', async (t) => {
    t.after(() => mock.restoreAll());

    mockTargets([facebookOnlyPost()]);
    mockLatestSnapshots([]);
    mockConnections([connection()]);
    mockSnapshotWrites(null);
    const connectionUpdates = mockConnectionUpdates();

    const fetchFacebook = async () => {
        throw new MetaApiError(
            'Invalid OAuth access token: EAABsecret-token-value',
            400,
            190,
            0,
            true
        );
    };

    const result = await syncAnalytics(
        USER_ID,
        analyticsRange('2026-10-01', '2026-10-31'),
        {},
        'stale',
        { fetchFacebook, now: () => FIXED_NOW }
    );

    assert.equal(result.synced, 0);
    assert.equal(result.failed, 1);
    assert.equal(result.skipped, 0);
    assert.equal(connectionUpdates.length, 1);

    const update = connectionUpdates[0];
    assert.ok(update);
    assert.equal(
        (update.update.$set as Record<string, unknown>).tokenStatus,
        'needs_reauth'
    );
    const lastError = String(
        (update.update.$set as Record<string, unknown>).lastError
    );
    assert.match(lastError, /reconnect/i);
    assert.ok(!lastError.includes('EAABsecret-token-value'));
});

test('dedupes snapshots within one minute using the owning user', async (t) => {
    t.after(() => mock.restoreAll());

    const existing = {
        _id: EXISTING_SNAPSHOT_ID,
        userId: USER_ID,
        postId: POST_ID,
        platform: 'facebook',
        capturedAt: new Date(FIXED_NOW.getTime() - 30_000),
    };

    mockTargets([facebookOnlyPost()]);
    mockLatestSnapshots([]);
    mockConnections([connection()]);
    const writes = mockSnapshotWrites(existing);

    const result = await syncAnalytics(
        USER_ID,
        analyticsRange('2026-10-01', '2026-10-31'),
        {},
        'stale',
        { fetchFacebook: async () => insight(), now: () => FIXED_NOW }
    );

    assert.equal(result.synced, 1);
    assert.equal(writes.findOne.length, 1);
    assert.deepEqual(writes.findOne[0], {
        userId: USER_ID,
        postId: POST_ID,
        platform: 'facebook',
        capturedAt: { $gte: new Date(FIXED_NOW.getTime() - 60_000) },
    });

    assert.equal(writes.create.length, 0);
    assert.equal(writes.updateOne.length, 1);
    const update = writes.updateOne[0];
    assert.ok(update);
    assert.deepEqual(update.query, {
        _id: EXISTING_SNAPSHOT_ID,
        userId: USER_ID,
    });
    const set = update.update.$set as Record<string, unknown>;
    assert.equal(set.userId, USER_ID);
    assert.equal(set.postId, POST_ID);
    assert.equal(set.platform, 'facebook');
    assert.deepEqual(set.capturedAt, FIXED_NOW);
    assert.deepEqual(set.metrics, insight().metrics);
});

test('reports remaining targets when more are stale than the mode cap', async (t) => {
    t.after(() => mock.restoreAll());

    const posts = Array.from({ length: 12 }, (_, index) =>
        targetPost({
            _id: objectId(index + 1),
            publishedAt: new Date(Date.UTC(2026, 9, index + 1, 9)),
            targets: [
                {
                    platform: 'facebook',
                    status: 'published',
                    externalId: `fb-${index}`,
                    publishedAt: new Date(Date.UTC(2026, 9, index + 1, 9)),
                },
            ],
        })
    );

    mockTargets(posts);
    mockLatestSnapshots([]);
    mockConnections([connection()]);
    const writes = mockSnapshotWrites(null);

    const result = await syncAnalytics(
        USER_ID,
        analyticsRange('2026-10-01', '2026-10-31'),
        {},
        'live',
        { fetchFacebook: async () => insight(), now: () => FIXED_NOW }
    );

    assert.equal(result.synced, 10);
    assert.equal(result.failed, 0);
    assert.equal(result.skipped, 0);
    assert.equal(result.remaining, 2);
    assert.equal(writes.create.length, 10);
});
