import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import type { AppError } from '../utils/errors.js';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { createPost, publishNow, retryPost } = await import(
    './postController.js'
);
const { SocialConnection } = await import('../models/socialConnectionModel.js');
const { Post } = await import('../models/postModel.js');

const CONNECTION_ID = '64b7f1c2a1b2c3d4e5f60718';
const POST_ID = '64b7f1c2a1b2c3d4e5f6071a';
const USER_ID = '64b7f1c2a1b2c3d4e5f60719';

type MockableModel = Record<string, (...args: unknown[]) => unknown>;
type JsonMock = ReturnType<typeof mock.fn>;

const socialConnection = SocialConnection as unknown as MockableModel;
const post = Post as unknown as MockableModel;

function connectionDoc(
    overrides: Record<string, unknown> = {}
): Record<string, unknown> {
    return {
        _id: { toString: () => CONNECTION_ID },
        tokenStatus: 'active',
        lockedAt: null,
        pageAccessTokenEnc: 'encrypted-token',
        ...overrides,
    };
}

function queuedPost(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        _id: { toString: () => POST_ID },
        userId: USER_ID,
        connectionId: CONNECTION_ID,
        status: 'queued',
        platforms: { facebook: true, instagram: false },
        targets: [
            {
                platform: 'facebook',
                status: 'pending',
                externalId: '',
                creationId: '',
                error: '',
                publishedAt: null,
            },
        ],
        ...overrides,
    };
}

function createBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        connectionId: CONNECTION_ID,
        caption: 'A test post',
        mediaUrl: 'https://example.com/image.jpg',
        platforms: { facebook: true, instagram: false },
        action: 'queue',
        ...overrides,
    };
}

function request(): Request {
    return {
        params: { id: POST_ID },
        user: { id: USER_ID },
    } as unknown as Request;
}

function requestWithBody(body: Record<string, unknown>): Request {
    return {
        params: { id: POST_ID },
        user: { id: USER_ID },
        body,
    } as unknown as Request;
}

function response(): { res: Response; json: JsonMock } {
    const json = mock.fn();
    return { res: { json } as unknown as Response, json };
}

function assertAppError(statusCode: number, code: string) {
    return (error: unknown): boolean => {
        const appError = error as AppError;
        return appError.statusCode === statusCode && appError.code === code;
    };
}

afterEach(() => {
    mock.restoreAll();
});

test('createPost rejects a disconnected Page', async () => {
    const connection = connectionDoc({ tokenStatus: 'disconnected' });

    mock.method(socialConnection, 'findOne', () => ({
        select: async () => connection,
    }));
    const create = mock.method(post, 'create', async () => {
        throw new Error('Post.create should not be called');
    });

    const { res } = response();
    await assert.rejects(
        () => createPost(requestWithBody(createBody()), res),
        assertAppError(409, 'PAGE_DISCONNECTED')
    );
    assert.equal(create.mock.callCount(), 0);
});

test('publishNow rejects a disconnected Page', async () => {
    mock.method(post, 'findOne', async () => queuedPost());
    mock.method(socialConnection, 'findOneAndUpdate', () => ({
        select: async () => null,
    }));
    mock.method(socialConnection, 'findOne', async () =>
        connectionDoc({ tokenStatus: 'disconnected' })
    );
    const claim = mock.method(post, 'findOneAndUpdate', () => {
        throw new Error('Post.findOneAndUpdate should not be called');
    });

    const { res } = response();
    await assert.rejects(
        () => publishNow(request(), res),
        assertAppError(409, 'PAGE_DISCONNECTED')
    );
    assert.equal(claim.mock.callCount(), 0);
});

test('publishNow rejects a fresh connection lock', async () => {
    mock.method(post, 'findOne', async () => queuedPost());
    mock.method(socialConnection, 'findOneAndUpdate', () => ({
        select: async () => null,
    }));
    mock.method(socialConnection, 'findOne', async () =>
        connectionDoc({ lockedAt: new Date() })
    );
    const claim = mock.method(post, 'findOneAndUpdate', () => {
        throw new Error('Post.findOneAndUpdate should not be called');
    });

    const { res } = response();
    await assert.rejects(
        () => publishNow(request(), res),
        assertAppError(409, 'CONNECTION_BUSY')
    );
    assert.equal(claim.mock.callCount(), 0);
});

