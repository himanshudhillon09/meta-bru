'use client';

import React from 'react';

type Tone = 'facebook' | 'instagram' | 'emerald';

const ON_STYLES: Record<Tone, string> = {
    facebook: 'border-blue-600 bg-blue-600 text-white shadow-sm shadow-blue-600/25 hover:bg-blue-500',
    instagram:
        'border-transparent bg-gradient-to-r from-fuchsia-600 via-rose-500 to-orange-400 text-white shadow-sm shadow-rose-500/25 hover:brightness-110',
    emerald: 'border-emerald-600 bg-emerald-600 text-white shadow-sm shadow-emerald-600/25 hover:bg-emerald-500',
};

interface ToggleChipProps {
    checked: boolean;
    onToggle: () => void;
    tone: Tone;
    disabled?: boolean;
    title?: string;
    children: React.ReactNode;
}

/**
 * On/off button for a platform or setting. On is a solid colour with a tick,
 * off is a plain outline, so the state reads at a glance.
 */
export function ToggleChip({ checked, onToggle, tone, disabled, title, children }: ToggleChipProps) {
    return (
        <button
            type="button"
            aria-pressed={checked}
            onClick={onToggle}
            disabled={disabled}
            title={title}
            className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-bold transition-all duration-200 disabled:opacity-40 ${
                checked
                    ? ON_STYLES[tone]
                    : 'border-line-strong bg-surface text-muted hover:bg-hover hover:text-fg'
            }`}
        >
            <span
                aria-hidden="true"
                className={`flex h-4 w-4 items-center justify-center rounded-full border transition-all duration-200 ${
                    checked ? 'border-white/0 bg-white/25' : 'border-current opacity-60'
                }`}
            >
                {checked ? (
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-2.5 w-2.5 animate-pop-in"
                    >
                        <path d="m5 12 4.5 4.5L19 7" />
                    </svg>
                ) : null}
            </span>
            {children}
        </button>
    );
}
