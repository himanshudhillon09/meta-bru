import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import type { AppError } from '../utils/errors.js';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { updateProfile } = await import('./authController.js');
const { User } = await import('../models/userModel.js');
const { SocialConnection } = await import('../models/socialConnectionModel.js');

type MockableModel = Record<string, (...args: unknown[]) => unknown>;
const userModel = User as unknown as MockableModel;
const socialConnection = SocialConnection as unknown as MockableModel;

const USER_ID = '64b7f1c2a1b2c3d4e5f60719';

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
    return { res: { json } as unknown as Response, json };
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
