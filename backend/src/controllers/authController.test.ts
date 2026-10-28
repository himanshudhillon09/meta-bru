import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Response } from 'express';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { getMe, shouldRenewToken } = await import('./authController.js');
const { User } = await import('../models/userModel.js');

const USER_ID = '64b7f1c2a1b2c3d4e5f60719';
const DAY = 24 * 60 * 60;

type MockableModel = Record<string, (...args: unknown[]) => unknown>;
type FnMock = ReturnType<typeof mock.fn>;

const user = User as unknown as MockableModel;

function response(): { res: Response; json: FnMock } {
    const json = mock.fn();
    const res = { json } as unknown as Response & { status: FnMock };
    res.status = mock.fn(() => res);
    return { res, json };
}

function storedUser() {
    return {
        _id: { toString: () => USER_ID },
        name: 'Demo',
        email: 'demo@example.test',
        role: 'user',
        isActive: true,
        timezone: 'Asia/Kolkata',
        tokenVersion: 3,
        brandProfile: {},
        mustChangePassword: false,
    };
}

afterEach(() => {
    mock.restoreAll();
});

test('renews a token only once it is a day old', () => {
    const now = Date.UTC(2026, 9, 28, 12);
    const nowSeconds = now / 1000;

    assert.equal(shouldRenewToken(nowSeconds - 60, now), false);
    assert.equal(shouldRenewToken(nowSeconds - DAY + 1, now), false);
    assert.equal(shouldRenewToken(nowSeconds - DAY, now), true);
    assert.equal(shouldRenewToken(nowSeconds - 20 * DAY, now), true);
    assert.equal(shouldRenewToken(undefined, now), false);
});

test('getMe returns a fresh token for a day-old session', async () => {
    mock.method(user, 'findById', async () => storedUser());
    const { res, json } = response();
    const issuedAt = Math.floor(Date.now() / 1000) - 2 * DAY;

    await getMe({ user: { id: USER_ID }, tokenIssuedAt: issuedAt }, res);

    const body = json.mock.calls[0]?.arguments[0] as {
        success: boolean;
        token?: string;
    };
    assert.equal(body.success, true);
    assert.ok(body.token, 'a renewed token is returned');

    const decoded = jwt.verify(body.token, process.env.JWT_SECRET!) as {
        id: string;
        tokenVersion: number;
        iat: number;
        exp: number;
    };
    assert.equal(decoded.id, USER_ID);
    assert.equal(decoded.tokenVersion, 3);
    assert.ok(decoded.iat > issuedAt);
    assert.ok(decoded.exp - decoded.iat >= 7 * DAY);
});

test('getMe does not reissue a recent token', async () => {
    mock.method(user, 'findById', async () => storedUser());
    const { res, json } = response();

    await getMe(
        { user: { id: USER_ID }, tokenIssuedAt: Math.floor(Date.now() / 1000) - 60 },
        res
    );

    const body = json.mock.calls[0]?.arguments[0] as { token?: string };
    assert.equal(body.token, undefined);
});
