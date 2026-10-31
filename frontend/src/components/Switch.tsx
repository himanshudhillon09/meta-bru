'use client';

import React from 'react';

type Tone = 'facebook' | 'instagram' | 'emerald';

const TRACK_ON: Record<Tone, string> = {
    facebook: 'bg-blue-600',
    instagram: 'bg-gradient-to-r from-fuchsia-600 via-rose-500 to-orange-400',
    emerald: 'bg-emerald-600',
};

interface SwitchProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: React.ReactNode;
    /** One line under the label saying what on or off means. */
    description?: React.ReactNode;
    tone?: Tone;
    disabled?: boolean;
}

/**
 * A labelled on/off switch. The whole row is the control, so it is easy to
 * hit, and the description says what the setting does.
 */
export function Switch({ checked, onChange, label, description, tone = 'emerald', disabled }: SwitchProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={typeof label === 'string' ? label : undefined}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
        >
            <span
                aria-hidden="true"
                className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
                    checked ? TRACK_ON[tone] : 'bg-line-strong'
                }`}
            >
                <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all duration-200 ${
                        checked ? 'left-[18px]' : 'left-0.5'
                    }`}
                />
            </span>
            <span className="min-w-0">
                <span className="block text-sm font-semibold text-fg">{label}</span>
                {description ? <span className="mt-0.5 block text-xs text-muted">{description}</span> : null}
            </span>
        </button>
    );
}
