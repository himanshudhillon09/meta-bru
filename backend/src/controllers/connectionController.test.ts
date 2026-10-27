import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import type { AppError } from '../utils/errors.js';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const {
    disconnectConnection,
    listConnections,
    updateConnection,
    upsertPagesForUser,
} = await import('./connectionController.js');
const { SocialConnection } = await import('../models/socialConnectionModel.js');
const { Post } = await import('../models/postModel.js');

const CONNECTION_ID = '64b7f1c2a1b2c3d4e5f60718';
const USER_ID = '64b7f1c2a1b2c3d4e5f60719';

type MockableModel = Record<string, (...args: unknown[]) => unknown>;
type JsonMock = ReturnType<typeof mock.fn>;

const socialConnection = SocialConnection as unknown as MockableModel;
const post = Post as unknown as MockableModel;

function connectionDoc(
    overrides: Record<string, unknown> = {}
): Record<string, unknown> {
    const doc: Record<string, unknown> = {
        _id: { toString: () => CONNECTION_ID },
        tokenStatus: 'active',
        lockedAt: null,
        pageAccessTokenEnc: 'encrypted-token',
        ...overrides,
    };

    doc.toObject = () => {
        const copy = { ...doc };
        delete copy.toObject;
        delete copy.save;
        return copy;
    };

    return doc;
}

function request(): Request {
    return {
        params: { id: CONNECTION_ID },
        user: { id: USER_ID },
    } as unknown as Request;
}

function requestWithBody(body: Record<string, unknown>): Request {
    return {
        params: { id: CONNECTION_ID },
        user: { id: USER_ID },
        body,
    } as unknown as Request;
}

function response(): { res: Response; json: JsonMock } {
    const json = mock.fn();
    return { res: { json } as unknown as Response, json };
}

function bodyOf(json: JsonMock): Record<string, unknown> {
    const call = json.mock.calls[0];
    assert.ok(call);
    return call.arguments[0] as Record<string, unknown>;
}

function mockNoPublishingPost(): void {
    mock.method(post, 'findOne', () => ({
        sort: () => ({ select: async () => null }),
    }));
}

function assertPostInProgress(error: unknown): boolean {
    const appError = error as AppError;
    return appError.statusCode === 409 && appError.code === 'POST_IN_PROGRESS';
}

afterEach(() => {
    mock.restoreAll();
});

test('successful disconnect preserves posts and redacts the token', async () => {
    const connection = connectionDoc();
    const updated = connectionDoc({ tokenStatus: 'disconnected' });
    let capturedFilter: Record<string, unknown> | undefined;
    let capturedUpdate: Record<string, unknown> | undefined;

    mock.method(socialConnection, 'findOne', async () => connection);
    mock.method(
        socialConnection,
        'findOneAndUpdate',
        (filter: unknown, update: unknown) => {
            capturedFilter = filter as Record<string, unknown>;
            capturedUpdate = update as Record<string, unknown>;
            return { select: async () => updated };
        }
    );
    mockNoPublishingPost();
    mock.method(post, 'countDocuments', async () => 3);
    const deleteMany = mock.method(post, 'deleteMany', async () => ({}));

    const { res, json } = response();
    await disconnectConnection(request(), res);

    const body = bodyOf(json);
    assert.equal(body.success, true);
    assert.equal(body.queuedCount, 3);

    const returned = body.connection as Record<string, unknown>;
    assert.equal(returned.tokenStatus, 'disconnected');
    assert.equal(returned.queuedCount, 3);
    assert.equal('pageAccessTokenEnc' in returned, false);
    assert.equal(deleteMany.mock.callCount(), 0);

    assert.ok(capturedFilter);
    assert.equal(capturedFilter._id, connection._id);
    assert.equal(capturedFilter.userId, USER_ID);
    assert.deepEqual(capturedFilter.tokenStatus, { $ne: 'disconnected' });
    assert.ok(Array.isArray(capturedFilter.$or));

    const lockConditions = capturedFilter.$or as Array<Record<string, unknown>>;
    assert.equal(lockConditions.length, 2);
    assert.deepEqual(lockConditions[0], { lockedAt: null });

    const staleLock = lockConditions[1]?.lockedAt as
        | { $lt?: unknown }
        | undefined;
    assert.ok(staleLock);
    assert.ok(staleLock.$lt instanceof Date);

    assert.ok(capturedUpdate);
    assert.deepEqual(capturedUpdate.$set, {
        pageAccessTokenEnc: '',
        tokenStatus: 'disconnected',
        nextRunAt: null,
        lockedAt: null,
        lastError: '',
    });
});

