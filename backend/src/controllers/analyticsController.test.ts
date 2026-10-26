import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import type { AppError } from '../utils/errors.js';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { generateTips, listPosts, monitor, overview, sync, tips } =
    await import('./analyticsController.js');
const { Post } = await import('../models/postModel.js');
const { AnalyticsAiInsight } = await import(
    '../models/analyticsAiInsightModel.js'
);

const USER_ID = '64b7f1c2a1b2c3d4e5f60719';
const OTHER_ID = '64b7f1c2a1b2c3d4e5f60718';
const CONNECTION_ID = '64b7f1c2a1b2c3d4e5f60720';
const FROM = '2026-09-25';
const TO = '2026-10-24';

type MockableModel = Record<string, (...args: unknown[]) => unknown>;
type JsonMock = ReturnType<typeof mock.fn>;

const postModel = Post as unknown as MockableModel;
const insightModel = AnalyticsAiInsight as unknown as MockableModel;

function request(
    query: Record<string, unknown> = {},
    body: Record<string, unknown> = {}
): Request {
    return {
        query,
        body,
        user: {
            id: USER_ID,
            brandProfile: { niche: 'coffee' },
        },
    } as unknown as Request;
}

function response(): { res: Response; json: JsonMock } {
    const json = mock.fn();
    return { res: { json } as unknown as Response, json };
}

function assertAppError(statusCode: number, code: string) {
    return (error: unknown): boolean => {
        const appError = error as AppError;
        return (
            appError.statusCode === statusCode && appError.code === code
        );
    };
}

function mockEmptyPosts() {
    return mock.method(postModel, 'find', () => ({
        populate: () => ({
            sort: async () => [],
        }),
    }));
}

function mockEmptyPage() {
    return mock.method(postModel, 'aggregate', async () => [
        { metadata: [{ total: 0 }], data: [] },
    ]);
}

function mockNoCache() {
    return mock.method(insightModel, 'findOne', () => ({
        sort: async () => null,
    }));
}

function cachedInsight() {
    return {
        generatedAt: new Date('2026-10-24T08:00:00.000Z'),
        expiresAt: new Date('2026-10-24T14:00:00.000Z'),
        model: 'gemini-2.5-flash',
        tips: [
            {
                title: 'Cached tip',
                body: 'Cached body',
                severity: 'success',
                actionLabel: 'Open composer',
                actionHref: '/composer',
            },
        ],
    };
}

afterEach(() => {
    mock.restoreAll();
});

test('overview scopes to the authenticated user and ignores a body userId', async () => {
    const find = mockEmptyPosts();
    const { res, json } = response();

    await overview(
        request(
            { from: FROM, to: TO },
            { userId: OTHER_ID }
        ),
        res
    );

    assert.equal(find.mock.callCount(), 1);
    const query = find.mock.calls[0]?.arguments[0] as Record<string, unknown>;
    assert.equal(query.userId, USER_ID);

    const payload = json.mock.calls[0]?.arguments[0] as Record<string, unknown>;
    assert.equal(payload.success, true);
    assert.equal((payload.totals as { posts: number }).posts, 0);
});

test('overview rejects a userId query parameter', async () => {
    const { res } = response();

    await assert.rejects(
        () =>
            overview(
                request({
                    from: FROM,
                    to: TO,
                    userId: OTHER_ID,
                }),
                res
            ),
        (error: unknown) => {
            assert.equal(
                (error as AppError).code,
                'VALIDATION_ERROR'
            );
            assert.match((error as Error).message, /userId/);
            return true;
        }
    );
});

test('overview forwards an owned connection filter into the scoped query', async () => {
    const find = mockEmptyPosts();
    const { res } = response();

    await overview(
        request({ from: FROM, to: TO, connectionId: CONNECTION_ID }),
        res
    );

    const query = find.mock.calls[0]?.arguments[0] as Record<string, unknown>;
    assert.equal(query.userId, USER_ID);
    assert.equal(query.connectionId, CONNECTION_ID);
});

test('overview rejects a missing date range', async () => {
    const { res } = response();

    await assert.rejects(
        () => overview(request({ from: FROM }), res),
        assertAppError(400, 'VALIDATION_ERROR')
    );
});

test('monitor returns an empty scoped series for the authenticated user', async () => {
    mockEmptyPosts();
    const { res, json } = response();

    await monitor(request({ from: FROM, to: TO }), res);

    const payload = json.mock.calls[0]?.arguments[0] as Record<string, unknown>;
    assert.equal(payload.success, true);
    assert.deepEqual(payload.scope, {
        connectionId: null,
        pageName: 'All Pages',
    });
    assert.deepEqual(payload.series, {
        all: [],
        facebook: [],
        instagram: [],
    });
    assert.equal(payload.seriesTruncated, false);
    assert.deepEqual(payload.recentPosts, []);
});

test('listPosts uses the authenticated user and default pagination', async () => {
    const aggregate = mockEmptyPage();
    const { res, json } = response();

    await listPosts(request({ from: FROM, to: TO }), res);

    assert.equal(aggregate.mock.callCount(), 1);
    const pipeline = aggregate.mock.calls[0]?.arguments[0] as Array<{
        $match?: Record<string, unknown>;
    }>;
    assert.equal(String(pipeline[0]?.$match?.userId), USER_ID);

    const payload = json.mock.calls[0]?.arguments[0] as Record<string, unknown>;
    assert.equal(payload.success, true);
    assert.deepEqual(payload.posts, []);
    assert.equal(payload.page, 1);
    assert.equal(payload.limit, 25);
    assert.equal(payload.total, 0);
    assert.equal(payload.hasMore, false);
});

