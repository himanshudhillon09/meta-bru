import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppError } from '../utils/errors.js';
import {
    INVALID_SCHEDULE_MESSAGE,
    MAX_DAILY_SLOTS,
    computeNextSlot,
    nextSlotOrFallback,
    normalizeDailyTimes,
    suggestDailyTimes,
} from './scheduleService.js';

function scheduleError(message: string) {
    return (error: unknown) => {
        const appError = error as AppError;
        assert.equal(appError.statusCode, 400);
        assert.equal(appError.code, 'INVALID_SCHEDULE');
        assert.equal(appError.message, message);
        return true;
    };
}

test('sorts posting times', () => {
    assert.deepEqual(normalizeDailyTimes(['21:00', '09:00', '15:00']), [
        '09:00',
        '15:00',
        '21:00',
    ]);
});

test('rejects an empty schedule', () => {
    assert.throws(
        () => normalizeDailyTimes([]),
        scheduleError('Add at least one posting time.')
    );
});

test('rejects more than ten times a day', () => {
    const times = Array.from(
        { length: 11 },
        (_, index) => `${String(index + 8).padStart(2, '0')}:00`
    );
    assert.throws(
        () => normalizeDailyTimes(times),
        scheduleError('A Page can post at most 10 times a day.')
    );
});

test('rejects malformed times', () => {
    assert.throws(
        () => normalizeDailyTimes(['9:00']),
        scheduleError('9:00 is not a valid time. Use HH:mm.')
    );
    assert.throws(
        () => normalizeDailyTimes(['24:00']),
        scheduleError('24:00 is not a valid time. Use HH:mm.')
    );
});

test('rejects duplicate times', () => {
    assert.throws(
        () => normalizeDailyTimes(['14:00', '09:00', '14:00']),
        scheduleError('14:00 is listed twice.')
    );
});

test('requires fifteen minutes between times', () => {
    assert.throws(
        () => normalizeDailyTimes(['14:10', '14:00']),
        scheduleError('Times must be at least 15 minutes apart (14:00 and 14:10).')
    );
    assert.deepEqual(normalizeDailyTimes(['14:15', '14:00']), ['14:00', '14:15']);
});

test('checks the gap across midnight', () => {
    assert.throws(
        () => normalizeDailyTimes(['23:55', '00:05']),
        scheduleError('Times must be at least 15 minutes apart (23:55 and 00:05).')
    );
});

test('picks the next time later the same day', () => {
    // 04:00 UTC is 09:30 in Asia/Kolkata.
    const next = computeNextSlot(
        ['09:00', '15:00', '21:00'],
        'Asia/Kolkata',
        new Date('2026-10-21T04:00:00.000Z')
    );
    assert.equal(next.toISOString(), '2026-10-21T09:30:00.000Z');
});

test('rolls to the first time tomorrow after the last slot', () => {
    // 16:00 UTC is 21:30 in Asia/Kolkata.
    const next = computeNextSlot(
        ['09:00', '15:00', '21:00'],
        'Asia/Kolkata',
        new Date('2026-10-21T16:00:00.000Z')
    );
    assert.equal(next.toISOString(), '2026-10-22T03:30:00.000Z');
});

test('moves past a slot that is due exactly now', () => {
    // 09:30 UTC is exactly 15:00 in Asia/Kolkata.
    const next = computeNextSlot(
        ['09:00', '15:00', '21:00'],
        'Asia/Kolkata',
        new Date('2026-10-21T09:30:00.000Z')
    );
    assert.equal(next.toISOString(), '2026-10-21T15:30:00.000Z');
});

test('uses the daylight-saving offset after a transition', () => {
    // 13:00 UTC on 2026-03-08 is 09:00 EDT, after spring-forward.
    const next = computeNextSlot(
        ['08:00', '20:00'],
        'America/New_York',
        new Date('2026-03-08T13:00:00.000Z')
    );
    assert.equal(next.toISOString(), '2026-03-09T00:00:00.000Z');
});

test('returns the next slot with no error for a valid schedule', () => {
    const result = nextSlotOrFallback(
        ['09:00'],
        'Asia/Kolkata',
        new Date('2026-10-21T01:00:00.000Z')
    );
    assert.equal(result.nextRunAt.toISOString(), '2026-10-21T03:30:00.000Z');
    assert.equal(result.error, '');
});

test('falls back to 09:00 in the default timezone for bad stored data', () => {
    const from = new Date('2026-10-21T01:00:00.000Z');
    for (const [times, timezone] of [
        [['9am'], 'Asia/Kolkata'],
        [['09:00'], 'Mars/Base'],
        [undefined, 'Asia/Kolkata'],
    ] as const) {
        const result = nextSlotOrFallback(times, timezone, from);
        assert.equal(result.nextRunAt.toISOString(), '2026-10-21T03:30:00.000Z');
        assert.equal(result.error, INVALID_SCHEDULE_MESSAGE);
    }
});

test('suggests evenly spaced times between 09:00 and 21:00', () => {
    assert.deepEqual(suggestDailyTimes(1), ['09:00']);
    assert.deepEqual(suggestDailyTimes(2), ['09:00', '21:00']);
    assert.deepEqual(suggestDailyTimes(3), ['09:00', '15:00', '21:00']);
    assert.deepEqual(suggestDailyTimes(4), ['09:00', '13:00', '17:00', '21:00']);
});

test('every suggestion is a valid schedule and counts are clamped', () => {
    for (let count = 1; count <= MAX_DAILY_SLOTS; count += 1) {
        const times = suggestDailyTimes(count);
        assert.equal(times.length, count);
        assert.deepEqual(normalizeDailyTimes(times), times);
    }
    assert.deepEqual(suggestDailyTimes(0), ['09:00']);
    assert.equal(suggestDailyTimes(99).length, MAX_DAILY_SLOTS);
});
