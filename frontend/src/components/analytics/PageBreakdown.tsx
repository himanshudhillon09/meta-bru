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

interface Row {
    connectionId: string;
    pageName: string;
    instagramUsername: string;
    hasInstagram: boolean;
    totals: AnalyticsSummary;
    facebook: AnalyticsSummary;
    instagram: AnalyticsSummary;
}

function PlatformCells({ summary, muted }: { summary: AnalyticsSummary; muted: string | null }) {
    if (muted) {
        return (
            <td colSpan={3} className="border-l border-line px-3 py-2.5 text-center text-[11px] text-subtle">
                {muted}
            </td>
        );
    }
    return (
        <>
            <td className="border-l border-line px-3 py-2.5 text-right text-fg-2">{formatCount(summary.posts)}</td>
            <td className="px-3 py-2.5 text-right text-fg-2">{formatCount(summary.reach)}</td>
            <td className="px-3 py-2.5 text-right font-semibold text-fg">{formatPercent(summary.engagementRate)}</td>
        </>
    );
}

/**
 * Every Page side by side, split into Facebook and Instagram, so it is clear
 * which Page does well where. Pages with nothing in the range still appear.
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
    const rows: Row[] = connections.map((connection) => {
        const page = byPage.find((item) => item.connectionId === connection._id);
        return {
            connectionId: connection._id,
            pageName: connection.pageName,
            instagramUsername: connection.instagram?.username || page?.instagramUsername || '',
            hasInstagram: Boolean(connection.instagram),
            totals: page?.totals ?? EMPTY,
            facebook: page?.facebook ?? EMPTY,
            instagram: page?.instagram ?? EMPTY,
        };
    });
    // Pages that are no longer connected but still have posts in the range.
    for (const page of byPage) {
        if (rows.some((row) => row.connectionId === page.connectionId)) continue;
        rows.push({
            connectionId: page.connectionId,
            pageName: page.pageName,
            instagramUsername: page.instagramUsername,
            hasInstagram: Boolean(page.instagramUsername),
            totals: page.totals,
            facebook: page.facebook ?? EMPTY,
            instagram: page.instagram ?? EMPTY,
        });
    }

    const sorted = [...rows].sort((a, b) => metricValue(b.totals, metric) - metricValue(a.totals, metric));
    const chartData = sorted.map((row) => ({
        id: row.connectionId,
        name: row.pageName,
        facebook: metricValue(row.facebook, metric),
        instagram: row.hasInstagram ? metricValue(row.instagram, metric) : 0,
        facebookLabel: row.facebook.posts > 0 ? formatMetric(row.facebook, metric) : '',
        instagramLabel: row.hasInstagram && row.instagram.posts > 0 ? formatMetric(row.instagram, metric) : '',
        row,
    }));
    const totalReach = rows.reduce((sum, row) => sum + row.totals.reach, 0);
    const leader = [...rows].sort((a, b) => b.totals.reach - a.totals.reach)[0];
    const leaderShare = leader && totalReach > 0 ? Math.round((leader.totals.reach / totalReach) * 100) : 0;
    const idle = rows.filter((row) => row.totals.posts === 0);
    const unusedInstagram = rows.filter((row) => row.hasInstagram && row.instagram.posts === 0 && row.facebook.posts > 0);

    return (
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="text-sm font-bold text-fg">Pages compared, by platform</h2>
                    <p className="mt-0.5 text-xs text-muted">
                        {leader && leaderShare > 0
                            ? `${leader.pageName} brings ${leaderShare}% of your reach.`
                            : 'How each Page did on Facebook and Instagram in this range.'}
                        {idle.length > 0
                            ? ` ${idle.length === 1 ? `${idle[0]!.pageName} posted` : `${idle.length} Pages posted`} nothing.`
                            : ''}
                        {unusedInstagram.length > 0
                            ? ` ${unusedInstagram.map((row) => row.pageName).join(', ')} ${unusedInstagram.length === 1 ? 'has' : 'have'} Instagram linked but posted only to Facebook.`
                            : ''}
                    </p>
                </div>
                <Tabs label="Compare Pages by" variant="segmented" items={METRICS} value={metric} onChange={setMetric} />
            </div>

            <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
                <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-[color:var(--viz-facebook)]" />
                    Facebook
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-[color:var(--viz-instagram)]" />
                    Instagram
                </span>
            </div>

            <div className="mt-2" style={{ height: Math.max(96, chartData.length * 64 + 8) }}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                        data={chartData}
                        layout="vertical"
                        margin={{ top: 0, right: 56, bottom: 0, left: 0 }}
                        barCategoryGap={14}
                        barGap={2}
                    >
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
                                const data = payload?.[0]?.payload as (typeof chartData)[number] | undefined;
                                if (!active || !data) return null;
                                const label = METRICS.find((item) => item.key === metric)?.label.toLowerCase() ?? '';
                                return (
                                    <ChartTooltip
                                        title={data.name}
                                        rows={[
                                            {
                                                label: `Facebook ${label} · ${formatCount(data.row.facebook.posts)} posts`,
                                                value: formatMetric(data.row.facebook, metric),
                                                color: 'var(--viz-facebook)',
                                                strong: true,
                                            },
                                            data.row.hasInstagram
                                                ? {
                                                      label: `Instagram ${label} · ${formatCount(data.row.instagram.posts)} posts`,
                                                      value: formatMetric(data.row.instagram, metric),
                                                      color: 'var(--viz-instagram)',
                                                      strong: true,
                                                  }
                                                : { label: 'No Instagram on this Page', value: '—' },
                                        ]}
                                    />
                                );
                            }}
                        />
                        <Bar
                            dataKey="facebook"
                            fill="var(--viz-facebook)"
                            radius={[0, 4, 4, 0]}
                            maxBarSize={18}
                            cursor="pointer"
                            onClick={(entry: { payload?: { id?: string } }) => {
                                if (entry?.payload?.id) onSelectPage(entry.payload.id);
                            }}
                        >
                            <LabelList dataKey="facebookLabel" position="right" fill="var(--fg-2)" fontSize={11} />
                        </Bar>
                        <Bar
                            dataKey="instagram"
                            fill="var(--viz-instagram)"
                            radius={[0, 4, 4, 0]}
                            maxBarSize={18}
                            cursor="pointer"
                            onClick={(entry: { payload?: { id?: string } }) => {
                                if (entry?.payload?.id) onSelectPage(entry.payload.id);
                            }}
                        >
                            <LabelList dataKey="instagramLabel" position="right" fill="var(--fg-2)" fontSize={11} />
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>

            <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-xs tabular-nums">
                    <thead className="text-[10px] uppercase tracking-widest text-subtle">
                        <tr>
                            <th rowSpan={2} className="py-2 pr-3 align-bottom font-bold">Page</th>
                            <th colSpan={3} className="border-l border-line px-3 pt-2 text-center font-bold">
                                <span className="inline-flex items-center gap-1.5">
                                    <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[color:var(--viz-facebook)]" />
                                    Facebook
                                </span>
                            </th>
                            <th colSpan={3} className="border-l border-line px-3 pt-2 text-center font-bold">
                                <span className="inline-flex items-center gap-1.5">
                                    <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[color:var(--viz-instagram)]" />
                                    Instagram
                                </span>
                            </th>
                            <th rowSpan={2} />
                        </tr>
                        <tr>
                            {['Posts', 'Reach', 'Eng.', 'Posts', 'Reach', 'Eng.'].map((label, index) => (
                                <th
                                    key={index}
                                    className={`px-3 pb-2 text-right font-bold ${index === 0 || index === 3 ? 'border-l border-line' : ''}`}
                                >
                                    {label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                        {sorted.map((row) => (
                            <tr key={row.connectionId}>
                                <td className="py-2.5 pr-3">
                                    <div className="font-semibold text-fg">{row.pageName}</div>
                                    <div className="text-[11px] text-subtle">
                                        {row.totals.posts > 0
                                            ? `${formatCount(row.totals.reach)} reach in total`
                                            : 'Nothing published in this range'}
                                    </div>
                                </td>
                                <PlatformCells summary={row.facebook} muted={null} />
                                <PlatformCells
                                    summary={row.instagram}
                                    muted={
                                        !row.hasInstagram
                                            ? 'No Instagram linked'
                                            : row.instagram.posts === 0
                                              ? `@${row.instagramUsername || 'account'}: no posts`
                                              : null
                                    }
                                />
                                <td className="py-2.5 pl-3 text-right">
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
