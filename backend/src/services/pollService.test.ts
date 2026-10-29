import test from 'node:test';
import assert from 'node:assert/strict';

import { Deadline, pollUntil, type PollResult } from './pollService.js';

function fakeClock(start = 0) {
    let time = start;
    const sleeps: number[] = [];
    return {
        now: () => time,
        sleep: async (ms: number) => {
            sleeps.push(ms);
            time += ms;
        },
        sleeps,
    };
}

test('pollUntil returns the value as soon as a check is done', async () => {
    const clock = fakeClock();
    let calls = 0;

    const value = await pollUntil<string>(
        async (): Promise<PollResult<string>> => {
            calls += 1;
            return calls === 3 ? { done: true, value: 'ready' } : { done: false };
        },
        {
            intervalMs: 10_000,
            timeoutMs: 60_000,
            deadline: Deadline.after(600_000, clock),
        }
    );

    assert.equal(value, 'ready');
    assert.equal(calls, 3);
    assert.deepEqual(clock.sleeps, [10_000, 10_000]);
});

test('pollUntil gives up at its timeout after a final check', async () => {
    const clock = fakeClock();
    let calls = 0;

    const value = await pollUntil<string>(
        async () => {
            calls += 1;
            return { done: false };
        },
        {
            intervalMs: 10_000,
            timeoutMs: 25_000,
            deadline: Deadline.after(600_000, clock),
        }
    );

    assert.equal(value, null);
    assert.equal(calls, 4);
    assert.deepEqual(clock.sleeps, [10_000, 10_000, 5_000]);
});

test('pollUntil stops at the run deadline when it comes first', async () => {
    const clock = fakeClock();
    let calls = 0;

    const value = await pollUntil<string>(
        async () => {
            calls += 1;
            return { done: false };
        },
        {
            intervalMs: 10_000,
            timeoutMs: 60_000,
            deadline: Deadline.after(15_000, clock),
        }
    );

    assert.equal(value, null);
    assert.equal(calls, 3);
    assert.equal(clock.now(), 15_000);
});

test('a deadline expires on its clock', async () => {
    const clock = fakeClock(1_000);
    const deadline = Deadline.after(5_000, clock);

    assert.equal(deadline.endsAt, 6_000);
    assert.equal(deadline.expired(), false);
    await clock.sleep(5_000);
    assert.equal(deadline.expired(), true);
});
