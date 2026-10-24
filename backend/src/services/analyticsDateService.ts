import { DateTime } from 'luxon';
import { AppError } from '../utils/errors.js';

export const ANALYTICS_TIMEZONE = 'Asia/Kolkata';
export const MAX_RANGE_DAYS = 730;

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface AnalyticsRange {
    from: Date;
    to: Date;
    fromKey: string;
    toKey: string;
    granularity: 'day' | 'week';
}

export interface AnalyticsBucket {
    key: string;
    label: string;
    start: Date;
    end: Date;
}

function ist(value: Date | string): DateTime {
    return typeof value === 'string'
        ? DateTime.fromISO(value, { zone: ANALYTICS_TIMEZONE })
        : DateTime.fromJSDate(value, { zone: 'utc' }).setZone(ANALYTICS_TIMEZONE);
}

export function parseAnalyticsRange(from: string, to: string): AnalyticsRange {
    if (!DAY_KEY_PATTERN.test(from) || !DAY_KEY_PATTERN.test(to)) {
        throw new AppError(400, 'from and to must be valid YYYY-MM-DD dates', 'INVALID_RANGE');
    }

    const start = ist(from).startOf('day');
    const end = ist(to).endOf('day');

    // Round-trip both parsed values to reject dates that Luxon would normalize
    // (for example '2026-02-30' becoming a March date).
    if (
        !start.isValid ||
        !end.isValid ||
        start.toFormat('yyyy-MM-dd') !== from ||
        end.toFormat('yyyy-MM-dd') !== to
    ) {
        throw new AppError(400, 'from and to must be valid YYYY-MM-DD dates', 'INVALID_RANGE');
    }
    if (start > end) {
        throw new AppError(400, 'from must be on or before to', 'INVALID_RANGE');
    }

    const today = DateTime.now().setZone(ANALYTICS_TIMEZONE).endOf('day');
    const clampedEnd = end > today ? today : end;
    if (start > clampedEnd) {
        throw new AppError(400, 'from must be on or before today', 'INVALID_RANGE');
    }

    const days =
        Math.floor(clampedEnd.startOf('day').diff(start.startOf('day'), 'days').days) + 1;
    if (days > MAX_RANGE_DAYS) {
        throw new AppError(400, `Range cannot exceed ${MAX_RANGE_DAYS} days`, 'INVALID_RANGE');
    }

    return {
        from: start.toUTC().toJSDate(),
        to: clampedEnd.toUTC().toJSDate(),
        fromKey: start.toFormat('yyyy-MM-dd'),
        toKey: clampedEnd.toFormat('yyyy-MM-dd'),
        granularity: days > 60 ? 'week' : 'day',
    };
}

export function toIstDayKey(value: Date): string {
    return ist(value).toFormat('yyyy-MM-dd');
}

export function toIstDayLabel(key: string): string {
    return ist(key).toFormat('d LLL');
}

export function startOfIstWeek(value: Date | string): DateTime {
    const dt = ist(value).startOf('day');
    return dt.minus({ days: dt.weekday - 1 });
}

export function toIstWeekKey(value: Date): string {
    return startOfIstWeek(value).toFormat('yyyy-MM-dd');
}

export function toIstWeekLabel(key: string): string {
    return `Week of ${ist(key).toFormat('d LLL')}`;
}

export function istWeekday(value: Date): number {
    return ist(value).weekday;
}

export function istHourBlock(value: Date): number {
    return Math.floor(ist(value).hour / 3);
}

export function bucketKeyForDate(value: Date, granularity: 'day' | 'week'): string {
    return granularity === 'day' ? toIstDayKey(value) : toIstWeekKey(value);
}

export function buildAnalyticsBuckets(range: AnalyticsRange): AnalyticsBucket[] {
    // Weekly buckets are Monday-anchored in IST and may extend outside the
    // requested range by design; callers filter posts by the requested range
    // before bucketing.
    const buckets: AnalyticsBucket[] = [];
    let cursor =
        range.granularity === 'day'
            ? ist(range.fromKey).startOf('day')
            : startOfIstWeek(range.fromKey);
    const last = ist(range.toKey).startOf('day');

    while (cursor <= last) {
        const end =
            range.granularity === 'day'
                ? cursor.endOf('day')
                : cursor.plus({ days: 6 }).endOf('day');
        buckets.push({
            key: cursor.toFormat('yyyy-MM-dd'),
            label:
                range.granularity === 'day'
                    ? cursor.toFormat('d LLL')
                    : `Week of ${cursor.toFormat('d LLL')}`,
            start: cursor.toUTC().toJSDate(),
            end: end.toUTC().toJSDate(),
        });
        cursor = cursor.plus(range.granularity === 'day' ? { days: 1 } : { weeks: 1 });
    }

    return buckets;
}
