import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { syncConnectionTimezones } = await import('./scheduleSyncService.js');
const { SocialConnection } = await import('../models/socialConnectionModel.js');

type MockableModel = Record<string, (...args: unknown[]) => unknown>;
const socialConnection = SocialConnection as unknown as MockableModel;

const USER_ID = '64b7f1c2a1b2c3d4e5f60719';
// 06:30 in Asia/Kolkata.
const NOW = new Date('2026-10-21T01:00:00.000Z');

afterEach(() => {
    mock.restoreAll();
});

function page(overrides: Record<string, unknown> = {}) {
    return {
        _id: 'c-active',
        isActive: true,
        tokenStatus: 'active',
        lockedAt: null,
        dailyTimes: ['09:00'],
        timezone: 'UTC',
        ...overrides,
    };
}

function mockConnections(pages: unknown[]) {
    const queries: unknown[] = [];
    const updates: Array<{ query: Record<string, unknown>; set: Record<string, unknown> }> = [];
    mock.method(socialConnection, 'find', async (query: unknown) => {
        queries.push(query);
        return pages;
    });
    mock.method(socialConnection, 'updateOne', async (query: unknown, update: unknown) => {
        updates.push({
            query: query as Record<string, unknown>,
            set: (update as { $set: Record<string, unknown> }).$set,
        });
        return {};
    });
    return { queries, updates };
}

test('moves only Pages on another timezone and reschedules active ones', async () => {
    const { queries, updates } = mockConnections([
        page(),
        page({ _id: 'c-paused', isActive: false }),
        page({ _id: 'c-disconnected', tokenStatus: 'disconnected' }),
        // Locked by the scheduler one minute ago.
        page({ _id: 'c-locked', lockedAt: new Date(NOW.getTime() - 60_000) }),
    ]);

    const rescheduled = await syncConnectionTimezones(USER_ID, 'Asia/Kolkata', NOW);

    assert.equal(rescheduled, 1);
    assert.deepEqual(queries[0], {
        userId: USER_ID,
        timezone: { $ne: 'Asia/Kolkata' },
    });
    assert.equal(updates.length, 4);
    for (const update of updates) {
        assert.equal(update.set.timezone, 'Asia/Kolkata');
        assert.equal(update.query.userId, USER_ID);
    }
    assert.deepEqual(updates[0]?.set.nextRunAt, new Date('2026-10-21T03:30:00.000Z'));
    for (const update of updates.slice(1)) {
        assert.equal('nextRunAt' in update.set, false);
    }
});

test('records an error when a stored schedule is invalid', async () => {
    const { updates } = mockConnections([page({ dailyTimes: ['9am'] })]);

    await syncConnectionTimezones(USER_ID, 'Asia/Kolkata', NOW);

    assert.equal(
        updates[0]?.set.lastError,
        'Saved posting schedule is invalid. Open Connections and save it again.'
    );
});

test('does nothing when every Page already uses the timezone', async () => {
    const { updates } = mockConnections([]);

    const rescheduled = await syncConnectionTimezones(USER_ID, 'Asia/Kolkata', NOW);

    assert.equal(rescheduled, 0);
    assert.equal(updates.length, 0);
});
