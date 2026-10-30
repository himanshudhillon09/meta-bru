'use client';

import React, { useState } from 'react';

const PREFERENCE_KEY = 'meta-bru:ai-label';

/**
 * Whether new posts carry Meta's "AI info" label. On by default; the last
 * choice is remembered in this browser so it does not need setting each time.
 * Editing a saved post passes `remember: false`, so it keeps its own setting.
 */
export function useAiLabelPreference(remember = true): [boolean, (value: boolean) => void] {
    const [value, setValue] = useState<boolean>(() => {
        if (typeof window === 'undefined') return true;
        try {
            return window.localStorage.getItem(PREFERENCE_KEY) !== 'off';
        } catch {
            return true;
        }
    });

    const update = (next: boolean) => {
        setValue(next);
        if (!remember) return;
        try {
            window.localStorage.setItem(PREFERENCE_KEY, next ? 'on' : 'off');
        } catch {
            // Private mode: the choice still applies to this post.
        }
    };

    return [value, update];
}

export function AiLabelToggle({
    checked,
    onChange,
}: {
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className={`mt-3 w-full flex items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-all ${
                checked
                    ? 'border-violet-500/30 bg-violet-500/10'
                    : 'border-line bg-surface-2 hover:border-line-strong'
            }`}
        >
            <span
                className={`mt-0.5 relative inline-flex h-5 w-9 shrink-0 rounded-full transition-all ${
                    checked ? 'bg-violet-500' : 'bg-line-strong'
                }`}
            >
                <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                        checked ? 'left-[18px]' : 'left-0.5'
                    }`}
                />
            </span>
            <span>
                <span className="flex items-center gap-1.5 text-xs font-bold text-fg">
                    Mark as AI-generated
                    <span className="rounded-full bg-violet-500/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-widest text-violet-700 dark:text-violet-300">
                        AI info
                    </span>
                </span>
                <span className="block text-[11px] text-muted mt-0.5">
                    Adds Meta&apos;s &quot;AI info&quot; label on Instagram, including its Story. Facebook&apos;s
                    publishing API has no AI label yet, so Facebook posts go out without it.
                </span>
            </span>
        </button>
    );
}

/** Small chip for lists of posts that carry the label. */
export function AiLabelChip() {
    return (
        <span
            title="Published with Meta's AI info label on Instagram"
            className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20"
        >
            AI info
        </span>
    );
}
