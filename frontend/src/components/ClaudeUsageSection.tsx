'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usageApi } from '@/lib/apiClient';
import {
    formatIstDateTime,
    type ClaudeFeature,
    type ClaudeLimitMeter,
    type ClaudeLimits,
    type ClaudeTotals,
    type ClaudeUsageReport,
} from '@/lib/types';

const FEATURES: Array<{ id: ClaudeFeature; label: string; color: string }> = [
    { id: 'caption', label: 'Captions', color: 'bg-indigo-500' },
    { id: 'image text', label: 'Text on image', color: 'bg-amber-500' },
    { id: 'image prompt', label: 'Image prompts', color: 'bg-emerald-500' },
    { id: 'analytics', label: 'AI analysis', color: 'bg-sky-500' },
];

function formatNumber(value: number): string {
    return value.toLocaleString('en-IN');
}

function compact(value: number): string {
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

/** Dollars with enough decimals that a single caption doesn't read as $0.00. */
function usd(value: number): string {
    if (value <= 0) return '$0.00';
    if (value >= 1) return `$${value.toFixed(2)}`;
    if (value >= 0.01) return `$${value.toFixed(3)}`;
    return `$${value.toFixed(4)}`;
}

function tokens(totals: ClaudeTotals): number {
    return totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
}

function Bar({ percent }: { percent: number }) {
    const value = Math.max(0, Math.min(100, percent));
    const tone = value >= 90 ? 'bg-rose-500' : value >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
    return (
        <div className="h-2 overflow-hidden rounded-full bg-sunken">
            <div
                className={`h-full rounded-full ${tone} transition-[width] duration-700 ease-out`}
                style={{ width: `${value}%` }}
            />
        </div>
    );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-subtle">{label}</div>
            {children}
        </div>
    );
}

function LimitRow({ label, meter, unit }: { label: string; meter: ClaudeLimitMeter; unit: string }) {
    if (meter.limit === null) {
        return (
            <div className="flex justify-between text-xs">
                <span className="text-muted">{label}</span>
                <span className="text-subtle">not reported</span>
            </div>
        );
    }
    const remaining = meter.remaining ?? meter.limit;
    const used = Math.max(0, meter.limit - remaining);
    return (
        <div className="space-y-1.5">
            <div className="flex flex-wrap justify-between gap-x-3 text-xs">
                <span className="text-muted">{label}</span>
                <span className="font-semibold text-fg">
                    {compact(remaining)} of {compact(meter.limit)} {unit}/min left
                </span>
            </div>
            <Bar percent={(used / meter.limit) * 100} />
            {meter.resetsAt && used > 0 ? (
                <div className="text-[11px] text-subtle">
                    Full again by{' '}
                    {new Intl.DateTimeFormat('en-IN', {
                        timeZone: 'Asia/Kolkata',
                        hour: 'numeric',
                        minute: '2-digit',
                        second: '2-digit',
                    }).format(new Date(meter.resetsAt))}{' '}
                    IST
                </div>
            ) : null}
        </div>
    );
}

