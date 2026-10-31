'use client';

import React from 'react';

export interface TooltipRow {
    label: string;
    value: string;
    /** CSS colour of the short line key; omit for plain rows. */
    color?: string;
    /** Bold row: the metric the chart is plotting. */
    strong?: boolean;
}

/** The readout every chart shares: a title, then value-first rows. */
export function ChartTooltip({ title, rows }: { title: string; rows: TooltipRow[] }) {
    return (
        <div className="min-w-[150px] rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-card-hover">
            <div className="mb-1.5 font-semibold text-muted">{title}</div>
            <div className="space-y-1">
                {rows.map((row) => (
                    <div key={row.label} className="flex items-center gap-2">
                        {row.color ? (
                            <span
                                aria-hidden="true"
                                className="h-0.5 w-3 shrink-0 rounded-full"
                                style={{ background: row.color }}
                            />
                        ) : null}
                        <span className={`tabular-nums ${row.strong ? 'font-bold text-fg' : 'font-semibold text-fg-2'}`}>
                            {row.value}
                        </span>
                        <span className="text-subtle">{row.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
