# Posting Schedule — Design

**Date:** 2026-10-27
**Status:** Approved
**Branch:** `fix/analytics-reconnect-insights`

## Goal

Let a user choose how many times a day each Facebook Page publishes from its queue, and at which times. Every time is read in the timezone selected in the user's Profile.

Today each Page has one `dailyTime` and its own `timezone`, so it publishes at most one queued post a day.

## Scope

In scope:

- A per-Page list of daily posting times, from 1 to 10 times a day.
- The same times every day of the week.
- The Profile timezone drives every Page. The per-Page timezone picker is removed.
- Changing the Profile timezone reschedules every Page.
- A schedule editor on each connection card: posts per day, evenly spaced suggestions, and editable times.
- Migration of existing Pages to the new model.

Out of scope:

- Different times or active days per weekday.
- An account-wide schedule shared by all Pages.
- Pinning a specific post to a specific date and time.
- One-off skips or extra slots on a single date.
- Showing each queued post's expected publish time on the Queue page.

## Schedule Rules

A Page's schedule is `dailyTimes`: a sorted list of unique `HH:mm` strings.

- It holds 1 to 10 times.
- Neighbouring times are at least 15 minutes apart, including the gap from the last time of the day to the first time of the next day. `23:55` and `00:05` are rejected.
- Times are interpreted in the owner's Profile timezone, stored on the connection as `timezone`.

The next slot is the earliest occurrence of any time in `dailyTimes` that is strictly after the reference time, in the Page's timezone. If every time today has passed, it is the first time tomorrow. Daylight-saving transitions are resolved by Luxon, as `computeNextRunAt` does today.

Each slot publishes at most one post: the oldest queued post for that Page. If the queue is empty, the slot passes and nothing is published.

`nextRunAt` keeps its current meaning: the single next due slot for the Page. The scheduler, its lock, the "Post now" claim, pausing, and disconnecting are unchanged.

### Missed slots

When the server was down across one or more slots:

- If the most recent missed slot is inside the existing grace window (`SCHEDULER_GRACE_MINUTES`, 180 minutes), publish one post for it.
- Older missed slots are skipped.
- After that, `nextRunAt` moves to the first slot after the current time.

Missed slots therefore produce at most one catch-up post per Page.

This needs no new scheduler logic. `nextRunAt` holds only the earliest due slot, the scheduler already compares it with the grace window before publishing, and advancing always computes the first slot after `now`.

## Data Model Changes

### SocialConnection

Add:

```ts
dailyTimes: string[]; // sorted, unique HH:mm, 1–10 entries
```

Remove `dailyTime` from the schema and the TypeScript interface after migration.

`timezone` stays on the connection as a synced copy of the owner's Profile timezone. Only the Profile timezone save, the Meta login, and the startup migration write it.

Schema validation:

- Each entry matches `/^([01]\d|2[0-3]):[0-5]\d$/`.
- The array length is 1 to 10.
- Default `['09:00']`.

Gap and uniqueness checks live in `scheduleService` so the API returns clear messages.

## Backend Changes

### scheduleService (new)

`backend/src/services/scheduleService.ts` holds every schedule rule.

```ts
export const MAX_DAILY_SLOTS = 10;
export const MIN_SLOT_GAP_MINUTES = 15;

/** Sorts and validates times. Throws AppError(400, 'INVALID_SCHEDULE') with a specific message. */
export function normalizeDailyTimes(times: string[]): string[];

/** Earliest occurrence of any time strictly after `from`, in `timezone`. */
export function computeNextSlot(times: string[], timezone: string, from?: Date): Date;

/** Evenly spaced suggestions between 09:00 and 21:00, rounded to 5 minutes. */
export function suggestDailyTimes(count: number): string[];
```

`computeNextSlot` reuses `computeNextRunAt` for each time and returns the earliest result.

Validation messages are specific, for example:

- `Add at least one posting time.`
- `A Page can post at most 10 times a day.`
- `14:00 is listed twice.`
- `Times must be at least 15 minutes apart (14:00 and 14:10).`
- `Times must be at least 15 minutes apart (23:55 and 00:05).`

