'use client';

import React, { useState } from 'react';
import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Tabs } from '@/components/Tabs';
import type { AnalyticsPageSummary, AnalyticsSummary, SocialConnection } from '@/lib/types';
import { ChartTooltip } from './ChartTooltip';
import { formatCompact, formatCount, formatPercent } from './format';

const METRICS = [
    { key: 'reach', label: 'Reach' },
    { key: 'interactions', label: 'Interactions' },
    { key: 'engagementRate', label: 'Engagement' },
    { key: 'posts', label: 'Posts' },
] as const;

type MetricKey = (typeof METRICS)[number]['key'];

const EMPTY: AnalyticsSummary = {
    posts: 0,
    facebookPosts: 0,
    instagramPosts: 0,
    reach: 0,
    views: 0,
    interactions: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    clicks: 0,
    engagementRate: null,
};

function metricValue(totals: AnalyticsSummary, key: MetricKey): number {
    return key === 'engagementRate' ? (totals.engagementRate ?? 0) : totals[key];
}

function formatMetric(totals: AnalyticsSummary, key: MetricKey): string {
    return key === 'engagementRate' ? formatPercent(totals.engagementRate) : formatCompact(totals[key]);
}

/**
 * Every Page side by side, so the strongest and weakest stand out. Pages
 * with nothing published in the range still appear, at zero.
 */
export function PageBreakdown({
    byPage,
    connections,
    onSelectPage,
}: {
    byPage: AnalyticsPageSummary[];
    connections: SocialConnection[];
    onSelectPage: (connectionId: string) => void;
}) {
    const [metric, setMetric] = useState<MetricKey>('reach');
    const rows = [
        ...byPage,
        ...connections
            .filter((connection) => !byPage.some((page) => page.connectionId === connection._id))
            .map((connection) => ({
                connectionId: connection._id,
                pageName: connection.pageName,
                instagramUsername: connection.instagram?.username || '',
                totals: EMPTY,
            })),
    ];
    const sorted = [...rows].sort((a, b) => metricValue(b.totals, metric) - metricValue(a.totals, metric));
    const chartData = sorted.map((row) => ({
        id: row.connectionId,
        name: row.pageName,
        value: metricValue(row.totals, metric),
        label: formatMetric(row.totals, metric),
        totals: row.totals,
    }));
    const totalReach = rows.reduce((sum, row) => sum + row.totals.reach, 0);
    const leader = [...rows].sort((a, b) => b.totals.reach - a.totals.reach)[0];
    const leaderShare = leader && totalReach > 0 ? Math.round((leader.totals.reach / totalReach) * 100) : 0;
    const idle = rows.filter((row) => row.totals.posts === 0);

    return (
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="text-sm font-bold text-fg">Pages compared</h2>
                    <p className="mt-0.5 text-xs text-muted">
                        {leader && leaderShare > 0
                            ? `${leader.pageName} brings ${leaderShare}% of your reach.`
                            : 'How each Page performed in this range.'}
                        {idle.length > 0
                            ? ` ${idle.length === 1 ? `${idle[0]!.pageName} posted` : `${idle.length} Pages posted`} nothing in this range.`
                            : ''}
                    </p>
                </div>
                <Tabs label="Compare Pages by" variant="segmented" items={METRICS} value={metric} onChange={setMetric} />
            </div>

            <div className="mt-4" style={{ height: Math.max(80, chartData.length * 40 + 8) }}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }} barCategoryGap={10}>
                        <XAxis type="number" hide domain={[0, 'dataMax']} />
                        <YAxis
                            type="category"
                            dataKey="name"
                            width={130}
                            tickLine={false}
                            axisLine={{ stroke: 'var(--line-strong)' }}
                            tick={{ fill: 'var(--fg-2)', fontSize: 12 }}
                        />
                        <Tooltip
                            cursor={{ fill: 'var(--hover)' }}
                            content={({ active, payload }) => {
                                const row = payload?.[0]?.payload as (typeof chartData)[number] | undefined;
                                if (!active || !row) return null;
                                return (
                                    <ChartTooltip
                                        title={row.name}
                                        rows={[
                                            { label: 'reach', value: formatCount(row.totals.reach), strong: metric === 'reach' },
                                            { label: 'interactions', value: formatCount(row.totals.interactions), strong: metric === 'interactions' },
                                            { label: 'engagement', value: formatPercent(row.totals.engagementRate), strong: metric === 'engagementRate' },
                                            { label: row.totals.posts === 1 ? 'post' : 'posts', value: formatCount(row.totals.posts), strong: metric === 'posts' },
                                        ]}
                                    />
                                );
                            }}
                        />
                        <Bar
                            dataKey="value"
                            fill="var(--viz-1)"
                            radius={[0, 4, 4, 0]}
                            maxBarSize={22}
                            cursor="pointer"
                            onClick={(entry: { payload?: { id?: string } }) => {
                                if (entry?.payload?.id) onSelectPage(entry.payload.id);
                            }}
                        >
                            <LabelList dataKey="label" position="right" fill="var(--fg-2)" fontSize={12} />
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>

            <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-xs">
                    <thead className="text-[10px] uppercase tracking-widest text-subtle">
                        <tr>
                            <th className="py-2 font-bold">Page</th>
                            <th className="py-2 text-right font-bold">Posts</th>
                            <th className="py-2 text-right font-bold">Reach</th>
                            <th className="py-2 text-right font-bold">Interactions</th>
                            <th className="py-2 text-right font-bold">Engagement</th>
                            <th className="py-2" />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-line tabular-nums">
                        {sorted.map((row) => (
                            <tr key={row.connectionId}>
                                <td className="py-2.5">
                                    <div className="font-semibold text-fg">{row.pageName}</div>
                                    {row.instagramUsername ? (
                                        <div className="text-[11px] text-subtle">@{row.instagramUsername}</div>
                                    ) : null}
                                </td>
                                <td className="py-2.5 text-right text-fg-2">{formatCount(row.totals.posts)}</td>
                                <td className="py-2.5 text-right text-fg-2">{formatCount(row.totals.reach)}</td>
                                <td className="py-2.5 text-right text-fg-2">{formatCount(row.totals.interactions)}</td>
                                <td className="py-2.5 text-right font-semibold text-fg">
                                    {formatPercent(row.totals.engagementRate)}
                                </td>
                                <td className="py-2.5 text-right">
                                    <button
                                        type="button"
                                        onClick={() => onSelectPage(row.connectionId)}
                                        className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-indigo-700 hover:bg-indigo-500/10 dark:text-indigo-300"
                                    >
                                        Focus →
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
