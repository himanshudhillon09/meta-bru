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

/**
 * Engagement rate by weekday and 3-hour block in IST, darker where posts did
 * better. A block needs two posts before it gets a colour.
 */
export function BestTimes({ buckets }: { buckets: AnalyticsBestTime[] }) {
    const rated = buckets.filter((bucket) => bucket.avgEngagementRate !== null);
    const max = Math.max(0, ...rated.map((bucket) => bucket.avgEngagementRate ?? 0));
    const top = [...rated]
        .sort((a, b) => (b.avgEngagementRate ?? 0) - (a.avgEngagementRate ?? 0))
        .slice(0, 3);
    const cell = (day: number, block: number) =>
        buckets.find((bucket) => bucket.day === day && bucket.block === block);

    return (
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <h2 className="text-sm font-bold text-fg">Best time to post</h2>
            <p className="mt-0.5 text-xs text-muted">
                Engagement rate by day and time (IST). A slot needs at least 2 posts to be rated.
            </p>

            <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[460px] border-separate border-spacing-[3px] text-[10px]">
                        <thead>
                            <tr>
                                <th />
                                {Array.from({ length: 8 }, (_, block) => (
                                    <th key={block} className="pb-1 font-semibold text-subtle">
                                        {hourLabel(block * 3)}
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
                                        const rate = bucket?.avgEngagementRate ?? null;
                                        const posts = bucket?.posts ?? 0;
                                        const level =
                                            rate !== null && max > 0 ? Math.max(1, Math.ceil((rate / max) * STEPS)) : 0;
                                        const description =
                                            rate !== null
                                                ? `${dayLabel} ${blockLabel(block)}: ${rate}% engagement from ${posts} posts`
                                                : posts > 0
                                                  ? `${dayLabel} ${blockLabel(block)}: ${posts} post, not enough to rate`
                                                  : `${dayLabel} ${blockLabel(block)}: no posts`;
                                        return (
                                            <td key={block} className="p-0">
                                                <div
                                                    role="img"
                                                    aria-label={description}
                                                    title={description}
                                                    className={`flex h-8 items-center justify-center rounded-md transition-transform hover:scale-110 ${
                                                        level === 0 ? 'border border-dashed border-line bg-surface-2' : ''
                                                    }`}
                                                    style={level > 0 ? { background: `var(--viz-heat-${level})` } : undefined}
                                                >
                                                    {level === 0 && posts > 0 ? (
                                                        <span className="h-1 w-1 rounded-full bg-faint" aria-hidden="true" />
                                                    ) : null}
                                                </div>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="mt-2 flex items-center gap-2 text-[10px] text-subtle">
                        <span>Lower</span>
                        <div className="flex gap-0.5" aria-hidden="true">
                            {Array.from({ length: STEPS }, (_, step) => (
                                <span
                                    key={step}
                                    className="h-2.5 w-5 rounded-sm"
                                    style={{ background: `var(--viz-heat-${step + 1})` }}
                                />
                            ))}
                        </div>
                        <span>Higher engagement</span>
                        <span className="ml-3 inline-flex items-center gap-1">
                            <span className="h-1 w-1 rounded-full bg-faint" aria-hidden="true" /> posted, not yet rated
                        </span>
                    </div>
                </div>

                <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-subtle">Your best slots</div>
                    {top.length === 0 ? (
                        <p className="mt-2 text-xs text-subtle">
                            Post at least twice in the same day and time slot to see which slots work best.
                        </p>
                    ) : (
                        <ol className="mt-2 space-y-2">
                            {top.map((bucket, index) => (
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
                                            {bucket.avgEngagementRate}% engagement · {bucket.posts} posts
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </ol>
                    )}
                    <p className="mt-3 text-[11px] text-subtle">
                        Set these as posting times in Pages &amp; Schedule.
                    </p>
                </div>
            </div>
        </section>
    );
}
