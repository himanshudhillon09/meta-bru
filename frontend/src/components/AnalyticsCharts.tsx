'use client';

import React from 'react';
import type { AnalyticsBestTime } from '@/lib/types';

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
        indigo: 'text-indigo-300',
        emerald: 'text-emerald-300',
        amber: 'text-amber-300',
        sky: 'text-sky-300',
    };
    return (
        <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                {label}
            </div>
            <div className={`mt-2 text-2xl font-black ${tones[tone]}`}>
                {value}
            </div>
            {hint ? (
                <div className="mt-1 text-xs text-slate-500">{hint}</div>
            ) : null}
        </div>
    );
}

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
    const max = Math.max(
        1,
        ...data.map((item) => Math.max(item.value, item.secondary || 0))
    );
    const hasSecondary = data.some((item) => item.secondary !== undefined);
    const labelEvery =
        data.length > 45 ? 7 : data.length > 20 ? 3 : 1;

    return (
        <div className="w-full">
            <div
                className="flex items-end gap-1 overflow-x-auto pb-2"
                style={{ height }}
            >
                {data.map((item, index) => (
                    <div
                        key={`${item.label}-${index}`}
                        className="flex min-w-2 flex-1 flex-col items-center justify-end gap-1"
                    >
                        <div className="relative flex h-full w-full items-end justify-center gap-0.5">
                            <div
                                className="w-2 rounded-t bg-indigo-500/80"
                                style={{
                                    height: `${(item.value / max) * 100}%`,
                                }}
                                title={`${item.label}: ${item.value} ${valueLabel}`}
                            />
                            {item.secondary !== undefined ? (
                                <div
                                    className="w-2 rounded-t bg-emerald-500/70"
                                    style={{
                                        height: `${(item.secondary / max) * 100}%`,
                                    }}
                                    title={`${item.label}: ${item.secondary} ${secondaryLabel || ''}`}
                                />
                            ) : null}
                        </div>
                        <span className="h-3 text-[9px] text-slate-600">
                            {index % labelEvery === 0 ? item.label : ''}
                        </span>
                    </div>
                ))}
            </div>
            {hasSecondary ? (
                <div className="mt-1 flex flex-wrap gap-4 text-[10px] text-slate-500">
                    <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-sm bg-indigo-500/80" />
                        {primaryLabel || valueLabel}
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-sm bg-emerald-500/70" />
                        {secondaryLabel || 'secondary'}
                    </span>
                </div>
            ) : null}
        </div>
    );
}

export function AnalyticsLineChart({
    points,
    height = 180,
    color = '#818cf8',
    valueSuffix = '',
}: {
    points: Array<{ label: string; value: number }>;
    height?: number;
    color?: string;
    valueSuffix?: string;
}) {
    if (points.length === 0) {
        return (
            <div className="py-16 text-center text-sm text-slate-500">
                No history yet.
            </div>
        );
    }
    if (points.length === 1) {
        return (
            <div className="py-16 text-center text-sm text-slate-500">
                One data point captured. Keep the monitor open to build
                history.
            </div>
        );
    }
    const width = 600;
    const max = Math.max(1, ...points.map((point) => point.value));
    const step = width / (points.length - 1);
    const path = points
        .map((point, index) => {
            const x = index * step;
            const y = height - (point.value / max) * (height - 20) - 10;
            return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
        })
        .join(' ');
    const lastPoint = points[points.length - 1];

    return (
        <div className="w-full">
            <svg
                viewBox={`0 0 ${width} ${height}`}
                className="w-full"
                style={{ height }}
                role="img"
                aria-label="Engagement over time"
            >
                {[0.25, 0.5, 0.75].map((fraction) => (
                    <line
                        key={fraction}
                        x1="0"
                        x2={width}
                        y1={height * fraction}
                        y2={height * fraction}
                        stroke="rgba(148, 163, 184, 0.12)"
                        strokeWidth="1"
                    />
                ))}
                <path
                    d={path}
                    fill="none"
                    stroke={color}
                    strokeWidth="3"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                />
                <path
                    d={`${path} L ${width} ${height} L 0 ${height} Z`}
                    fill={color}
                    opacity="0.08"
                />
                <circle
                    cx={width}
                    cy={
                        height -
                        (lastPoint.value / max) * (height - 20) -
                        10
                    }
                    r="4"
                    fill={color}
                />
            </svg>
            <div className="mt-1 flex justify-between text-[10px] text-slate-600">
                <span>{points[0]?.label}</span>
                <span>
                    Latest: {lastPoint.value}
                    {valueSuffix}
                </span>
                <span>{lastPoint.label}</span>
            </div>
        </div>
    );
}

export function AnalyticsHeatmap({
    buckets,
}: {
    buckets: AnalyticsBestTime[];
}) {
    const max = Math.max(
        1,
        ...buckets.map((bucket) => bucket.avgEngagementRate || 0)
    );
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return (
        <div className="overflow-x-auto">
            <div className="min-w-[560px]">
                <div className="mb-1 grid grid-cols-[44px_repeat(8,1fr)] gap-1">
                    <div />
                    {['00', '03', '06', '09', '12', '15', '18', '21'].map(
                        (hour) => (
                            <div
                                key={hour}
                                className="text-center text-[9px] text-slate-600"
                            >
                                {hour}
                            </div>
                        )
                    )}
                </div>
                {days.map((day, dayIndex) => (
                    <div
                        key={day}
                        className="mb-1 grid grid-cols-[44px_repeat(8,1fr)] gap-1"
                    >
                        <div className="text-[10px] font-bold text-slate-500">
                            {day}
                        </div>
                        {Array.from({ length: 8 }, (_, block) => {
                            const bucket = buckets.find(
                                (item) =>
                                    item.day === dayIndex + 1 &&
                                    item.block === block
                            );
                            const rate = bucket?.avgEngagementRate;
                            const opacity = rate
                                ? 0.15 + (rate / max) * 0.75
                                : 0.04;
                            return (
                                <div
                                    key={block}
                                    title={
                                        bucket
                                            ? `${day} ${bucket.label}: ${bucket.posts} posts${rate ? `, ${rate}% avg` : ''}`
                                            : ''
                                    }
                                    className="h-7 rounded-md border border-white/5"
                                    style={{
                                        backgroundColor: `rgba(129, 140, 248, ${opacity})`,
                                    }}
                                />
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );
}
