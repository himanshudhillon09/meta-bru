'use client';

import React from 'react';
import Link from 'next/link';
import { formatIstDateTime, type AnalyticsAiInsight } from '@/lib/types';

const TONES: Record<string, string> = {
    info: 'border-sky-500/15 bg-sky-500/5 text-sky-700 dark:text-sky-200',
    success: 'border-emerald-500/15 bg-emerald-500/5 text-emerald-700 dark:text-emerald-200',
    warning: 'border-amber-500/15 bg-amber-500/5 text-amber-700 dark:text-amber-200',
};

export function AnalyticsAiTips({
    ai,
    onGenerate,
    loading,
    error,
    notConfigured = false,
}: {
    ai: AnalyticsAiInsight | null;
    onGenerate: () => void;
    loading: boolean;
    error: string;
    notConfigured?: boolean;
}) {
    return (
        <section className="rounded-2xl border border-line bg-surface p-5">
            <div className="mb-4 flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-bold text-fg">AI analysis</h2>
                <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-indigo-700 dark:text-indigo-300">
                    Gemini
                </span>
                <div className="ml-auto flex items-center gap-2">
                    {ai ? (
                        <span className="text-[10px] text-subtle">
                            Generated {formatIstDateTime(ai.generatedAt)}
                        </span>
                    ) : null}
                    <button
                        type="button"
                        onClick={onGenerate}
                        disabled={loading}
                        className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                    >
                        {loading
                            ? 'Analyzing...'
                            : ai
                              ? 'Refresh AI analysis'
                              : 'Run AI analysis'}
                    </button>
                </div>
            </div>

            {error ? (
                <div className="mb-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                    <div>{error}</div>
                    {notConfigured ? (
                        <Link
                            href="/settings"
                            className="mt-1 inline-block font-bold underline"
                        >
                            Add your Gemini key in Profile
                        </Link>
                    ) : null}
                </div>
            ) : null}

            {ai ? (
                <>
                    {ai.tips.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-line-strong p-8 text-center text-sm text-subtle">
                            No AI tips were generated for this scope. Try a
                            wider date range or add more published posts.
                        </div>
                    ) : (
                        <div className="grid gap-3 sm:grid-cols-2">
                            {ai.tips.map((tip, index) => (
                                <div
                                    key={`${tip.title}-${index}`}
                                    className={`rounded-2xl border p-4 ${TONES[tip.severity] || TONES.info}`}
                                >
                                    <div className="text-sm font-bold">
                                        {tip.title}
                                    </div>
                                    <p className="mt-1 text-xs opacity-80">
                                        {tip.body}
                                    </p>
                                    {tip.actionHref ? (
                                        <Link
                                            href={tip.actionHref}
                                            className="mt-2 inline-block text-xs font-bold underline"
                                        >
                                            {tip.actionLabel || 'Open'}
                                        </Link>
                                    ) : null}
                                </div>
                            ))}
                        </div>
                    )}
                    <p className="mt-3 text-[10px] text-subtle">
                        Cached for 6 hours. AI uses stored page, engagement, and
                        timing aggregates only.
                    </p>
                </>
            ) : (
                <div className="rounded-2xl border border-dashed border-line-strong p-8 text-center text-sm text-subtle">
                    Run an AI analysis to turn your stored page, engagement, and
                    posting-time data into specific recommendations.
                </div>
            )}
        </section>
    );
}
