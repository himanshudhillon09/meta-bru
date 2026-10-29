'use client';

import React from 'react';
import { AnalyticsTipCard } from '@/components/AnalyticsTipCard';
import type { AnalyticsRuleTip } from '@/lib/types';

export function AnalyticsTips({ tips }: { tips: AnalyticsRuleTip[] }) {
    return (
        <section className="rounded-2xl border border-line bg-surface p-5">
            <div className="mb-4 flex items-center gap-2">
                <h2 className="text-sm font-bold text-fg">
                    Engagement tips
                </h2>
                <span className="rounded-full bg-sunken px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-muted">
                    Rule-based
                </span>
            </div>
            {tips.length === 0 ? (
                <p className="text-sm text-subtle">
                    Publish a few posts to unlock tips.
                </p>
            ) : (
                <div className="stagger grid gap-3 sm:grid-cols-2">
                    {tips.map((tip) => (
                        <AnalyticsTipCard key={tip.id} tip={tip} />
                    ))}
                </div>
            )}
        </section>
    );
}
