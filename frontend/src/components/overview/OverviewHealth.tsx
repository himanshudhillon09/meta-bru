'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { formatElapsed, type AttentionItem, type AttentionLevel, type OverviewReport } from '@/lib/types';

type Tone = 'good' | 'warn' | 'bad' | 'neutral';

const TONE_DOT: Record<Tone, string> = {
    good: 'bg-emerald-500',
    warn: 'bg-amber-500',
    bad: 'bg-rose-500',
    neutral: 'bg-slate-400',
};

const TONE_TEXT: Record<Tone, string> = {
    good: 'text-emerald-700 dark:text-emerald-300',
    warn: 'text-amber-700 dark:text-amber-300',
    bad: 'text-rose-700 dark:text-rose-300',
    neutral: 'text-fg-2',
};

function StatusCell({
    label,
    value,
    detail,
    tone,
    href,
}: {
    label: string;
    value: string;
    detail: string;
    tone: Tone;
    href: string;
}) {
    return (
        <Link
            href={href}
            className="group min-w-0 rounded-xl px-3 py-2.5 transition-colors hover:bg-hover focus-visible:bg-hover"
        >
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-subtle">{label}</div>
            <div className={`mt-1 flex items-center gap-1.5 text-sm font-bold ${TONE_TEXT[tone]}`}>
                <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} />
                <span className="truncate">{value}</span>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-subtle group-hover:text-muted">{detail}</div>
        </Link>
    );
}

/**
 * The account at a glance: is automatic posting running, are the Pages
 * healthy, and are the keys it depends on in place.
 */
export function StatusStrip({ report, now }: { report: OverviewReport; now: number }) {
    const { scheduler, setup, pages } = report;
    const active = pages.filter((page) => page.state === 'active').length;
    const paused = pages.filter((page) => page.state === 'paused').length;
    const reconnect = pages.filter((page) => page.state === 'reconnect').length;

    const schedulerCell =
        scheduler.state === 'running'
            ? { value: 'On', detail: `Checked ${formatElapsed(scheduler.lastTickAt, now).toLowerCase() || 'just now'}`, tone: 'good' as Tone }
            : scheduler.state === 'off'
              ? { value: 'Off on server', detail: 'Only Post now publishes', tone: 'bad' as Tone }
              : {
                    value: 'Stopped',
                    detail: scheduler.lastTickAt ? `Last check ${formatElapsed(scheduler.lastTickAt, now).toLowerCase()}` : 'Never checked',
                    tone: 'bad' as Tone,
                };

    return (
        <section
            aria-label="Account status"
            className="grid grid-cols-2 gap-1 rounded-2xl border border-line bg-surface p-2 shadow-card sm:grid-cols-3 lg:grid-cols-5"
        >
            <StatusCell label="Automatic posting" href="/queue" {...schedulerCell} />
            <StatusCell
                label="Pages"
                href="/connections"
                value={setup.pages === 0 ? 'None connected' : `${active} of ${setup.pages} posting`}
                detail={
                    setup.pages === 0
                        ? 'Connect a Page to start'
                        : [reconnect ? `${reconnect} need reconnect` : '', paused ? `${paused} paused` : '']
                              .filter(Boolean)
                              .join(' · ') || 'All schedules on'
                }
                tone={setup.pages === 0 || reconnect > 0 ? 'bad' : paused > 0 ? 'warn' : 'good'}
            />
            <StatusCell
                label="Instagram"
                href="/connections"
                value={setup.pages === 0 ? 'No Pages yet' : `${setup.instagramPages} of ${setup.pages} linked`}
                detail={
                    setup.instagramPages === setup.pages && setup.pages > 0
                        ? 'Every Page can post to Instagram'
                        : 'Link Instagram to a Page in Meta'
                }
                tone={setup.pages > 0 && setup.instagramPages === setup.pages ? 'good' : 'neutral'}
            />
            <StatusCell
                label="AI writer"
                href="/settings#ai"
                value={setup.aiProvider === 'claude' ? 'Claude' : 'Gemini'}
                detail={
                    !setup.aiKey
                        ? 'API key missing'
                        : setup.aiProvider === 'claude'
                          ? setup.geminiKey
                              ? 'Images by Gemini'
                              : 'Add Gemini for images'
                          : 'Key saved'
                }
                tone={!setup.aiKey ? 'warn' : setup.aiProvider === 'claude' && !setup.geminiKey ? 'warn' : 'good'}
            />
            <StatusCell
                label="Media storage"
                href="/settings#integrations"
                value={setup.cloudinary ? 'Cloudinary' : 'Not set up'}
                detail={setup.cloudinary ? 'Uploads ready' : 'Needed for new media'}
                tone={setup.cloudinary ? 'good' : 'warn'}
            />
        </section>
    );
}

