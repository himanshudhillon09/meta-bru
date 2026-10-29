import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import type { AppError } from '../utils/errors.js';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { createPost, deletePost, publishNow, retryPost, shareStory } = await import(
    './postController.js'
);
const { SocialConnection } = await import('../models/socialConnectionModel.js');
const { Post } = await import('../models/postModel.js');
const { User } = await import('../models/userModel.js');
const { encryptSecret } = await import('../services/cryptoService.js');
const { v2: cloudinary } = await import('cloudinary');

const CONNECTION_ID = '64b7f1c2a1b2c3d4e5f60718';
const POST_ID = '64b7f1c2a1b2c3d4e5f6071a';
const USER_ID = '64b7f1c2a1b2c3d4e5f60719';

type MockableModel = Record<string, (...args: unknown[]) => unknown>;
type JsonMock = ReturnType<typeof mock.fn>;

const socialConnection = SocialConnection as unknown as MockableModel;
const post = Post as unknown as MockableModel;
const user = User as unknown as MockableModel;
const cloudinaryApi = cloudinary.api as unknown as MockableModel;
const REEL_ID = `meta-bru/${USER_ID}/reel-1`;

function cloudinaryUser(): Record<string, unknown> {
    return {
        select: async () => ({
            _id: USER_ID,
            credentialsEnc: encryptSecret(
                JSON.stringify({
                    cloudinary: { cloudName: 'demo', apiKey: 'key', apiSecret: 'secret' },
                })
            ),
        }),
    };
}

function reelResource(duration: number): Record<string, unknown> {
    return {
        public_id: REEL_ID,
        asset_folder: `meta-bru/${USER_ID}`,
        secure_url: `https://res.cloudinary.com/demo/video/upload/v1/${REEL_ID}.mp4`,
        format: 'mp4',
        bytes: 8_000_000,
        width: 1080,
        height: 1920,
        duration,
    };
}

function reelBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        connectionId: CONNECTION_ID,
        caption: 'A test reel',
        mediaType: 'reel',
        mediaPublicId: REEL_ID,
        platforms: { facebook: true, instagram: false },
        action: 'queue',
        ...overrides,
    };
}

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

