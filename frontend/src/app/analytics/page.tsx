'use client';

import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { AnalyticsPostCard } from '@/components/AnalyticsPostCard';
import {
    AnalyticsBarChart,
    AnalyticsHeatmap,
    MetricCard,
} from '@/components/AnalyticsCharts';
import { AnalyticsMonitor } from '@/components/AnalyticsMonitor';
import { PostTrackerCalendar } from '@/components/PostTrackerCalendar';
import { analyticsApi, connectionsApi } from '@/lib/apiClient';
import {
    formatElapsed,
    formatIstDateTime,
    type AnalyticsMonitor as AnalyticsMonitorData,
    type AnalyticsOverview,
    type AnalyticsPost,
    type AnalyticsTipsResponse,
    type SocialConnection,
} from '@/lib/types';

type TabKey = 'overview' | 'monitor' | 'tracker' | 'ai';
type RangeKey = '7' | '30' | '60' | '90' | 'custom';

const TABS: Array<{ key: TabKey; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'monitor', label: 'Live monitor' },
    { key: 'tracker', label: 'Post tracker' },
    { key: 'ai', label: 'AI analysis' },
];

function istTodayKey(): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
    }).format(new Date());
}

function daysAgoKey(days: number): string {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - days);
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
    }).format(date);
}

function rangeFor(preset: RangeKey, customFrom: string, customTo: string) {
    if (preset === 'custom') return { from: customFrom, to: customTo };
    return { from: daysAgoKey(Number(preset) - 1), to: istTodayKey() };
}

function formatMetric(value: number | null, suffix = ''): string {
    return value === null ? '—' : `${value}${suffix}`;
}

function formatNumber(value: number | null | undefined): string {
    return value === null || value === undefined
        ? '—'
        : value.toLocaleString('en-IN');
}