const LEVEL_STYLES: Record<AttentionLevel, { icon: React.ReactNode; ring: string; label: string }> = {
    critical: {
        label: 'Urgent',
        ring: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
        icon: <path d="M12 8v5m0 3.5v.01M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z" />,
    },
    warning: {
        label: 'Check',
        ring: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
        icon: (
            <>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7.5v5m0 3.5v.01" />
            </>
        ),
    },
    info: {
        label: 'Tip',
        ring: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
        icon: (
            <>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 11v5m0-8.5v.01" />
            </>
        ),
    },
};

const VISIBLE_ITEMS = 5;

/** What needs the user, worst first, each with the one step that fixes it. */
export function AttentionList({ items }: { items: AttentionItem[] }) {
    const [expanded, setExpanded] = useState(false);
    const counts = items.reduce(
        (sum, item) => ({ ...sum, [item.level]: sum[item.level] + 1 }),
        { critical: 0, warning: 0, info: 0 } as Record<AttentionLevel, number>
    );
    const shown = expanded ? items : items.slice(0, VISIBLE_ITEMS);

    if (items.length === 0) {
        return (
            <section className="flex items-start gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-5 shadow-card">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
                        <path d="m5 12.5 4.5 4.5L19 7.5" />
                    </svg>
                </span>
                <div>
                    <h2 className="text-sm font-bold text-emerald-800 dark:text-emerald-200">All clear</h2>
                    <p className="mt-0.5 text-xs text-emerald-800/80 dark:text-emerald-200/80">
                        Automatic posting is running, every Page has posts queued, and nothing failed this week.
                    </p>
                </div>
            </section>
        );
    }

    return (
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-fg">Needs attention</h2>
                <div className="flex flex-wrap gap-1.5 text-[10px] font-bold uppercase tracking-widest">
                    {(['critical', 'warning', 'info'] as const)
                        .filter((level) => counts[level] > 0)
                        .map((level) => (
                            <span key={level} className={`rounded-full px-2 py-0.5 ${LEVEL_STYLES[level].ring}`}>
                                {counts[level]} {LEVEL_STYLES[level].label}
                            </span>
                        ))}
                </div>
            </div>
            <ul className="mt-3 divide-y divide-line">
                {shown.map((item) => {
                    const style = LEVEL_STYLES[item.level];
                    return (
                        <li key={item.id} className="flex items-start gap-3 py-3">
                            <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${style.ring}`}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                                    {style.icon}
                                </svg>
                                <span className="sr-only">{style.label}</span>
                            </span>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-fg">{item.title}</p>
                                <p className="mt-0.5 text-xs text-muted">{item.detail}</p>
                            </div>
                            <Link
                                href={item.href}
                                className="shrink-0 rounded-lg border border-line-strong bg-hover px-3 py-1.5 text-xs font-bold text-fg transition-colors hover:bg-hover-strong"
                            >
                                {item.action}
                            </Link>
                        </li>
                    );
                })}
            </ul>
            {items.length > VISIBLE_ITEMS ? (
                <button
                    type="button"
                    onClick={() => setExpanded((value) => !value)}
                    className="mt-1 text-xs font-bold text-indigo-700 hover:text-indigo-600 dark:text-indigo-300"
                >
                    {expanded ? 'Show fewer' : `Show ${items.length - VISIBLE_ITEMS} more`}
                </button>
            ) : null}
        </section>
    );
}
