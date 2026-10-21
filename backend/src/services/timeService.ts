import { DateTime } from 'luxon';

/**
 * Returns the next occurrence of a local HH:mm time in the given IANA timezone,
 * strictly after `from`. DST transitions are handled by Luxon.
 */
export function computeNextRunAt(
    dailyTime: string,
    timezone: string,
    from: Date = new Date()
): Date {
    const [hourPart, minutePart] = dailyTime.split(':');
    const hour = Number(hourPart);
    const minute = Number(minutePart);

    if (
        !Number.isInteger(hour) ||
        !Number.isInteger(minute) ||
        hour < 0 ||
        hour > 23 ||
        minute < 0 ||
        minute > 59
    ) {
        throw new Error(`Invalid daily time: ${dailyTime}`);
    }

    const zone = DateTime.fromJSDate(from, { zone: 'utc' }).setZone(timezone);
    if (!zone.isValid) {
        throw new Error(`Invalid timezone: ${timezone}`);
    }

    let next = zone.set({ hour, minute, second: 0, millisecond: 0 });
    if (next <= zone) {
        next = next.plus({ days: 1 });
    }

    return next.toUTC().toJSDate();
}

export function isOlderThan(date: Date | null | undefined, minutes: number): boolean {
    if (!date) return true;
    return Date.now() - date.getTime() > minutes * 60_000;
}

export function isValidTimezone(timezone: string): boolean {
    return DateTime.now().setZone(timezone).isValid;
}
