'use client';

import React from 'react';

interface ShareToStoryToggleProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    /** One line on what the Story will contain. */
    detail: string;
}

export function ShareToStoryToggle({
    checked,
    onChange,
    detail,
}: ShareToStoryToggleProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className={`mt-4 w-full flex items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-all ${
                checked
                    ? 'border-amber-500/30 bg-amber-500/10'
                    : 'border-line bg-surface-2 hover:border-line-strong'
            }`}
        >
            <span
                className={`mt-0.5 relative inline-flex h-5 w-9 shrink-0 rounded-full transition-all ${
                    checked ? 'bg-amber-500' : 'bg-line-strong'
                }`}
            >
                <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                        checked ? 'left-[18px]' : 'left-0.5'
                    }`}
                />
            </span>
            <span>
                <span className="block text-xs font-bold text-fg">
                    Also share to Story
                </span>
                <span className="block text-[11px] text-muted mt-0.5">
                    {detail}
                </span>
            </span>
        </button>
    );
}
