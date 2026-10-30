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

/**
 * The Page's next `count` posting slots, starting with `first` (its stored
 * next slot). Each slot publishes one queued post, oldest first.
 */
export function upcomingSlots(
    times: unknown,
    timezone: string,
    first: Date,
    count: number
): Date[] {
    const slots: Date[] = [];
    let slot = first;
    for (let index = 0; index < count; index += 1) {
        slots.push(slot);
        slot = nextSlotOrFallback(times, timezone, slot).nextRunAt;
    }
    return slots;
}

/** Evenly spaced times from 09:00 to 21:00, rounded to 5 minutes. */
export function suggestDailyTimes(count: number): string[] {
    const total = Number.isFinite(count)
        ? Math.min(MAX_DAILY_SLOTS, Math.max(1, Math.floor(count)))
        : 1;
    if (total === 1) return [DEFAULT_DAILY_TIME];
    const step = (SUGGESTION_END - SUGGESTION_START) / (total - 1);
    return Array.from({ length: total }, (_, index) =>
        fromMinutes(Math.round((SUGGESTION_START + step * index) / 5) * 5)
    );
}
