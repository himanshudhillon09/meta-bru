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
import { AnalyticsStories, StorySummaryCard } from '@/components/AnalyticsStories';
import { StoryShareNotice, useStoryShare } from '@/components/ShareStory';
import { AnalyticsTipCard } from '@/components/AnalyticsTipCard';
import { AnalyticsAiTips } from '@/components/AnalyticsAiTips';
import { BestTimes } from '@/components/analytics/BestTimes';
import { FormatCompare, PlatformCompare } from '@/components/analytics/Comparisons';
import { changeBetween, formatCount, formatPercent, periodLabel } from '@/components/analytics/format';
import { KpiTile } from '@/components/analytics/KpiTiles';
import { PageBreakdown } from '@/components/analytics/PageBreakdown';
import { TopPosts } from '@/components/analytics/TopPosts';
import { TrendChart } from '@/components/analytics/TrendChart';
import { AnalyticsMonitor } from '@/components/AnalyticsMonitor';
import { AnalyticsTips } from '@/components/AnalyticsTips';
import { PostTrackerCalendar } from '@/components/PostTrackerCalendar';
import { Tabs } from '@/components/Tabs';
import { useAuth } from '@/context/AuthContext';
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
    type StoryAnalyticsResponse,
} from '@/lib/types';

type TabKey = 'overview' | 'monitor' | 'tracker' | 'stories' | 'ai';
type RangeKey = '7' | '30' | '60' | '90' | 'custom';

const TABS: Array<{ key: TabKey; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'monitor', label: 'Live monitor' },
    { key: 'tracker', label: 'Post tracker' },
    { key: 'stories', label: 'Stories' },
    { key: 'ai', label: 'AI analysis' },
];

const CONTENT_TYPES = [
    { key: 'all', label: 'All' },
    { key: 'image', label: 'Posts' },
    { key: 'reel', label: 'Reels' },
] as const;

type ContentKey = (typeof CONTENT_TYPES)[number]['key'];

const RANGES: Array<{ key: RangeKey; label: string }> = [
    { key: '7', label: '7 days' },
    { key: '30', label: '30 days' },
    { key: '60', label: '60 days' },
    { key: '90', label: '90 days' },
    { key: 'custom', label: 'Custom' },
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

const RECONNECT_HREF = '/connections?returnTo=/analytics';

/** True when an ISO time falls on today's date in IST. */
function isTodayIst(value: string | null | undefined): boolean {
    if (!value) return false;
    const day = (date: Date) =>
        new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date);
    return day(new Date(value)) === day(new Date());
}

