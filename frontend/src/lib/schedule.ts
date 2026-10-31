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
    const total = Number.isFinite(count)
        ? Math.min(MAX_DAILY_SLOTS, Math.max(1, Math.floor(count)))
        : 1;
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
        // Include the gap from the last time today to the first time tomorrow.
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
    const valid = [
        ...new Set(times.filter((time) => DAILY_TIME_PATTERN.test(time))),
    ].sort();
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

function dayKey(date: Date, timezone: string): string {
    try {
        return date.toLocaleDateString('en-CA', { timeZone: timezone });
    } catch {
        return date.toLocaleDateString('en-CA');
    }
}

/**
 * "Today, 7:00 pm", "Tomorrow, 9:00 am", or "Sat, 2 Nov, 9:00 am" in the
 * Page's timezone. Without `now` (0 before mount) it always names the day.
 */
export function friendlySlot(value: string, timezone: string, now = 0): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const options = (extra: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions => ({
        ...extra,
        timeZone: timezone,
    });
    let time: string;
    let day: string;
    // en-IN gives "7:00 pm", matching the rest of the app's times.
    try {
        time = date.toLocaleTimeString('en-IN', options({ hour: 'numeric', minute: '2-digit' }));
        day = date.toLocaleDateString('en-IN', options({ weekday: 'short', day: 'numeric', month: 'short' }));
    } catch {
        time = date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
        day = date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
    }
    if (now > 0) {
        const target = dayKey(date, timezone);
        if (target === dayKey(new Date(now), timezone)) return `Today, ${time}`;
        if (target === dayKey(new Date(now + 86_400_000), timezone)) return `Tomorrow, ${time}`;
    }
    return `${day}, ${time}`;
}
