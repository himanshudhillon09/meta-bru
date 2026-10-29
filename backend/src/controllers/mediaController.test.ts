import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import type { AppError } from '../utils/errors.js';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { createVideoSignature, deleteMedia, getStorageOverview } = await import(
    './mediaController.js'
);
const { User } = await import('../models/userModel.js');
const { encryptSecret } = await import('../services/cryptoService.js');

const USER_ID = '64b7f1c2a1b2c3d4e5f60719';
const OTHER_ID = '64b7f1c2a1b2c3d4e5f60718';

type MockableModel = Record<string, (...args: unknown[]) => unknown>;
type JsonMock = ReturnType<typeof mock.fn>;

const user = User as unknown as MockableModel;

function request(body: Record<string, unknown> = {}): Request {
    return {
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
        return (
            appError.statusCode === statusCode && appError.code === code
        );
    };
}

function unconfiguredUser(): Record<string, unknown> {
    return {
        select: async () => ({
            _id: USER_ID,
            credentialsEnc: '',
        }),
    };
}

afterEach(() => {
    mock.restoreAll();
});

test('storage overview uses the authenticated user and reports unconfigured Cloudinary', async () => {
    const findById = mock.method(user, 'findById', () =>
        unconfiguredUser()
    );
    const { res, json } = response();

    await getStorageOverview(request({ userId: OTHER_ID }), res);

    assert.equal(findById.mock.callCount(), 1);
    assert.equal(findById.mock.calls[0]?.arguments[0], USER_ID);

    const payload = json.mock.calls[0]?.arguments[0] as Record<
        string,
        unknown
    >;
    assert.equal(payload.success, true);
    assert.equal(payload.configured, false);
    assert.deepEqual(payload.assets, []);
});

test('deleteMedia rejects an empty assetIds list', async () => {
    const { res } = response();

    await assert.rejects(
        () => deleteMedia(request({ assetIds: [] }), res),
        assertAppError(400, 'VALIDATION_ERROR')
    );
});

test('deleteMedia rejects non-string asset ids', async () => {
    const { res } = response();

    await assert.rejects(
        () => deleteMedia(request({ assetIds: [123] }), res),
        assertAppError(400, 'VALIDATION_ERROR')
    );
});

test('deleteMedia rejects more than the per-request limit', async () => {
    const { res } = response();
    const assetIds = Array.from(
        { length: 501 },
        (_, index) => `asset-${index}`
    );

    await assert.rejects(
        () => deleteMedia(request({ assetIds }), res),
        assertAppError(400, 'VALIDATION_ERROR')
    );
});

test('deleteMedia uses the authenticated user and ignores a body userId', async () => {
    const findById = mock.method(user, 'findById', () =>
        unconfiguredUser()
    );
    const { res } = response();

    await assert.rejects(
        () =>
            deleteMedia(
                request({
                    assetIds: ['asset-1'],
                    userId: OTHER_ID,
                }),
                res
            ),
        assertAppError(503, 'MEDIA_NOT_CONFIGURED')
    );

    assert.equal(findById.mock.callCount(), 1);
    assert.equal(findById.mock.calls[0]?.arguments[0], USER_ID);
});

function configuredUser(): Record<string, unknown> {
    return {
        select: async () => ({
            _id: USER_ID,
            credentialsEnc: encryptSecret(
                JSON.stringify({
                    cloudinary: {
                        cloudName: 'demo',
                        apiKey: 'key-123',
                        apiSecret: 'secret-456',
                    },
                })
            ),
        }),
    };
}

test('video signature signs the authenticated user folder and hides the secret', async () => {
    const findById = mock.method(user, 'findById', () => configuredUser());
    const { res, json } = response();

    await createVideoSignature(
        request({ folder: `meta-bru/${OTHER_ID}`, userId: OTHER_ID }),
        res
    );

    assert.equal(findById.mock.calls[0]?.arguments[0], USER_ID);
    const payload = json.mock.calls[0]?.arguments[0] as {
        success: boolean;
        upload: Record<string, unknown>;
    };
    assert.equal(payload.success, true);
    assert.equal(payload.upload.folder, `meta-bru/${USER_ID}`);
    assert.equal(payload.upload.apiKey, 'key-123');
    assert.ok(!JSON.stringify(payload).includes('secret-456'));
});

test('video signature reports unconfigured Cloudinary', async () => {
    mock.method(user, 'findById', () => unconfiguredUser());
    const { res } = response();

    await assert.rejects(
        () => createVideoSignature(request(), res),
        assertAppError(503, 'MEDIA_NOT_CONFIGURED')
    );
});
