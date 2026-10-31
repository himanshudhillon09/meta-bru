'use client';

import React from 'react';
import type { AnalyticsBestTime } from '@/lib/types';

const STEPS = 6;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function hourLabel(hour: number): string {
    const value = hour % 24;
    if (value === 0) return '12am';
    if (value === 12) return '12pm';
    return value < 12 ? `${value}am` : `${value - 12}pm`;
}

function blockLabel(block: number): string {
    return `${hourLabel(block * 3)}–${hourLabel(block * 3 + 3)}`;
}

function rateOf(bucket: AnalyticsBestTime | undefined): number | null {
    if (!bucket || bucket.posts === 0) return null;
    return bucket.engagementRate ?? bucket.avgEngagementRate ?? null;
}

function shortRate(rate: number): string {
    return rate >= 10 ? `${Math.round(rate)}%` : `${Math.round(rate * 10) / 10}%`;
}

/**
 * Engagement rate by weekday and 3-hour block in IST. Each slot with posts
 * shows its rate; darker is better. A slot with a single post is outlined,
 * since one post is an early signal rather than a pattern.
 */
export function BestTimes({ buckets }: { buckets: AnalyticsBestTime[] }) {
    const cell = (day: number, block: number) =>
        buckets.find((bucket) => bucket.day === day && bucket.block === block);
    const withRate = buckets.filter((bucket) => rateOf(bucket) !== null);
    const max = Math.max(0, ...withRate.map((bucket) => rateOf(bucket) ?? 0));
    const reliable = withRate.filter((bucket) => bucket.posts >= 2);
    const ranked = (reliable.length > 0 ? reliable : withRate)
        .sort((a, b) => (rateOf(b) ?? 0) - (rateOf(a) ?? 0))
        .slice(0, 3);
    const early = reliable.length === 0 && ranked.length > 0;
    const posted = buckets.reduce((sum, bucket) => sum + bucket.posts, 0);

    return (
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <h2 className="text-sm font-bold text-fg">Best time to post</h2>
            <p className="mt-0.5 text-xs text-muted">
                Each box is a 3-hour slot in IST. The number is the engagement rate of posts published then; darker
                means better.
            </p>

            <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_230px]">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] border-separate border-spacing-[3px] text-[10px]">
                        <thead>
                            <tr>
                                <th />
                                {Array.from({ length: 8 }, (_, block) => (
                                    <th key={block} className="pb-1 font-semibold text-subtle">
                                        {blockLabel(block)}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {DAYS.map((dayLabel, index) => (
                                <tr key={dayLabel}>
                                    <th className="pr-2 text-right font-semibold text-subtle">{dayLabel}</th>
                                    {Array.from({ length: 8 }, (_, block) => {
                                        const bucket = cell(index + 1, block);
                                        const rate = rateOf(bucket);
                                        const posts = bucket?.posts ?? 0;
                                        const level =
                                            rate !== null && max > 0 ? Math.max(1, Math.ceil((rate / max) * STEPS)) : 0;
                                        const description =
                                            posts === 0
                                                ? `${dayLabel} ${blockLabel(block)}: no posts yet`
                                                : rate === null
                                                  ? `${dayLabel} ${blockLabel(block)}: ${posts} post${posts === 1 ? '' : 's'}, no insights yet`
                                                  : `${dayLabel} ${blockLabel(block)}: ${rate}% engagement from ${posts} post${posts === 1 ? '' : 's'}`;
                                        return (
                                            <td key={block} className="p-0">
                                                <div
                                                    role="img"
                                                    aria-label={description}
                                                    title={description}
                                                    className={`flex h-9 items-center justify-center rounded-md text-[11px] font-bold transition-transform hover:scale-105 ${
                                                        posts === 0
                                                            ? 'bg-surface-2'
                                                            : level === 0
                                                              ? 'border border-line-strong bg-surface-2 text-subtle'
                                                              : posts === 1
                                                                ? 'outline-2 -outline-offset-2 outline-dashed outline-[color:var(--fg-2)]'
                                                                : ''
                                                    }`}
                                                    style={
                                                        level > 0
                                                            ? {
                                                                  background: `var(--viz-heat-${level})`,
                                                                  color: `var(--viz-heat-ink-${level})`,
                                                              }
                                                            : undefined
                                                    }
                                                >
                                                    {rate !== null ? shortRate(rate) : posts > 0 ? `${posts}×` : ''}
                                                </div>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-subtle">
                        <span className="inline-flex items-center gap-2">
                            Lower
                            <span className="flex gap-0.5" aria-hidden="true">
                                {Array.from({ length: STEPS }, (_, step) => (
                                    <span
                                        key={step}
                                        className="h-2.5 w-5 rounded-sm"
                                        style={{ background: `var(--viz-heat-${step + 1})` }}
                                    />
                                ))}
                            </span>
                            Higher engagement
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <span
                                aria-hidden="true"
                                className="h-3.5 w-5 rounded-sm bg-[color:var(--viz-heat-3)] outline-2 -outline-offset-2 outline-dashed outline-[color:var(--fg-2)]"
                            />
                            only 1 post so far
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <span aria-hidden="true" className="h-3.5 w-5 rounded-sm border border-line-strong bg-surface-2" />
                            posted, insights not loaded yet
                        </span>
                    </div>
                </div>

                <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-subtle">Your best slots</div>
                    {ranked.length === 0 ? (
                        <p className="mt-2 text-xs text-subtle">
                            {posted === 0
                                ? 'Publish posts at different times to see which slots work best.'
                                : 'Insights for these posts are not loaded yet. Press Refresh insights.'}
                        </p>
                    ) : (
                        <ol className="mt-2 space-y-2">
                            {ranked.map((bucket, index) => (
                                <li
                                    key={`${bucket.day}-${bucket.block}`}
                                    className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2"
                                >
                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-bold text-white">
                                        {index + 1}
                                    </span>
                                    <div className="min-w-0">
                                        <div className="text-xs font-bold text-fg">
                                            {DAYS[bucket.day - 1]} {blockLabel(bucket.block)}
                                        </div>
                                        <div className="text-[11px] text-subtle">
                                            {rateOf(bucket)}% engagement · {bucket.posts} post{bucket.posts === 1 ? '' : 's'}
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </ol>
                    )}
                    {early ? (
                        <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
                            Early signal: each slot has only one post. Post a few more times in these slots to confirm.
                        </p>
                    ) : null}
                    <p className="mt-3 text-[11px] text-subtle">Set the best slots as posting times in Pages &amp; Schedule.</p>
                </div>
            </div>
        </section>
    );
}
