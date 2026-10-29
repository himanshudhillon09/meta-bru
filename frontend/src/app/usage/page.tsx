'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { AnalyticsBarChart } from '@/components/AnalyticsCharts';
import { AppShell } from '@/components/AppShell';
import { usageApi } from '@/lib/apiClient';
import {
    formatBytes,
    formatIstDateTime,
    type CloudinaryMeter,
    type GeminiFeature,
    type GeminiLimits,
    type GeminiTotals,
    type UsageReport,
} from '@/lib/types';

const FEATURE_LABELS: Record<GeminiFeature, string> = {
    caption: 'Captions',
    'image text': 'Text on image',
    image: 'Images',
    analytics: 'AI analysis',
};

function formatNumber(value: number): string {
    return value.toLocaleString('en-IN');
}

function compact(value: number): string {
    // K and M read more clearly than lakh notation for token counts.
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function tokens(totals: GeminiTotals): number {
    return totals.inputTokens + totals.outputTokens;
}

function untilReset(resetsAt: string, now: number): string {
    const ms = new Date(resetsAt).getTime() - now;
    if (!Number.isFinite(ms) || ms <= 0) return 'soon';
    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.round((ms % 3_600_000) / 60_000);
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function istTime(value: string): string {
    return new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric',
        minute: '2-digit',
    }).format(new Date(value));
}

/** A thin progress bar that turns amber, then red, as the limit gets close. */
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

/** A ring gauge for the headline number of a section. */
function Ring({ percent, label }: { percent: number; label: string }) {
    const value = Math.max(0, Math.min(100, percent));
    const radius = 42;
    const circumference = 2 * Math.PI * radius;
    const tone = value >= 90 ? 'text-rose-500' : value >= 70 ? 'text-amber-500' : 'text-emerald-500';
    return (
        <div className="relative h-28 w-28 shrink-0">
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
                <circle cx="50" cy="50" r={radius} fill="none" strokeWidth="10" className="stroke-sunken" />
                <circle
                    cx="50"
                    cy="50"
                    r={radius}
                    fill="none"
                    strokeWidth="10"
                    strokeLinecap="round"
                    stroke="currentColor"
                    className={`${tone} transition-[stroke-dashoffset] duration-1000 ease-out`}
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference * (1 - value / 100)}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xl font-bold text-fg">{Math.round(value)}%</span>
                <span className="text-[10px] font-semibold uppercase tracking-widest text-subtle">{label}</span>
            </div>
        </div>
    );
}

function LimitCard({
    label,
    used,
    limit,
    hint,
    onSetLimit,
}: {
    label: string;
    used: number;
    limit: number | null;
    hint: string;
    onSetLimit: () => void;
}) {
    const left = limit === null ? null : Math.max(0, limit - used);
    return (
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-subtle">{label}</div>
            <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-3xl font-bold text-fg">{formatNumber(used)}</span>
                <span className="text-sm text-muted">
                    {limit === null ? 'requests' : `of ${formatNumber(limit)} requests`}
                </span>
            </div>
            {limit === null ? (
                <button
                    type="button"
                    onClick={onSetLimit}
                    className="mt-3 text-xs font-bold text-indigo-700 hover:underline dark:text-indigo-300"
                >
                    Set your limit to see what&apos;s left →
                </button>
            ) : (
                <div className="mt-3 space-y-1.5">
                    <Bar percent={(used / limit) * 100} />
                    <div className="flex justify-between text-xs">
                        <span className={left === 0 ? 'font-bold text-rose-600 dark:text-rose-300' : 'text-muted'}>
                            {formatNumber(left ?? 0)} left
                        </span>
                        <span className="text-subtle">{hint}</span>
                    </div>
                </div>
            )}
        </div>
    );
}

function MeterCard({
    label,
    meter,
    format,
    extra,
}: {
    label: string;
    meter: CloudinaryMeter;
    format: (value: number) => string;
    extra?: string;
}) {
    return (
        <div className="rounded-2xl border border-line bg-surface-2 p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-subtle">{label}</div>
            <div className="mt-1.5 text-xl font-bold text-fg">{format(meter.used)}</div>
            {meter.limit > 0 ? (
                <div className="mt-2 space-y-1">
                    <Bar percent={(meter.used / meter.limit) * 100} />
                    <div className="text-[11px] text-subtle">of {format(meter.limit)}</div>
                </div>
            ) : null}
            <div className="mt-1 text-[11px] text-subtle">
                {meter.credits !== null ? `${meter.credits.toFixed(2)} credits` : ''}
                {extra ? `${meter.credits !== null ? ' · ' : ''}${extra}` : ''}
            </div>
        </div>
    );
}

