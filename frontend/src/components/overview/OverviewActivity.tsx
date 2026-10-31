'use client';

import React from 'react';
import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ShareStoryButton } from '@/components/ShareStory';
import { ChartTooltip } from '@/components/analytics/ChartTooltip';
import { changeBetween, formatCompact, formatCount, formatPercent, shortDate, type Change } from '@/components/analytics/format';
import {
    connectionName,
    formatElapsed,
    postThumbnailUrl,
    type AnalyticsOverview,
    type OverviewReport,
    type Post,
} from '@/lib/types';
import { DeliveryChips, Section, Thumb, linkClass } from './parts';

function ChangeLine({ change }: { change: Change | null }) {
    if (!change) return <span className="text-subtle">No posts last week</span>;
    const color =
        change.direction === 'up'
            ? 'text-[color:var(--viz-up)]'
            : change.direction === 'down'
              ? 'text-[color:var(--viz-down)]'
              : 'text-subtle';
    return (
        <span>
            <span className={`font-bold ${color}`}>
                <span aria-hidden="true">{change.direction === 'up' ? '▲' : change.direction === 'down' ? '▼' : '•'}</span>{' '}
                {change.label}
            </span>{' '}
            <span className="text-subtle">vs last week</span>
        </span>
    );
}

function Tile({
    label,
    value,
    detail,
    tone = 'default',
}: {
    label: string;
    value: string;
    detail: React.ReactNode;
    tone?: 'default' | 'bad';
}) {
    return (
        <div
            className={`rounded-2xl border p-4 shadow-card ${
                tone === 'bad' ? 'border-rose-500/25 bg-rose-500/5' : 'border-line bg-surface'
            }`}
        >
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-subtle">{label}</div>
            <div className={`mt-1.5 text-2xl font-bold tabular-nums ${tone === 'bad' ? 'text-rose-700 dark:text-rose-300' : 'text-fg'}`}>
                {value}
            </div>
            <div className="mt-1 text-[11px] text-muted">{detail}</div>
        </div>
    );
}

/** The week in four numbers, each counted from the database. */
export function WeekTiles({ report }: { report: OverviewReport }) {
    const { week, previousWeek, counts, pages } = report;
    const scheduledPages = pages.filter((page) => page.state === 'active' && page.queued > 0).length;
    return (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
                label="Queued"
                value={formatCount(counts.queued)}
                detail={
                    counts.queued === 0
                        ? 'Add posts to keep the schedule going'
                        : scheduledPages === 0
                          ? 'No Page is posting them right now'
                          : `On ${scheduledPages} posting Page${scheduledPages === 1 ? '' : 's'}${counts.drafts ? ` · ${counts.drafts} drafts` : ''}`
                }
            />
            <Tile
                label="Published · 7 days"
                value={formatCount(week.published)}
                detail={<ChangeLine change={changeBetween(week.published, previousWeek.published)} />}
            />
            <Tile
                label="Stories · 7 days"
                value={formatCount(week.stories)}
                detail={<ChangeLine change={changeBetween(week.stories, previousWeek.stories)} />}
            />
            <Tile
                label="Failed · 7 days"
                value={formatCount(week.failed)}
                tone={week.failed > 0 ? 'bad' : 'default'}
                detail={
                    week.failed > 0 ? (
                        <Link href="/activity?filter=failed" className="font-semibold text-rose-700 underline-offset-2 hover:underline dark:text-rose-300">
                            See what failed →
                        </Link>
                    ) : (
                        'Every post reached its platforms'
                    )
                }
            />
        </div>
    );
}

const SERIES = [
    { key: 'facebook', label: 'Facebook posts', color: 'var(--viz-facebook)' },
    { key: 'instagram', label: 'Instagram posts', color: 'var(--viz-instagram)' },
    { key: 'stories', label: 'Stories', color: 'var(--viz-story)' },
] as const;