export default function AnalyticsPage() {
    const [tab, setTab] = useState<TabKey>('overview');
    const [range, setRange] = useState<RangeKey>('30');
    const [customFrom, setCustomFrom] = useState(daysAgoKey(29));
    const [customTo, setCustomTo] = useState(istTodayKey());
    const [connectionId, setConnectionId] = useState('');
    const [platform, setPlatform] = useState('');
    const [connections, setConnections] = useState<SocialConnection[]>([]);
    const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
    const [monitor, setMonitor] = useState<AnalyticsMonitorData | null>(null);
    const [posts, setPosts] = useState<AnalyticsPost[]>([]);
    const [tips, setTips] = useState<AnalyticsTipsResponse | null>(null);
    const [live, setLive] = useState(false);
    const [monitorLoading, setMonitorLoading] = useState(false);
    const [trackerMonth, setTrackerMonth] = useState(() =>
        new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })
            .format(new Date())
            .slice(0, 7)
    );
    const [trackerPosts, setTrackerPosts] = useState<AnalyticsPost[]>([]);
    const [trackerLoading, setTrackerLoading] = useState(false);
    const [selectedDay, setSelectedDay] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [now, setNow] = useState(Date.now());
    const syncingRef = useRef(false);

    useEffect(() => {
        const requested = new URLSearchParams(window.location.search).get(
            'tab'
        );
        if (TABS.some((item) => item.key === requested)) {
            setTab(requested as TabKey);
        }
        void connectionsApi
            .list()
            .then((data: any) => setConnections(data.connections || []))
            .catch(() => setConnections([]));
    }, []);

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(timer);
    }, []);

    const params = useMemo(() => {
        const selected = rangeFor(range, customFrom, customTo);
        return {
            from: selected.from,
            to: selected.to,
            ...(connectionId ? { connectionId } : {}),
            ...(platform ? { platform } : {}),
        };
    }, [range, customFrom, customTo, connectionId, platform]);

    const loadAll = useCallback(
        async (showSpinner = false) => {
            if (showSpinner) setLoading(true);
            setError('');
            try {
                const [overviewData, postsData, tipsData] = await Promise.all([
                    analyticsApi.overview(params),
                    analyticsApi.posts({ ...params, page: '1', limit: '25' }),
                    analyticsApi.tips(params).catch(() => null),
                ]);
                setOverview(overviewData);
                setPosts(postsData.posts);
                setPage(1);
                setHasMore(postsData.hasMore);
                if (tipsData) setTips(tipsData);
            } catch (err: any) {
                setError(
                    typeof err === 'string'
                        ? err
                        : 'Could not load analytics'
                );
            } finally {
                setLoading(false);
            }
        },
        [params]
    );

    useEffect(() => {
        void loadAll(true);
    }, [loadAll]);

    const loadMonitor = useCallback(async () => {
        setMonitorLoading(true);
        try {
            const data = await analyticsApi.monitor(params);
            setMonitor(data);
        } catch (err: any) {
            setError(
                typeof err === 'string'
                    ? err
                    : 'Could not load the live monitor'
            );
        } finally {
            setMonitorLoading(false);
        }
    }, [params]);

    useEffect(() => {
        if (tab === 'monitor') void loadMonitor();
    }, [tab, loadMonitor]);

    const syncLive = useCallback(async () => {
        if (syncingRef.current) return;
        syncingRef.current = true;
        setSyncing(true);
        try {
            await analyticsApi.sync({ ...params, mode: 'live' });
            await loadMonitor();
        } catch (err: any) {
            setError(
                typeof err === 'string'
                    ? err
                    : 'Could not sync live insights'
            );
        } finally {
            syncingRef.current = false;
            setSyncing(false);
        }
    }, [params, loadMonitor]);

    useEffect(() => {
        if (tab !== 'monitor' || !live) return;
        const isVisible = () => document.visibilityState === 'visible';
        const uiTimer = setInterval(() => {
            if (isVisible()) void loadMonitor();
        }, 30_000);
        const syncTimer = setInterval(() => {
            if (isVisible()) void syncLive();
        }, 5 * 60_000);
        if (isVisible()) void syncLive();
        return () => {
            clearInterval(uiTimer);
            clearInterval(syncTimer);
        };
    }, [tab, live, loadMonitor, syncLive]);

    const loadTracker = useCallback(async () => {
        setTrackerLoading(true);
        try {
            const [year, monthNumber] = trackerMonth.split('-').map(Number);
            const lastDay = new Date(
                Date.UTC(year, monthNumber, 0)
            ).getUTCDate();
            const data = await analyticsApi.posts({
                from: `${trackerMonth}-01`,
                to: `${trackerMonth}-${String(lastDay).padStart(2, '0')}`,
                ...(connectionId ? { connectionId } : {}),
                ...(platform ? { platform } : {}),
                page: '1',
                limit: '100',
            });
            setTrackerPosts(data.posts);
        } catch {
            setError('Could not load the post tracker.');
        } finally {
            setTrackerLoading(false);
        }
    }, [trackerMonth, connectionId, platform]);

    useEffect(() => {
        if (tab === 'tracker') void loadTracker();
    }, [tab, loadTracker]);

    const loadMore = async () => {
        const next = page + 1;
        try {
            const data = await analyticsApi.posts({
                ...params,
                page: String(next),
                limit: '25',
            });
            setPosts((current) => [...current, ...data.posts]);
            setPage(next);
            setHasMore(data.hasMore);
        } catch (err: any) {
            setError(
                typeof err === 'string'
                    ? err
                    : 'Could not load more posts'
            );
        }
    };

    const refresh = async () => {
        if (syncingRef.current) return;
        syncingRef.current = true;
        setSyncing(true);
        setNotice('');
        setError('');
        try {
            const result: any = await analyticsApi.sync({
                ...params,
                mode: 'stale',
            });
            setNotice(
                result.synced
                    ? `Updated ${result.synced} insight${result.synced === 1 ? '' : 's'}.`
                    : 'Analytics are already up to date.'
            );
            if (tab === 'monitor') {
                await loadMonitor();
            } else if (tab === 'tracker') {
                await loadTracker();
            } else {
                await loadAll();
            }
        } catch (err: any) {
            setError(
                typeof err === 'string'
                    ? err
                    : 'Could not refresh insights'
            );
        } finally {
            syncingRef.current = false;
            setSyncing(false);
        }
    };

    const refreshMonitor = async () => {
        if (syncingRef.current) return;
        syncingRef.current = true;
        setSyncing(true);
        setNotice('');
        setError('');
        try {
            const result: any = await analyticsApi.sync({
                ...params,
                mode: 'stale',
            });
            setNotice(
                result.synced
                    ? `Updated ${result.synced} insight${result.synced === 1 ? '' : 's'}.`
                    : 'Analytics are already up to date.'
            );
            await loadMonitor();
        } catch (err: any) {
            setError(
                typeof err === 'string'
                    ? err
                    : 'Could not refresh insights'
            );
        } finally {
            syncingRef.current = false;
            setSyncing(false);
        }
    };

    const reconnectCount = overview?.sync.permissionErrors.length || 0;

    return (
        <AppShell
            title="Analytics"
            subtitle="Published-post performance, engagement history, and posting timing. All times are IST."
            actions={
                <button
                    onClick={refresh}
                    disabled={syncing}
                    className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-indigo-500 disabled:opacity-50"
                >
                    {syncing ? 'Refreshing...' : 'Refresh insights'}
                </button>
            }
        >
            {notice ? (
                <div className="mb-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                    {notice}
                </div>
            ) : null}
            {error ? (
                <div className="mb-5 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                    {error}
                </div>
            ) : null}
            {reconnectCount > 0 ? (
                <div className="mb-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                    {reconnectCount} Page{reconnectCount === 1 ? '' : 's'}{' '}
                    need reconnecting to load engagement insights.{' '}
                    <Link
                        href="/connections"
                        className="font-bold underline"
                    >
                        Open connections
                    </Link>
                </div>
            ) : null}

            <div className="mb-6 flex flex-wrap items-center gap-2">
                {(['7', '30', '60', '90'] as RangeKey[]).map((value) => (
                    <button
                        key={value}
                        onClick={() => setRange(value)}
                        className={`rounded-xl border px-3 py-2 text-xs font-bold ${
                            range === value
                                ? 'border-indigo-500/20 bg-indigo-500/15 text-indigo-300'
                                : 'border-white/5 bg-slate-900/40 text-slate-400'
                        }`}
                    >
                        {value} days
                    </button>
                ))}
                <button
                    onClick={() => setRange('custom')}
                    className={`rounded-xl border px-3 py-2 text-xs font-bold ${
                        range === 'custom'
                            ? 'border-indigo-500/20 bg-indigo-500/15 text-indigo-300'
                            : 'border-white/5 bg-slate-900/40 text-slate-400'
                    }`}
                >
                    Custom
                </button>
                {range === 'custom' ? (
                    <>
                        <input
                            type="date"
                            value={customFrom}
                            onChange={(event) =>
                                setCustomFrom(event.target.value)
                            }
                            className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white"
                        />
                        <input
                            type="date"
                            value={customTo}
                            onChange={(event) =>
                                setCustomTo(event.target.value)
                            }
                            className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white"
                        />
                    </>
                ) : null}
                <select
                    value={connectionId}
                    onChange={(event) => setConnectionId(event.target.value)}
                    className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white"
                >
                    <option value="">All Pages</option>
                    {connections.map((connection) => (
                        <option key={connection._id} value={connection._id}>
                            {connection.pageName}
                        </option>
                    ))}
                </select>
                <select
                    value={platform}
                    onChange={(event) => setPlatform(event.target.value)}
                    className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white"
                >
                    <option value="">All platforms</option>
                    <option value="facebook">Facebook</option>
                    <option value="instagram">Instagram</option>
                </select>
                <span className="ml-auto text-xs text-slate-500">
                    {overview?.sync.lastSyncedAt
                        ? `Last synced ${formatElapsed(
                              overview.sync.lastSyncedAt,
                              now
                          )}`
                        : 'Not synced yet'}
                </span>
            </div>

            <div className="mb-6 flex gap-2 overflow-x-auto">
                {TABS.map((item) => (
                    <button
                        key={item.key}
                        onClick={() => setTab(item.key)}
                        className={`whitespace-nowrap rounded-xl border px-4 py-2.5 text-xs font-bold ${
                            tab === item.key
                                ? 'border-indigo-500/20 bg-indigo-500/15 text-indigo-300'
                                : 'border-white/5 bg-slate-900/40 text-slate-400'
                        }`}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="flex justify-center py-24">
                    <div className="h-10 w-10 animate-spin rounded-full border-t-2 border-indigo-500" />
                </div>
            ) : tab === 'overview' && overview ? (
                <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                        <MetricCard
                            label="Published posts"
                            value={formatNumber(overview.totals.posts)}
                        />
                        <MetricCard
                            label="Reach"
                            value={formatNumber(overview.totals.reach)}
                            tone="sky"
                        />
                        <MetricCard
                            label="Views"
                            value={formatNumber(overview.totals.views)}
                            tone="sky"
                        />
                        <MetricCard
                            label="Interactions"
                            value={formatNumber(overview.totals.interactions)}
                            tone="emerald"
                        />
                        <MetricCard
                            label="Engagement rate"
                            value={formatMetric(
                                overview.totals.engagementRate,
                                '%'
                            )}
                            tone="amber"
                        />
                    </div>
                    <div className="grid gap-5 lg:grid-cols-2">
                        <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-5">
                            <h2 className="mb-4 text-sm font-bold text-white">
                                Publishing activity
                            </h2>
                            <AnalyticsBarChart
                                data={overview.activity.map((item) => ({
                                    label: item.label,
                                    value: item.posts,
                                    secondary: item.instagram,
                                }))}
                                primaryLabel="posts"
                                secondaryLabel="Instagram"
                            />
                        </section>
                        <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-5">
                            <h2 className="mb-4 text-sm font-bold text-white">
                                Engagement by publish date
                            </h2>
                            <AnalyticsBarChart
                                data={overview.activity.map((item) => ({
                                    label: item.label,
                                    value: item.interactions,
                                    secondary: item.reach,
                                }))}
                                valueLabel="interactions"
                                primaryLabel="interactions"
                                secondaryLabel="reach"
                            />
                        </section>
                    </div>
                    <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-5">
                        <h2 className="mb-4 text-sm font-bold text-white">
                            Best posting times (IST)
                        </h2>
                        <AnalyticsHeatmap buckets={overview.bestTimes} />
                    </section>
                    {tips?.ruleBased.length ? (
                        <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-5">
                            <div className="mb-4 flex items-center gap-2">
                                <h2 className="text-sm font-bold text-white">
                                    Engagement tips
                                </h2>
                                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                                    Rule-based
                                </span>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                                {tips.ruleBased.map((tip) => (
                                    <div
                                        key={tip.id}
                                        className="rounded-2xl border border-white/5 bg-slate-950/40 p-4"
                                    >
                                        <div className="text-sm font-bold text-white">
                                            {tip.title}
                                        </div>
                                        <p className="mt-1 text-xs text-slate-400">
                                            {tip.body}
                                        </p>
                                        {tip.actionHref ? (
                                            <Link
                                                href={tip.actionHref}
                                                className="mt-2 inline-block text-xs font-bold text-indigo-300"
                                            >
                                                {tip.actionLabel || 'Open'}
                                            </Link>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </section>
                    ) : null}
                    <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-5">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                            <h2 className="text-sm font-bold text-white">
                                AI tips
                            </h2>
                            <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-indigo-300">
                                Gemini
                            </span>
                            <button
                                onClick={() => setTab('ai')}
                                className="ml-auto text-xs font-bold text-indigo-300"
                            >
                                Open AI analysis
                            </button>
                        </div>
                        {tips?.ai ? (
                            <div>
                                <p className="text-[11px] text-slate-500">
                                    Cached result from{' '}
                                    {formatIstDateTime(tips.ai.generatedAt)}
                                </p>
                                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                    {tips.ai.tips.slice(0, 2).map((tip, index) => (
                                        <div
                                            key={`${tip.title}-${index}`}
                                            className="rounded-xl border border-white/5 bg-slate-950/40 p-3"
                                        >
                                            <div className="text-xs font-bold text-white">
                                                {tip.title}
                                            </div>
                                            <p className="mt-1 text-[11px] text-slate-400">
                                                {tip.body}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <p className="text-xs text-slate-500">
                                Run an AI analysis in the AI tab to turn your
                                stored engagement data into recommendations.
                            </p>
                        )}
                    </section>
                    <div className="space-y-4">
                        {posts.length === 0 ? (
                            <div className="rounded-3xl border border-dashed border-white/10 bg-slate-900/30 p-12 text-center text-sm text-slate-400">
                                No published posts in this range.{' '}
                                <Link
                                    href="/composer"
                                    className="font-bold text-indigo-300"
                                >
                                    Create a post
                                </Link>
                                .
                            </div>
                        ) : (
                            posts.map((post) => (
                                <AnalyticsPostCard
                                    key={post.postId}
                                    post={post}
                                    now={now}
                                />
                            ))
                        )}
                    </div>
                    {hasMore ? (
                        <button
                            onClick={loadMore}
                            className="w-full rounded-xl border border-white/10 bg-slate-900/40 px-4 py-3 text-sm font-bold text-slate-300"
                        >
                            Load more
                        </button>
                    ) : null}
                </div>
            ) : tab === 'monitor' ? (
                monitor ? (
                    <AnalyticsMonitor
                        data={monitor}
                        live={live}
                        onToggleLive={() => setLive((value) => !value)}
                        onRefresh={refreshMonitor}
                        refreshing={syncing}
                        now={now}
                    />
                ) : (
                    <div className="rounded-3xl border border-dashed border-white/10 bg-slate-900/30 p-12 text-center text-sm text-slate-400">
                        {monitorLoading
                            ? 'Loading live monitor...'
                            : 'Turn on the live monitor to build engagement history.'}
                    </div>
                )
            ) : tab === 'tracker' ? (
                <PostTrackerCalendar
                    month={trackerMonth}
                    posts={trackerPosts}
                    selectedDay={selectedDay}
                    onSelectDay={setSelectedDay}
                    onMonthChange={(next) => {
                        setTrackerMonth(next);
                        setSelectedDay(null);
                    }}
                    loading={trackerLoading}
                    now={now}
                />
            ) : (
                <div className="rounded-3xl border border-dashed border-white/10 bg-slate-900/30 p-12 text-center text-sm text-slate-400">
                    Run an AI analysis to generate page, engagement, and timing
                    tips.
                </div>
            )}
        </AppShell>
    );
}
