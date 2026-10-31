'use client';

import React, { useState } from 'react';
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { Tabs } from '@/components/Tabs';
import type { AnalyticsActivityBucket } from '@/lib/types';
import { ChartTooltip } from './ChartTooltip';
import { formatCompact, formatCount } from './format';

const METRICS = [
    { key: 'reach', label: 'Reach', unit: 'reach' },
    { key: 'views', label: 'Views', unit: 'views' },
    { key: 'interactions', label: 'Interactions', unit: 'interactions' },
    { key: 'posts', label: 'Posts', unit: 'posts published' },
] as const;

type MetricKey = (typeof METRICS)[number]['key'];

function valueOf(bucket: AnalyticsActivityBucket, key: MetricKey): number {
    return key === 'views' ? (bucket.views ?? 0) : bucket[key];
}

/**
 * One metric over time, by the day (or week) posts were published. One axis:
 * switching metric redraws the chart instead of stacking scales.
 */
export function TrendChart({ activity, weekly }: { activity: AnalyticsActivityBucket[]; weekly: boolean }) {
    const [metric, setMetric] = useState<MetricKey>('reach');
    const selected = METRICS.find((item) => item.key === metric) ?? METRICS[0];
    const data = activity.map((bucket) => ({ ...bucket, value: valueOf(bucket, metric) }));
    const total = data.reduce((sum, row) => sum + row.value, 0);
    const best = data.reduce<(typeof data)[number] | null>(
        (top, row) => (row.value > (top?.value ?? 0) ? row : top),
        null
    );
    const hasViews = activity.some((bucket) => bucket.views !== undefined);
    const items = METRICS.filter((item) => item.key !== 'views' || hasViews);

    return (
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="text-sm font-bold text-fg">Performance over time</h2>
                    <p className="mt-0.5 text-xs text-muted">
                        {formatCount(total)} {selected.unit} from posts published in this range
                        {best && best.value > 0
                            ? ` · best ${weekly ? 'week' : 'day'}: ${best.label} (${formatCompact(best.value)})`
                            : ''}
                    </p>
                </div>
                <Tabs label="Chart metric" variant="segmented" items={items} value={metric} onChange={setMetric} />
            </div>

            <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                        <defs>
                            <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="var(--viz-1)" stopOpacity={0.16} />
                                <stop offset="100%" stopColor="var(--viz-1)" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} stroke="var(--line)" />
                        <XAxis
                            dataKey="label"
                            tickLine={false}
                            axisLine={{ stroke: 'var(--line-strong)' }}
                            tick={{ fill: 'var(--subtle)', fontSize: 11 }}
                            minTickGap={18}
                        />
                        <YAxis
                            allowDecimals={false}
                            tickFormatter={(value: number) => formatCompact(value)}
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: 'var(--subtle)', fontSize: 11 }}
                            width={44}
                        />
                        <Tooltip
                            cursor={{ stroke: 'var(--line-strong)', strokeWidth: 1 }}
                            content={({ active, payload }) => {
                                const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
                                if (!active || !row) return null;
                                return (
                                    <ChartTooltip
                                        title={weekly ? `Week of ${row.label}` : row.label}
                                        rows={[
                                            {
                                                label: 'reach',
                                                value: formatCount(row.reach),
                                                strong: metric === 'reach',
                                                ...(metric === 'reach' ? { color: 'var(--viz-1)' } : {}),
                                            },
                                            ...(hasViews
                                                ? [
                                                      {
                                                          label: 'views',
                                                          value: formatCount(row.views ?? 0),
                                                          strong: metric === 'views',
                                                          ...(metric === 'views' ? { color: 'var(--viz-1)' } : {}),
                                                      },
                                                  ]
                                                : []),
                                            {
                                                label: 'interactions',
                                                value: formatCount(row.interactions),
                                                strong: metric === 'interactions',
                                                ...(metric === 'interactions' ? { color: 'var(--viz-1)' } : {}),
                                            },
                                            {
                                                label: row.posts === 1 ? 'post' : 'posts',
                                                value: formatCount(row.posts),
                                                strong: metric === 'posts',
                                                ...(metric === 'posts' ? { color: 'var(--viz-1)' } : {}),
                                            },
                                        ]}
                                    />
                                );
                            }}
                        />
                        <Area
                            type="monotone"
                            dataKey="value"
                            name={selected.label}
                            stroke="var(--viz-1)"
                            strokeWidth={2}
                            fill="url(#trend-fill)"
                            dot={false}
                            activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2, fill: 'var(--viz-1)' }}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </section>
    );
}
