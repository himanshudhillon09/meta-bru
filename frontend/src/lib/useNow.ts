'use client';

import { useEffect, useState } from 'react';

/**
 * The current time in ms, refreshed every minute. It is 0 until the page has
 * mounted, so the server and the first client render match.
 */
export function useNow(intervalMs = 60_000): number {
    const [now, setNow] = useState(0);
    useEffect(() => {
        const tick = () => setNow(Date.now());
        const first = setTimeout(tick, 0);
        const timer = setInterval(tick, intervalMs);
        return () => {
            clearTimeout(first);
            clearInterval(timer);
        };
    }, [intervalMs]);
    return now;
}