export default function UsagePage() {
    const [report, setReport] = useState<UsageReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [daily, setDaily] = useState('');
    const [monthly, setMonthly] = useState('');
    const [saving, setSaving] = useState(false);
    const [now, setNow] = useState(0);

    const load = () =>
        usageApi
            .get()
            .then((data) => {
                setReport(data);
                setDaily(data.gemini.limits.dailyRequests?.toString() ?? '');
                setMonthly(data.gemini.limits.monthlyRequests?.toString() ?? '');
                setError('');
            })
            .catch((err) => setError(typeof err === 'string' ? err : 'Could not load usage'))
            .finally(() => setLoading(false));

    useEffect(() => {
        void load();
        const tick = () => setNow(Date.now());
        const first = setTimeout(tick, 0);
        const timer = setInterval(tick, 60_000);
        return () => {
            clearTimeout(first);
            clearInterval(timer);
        };
    }, []);

    const focusLimits = () => {
        document.getElementById('gemini-limits')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        document.getElementById('gemini-daily-limit')?.focus({ preventScroll: true });
    };

    const saveLimits = async (event: React.FormEvent) => {
        event.preventDefault();
        const parse = (value: string): number | null => {
            const number = Number.parseInt(value, 10);
            return Number.isFinite(number) && number > 0 ? number : null;
        };
        const limits: GeminiLimits = { dailyRequests: parse(daily), monthlyRequests: parse(monthly) };
        setSaving(true);
        setNotice('');
        try {
            await usageApi.saveGeminiLimits(limits);
            setReport((current) =>
                current ? { ...current, gemini: { ...current.gemini, limits } } : current
            );
            setNotice('Limits saved.');
        } catch (err) {
            setError(typeof err === 'string' ? err : 'Could not save limits');
        } finally {
            setSaving(false);
        }
    };

    const gemini = report?.gemini;
    const cloud = report?.cloudinary;
    const recentLimitHit =
        gemini?.lastLimitHit &&
        now > 0 &&
        now - new Date(gemini.lastLimitHit.observedAt).getTime() < 7 * 86_400_000
            ? gemini.lastLimitHit
            : null;

    return (
        <AppShell
            title="Usage"
            subtitle="How much of your own Gemini and Cloudinary limits Meta-Bru has used."
            actions={
                <button
                    type="button"
                    onClick={() => {
                        setLoading(true);
                        void load();
                    }}
                    disabled={loading}
                    className="rounded-xl border border-line-strong bg-surface px-5 py-2.5 text-sm font-bold text-fg hover:bg-hover disabled:opacity-50"
                >
                    {loading ? 'Refreshing...' : 'Refresh'}
                </button>
            }
        >
            {error ? (
                <div className="animate-fade-up mb-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                    {error}
                </div>
            ) : null}
            {notice ? (
                <div className="animate-fade-up mb-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
                    {notice}
                </div>
            ) : null}

            {!report ? (
                loading ? (
                    <div className="space-y-4">
                        <div className="skeleton h-40 rounded-2xl" />
                        <div className="skeleton h-64 rounded-2xl" />
                    </div>
                ) : null
            ) : (
                <div className="stagger space-y-8">
                    {/* Gemini */}
                    <section className="space-y-4">
                        <div className="flex flex-wrap items-end justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-bold text-fg">Gemini API</h2>
                                <p className="mt-0.5 text-xs text-muted">
                                    Text: <span className="font-semibold text-fg-2">{gemini!.models.text}</span> · Image:{' '}
                                    <span className="font-semibold text-fg-2">{gemini!.models.image}</span> ·{' '}
                                    <Link href="/settings" className="text-indigo-700 hover:underline dark:text-indigo-300">
                                        Change
                                    </Link>
                                </p>
                            </div>
                            {now > 0 ? (
                                <span className="rounded-full border border-line bg-surface px-3 py-1 text-[11px] font-semibold text-muted">
                                    Daily limits reset in {untilReset(gemini!.resetsAt, now)} ({istTime(gemini!.resetsAt)} IST)
                                </span>
                            ) : null}
                        </div>

                        {!gemini!.configured ? (
                            <div className="rounded-2xl border border-dashed border-line-strong bg-surface p-8 text-center text-sm text-muted">
                                Add your Gemini API key under{' '}
                                <Link href="/settings" className="font-bold text-indigo-700 dark:text-indigo-300">
                                    Profile
                                </Link>{' '}
                                to start tracking usage.
                            </div>
                        ) : null}

                        {recentLimitHit ? (
                            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
                                <strong>Google stopped a request</strong> on {formatIstDateTime(recentLimitHit.observedAt)}:{' '}
                                {recentLimitHit.model} hit its{' '}
                                {recentLimitHit.period === 'day' ? 'daily' : recentLimitHit.period === 'minute' ? 'per-minute' : ''} limit
                                {recentLimitHit.limit !== null ? ` of ${formatNumber(recentLimitHit.limit)} requests` : ''}
                                {recentLimitHit.freeTier ? ' on the free tier' : ''}.
                            </div>
                        ) : null}

                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <LimitCard
                                label="Today"
                                used={gemini!.today.requests}
                                limit={gemini!.limits.dailyRequests}
                                hint="resets daily"
                                onSetLimit={focusLimits}
                            />
                            <LimitCard
                                label="This month"
                                used={gemini!.month.requests}
                                limit={gemini!.limits.monthlyRequests}
                                hint="resets monthly"
                                onSetLimit={focusLimits}
                            />
                            <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
                                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-subtle">Tokens</div>
                                <div className="mt-2 text-3xl font-bold text-fg">{compact(tokens(gemini!.today))}</div>
                                <div className="mt-1 text-xs text-muted">today</div>
                                <div className="mt-3 text-xs text-subtle">
                                    {compact(tokens(gemini!.month))} this month · {compact(gemini!.month.inputTokens)} in /{' '}
                                    {compact(gemini!.month.outputTokens)} out
                                </div>
                            </div>
                            <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
                                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-subtle">Images</div>
                                <div className="mt-2 text-3xl font-bold text-fg">{formatNumber(gemini!.today.images)}</div>
                                <div className="mt-1 text-xs text-muted">generated today</div>
                                <div className="mt-3 text-xs text-subtle">
                                    {formatNumber(gemini!.month.images)} this month
                                    {gemini!.month.rateLimited > 0
                                        ? ` · ${formatNumber(gemini!.month.rateLimited)} refused for limits`
                                        : ''}
                                </div>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
                            <h3 className="text-sm font-bold text-fg">By model</h3>
                            {gemini!.byModel.length === 0 ? (
                                <p className="mt-2 text-sm text-subtle">
                                    No Gemini calls yet. Draft a caption or generate an image to start the count.
                                </p>
                            ) : (
                                <div className="mt-3 divide-y divide-line">
                                    {gemini!.byModel.map((model) => {
                                        const left =
                                            model.dailyLimit === null
                                                ? null
                                                : Math.max(0, model.dailyLimit - model.today.requests);
                                        return (
                                            <div key={model.model} className="grid gap-3 py-3 sm:grid-cols-[1.4fr_1fr_1fr] sm:items-center">
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-semibold text-fg">{model.model}</div>
                                                    <div className="mt-0.5 text-[11px] text-subtle">
                                                        {model.features.map((feature) => FEATURE_LABELS[feature]).join(', ')}
                                                    </div>
                                                </div>
                                                <div className="space-y-1.5">
                                                    <div className="flex justify-between text-xs">
                                                        <span className="text-muted">
                                                            Today {formatNumber(model.today.requests)}
                                                            {model.dailyLimit !== null ? ` / ${formatNumber(model.dailyLimit)}` : ''}
                                                        </span>
                                                        {left !== null ? (
                                                            <span className="font-semibold text-fg">{formatNumber(left)} left</span>
                                                        ) : null}
                                                    </div>
                                                    {model.dailyLimit !== null ? (
                                                        <Bar percent={(model.today.requests / model.dailyLimit) * 100} />
                                                    ) : (
                                                        <div className="text-[11px] text-subtle">
                                                            Google hasn&apos;t reported this model&apos;s daily limit yet
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="text-xs text-muted sm:text-right">
                                                    {formatNumber(model.month.requests)} this month · {compact(tokens(model.month))} tokens
                                                    {model.freeTier ? (
                                                        <span className="ml-1.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                                                            Free tier
                                                        </span>
                                                    ) : null}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
                            <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
                                <h3 className="mb-4 text-sm font-bold text-fg">Requests, last 30 days</h3>
                                <AnalyticsBarChart
                                    data={gemini!.daily.map((day) => ({
                                        label: String(Number(day.day.slice(8))),
                                        value: day.requests,
                                        secondary: day.images,
                                    }))}
                                    valueLabel="requests"
                                    primaryLabel="requests"
                                    secondaryLabel="images"
                                />
                            </div>

                            <form
                                id="gemini-limits"
                                onSubmit={saveLimits}
                                className="rounded-2xl border border-line bg-surface p-5 shadow-card"
                            >
                                <h3 className="text-sm font-bold text-fg">Your limits</h3>
                                <p className="mt-1 text-xs leading-relaxed text-muted">
                                    Google doesn&apos;t share a key&apos;s remaining quota with apps, so Meta-Bru counts every
                                    call it makes and shows what&apos;s left against these limits. Copy them from Google AI
                                    Studio → Dashboard → Rate limit. Limits apply to the whole Google Cloud project, so
                                    other apps using it count too.
                                </p>
                                <div className="mt-4 grid grid-cols-2 gap-3">
                                    <label className="text-xs font-semibold text-fg-2">
                                        Requests per day
                                        <input
                                            id="gemini-daily-limit"
                                            type="number"
                                            min={1}
                                            inputMode="numeric"
                                            value={daily}
                                            onChange={(event) => setDaily(event.target.value)}
                                            placeholder="e.g. 250"
                                            className="mt-1 w-full rounded-xl border border-line-strong bg-surface-2 px-3 py-2.5 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                        />
                                    </label>
                                    <label className="text-xs font-semibold text-fg-2">
                                        Requests per month
                                        <input
                                            type="number"
                                            min={1}
                                            inputMode="numeric"
                                            value={monthly}
                                            onChange={(event) => setMonthly(event.target.value)}
                                            placeholder="optional"
                                            className="mt-1 w-full rounded-xl border border-line-strong bg-surface-2 px-3 py-2.5 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                        />
                                    </label>
                                </div>
                                <div className="mt-4 flex flex-wrap items-center gap-3">
                                    <button
                                        type="submit"
                                        disabled={saving}
                                        className="rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-60"
                                    >
                                        {saving ? 'Saving...' : 'Save limits'}
                                    </button>
                                    <a
                                        href="https://aistudio.google.com/"
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-xs font-bold text-indigo-700 hover:underline dark:text-indigo-300"
                                    >
                                        Open Google AI Studio ↗
                                    </a>
                                    <a
                                        href="https://ai.google.dev/gemini-api/docs/rate-limits"
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

                    {/* Cloudinary */}
                    <section className="space-y-4">
                        <div className="flex flex-wrap items-end justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-bold text-fg">Cloudinary</h2>
                                <p className="mt-0.5 text-xs text-muted">
                                    Your whole Cloudinary account, as Cloudinary reports it
                                    {cloud!.lastUpdated ? ` (updated ${cloud!.lastUpdated})` : ''}.
                                </p>
                            </div>
                            {cloud!.plan ? (
                                <span className="rounded-full bg-indigo-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-indigo-700 dark:text-indigo-300">
                                    {cloud!.plan} plan
                                </span>
                            ) : null}
                        </div>

                        {!cloud!.configured ? (
                            <div className="rounded-2xl border border-dashed border-line-strong bg-surface p-8 text-center text-sm text-muted">
                                Add your Cloudinary credentials under{' '}
                                <Link href="/settings" className="font-bold text-indigo-700 dark:text-indigo-300">
                                    Profile
                                </Link>{' '}
                                to see its usage.
                            </div>
                        ) : cloud!.error ? (
                            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                                Cloudinary did not return usage: {cloud!.error}
                            </div>
                        ) : (
                            <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
                                <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                                    {cloud!.credits ? (
                                        <>
                                            <Ring percent={cloud!.credits.percent} label="credits" />
                                            <div className="min-w-0 flex-1">
                                                <div className="text-2xl font-bold text-fg">
                                                    {cloud!.credits.used.toFixed(2)}{' '}
                                                    <span className="text-base font-semibold text-muted">
                                                        of {formatNumber(cloud!.credits.limit)} credits used
                                                    </span>
                                                </div>
                                                <div className="mt-1 text-sm text-muted">
                                                    {(cloud!.credits.limit - cloud!.credits.used).toFixed(2)} credits left. One credit
                                                    covers 1 GB of storage, 1 GB of bandwidth, or 1,000 transformations, counted
                                                    over Cloudinary&apos;s monthly cycle.
                                                </div>
                                                <Link
                                                    href="/storage"
                                                    className="mt-3 inline-flex text-xs font-bold text-indigo-700 hover:underline dark:text-indigo-300"
                                                >
                                                    Free up storage →
                                                </Link>
                                            </div>
                                        </>
                                    ) : (
                                        <p className="text-sm text-muted">
                                            This plan reports separate limits instead of credits; see each meter below.
                                        </p>
                                    )}
                                </div>
                                <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                                    <MeterCard label="Storage" meter={cloud!.storage} format={formatBytes} />
                                    <MeterCard label="Bandwidth" meter={cloud!.bandwidth} format={formatBytes} />
                                    <MeterCard
                                        label="Transformations"
                                        meter={cloud!.transformations}
                                        format={formatNumber}
                                    />
                                    <MeterCard
                                        label="Files"
                                        meter={{ used: cloud!.resources, limit: 0, credits: null }}
                                        format={formatNumber}
                                        extra={`${formatNumber(cloud!.derivedResources)} derived versions`}
                                    />
                                </div>
                            </div>
                        )}
                    </section>
                </div>
            )}
        </AppShell>
    );
}
