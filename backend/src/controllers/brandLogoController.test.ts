import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import sharp from 'sharp';
import type { AppError } from '../utils/errors.js';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { deleteBrandLogo, getBrandLogo, uploadBrandLogo } = await import(
    './brandLogoController.js'
);
const { User } = await import('../models/userModel.js');

const USER_ID = '64b7f1c2a1b2c3d4e5f60719';

type MockableModel = Record<string, (...args: unknown[]) => unknown>;
type JsonMock = ReturnType<typeof mock.fn>;

const user = User as unknown as MockableModel;

function request(file?: { buffer: Buffer }): Request {
    return { user: { id: USER_ID }, file } as unknown as Request;
}

function response(): { res: Response; json: JsonMock; status: JsonMock } {
    const json = mock.fn();
    const res = {
        json,
        set: mock.fn(),
    } as unknown as Response & { status: JsonMock };
    const status = mock.fn(() => res);
    res.status = status;
    return { res, json, status };
}

function payload(json: JsonMock): Record<string, unknown> {
    return json.mock.calls[0]?.arguments[0] as Record<string, unknown>;
}

afterEach(() => {
    mock.restoreAll();
});

test('reports no logo for a user who has not uploaded one', async () => {
    const findById = mock.method(user, 'findById', () => ({
        select: async () => ({
            _id: USER_ID,
            brandLogo: { width: 0, height: 0, bytes: 0, updatedAt: null },
        }),
    }));
    const { res, json } = response();

    await getBrandLogo(request(), res);

    assert.equal(findById.mock.calls[0]?.arguments[0], USER_ID);
    assert.deepEqual(payload(json), { success: true, logo: null, previews: [] });
});

test('returns the stored logo with framed previews', async () => {
    const logo = await sharp({
        create: { width: 120, height: 60, channels: 4, background: '#e63946' },
    })
        .png()
        .toBuffer();
    mock.method(user, 'findById', () => ({
        select: async () => ({
            _id: USER_ID,
            brandLogo: {
                data: logo,
                width: 120,
                height: 60,
                bytes: logo.length,
                updatedAt: new Date('2026-10-28T10:00:00Z'),
            },
        }),
    }));
    const { res, json } = response();

    await getBrandLogo(request(), res);

    const body = payload(json) as {
        logo: { dataUrl: string; width: number };
        previews: Array<{ dataUrl: string; width: number }>;
    };
    assert.match(body.logo.dataUrl, /^data:image\/png;base64,/);
    assert.equal(body.logo.width, 120);
    assert.equal(body.previews.length, 2);
    assert.match(body.previews[0]?.dataUrl ?? '', /^data:image\/jpeg;base64,/);
    assert.equal(body.previews[0]?.width, 1080);
});

test('rejects an upload without a file', async () => {
    const { res } = response();

    await assert.rejects(
        () => uploadBrandLogo(request(), res),
        (error: unknown) => {
            const appError = error as AppError;
            return appError.statusCode === 400 && appError.code === 'NO_FILE';
        }
    );
});

test('stores a normalised logo for the authenticated user only', async () => {
    const updateOne = mock.method(user, 'updateOne', async () => ({
        matchedCount: 1,
    }));
    const file = await sharp(
        Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">' +
                '<rect x="100" y="150" width="200" height="100" fill="#1d3557"/></svg>'
        )
    )
        .png()
        .toBuffer();
    const { res, json, status } = response();

    await uploadBrandLogo(request({ buffer: file }), res);

    assert.equal(status.mock.calls[0]?.arguments[0], 201);
    const [filter, update] = updateOne.mock.calls[0]?.arguments as [
        Record<string, unknown>,
        { $set: { brandLogo: { width: number; height: number; data: Buffer } } },
    ];
    assert.deepEqual(filter, { _id: USER_ID });
    assert.equal(update.$set.brandLogo.width, 200);
    assert.equal(update.$set.brandLogo.height, 100);
    assert.ok(Buffer.isBuffer(update.$set.brandLogo.data));

    const body = payload(json) as { logo: { width: number }; previews: unknown[] };
    assert.equal(body.logo.width, 200);
    assert.equal(body.previews.length, 2);
});

test('removes the logo for the authenticated user', async () => {
    const updateOne = mock.method(user, 'updateOne', async () => ({
        matchedCount: 1,
    }));
    const { res, json } = response();

    await deleteBrandLogo(request(), res);

    assert.deepEqual(updateOne.mock.calls[0]?.arguments, [
        { _id: USER_ID },
        { $unset: { brandLogo: 1 } },
    ]);
    assert.deepEqual(payload(json), { success: true, logo: null, previews: [] });
});