test('fresh scheduler lock returns 409', async () => {
    const connection = connectionDoc({ lockedAt: new Date() });

    mock.method(socialConnection, 'findOne', async () => connection);
    const findOneAndUpdate = mock.method(
        socialConnection,
        'findOneAndUpdate',
        () => {
            throw new Error('findOneAndUpdate should not be called');
        }
    );
    mockNoPublishingPost();
    mock.method(post, 'countDocuments', async () => 0);
    mock.method(post, 'deleteMany', async () => ({}));

    const { res } = response();
    await assert.rejects(
        () => disconnectConnection(request(), res),
        assertPostInProgress
    );
    assert.equal(findOneAndUpdate.mock.callCount(), 0);
});

test('fresh publishing post returns 409', async () => {
    const connection = connectionDoc();

    mock.method(socialConnection, 'findOne', async () => connection);
    const findOneAndUpdate = mock.method(
        socialConnection,
        'findOneAndUpdate',
        () => {
            throw new Error('findOneAndUpdate should not be called');
        }
    );
    mock.method(post, 'findOne', () => ({
        sort: () => ({
            select: async () => ({ updatedAt: new Date() }),
        }),
    }));
    mock.method(post, 'countDocuments', async () => 0);
    mock.method(post, 'deleteMany', async () => ({}));

    const { res } = response();
    await assert.rejects(
        () => disconnectConnection(request(), res),
        assertPostInProgress
    );
    assert.equal(findOneAndUpdate.mock.callCount(), 0);
});

test('already-disconnected Page is idempotent', async () => {
    const connection = connectionDoc({ tokenStatus: 'disconnected' });

    mock.method(socialConnection, 'findOne', async () => connection);
    const findOneAndUpdate = mock.method(
        socialConnection,
        'findOneAndUpdate',
        () => {
            throw new Error('findOneAndUpdate should not be called');
        }
    );
    mockNoPublishingPost();
    mock.method(post, 'countDocuments', async () => 3);
    mock.method(post, 'deleteMany', async () => ({}));

    const { res, json } = response();
    await disconnectConnection(request(), res);

    const body = bodyOf(json);
    assert.equal(body.success, true);
    assert.equal(body.queuedCount, 3);
    assert.equal(
        body.message,
        'Page already disconnected. Queued posts are kept.'
    );
    assert.equal(findOneAndUpdate.mock.callCount(), 0);
});

test('lost race with latest still active returns 409', async () => {
    const connection = connectionDoc();
    const latest = connectionDoc({ lockedAt: new Date() });
    let findOneCalls = 0;

    mock.method(socialConnection, 'findOne', async () => {
        findOneCalls += 1;
        return findOneCalls === 1 ? connection : latest;
    });
    mock.method(socialConnection, 'findOneAndUpdate', () => ({
        select: async () => null,
    }));
    mockNoPublishingPost();
    mock.method(post, 'countDocuments', async () => 0);
    mock.method(post, 'deleteMany', async () => ({}));

    const { res } = response();
    await assert.rejects(
        () => disconnectConnection(request(), res),
        assertPostInProgress
    );
    assert.equal(findOneCalls, 2);
});

test('lost race with latest disconnected is idempotent', async () => {
    const connection = connectionDoc();
    const latest = connectionDoc({ tokenStatus: 'disconnected' });
    let findOneCalls = 0;

    mock.method(socialConnection, 'findOne', async () => {
        findOneCalls += 1;
        return findOneCalls === 1 ? connection : latest;
    });
    mock.method(socialConnection, 'findOneAndUpdate', () => ({
        select: async () => null,
    }));
    mockNoPublishingPost();
    mock.method(post, 'countDocuments', async () => 4);
    mock.method(post, 'deleteMany', async () => ({}));

    const { res, json } = response();
    await disconnectConnection(request(), res);

    const body = bodyOf(json);
    assert.equal(body.success, true);
    assert.equal(body.queuedCount, 4);
    assert.equal(
        body.message,
        'Page already disconnected. Queued posts are kept.'
    );
    assert.equal((body.connection as Record<string, unknown>).queuedCount, 4);
    assert.equal(findOneCalls, 2);
});

test('lost race with latest missing returns 404', async () => {
    const connection = connectionDoc();
    let findOneCalls = 0;

    mock.method(socialConnection, 'findOne', async () => {
        findOneCalls += 1;
        return findOneCalls === 1 ? connection : null;
    });
    mock.method(socialConnection, 'findOneAndUpdate', () => ({
        select: async () => null,
    }));
    mockNoPublishingPost();
    mock.method(post, 'countDocuments', async () => 0);
    mock.method(post, 'deleteMany', async () => ({}));

    const { res } = response();
    await assert.rejects(
        () => disconnectConnection(request(), res),
        (error: unknown) => {
            const appError = error as AppError;
            return (
                appError.statusCode === 404 &&
                appError.code === 'CONNECTION_NOT_FOUND'
            );
        }
    );
    assert.equal(findOneCalls, 2);
});

