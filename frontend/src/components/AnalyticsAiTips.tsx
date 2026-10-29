'use client';

import React from 'react';
import Link from 'next/link';
import { AnalyticsTipCard } from '@/components/AnalyticsTipCard';
import { formatIstDateTime, type AnalyticsAiInsight } from '@/lib/types';

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
                    Gemini{ai?.model ? ` · ${ai.model}` : ''}
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
                        className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-60"
                    >
                        {loading ? (
                            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        ) : null}
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
                        <div className="stagger grid gap-3 sm:grid-cols-2">
                            {ai.tips.map((tip, index) => (
                                <AnalyticsTipCard
                                    key={`${tip.title}-${index}`}
                                    tip={tip}
                                    highlight={index === 0}
                                />
                            ))}
                        </div>
                    )}
                    <p className="mt-3 text-[10px] text-subtle">
                        Cached for 6 hours. AI compares your best and weakest
                        posts by format, timing, caption, and reel watch time.
                        Pick the model under Profile.
                    </p>
                </>
            ) : (
                <div className="rounded-2xl border border-dashed border-line-strong p-8 text-center text-sm text-subtle">
                    Run an AI analysis to get a ranked plan: when to post,
                    reels or images, what to say, and ready-made ideas you can
                    open straight in the Composer or Reels page.
                </div>
            )}
        </section>
    );
}
