'use client';

import React from 'react';
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { ChartTooltip } from '@/components/analytics/ChartTooltip';
import { formatCompact, formatCount } from '@/components/analytics/format';

export function MetricCard({
    label,
    value,
    hint,
    tone = 'indigo',
}: {
    label: string;
    value: string;
    hint?: string;
    tone?: 'indigo' | 'emerald' | 'amber' | 'sky';
}) {
    const tones = {
        indigo: 'text-indigo-700 dark:text-indigo-300',
        emerald: 'text-emerald-700 dark:text-emerald-300',
        amber: 'text-amber-700 dark:text-amber-300',
        sky: 'text-sky-700 dark:text-sky-300',
    };
    return (
        <div className="rounded-2xl border border-line bg-surface p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-subtle">
                {label}
            </div>
            <div className={`mt-2 text-2xl font-bold ${tones[tone]}`}>
                {value}
            </div>
            {hint ? (
                <div className="mt-1 text-xs text-subtle">{hint}</div>
            ) : null}
        </div>
    );
}

const AXIS_TICK = { fill: 'var(--subtle)', fontSize: 11 };

/** Columns over time; an optional second series of the same unit sits beside each. */
export function AnalyticsBarChart({
    data,
    height = 180,
    valueLabel = 'posts',
    primaryLabel,
    secondaryLabel,
}: {
    data: Array<{ label: string; value: number; secondary?: number }>;
    height?: number;
    valueLabel?: string;
    primaryLabel?: string;
    secondaryLabel?: string;
}) {
    const hasSecondary = data.some((item) => item.secondary !== undefined);
    const primaryName = primaryLabel || valueLabel;
    const secondaryName = secondaryLabel || 'secondary';

    return (
        <div className="w-full">
            <div style={{ height }}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barGap={2}>
                        <CartesianGrid vertical={false} stroke="var(--line)" />
                        <XAxis
                            dataKey="label"
                            tickLine={false}
                            axisLine={{ stroke: 'var(--line-strong)' }}
                            tick={AXIS_TICK}
                            minTickGap={12}
                        />
                        <YAxis
                            allowDecimals={false}
                            tickFormatter={(value: number) => formatCompact(value)}
                            tickLine={false}
                            axisLine={false}
                            tick={AXIS_TICK}
                            width={36}
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
                                            { label: primaryName, value: formatCount(row.value), color: 'var(--viz-1)', strong: true },
                                            ...(row.secondary !== undefined
                                                ? [{ label: secondaryName, value: formatCount(row.secondary), color: 'var(--viz-reel)' }]
                                                : []),
                                        ]}
                                    />
                                );
                            }}
                        />
                        <Bar dataKey="value" fill="var(--viz-1)" radius={[4, 4, 0, 0]} maxBarSize={20} />
                        {hasSecondary ? (
                            <Bar dataKey="secondary" fill="var(--viz-reel)" radius={[4, 4, 0, 0]} maxBarSize={20} />
                        ) : null}
                    </BarChart>
                </ResponsiveContainer>
            </div>
            {hasSecondary ? (
                <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-subtle">
                    <span className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--viz-1)' }} />
                        {primaryName}
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--viz-reel)' }} />
                        {secondaryName}
                    </span>
                </div>
            ) : null}
        </div>
    );
}

/** One series over time, with a crosshair tooltip. */
export function AnalyticsLineChart({
    points,
    height = 180,
    color = 'var(--viz-1)',
    valueSuffix = '',
}: {
    points: Array<{ label: string; value: number }>;
    height?: number;
    color?: string;
    valueSuffix?: string;
}) {
    const id = React.useId().replace(/:/g, '');
    if (points.length === 0) {
        return (
            <div className="py-16 text-center text-sm text-subtle">
                No history yet.
            </div>
        );
    }
    if (points.length === 1) {
        return (
            <div className="py-16 text-center text-sm text-subtle">
                One data point captured. Keep the monitor open to build
                history.
            </div>
        );
    }
    const latest = points[points.length - 1]!;

    return (
        <div className="w-full">
            <div style={{ height }}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                        <defs>
                            <linearGradient id={`line-${id}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={color} stopOpacity={0.16} />
                                <stop offset="100%" stopColor={color} stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} stroke="var(--line)" />
                        <XAxis
                            dataKey="label"
                            tickLine={false}
                            axisLine={{ stroke: 'var(--line-strong)' }}
                            tick={AXIS_TICK}
                            minTickGap={24}
                        />
                        <YAxis
                            tickFormatter={(value: number) => `${formatCompact(value)}${valueSuffix}`}
                            tickLine={false}
                            axisLine={false}
                            tick={AXIS_TICK}
                            width={44}
                        />
                        <Tooltip
                            cursor={{ stroke: 'var(--line-strong)', strokeWidth: 1 }}
                            content={({ active, payload }) => {
                                const row = payload?.[0]?.payload as { label: string; value: number } | undefined;
                                if (!active || !row) return null;
                                return (
                                    <ChartTooltip
                                        title={row.label}
                                        rows={[{ label: valueSuffix === '%' ? 'rate' : 'total', value: `${formatCount(row.value)}${valueSuffix}`, color, strong: true }]}
                                    />
                                );
                            }}
                        />
                        <Area
                            type="monotone"
                            dataKey="value"
                            stroke={color}
                            strokeWidth={2}
                            fill={`url(#line-${id})`}
                            dot={false}
                            activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2, fill: color }}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
            <div className="mt-1 text-right text-[11px] text-subtle">
                Latest: <span className="font-semibold text-fg-2">{formatCount(latest.value)}{valueSuffix}</span>
            </div>
        </div>
    );
}
