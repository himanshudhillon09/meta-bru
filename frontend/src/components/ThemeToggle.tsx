'use client';

import React, { useSyncExternalStore } from 'react';
import { currentTheme, setTheme, subscribeTheme } from '@/lib/theme';

interface ThemeToggleProps {
    /** Show "Light"/"Dark" next to the icon (sidebar); icon only otherwise. */
    withLabel?: boolean;
    className?: string;
}

function SunIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4.5 h-4.5" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
    );
}

function MoonIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4.5 h-4.5" aria-hidden="true">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
    );
}

export function ThemeToggle({ withLabel = false, className = '' }: ThemeToggleProps) {
    // The server always renders light; the stored theme is read on the client.
    const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => 'light' as const);
    const next = theme === 'dark' ? 'light' : 'dark';

    return (
        <button
            type="button"
            onClick={() => setTheme(next)}
            aria-label={`Switch to ${next} theme`}
            title={`Switch to ${next} theme`}
            className={`inline-flex items-center gap-2 rounded-xl border border-line bg-surface text-muted hover:text-fg hover:bg-hover transition-colors ${
                withLabel ? 'px-3 py-2 text-sm font-semibold' : 'h-9 w-9 justify-center'
            } ${className}`}
        >
            <span key={theme} className="inline-flex animate-spin-in">
                {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </span>
            {withLabel ? <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span> : null}
        </button>
    );
}