test('listPosts rejects pagination outside the allowed bounds', async () => {
    const { res } = response();

    await assert.rejects(
        () =>
            listPosts(
                request({ from: FROM, to: TO, page: '0' }),
                res
            ),
        assertAppError(400, 'VALIDATION_ERROR')
    );

    await assert.rejects(
        () =>
            listPosts(
                request({ from: FROM, to: TO, limit: '101' }),
                res
            ),
        assertAppError(400, 'VALIDATION_ERROR')
    );
});

test('sync uses the authenticated user and returns empty counts', async () => {
    mockEmptyPosts();
    const { res, json } = response();

    await sync(
        request({}, { from: FROM, to: TO, mode: 'live' }),
        res
    );

    const payload = json.mock.calls[0]?.arguments[0] as Record<string, unknown>;
    assert.equal(payload.success, true);
    assert.equal(payload.synced, 0);
    assert.equal(payload.failed, 0);
    assert.equal(payload.skipped, 0);
    assert.equal(payload.remaining, 0);
    assert.deepEqual(payload.permissionErrors, []);
    assert.equal(typeof payload.lastSyncedAt, 'string');
});

test('sync rejects a userId in the request body', async () => {
    const { res } = response();

    await assert.rejects(
        () =>
            sync(
                request(
                    {},
                    {
                        from: FROM,
                        to: TO,
                        userId: OTHER_ID,
                    }
                ),
                res
            ),
        assertAppError(400, 'VALIDATION_ERROR')
    );
});

test('tips returns rule-based tips and null AI when no cache exists', async () => {
    const find = mockEmptyPosts();
    const findOne = mockNoCache();
    const { res, json } = response();

    await tips(request({ from: FROM, to: TO }), res);

    const payload = json.mock.calls[0]?.arguments[0] as Record<string, unknown>;
    assert.equal(payload.success, true);
    const ruleBased = payload.ruleBased as Array<{ id: string }>;
    assert.equal(ruleBased.length, 1);
    assert.equal(ruleBased[0]?.id, 'no-posts');
    assert.equal(payload.ai, null);

    const query = find.mock.calls[0]?.arguments[0] as Record<string, unknown>;
    assert.equal(query.userId, USER_ID);
    const cacheQuery = findOne.mock.calls[0]?.arguments[0] as Record<
        string,
        unknown
    >;
    assert.equal(cacheQuery.userId, USER_ID);
    assert.equal(cacheQuery.scopeKey, 'all');
    assert.equal(cacheQuery.rangeKey, `${FROM}:${TO}:all`);
    assert.equal(String(cacheQuery.dataHash).length, 64);
});

test('tips returns a cached AI insight when one is unexpired', async () => {
    mockEmptyPosts();
    const cached = cachedInsight();
    mock.method(insightModel, 'findOne', () => ({
        sort: async () => cached,
    }));
    const { res, json } = response();

    await tips(request({ from: FROM, to: TO }), res);

    const payload = json.mock.calls[0]?.arguments[0] as Record<string, unknown>;
    const ai = payload.ai as Record<string, unknown>;
    assert.equal(ai.cached, true);
    assert.equal(ai.generatedAt, cached.generatedAt.toISOString());
    assert.equal(ai.expiresAt, cached.expiresAt.toISOString());
    assert.equal(ai.model, cached.model);
    assert.deepEqual(ai.tips, cached.tips);
});

test('tips rejects a userId query parameter', async () => {
    const { res } = response();

    await assert.rejects(
        () =>
            tips(
                request({
                    from: FROM,
                    to: TO,
                    userId: OTHER_ID,
                }),
                res
            ),
        assertAppError(400, 'VALIDATION_ERROR')
    );
});

test('generateTips returns a cached insight without writing a new row', async () => {
    mockEmptyPosts();
    const cached = cachedInsight();
    const findOne = mock.method(insightModel, 'findOne', () => ({
        sort: async () => cached,
    }));
    const create = mock.method(insightModel, 'create');
    const { res, json } = response();

    await generateTips(request({}, { from: FROM, to: TO }), res);

    assert.equal(findOne.mock.callCount(), 1);
    assert.equal(create.mock.callCount(), 0);

    const payload = json.mock.calls[0]?.arguments[0] as Record<string, unknown>;
    assert.equal(payload.success, true);
    assert.equal(payload.cached, true);
    const insight = payload.insight as Record<string, unknown>;
    assert.equal(insight.generatedAt, cached.generatedAt.toISOString());
    assert.equal(insight.expiresAt, cached.expiresAt.toISOString());
    assert.equal(insight.model, cached.model);
    assert.deepEqual(insight.tips, cached.tips);
});

test('generateTips rejects a userId in the request body', async () => {
    const { res } = response();

    await assert.rejects(
        () =>
            generateTips(
                request(
                    {},
                    {
                        from: FROM,
                        to: TO,
                        userId: OTHER_ID,
                    }
                ),
                res
            ),
        assertAppError(400, 'VALIDATION_ERROR')
    );
});


