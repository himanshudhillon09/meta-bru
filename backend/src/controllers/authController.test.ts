import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { AppError } from '../utils/errors.js';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { getMe, shouldRenewToken, updateProfile } = await import(
    './authController.js'
);
const { User } = await import('../models/userModel.js');
const { SocialConnection } = await import('../models/socialConnectionModel.js');

type MockableModel = Record<string, (...args: unknown[]) => unknown>;
const userModel = User as unknown as MockableModel;
const socialConnection = SocialConnection as unknown as MockableModel;

const USER_ID = '64b7f1c2a1b2c3d4e5f60719';
const DAY = 24 * 60 * 60;

afterEach(() => {
    mock.restoreAll();
});

function mockUser(): Record<string, unknown> {
    const user: Record<string, unknown> = {
        _id: USER_ID,
        name: 'Byte Horizon',
        email: 'owner@example.com',
        role: 'user',
        isActive: true,
        timezone: 'Asia/Kolkata',
        brandProfile: {},
    };
    user.save = async () => user;
    mock.method(userModel, 'findById', async () => user);
    return user;
}

function request(body: Record<string, unknown>): Request {
    return { user: { id: USER_ID }, body } as unknown as Request;
}

function response() {
    const json = mock.fn();
    const res = { json } as unknown as Response & {
        status: ReturnType<typeof mock.fn>;
    };
    res.status = mock.fn(() => res);
    return { res: res as Response, json };
}

function bodyOf(json: ReturnType<typeof mock.fn>): Record<string, unknown> {
    const call = json.mock.calls[0];
    assert.ok(call);
    return call.arguments[0] as Record<string, unknown>;
}

test('updateProfile moves Pages to a new timezone', async () => {
    const user = mockUser();
    mock.method(socialConnection, 'find', async () => [
        {
            _id: 'c1',
            isActive: true,
            tokenStatus: 'active',
            lockedAt: null,
            dailyTimes: ['09:00'],
            timezone: 'Asia/Kolkata',
        },
    ]);
    const updates: Array<Record<string, unknown>> = [];
    mock.method(socialConnection, 'updateOne', async (_q: unknown, update: unknown) => {
        updates.push((update as { $set: Record<string, unknown> }).$set);
        return {};
    });

    const { res, json } = response();
    await updateProfile(request({ timezone: 'America/New_York' }), res);

    assert.equal(user.timezone, 'America/New_York');
    assert.equal(bodyOf(json).rescheduledPages, 1);
    assert.equal(updates[0]?.timezone, 'America/New_York');
    assert.ok(updates[0]?.nextRunAt instanceof Date);
});

test('updateProfile reports Pages it could not reschedule', async () => {
    mockUser();
    mock.method(socialConnection, 'find', async () => {
        throw new Error('database unavailable');
    });

    await assert.rejects(
        updateProfile(request({ timezone: 'America/New_York' }), response().res),
        (error: unknown) => (error as AppError).code === 'RESCHEDULE_FAILED'
    );
});

test('updateProfile without a timezone leaves Pages alone', async () => {
    mockUser();
    const find = mock.method(socialConnection, 'find', async () => []);

    const { res, json } = response();
    await updateProfile(request({ name: 'New Name' }), res);

    assert.equal(find.mock.callCount(), 0);
    assert.equal('rescheduledPages' in bodyOf(json), false);
});

function mockTokenUser(): void {
    mock.method(userModel, 'findById', async () => ({
        _id: { toString: () => USER_ID },
        name: 'Demo',
        email: 'demo@example.test',
        role: 'user',
        isActive: true,
        timezone: 'Asia/Kolkata',
        tokenVersion: 3,
        brandProfile: {},
        mustChangePassword: false,
    }));
}

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
    mockTokenUser();
    const { res, json } = response();
    const issuedAt = Math.floor(Date.now() / 1000) - 2 * DAY;

    await getMe({ user: { id: USER_ID }, tokenIssuedAt: issuedAt }, res);

    const body = bodyOf(json) as { success: boolean; token?: string };
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
    mockTokenUser();
    const { res, json } = response();

    await getMe(
        { user: { id: USER_ID }, tokenIssuedAt: Math.floor(Date.now() / 1000) - 60 },
        res
    );

    assert.equal(bodyOf(json).token, undefined);
});

test('updateProfile saves the Gemini model for each AI feature', async () => {
    const user = mockUser();
    const { res, json } = response();

    await updateProfile(
        request({ aiModels: { text: 'models/gemini-2.5-pro', image: 'gemini-3.1-flash-lite-image' } }),
        res
    );

    assert.deepEqual(user.aiModels, {
        text: 'gemini-2.5-pro',
        image: 'gemini-3.1-flash-lite-image',
    });
    const body = bodyOf(json);
    assert.deepEqual((body.user as Record<string, unknown>).aiModels, {
        text: 'gemini-2.5-pro',
        image: 'gemini-3.1-flash-lite-image',
    });
});

test('updateProfile clears one model back to the default and keeps the other', async () => {
    const user = mockUser();
    user.aiModels = { text: 'gemini-2.5-pro', image: 'gemini-3-pro-image' };
    const { res } = response();

    await updateProfile(request({ aiModels: { text: '' } }), res);

    assert.deepEqual(user.aiModels, { text: '', image: 'gemini-3-pro-image' });
});

test('updateProfile rejects a model id that is not a Gemini model name', async () => {
    mockUser();
    const { res } = response();

    await assert.rejects(
        () => updateProfile(request({ aiModels: { image: '../models/x?key=1' } }), res),
        (error: unknown) => (error as AppError).code === 'VALIDATION_ERROR'
    );
});
