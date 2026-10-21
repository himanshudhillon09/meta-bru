import test from 'node:test';
import assert from 'node:assert/strict';
import { computeNextRunAt, isValidTimezone } from './timeService.js';

test('schedules later the same day in the connection timezone', () => {
    // 01:00 UTC is 06:30 in Asia/Kolkata.
    const from = new Date('2026-10-21T01:00:00.000Z');
    const next = computeNextRunAt('09:00', 'Asia/Kolkata', from);

    assert.equal(next.toISOString(), '2026-10-21T03:30:00.000Z');
});

test('rolls to the next day once the local time has passed', () => {
    // 04:00 UTC is 09:30 in Asia/Kolkata, past the 09:00 slot.
    const from = new Date('2026-10-21T04:00:00.000Z');
    const next = computeNextRunAt('09:00', 'Asia/Kolkata', from);

    assert.equal(next.toISOString(), '2026-10-22T03:30:00.000Z');
});

test('respects daylight saving time in New York', () => {
    // 2026-03-08 is the US spring-forward day. 07:00 UTC is 03:00 EDT.
    const from = new Date('2026-03-08T07:00:00.000Z');
    const next = computeNextRunAt('03:30', 'America/New_York', from);

    assert.equal(next.toISOString(), '2026-03-08T07:30:00.000Z');
});

test('returns a future date when the local time does not exist on a DST day', () => {
    // 02:30 does not exist on 2026-03-08 in New York.
    const from = new Date('2026-03-08T05:00:00.000Z');
    const next = computeNextRunAt('02:30', 'America/New_York', from);

    assert.ok(next.getTime() > from.getTime());
    assert.ok(Number.isFinite(next.getTime()));
});

test('rejects invalid daily times', () => {
    assert.throws(() => computeNextRunAt('25:00', 'UTC'), /Invalid daily time/);
    assert.throws(() => computeNextRunAt('09:99', 'UTC'), /Invalid daily time/);
    assert.throws(() => computeNextRunAt('nine', 'UTC'), /Invalid daily time/);
});

test('rejects invalid timezones', () => {
    assert.throws(
        () => computeNextRunAt('09:00', 'Not/A_Timezone'),
        /Invalid timezone/
    );
});

test('validates IANA timezone names', () => {
    assert.equal(isValidTimezone('Asia/Kolkata'), true);
    assert.equal(isValidTimezone('America/New_York'), true);
    assert.equal(isValidTimezone('Mars/Olympus_Mons'), false);
});
