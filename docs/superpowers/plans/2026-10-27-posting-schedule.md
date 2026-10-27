# Posting Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each Facebook Page publish from its queue 1–10 times a day at times the user picks, all in the user's Profile timezone.

**Architecture:** Each `SocialConnection` gets `dailyTimes: string[]` in place of `dailyTime`. `nextRunAt` keeps meaning "the next due slot", now the earliest upcoming time in the list, so the scheduler's locking and claim logic stay the same. Pure schedule rules live in `scheduleService`; database work (Profile timezone sync and the startup migration) lives in `scheduleSyncService`.

**Tech Stack:** Node 22, Express 5, Mongoose 9, Luxon, Zod 4, `node:test` with `tsx`; Next.js 16, React 19, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-10-27-posting-schedule-design.md`

**Working directory:** `/Users/himanshudhillon/Development/meta-bru/.worktrees/post-analytics` (branch `fix/analytics-reconnect-insights`). Commits use the repo-local identity `Himanshu Dhillon <himanshu.dhillon09@gmail.com>`. Do not push.

**Conventions:**

- Backend tests: `cd backend && node --import tsx --test <file>`; full suite `cd backend && npm test`.
- Backend types: `cd backend && npx tsc --noEmit -p .` (test files are excluded from `tsc`).
- Frontend checks: `cd frontend && npx tsc --noEmit -p .`, `npx eslint src` (0 errors expected; warnings already exist), `./node_modules/.bin/next build`.
- Test files that import code reaching `config/env.ts` must set `JWT_SECRET` and `TOKEN_ENCRYPTION_KEY` before a dynamic `import()`, as the existing tests do.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `backend/src/services/scheduleService.ts` (new) | Pure rules: limits, validation, next slot, suggestions, safe fallback. No DB, no `env` import. |
| `backend/src/services/scheduleService.test.ts` (new) | Unit tests for the rules. |
| `backend/src/services/scheduleSyncService.ts` (new) | `syncConnectionTimezones` and `migrateConnectionSchedules`. |
| `backend/src/services/scheduleSyncService.test.ts` (new) | Sync and migration tests with model mocks. |
| `backend/src/models/socialConnectionModel.ts` | Add `dailyTimes`; remove `dailyTime` in Task 6. |
| `backend/src/models/socialConnectionModel.test.ts` (new) | Schema validation for `dailyTimes`. |
| `backend/src/services/schedulerService.ts` | Advance through `dailyTimes`; fall back on bad data. |
| `backend/src/services/schedulerService.test.ts` (new) | Multi-slot, missed-slot, and fallback behavior. |
| `backend/src/controllers/connectionController.ts` | Accept `dailyTimes`; Profile timezone on Meta login; drop OAuth timezone. |
| `backend/src/controllers/connectionController.test.ts` | Update fixtures; add schedule tests. |
| `backend/src/controllers/authController.ts` | Sync Page timezones on profile save. |
| `backend/src/controllers/authController.test.ts` (new) | Profile timezone sync tests. |
| `backend/src/index.ts` | Run the migration before the scheduler starts. |
| `frontend/src/lib/schedule.ts` (new) | Mirror of the rules for instant feedback, plus `addSlot` and `formatDailyTimes`. |
| `frontend/src/lib/types.ts` | `dailyTimes` on `SocialConnection`. |
| `frontend/src/lib/apiClient.ts` | `connectionsApi.start()` without a timezone. |
| `frontend/src/components/ConnectionCard.tsx` | Posting schedule editor. |
| `frontend/src/components/Dashboards.tsx` | Show the times list. |
| `frontend/src/app/connections/page.tsx` | Stop sending a timezone. |
| `frontend/src/app/settings/page.tsx` | Timezone help text and reschedule notice. |

Task order keeps every commit compiling: `dailyTime` stays in the model until Task 6, after every backend consumer has moved to `dailyTimes`.

---

### Task 1: Schedule rules (`scheduleService`)

**Files:**
- Create: `backend/src/services/scheduleService.ts`
- Test: `backend/src/services/scheduleService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/services/scheduleService.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --import tsx --test src/services/scheduleService.test.ts`
Expected: FAIL with `Cannot find module './scheduleService.js'`.

- [ ] **Step 3: Implement `scheduleService`**

Create `backend/src/services/scheduleService.ts`:

```ts
import { AppError } from '../utils/errors.js';
import { computeNextRunAt } from './timeService.js';

export const MAX_DAILY_SLOTS = 10;
export const MIN_SLOT_GAP_MINUTES = 15;
export const DEFAULT_DAILY_TIME = '09:00';
export const DAILY_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const INVALID_SCHEDULE_MESSAGE =
    'Saved posting schedule is invalid. Open Connections and save it again.';

// Mirrors env.defaultTimezone without importing env, so the connection model
// can use these rules without requiring server secrets.
export const DEFAULT_TIMEZONE =
    process.env.APP_DEFAULT_TIMEZONE || 'Asia/Kolkata';

const MINUTES_PER_DAY = 24 * 60;
const SUGGESTION_START = 9 * 60;
const SUGGESTION_END = 21 * 60;

function invalid(message: string): AppError {
    return new AppError(400, message, 'INVALID_SCHEDULE');
}

function toMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return (hours ?? 0) * 60 + (minutes ?? 0);
}