function createdResponse(): { res: Response; json: JsonMock } {
    const json = mock.fn();
    const res = { json } as unknown as Response & { status: unknown };
    res.status = mock.fn(() => res);
    return { res, json };
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

test('createPost fills reel media from Cloudinary and ignores client URLs', async () => {
    mock.method(socialConnection, 'findOne', () => ({
        select: async () => connectionDoc(),
    }));
    mock.method(user, 'findById', () => cloudinaryUser());
    mock.method(cloudinaryApi, 'resource', async () => reelResource(30));
    let created: Record<string, unknown> | undefined;
    mock.method(post, 'create', async (doc: unknown) => {
        created = doc as Record<string, unknown>;
        return doc;
    });

    const { res } = createdResponse();
    await createPost(
        requestWithBody(
            reelBody({
                mediaUrl: 'https://evil.example/fake.mp4',
                shareToStory: true,
            })
        ),
        res
    );

    assert.ok(created);
    assert.equal(created.mediaType, 'reel');
    assert.equal(created.mediaPublicId, REEL_ID);
    assert.match(
        String(created.mediaUrl),
        /^https:\/\/res\.cloudinary\.com\/demo\/video\/upload\/c_pad/
    );
    assert.match(String(created.mediaCoverUrl), /reel-1\.jpg/);
    assert.equal(created.mediaJpegUrl, '');
    assert.equal(created.mediaDuration, 30);
    assert.equal(created.shareToStory, true);
    assert.equal(created.status, 'queued');
});

test('createPost rejects a Facebook reel over 90 seconds', async () => {
    mock.method(socialConnection, 'findOne', () => ({
        select: async () => connectionDoc(),
    }));
    mock.method(user, 'findById', () => cloudinaryUser());
    mock.method(cloudinaryApi, 'resource', async () => reelResource(120));
    const create = mock.method(post, 'create', async () => {
        throw new Error('Post.create should not be called');
    });

    const { res } = createdResponse();
    await assert.rejects(
        () => createPost(requestWithBody(reelBody()), res),
        assertAppError(400, 'FACEBOOK_REEL_TOO_LONG')
    );
    assert.equal(create.mock.callCount(), 0);
});

test('createPost requires a reel video', async () => {
    const { res } = createdResponse();

    await assert.rejects(
        () => createPost(requestWithBody(reelBody({ mediaPublicId: '' })), res),
        assertAppError(400, 'VALIDATION_ERROR')
    );
});

test('createPost keeps image posts working without a mediaType', async () => {
    mock.method(socialConnection, 'findOne', () => ({
        select: async () => connectionDoc(),
    }));
    let created: Record<string, unknown> | undefined;
    mock.method(post, 'create', async (doc: unknown) => {
        created = doc as Record<string, unknown>;
        return doc;
    });

    const { res } = createdResponse();
    await createPost(requestWithBody(createBody()), res);

    assert.ok(created);
    assert.equal(created.mediaType, 'image');
    assert.equal(created.mediaUrl, 'https://example.com/image.jpg');
    assert.equal(created.mediaDuration, 0);
    assert.equal(created.shareToStory, false);
});

function publishedPost(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return queuedPost({
        status: 'published',
        targets: [
            {
                platform: 'facebook',
                status: 'published',
                externalId: 'fb-post-1',
                creationId: '',
                error: '',
                publishedAt: new Date(),
            },
        ],
        storyTargets: [],
        ...overrides,
    });
}

test('shareStory validates the requested platforms', async () => {
    const { res } = response();

    await assert.rejects(
        () => shareStory(requestWithBody({ platforms: [] }), res),
        assertAppError(400, 'VALIDATION_ERROR')
    );
});

test('shareStory rejects a post that has not published', async () => {
    mock.method(post, 'findOne', async () => queuedPost());
    const { res } = response();

    await assert.rejects(
        () => shareStory(requestWithBody({ platforms: ['facebook'] }), res),
        assertAppError(400, 'POST_NOT_PUBLISHED')
    );
});

test('shareStory rejects platforms with nothing left to share', async () => {
    mock.method(post, 'findOne', async () =>
        publishedPost({
            storyTargets: [
                {
                    platform: 'facebook',
                    status: 'published',
                    externalId: 'story-1',
                    creationId: '',
                    error: '',
                    publishedAt: new Date(),
                },
            ],
        })
    );
    const claim = mock.method(socialConnection, 'findOneAndUpdate', () => {
        throw new Error('the Page lock should not be claimed');
    });
    const { res } = response();

    await assert.rejects(
        () => shareStory(requestWithBody({ platforms: ['facebook', 'instagram'] }), res),
        assertAppError(400, 'NOTHING_TO_SHARE')
    );
    assert.equal(claim.mock.callCount(), 0);
});

test('shareStory releases the Page lock when sharing fails', async () => {
    mock.method(post, 'findOne', async () => publishedPost());
    mock.method(socialConnection, 'findOneAndUpdate', () => ({
        select: async () => connectionDoc(),
    }));
    // No Meta credentials: sharePostToStory throws META_NOT_CONFIGURED.
    mock.method(user, 'findById', () => ({
        select: async () => ({ credentialsEnc: '' }),
    }));
    const release = mock.method(socialConnection, 'updateOne', () => ({
        matchedCount: 1,
    }));
    const { res } = response();

    await assert.rejects(
        () => shareStory(requestWithBody({ platforms: ['facebook'] }), res),
        assertAppError(503, 'META_NOT_CONFIGURED')
    );
    assert.equal(release.mock.callCount(), 1);
    assert.deepEqual(
        (release.mock.calls[0]?.arguments[1] as Record<string, unknown>).$set,
        { lockedAt: null }
    );
});

test('deletePost keeps a file another post still uses and reports it', async () => {
    const draft = queuedPost({
        status: 'draft',
        mediaType: 'image',
        mediaPublicId: `meta-bru/${USER_ID}/image-1`,
    });
    mock.method(post, 'findOne', async () => draft);
    mock.method(post, 'findOneAndDelete', async () => draft);
    mock.method(post, 'exists', async () => ({ _id: 'another-post' }));
    const { res, json } = response();

    await deletePost(request(), res);

    assert.deepEqual(json.mock.calls[0]?.arguments[0], {
        success: true,
        message: 'Post deleted',
        mediaDeleted: false,
        mediaError: '',
    });
});

test('createPost burns overlay text into the image and removes the plain copy', async () => {
    const { default: sharp } = await import('sharp');
    const plain = await sharp({
        create: { width: 1080, height: 1350, channels: 3, background: '#4a90d9' },
    })
        .jpeg()
        .toBuffer();
    const basePublicId = `meta-bru/${USER_ID}/plain-1`;

    mock.method(socialConnection, 'findOne', () => ({
        select: async () => connectionDoc(),
    }));
    mock.method(user, 'findById', () => cloudinaryUser());
    const fetched: string[] = [];
    mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
        fetched.push(String(input));
        return new Response(plain, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    });
    let uploadedBytes = 0;
    mock.method(
        cloudinary.uploader as unknown as MockableModel,
        'upload_stream',
        (_options: unknown, callback: unknown) => ({
            end: (buffer: Buffer) => {
                uploadedBytes = buffer.length;
                (callback as (error: unknown, result: unknown) => void)(undefined, {
                    secure_url: 'https://res.cloudinary.com/demo/image/upload/v2/with-text.jpg',
                    public_id: `meta-bru/${USER_ID}/with-text`,
                    width: 1080,
                    height: 1350,
                    format: 'jpg',
                    bytes: buffer.length,
                });
            },
        })
    );
    mock.method(post, 'exists', async () => null);
    mock.method(cloudinaryApi, 'resource', async () => ({ asset_folder: `meta-bru/${USER_ID}` }));
    const removed = mock.method(cloudinaryApi, 'delete_resources', async (ids: unknown) => ({
        deleted: Object.fromEntries((ids as string[]).map((id) => [id, 'deleted'])),
    }));
    let created: Record<string, unknown> | undefined;
    mock.method(post, 'create', async (doc: unknown) => {
        created = doc as Record<string, unknown>;
        return doc;
    });

    const { res } = createdResponse();
    await createPost(
        requestWithBody(
            createBody({
                mediaUrl: 'https://res.cloudinary.com/demo/image/upload/v1/plain-1.jpg',
                mediaPublicId: basePublicId,
                overlayText: 'Real life wali *bandi*',
                mediaTextArea: { left: 0, top: 0, width: 1080, height: 1350, radius: 0 },
            })
        ),
        res
    );

    assert.equal(fetched.length, 1);
    assert.ok(fetched[0]?.includes(basePublicId));
    assert.ok(uploadedBytes > 0);
    assert.ok(created);
    assert.equal(created.mediaPublicId, `meta-bru/${USER_ID}/with-text`);
    assert.equal(created.mediaUrl, 'https://res.cloudinary.com/demo/image/upload/v2/with-text.jpg');
    assert.match(String(created.mediaJpegUrl), /with-text/);
    assert.deepEqual(removed.mock.calls[0]?.arguments[0], [basePublicId]);
});

test('createPost needs a Meta-Bru image to add overlay text', async () => {
    mock.method(socialConnection, 'findOne', () => ({
        select: async () => connectionDoc(),
    }));
    const create = mock.method(post, 'create', async () => {
        throw new Error('Post.create should not be called');
    });

    const { res } = createdResponse();
    await assert.rejects(
        () => createPost(requestWithBody(createBody({ overlayText: 'Hello *world*' })), res),
        assertAppError(400, 'OVERLAY_MEDIA_REQUIRED')
    );
    assert.equal(create.mock.callCount(), 0);
});

test('createPost ignores overlay text with nothing drawable', async () => {
    mock.method(socialConnection, 'findOne', () => ({
        select: async () => connectionDoc(),
    }));
    let created: Record<string, unknown> | undefined;
    mock.method(post, 'create', async (doc: unknown) => {
        created = doc as Record<string, unknown>;
        return doc;
    });

    const { res } = createdResponse();
    await createPost(requestWithBody(createBody({ overlayText: '  😂 *  ' })), res);

    assert.ok(created);
    assert.equal(created.mediaUrl, 'https://example.com/image.jpg');
});
