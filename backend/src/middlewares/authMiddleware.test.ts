import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { protect } = await import('./authMiddleware.js');
const { User } = await import('../models/userModel.js');

const USER_ID = '64b7f1c2a1b2c3d4e5f60719';
const SECRET = process.env.JWT_SECRET;

type MockableModel = Record<string, (...args: unknown[]) => unknown>;
type FnMock = ReturnType<typeof mock.fn>;

const user = User as unknown as MockableModel;

function request(token?: string): Request & { tokenIssuedAt?: number } {
    return {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        originalUrl: '/api/posts',
        method: 'GET',
    } as unknown as Request;
}

function response(): { res: Response; status: FnMock; json: FnMock } {
    const json = mock.fn();
    const res = { json } as unknown as Response & { status: FnMock };
    const status = mock.fn(() => res);
    res.status = status;
    return { res, status, json };
}

function sign(payload: Record<string, unknown>, options: jwt.SignOptions = {}) {
    return jwt.sign(payload, SECRET, { expiresIn: '30d', ...options });
}

function activeUser(overrides: Record<string, unknown> = {}) {
    return {
        _id: USER_ID,
        isActive: true,
        tokenVersion: 0,
        mustChangePassword: false,
        ...overrides,
    };
}

function sentCode(json: FnMock): unknown {
    return (json.mock.calls[0]?.arguments[0] as { code?: string })?.code;
}

afterEach(() => {
    mock.restoreAll();
});

test('rejects a request without a token', async () => {
    const { res, status, json } = response();
    const next = mock.fn();

    await protect(request(), res, next as unknown as NextFunction);

    assert.equal(status.mock.calls[0]?.arguments[0], 401);
    assert.equal(sentCode(json), 'TOKEN_MISSING');
    assert.equal(next.mock.callCount(), 0);
});

test('rejects a malformed token', async () => {
    const { res, status, json } = response();

    await protect(request('not-a-jwt'), res, mock.fn() as unknown as NextFunction);

    assert.equal(status.mock.calls[0]?.arguments[0], 401);
    assert.equal(sentCode(json), 'TOKEN_INVALID');
});

test('reports an expired token distinctly', async () => {
    const token = sign(
        { id: USER_ID, tokenVersion: 0, iat: Math.floor(Date.now() / 1000) - 120 },
        { expiresIn: 60 }
    );
    const { res, status, json } = response();

    await protect(request(token), res, mock.fn() as unknown as NextFunction);

    assert.equal(status.mock.calls[0]?.arguments[0], 401);
    assert.equal(sentCode(json), 'TOKEN_EXPIRED');
});

test('a database failure is a server error, not a signed-out session', async () => {
    mock.method(user, 'findById', async () => {
        throw new Error('MongoNetworkError: connection reset');
    });
    const { res, status } = response();
    const next = mock.fn();

    await assert.rejects(
        () => protect(request(sign({ id: USER_ID, tokenVersion: 0 })), res, next as unknown as NextFunction),
        /connection reset/
    );
    assert.equal(status.mock.callCount(), 0);
    assert.equal(next.mock.callCount(), 0);
});

test('blocks a deactivated account with a dedicated code', async () => {
    mock.method(user, 'findById', async () => activeUser({ isActive: false }));
    const { res, status, json } = response();

    await protect(request(sign({ id: USER_ID, tokenVersion: 0 })), res, mock.fn() as unknown as NextFunction);

    assert.equal(status.mock.calls[0]?.arguments[0], 403);
    assert.equal(sentCode(json), 'ACCOUNT_INACTIVE');
});

test('rejects a token revoked by a password change', async () => {
    mock.method(user, 'findById', async () => activeUser({ tokenVersion: 2 }));
    const { res, status, json } = response();

    await protect(request(sign({ id: USER_ID, tokenVersion: 1 })), res, mock.fn() as unknown as NextFunction);

    assert.equal(status.mock.calls[0]?.arguments[0], 401);
    assert.equal(sentCode(json), 'SESSION_REVOKED');
});

test('accepts a valid token and records when it was issued', async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - 3_600;
    mock.method(user, 'findById', async () => activeUser());
    const req = request(sign({ id: USER_ID, tokenVersion: 0, iat: issuedAt }));
    const { res, status } = response();
    const next = mock.fn();

    await protect(req, res, next as unknown as NextFunction);

    assert.equal(next.mock.callCount(), 1);
    assert.equal(status.mock.callCount(), 0);
    assert.equal(req.tokenIssuedAt, issuedAt);
});
