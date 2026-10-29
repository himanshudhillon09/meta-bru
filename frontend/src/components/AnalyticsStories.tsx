'use client';

import React from 'react';
import Link from 'next/link';
import { MetricCard } from '@/components/AnalyticsCharts';
import {
    formatElapsed,
    formatIstDateTime,
    type StoryAnalyticsResponse,
    type StoryRow,
    type StorySummary,
} from '@/lib/types';

function formatNumber(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : value.toLocaleString('en-IN');
}

function hoursLeft(expiresAt: string, now: number): string {
    const ms = new Date(expiresAt).getTime() - now;
    if (ms <= 0) return 'expired';
    const hours = Math.floor(ms / 3_600_000);
    return hours >= 1 ? `${hours}h left` : `${Math.max(1, Math.round(ms / 60_000))}m left`;
}

const NAVIGATION = [
    { key: 'tapsForward', label: 'Tapped forward', tone: 'bg-indigo-500' },
    { key: 'swipesForward', label: 'Swiped to next account', tone: 'bg-sky-500' },
    { key: 'tapsBack', label: 'Tapped back', tone: 'bg-emerald-500' },
    { key: 'exits', label: 'Exited', tone: 'bg-rose-500' },
] as const;

/** How people moved through your Stories, as one stacked bar. */
function NavigationBar({ summary }: { summary: StorySummary }) {
    const total = NAVIGATION.reduce((sum, item) => sum + summary[item.key], 0);
    if (total === 0) return null;
    return (
        <section className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-sm font-bold text-fg">What viewers did next</h2>
            <p className="mt-1 text-xs text-subtle">
                Instagram Stories only. Back taps mean people re-watched; exits mean they left.
            </p>
            <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-sunken">
                {NAVIGATION.map((item) =>
                    summary[item.key] > 0 ? (
                        <div
                            key={item.key}
                            className={`${item.tone} h-full transition-[width] duration-700 ease-out`}
                            style={{ width: `${(summary[item.key] / total) * 100}%` }}
                            title={`${item.label}: ${summary[item.key]}`}
                        />
                    ) : null
                )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                {NAVIGATION.map((item) => (
                    <div key={item.key} className="flex items-center gap-2">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${item.tone}`} />
                        <span className="text-subtle">{item.label}</span>
                        <span className="ml-auto font-bold text-fg">
                            {Math.round((summary[item.key] / total) * 100)}%
                        </span>
                    </div>
                ))}
            </div>
        </section>
    );
}

function StoryCard({ story, now }: { story: StoryRow; now: number }) {
    const metrics = story.metrics;
    const statusNote =
        story.status === 'waiting'
            ? 'Waiting for the first insights sync. Use Refresh insights to read it now.'
            : story.status === 'permission_error'
              ? 'Meta is blocking Story insights for this Page.'
              : !metrics
                ? story.error || 'Meta has not reported numbers for this Story.'
                : '';

    return (
        <article className="flex gap-4 rounded-2xl border border-line bg-surface p-4 shadow-card transition-[border-color,box-shadow] duration-200 hover:border-line-strong hover:shadow-card-hover">
            <div className="relative aspect-[9/16] w-16 shrink-0 overflow-hidden rounded-xl border border-line bg-sunken sm:w-20">
                {story.mediaUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={story.mediaUrl} alt="" className="h-full w-full object-cover" />
                ) : null}
                {story.live ? (
                    <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-fuchsia-500 via-rose-500 to-amber-400" />
                ) : null}
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-700 dark:text-indigo-300">
                        {story.platform} Story
                    </span>
                    {story.live ? (
                        <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:text-rose-300">
                            ● Live · {hoursLeft(story.expiresAt, now)}
                        </span>
                    ) : (
                        <span className="rounded-full bg-sunken px-2 py-0.5 text-[10px] font-bold text-subtle">
                            Expired
                        </span>
                    )}
                    {story.mediaType === 'reel' ? (
                        <span className="rounded-full border border-fuchsia-500/20 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-fuchsia-700 dark:text-fuchsia-300">
                            Reel
                        </span>
                    ) : null}
                    <span className="text-[11px] text-subtle">
                        {story.pageName ? `${story.pageName} · ` : ''}
                        {formatIstDateTime(story.publishedAt)}
                    </span>
                </div>
                <p className="mt-1 line-clamp-1 text-sm text-fg-2">{story.caption}</p>

                {metrics ? (
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs sm:grid-cols-6">
                        {(
                            [
                                ['Reach', metrics.reach],
                                ['Views', metrics.views],
                                ['Replies', metrics.replies],
                                ['Shares', metrics.shares],
                                ['Back taps', metrics.tapsBack],
                                ['Exits', metrics.exits],
                            ] as const
                        ).map(([label, value]) => (
                            <div key={label}>
                                <span className="text-subtle">{label}</span>
                                <div className="font-bold text-fg">{formatNumber(value)}</div>
                            </div>
                        ))}
                    </div>
                ) : null}

                {statusNote ? (
                    <p className="mt-2 text-[11px] text-subtle">
                        {statusNote}
                        {story.status === 'permission_error' ? (
                            <>
                                {' '}
                                <Link href="/connections?returnTo=/analytics" className="font-bold underline">
                                    Reconnect
                                </Link>
                            </>
                        ) : null}
                    </p>
                ) : story.metricsAt ? (
                    <p className="mt-2 text-[10px] text-faint">
                        Saved {formatElapsed(story.metricsAt, now) || 'recently'}
                        {story.live ? '' : ' · final numbers'}
                    </p>
                ) : null}
            </div>
        </article>
    );
}

/** The Stories view: totals, how viewers navigated, and each Story. */
export function AnalyticsStories({
    data,
    loading,
    now,
}: {
    data: StoryAnalyticsResponse | null;
    loading: boolean;
    now: number;
}) {
    if (loading && !data) {
        return (
            <div className="flex justify-center py-24">
                <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-indigo-500/20 border-t-indigo-500" />
            </div>
        );
    }

    if (!data || data.stories.length === 0) {
        return (
            <div className="animate-fade-up rounded-2xl border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
                <div className="text-lg font-bold text-fg">No Stories shared in this range</div>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted">
                    Share a published post or reel to Stories from Overview, Activity, Queue, or the
                    post list in Analytics. Its numbers show up here.
                </p>
                <Link
                    href="/activity"
                    className="mt-6 inline-flex rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white hover:bg-indigo-500"
                >
                    Open activity
                </Link>
            </div>
        );
    }

    const { summary } = data;
    return (
        <div className="stagger space-y-6">
            <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 px-4 py-3 text-xs text-indigo-800 dark:text-indigo-200">
                Meta only reports Story numbers for 24 hours. Meta-Bru saves them every 30 minutes
                while a Story is live, so they stay here after it expires.
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <MetricCard
                    label="Stories"
                    value={formatNumber(summary.stories)}
                    hint={summary.live > 0 ? `${summary.live} live now` : undefined}
                />
                <MetricCard label="Reach" value={formatNumber(summary.reach)} tone="sky" />
                <MetricCard label="Views" value={formatNumber(summary.views)} tone="sky" />
                <MetricCard label="Replies" value={formatNumber(summary.replies)} tone="emerald" />
                <MetricCard
                    label="Exit rate"
                    value={summary.exitRate === null ? '—' : `${summary.exitRate}%`}
                    hint="Lower is better"
                    tone="amber"
                />
            </div>
            <NavigationBar summary={summary} />
            <div className="space-y-3">
                {data.stories.map((story) => (
                    <StoryCard key={`${story.postId}-${story.platform}`} story={story} now={now} />
                ))}
            </div>
        </div>
    );
}

/** Story totals on the Overview, with a link into the Stories view. */
export function StorySummaryCard({
    summary,
    onOpen,
}: {
    summary: StorySummary;
    onOpen: () => void;
}) {
    return (
        <section className="rounded-2xl border border-line bg-surface p-5">
            <div className="mb-4 flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-bold text-fg">Stories</h2>
                {summary.live > 0 ? (
                    <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:text-rose-300">
                        ● {summary.live} live
                    </span>
                ) : null}
                <button
                    type="button"
                    onClick={onOpen}
                    className="ml-auto text-xs font-bold text-indigo-700 dark:text-indigo-300"
                >
                    Open Stories →
                </button>
            </div>
            {summary.stories === 0 ? (
                <p className="text-xs text-subtle">
                    No Stories shared in this range. Use Share to Story on a published post to add one.
                </p>
            ) : (
                <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-5">
                    {(
                        [
                            ['Shared', formatNumber(summary.stories)],
                            ['Reach', formatNumber(summary.reach)],
                            ['Views', formatNumber(summary.views)],
                            ['Replies', formatNumber(summary.replies)],
                            ['Exit rate', summary.exitRate === null ? '—' : `${summary.exitRate}%`],
                        ] as const
                    ).map(([label, value]) => (
                        <div key={label} className="rounded-xl border border-line bg-surface-2 p-3">
                            <span className="text-subtle">{label}</span>
                            <div className="mt-0.5 text-base font-bold text-fg">{value}</div>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