test('listConnections includes queued counts and redacts the token', async () => {
    const connection = connectionDoc();

    mock.method(socialConnection, 'find', () => ({
        select: () => ({
            sort: async () => [connection],
        }),
    }));
    mock.method(post, 'countDocuments', async () => 2);

    const { res, json } = response();
    await listConnections(request(), res);

    const body = bodyOf(json);
    assert.equal(body.success, true);

    const connections = body.connections as Array<Record<string, unknown>>;
    assert.equal(connections.length, 1);
    assert.equal(connections[0]?.queuedCount, 2);
    assert.equal('pageAccessTokenEnc' in (connections[0] ?? {}), false);
});

test('updateConnection clears the schedule when paused', async () => {
    const connection = connectionDoc({
        isActive: true,
        dailyTime: '09:00',
        timezone: 'UTC',
        nextRunAt: new Date('2026-10-24T09:00:00.000Z'),
        publishToFacebook: true,
        publishToInstagram: false,
        instagram: null,
    });
    connection.save = async () => connection;

    mock.method(socialConnection, 'findOne', async () => connection);
    mock.method(post, 'countDocuments', async () => 1);

    const { res, json } = response();
    await updateConnection(requestWithBody({ isActive: false }), res);

    assert.equal(connection.nextRunAt, null);

    const body = bodyOf(json);
    assert.equal(body.success, true);

    const returned = body.connection as Record<string, unknown>;
    assert.equal(returned.queuedCount, 1);
    assert.equal('pageAccessTokenEnc' in returned, false);
});

test('upsertPagesForUser keeps existing Pages and reports what the login covered', async () => {
    const now = new Date('2026-10-27T07:00:00.000Z');
    const existing = connectionDoc({
        pageId: 'page-old',
        pageName: 'Old Name',
        tokenStatus: 'needs_reauth',
        isActive: true,
        dailyTime: '10:30',
        timezone: 'Asia/Kolkata',
        publishToFacebook: true,
        publishToInstagram: true,
        instagram: { id: 'ig-1', username: 'old', profilePictureUrl: '' },
        nextRunAt: null,
        lastError: 'Meta access token is invalid',
        grantedScopes: [],
        tokenUpdatedAt: null,
    });
    const save = mock.fn(async () => existing);
    existing.save = save;

    const created: Array<Record<string, unknown>> = [];
    const findQueries: Array<Record<string, unknown>> = [];
    mock.method(socialConnection, 'findOne', async (query: unknown) =>
        (query as { pageId: string }).pageId === 'page-old' ? existing : null
    );
    mock.method(socialConnection, 'create', async (data: unknown) => {
        created.push(data as Record<string, unknown>);
        return data;
    });
    mock.method(socialConnection, 'find', (query: unknown) => {
        findQueries.push(query as Record<string, unknown>);
        return { select: async () => [{ pageName: 'Left Out Page' }] };
    });

    const scopes = ['pages_show_list', 'read_insights'];
    const summary = await upsertPagesForUser(
        USER_ID,
        [
            {
                id: 'page-old',
                name: 'Byte Horizon',
                access_token: 'new-token',
                instagram_business_account: { id: 'ig-1', username: 'byte' },
            },
            { id: 'page-new', name: 'New Page', access_token: 'other-token' },
        ],
        'Asia/Kolkata',
        scopes,
        now
    );

    assert.deepEqual(summary, {
        added: ['New Page'],
        reconnected: ['Byte Horizon'],
        notIncluded: ['Left Out Page'],
    });

    // The reconnected Page keeps its schedule and settings.
    assert.equal(save.mock.callCount(), 1);
    assert.equal(existing.tokenStatus, 'active');
    assert.equal(existing.lastError, '');
    assert.equal(existing.dailyTime, '10:30');
    assert.equal(existing.publishToInstagram, true);
    assert.deepEqual(existing.tokenUpdatedAt, now);
    assert.deepEqual(existing.grantedScopes, scopes);

    assert.equal(created.length, 1);
    assert.equal(created[0]?.pageId, 'page-new');
    assert.deepEqual(created[0]?.tokenUpdatedAt, now);
    assert.deepEqual(created[0]?.grantedScopes, scopes);

    assert.deepEqual(findQueries[0], {
        userId: USER_ID,
        pageId: { $nin: ['page-old', 'page-new'] },
        tokenStatus: { $ne: 'disconnected' },
    });
});

test('upsertPagesForUser stores unknown scopes as empty', async () => {
    const created: Array<Record<string, unknown>> = [];
    mock.method(socialConnection, 'findOne', async () => null);
    mock.method(socialConnection, 'create', async (data: unknown) => {
        created.push(data as Record<string, unknown>);
        return data;
    });
    mock.method(socialConnection, 'find', () => ({ select: async () => [] }));

    const summary = await upsertPagesForUser(
        USER_ID,
        [{ id: 'page-new', name: 'New Page', access_token: 'token' }],
        'Asia/Kolkata',
        null
    );

    assert.deepEqual(created[0]?.grantedScopes, []);
    assert.deepEqual(summary.notIncluded, []);
});
