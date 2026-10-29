'use client';

import React from 'react';
import Link from 'next/link';
import {
    ideaHref,
    type AnalyticsTipCategory,
    type AnalyticsTipIdea,
} from '@/lib/types';

const TONES: Record<string, string> = {
    info: 'border-sky-500/20 bg-sky-500/5',
    success: 'border-emerald-500/20 bg-emerald-500/5',
    warning: 'border-amber-500/25 bg-amber-500/5',
};

const TITLE_TONES: Record<string, string> = {
    info: 'text-sky-800 dark:text-sky-200',
    success: 'text-emerald-800 dark:text-emerald-200',
    warning: 'text-amber-800 dark:text-amber-200',
};

const CATEGORIES: Record<AnalyticsTipCategory, { label: string; icon: React.ReactNode }> = {
    timing: {
        label: 'Timing',
        icon: (
            <>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
            </>
        ),
    },
    format: {
        label: 'Format',
        icon: (
            <>
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <path d="M10 9l5 3-5 3V9Z" />
            </>
        ),
    },
    content: {
        label: 'Content',
        icon: <path d="M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8L12 3Z" />,
    },
    consistency: {
        label: 'Consistency',
        icon: (
            <>
                <rect x="3" y="5" width="18" height="16" rx="2.5" />
                <path d="M3 10h18M8 3v4M16 3v4" />
            </>
        ),
    },
    growth: {
        label: 'Growth',
        icon: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
    },
};

export interface TipCardData {
    title: string;
    body: string;
    severity: 'info' | 'success' | 'warning';
    category?: AnalyticsTipCategory;
    actionLabel: string;
    actionHref: string;
    idea?: AnalyticsTipIdea | null;
}

/** One recommendation, with a button that turns its idea into a draft. */
export function AnalyticsTipCard({
    tip,
    highlight = false,
}: {
    tip: TipCardData;
    /** The first AI tip: shown wider and labelled as the top priority. */
    highlight?: boolean;
}) {
    const category = CATEGORIES[tip.category ?? 'growth'];
    const idea = tip.idea ?? null;
    // Skip the plain link when it only repeats where the idea button goes.
    const showAction =
        Boolean(tip.actionHref) && (!idea || !ideaHref(idea).startsWith(tip.actionHref));

    return (
        <div
            className={`flex flex-col rounded-2xl border p-4 transition-shadow duration-200 hover:shadow-card-hover ${
                TONES[tip.severity] || TONES.info
            } ${highlight ? 'sm:col-span-2' : ''}`}
        >
            <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-muted">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden="true">
                        {category.icon}
                    </svg>
                    {category.label}
                </span>
                {highlight ? (
                    <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white">
                        Do this first
                    </span>
                ) : null}
            </div>
            <div className={`text-sm font-bold ${TITLE_TONES[tip.severity] || TITLE_TONES.info}`}>
                {tip.title}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-fg-2">{tip.body}</p>

            {idea ? (
                <div className="mt-3 rounded-xl border border-line bg-surface p-3">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-subtle">
                        {idea.format === 'reel' ? 'Reel idea' : 'Post idea'}
                    </div>
                    <p className="mt-1 text-xs text-fg">{idea.topic}</p>
                </div>
            ) : null}

            {idea || showAction ? (
                <div className="mt-auto flex flex-wrap items-center gap-3 pt-3">
                    {idea ? (
                        <Link
                            href={ideaHref(idea)}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm shadow-indigo-600/20 transition-all hover:-translate-y-px hover:bg-indigo-500"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden="true">
                                <path d="M12 5v14M5 12h14" />
                            </svg>
                            Create this {idea.format}
                        </Link>
                    ) : null}
                    {showAction ? (
                        <Link
                            href={tip.actionHref}
                            className="text-xs font-bold text-indigo-700 hover:underline dark:text-indigo-300"
                        >
                            {tip.actionLabel || 'Open'} →
                        </Link>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