function syncNotice(
    result: {
        synced?: number;
        failed?: number;
        skipped?: number;
        remaining?: number;
        removed?: { postsDeleted?: number; copiesDropped?: number; mediaDeleted?: number };
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
    // Posts deleted on Facebook or Instagram are flushed during the refresh.
    const postsDeleted = Number(result.removed?.postsDeleted) || 0;
    const copiesDropped = Number(result.removed?.copiesDropped) || 0;
    const mediaDeleted = Number(result.removed?.mediaDeleted) || 0;
    if (postsDeleted > 0) {
        parts.push(
            `Removed ${postsDeleted} post${postsDeleted === 1 ? '' : 's'} you deleted on Facebook or Instagram` +
                (mediaDeleted > 0
                    ? `, with ${mediaDeleted} Cloudinary file${mediaDeleted === 1 ? '' : 's'}`
                    : '')
        );
    }
    if (copiesDropped > 0) {
        parts.push(
            `Dropped ${copiesDropped} platform cop${copiesDropped === 1 ? 'y' : 'ies'} you deleted; the other platform is kept`
        );
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
    const { user } = useAuth();
    const [tab, setTab] = useState<TabKey>('overview');
    const [range, setRange] = useState<RangeKey>('30');
    const [customFrom, setCustomFrom] = useState(daysAgoKey(29));
    const [customTo, setCustomTo] = useState(istTodayKey());
    const [connectionId, setConnectionId] = useState('');
    const [platform, setPlatform] = useState('');
    const [contentType, setContentType] = useState<ContentKey>('all');
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
    const [storyData, setStoryData] = useState<StoryAnalyticsResponse | null>(null);
    const [storiesLoading, setStoriesLoading] = useState(false);
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
    const dailyRunRef = useRef(false);

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
            ...(contentType !== 'all' ? { mediaType: contentType } : {}),
        };
    }, [range, customFrom, customTo, connectionId, platform, contentType]);

    useEffect(() => {
        setAiError('');
        setMonitor(null);
        setTrackerPosts([]);
        setStoryData(null);
        setNotice('');
    }, [params]);

    // A Story shared from a post card updates that post's Story state in place.
    const story = useStoryShare((updated) => {
        const storyTargets = (updated.storyTargets ?? []).map((target) => ({
            platform: target.platform,
            status: target.status,
            error: target.error,
        }));
        const apply = (list: AnalyticsPost[]) =>
            list.map((item) => (item.postId === updated._id ? { ...item, storyTargets } : item));
        setPosts(apply);
        setTrackerPosts(apply);
    });

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
                ...(contentType !== 'all' ? { mediaType: contentType } : {}),
                page: '1',
                limit: '100',
            });
            setTrackerPosts(data.posts);
        } catch {
            setError('Could not load the post tracker.');
        } finally {
            setTrackerLoading(false);
        }
    }, [trackerMonth, connectionId, platform, contentType]);

    useEffect(() => {
        if (tab === 'tracker') void loadTracker();
    }, [tab, loadTracker]);

    const loadStories = useCallback(async () => {
        setStoriesLoading(true);
        try {
            const data = await analyticsApi.stories(params);
            setStoryData(data);
        } catch (err) {
            setError(typeof err === 'string' ? err : 'Could not load Story insights');
        } finally {
            setStoriesLoading(false);
        }
    }, [params]);

    useEffect(() => {
        if (tab === 'stories') void loadStories();
    }, [tab, loadStories]);

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
                } else if (tab === 'stories') {
                    await loadStories();
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
        [params, tab, loadMonitor, loadTracker, loadConnections, loadStories, loadAll]
    );


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

    // AI analysis runs only when the user presses the button, and always asks
    // the AI again.
    const generateAi = useCallback(
        async () => {
            setAiLoading(true);
            setAiError('');
            try {
                const result: any = await analyticsApi.generateTips({
                    ...params,
                    force: true,
                });
                if (!result?.insight) {
                    throw new Error('AI analysis returned no tips.');
                }
                setTips((current) => ({
                    ruleBased: current?.ruleBased || [],
                    ai: {
                        cached: Boolean(result.cached),
                        ...result.insight,
                    },
                    aiDueToday: false,
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
        },
        [params]
    );

    // Analytics reads Meta by itself at most once a day: on the first visit of
    // the day, for the first view shown. Anything later happens only from
    // Refresh insights. AI analysis never runs by itself; only its button runs
    // it. A reconnected Page is read again right away so its insights do not
    // wait for tomorrow.
    useEffect(() => {
        if (dailyRunRef.current || loading || !overview) return;
        if (overviewKey !== JSON.stringify(params)) return;
        dailyRunRef.current = true;
        if (overview.totals.posts === 0) return;

        const needsRefresh =
            !isTodayIst(overview.sync.lastSyncedAt) ||
            (overview.sync.reconnectPending ?? 0) > 0;
        void (async () => {
            if (needsRefresh) await refresh(true);
        })();
    }, [loading, overview, overviewKey, params, refresh]);

    const aiNotConfigured = /(gemini|claude) api key is not configured/i.test(aiError);
    const aiProviderLabel = user?.aiProvider === 'claude' ? 'Claude' : 'Gemini';
    const previousLabel = overview?.previous
        ? periodLabel(overview.previous.range.from, overview.previous.range.to)
        : undefined;
    const weekly =
        overview !== null &&
        Date.parse(`${overview.range.to}T00:00:00Z`) - Date.parse(`${overview.range.from}T00:00:00Z`) >
            60 * 86_400_000;
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
            subtitle="How your Pages, posts, reels, and Stories are growing, and what to post next. Times are IST."
            actions={
                <div className="flex flex-col items-start gap-1 sm:items-end">
                    <button
                        onClick={() => void refresh()}
                        disabled={syncing}
                        className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-indigo-500 disabled:opacity-50"
                    >
                        {syncing ? (
                            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        ) : null}
                        {syncing ? 'Refreshing...' : 'Refresh insights'}
                    </button>
                    <span className="text-[11px] text-subtle">
                        {overview?.sync.lastSyncedAt
                            ? `Updated ${formatElapsed(overview.sync.lastSyncedAt, now) || 'recently'}`
                            : 'Not updated yet'}{' '}
                        · refreshes by itself once a day
                    </span>
                </div>
            }
        >
            {notice ? (
                <div className="animate-fade-up mb-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
                    {notice}
                </div>
            ) : null}
            <StoryShareNotice outcome={story.outcome} onDismiss={story.clearOutcome} />
            {error ? (
                <div className="animate-fade-up mb-5 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                    {error}
                </div>
            ) : null}
            {reconnectPages.length > 0 ? (
                <div className="animate-fade-up mb-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-200">
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
                        className="animate-fade-up mb-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-200"
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
                        <details className="mt-2 text-xs text-amber-700/80 dark:text-amber-100/80">
                            <summary className="cursor-pointer font-bold text-amber-700 dark:text-amber-200">
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

            <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-2 shadow-card">
                <Tabs
                    label="Date range"
                    variant="segmented"
                    items={RANGES}
                    value={range}
                    onChange={setRange}
                />
                {range === 'custom' ? (
                    <div className="flex items-center gap-1.5">
                        <input
                            type="date"
                            aria-label="From date"
                            value={customFrom}
                            onChange={(event) => setCustomFrom(event.target.value)}
                            className="rounded-xl border border-line-strong bg-surface-2 px-3 py-2 text-xs text-fg"
                        />
                        <span className="text-xs text-subtle">to</span>
                        <input
                            type="date"
                            aria-label="To date"
                            value={customTo}
                            onChange={(event) => setCustomTo(event.target.value)}
                            className="rounded-xl border border-line-strong bg-surface-2 px-3 py-2 text-xs text-fg"
                        />
                    </div>
                ) : null}
                <Tabs
                    label="Content type"
                    variant="segmented"
                    items={CONTENT_TYPES}
                    value={contentType}
                    onChange={setContentType}
                />
                <select
                    aria-label="Page filter"
                    value={connectionId}
                    onChange={(event) => setConnectionId(event.target.value)}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                        connectionId
                            ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                            : 'border-line-strong bg-surface-2 text-fg'
                    }`}
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
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                        platform
                            ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                            : 'border-line-strong bg-surface-2 text-fg'
                    }`}
                >
                    <option value="">Facebook + Instagram</option>
                    <option value="facebook">Facebook only</option>
                    <option value="instagram">Instagram only</option>
                </select>
                {connectionId || platform || contentType !== 'all' ? (
                    <button
                        type="button"
                        onClick={() => {
                            setConnectionId('');
                            setPlatform('');
                            setContentType('all');
                        }}
                        className="rounded-xl px-3 py-2 text-xs font-bold text-subtle hover:bg-hover hover:text-fg"
                    >
                        Clear filters
                    </button>
                ) : null}
            </div>

            <Tabs
                label="Analytics view"
                items={TABS}
                value={tab}
                onChange={setTab}
                className="mb-6"
            />

            <div key={tab} className="animate-fade-in">
            {loading && !overview ? (
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                        {Array.from({ length: 5 }, (_, index) => (
                            <div key={index} className="skeleton h-32 rounded-2xl" />
                        ))}
                    </div>
                    <div className="skeleton h-80 rounded-2xl" />
                </div>
            ) : tab === 'overview' && overview ? (
                <div
                    key="overview"
                    className={`space-y-5 transition-opacity duration-300 ${loading ? 'pointer-events-none opacity-50' : ''}`}
                    aria-busy={loading}
                >
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                        <KpiTile
                            label={contentType === 'reel' ? 'Reels published' : 'Posts published'}
                            value={formatCount(overview.totals.posts)}
                            hint={
                                contentType === 'all' && overview.totals.reels
                                    ? `including ${formatCount(overview.totals.reels)} reel${overview.totals.reels === 1 ? '' : 's'}`
                                    : undefined
                            }
                            change={changeBetween(overview.totals.posts, overview.previous?.totals.posts)}
                            changeLabel={previousLabel}
                            trend={overview.activity.map((bucket) => ({ date: bucket.date, value: bucket.posts }))}
                            trendUnit="posts"
                        />
                        <KpiTile
                            label="Reach"
                            value={formatCount(overview.totals.reach)}
                            hint="people who saw your posts"
                            change={changeBetween(overview.totals.reach, overview.previous?.totals.reach)}
                            changeLabel={previousLabel}
                            trend={overview.activity.map((bucket) => ({ date: bucket.date, value: bucket.reach }))}
                            trendUnit="reach"
                        />
                        <KpiTile
                            label={contentType === 'reel' ? 'Plays' : 'Views'}
                            value={formatCount(overview.totals.views)}
                            hint="times your posts were seen"
                            change={changeBetween(overview.totals.views, overview.previous?.totals.views)}
                            changeLabel={previousLabel}
                            trend={overview.activity.map((bucket) => ({ date: bucket.date, value: bucket.views ?? 0 }))}
                            trendUnit="views"
                        />
                        <KpiTile
                            label="Interactions"
                            value={formatCount(overview.totals.interactions)}
                            hint="likes, comments, shares, saves"
                            change={changeBetween(overview.totals.interactions, overview.previous?.totals.interactions)}
                            changeLabel={previousLabel}
                            trend={overview.activity.map((bucket) => ({ date: bucket.date, value: bucket.interactions }))}
                            trendUnit="interactions"
                        />
                        <KpiTile
                            label="Engagement rate"
                            value={formatPercent(overview.totals.engagementRate)}
                            hint="interactions per person reached"
                            change={changeBetween(
                                overview.totals.engagementRate,
                                overview.previous?.totals.engagementRate,
                                'rate'
                            )}
                            changeLabel={previousLabel}
                        />
                    </div>

                    {overview.totals.posts === 0 ? (
                        <div className="rounded-2xl border border-dashed border-line-strong bg-surface p-10 text-center text-sm text-muted">
                            Nothing was published in this range{connectionId || platform || contentType !== 'all' ? ' with these filters' : ''}.{' '}
                            <Link
                                href={contentType === 'reel' ? '/reels' : '/composer'}
                                className="font-bold text-indigo-700 dark:text-indigo-300"
                            >
                                {contentType === 'reel' ? 'Make a reel' : 'Create a post'}
                            </Link>{' '}
                            or pick a wider range.
                        </div>
                    ) : (
                        <>
                            <TrendChart activity={overview.activity} weekly={weekly} />

                            {overview.topPosts ? <TopPosts topPosts={overview.topPosts} /> : null}

                            {!connectionId && overview.byPage && connections.length > 1 ? (
                                <PageBreakdown
                                    byPage={overview.byPage}
                                    connections={connections}
                                    onSelectPage={(id) => {
                                        setConnectionId(id);
                                        window.scrollTo({ top: 0, behavior: 'smooth' });
                                    }}
                                />
                            ) : null}

                            <div className="grid gap-5 lg:grid-cols-2">
                                {!platform ? (
                                    <PlatformCompare
                                        facebook={overview.byPlatform.facebook}
                                        instagram={overview.byPlatform.instagram}
                                    />
                                ) : null}
                                {contentType === 'all' && overview.byContentType ? (
                                    <FormatCompare
                                        image={overview.byContentType.image}
                                        reel={overview.byContentType.reel}
                                    />
                                ) : null}
                            </div>

                            <BestTimes buckets={overview.bestTimes} />
                        </>
                    )}

                    <div className="grid gap-5 lg:grid-cols-2">
                        {overview.stories ? (
                            <StorySummaryCard
                                summary={overview.stories}
                                onOpen={() => setTab('stories')}
                            />
                        ) : null}
                        <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
                            <div className="mb-3 flex flex-wrap items-center gap-2">
                                <h2 className="text-sm font-bold text-fg">AI analysis</h2>
                                <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-indigo-700 dark:text-indigo-300">
                                    {aiProviderLabel}
                                </span>
                                <button
                                    onClick={() => setTab('ai')}
                                    className="ml-auto text-xs font-bold text-indigo-700 dark:text-indigo-300"
                                >
                                    Open →
                                </button>
                            </div>
                            {tips?.ai ? (
                                <div>
                                    <p className="text-[11px] text-subtle">
                                        From {formatIstDateTime(tips.ai.generatedAt)}
                                    </p>
                                    <div className="mt-2 grid gap-3">
                                        {tips.ai.tips.slice(0, 2).map((tip, index) => (
                                            <AnalyticsTipCard
                                                key={`${tip.title}-${index}`}
                                                tip={tip}
                                            />
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="rounded-xl border border-dashed border-line-strong p-5 text-center">
                                    <p className="text-xs text-muted">
                                        Get a ranked plan from your numbers: when to post, reels or
                                        images, and ideas to make next. It runs only when you ask.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setTab('ai');
                                            void generateAi();
                                        }}
                                        disabled={aiLoading}
                                        className="mt-3 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-60"
                                    >
                                        {aiLoading ? 'Analyzing...' : 'Run AI analysis'}
                                    </button>
                                </div>
                            )}
                        </section>
                    </div>

                    <AnalyticsTips tips={tips?.ruleBased || []} />

                    <section>
                        <div className="mb-3 flex items-baseline justify-between gap-3">
                            <h2 className="text-sm font-bold text-fg">All published posts</h2>
                            <span className="text-xs text-subtle">Newest first</span>
                        </div>
                        {posts.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-line-strong bg-surface p-10 text-center text-sm text-muted">
                                No published {contentType === 'reel' ? 'reels' : 'posts'} in this range.
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {posts.map((post) => (
                                    <AnalyticsPostCard
                                        key={post.postId}
                                        post={post}
                                        now={now}
                                        onShareStory={story.open}
                                        sharing={story.sharingId === post.postId}
                                    />
                                ))}
                            </div>
                        )}
                        {hasMore ? (
                            <button
                                onClick={loadMore}
                                disabled={loadingMore}
                                className="mt-4 w-full rounded-xl border border-line-strong bg-surface px-4 py-3 text-sm font-bold text-fg-2 hover:bg-hover disabled:opacity-50"
                            >
                                {loadingMore ? 'Loading...' : 'Load more posts'}
                            </button>
                        ) : null}
                    </section>
                </div>
            ) : tab === 'overview' ? (
                <div className="animate-fade-up rounded-2xl border border-dashed border-line-strong bg-surface p-12 text-center text-sm text-muted">
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
                    <div className="animate-fade-up rounded-2xl border border-dashed border-line-strong bg-surface p-12 text-center text-sm text-muted">
                        {monitorLoading
                            ? 'Loading live monitor...'
                            : 'Turn on the live monitor to build engagement history.'}
                    </div>
                )
            ) : tab === 'stories' ? (
                <AnalyticsStories data={storyData} loading={storiesLoading} now={now} />
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
                        onGenerate={() => void generateAi()}
                        loading={aiLoading}
                        error={aiError}
                        notConfigured={aiNotConfigured}
                    />
                </div>
            )}
            </div>
            {story.modal}
        </AppShell>
    );
}
