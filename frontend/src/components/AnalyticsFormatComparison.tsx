'use client';

import React from 'react';
import Link from 'next/link';
import { formatWatchTime, type AnalyticsSummary } from '@/lib/types';

function formatNumber(value: number): string {
    return value.toLocaleString('en-IN');
}

function avgReach(summary: AnalyticsSummary): number | null {
    return summary.posts > 0 ? Math.round(summary.reach / summary.posts) : null;
}

function FormatCard({
    label,
    dot,
    summary,
    maxReach,
    reel,
}: {
    label: string;
    dot: string;
    summary: AnalyticsSummary;
    maxReach: number;
    reel: boolean;
}) {
    const reach = avgReach(summary);

    if (summary.posts === 0) {
        return (
            <div className="flex flex-col items-start justify-center rounded-2xl border border-dashed border-line-strong bg-surface-2 p-4">
                <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${dot}`} />
                    <span className="text-xs font-bold text-fg">{label}</span>
                </div>
                <p className="mt-2 text-xs text-muted">
                    No {reel ? 'reels' : 'image posts'} in this range yet.
                </p>
                <Link
                    href={reel ? '/reels' : '/composer'}
                    className="mt-2 text-xs font-bold text-indigo-700 hover:underline dark:text-indigo-300"
                >
                    {reel ? 'Make a reel' : 'Create a post'} →
                </Link>
            </div>
        );
    }

    return (
        <div className="rounded-2xl border border-line bg-surface-2 p-4">
            <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${dot}`} />
                <span className="text-xs font-bold text-fg">{label}</span>
                <span className="ml-auto text-[11px] text-subtle">
                    {summary.posts} {reel ? (summary.posts === 1 ? 'reel' : 'reels') : summary.posts === 1 ? 'post' : 'posts'}
                </span>
            </div>

            <div className="mt-3">
                <div className="flex items-baseline justify-between text-xs">
                    <span className="text-subtle">Avg reach per {reel ? 'reel' : 'post'}</span>
                    <span className="text-base font-bold text-fg">
                        {reach === null ? '—' : formatNumber(reach)}
                    </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-sunken">
                    <div
                        className={`h-full rounded-full ${dot} transition-[width] duration-700 ease-out`}
                        style={{ width: `${maxReach > 0 && reach ? Math.max(4, (reach / maxReach) * 100) : 0}%` }}
                    />
                </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div>
                    <span className="text-subtle">{reel ? 'Plays' : 'Views'}</span>
                    <div className="font-bold text-fg">{formatNumber(summary.views)}</div>
                </div>
                <div>
                    <span className="text-subtle">Interactions</span>
                    <div className="font-bold text-fg">{formatNumber(summary.interactions)}</div>
                </div>
                <div>
                    <span className="text-subtle">Rate</span>
                    <div className="font-bold text-emerald-700 dark:text-emerald-300">
                        {summary.engagementRate === null ? '—' : `${summary.engagementRate}%`}
                    </div>
                </div>
            </div>

            {reel ? (
                <div className="mt-3 border-t border-line pt-3">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                            <span className="text-subtle">Avg watch time</span>
                            <div className="font-bold text-fg">
                                {formatWatchTime(summary.avgWatchTimeMs)}
                            </div>
                        </div>
                        <div>
                            <span className="text-subtle">Watched</span>
                            <div className="font-bold text-fg">
                                {summary.watchedPercent === null || summary.watchedPercent === undefined
                                    ? '—'
                                    : `${summary.watchedPercent}% of each reel`}
                            </div>
                        </div>
                    </div>
                    {summary.watchedPercent !== null && summary.watchedPercent !== undefined ? (
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken">
                            <div
                                className={`h-full rounded-full transition-[width] duration-700 ease-out ${
                                    summary.watchedPercent >= 60
                                        ? 'bg-emerald-500'
                                        : summary.watchedPercent >= 35
                                          ? 'bg-amber-500'
                                          : 'bg-rose-500'
                                }`}
                                style={{ width: `${Math.min(100, summary.watchedPercent)}%` }}
                            />
                        </div>
                    ) : (
                        <p className="mt-1 text-[11px] text-subtle">
                            Watch time appears after the next insights sync.
                        </p>
                    )}
                </div>
            ) : null}
        </div>
    );
}

/** Image posts against reels, so it is clear which format to make more of. */
export function AnalyticsFormatComparison({
    byContentType,
    filter,
}: {
    byContentType: { image: AnalyticsSummary; reel: AnalyticsSummary };
    filter: 'all' | 'image' | 'reel';
}) {
    if (filter === 'image') return null;

    const { image, reel } = byContentType;
    const imageReach = avgReach(image);
    const reelReach = avgReach(reel);
    const maxReach = Math.max(imageReach ?? 0, reelReach ?? 0);

    let verdict = '';
    if (filter === 'all' && imageReach && reelReach) {
        const reelsWin = reelReach >= imageReach;
        const ratio = Math.round(((reelsWin ? reelReach : imageReach) / (reelsWin ? imageReach : reelReach)) * 10) / 10;
        verdict =
            ratio >= 1.1
                ? `${reelsWin ? 'Reels' : 'Image posts'} reach ${ratio}× more people per post`
                : 'Both formats reach about the same audience';
    }

    return (
        <section className="rounded-2xl border border-line bg-surface p-5">
            <div className="mb-4 flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-bold text-fg">
                    {filter === 'reel' ? 'Reel performance' : 'Posts vs Reels'}
                </h2>
                {verdict ? (
                    <span className="rounded-full bg-indigo-500/10 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
                        {verdict}
                    </span>
                ) : null}
            </div>
            <div className={`grid gap-3 ${filter === 'all' ? 'sm:grid-cols-2' : ''}`}>
                {filter === 'all' ? (
                    <FormatCard label="Image posts" dot="bg-sky-500" summary={image} maxReach={maxReach} reel={false} />
                ) : null}
                <FormatCard label="Reels" dot="bg-fuchsia-500" summary={reel} maxReach={maxReach} reel />
            </div>
        </section>
    );
}
