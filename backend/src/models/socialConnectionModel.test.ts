import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { SocialConnection } from './socialConnectionModel.js';

function connection(overrides: Record<string, unknown> = {}) {
    return new SocialConnection({
        userId: new mongoose.Types.ObjectId(),
        pageId: 'page-1',
        pageName: 'Page One',
        ...overrides,
    });
}

test('defaults a new Page to one 09:00 posting time', () => {
    assert.deepEqual([...connection().dailyTimes], ['09:00']);
});

test('accepts a valid schedule', () => {
    assert.equal(
        connection({ dailyTimes: ['09:00', '15:00'] }).validateSync(),
        undefined
    );
});

test('rejects an empty or oversized schedule', () => {
    assert.ok(connection({ dailyTimes: [] }).validateSync()?.errors.dailyTimes);
    const eleven = Array.from(
        { length: 11 },
        (_, index) => `${String(index + 8).padStart(2, '0')}:00`
    );
    assert.ok(
        connection({ dailyTimes: eleven }).validateSync()?.errors.dailyTimes
    );
});

test('rejects malformed posting times', () => {
    const error = connection({ dailyTimes: ['9:00'] }).validateSync();
    assert.ok(error?.errors['dailyTimes.0']);
});
