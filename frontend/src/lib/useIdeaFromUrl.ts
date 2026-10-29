'use client';

import { useEffect, useRef } from 'react';

/**
 * Picks up a `?topic=` idea sent from an Analytics tip once the page's saved
 * draft has loaded, so the draft cannot overwrite it. The parameter is then
 * removed from the address so a reload does not apply it again.
 */
export function useIdeaFromUrl(ready: boolean, onIdea: (topic: string) => void): void {
    const applied = useRef(false);

    useEffect(() => {
        if (!ready || applied.current) return;
        applied.current = true;

        const params = new URLSearchParams(window.location.search);
        const topic = params.get('topic')?.trim();
        if (!topic) return;

        params.delete('topic');
        const query = params.toString();
        window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
        onIdea(topic.slice(0, 500));
    }, [ready, onIdea]);
}