function fromMinutes(total: number): string {
    const minutes =
        ((total % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    const hours = Math.floor(minutes / 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Validates a Page's posting times and returns them sorted. Throws a 400
 * `INVALID_SCHEDULE` error with a message the user can act on.
 */
export function normalizeDailyTimes(times: readonly unknown[]): string[] {
    if (times.length === 0) {
        throw invalid('Add at least one posting time.');
    }
    if (times.length > MAX_DAILY_SLOTS) {
        throw invalid(`A Page can post at most ${MAX_DAILY_SLOTS} times a day.`);
    }

    const sorted: string[] = [];
    for (const time of times) {
        if (typeof time !== 'string' || !DAILY_TIME_PATTERN.test(time)) {
            throw invalid(`${String(time)} is not a valid time. Use HH:mm.`);
        }
        sorted.push(time);
    }
    sorted.sort();

    for (let index = 1; index < sorted.length; index += 1) {
        if (sorted[index] === sorted[index - 1]) {
            throw invalid(`${sorted[index]} is listed twice.`);
        }
    }

    if (sorted.length > 1) {
        // Include the gap from the last time today to the first time tomorrow.
        for (let index = 0; index < sorted.length; index += 1) {
            const current = sorted[index] as string;
            const next = sorted[(index + 1) % sorted.length] as string;
            const gap =
                (toMinutes(next) - toMinutes(current) + MINUTES_PER_DAY) %
                MINUTES_PER_DAY;
            if (gap < MIN_SLOT_GAP_MINUTES) {
                throw invalid(
                    `Times must be at least ${MIN_SLOT_GAP_MINUTES} minutes apart (${current} and ${next}).`
                );
            }
        }
    }

    return sorted;
}

/** The earliest occurrence of any posting time strictly after `from`. */
export function computeNextSlot(
    times: readonly string[],
    timezone: string,
    from: Date = new Date()
): Date {
    let earliest: Date | null = null;
    for (const time of times) {
        const candidate = computeNextRunAt(time, timezone, from);
        if (!earliest || candidate < earliest) earliest = candidate;
    }
    if (!earliest) throw new Error('A schedule needs at least one time');
    return earliest;
}

/**
 * The next slot for stored data. A corrupt schedule or timezone must never
 * stop the scheduler, so it falls back to 09:00 in the default timezone and
 * reports an error for the Page.
 */
export function nextSlotOrFallback(
    times: unknown,
    timezone: string,
    from: Date = new Date()
): { nextRunAt: Date; error: string } {
    try {
        const normalized = normalizeDailyTimes(Array.isArray(times) ? times : []);
        return {
            nextRunAt: computeNextSlot(normalized, timezone, from),
            error: '',
        };
    } catch {
        return {
            nextRunAt: computeNextSlot([DEFAULT_DAILY_TIME], DEFAULT_TIMEZONE, from),
            error: INVALID_SCHEDULE_MESSAGE,
        };
    }
}

/** Evenly spaced times from 09:00 to 21:00, rounded to 5 minutes. */
export function suggestDailyTimes(count: number): string[] {
    const total = Math.min(MAX_DAILY_SLOTS, Math.max(1, Math.floor(count)));
    if (total === 1) return [DEFAULT_DAILY_TIME];
    const step = (SUGGESTION_END - SUGGESTION_START) / (total - 1);
    return Array.from({ length: total }, (_, index) =>
        fromMinutes(Math.round((SUGGESTION_START + step * index) / 5) * 5)
    );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --import tsx --test src/services/scheduleService.test.ts`
Expected: all tests pass, `# fail 0`.

- [ ] **Step 5: Type-check and commit**

Run: `cd backend && npx tsc --noEmit -p .`
Expected: no output.

```bash
git add backend/src/services/scheduleService.ts backend/src/services/scheduleService.test.ts
git commit -m "feat: add posting schedule rules

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add `dailyTimes` to the connection model

`dailyTime` stays for now so the scheduler and controller still compile. Task 6 removes it.

**Files:**
- Modify: `backend/src/models/socialConnectionModel.ts`
- Test: `backend/src/models/socialConnectionModel.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/models/socialConnectionModel.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --import tsx --test src/models/socialConnectionModel.test.ts`
Expected: FAIL; `dailyTimes` is `undefined`.

- [ ] **Step 3: Add the field**

In `backend/src/models/socialConnectionModel.ts`, add the import under `import mongoose from 'mongoose';`:

```ts
import {
    DAILY_TIME_PATTERN,
    DEFAULT_DAILY_TIME,
    MAX_DAILY_SLOTS,
} from '../services/scheduleService.js';
```

In `ISocialConnection`, replace

```ts
    dailyTime: string;
```

with

```ts
    /** Legacy single posting time. Removed after the schedule migration. */
    dailyTime: string;
    /** Sorted daily posting times (HH:mm) in `timezone`. */
    dailyTimes: string[];
```

In the schema, add after the `dailyTime` block:

```ts
        dailyTimes: {
            type: [
                {
                    type: String,
                    match: [DAILY_TIME_PATTERN, 'Posting times must be HH:mm'],
                },
            ],
            default: () => [DEFAULT_DAILY_TIME],
            validate: {
                validator: (times: string[]) =>
                    times.length >= 1 && times.length <= MAX_DAILY_SLOTS,
                message: `A Page needs 1 to ${MAX_DAILY_SLOTS} posting times`,
            },
        },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --import tsx --test src/models/socialConnectionModel.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Type-check, run the full suite, and commit**

Run: `cd backend && npx tsc --noEmit -p . && npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: no `tsc` output; `# fail 0`.

```bash
git add backend/src/models/socialConnectionModel.ts backend/src/models/socialConnectionModel.test.ts
git commit -m "feat: store a list of daily posting times per Page

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Scheduler walks through `dailyTimes`

**Files:**
- Modify: `backend/src/services/schedulerService.ts`
- Test: `backend/src/services/schedulerService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/services/schedulerService.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --import tsx --test src/services/schedulerService.test.ts`
Expected: FAIL. The scheduler still reads `dailyTime` (undefined), so `computeNextRunAt` throws and the 24-hour fallback produces different `nextRunAt` values.

- [ ] **Step 3: Update the scheduler**

In `backend/src/services/schedulerService.ts`, replace

```ts
import { computeNextRunAt } from './timeService.js';
```

with

```ts
import { nextSlotOrFallback } from './scheduleService.js';
```

Replace the body of the `for` loop in `ensureSchedules` with:

```ts
    for (const connection of missing) {
        try {
            const slot = nextSlotOrFallback(
                connection.dailyTimes,
                connection.timezone
            );
            connection.nextRunAt = slot.nextRunAt;
            if (slot.error) connection.lastError = slot.error;
            await connection.save();
        } catch (error) {
            console.error(
                `[scheduler] Could not initialize schedule for ${connection._id}:`,
                error
            );
        }
    }
```

Replace the whole `advance` function with:

```ts
/**
 * Moves the connection to its first slot after `now`. Missed slots collapse
 * into this one move. Returns an error message when the stored schedule was
 * unusable and a fallback slot was used.
 */
function advance(
    connection: { dailyTimes: string[]; timezone: string; nextRunAt: Date | null },
    now: Date
): string {
    const slot = nextSlotOrFallback(connection.dailyTimes, connection.timezone, now);
    connection.nextRunAt = slot.nextRunAt;
    return slot.error;
}
```

In `processConnection`, add `let scheduleError = '';` on the line after `if (!connection) return;`.

Then make these four replacements inside `processConnection`:

1. In the stale-slot branch, replace `await advance(connection, now);` with `scheduleError = advance(connection, now);`.
2. In the inactive-owner branch, replace `await advance(connection, now);` with `scheduleError = advance(connection, now);`.
3. Before publishing, replace

```ts
        await advance(connection, now);
        await connection.save();
```

with

```ts
        scheduleError = advance(connection, now);
        await connection.save();
```

4. In the `catch` block, replace

```ts
            try {
                await advance(connection, now);
            } catch {
```

with

```ts
            try {
                scheduleError = advance(connection, now);
            } catch {
```

In the `finally` block, replace `lastError: connection.lastError,` with:

```ts
                        // A publish error is more useful than a schedule error.
                        lastError: connection.lastError || scheduleError,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --import tsx --test src/services/schedulerService.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Type-check, run the full suite, and commit**

Run: `cd backend && npx tsc --noEmit -p . && npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: no `tsc` output; `# fail 0`.

```bash
git add backend/src/services/schedulerService.ts backend/src/services/schedulerService.test.ts
git commit -m "feat: publish at every daily posting time

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Connection controller accepts `dailyTimes` and uses the Profile timezone

**Files:**
- Modify: `backend/src/controllers/connectionController.ts`
- Modify: `backend/src/controllers/connectionController.test.ts`

- [ ] **Step 1: Update existing fixtures and write the failing tests**

In `backend/src/controllers/connectionController.test.ts`:

1. In `updateConnection clears the schedule when paused`, replace

```ts
        dailyTime: '09:00',
        timezone: 'UTC',
```

with

```ts
        dailyTimes: ['09:00'],
        timezone: 'UTC',
```

2. In `upsertPagesForUser keeps existing Pages and reports what the login covered`, replace `dailyTime: '10:30',` with `dailyTimes: ['10:30'],`, and replace

```ts
    assert.equal(existing.dailyTime, '10:30');
```

with

```ts
    assert.deepEqual(existing.dailyTimes, ['10:30']);
    // Reconnected after needs_reauth: next slot is 10:30 IST tomorrow.
    assert.deepEqual(existing.nextRunAt, new Date('2026-10-28T05:00:00.000Z'));
```

and add after `assert.equal(created[0]?.pageId, 'page-new');`:

```ts
    assert.deepEqual(created[0]?.dailyTimes, ['09:00']);
    assert.equal(created[0]?.timezone, 'Asia/Kolkata');
```

3. Append these tests at the end of the file:

```ts
function scheduledConnection(overrides: Record<string, unknown> = {}) {
    const connection = connectionDoc({
        isActive: true,
        dailyTimes: ['09:00'],
        timezone: 'Asia/Kolkata',
        nextRunAt: new Date('2026-10-28T03:30:00.000Z'),
        publishToFacebook: true,
        publishToInstagram: false,
        instagram: null,
        lastError: '',
        ...overrides,
    });
    const save = mock.fn(async () => connection);
    connection.save = save;
    mock.method(socialConnection, 'findOne', async () => connection);
    mock.method(post, 'countDocuments', async () => 0);
    return { connection, save };
}

function istClock(date: Date): string {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).format(date);
}

test('updateConnection saves sorted times and moves the next slot', async () => {
    const { connection } = scheduledConnection();
    const previous = connection.nextRunAt;

    const { res } = response();
    await updateConnection(
        requestWithBody({ dailyTimes: ['21:00', '15:00'] }),
        res
    );

    assert.deepEqual(connection.dailyTimes, ['15:00', '21:00']);
    assert.ok(connection.nextRunAt instanceof Date);
    assert.notEqual(connection.nextRunAt, previous);
    assert.ok(['15:00', '21:00'].includes(istClock(connection.nextRunAt as Date)));
});

test('updateConnection rejects an invalid schedule without saving', async () => {
    const { save } = scheduledConnection();

    await assert.rejects(
        updateConnection(
            requestWithBody({ dailyTimes: ['14:00', '14:10'] }),
            response().res
        ),
        (error: unknown) =>
            (error as AppError).code === 'INVALID_SCHEDULE' &&
            (error as AppError).message ===
                'Times must be at least 15 minutes apart (14:00 and 14:10).'
    );
    assert.equal(save.mock.callCount(), 0);
});

test('updateConnection keeps the next slot when the schedule is unchanged', async () => {
    const { connection } = scheduledConnection();
    const previous = connection.nextRunAt;

    await updateConnection(
        requestWithBody({ dailyTimes: ['09:00'], isActive: true }),
        response().res
    );

    assert.equal(connection.nextRunAt, previous);
});

test('upsertPagesForUser moves a reconnected Page to the Profile timezone', async () => {
    // 01:00 UTC is 06:30 in Asia/Kolkata.
    const now = new Date('2026-10-27T01:00:00.000Z');
    const existing = connectionDoc({
        pageId: 'page-old',
        pageName: 'Byte Horizon',
        tokenStatus: 'active',
        isActive: true,
        dailyTimes: ['09:00'],
        timezone: 'UTC',
        publishToFacebook: true,
        publishToInstagram: false,
        instagram: null,
        nextRunAt: new Date('2026-10-27T09:00:00.000Z'),
        lastError: '',
    });
    existing.save = async () => existing;

    mock.method(socialConnection, 'findOne', async () => existing);
    mock.method(socialConnection, 'find', () => ({ select: async () => [] }));

    await upsertPagesForUser(
        USER_ID,
        [{ id: 'page-old', name: 'Byte Horizon', access_token: 'token' }],
        'Asia/Kolkata',
        [],
        now
    );

    assert.equal(existing.timezone, 'Asia/Kolkata');
    assert.deepEqual(existing.nextRunAt, new Date('2026-10-27T03:30:00.000Z'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --import tsx --test src/controllers/connectionController.test.ts`
Expected: FAIL in the new tests (unknown `dailyTimes` is stripped by the schema, no `INVALID_SCHEDULE`, no timezone change) and in the updated upsert assertions.

- [ ] **Step 3: Update the controller**

In `backend/src/controllers/connectionController.ts`:

Replace

```ts
import { computeNextRunAt, isValidTimezone } from '../services/timeService.js';
```

with

```ts
import {
    DEFAULT_DAILY_TIME,
    computeNextSlot,
    nextSlotOrFallback,
    normalizeDailyTimes,
} from '../services/scheduleService.js';
import { isValidTimezone } from '../services/timeService.js';
```

Replace `updateConnectionSchema` with:

```ts
const updateConnectionSchema = z.object({
    // normalizeDailyTimes enforces the 1–10 limit with a clear message; the
    // cap here only bounds the request size.
    dailyTimes: z.array(z.string().max(16)).max(50).optional(),
    publishToFacebook: z.boolean().optional(),
    publishToInstagram: z.boolean().optional(),
    isActive: z.boolean().optional(),
});
```

Replace the whole `startMetaOAuth` function with:

```ts
export async function startMetaOAuth(req: Request, res: Response): Promise<void> {
    const meta = await getMetaCredentials(req.user.id);
    const redirectUri = resolveMetaRedirectUri(req);

    const state = jwt.sign(
        {
            id: req.user.id,
            purpose: 'meta_oauth',
            appId: meta.appId,
            redirectUri,
        },
        META_OAUTH_STATE_SECRET,
        { expiresIn: '10m' }
    );

    res.json({
        success: true,
        url: getOAuthUrl({ ...meta, redirectUri }, state),
    });
}
```

In `upsertPagesForUser`, replace the `if (existing) { ... } else { ... }` block with:

```ts
        if (existing) {
            const hadInstagram = Boolean(existing.instagram?.id);
            const previousStatus = existing.tokenStatus;
            const timezoneChanged = existing.timezone !== timezone;

            existing.pageName = page.name;
            existing.pageAccessTokenEnc = encryptSecret(page.access_token);
            existing.tokenStatus = 'active';
            existing.tokenUpdatedAt = now;
            existing.grantedScopes = grantedScopes ?? [];
            // Pages always post in the owner's Profile timezone.
            existing.timezone = timezone;
            existing.instagram = instagram;
            existing.lastError = '';

            if (instagram && !hadInstagram) {
                existing.publishToInstagram = true;
            }
            if (!instagram) {
                existing.publishToInstagram = false;
            }

            if (!existing.isActive) {
                existing.nextRunAt = null;
            } else if (
                shouldRecomputeScheduleOnReconnect(
                    previousStatus,
                    existing.isActive
                ) ||
                timezoneChanged ||
                !existing.nextRunAt
            ) {
                const slot = nextSlotOrFallback(
                    existing.dailyTimes,
                    timezone,
                    now
                );
                existing.nextRunAt = slot.nextRunAt;
                existing.lastError = slot.error;
            }

            await existing.save();
            summary.reconnected.push(page.name);
        } else {
            await SocialConnection.create({
                userId,
                pageId: page.id,
                pageName: page.name,
                pageAccessTokenEnc: encryptSecret(page.access_token),
                tokenStatus: 'active',
                tokenUpdatedAt: now,
                grantedScopes: grantedScopes ?? [],
                instagram,
                dailyTimes: [DEFAULT_DAILY_TIME],
                timezone,
                publishToFacebook: true,
                publishToInstagram: Boolean(instagram),
                nextRunAt: computeNextSlot([DEFAULT_DAILY_TIME], timezone, now),
            });
            summary.added.push(page.name);
        }
```

In `completeMetaOAuth`:

1. Remove `timezone?: string;` from the `decoded` type.
2. Replace `const user = await User.findById(req.user.id).select('isActive');` with:

```ts
    const user = await User.findById(req.user.id).select('isActive timezone');
```

3. Replace

```ts
        const timezone =
            decoded.timezone && isValidTimezone(decoded.timezone)
                ? decoded.timezone
                : env.defaultTimezone;
```

with

```ts
        // Pages always post in the owner's Profile timezone.
        const timezone =
            user.timezone && isValidTimezone(user.timezone)
                ? user.timezone
                : env.defaultTimezone;
```

Replace the whole `updateConnection` function with:

```ts
export async function updateConnection(req: Request, res: Response): Promise<void> {
    const parsed = parseBody(updateConnectionSchema, req);
    const connection = await findOwnedConnection(String(req.params.id), req.user.id);
    const wasActive = connection.isActive;

    let scheduleChanged = false;
    if (parsed.dailyTimes !== undefined) {
        const dailyTimes = normalizeDailyTimes(parsed.dailyTimes);
        scheduleChanged =
            dailyTimes.join(',') !== [...(connection.dailyTimes ?? [])].join(',');
        connection.dailyTimes = dailyTimes;
    }
    if (parsed.publishToFacebook !== undefined) {
        connection.publishToFacebook = parsed.publishToFacebook;
    }
    if (parsed.publishToInstagram !== undefined) {
        if (parsed.publishToInstagram && !connection.instagram?.id) {
            throw new AppError(
                400,
                'This Page has no linked Instagram Business account',
                'INSTAGRAM_NOT_LINKED'
            );
        }
        connection.publishToInstagram = parsed.publishToInstagram;
    }
    if (parsed.isActive !== undefined) connection.isActive = parsed.isActive;

    if (!connection.publishToFacebook && !connection.publishToInstagram) {
        throw new AppError(
            400,
            'Select at least one platform to publish to',
            'NO_PLATFORMS'
        );
    }

    if (!connection.isActive || connection.tokenStatus !== 'active') {
        connection.nextRunAt = null;
    } else if (scheduleChanged || !wasActive || !connection.nextRunAt) {
        // Recompute only when something changed. Recomputing an unchanged
        // schedule could push a slot that is due right now to the next one.
        const slot = nextSlotOrFallback(connection.dailyTimes, connection.timezone);
        connection.nextRunAt = slot.nextRunAt;
        if (slot.error) connection.lastError = slot.error;
    }

    await connection.save();

    const queuedCount = await queuedCountFor(connection._id.toString());
    res.json({
        success: true,
        connection: connectionResponse(connection, queuedCount),
    });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --import tsx --test src/controllers/connectionController.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Type-check, run the full suite, and commit**

Run: `cd backend && npx tsc --noEmit -p . && npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: no `tsc` output; `# fail 0`. If `tsc` reports `env` or `isValidTimezone` as unused, they are still used in `completeMetaOAuth`; re-check the edits.

```bash
git add backend/src/controllers/connectionController.ts backend/src/controllers/connectionController.test.ts
git commit -m "feat: save Page posting times and use the Profile timezone

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Sync Page timezones when the Profile timezone changes

**Files:**
- Create: `backend/src/services/scheduleSyncService.ts`
- Test: `backend/src/services/scheduleSyncService.test.ts`
- Modify: `backend/src/controllers/authController.ts`
- Test: `backend/src/controllers/authController.test.ts`

- [ ] **Step 1: Write the failing sync tests**

Create `backend/src/services/scheduleSyncService.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --import tsx --test src/services/scheduleSyncService.test.ts`
Expected: FAIL with `Cannot find module './scheduleSyncService.js'`.

- [ ] **Step 3: Implement `syncConnectionTimezones`**

Create `backend/src/services/scheduleSyncService.ts`:

```ts
import { SocialConnection } from '../models/socialConnectionModel.js';
import { STALE_LOCK_MS } from './connectionLifecycleService.js';
import { nextSlotOrFallback } from './scheduleService.js';

/**
 * Moves every Page the user owns onto their Profile timezone and returns how
 * many Pages got a new next slot. Only Pages on a different timezone are
 * touched, so calling this again is a no-op and never pushes a due slot back.
 * Paused, disconnected, and scheduler-locked Pages keep their `nextRunAt`.
 */
export async function syncConnectionTimezones(
    userId: string,
    timezone: string,
    now: Date = new Date()
): Promise<number> {
    const staleLock = now.getTime() - STALE_LOCK_MS;
    const drifted = await SocialConnection.find({
        userId,
        timezone: { $ne: timezone },
    });

    let rescheduled = 0;
    for (const connection of drifted) {
        const schedulable =
            connection.isActive &&
            connection.tokenStatus === 'active' &&
            (!connection.lockedAt || connection.lockedAt.getTime() < staleLock);
        const update: Record<string, unknown> = { timezone };
        if (schedulable) {
            const slot = nextSlotOrFallback(connection.dailyTimes, timezone, now);
            update.nextRunAt = slot.nextRunAt;
            if (slot.error) update.lastError = slot.error;
            rescheduled += 1;
        }
        await SocialConnection.updateOne(
            { _id: connection._id, userId },
            { $set: update }
        );
    }
    return rescheduled;
}
```

- [ ] **Step 4: Run the sync tests to verify they pass**

Run: `cd backend && node --import tsx --test src/services/scheduleSyncService.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Write the failing profile tests**

Create `backend/src/controllers/authController.test.ts`:

```ts
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
```

- [ ] **Step 6: Run the profile tests to verify they fail**

Run: `cd backend && node --import tsx --test src/controllers/authController.test.ts`
Expected: FAIL; `rescheduledPages` is missing and `RESCHEDULE_FAILED` is never thrown.

- [ ] **Step 7: Sync on profile save**

In `backend/src/controllers/authController.ts`, add the import after the `passwordService` import:

```ts
import { syncConnectionTimezones } from '../services/scheduleSyncService.js';
```

In `updateProfile`, replace

```ts
    res.json({
        success: true,
        user: publicUser(user),
    });
};
```

with

```ts
    // Pages post in the Profile timezone. The sync only touches Pages on a
    // different timezone, so it is safe on every save and retries a failure.
    let rescheduledPages: number | undefined;
    if (parsed.timezone !== undefined) {
        try {
            rescheduledPages = await syncConnectionTimezones(
                req.user.id,
                parsed.timezone
            );
        } catch (error) {
            console.error('[auth] Could not reschedule Pages:', error);
            throw new AppError(
                500,
                'Profile saved, but your Pages could not be rescheduled. Save your profile again to retry.',
                'RESCHEDULE_FAILED'
            );
        }
    }

    res.json({
        success: true,
        user: publicUser(user),
        ...(rescheduledPages !== undefined ? { rescheduledPages } : {}),
    });
};
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd backend && node --import tsx --test src/controllers/authController.test.ts src/services/scheduleSyncService.test.ts`
Expected: 6 tests pass.

- [ ] **Step 9: Type-check, run the full suite, and commit**

Run: `cd backend && npx tsc --noEmit -p . && npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: no `tsc` output; `# fail 0`.

```bash
git add backend/src/services/scheduleSyncService.ts backend/src/services/scheduleSyncService.test.ts backend/src/controllers/authController.ts backend/src/controllers/authController.test.ts
git commit -m "feat: reschedule Pages when the Profile timezone changes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Startup migration and removing `dailyTime`

**Files:**
- Modify: `backend/src/services/scheduleSyncService.ts`
- Modify: `backend/src/services/scheduleSyncService.test.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/src/models/socialConnectionModel.ts`

- [ ] **Step 1: Write the failing migration tests**

In `backend/src/services/scheduleSyncService.test.ts`, replace the import line

```ts
const { syncConnectionTimezones } = await import('./scheduleSyncService.js');
```

with

```ts
const { migrateConnectionSchedules, syncConnectionTimezones } = await import(
    './scheduleSyncService.js'
);
const { User } = await import('../models/userModel.js');
```

and append:

```ts
function mockMigration(options: { copied: number; pages: unknown[] }) {
    const collectionCalls: Array<{ filter: unknown; update: unknown }> = [];
    mock.method(
        SocialConnection.collection as unknown as MockableModel,
        'updateMany',
        async (filter: unknown, update: unknown) => {
            collectionCalls.push({ filter, update });
            return { modifiedCount: collectionCalls.length === 1 ? options.copied : 0 };
        }
    );
    mock.method(User as unknown as MockableModel, 'find', () => ({
        select: async () => [{ _id: USER_ID, timezone: 'Asia/Kolkata' }],
    }));
    const { updates } = mockConnections(options.pages);
    return { collectionCalls, updates };
}

test('migration copies legacy times and aligns timezones', async () => {
    const { collectionCalls, updates } = mockMigration({ copied: 2, pages: [page()] });

    const result = await migrateConnectionSchedules(NOW);

    assert.deepEqual(result, { copied: 2, rescheduled: 1 });
    assert.deepEqual(collectionCalls[0], {
        filter: {
            $or: [
                { dailyTimes: { $exists: false } },
                { dailyTimes: { $size: 0 } },
            ],
        },
        update: [
            { $set: { dailyTimes: [{ $ifNull: ['$dailyTime', '09:00'] }] } },
            { $unset: 'dailyTime' },
        ],
    });
    assert.deepEqual(collectionCalls[1], {
        filter: { dailyTime: { $exists: true } },
        update: { $unset: { dailyTime: '' } },
    });
    assert.equal(updates[0]?.set.timezone, 'Asia/Kolkata');
});

test('running the migration again changes nothing', async () => {
    const { updates } = mockMigration({ copied: 0, pages: [] });

    const result = await migrateConnectionSchedules(NOW);

    assert.deepEqual(result, { copied: 0, rescheduled: 0 });
    assert.equal(updates.length, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --import tsx --test src/services/scheduleSyncService.test.ts`
Expected: FAIL; `migrateConnectionSchedules` is not a function.

- [ ] **Step 3: Implement the migration**

In `backend/src/services/scheduleSyncService.ts`, replace the imports with:

```ts
import { SocialConnection } from '../models/socialConnectionModel.js';
import { User } from '../models/userModel.js';
import { STALE_LOCK_MS } from './connectionLifecycleService.js';
import {
    DEFAULT_DAILY_TIME,
    DEFAULT_TIMEZONE,
    nextSlotOrFallback,
} from './scheduleService.js';
```

and append:

```ts
/**
 * One-time upgrade from a single `dailyTime` to `dailyTimes`, plus aligning
 * every Page with its owner's Profile timezone. Safe to run on every start.
 */
export async function migrateConnectionSchedules(
    now: Date = new Date()
): Promise<{ copied: number; rescheduled: number }> {
    // Uses the native collection because `dailyTime` is no longer in the schema.
    const copied = await SocialConnection.collection.updateMany(
        {
            $or: [
                { dailyTimes: { $exists: false } },
                { dailyTimes: { $size: 0 } },
            ],
        },
        [
            {
                $set: {
                    dailyTimes: [{ $ifNull: ['$dailyTime', DEFAULT_DAILY_TIME] }],
                },
            },
            { $unset: 'dailyTime' },
        ]
    );
    await SocialConnection.collection.updateMany(
        { dailyTime: { $exists: true } },
        { $unset: { dailyTime: '' } }
    );

    let rescheduled = 0;
    const users = await User.find({}).select('timezone');
    for (const user of users) {
        rescheduled += await syncConnectionTimezones(
            String(user._id),
            user.timezone || DEFAULT_TIMEZONE,
            now
        );
    }

    return { copied: copied.modifiedCount, rescheduled };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --import tsx --test src/services/scheduleSyncService.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Run the migration before the scheduler**

In `backend/src/index.ts`, add the import after the `schedulerService` import:

```ts
import { migrateConnectionSchedules } from './services/scheduleSyncService.js';
```

Replace

```ts
    await connectDB();
```

with

```ts
    await connectDB();

    // Upgrade Page schedules before the scheduler reads them. A failure stops
    // start-up, like a database connection failure.
    const migration = await migrateConnectionSchedules();
    if (migration.copied > 0 || migration.rescheduled > 0) {
        console.log(
            `[schedule] Upgraded ${migration.copied} Page schedules; moved ${migration.rescheduled} Pages to their Profile timezone`
        );
    }
```

- [ ] **Step 6: Remove `dailyTime` from the model**

In `backend/src/models/socialConnectionModel.ts`, delete these lines from `ISocialConnection`:

```ts
    /** Legacy single posting time. Removed after the schedule migration. */
    dailyTime: string;
```

and delete the `dailyTime` block from the schema:

```ts
        dailyTime: {
            type: String,
            default: '09:00',
            match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'dailyTime must be HH:mm'],
        },
```

- [ ] **Step 7: Confirm nothing still uses `dailyTime`**

Run: `grep -rnw "dailyTime" backend/src`
Expected: only lines in `backend/src/services/scheduleSyncService.ts` and `backend/src/services/scheduleSyncService.test.ts` (the migration filter, pipeline, and comments).

- [ ] **Step 8: Type-check, run the full suite, and commit**

Run: `cd backend && npx tsc --noEmit -p . && npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: no `tsc` output; `# fail 0`.

```bash
git add backend/src/services/scheduleSyncService.ts backend/src/services/scheduleSyncService.test.ts backend/src/index.ts backend/src/models/socialConnectionModel.ts
git commit -m "feat: migrate Pages to daily posting time lists

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Frontend schedule helpers

The frontend has no test runner. These helpers mirror the backend rules, which are covered by Task 1, and are checked here with Node's built-in TypeScript stripping.

**Files:**
- Create: `frontend/src/lib/schedule.ts`

- [ ] **Step 1: Create the helpers**

Create `frontend/src/lib/schedule.ts`:

```ts
// Mirrors backend/src/services/scheduleService.ts for instant feedback. The
// backend is authoritative and returns the same messages.

export const MAX_DAILY_SLOTS = 10;
export const MIN_SLOT_GAP_MINUTES = 15;
export const DEFAULT_DAILY_TIME = '09:00';

const DAILY_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MINUTES_PER_DAY = 24 * 60;
const SUGGESTION_START = 9 * 60;
const SUGGESTION_END = 21 * 60;

function toMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return (hours ?? 0) * 60 + (minutes ?? 0);
}

function fromMinutes(total: number): string {
    const minutes =
        ((total % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    const hours = Math.floor(minutes / 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Evenly spaced times from 09:00 to 21:00, rounded to 5 minutes. */
export function suggestDailyTimes(count: number): string[] {
    const total = Math.min(MAX_DAILY_SLOTS, Math.max(1, Math.floor(count)));
    if (total === 1) return [DEFAULT_DAILY_TIME];
    const step = (SUGGESTION_END - SUGGESTION_START) / (total - 1);
    return Array.from({ length: total }, (_, index) =>
        fromMinutes(Math.round((SUGGESTION_START + step * index) / 5) * 5)
    );
}

/** The first problem with a schedule, or '' when it can be saved. */
export function validateDailyTimes(times: string[]): string {
    if (times.length === 0) return 'Add at least one posting time.';
    if (times.length > MAX_DAILY_SLOTS) {
        return `A Page can post at most ${MAX_DAILY_SLOTS} times a day.`;
    }
    for (const time of times) {
        if (!DAILY_TIME_PATTERN.test(time)) {
            return `${time || 'A blank time'} is not a valid time. Use HH:mm.`;
        }
    }
    const sorted = [...times].sort();
    for (let index = 1; index < sorted.length; index += 1) {
        if (sorted[index] === sorted[index - 1]) {
            return `${sorted[index]} is listed twice.`;
        }
    }
    if (sorted.length > 1) {
        for (let index = 0; index < sorted.length; index += 1) {
            const current = sorted[index] as string;
            const next = sorted[(index + 1) % sorted.length] as string;
            const gap =
                (toMinutes(next) - toMinutes(current) + MINUTES_PER_DAY) %
                MINUTES_PER_DAY;
            if (gap < MIN_SLOT_GAP_MINUTES) {
                return `Times must be at least ${MIN_SLOT_GAP_MINUTES} minutes apart (${current} and ${next}).`;
            }
        }
    }
    return '';
}

/**
 * Adds a time in the middle of the largest gap, preferring daytime gaps over
 * the overnight one on a tie. Returns the times sorted.
 */
export function addSlot(times: string[]): string[] {
    if (times.length >= MAX_DAILY_SLOTS) return times;
    const valid = [...new Set(times.filter((time) => DAILY_TIME_PATTERN.test(time)))].sort();
    if (valid.length === 0) return [...times, DEFAULT_DAILY_TIME];

    // Start with the overnight gap from the last time to the first.
    let bestStart = toMinutes(valid[valid.length - 1] as string);
    let bestGap =
        (toMinutes(valid[0] as string) - bestStart + MINUTES_PER_DAY) %
            MINUTES_PER_DAY || MINUTES_PER_DAY;
    for (let index = 1; index < valid.length; index += 1) {
        const start = toMinutes(valid[index - 1] as string);
        const gap = toMinutes(valid[index] as string) - start;
        if (gap >= bestGap) {
            bestGap = gap;
            bestStart = start;
        }
    }

    const midpoint = Math.round((bestStart + bestGap / 2) / 5) * 5;
    return [...times, fromMinutes(midpoint)].sort();
}

export function formatDailyTimes(times: string[] | undefined): string {
    return times && times.length > 0 ? times.join(', ') : '—';
}
```

- [ ] **Step 2: Sanity-check the helpers**

Run:

```bash
cd frontend && node --experimental-strip-types -e "
import('./src/lib/schedule.ts').then((s) => {
  console.log(JSON.stringify(s.suggestDailyTimes(3)));
  console.log(JSON.stringify(s.addSlot(['09:00'])));
  console.log(JSON.stringify(s.addSlot(['09:00', '21:00'])));
  console.log(s.validateDailyTimes(['23:55', '00:05']));
  console.log(JSON.stringify(s.validateDailyTimes(['09:00', '15:00'])));
});" 2>/dev/null
```

Expected output:

```text
["09:00","15:00","21:00"]
["09:00","21:00"]
["09:00","15:00","21:00"]
Times must be at least 15 minutes apart (23:55 and 00:05).
""
```

- [ ] **Step 3: Type-check, lint, and commit**

Run: `cd frontend && npx tsc --noEmit -p . && npx eslint src/lib/schedule.ts`
Expected: no `tsc` output; no ESLint errors.

```bash
git add frontend/src/lib/schedule.ts
git commit -m "feat: add frontend posting schedule helpers

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Schedule editor, types, and dashboards

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/apiClient.ts`
- Modify: `frontend/src/components/ConnectionCard.tsx`
- Modify: `frontend/src/components/Dashboards.tsx`
- Modify: `frontend/src/app/connections/page.tsx`

- [ ] **Step 1: Update the type (this breaks the build until Step 5)**

In `frontend/src/lib/types.ts`, inside `SocialConnection`, replace

```ts
    dailyTime: string;
```

with

```ts
    /** Sorted daily posting times (HH:mm) in `timezone`. */
    dailyTimes: string[];
```

Run: `cd frontend && npx tsc --noEmit -p . 2>&1 | grep dailyTime`
Expected: errors in `ConnectionCard.tsx` and `Dashboards.tsx`. These are fixed below.

- [ ] **Step 2: Stop sending a timezone to the Meta login**

In `frontend/src/lib/apiClient.ts`, replace

```ts
    start: (timezone?: string) =>
        api.get(`/connections/meta/start${timezone ? `?timezone=${encodeURIComponent(timezone)}` : ''}`),
```

with

```ts
    start: () => api.get('/connections/meta/start'),
```

In `frontend/src/app/connections/page.tsx`:

1. Delete `import { useAuth } from '@/context/AuthContext';`.
2. Delete `const { user } = useAuth();`.
3. Replace

```ts
            const timezone =
                user?.timezone ||
                Intl.DateTimeFormat().resolvedOptions().timeZone ||
                'Asia/Kolkata';
            const data: any = await connectionsApi.start(timezone);
```

with

```ts
            // The server schedules every Page in the Profile timezone.
            const data: any = await connectionsApi.start();
```

- [ ] **Step 3: Replace the schedule fields on the connection card**

In `frontend/src/components/ConnectionCard.tsx`:

Keep `'use client';` as the first line and replace the import lines below it with:

```tsx
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Modal } from '@/components/Modal';
import { connectionsApi } from '@/lib/apiClient';
import {
    MAX_DAILY_SLOTS,
    addSlot,
    suggestDailyTimes,
    validateDailyTimes,
} from '@/lib/schedule';
import {
    formatDate,
    type SocialConnection,
} from '@/lib/types';
```

Replace

```tsx
    const [dailyTime, setDailyTime] = useState(connection.dailyTime);
    const [timezone, setTimezone] = useState(connection.timezone);
```

with

```tsx
    const [times, setTimes] = useState<string[]>(connection.dailyTimes);
```

Delete the `timezones` state:

```tsx
    const [timezones, setTimezones] = useState(() =>
        getInitialTimezoneOptions(connection.timezone)
    );
```

In the `useEffect` that depends on `[connection]`, replace

```tsx
        setDailyTime(connection.dailyTime);
        setTimezone(connection.timezone);
```

with

```tsx
        setTimes(connection.dailyTimes);
```

Delete the timezone-options effect:

```tsx
    useEffect(() => {
        setTimezones(getTimezoneOptions(connection.timezone));
    }, [connection.timezone]);
```

Add this line after the `queuedLabel` declaration:

```tsx
    const scheduleError = validateDailyTimes(times);
```

In `save`, replace the request body

```tsx
            const data: any = await connectionsApi.update(connection._id, {
                dailyTime,
                timezone,
                publishToFacebook: facebook,
```

with

```tsx
            const data: any = await connectionsApi.update(connection._id, {
                dailyTimes: times,
                publishToFacebook: facebook,
```

Replace the whole three-column grid that starts with `<div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mt-7">` and contains the Daily time, Timezone, and Next slot fields with:

```tsx
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mt-7">
                <div className="sm:col-span-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <label
                            htmlFor={`posts-per-day-${connection._id}`}
                            className="text-xs font-bold uppercase tracking-widest text-slate-500"
                        >
                            Posting schedule
                        </label>
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                            <select
                                id={`posts-per-day-${connection._id}`}
                                value={times.length}
                                onChange={(event) =>
                                    setTimes(
                                        suggestDailyTimes(Number(event.target.value))
                                    )
                                }
                                className="bg-slate-950/80 border border-white/10 rounded-lg px-2 py-1.5 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                            >
                                {Array.from(
                                    { length: MAX_DAILY_SLOTS },
                                    (_, index) => index + 1
                                ).map((count) => (
                                    <option key={count} value={count}>
                                        {count}
                                    </option>
                                ))}
                            </select>
                            <span>
                                {times.length === 1 ? 'post a day' : 'posts a day'}
                            </span>
                        </div>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                        {times.map((time, index) => (
                            <div
                                key={index}
                                className="flex items-center rounded-xl border border-white/10 bg-slate-950/80 focus-within:ring-2 focus-within:ring-indigo-500/50"
                            >
                                <input
                                    type="time"
                                    aria-label={`Posting time ${index + 1}`}
                                    value={time}
                                    onChange={(event) =>
                                        setTimes((current) =>
                                            current.map((value, position) =>
                                                position === index
                                                    ? event.target.value
                                                    : value
                                            )
                                        )
                                    }
                                    className="bg-transparent pl-3 py-2.5 text-white focus:outline-none"
                                />
                                <button
                                    type="button"
                                    aria-label={`Remove posting time ${index + 1}`}
                                    disabled={times.length === 1}
                                    onClick={() =>
                                        setTimes((current) =>
                                            current.filter(
                                                (_, position) => position !== index
                                            )
                                        )
                                    }
                                    className="px-3 py-2.5 text-slate-500 hover:text-rose-300 disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                    ×
                                </button>
                            </div>
                        ))}
                        {times.length < MAX_DAILY_SLOTS ? (
                            <button
                                type="button"
                                onClick={() => setTimes(addSlot)}
                                className="rounded-xl border border-dashed border-white/15 px-3 py-2.5 text-xs font-bold text-indigo-300 hover:bg-indigo-500/10"
                            >
                                + Add time
                            </button>
                        ) : null}
                    </div>

                    {scheduleError ? (
                        <div className="mt-2 text-xs text-rose-400">
                            {scheduleError}
                        </div>
                    ) : null}
                    <p className="mt-2 text-xs text-slate-500">
                        Times use your Profile timezone ({connection.timezone}).{' '}
                        <Link
                            href="/settings"
                            className="font-bold text-indigo-300 hover:text-indigo-200"
                        >
                            Change it in Profile
                        </Link>
                    </p>
                </div>

                <div>
                    <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                        Next slot
                    </label>
                    <div className="mt-2 w-full bg-slate-950/40 border border-white/5 rounded-xl px-4 py-3 text-sm text-slate-300">
                        {isDisconnected
                            ? 'Waiting for reconnect'
                            : connection.isActive
                              ? formatDate(connection.nextRunAt)
                              : 'Paused'}
                    </div>
                </div>
            </div>
```

On the Save button, replace `disabled={saving}` with:

```tsx
                    disabled={saving || Boolean(scheduleError)}
```

- [ ] **Step 4: Show the times list on the dashboards**

In `frontend/src/components/Dashboards.tsx`, add after the `@/lib/types` import block:

```tsx
import { formatDailyTimes } from '@/lib/schedule';
```

Replace

```tsx
                        {upcoming.pageName} · {upcoming.dailyTime}{' '}
                        {upcoming.timezone}
```

with

```tsx
                        {upcoming.pageName} · {upcoming.timezone}
```

Replace (admin table cell)

```tsx
                                            {connection.dailyTime}
                                            <div className="text-[11px] text-slate-500">
```

with

```tsx
                                            {formatDailyTimes(connection.dailyTimes)}
                                            <div className="text-[11px] text-slate-500">
```

Replace (admin mobile card)

```tsx
                                            {connection.dailyTime} ·{' '}
                                            {connection.timezone}
```

with

```tsx
                                            {formatDailyTimes(connection.dailyTimes)} ·{' '}
                                            {connection.timezone}
```

- [ ] **Step 5: Type-check and lint**

Run: `cd frontend && npx tsc --noEmit -p . && npx eslint src 2>&1 | tail -1`
Expected: no `tsc` output; ESLint summary shows `0 errors`.

Run: `grep -nw -e dailyTime -e getTimezoneOptions -e getInitialTimezoneOptions frontend/src/components/ConnectionCard.tsx frontend/src/components/Dashboards.tsx`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/apiClient.ts frontend/src/components/ConnectionCard.tsx frontend/src/components/Dashboards.tsx frontend/src/app/connections/page.tsx
git commit -m "feat: edit daily posting times on each Page

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Profile timezone text and reschedule notice

**Files:**
- Modify: `frontend/src/app/settings/page.tsx`

- [ ] **Step 1: Update the help text**

In `frontend/src/app/settings/page.tsx`, replace

```tsx
                                Used for new Pages. Each connection can override
                                its own timezone.
```

with

```tsx
                                Every Page posts at its scheduled times in this
                                timezone. Changing it reschedules all Pages.
```

- [ ] **Step 2: Show how many Pages were rescheduled**

In the profile save handler, replace

```tsx
                setNotice(
                    emailChanged
                        ? 'Profile saved. Use your new email next time you sign in.'
                        : 'Profile saved.'
                );
```

with

```tsx
                const rescheduled = Number(data.rescheduledPages) || 0;
                setNotice(
                    (emailChanged
                        ? 'Profile saved. Use your new email next time you sign in.'
                        : 'Profile saved.') +
                        (rescheduled > 0
                            ? ` Rescheduled ${rescheduled} Page${rescheduled === 1 ? '' : 's'}.`
                            : '')
                );
```

- [ ] **Step 3: Type-check, lint, and commit**

Run: `cd frontend && npx tsc --noEmit -p . && npx eslint src/app/settings/page.tsx 2>&1 | grep -c " error "`
Expected: no `tsc` output; `0`.

```bash
git add frontend/src/app/settings/page.tsx
git commit -m "feat: explain Profile timezone scheduling

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Final verification

- [ ] **Step 1: Backend**

Run: `cd backend && npm test 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit -p . && echo "backend ok"`
Expected: `# fail 0` and `backend ok`.

- [ ] **Step 2: Frontend**

Run: `cd frontend && npx tsc --noEmit -p . && npx eslint src 2>&1 | tail -1 && NEXT_TELEMETRY_DISABLED=1 ./node_modules/.bin/next build 2>&1 | grep -E "Compiled|Error"`
Expected: no `tsc` output, ESLint `0 errors`, `✓ Compiled successfully`.

- [ ] **Step 3: Leftover references**

Run: `grep -rnw "dailyTime" backend/src frontend/src | grep -v scheduleSyncService`
Expected: no output.

- [ ] **Step 4: Clean tree**

Run: `git status --short`
Expected: no output. Do not push.
