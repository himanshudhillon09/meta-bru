/** Number formatting and period-over-period changes for the Analytics page. */

export function formatCount(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    return value.toLocaleString('en-IN');
}

/** 1,284 / 12.9K / 4.2M: for axes, tiles, and tight spaces. */
export function formatCompact(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    if (Math.abs(value) < 10_000) return value.toLocaleString('en-IN');
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function formatPercent(value: number | null | undefined): string {
    return value === null || value === undefined || !Number.isFinite(value) ? '—' : `${value}%`;
}

export interface Change {
    direction: 'up' | 'down' | 'flat';
    /** "+12%", "−3.4 pts", or "New". */
    label: string;
}

/**
 * How a value moved against the previous period. Rates change by
 * percentage points; counts by percent. Null when there is nothing to compare.
 */
export function changeBetween(
    current: number | null | undefined,
    previous: number | null | undefined,
    kind: 'count' | 'rate' = 'count'
): Change | null {
    if (current === null || current === undefined || previous === null || previous === undefined) {
        return null;
    }
    if (kind === 'rate') {
        const points = Math.round((current - previous) * 10) / 10;
        if (points === 0) return { direction: 'flat', label: 'No change' };
        return {
            direction: points > 0 ? 'up' : 'down',
            label: `${points > 0 ? '+' : '−'}${Math.abs(points)} pts`,
        };
    }
    if (previous === 0) {
        return current > 0 ? { direction: 'up', label: 'New' } : null;
    }
    const percent = Math.round(((current - previous) / previous) * 100);
    if (percent === 0) return { direction: 'flat', label: 'No change' };
    return {
        direction: percent > 0 ? 'up' : 'down',
        label: `${percent > 0 ? '+' : '−'}${Math.abs(percent)}%`,
    };
}

/** "previous 30 days" for a YYYY-MM-DD range. */
export function periodLabel(from: string, to: string): string {
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
    return Number.isFinite(days) && days > 0 ? `previous ${days} day${days === 1 ? '' : 's'}` : 'previous period';
}

/** "12 Oct" from YYYY-MM-DD. */
export function shortDate(day: string): string {
    const date = new Date(`${day}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return day;
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
