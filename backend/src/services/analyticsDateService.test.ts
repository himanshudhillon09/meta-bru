import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const {
    MAX_RANGE_DAYS,
    parseAnalyticsRange,
    buildAnalyticsBuckets,
    bucketKeyForDate,
    toIstWeekLabel,
    istWeekday,
    istHourBlock,
} = await import('./analyticsDateService.js');

const DAY_MS = 24 * 60 * 60 * 1000;
const istDayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });

function istDayKey(date: Date): string {
    return istDayFormatter.format(date);
}

// IST has no DST, so offsetting from an IST midnight by whole days is exact.
function istDayKeyOffset(baseKey: string, days: number): string {
    const base = new Date(`${baseKey}T00:00:00+05:30`);
    return istDayKey(new Date(base.getTime() + days * DAY_MS));
}

test('converts an IST day to inclusive UTC boundaries', () => {
    const range = parseAnalyticsRange('2025-01-15', '2025-01-15');
    assert.equal(range.from.toISOString(), '2025-01-14T18:30:00.000Z');
    assert.equal(range.to.toISOString(), '2025-01-15T18:29:59.999Z');
    assert.equal(range.fromKey, '2025-01-15');
    assert.equal(range.toKey, '2025-01-15');
});

test('builds exact daily bucket keys, labels, and inclusive boundaries', () => {
    const range = parseAnalyticsRange('2025-01-15', '2025-01-17');
    const buckets = buildAnalyticsBuckets(range);

    assert.deepEqual(
        buckets.map((bucket) => ({
            key: bucket.key,
            label: bucket.label,
            start: bucket.start.toISOString(),
            end: bucket.end.toISOString(),
        })),
        [
            {
                key: '2025-01-15',
                label: '15 Jan',
                start: '2025-01-14T18:30:00.000Z',
                end: '2025-01-15T18:29:59.999Z',
            },
            {
                key: '2025-01-16',
                label: '16 Jan',
                start: '2025-01-15T18:30:00.000Z',
                end: '2025-01-16T18:29:59.999Z',
            },
            {
                key: '2025-01-17',
                label: '17 Jan',
                start: '2025-01-16T18:30:00.000Z',
                end: '2025-01-17T18:29:59.999Z',
            },
        ]
    );
});

test('uses daily buckets up to 60 days and weekly buckets after that', () => {
    const daily = parseAnalyticsRange('2025-01-01', '2025-03-01'); // 60 days inclusive
    const weekly = parseAnalyticsRange('2025-01-01', '2025-03-02'); // 61 days inclusive

    assert.equal(daily.granularity, 'day');
    assert.equal(weekly.granularity, 'week');
    assert.equal(buildAnalyticsBuckets(daily).length, 60);
    assert.equal(buildAnalyticsBuckets(weekly).length, 9);
});

test('anchors weekly buckets to Monday in IST', () => {
    assert.equal(
        bucketKeyForDate(new Date('2026-10-18T18:29:59.999Z'), 'week'),
        '2026-10-12'
    ); // Sunday 23:59:59.999 IST
    assert.equal(
        bucketKeyForDate(new Date('2026-10-18T18:30:00.000Z'), 'week'),
        '2026-10-19'
    ); // Monday 00:00 IST

    const weekly = parseAnalyticsRange('2025-01-01', '2025-06-01');
    const buckets = buildAnalyticsBuckets(weekly);

    assert.equal(weekly.granularity, 'week');
    assert.equal(buckets.length, 22);
    assert.equal(buckets[0].key, '2024-12-30');
    assert.equal(buckets[0].label, 'Week of 30 Dec');
    assert.equal(buckets[0].start.toISOString(), '2024-12-29T18:30:00.000Z');

    // A non-Monday key still labels the week by its Monday.
    assert.equal(toIstWeekLabel('2025-01-01'), 'Week of 30 Dec');
});

test('clamps a future to date to today in IST, including end of day', () => {
    const now = new Date();
    const todayKey = istDayKey(now);
    const fromKey = istDayKey(new Date(now.getTime() - DAY_MS));
    const range = parseAnalyticsRange(fromKey, '2999-01-01');

    assert.equal(range.toKey, todayKey);
    assert.equal(
        range.to.toISOString(),
        new Date(`${todayKey}T23:59:59.999+05:30`).toISOString()
    );
});

test('rejects reversed ranges', () => {
    assert.throws(() => parseAnalyticsRange('2025-01-16', '2025-01-15'), /before/);
});

test('rejects a from date after today in IST', () => {
    const now = new Date();
    const tomorrowKey = istDayKey(new Date(now.getTime() + DAY_MS));

    assert.throws(() => parseAnalyticsRange(tomorrowKey, tomorrowKey), /today/);
});

test('rejects ranges longer than 730 days', () => {
    const now = new Date();
    const todayKey = istDayKey(now);
    const fromKey = istDayKey(new Date(now.getTime() - 800 * DAY_MS));

    assert.throws(() => parseAnalyticsRange(fromKey, todayKey), /730/);
});

test('accepts an inclusive range of exactly 730 days', () => {
    const todayKey = istDayKey(new Date());
    const fromKey = istDayKeyOffset(todayKey, -(MAX_RANGE_DAYS - 1));
    const range = parseAnalyticsRange(fromKey, todayKey);

    assert.equal(range.fromKey, fromKey);
    assert.equal(range.toKey, todayKey);
    assert.equal(range.granularity, 'week');
});

test('rejects an inclusive range of 731 days', () => {
    const todayKey = istDayKey(new Date());
    const fromKey = istDayKeyOffset(todayKey, -MAX_RANGE_DAYS);

    assert.throws(() => parseAnalyticsRange(fromKey, todayKey), /730/);
});

test('rejects non-canonical or impossible day strings', () => {
    const invalidPairs: Array<[string, string]> = [
        ['', '2025-01-15'],
        ['   ', '2025-01-15'],
        ['2026-02-30', '2026-03-01'],
        ['2026-10', '2026-10-24'],
        ['2026-10-24T00:00:00Z', '2026-10-25'],
        ['20261024', '20261025'],
        ['2026-W43', '2026-W44'],
        ['2026-297', '2026-300'],
        ['2025-01-15', '2026-02-30'],
        ['2025-01-15', '2025-01'],
        ['2025-01-15', '2025-01-15T00:00:00Z'],
    ];

    for (const [from, to] of invalidPairs) {
        assert.throws(
            () => parseAnalyticsRange(from, to),
            /valid YYYY-MM-DD/,
            `expected ${JSON.stringify(from)}..${JSON.stringify(to)} to be rejected`
        );
    }
});

test('groups by IST weekday and three-hour block', () => {
    const lateWednesday = new Date('2026-10-21T15:30:00.000Z'); // 21:00 IST Wed
    assert.equal(istWeekday(lateWednesday), 3);
    assert.equal(istHourBlock(lateWednesday), 7);
    assert.equal(bucketKeyForDate(lateWednesday, 'day'), '2026-10-21');
});
