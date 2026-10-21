export const COMMON_TIMEZONES = [
    'UTC',
    'Asia/Kolkata',
    'Asia/Dubai',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Europe/London',
    'Europe/Berlin',
    'Europe/Paris',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Australia/Sydney',
];

/**
 * Prefer the browser's full IANA list so users are not limited to a short
 * hard-coded set. Fall back to common zones in older runtimes.
 */
export function getTimezoneOptions(current?: string): string[] {
    let zones: string[] = [];

    try {
        const supported = (
            Intl as typeof Intl & {
                supportedValuesOf?: (key: string) => string[];
            }
        ).supportedValuesOf?.('timeZone');

        if (supported?.length) {
            zones = supported;
        }
    } catch {
        // Older browsers may not implement supportedValuesOf.
    }

    if (zones.length === 0) {
        zones = COMMON_TIMEZONES;
    } else if (!zones.includes('UTC')) {
        zones = ['UTC', ...zones];
    }

    if (current && !zones.includes(current)) {
        return [current, ...zones];
    }

    return zones;
}

export function getInitialTimezoneOptions(current?: string): string[] {
    if (current && !COMMON_TIMEZONES.includes(current)) {
        return [current, ...COMMON_TIMEZONES];
    }
    return COMMON_TIMEZONES;
}