export function ClaudeUsageSection({
    claude,
    now,
    onLimitsSaved,
    onNotice,
    onError,
}: {
    claude: ClaudeUsageReport;
    /** Current time in ms, 0 until the page has mounted. */
    now: number;
    onLimitsSaved: (limits: ClaudeLimits) => void;
    onNotice: (message: string) => void;
    onError: (message: string) => void;
}) {
    const [budget, setBudget] = useState(claude.limits.monthlyBudgetUsd?.toString() ?? '');
    const [saving, setSaving] = useState(false);

    const saveBudget = async (event: React.FormEvent) => {
        event.preventDefault();
        const value = Number.parseFloat(budget);
        const limits: ClaudeLimits = {
            monthlyBudgetUsd: Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null,
        };
        setSaving(true);
        try {
            await usageApi.saveClaudeLimits(limits);
            onLimitsSaved(limits);
            onNotice('Claude spend limit saved.');
        } catch (err) {
            onError(typeof err === 'string' ? err : 'Could not save the Claude spend limit');
        } finally {
            setSaving(false);
        }
    };

    const focusBudget = () => {
        document.getElementById('claude-limits')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        document.getElementById('claude-budget')?.focus({ preventScroll: true });
    };

    const recentLimit = claude.rateLimits.find(
        (limit) =>
            limit.lastLimitedAt && now > 0 && now - new Date(limit.lastLimitedAt).getTime() < 7 * 86_400_000
    );
    const budgetLimit = claude.limits.monthlyBudgetUsd;
    const maxDayCost = Math.max(0.000001, ...claude.daily.map((day) => day.costUsd));
    const activeDays = claude.daily.filter((day) => day.requests > 0).slice(-14).reverse();

    return (
        <section className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="flex items-center gap-2 text-lg font-bold text-fg">
                        Claude API
                        {claude.active ? (
                            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
                                In use
                            </span>
                        ) : (
                            <span className="rounded-full bg-sunken px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-subtle">
                                Not in use
                            </span>
                        )}
                    </h2>
                    <p className="mt-0.5 text-xs text-muted">
                        Model: <span className="font-semibold text-fg-2">{claude.model}</span> · Days in UTC, like the
                        Claude Console ·{' '}
                        <Link href="/settings" className="text-indigo-700 hover:underline dark:text-indigo-300">
                            {claude.active ? 'Change' : 'Switch to Claude'}
                        </Link>
                    </p>
                </div>
            </div>

            {!claude.configured ? (
                <div className="rounded-2xl border border-dashed border-line-strong bg-surface p-8 text-center text-sm text-muted">
                    Add your Anthropic API key under{' '}
                    <Link href="/settings" className="font-bold text-indigo-700 dark:text-indigo-300">
                        Profile
                    </Link>{' '}
                    to start tracking Claude usage.
                </div>
            ) : null}

            {recentLimit ? (
                <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
                    <strong>Anthropic stopped a request</strong> on {formatIstDateTime(recentLimit.lastLimitedAt!)}:{' '}
                    {recentLimit.model} hit its rate limit
                    {recentLimit.retryAfterSeconds !== null
                        ? ` (retry after ${formatNumber(recentLimit.retryAfterSeconds)}s)`
                        : ''}
                    .
                </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Card label="Spend today">
                    <div className="mt-2 text-3xl font-bold text-fg">{usd(claude.today.costUsd)}</div>
                    <div className="mt-1 text-xs text-muted">
                        {formatNumber(claude.today.requests)} request{claude.today.requests === 1 ? '' : 's'}
                    </div>
                    <div className="mt-3 text-xs text-subtle">
                        {claude.today.failures > 0 ? `${formatNumber(claude.today.failures)} failed` : 'No failures'}
                    </div>
                </Card>
                <Card label="This month">
                    <div className="mt-2 flex items-baseline gap-1.5">
                        <span className="text-3xl font-bold text-fg">{usd(claude.month.costUsd)}</span>
                        {budgetLimit !== null ? (
                            <span className="text-sm text-muted">of ${budgetLimit.toFixed(2)}</span>
                        ) : null}
                    </div>
                    {budgetLimit === null ? (
                        <button
                            type="button"
                            onClick={focusBudget}
                            className="mt-3 text-xs font-bold text-indigo-700 hover:underline dark:text-indigo-300"
                        >
                            Set your spend limit to see what&apos;s left →
                        </button>
                    ) : (
                        <div className="mt-3 space-y-1.5">
                            <Bar percent={(claude.month.costUsd / budgetLimit) * 100} />
                            <div className="text-xs text-muted">
                                {usd(Math.max(0, budgetLimit - claude.month.costUsd))} left this month
                            </div>
                        </div>
                    )}
                </Card>
                <Card label="Tokens">
                    <div className="mt-2 text-3xl font-bold text-fg">{compact(tokens(claude.today))}</div>
                    <div className="mt-1 text-xs text-muted">today</div>
                    <div className="mt-3 text-xs text-subtle">
                        {compact(tokens(claude.month))} this month · {compact(claude.month.inputTokens)} in /{' '}
                        {compact(claude.month.outputTokens)} out
                    </div>
                </Card>
                <Card label="Requests">
                    <div className="mt-2 text-3xl font-bold text-fg">{formatNumber(claude.month.requests)}</div>
                    <div className="mt-1 text-xs text-muted">this month</div>
                    <div className="mt-3 text-xs text-subtle">
                        {formatNumber(claude.month.rateLimited)} rate limited · {formatNumber(claude.month.refusals)}{' '}
                        declined
                    </div>
                </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
                <div className="min-w-0 rounded-2xl border border-line bg-surface p-5 shadow-card">
                    <h3 className="text-sm font-bold text-fg">By feature</h3>
                    <div className="mt-3 overflow-x-auto">
                        <table className="w-full min-w-[420px] text-left text-xs">
                            <thead className="text-[10px] uppercase tracking-widest text-subtle">
                                <tr>
                                    <th className="py-2 font-bold">Feature</th>
                                    <th className="py-2 text-right font-bold">Today</th>
                                    <th className="py-2 text-right font-bold">This month</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                                {FEATURES.map((feature) => {
                                    const row = claude.byFeature.find((item) => item.feature === feature.id);
                                    const today = row?.today;
                                    const month = row?.month;
                                    return (
                                        <tr key={feature.id}>
                                            <td className="py-2.5">
                                                <span className="inline-flex items-center gap-2 font-semibold text-fg">
                                                    <span className={`h-2 w-2 rounded-full ${feature.color}`} />
                                                    {feature.label}
                                                </span>
                                            </td>
                                            <td className="py-2.5 text-right text-muted">
                                                {formatNumber(today?.requests ?? 0)} req ·{' '}
                                                {compact(today ? tokens(today) : 0)} tok ·{' '}
                                                <span className="font-semibold text-fg">{usd(today?.costUsd ?? 0)}</span>
                                            </td>
                                            <td className="py-2.5 text-right text-muted">
                                                {formatNumber(month?.requests ?? 0)} req ·{' '}
                                                {compact(month ? tokens(month) : 0)} tok ·{' '}
                                                <span className="font-semibold text-fg">{usd(month?.costUsd ?? 0)}</span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {claude.byModel.length > 0 ? (
                        <div className="mt-4 border-t border-line pt-3 text-xs text-muted">
                            {claude.byModel.map((model) => (
                                <div key={model.model} className="flex justify-between gap-3 py-1">
                                    <span className="truncate font-semibold text-fg-2">{model.model}</span>
                                    <span className="shrink-0">
                                        {compact(tokens(model.month))} tokens this month ·{' '}
                                        {model.priced ? usd(model.month.costUsd) : 'price unknown'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </div>

                <div className="min-w-0 rounded-2xl border border-line bg-surface p-5 shadow-card">
                    <h3 className="text-sm font-bold text-fg">Rate limits</h3>
                    {claude.rateLimits.length === 0 ? (
                        <p className="mt-2 text-sm text-subtle">
                            Anthropic sends your limits with every reply. They show here after your first Claude
                            request.
                        </p>
                    ) : (
                        <div className="mt-3 space-y-5">
                            {claude.rateLimits.map((limit) => (
                                <div key={limit.model} className="space-y-3">
                                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                                        <span className="text-sm font-semibold text-fg">{limit.model}</span>
                                        <span className="text-[11px] text-subtle">
                                            as of {formatIstDateTime(limit.observedAt)}
                                        </span>
                                    </div>
                                    <LimitRow label="Requests" meter={limit.requests} unit="requests" />
                                    <LimitRow label="Input tokens" meter={limit.inputTokens} unit="tokens" />
                                    <LimitRow label="Output tokens" meter={limit.outputTokens} unit="tokens" />
                                </div>
                            ))}
                            <p className="text-[11px] leading-relaxed text-subtle">
                                Limits refill continuously and cover your whole Anthropic organization, so other
                                apps using it count too.
                            </p>
                        </div>
                    )}
                </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
                <div className="min-w-0 rounded-2xl border border-line bg-surface p-5 shadow-card">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <h3 className="text-sm font-bold text-fg">Spend per day, last 30 days</h3>
                        <div className="flex flex-wrap gap-3 text-[11px] text-muted">
                            {FEATURES.map((feature) => (
                                <span key={feature.id} className="inline-flex items-center gap-1.5">
                                    <span className={`h-2 w-2 rounded-full ${feature.color}`} />
                                    {feature.label}
                                </span>
                            ))}
                        </div>
                    </div>
                    <div className="flex h-40 items-end gap-1" aria-label="Claude spend per day">
                        {claude.daily.map((day) => (
                            <div
                                key={day.day}
                                className="flex h-full min-w-2 flex-1 flex-col items-center justify-end gap-1"
                                title={`${day.day}: ${usd(day.costUsd)}, ${compact(day.tokens)} tokens, ${day.requests} requests`}
                            >
                                <div
                                    className="flex w-full max-w-3 flex-col-reverse overflow-hidden rounded-t"
                                    style={{ height: `${(day.costUsd / maxDayCost) * 100}%` }}
                                >
                                    {FEATURES.map((feature) => {
                                        const cell = day.features.find((item) => item.feature === feature.id);
                                        if (!cell || cell.costUsd <= 0 || day.costUsd <= 0) return null;
                                        return (
                                            <div
                                                key={feature.id}
                                                className={feature.color}
                                                style={{ height: `${(cell.costUsd / day.costUsd) * 100}%` }}
                                            />
                                        );
                                    })}
                                </div>
                                <span className="text-[9px] text-subtle">{Number(day.day.slice(8))}</span>
                            </div>
                        ))}
                    </div>

                    {activeDays.length > 0 ? (
                        <div className="mt-5 overflow-x-auto">
                            <table className="w-full min-w-[560px] text-left text-xs">
                                <thead className="text-[10px] uppercase tracking-widest text-subtle">
                                    <tr>
                                        <th className="py-2 font-bold">Day (UTC)</th>
                                        {FEATURES.map((feature) => (
                                            <th key={feature.id} className="py-2 text-right font-bold">
                                                {feature.label}
                                            </th>
                                        ))}
                                        <th className="py-2 text-right font-bold">Total</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-line">
                                    {activeDays.map((day) => (
                                        <tr key={day.day}>
                                            <td className="py-2 font-semibold text-fg">{day.day}</td>
                                            {FEATURES.map((feature) => {
                                                const cell = day.features.find((item) => item.feature === feature.id);
                                                return (
                                                    <td key={feature.id} className="py-2 text-right text-muted">
                                                        {cell && cell.requests > 0 ? (
                                                            <>
                                                                <span className="font-semibold text-fg">
                                                                    {usd(cell.costUsd)}
                                                                </span>
                                                                <br />
                                                                {compact(cell.tokens)} tok
                                                            </>
                                                        ) : (
                                                            '—'
                                                        )}
                                                    </td>
                                                );
                                            })}
                                            <td className="py-2 text-right">
                                                <span className="font-bold text-fg">{usd(day.costUsd)}</span>
                                                <br />
                                                <span className="text-muted">{compact(day.tokens)} tok</span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p className="mt-4 text-sm text-subtle">
                            No Claude calls yet. Draft a caption with Claude selected to start the count.
                        </p>
                    )}
                </div>

                <form
                    id="claude-limits"
                    onSubmit={saveBudget}
                    className="min-w-0 rounded-2xl border border-line bg-surface p-5 shadow-card"
                >
                    <h3 className="text-sm font-bold text-fg">Your spend limit</h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted">
                        Anthropic doesn&apos;t share an API key&apos;s spend with apps, so Meta-Bru counts the tokens
                        in every reply and prices them at Anthropic&apos;s list prices. Copy your monthly spend limit
                        from the Claude Console → Limits to see what&apos;s left. Your invoice in the Console is the
                        final figure.
                    </p>
                    <label className="mt-4 block text-xs font-semibold text-fg-2">
                        Monthly spend limit (USD)
                        <input
                            id="claude-budget"
                            type="number"
                            min={0.01}
                            step="0.01"
                            inputMode="decimal"
                            value={budget}
                            onChange={(event) => setBudget(event.target.value)}
                            placeholder="e.g. 20"
                            className="mt-1 w-full rounded-xl border border-line-strong bg-surface-2 px-3 py-2.5 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                        />
                    </label>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                        <button
                            type="submit"
                            disabled={saving}
                            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-60"
                        >
                            {saving ? 'Saving...' : 'Save limit'}
                        </button>
                        <a
                            href="https://platform.claude.com/settings/limits"
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-bold text-indigo-700 hover:underline dark:text-indigo-300"
                        >
                            Open Claude Console ↗
                        </a>
                        <a
                            href="https://platform.claude.com/docs/en/api/rate-limits"
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-bold text-indigo-700 hover:underline dark:text-indigo-300"
                        >
                            Rate limit docs ↗
                        </a>
                    </div>
                </form>
            </div>
        </section>
    );
}
