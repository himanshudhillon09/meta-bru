'use client';

import React from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts';
import { ChartTooltip } from './ChartTooltip';
import { formatCompact, shortDate, type Change } from './format';

export interface KpiTileProps {
    label: string;
    value: string;
    /** What the value means, e.g. "people who saw a post". */
    hint?: string;
    change?: Change | null;
    /** "previous 30 days". */
    changeLabel?: string;
    /** One point per day or week, oldest first. */
    trend?: Array<{ date: string; value: number }>;
    trendUnit?: string;
}

function ChangeBadge({ change, against }: { change: Change; against?: string | undefined }) {
    const color =
        change.direction === 'up'
            ? 'text-[color:var(--viz-up)]'
            : change.direction === 'down'
              ? 'text-[color:var(--viz-down)]'
              : 'text-subtle';
    const arrow = change.direction === 'up' ? '▲' : change.direction === 'down' ? '▼' : '•';
    return (
        <div className="flex flex-wrap items-baseline gap-x-1.5 text-[11px]">
            <span className={`font-bold ${color}`}>
                <span aria-hidden="true">{arrow}</span> {change.label}
            </span>
            {against ? <span className="text-subtle">vs {against}</span> : null}
        </div>
    );
}

function Sparkline({ data, unit }: { data: Array<{ date: string; value: number }>; unit: string }) {
    const id = React.useId().replace(/:/g, '');
    return (
        <div className="mt-3 h-10" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                    <defs>
                        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--viz-1)" stopOpacity={0.18} />
                            <stop offset="100%" stopColor="var(--viz-1)" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <Tooltip
                        cursor={{ stroke: 'var(--line-strong)', strokeWidth: 1 }}
                        content={({ active, payload }) => {
                            const row = payload?.[0]?.payload as { date: string; value: number } | undefined;
                            if (!active || !row) return null;
                            return (
                                <ChartTooltip
                                    title={shortDate(row.date)}
                                    rows={[{ label: unit, value: formatCompact(row.value), strong: true }]}
                                />
                            );
                        }}
                    />
                    <Area
                        type="monotone"
                        dataKey="value"
                        stroke="var(--viz-1)"
                        strokeWidth={2}
                        fill={`url(#spark-${id})`}
                        dot={false}
                        activeDot={{ r: 3, stroke: 'var(--surface)', strokeWidth: 2, fill: 'var(--viz-1)' }}
                        isAnimationActive={false}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}

/** A headline number with how it moved and a small trend line. */
export function KpiTile({ label, value, hint, change, changeLabel, trend, trendUnit = '' }: KpiTileProps) {
    const hasTrend = Boolean(trend && trend.some((point) => point.value > 0));
    return (
        <div className="flex flex-col rounded-2xl border border-line bg-surface p-4 shadow-card">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-subtle">{label}</div>
            <div className="mt-1.5 text-2xl font-bold text-fg">{value}</div>
            <div className="mt-1 min-h-[16px]">
                {change ? (
                    <ChangeBadge change={change} against={changeLabel} />
                ) : hint ? (
                    <span className="text-[11px] text-subtle">{hint}</span>
                ) : null}
            </div>
            {hasTrend && trend ? <Sparkline data={trend} unit={trendUnit} /> : null}
        </div>
    );
}
