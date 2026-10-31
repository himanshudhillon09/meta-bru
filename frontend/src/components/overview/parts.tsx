'use client';

import React from 'react';
import type { OverviewDelivery, OverviewPageState, Platform } from '@/lib/types';

export const PLATFORM_LABELS: Record<Platform, string> = {
    facebook: 'Facebook',
    instagram: 'Instagram',
};

/** "Sat, 1 Nov, 09:00" in the given timezone. */
export function formatSlotTime(value: string, timezone: string, withDay = true): string {
    const date = new Date(value);
    try {
        return date.toLocaleString('en-IN', {
            timeZone: timezone,
            ...(withDay ? { weekday: 'short', day: 'numeric', month: 'short' } : {}),
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });
    } catch {
        return date.toLocaleString();
    }
}

/** The calendar day of a time in a timezone, as yyyy-MM-dd. */
export function dayKey(value: string | number, timezone: string): string {
    try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(value));
    } catch {
        return new Date(value).toISOString().slice(0, 10);
    }
}

/** Today / Tomorrow / Mon, 3 Nov for a yyyy-MM-dd day. */
export function dayHeading(day: string, timezone: string, now: number): string {
    if (now > 0) {
        if (day === dayKey(now, timezone)) return 'Today';
        if (day === dayKey(now + 86_400_000, timezone)) return 'Tomorrow';
        if (day === dayKey(now - 86_400_000, timezone)) return 'Yesterday';
    }
    return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
    });
}

const STATE_STYLES: Record<OverviewPageState, { label: string; className: string; dot: string }> = {
    active: {
        label: 'Posting',
        className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        dot: 'bg-emerald-500',
    },
    paused: {
        label: 'Paused',
        className: 'border-slate-500/20 bg-slate-500/10 text-fg-2',
        dot: 'bg-slate-400',
    },
    reconnect: {
        label: 'Reconnect',
        className: 'border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300',
        dot: 'bg-rose-500',
    },
    disconnected: {
        label: 'Disconnected',
        className: 'border-slate-500/20 bg-slate-500/10 text-muted',
        dot: 'bg-slate-400',
    },
};

export function PageStatePill({ state }: { state: OverviewPageState }) {
    const style = STATE_STYLES[state];
    return (
        <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${style.className}`}
        >
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
            {style.label}
        </span>
    );
}

const DELIVERY_STYLES = {
    published: { icon: '✓', className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', label: 'sent' },
    failed: { icon: '✕', className: 'border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300', label: 'failed' },
    publishing: { icon: '…', className: 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300', label: 'sending' },
    pending: { icon: '…', className: 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300', label: 'waiting' },
} as const;

/** Where a post went: one chip per platform, plus its Stories. Icon and word, never colour alone. */
export function DeliveryChips({
    targets,
    storyTargets = [],
}: {
    targets: OverviewDelivery[];
    storyTargets?: OverviewDelivery[];
}) {
    const chips = [
        ...targets.map((target) => ({ key: target.platform, label: PLATFORM_LABELS[target.platform], status: target.status })),
        ...storyTargets.map((target) => ({
            key: `story-${target.platform}`,
            label: `${target.platform === 'facebook' ? 'FB' : 'IG'} Story`,
            status: target.status,
        })),
    ];
    if (chips.length === 0) return null;
    return (
        <span className="inline-flex flex-wrap items-center gap-1">
            {chips.map((chip) => {
                const style = DELIVERY_STYLES[chip.status];
                return (
                    <span
                        key={chip.key}
                        title={`${chip.label}: ${style.label}`}
                        className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${style.className}`}
                    >
                        <span aria-hidden="true">{style.icon}</span>
                        {chip.label}
                        <span className="sr-only">{style.label}</span>
                    </span>
                );
            })}
        </span>
    );
}

/** Where a queued post will go. */
export function PlatformChips({ platforms, story }: { platforms: Platform[]; story: boolean }) {
    return (
        <span className="inline-flex flex-wrap items-center gap-1">
            {platforms.map((platform) => (
                <span
                    key={platform}
                    className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-fg-2"
                >
                    <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: platform === 'facebook' ? 'var(--viz-facebook)' : 'var(--viz-instagram)' }}
                    />
                    {PLATFORM_LABELS[platform]}
                </span>
            ))}
            {story ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-fg-2">
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--viz-story)' }} />
                    + Story
                </span>
            ) : null}
        </span>
    );
}

export function Thumb({ src, size = 'md' }: { src: string; size?: 'sm' | 'md' }) {
    const box = size === 'sm' ? 'h-9 w-9 rounded-lg' : 'h-12 w-12 rounded-xl';
    return src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" className={`${box} shrink-0 border border-line bg-sunken object-cover`} />
    ) : (
        <span aria-hidden="true" className={`${box} shrink-0 border border-line bg-sunken`} />
    );
}

/** A titled card; every Overview section uses it so spacing stays even. */
export function Section({
    title,
    description,
    action,
    children,
    className = '',
}: {
    title: string;
    description?: React.ReactNode;
    action?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <section className={`rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6 ${className}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="text-sm font-bold text-fg">{title}</h2>
                    {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
                </div>
                {action}
            </div>
            <div className="mt-4">{children}</div>
        </section>
    );
}

export const linkClass =
    'text-xs font-bold text-indigo-700 hover:text-indigo-600 dark:text-indigo-300 dark:hover:text-indigo-200';
