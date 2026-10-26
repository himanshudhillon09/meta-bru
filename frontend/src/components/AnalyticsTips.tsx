'use client';

import React from 'react';
import Link from 'next/link';
import type { AnalyticsRuleTip } from '@/lib/types';

const TONES: Record<string, string> = {
    info: 'border-sky-500/15 bg-sky-500/5 text-sky-200',
    success: 'border-emerald-500/15 bg-emerald-500/5 text-emerald-200',
    warning: 'border-amber-500/15 bg-amber-500/5 text-amber-200',
};

export function AnalyticsTips({ tips }: { tips: AnalyticsRuleTip[] }) {
    return (
        <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-5">
            <div className="mb-4 flex items-center gap-2">
                <h2 className="text-sm font-bold text-white">
                    Engagement tips
                </h2>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                    Rule-based
                </span>
            </div>
            {tips.length === 0 ? (
                <p className="text-sm text-slate-500">
                    Publish a few posts to unlock tips.
                </p>
            ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                    {tips.map((tip) => (
                        <div
                            key={tip.id}
                            className={`rounded-2xl border p-4 ${TONES[tip.severity] || TONES.info}`}
                        >
                            <div className="text-sm font-bold">{tip.title}</div>
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
        </section>
    );
}