test('publishNow claims the connection lock and releases it when the post claim fails', async () => {
    mock.method(post, 'findOne', async () => queuedPost());

    let claimFilter: Record<string, unknown> | undefined;
    let claimUpdate: Record<string, unknown> | undefined;
    mock.method(
        socialConnection,
        'findOneAndUpdate',
        (filter: unknown, update: unknown) => {
            claimFilter = filter as Record<string, unknown>;
            claimUpdate = update as Record<string, unknown>;
            return { select: async () => connectionDoc() };
        }
    );

    mock.method(post, 'findOneAndUpdate', async () => null);

    let releaseFilter: Record<string, unknown> | undefined;
    let releaseUpdate: Record<string, unknown> | undefined;
    mock.method(
        socialConnection,
        'updateOne',
        (filter: unknown, update: unknown) => {
            releaseFilter = filter as Record<string, unknown>;
            releaseUpdate = update as Record<string, unknown>;
            return { matchedCount: 1 };
        }
    );

    const { res } = response();
    await assert.rejects(
        () => publishNow(request(), res),
        assertAppError(409, 'POST_LOCKED')
    );

    assert.ok(claimFilter);
    assert.equal(claimFilter._id, CONNECTION_ID);
    assert.equal(claimFilter.userId, USER_ID);
    assert.equal(claimFilter.tokenStatus, 'active');

    const claimOr = claimFilter.$or as Record<string, unknown>[];
    assert.equal(claimOr.length, 2);
    assert.deepEqual(claimOr[0], { lockedAt: null });
    const staleBefore = (claimOr[1]?.lockedAt as Record<string, unknown>)
        ?.$lt;
    assert.ok(staleBefore instanceof Date);

    assert.ok(claimUpdate);
    const lockedAt = (claimUpdate.$set as Record<string, unknown>).lockedAt;
    assert.ok(lockedAt instanceof Date);
    assert.deepEqual(claimUpdate, { $set: { lockedAt } });

    assert.deepEqual(releaseFilter, { _id: CONNECTION_ID, lockedAt });
    assert.deepEqual(releaseUpdate, { $set: { lockedAt: null } });
});

test('createPost now claims the connection lock and releases it when creation fails', async () => {
    mock.method(socialConnection, 'findOne', () => ({
        select: async () => connectionDoc(),
    }));

    let claimFilter: Record<string, unknown> | undefined;
    let claimUpdate: Record<string, unknown> | undefined;
    mock.method(
        socialConnection,
        'findOneAndUpdate',
        (filter: unknown, update: unknown) => {
            claimFilter = filter as Record<string, unknown>;
            claimUpdate = update as Record<string, unknown>;
            return { select: async () => connectionDoc() };
        }
    );

    mock.method(post, 'create', async () => {
        throw new Error('insert failed');
    });

    let releaseFilter: Record<string, unknown> | undefined;
    let releaseUpdate: Record<string, unknown> | undefined;
    mock.method(
        socialConnection,
        'updateOne',
        (filter: unknown, update: unknown) => {
            releaseFilter = filter as Record<string, unknown>;
            releaseUpdate = update as Record<string, unknown>;
            return { matchedCount: 1 };
        }
    );

    const { res } = response();
    await assert.rejects(
        () => createPost(requestWithBody(createBody({ action: 'now' })), res),
        /insert failed/
    );

    assert.ok(claimFilter);
    assert.equal(claimFilter._id, CONNECTION_ID);
    assert.equal(claimFilter.userId, USER_ID);
    assert.equal(claimFilter.tokenStatus, 'active');

    const claimOr = claimFilter.$or as Record<string, unknown>[];
    assert.equal(claimOr.length, 2);
    assert.deepEqual(claimOr[0], { lockedAt: null });
    const staleBefore = (claimOr[1]?.lockedAt as Record<string, unknown>)
        ?.$lt;
    assert.ok(staleBefore instanceof Date);

    assert.ok(claimUpdate);
    const lockedAt = (claimUpdate.$set as Record<string, unknown>).lockedAt;
    assert.ok(lockedAt instanceof Date);
    assert.deepEqual(claimUpdate, { $set: { lockedAt } });

    assert.deepEqual(releaseFilter, { _id: CONNECTION_ID, lockedAt });
    assert.deepEqual(releaseUpdate, { $set: { lockedAt: null } });
});

test('retryPost rejects a disconnected Page', async () => {
    mock.method(post, 'findOne', async () =>
        queuedPost({
            status: 'failed',
            targets: [
                {
                    platform: 'facebook',
                    status: 'failed',
                    externalId: '',
                    creationId: '',
                    error: 'Meta rejected the post',
                    publishedAt: null,
                },
            ],
        })
    );
    mock.method(socialConnection, 'findOneAndUpdate', () => ({
        select: async () => null,
    }));
    mock.method(socialConnection, 'findOne', async () =>
        connectionDoc({ tokenStatus: 'disconnected' })
    );
    const claim = mock.method(post, 'findOneAndUpdate', () => {
        throw new Error('Post.findOneAndUpdate should not be called');
    });

    const { res } = response();
    await assert.rejects(
        () => retryPost(request(), res),
        assertAppError(409, 'PAGE_DISCONNECTED')
    );
    assert.equal(claim.mock.callCount(), 0);
});
