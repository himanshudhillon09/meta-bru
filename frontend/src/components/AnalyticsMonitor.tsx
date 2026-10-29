'use client';

import React, { useState } from 'react';
import { AnalyticsLineChart, MetricCard } from './AnalyticsCharts';
import {
    formatElapsed,
    formatIstDateTime,
    type AnalyticsMonitor as AnalyticsMonitorData,
} from '@/lib/types';

function last<T>(values: T[]): T | undefined {
    return values[values.length - 1];
}

function number(value: number | null | undefined): string {
    return value === null || value === undefined
        ? '—'
        : value.toLocaleString('en-IN');
}

function untilLabel(value: string | null | undefined, now: number): string {
    if (!value || now <= 0) return '—';
    const diff = new Date(value).getTime() - now;
    if (!Number.isFinite(diff)) return '—';
    if (diff <= 0) return 'now';
    const minutes = Math.ceil(diff / 60_000);
    return `${minutes}m`;
}

export function AnalyticsMonitor({
    data,
    live,
    onToggleLive,
    onRefresh,
    refreshing,
    now,
}: {
    data: AnalyticsMonitorData;
    live: boolean;
    onToggleLive: () => void;
    onRefresh: () => void;
    refreshing: boolean;
    now: number;
}) {
    const [seriesKey, setSeriesKey] = useState<
        'reach' | 'interactions' | 'engagementRate'
    >('reach');

    const points = data.series.all
        .map((point) => ({
            label: new Intl.DateTimeFormat('en-IN', {
                timeZone: 'Asia/Kolkata',
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23',
            }).format(new Date(point.capturedAt)),
            value:
                seriesKey === 'reach'
                    ? point.reach
                    : seriesKey === 'interactions'
                      ? point.interactions
                      : point.engagementRate,
        }))
        .filter(
            (point): point is { label: string; value: number } =>
                point.value !== null
        );

    const facebook = last(data.series.facebook);
    const instagram = last(data.series.instagram);
    const maxReach = Math.max(
        1,
        facebook?.reach ?? 0,
        instagram?.reach ?? 0
    );

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-4">
                <div>
                    <div className="text-sm font-bold text-fg">
                        {data.scope.pageName}
                    </div>
                    <div className="text-xs text-subtle">
                        {data.sync.lastSyncedAt
                            ? `Last synced ${
                                  formatElapsed(data.sync.lastSyncedAt, now) ||
                                  'recently'
                              }`
                            : 'Not synced yet'}
                        {data.sync.nextSyncAt ? (
                            <span>
                                {' '}
                                · Next sync in{' '}
                                {untilLabel(data.sync.nextSyncAt, now)}
                            </span>
                        ) : null}
                    </div>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <span
                        className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${
                            live
                                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                : 'border-line-strong bg-surface-2 text-muted'
                        }`}
                    >
                        {live ? 'Live' : 'Paused'}
                    </span>
                    <button
                        type="button"
                        onClick={onToggleLive}
                        className="rounded-xl border border-line-strong bg-surface-2 px-4 py-2 text-xs font-bold text-fg-2"
                    >
                        {live ? 'Pause live' : 'Go live'}
                    </button>
                    <button
                        type="button"
                        onClick={onRefresh}
                        disabled={refreshing}
                        className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                    >
                        {refreshing ? 'Refreshing...' : 'Refresh'}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <MetricCard
                    label="Posts"
                    value={number(data.summary.posts)}
                />
                <MetricCard
                    label="Reach"
                    value={number(data.summary.reach)}
                    tone="sky"
                />
                <MetricCard
                    label="Views"
                    value={number(data.summary.views)}
                    tone="sky"
                />
                <MetricCard
                    label="Interactions"
                    value={number(data.summary.interactions)}
                    tone="emerald"
                />
                <MetricCard
                    label="Engagement rate"
                    value={
                        data.summary.engagementRate === null
                            ? '—'
                            : `${data.summary.engagementRate}%`
                    }
                    tone="amber"
                />
            </div>

            <section className="rounded-2xl border border-line bg-surface p-5">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-bold text-fg">
                        Engagement over time
                    </h2>
                    <div className="ml-auto flex gap-1">
                        {(
                            [
                                ['reach', 'Reach'],
                                ['interactions', 'Interactions'],
                                ['engagementRate', 'Rate'],
                            ] as const
                        ).map(([key, label]) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setSeriesKey(key)}
                                className={`rounded-lg px-2.5 py-1.5 text-[10px] font-bold ${
                                    seriesKey === key
                                        ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300'
                                        : 'text-subtle'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
                <AnalyticsLineChart
                    points={points}
                    valueSuffix={seriesKey === 'engagementRate' ? '%' : ''}
                />
                <p className="mt-2 text-[11px] text-subtle">
                    Meta insights can lag up to 48 hours. History builds while
                    Live is on.
                </p>
                {data.seriesTruncated ? (
                    <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                        The chart shows the 100 most recent targets. Summary
                        totals cover the full scope.
                    </p>
                ) : null}
            </section>

            <div className="grid gap-5 lg:grid-cols-2">
                <section className="rounded-2xl border border-line bg-surface p-5">
                    <h2 className="mb-4 text-sm font-bold text-fg">
                        Platform reach
                    </h2>
                    <div className="space-y-4">
                        {[
                            {
                                label: 'Facebook',
                                reach: facebook?.reach ?? null,
                                dot: 'bg-sky-400',
                            },
                            {
                                label: 'Instagram',
                                reach: instagram?.reach ?? null,
                                dot: 'bg-pink-400',
                            },
                        ].map((platform) => (
                            <div key={platform.label}>
                                <div className="mb-1 flex justify-between text-xs">
                                    <span className="flex items-center gap-1.5 text-muted">
                                        <span
                                            className={`h-1.5 w-1.5 rounded-full ${platform.dot}`}
                                        />
                                        {platform.label}
                                    </span>
                                    <span className="font-bold text-fg">
                                        {platform.reach === null
                                            ? '—'
                                            : number(platform.reach)}
                                    </span>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-canvas">
                                    <div
                                        className="h-full rounded-full bg-indigo-500"
                                        style={{
                                            width: `${
                                                platform.reach === null
                                                    ? 0
                                                    : (platform.reach /
                                                          maxReach) *
                                                      100
                                            }%`,
                                        }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="rounded-2xl border border-line bg-surface p-5">
                    <h2 className="mb-4 text-sm font-bold text-fg">
                        Recent posts
                    </h2>
                    <div className="space-y-3">
                        {data.recentPosts.length === 0 ? (
                            <div className="text-sm text-subtle">
                                No published posts in this scope.
                            </div>
                        ) : (
                            data.recentPosts.map((post) => (
                                <div
                                    key={`${post.postId}-${post.platform}`}
                                    className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-2"
                                >
                                    {post.mediaUrl ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={post.mediaUrl}
                                            alt=""
                                            className="h-10 w-10 rounded-lg object-cover"
                                        />
                                    ) : (
                                        <div className="h-10 w-10 rounded-lg bg-sunken" />
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-xs font-bold text-fg">
                                            {post.pageName} · {post.platform}
                                        </div>
                                        <div className="text-[10px] text-subtle">
                                            {formatIstDateTime(
                                                post.publishedAt
                                            )}
                                            {formatElapsed(
                                                post.publishedAt,
                                                now
                                            ) ? (
                                                <>
                                                    {' '}
                                                    ·{' '}
                                                    {formatElapsed(
                                                        post.publishedAt,
                                                        now
                                                    )}
                                                </>
                                            ) : null}
                                        </div>
                                        <div className="text-[10px] text-faint">
                                            Reach{' '}
                                            {number(post.metrics?.reach)} ·
                                            Interactions{' '}
                                            {number(post.metrics?.interactions)}
                                        </div>
                                    </div>
                                    <div className="text-right text-xs font-bold text-emerald-700 dark:text-emerald-300">
                                        {post.metrics?.engagementRate ===
                                            null ||
                                        post.metrics?.engagementRate ===
                                            undefined
                                            ? '—'
                                            : `${post.metrics.engagementRate}%`}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
}