`suggestDailyTimes` rules:

- 1 → `09:00`
- n > 1 → evenly spaced from `09:00` to `21:00` inclusive, each rounded to the nearest 5 minutes.
- Examples: 2 → `09:00, 21:00`; 3 → `09:00, 15:00, 21:00`; 4 → `09:00, 13:00, 17:00, 21:00`.

The frontend has its own copy of `suggestDailyTimes` and the validation checks for instant feedback. The backend is authoritative.

### Scheduler

- `ensureSchedules` and `advance` call `computeNextSlot(connection.dailyTimes, connection.timezone, now)`.
- If a stored schedule or timezone is invalid, the scheduler does not stop. That Page falls back to `computeNextSlot(['09:00'], 'Asia/Kolkata', now)`, logs the problem, and stores a `lastError` such as `Saved posting schedule is invalid. Open Connections and save it again.`
- The existing 24-hour fallback for unexpected errors stays.

### Connection controller

`updateConnectionSchema`:

- Add `dailyTimes: z.array(z.string()).optional()`.
- Remove `dailyTime` and `timezone`.

`updateConnection`:

- When `dailyTimes` is present, normalize it with `normalizeDailyTimes` and save the result.
- Recompute `nextRunAt` with `computeNextSlot` when `dailyTimes` changes, when the Page is resumed, or when `nextRunAt` is missing. The existing rules for paused and inactive Pages stay.

`upsertPagesForUser` and `completeMetaOAuth`:

- Read the owner's Profile timezone from the user record.
- New Pages get `dailyTimes: ['09:00']` and that timezone.
- Reconnected Pages get their `timezone` reset to the Profile timezone and keep their `dailyTimes`.
- Slot computation uses `computeNextSlot`.
- The `timezone` query parameter on `startMetaOAuth` and the timezone in the OAuth state are no longer used to schedule. The frontend stops sending it.

### Profile timezone change

When `PATCH /api/auth/profile` changes `timezone`:

1. Save the user.
2. Set `timezone` on every connection the user owns.
3. For connections that are active, have `tokenStatus: 'active'`, and are not locked by the scheduler, recompute `nextRunAt` with `computeNextSlot`.
4. Paused and disconnected Pages keep `nextRunAt: null`.

The profile response includes how many Pages were rescheduled. If the connection update fails after the user saved, return an error stating that the Profile saved but Pages were not rescheduled. The next scheduler start realigns them through the migration.

Put the sync logic in `scheduleService` (`syncConnectionTimezones(userId, timezone, now)`) so the profile controller stays thin and the logic is testable.

### Startup migration

`migrateConnectionSchedules()` runs after the database connects and before `startScheduler()`. It is idempotent.

1. Copy legacy schedules. For connections without `dailyTimes` or with an empty array, use the native collection with an update pipeline:
   - `dailyTimes` = `[dailyTime]`, or `['09:00']` when `dailyTime` is missing.
   - Unset `dailyTime`.
2. Align timezones. For each user, update connections whose `timezone` differs from the user's Profile timezone and recompute `nextRunAt` for active connected Pages.

A Page that used a different timezone from the Profile will post at the same clock time in the Profile timezone after migration. This is intended.

### Admin

No change. Admin listings show `dailyTimes` through the existing connection payload.

## API Contract

### Update connection

`PATCH /api/connections/:id`

```json
{
  "dailyTimes": ["09:00", "15:00", "21:00"],
  "publishToFacebook": true,
  "publishToInstagram": true,
  "isActive": true
}
```

- Times are returned sorted.
- Invalid schedules return `400` with code `INVALID_SCHEDULE` and a specific message.
- `dailyTime` and `timezone` are ignored if sent.

The response connection includes `dailyTimes`, `timezone`, and `nextRunAt`.

### Update profile

`PATCH /api/auth/profile` with a new `timezone` also returns:

```json
{ "rescheduledPages": 2 }
```

## Frontend Changes

### Types

`SocialConnection`:

- Replace `dailyTime: string` with `dailyTimes: string[]`.
- Keep `timezone: string`.

