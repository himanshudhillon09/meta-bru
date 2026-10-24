import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const {
    parseAnalyticsRange,
    buildAnalyticsBuckets,
    bucketKeyForDate,
    istWeekday,
    istHourBlock,
} = await import('./analyticsDateService.js');

test('converts an IST day to inclusive UTC boundaries', () => {
    const range = parseAnalyticsRange('2026-10-24', '2026-10-24');
    assert.equal(range.from.toISOString(), '2026-10-23T18:30:00.000Z');
    assert.equal(range.to.toISOString(), '2026-10-24T18:29:59.999Z');
});

test('rejects reversed and oversized ranges', () => {
    assert.throws(() => parseAnalyticsRange('2026-10-25', '2026-10-24'), /before/);
    assert.throws(
        () => parseAnalyticsRange('2024-01-01', '2026-10-24'),
        /730/
    );
});

test('uses daily buckets up to 60 days and weekly buckets after that', () => {
    const daily = parseAnalyticsRange('2026-01-01', '2026-01-30');
    const weekly = parseAnalyticsRange('2026-01-01', '2026-06-01');

    assert.equal(daily.granularity, 'day');
    assert.equal(weekly.granularity, 'week');
    assert.equal(buildAnalyticsBuckets(daily).length, 30);
    assert.equal(buildAnalyticsBuckets(weekly).length, 23);
});

test('clamps a future to date to today in IST', () => {
    const now = new Date();
    const todayKey = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
    }).format(now);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const fromKey = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
    }).format(yesterday);
    const range = parseAnalyticsRange(fromKey, '2999-01-01');
    assert.equal(range.toKey, todayKey);
});

test('groups by IST weekday and three-hour block', () => {
    const lateWednesday = new Date('2026-10-21T15:30:00.000Z'); // 21:00 IST Wed
    assert.equal(istWeekday(lateWednesday), 3);
    assert.equal(istHourBlock(lateWednesday), 7);
    assert.equal(bucketKeyForDate(lateWednesday, 'day'), '2026-10-21');
});