/** What went out each day for two weeks, stacked by where it went. */
export function PublishingChart({ report }: { report: OverviewReport }) {
    const data = report.days.map((day) => ({ ...day, label: shortDate(day.date) }));
    const total = data.reduce((sum, day) => sum + day.facebook + day.instagram + day.stories, 0);
    const native = report.week.native.facebook + report.week.native.instagram;

    return (
        <Section
            title="Publishing, last 14 days"
            description="Every post and Story Meta-Bru delivered, by day and platform."
            action={
                <Link href="/activity" className={linkClass}>
                    Activity →
                </Link>
            }
        >
            {total === 0 ? (
                <p className="rounded-xl border border-dashed border-line-strong px-4 py-10 text-center text-xs text-subtle">
                    Nothing was published in the last 14 days.
                </p>
            ) : (
                <div className="h-52" role="img" aria-label={`Bar chart of posts published per day over the last 14 days, ${total} in all`}>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
                            <CartesianGrid vertical={false} stroke="var(--line)" />
                            <XAxis
                                dataKey="label"
                                tickLine={false}
                                axisLine={{ stroke: 'var(--line-strong)' }}
                                tick={{ fill: 'var(--subtle)', fontSize: 11 }}
                                minTickGap={12}
                            />
                            <YAxis
                                allowDecimals={false}
                                tickLine={false}
                                axisLine={false}
                                tick={{ fill: 'var(--subtle)', fontSize: 11 }}
                                width={28}
                            />
                            <Tooltip
                                cursor={{ fill: 'var(--hover)' }}
                                content={({ active, payload }) => {
                                    const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
                                    if (!active || !row) return null;
                                    return (
                                        <ChartTooltip
                                            title={row.label}
                                            rows={[
                                                ...SERIES.map((series) => ({
                                                    label: series.label,
                                                    value: formatCount(row[series.key]),
                                                    color: series.color,
                                                })),
                                                ...(row.failed > 0 ? [{ label: 'failed', value: formatCount(row.failed), strong: true }] : []),
                                            ]}
                                        />
                                    );
                                }}
                            />
                            {SERIES.map((series, index) => (
                                <Bar
                                    key={series.key}
                                    dataKey={series.key}
                                    name={series.label}
                                    stackId="day"
                                    fill={series.color}
                                    stroke="var(--surface)"
                                    strokeWidth={1}
                                    maxBarSize={28}
                                    radius={index === SERIES.length - 1 ? [4, 4, 0, 0] : 0}
                                    isAnimationActive={false}
                                />
                            ))}
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-muted">
                {SERIES.map((series) => (
                    <li key={series.key} className="inline-flex items-center gap-1.5">
                        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: series.color }} />
                        {series.label}
                        <span className="font-bold tabular-nums text-fg">{formatCount(report.week[series.key])}</span>
                        <span className="text-subtle">this week</span>
                    </li>
                ))}
            </ul>
            {native > 0 ? (
                <p className="mt-2 text-[11px] text-subtle">
                    You also posted {native} time{native === 1 ? '' : 's'} directly on Facebook or Instagram this week (
                    {report.week.native.facebook} Facebook, {report.week.native.instagram} Instagram). Analytics counts them too.
                </p>
            ) : null}
        </Section>
    );
}

/** Reach and engagement for the last 7 days, from the Analytics insights. */
export function ResultsStrip({ analytics, now }: { analytics: AnalyticsOverview | null; now: number }) {
    if (!analytics) return null;
    const { totals, previous, sync } = analytics;
    const before = previous?.totals;
    const items = [
        { label: 'Reach', value: formatCompact(totals.reach), change: changeBetween(totals.reach, before?.reach) },
        { label: 'Views', value: formatCompact(totals.views), change: changeBetween(totals.views, before?.views) },
        {
            label: 'Interactions',
            value: formatCompact(totals.interactions),
            change: changeBetween(totals.interactions, before?.interactions),
        },
        {
            label: 'Engagement rate',
            value: formatPercent(totals.engagementRate),
            change: changeBetween(totals.engagementRate, before?.engagementRate, 'rate'),
        },
    ];
    return (
        <Section
            title="Results, last 7 days"
            description={
                <>
                    All posts on your Pages, including ones posted directly.{' '}
                    {sync.lastSyncedAt ? `Insights updated ${formatElapsed(sync.lastSyncedAt, now).toLowerCase()}.` : 'Insights not loaded yet.'}
                </>
            }
            action={
                <Link href="/analytics" className={linkClass}>
                    Open Analytics →
                </Link>
            }
        >
            {!sync.lastSyncedAt ? (
                <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-xs text-subtle">
                    No insights yet. Open Analytics and press Refresh insights to load reach and engagement.
                </p>
            ) : (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {items.map((item) => (
                    <div key={item.label} className="rounded-xl bg-surface-2 px-3 py-2.5">
                        <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-subtle">{item.label}</dt>
                        <dd className="mt-1 text-lg font-bold tabular-nums text-fg">{item.value}</dd>
                        <dd className="text-[11px]">
                            {item.change ? <ChangeLine change={item.change} /> : <span className="text-subtle">No earlier data</span>}
                        </dd>
                    </div>
                ))}
            </dl>
            )}
        </Section>
    );
}

function postTime(post: Post): string {
    return post.publishedAt || post.updatedAt;
}

/** The latest posts that went out or failed, with where each one landed. */
export function RecentActivity({
    posts,
    now,
    onShareStory,
    sharingId,
}: {
    posts: Post[];
    now: number;
    onShareStory: (post: Post) => void;
    sharingId: string;
}) {
    return (
        <Section
            title="Recent activity"
            description="The latest posts Meta-Bru sent, and where each one landed."
            action={
                <Link href="/activity" className={linkClass}>
                    All activity →
                </Link>
            }
        >
            {posts.length === 0 ? (
                <p className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-xs text-subtle">
                    Nothing has been published yet. Queued posts appear here once they go out.
                </p>
            ) : (
                <ul className="divide-y divide-line">
                    {posts.map((post) => (
                        <li key={post._id} className="flex items-center gap-3 py-3">
                            <Thumb src={postThumbnailUrl(post)} />
                            <div className="min-w-0 flex-1">
                                <p className="line-clamp-1 text-sm font-semibold text-fg">{post.caption || 'Untitled post'}</p>
                                <p className="mt-0.5 text-[11px] text-subtle">
                                    {connectionName(post)} · {formatElapsed(postTime(post), now) || new Date(postTime(post)).toLocaleString()}
                                </p>
                                <div className="mt-1.5">
                                    {post.status === 'publishing' ? (
                                        <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">Publishing now…</span>
                                    ) : (
                                        <DeliveryChips targets={post.targets} storyTargets={post.storyTargets} />
                                    )}
                                </div>
                            </div>
                            <ShareStoryButton
                                post={post}
                                onOpen={() => onShareStory(post)}
                                sharing={sharingId === post._id}
                                size="sm"
                            />
                        </li>
                    ))}
                </ul>
            )}
        </Section>
    );
}