### Schedule helpers

`frontend/src/lib/schedule.ts` mirrors the backend rules:

- `suggestDailyTimes(count)`
- `validateDailyTimes(times)` returning the first problem message or `''`
- `addSlot(times)` that inserts the midpoint of the largest gap, rounded to 5 minutes, when fewer than 10 times exist

### Connection card

Replace the Daily time and Timezone fields with a Posting schedule block:

- A Posts per day select from 1 to 10. Changing it replaces the times with `suggestDailyTimes(count)`.
- One time input per slot, each with a remove button. The remove button is disabled when only one time is left.
- An Add time button that calls `addSlot`. It is hidden at 10 times. The Posts per day select reflects the current number of times.
- An inline validation message from `validateDailyTimes`. Save is disabled while invalid.
- A note: `Times use your Profile timezone (Asia/Kolkata).` with a link to Profile.
- Next slot and Save changes behave as today. Save sends `dailyTimes`.

### Connections page

Stop sending a timezone to `connectionsApi.start`.

### Profile

Change the timezone help text to:

> Every Page posts at its scheduled times in this timezone. Changing it reschedules all Pages.

After saving a changed timezone, show `Saved. Rescheduled N Pages.`

### Dashboards

- Daily schedule shows the times joined with commas, then the timezone, for example `09:00, 15:00, 21:00 · Asia/Kolkata`.
- The Next scheduled slot card shows the Page name and the slot time instead of `dailyTime`.

## Edge Cases

### Empty queue at a slot

Nothing is published. `nextRunAt` advances to the next slot.

### Post now between slots

"Post now" claims the post as today. The next slot publishes the next oldest queued post.

### Saving a schedule while the scheduler holds the lock

The scheduler's lock release writes its own `nextRunAt`, so a concurrent schedule save can be overwritten for one slot. This is an existing race for `dailyTime` edits. The next slot computation after that uses the saved `dailyTimes`. No change is planned.

### Paused or disconnected Page

`nextRunAt` stays `null`. Saving times on such a Page stores them for later.

### Daylight-saving gaps and repeats

A time that does not exist on a transition day is shifted by Luxon, as today. A repeated hour publishes once.

### Profile timezone changed during a slot

The sync updates `timezone` on every connection but skips recomputing `nextRunAt` for connections the scheduler has locked. The locked run finishes with a slot computed in the old timezone. From the following slot on, the scheduler reads the new `timezone`.

## Migration and Rollout

1. Deploy backend and frontend together.
2. On start, the migration converts every Page to a one-time list and aligns timezones.
3. Pages keep posting once a day at their previous time until the user adds more times.

Rollback: an older build reads `dailyTime`, which the migration unsets. Rolling back requires restoring `dailyTime` from `dailyTimes[0]` with a one-off update.

## Testing

### scheduleService

- Normalization: sorting, 1–10 limit, empty list, duplicates, invalid format, the 15-minute gap, and the gap across midnight.
- Next slot: a later time today, the first time tomorrow after the last slot, an exact-match time moving to the following slot, and a daylight-saving zone such as `America/New_York`.
- Suggestions for counts 1 through 10, all valid under `normalizeDailyTimes`.
- Timezone sync: updates every connection, recomputes only active connected unlocked Pages, and reports the count.

### Scheduler

- Several slots a day publish one post per slot.
- An empty queue advances without publishing.
- Missed slots collapse to at most one catch-up post, and none when outside the grace window.
- An invalid stored schedule falls back and records `lastError`.

### Controllers

- `updateConnection` validates `dailyTimes`, returns `INVALID_SCHEDULE`, and recomputes `nextRunAt`.
- Profile timezone change calls the sync and returns `rescheduledPages`.
- Meta login uses the Profile timezone for new and reconnected Pages.

### Migration

- Copies `dailyTime` into `dailyTimes` and unsets it.
- Running twice changes nothing the second time.

### Frontend

- Type check, lint with no new errors, and a production build.

## Non-Goals and Follow-Ups

- Per-weekday schedules.
- Expected publish times on the Queue page.
- Pinning a post to a specific slot.
