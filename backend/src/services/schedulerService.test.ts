import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { runSchedulerTick } = await import('./schedulerService.js');
const { SocialConnection } = await import('../models/socialConnectionModel.js');
const { Post } = await import('../models/postModel.js');
const { User } = await import('../models/userModel.js');

type MockableModel = Record<string, (...args: unknown[]) => unknown>;

const CONNECTION_ID = '64b7f1c2a1b2c3d4e5f60718';
const USER_ID = '64b7f1c2a1b2c3d4e5f60719';
// 09:00 in Asia/Kolkata on 2026-10-21.
const NINE_IST = new Date('2026-10-21T03:30:00.000Z');

afterEach(() => {
    mock.restoreAll();
});

function dueConnection(
    overrides: Record<string, unknown> = {}
): Record<string, unknown> {
    const doc: Record<string, unknown> = {
        _id: CONNECTION_ID,
        userId: USER_ID,
        dailyTimes: ['09:00', '15:00', '21:00'],
        timezone: 'Asia/Kolkata',
        nextRunAt: NINE_IST,
        lastRunAt: null,
        lastError: '',
        ...overrides,
    };
    doc.save = async () => doc;
    return doc;
}

/** Mocks one scheduler pass over a single due connection with an empty queue. */
function mockTick(connection: Record<string, unknown>) {
    const claims: unknown[] = [];
    const releases: Array<Record<string, unknown>> = [];

    mock.method(Post as unknown as MockableModel, 'updateMany', async () => ({}));
    mock.method(SocialConnection as unknown as MockableModel, 'find', () => ({
        select: () => ({
            limit: async () => [{ _id: { toString: () => CONNECTION_ID } }],
        }),
    }));
    mock.method(
        SocialConnection as unknown as MockableModel,
        'findOneAndUpdate',
        () => ({ select: async () => connection })
    );
    mock.method(User as unknown as MockableModel, 'findById', () => ({
        select: async () => ({ isActive: true }),
    }));
    mock.method(
        Post as unknown as MockableModel,
        'findOneAndUpdate',
        async (query: unknown) => {
            claims.push(query);
            return null;
        }
    );
    mock.method(
        SocialConnection as unknown as MockableModel,
        'updateOne',
        async (_query: unknown, update: unknown) => {
            releases.push((update as { $set: Record<string, unknown> }).$set);
            return {};
        }
    );

    return { claims, releases };
}

function nextRunAt(release: Record<string, unknown> | undefined): string {
    return (release?.nextRunAt as Date).toISOString();
}

test('moves to the next posting time later the same day', async () => {
    const { claims, releases } = mockTick(dueConnection());

    await runSchedulerTick(new Date('2026-10-21T03:30:30.000Z'));

    assert.equal(claims.length, 1);
    // 15:00 IST.
    assert.equal(nextRunAt(releases[0]), '2026-10-21T09:30:00.000Z');
    assert.equal(releases[0]?.lastError, '');
});

test('moves to the first time tomorrow after the last slot', async () => {
    const { releases } = mockTick(
        // 21:00 IST.
        dueConnection({ nextRunAt: new Date('2026-10-21T15:30:00.000Z') })
    );

    await runSchedulerTick(new Date('2026-10-21T15:30:30.000Z'));

    assert.equal(nextRunAt(releases[0]), '2026-10-22T03:30:00.000Z');
});

test('collapses missed slots inside the grace window into one catch-up', async () => {
    // Down from before 09:00 until 10:30 IST: 09:00 and 10:00 were missed.
    const { claims, releases } = mockTick(
        dueConnection({ dailyTimes: ['09:00', '10:00', '15:00'] })
    );

    await runSchedulerTick(new Date('2026-10-21T05:00:00.000Z'));

    assert.equal(claims.length, 1);
    // The 10:00 slot is skipped; the next slot is 15:00 IST.
    assert.equal(nextRunAt(releases[0]), '2026-10-21T09:30:00.000Z');
});

test('skips a slot older than the grace window without publishing', async () => {
    const { claims, releases } = mockTick(dueConnection());

    // 13:30 IST, four and a half hours after the 09:00 slot.
    await runSchedulerTick(new Date('2026-10-21T08:00:00.000Z'));

    assert.equal(claims.length, 0);
    assert.equal(nextRunAt(releases[0]), '2026-10-21T09:30:00.000Z');
});

test('falls back and records an error when the stored schedule is invalid', async () => {
    const { releases } = mockTick(dueConnection({ dailyTimes: ['9am'] }));

    await runSchedulerTick(new Date('2026-10-21T03:30:30.000Z'));

    assert.equal(nextRunAt(releases[0]), '2026-10-22T03:30:00.000Z');
    assert.equal(
        releases[0]?.lastError,
        'Saved posting schedule is invalid. Open Connections and save it again.'
    );
});
