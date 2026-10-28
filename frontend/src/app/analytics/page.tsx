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
import { AnalyticsAiTips } from '@/components/AnalyticsAiTips';
import { AnalyticsMonitor } from '@/components/AnalyticsMonitor';
import { AnalyticsTips } from '@/components/AnalyticsTips';
import { PostTrackerCalendar } from '@/components/PostTrackerCalendar';
import { analyticsApi, connectionsApi } from '@/lib/apiClient';
import {
    formatElapsed,
    formatIstDateTime,
    type AnalyticsMonitor as AnalyticsMonitorData,
    type AnalyticsOverview,
    type AnalyticsPermissionError,
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

const RECONNECT_HREF = '/connections?returnTo=/analytics';

function syncNotice(
    result: {
        synced?: number;
        failed?: number;
        skipped?: number;
        remaining?: number;
    },
    automatic = false
): string {
    const synced = Number(result.synced) || 0;
    const failed = Number(result.failed) || 0;
    const skipped = Number(result.skipped) || 0;
    const remaining = Number(result.remaining) || 0;
    const parts: string[] = [];
    if (synced > 0) {
        parts.push(
            `Updated ${synced} insight${synced === 1 ? '' : 's'}`
        );
    }
    if (failed > 0) {
        parts.push(`${failed} could not be updated`);
    }
    if (skipped > 0) {
        parts.push(
            skipped === 1
                ? '1 skipped because its Page is disconnected or needs reconnecting'
                : `${skipped} skipped because their Pages are disconnected or need reconnecting`
        );
    }
    if (remaining > 0) {
        parts.push(`${remaining} remaining; refresh again`);
    }
    if (parts.length > 0) return `${parts.join('. ')}.`;
    return automatic ? '' : 'Analytics are already up to date.';
}

/** Merges overview and monitor permission errors into one entry per Page. */
function mergePermissionErrors(
    ...lists: Array<AnalyticsPermissionError[] | undefined>
): AnalyticsPermissionError[] {
    const merged = new Map<string, AnalyticsPermissionError>();
    for (const list of lists) {
        for (const error of list ?? []) {
            if (!merged.has(error.connectionId)) {
                merged.set(error.connectionId, error);
            }
        }
    }
    return [...merged.values()];
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
    // The filter selection the loaded overview belongs to.
    const [overviewKey, setOverviewKey] = useState('');
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
    const [aiLoading, setAiLoading] = useState(false);
    const [aiError, setAiError] = useState('');
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [now, setNow] = useState(0);
    const syncingRef = useRef(false);
    const loadingMoreRef = useRef(false);
    const autoSyncedKeyRef = useRef('');

    const loadConnections = useCallback(async () => {
        try {
            const data: any = await connectionsApi.list();
            setConnections(data.connections || []);
        } catch {
            // Keep the current list when a background refresh fails.
        }
    }, []);

    useEffect(() => {
        const requested = new URLSearchParams(window.location.search).get(
            'tab'
        );
        if (TABS.some((item) => item.key === requested)) {
            setTab(requested as TabKey);
        }
        void loadConnections();
    }, [loadConnections]);

    useEffect(() => {
        const tick = () => setNow(Date.now());
        const initial = setTimeout(tick, 0);
        const timer = setInterval(tick, 60_000);
        return () => {
            clearTimeout(initial);
            clearInterval(timer);
        };
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

    useEffect(() => {
        setAiError('');
        setMonitor(null);
        setTrackerPosts([]);
        setNotice('');
    }, [params]);

    const loadAll = useCallback(
        async (showSpinner = false) => {
            if (showSpinner) {
                setLoading(true);
                setTips(null);
            }
            setError('');
            setAiError('');
            try {
                const [overviewData, postsData, tipsData] = await Promise.all([
                    analyticsApi.overview(params),
                    analyticsApi.posts({ ...params, page: '1', limit: '25' }),
                    analyticsApi.tips(params).catch(() => null),
                ]);
                setOverview(overviewData);
                setOverviewKey(JSON.stringify(params));
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
        setError('');
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
        setTrackerPosts([]);
        setError('');
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

    useEffect(() => {
        if (tab === 'tracker') void loadConnections();
    }, [tab, loadConnections]);

    const loadMore = async () => {
        if (loadingMoreRef.current) return;
        loadingMoreRef.current = true;
        setLoadingMore(true);
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
        } finally {
            loadingMoreRef.current = false;
            setLoadingMore(false);
        }
    };

    const refresh = useCallback(
        async (automatic = false) => {
            if (syncingRef.current) return;
            syncingRef.current = true;
            setSyncing(true);
            if (!automatic) {
                setNotice('');
                setError('');
            }
            try {
                const result: any = await analyticsApi.sync({
                    ...params,
                    mode: 'stale',
                });
                const message = syncNotice(result, automatic);
                if (message) setNotice(message);
                if (tab === 'monitor') {
                    await loadMonitor();
                } else if (tab === 'tracker') {
                    await loadTracker();
                    void loadConnections();
                } else {
                    await loadAll();
                }
            } catch (err: any) {
                // A background refresh keeps the stored insights on screen;
                // only a refresh the user asked for reports a failure.
                if (!automatic) {
                    setError(
                        typeof err === 'string'
                            ? err
                            : 'Could not refresh insights'
                    );
                }
            } finally {
                syncingRef.current = false;
                setSyncing(false);
            }
        },
        [params, tab, loadMonitor, loadTracker, loadConnections, loadAll]
    );

    // Fetch fresh insights from Meta once per filter selection when the stored
    // ones are stale, including right after a Page was reconnected.
    const staleTargets = overview?.sync.staleTargets ?? 0;
    useEffect(() => {
        const key = JSON.stringify(params);
        if (loading || syncing || overviewKey !== key) return;
        if (autoSyncedKeyRef.current === key) return;
        autoSyncedKeyRef.current = key;
        if (staleTargets > 0) void refresh(true);
    }, [loading, syncing, overviewKey, staleTargets, params, refresh]);

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
            setNotice(syncNotice(result));
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

    const generateAi = async () => {
        setAiLoading(true);
        setAiError('');
        try {
            const result: any = await analyticsApi.generateTips(params);
            if (!result?.insight) {
                throw new Error('AI analysis returned no tips.');
            }
            setTips((current) => ({
                ruleBased: current?.ruleBased || [],
                ai: {
                    cached: Boolean(result.cached),
                    ...result.insight,
                },
            }));
        } catch (err: any) {
            setAiError(
                typeof err === 'string'
                    ? err
                    : 'Could not generate AI tips. Rule-based tips are still available.'
            );
        } finally {
            setAiLoading(false);
        }
    };

    const aiNotConfigured = /gemini api key is not configured/i.test(aiError);
    const selectedConnection = connectionId
        ? connections.find((item) => item._id === connectionId) ?? null
        : null;
    const permissionErrors = mergePermissionErrors(
        overview?.sync.permissionErrors,
        monitor?.sync.permissionErrors
    );
    const reconnectPages = [
        ...new Set([
            ...permissionErrors
                .filter((item) => item.reconnectRequired !== false)
                .map((item) => item.pageName),
            ...connections
                .filter((item) => item.tokenStatus === 'needs_reauth')
                .map((item) => item.pageName),
        ]),
    ];
    const missingScopes = [
        ...new Set(permissionErrors.flatMap((item) => item.missingScopes ?? [])),
    ];
    const blockedErrors = permissionErrors.filter(
        (item) => item.reconnectRequired === false
    );

    return (
        <AppShell
            title="Analytics"
            subtitle="Published-post performance, engagement history, and posting timing. All times are IST."
            actions={
                <button
                    onClick={() => void refresh()}
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
            {reconnectPages.length > 0 ? (
                <div className="mb-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                    {reconnectPages.join(', ')}{' '}
                    {reconnectPages.length === 1 ? 'needs' : 'need'}{' '}
                    reconnecting to load engagement insights.
                    {missingScopes.length > 0
                        ? ` Facebook did not grant ${missingScopes.join(', ')}; allow ${
                              missingScopes.length === 1 ? 'it' : 'them'
                          } when you reconnect.`
                        : ''}{' '}
                    <Link href={RECONNECT_HREF} className="font-bold underline">
                        Reconnect now
                    </Link>
                </div>
            ) : null}
            {blockedErrors.map((item) => {
                const instagram = (item.platforms ?? [item.platform]).includes(
                    'instagram'
                );
                return (
                    <div
                        key={item.connectionId}
                        className="mb-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
                    >
                        <div>
                            Meta still blocks insights for{' '}
                            <strong>{item.pageName}</strong> (
                            {(item.platforms ?? [item.platform]).join(' and ')}
                            ) even though the Page was reconnected, so
                            reconnecting again will not help.
                            {item.error ? (
                                <>
                                    {' '}
                                    Meta says: <q>{item.error}</q>
                                </>
                            ) : null}
                        </div>
                        <details className="mt-2 text-xs text-amber-100/80">
                            <summary className="cursor-pointer font-bold text-amber-200">
                                What to check in Meta
                            </summary>
                            <ul className="mt-2 list-disc space-y-1 pl-5">
                                <li>
                                    Your Facebook account needs full control of
                                    the Page, or partial access that includes
                                    Insights. Business portfolio access without
                                    Insights cannot read them.
                                </li>
                                <li>
                                    In your Meta app, under App Review →
                                    Permissions and Features, read_insights,
                                    pages_read_engagement
                                    {instagram
                                        ? ' and instagram_manage_insights'
                                        : ''}{' '}
                                    must be available. They need Advanced
                                    Access for anyone without a role on the
                                    app.
                                </li>
                                {instagram ? (
                                    <li>
                                        If the Page belongs to a Business
                                        portfolio, Meta also requires ads_read
                                        and ads_management for Instagram
                                        insights. Add both to your Meta app,
                                        append them to META_SCOPES on the API
                                        service (the default list is in
                                        backend/.env.example), then reconnect.
                                    </li>
                                ) : null}
                            </ul>
                        </details>
                    </div>
                );
            })}

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
                            aria-label="From date"
                            value={customFrom}
                            onChange={(event) =>
                                setCustomFrom(event.target.value)
                            }
                            className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white"
                        />
                        <input
                            type="date"
                            aria-label="To date"
                            value={customTo}
                            onChange={(event) =>
                                setCustomTo(event.target.value)
                            }
                            className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white"
                        />
                    </>
                ) : null}
                <select
                    aria-label="Page filter"
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
                    aria-label="Platform filter"
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
                        ? `Last synced ${
                              formatElapsed(
                                  overview.sync.lastSyncedAt,
                                  now
                              ) || 'recently'
                          }`
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
                    <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-5">
                        <h2 className="mb-4 text-sm font-bold text-white">
                            Facebook vs Instagram
                        </h2>
                        <div className="grid gap-3 sm:grid-cols-2">
                            {[
                                {
                                    label: 'Facebook',
                                    dot: 'bg-sky-400',
                                    summary: overview.byPlatform.facebook,
                                },
                                {
                                    label: 'Instagram',
                                    dot: 'bg-pink-400',
                                    summary: overview.byPlatform.instagram,
                                },
                            ].map((platform) => (
                                <div
                                    key={platform.label}
                                    className="rounded-2xl border border-white/5 bg-slate-950/40 p-4"
                                >
                                    <div className="flex items-center gap-2">
                                        <span
                                            className={`h-2 w-2 rounded-full ${platform.dot}`}
                                        />
                                        <span className="text-xs font-bold text-white">
                                            {platform.label}
                                        </span>
                                    </div>
                                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                                        <div>
                                            <span className="text-slate-500">
                                                Posts
                                            </span>
                                            <div className="font-bold text-white">
                                                {formatNumber(
                                                    platform.summary.posts
                                                )}
                                            </div>
                                        </div>
                                        <div>
                                            <span className="text-slate-500">
                                                Reach
                                            </span>
                                            <div className="font-bold text-white">
                                                {formatNumber(
                                                    platform.summary.reach
                                                )}
                                            </div>
                                        </div>
                                        <div>
                                            <span className="text-slate-500">
                                                Interactions
                                            </span>
                                            <div className="font-bold text-white">
                                                {formatNumber(
                                                    platform.summary.interactions
                                                )}
                                            </div>
                                        </div>
                                        <div>
                                            <span className="text-slate-500">
                                                Rate
                                            </span>
                                            <div className="font-bold text-emerald-300">
                                                {formatMetric(
                                                    platform.summary
                                                        .engagementRate,
                                                    '%'
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
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
                    <AnalyticsTips tips={tips?.ruleBased || []} />
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
                            disabled={loadingMore}
                            className="w-full rounded-xl border border-white/10 bg-slate-900/40 px-4 py-3 text-sm font-bold text-slate-300 disabled:opacity-50"
                        >
                            {loadingMore ? 'Loading...' : 'Load more'}
                        </button>
                    ) : null}
                </div>
            ) : tab === 'overview' ? (
                <div className="rounded-3xl border border-dashed border-white/10 bg-slate-900/30 p-12 text-center text-sm text-slate-400">
                    Could not load the overview. Use Refresh insights to try
                    again.
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
                        setSelectedDay(null);
                        if (next === trackerMonth) return;
                        setTrackerLoading(true);
                        setTrackerPosts([]);
                        setTrackerMonth(next);
                    }}
                    loading={trackerLoading}
                    now={now}
                    connection={selectedConnection}
                />
            ) : (
                <div className="space-y-6">
                    <AnalyticsTips tips={tips?.ruleBased || []} />
                    <AnalyticsAiTips
                        ai={tips?.ai || null}
                        onGenerate={generateAi}
                        loading={aiLoading}
                        error={aiError}
                        notConfigured={aiNotConfigured}
                    />
                </div>
            )}
        </AppShell>
    );
}
