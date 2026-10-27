# Post Analytics Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Analytics tab UI: overview, live monitor, post tracker calendar, AI tips, and IST publish times in Queue.

**Architecture:** The page loads cached analytics from the backend, renders lightweight SVG/CSS charts, and only calls `POST /api/analytics/sync` from explicit refresh or the 5-minute live timer. No chart dependency is added.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS 4.

**Spec:** `docs/superpowers/specs/2026-10-24-post-analytics-design.md`

---

## Task 9: Types, IST helpers, and API client

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/apiClient.ts`

- [ ] **Step 1: Add analytics types and helpers**

Append to `types.ts`:

```ts
export interface AnalyticsMetrics {
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
    reach: number | null;
    views: number | null;
    clicks: number | null;
    interactions: number | null;
    engagementRate: number | null;
}

export interface AnalyticsSummary {
    posts: number;
    facebookPosts: number;
    instagramPosts: number;
    reach: number;
    views: number;
    interactions: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    clicks: number;
    engagementRate: number | null;
}

export interface AnalyticsActivityBucket {
    date: string;
    label: string;
    posts: number;
    facebook: number;
    instagram: number;
    reach: number;
    interactions: number;
}

export interface AnalyticsBestTime {
    day: number;
    dayLabel: string;
    block: number;
    label: string;
    posts: number;
    avgEngagementRate: number | null;
}

export interface AnalyticsPermissionError {
    connectionId: string;
    pageName: string;
    platform: Platform;
}

export interface AnalyticsSyncState {
    lastSyncedAt: string | null;
    staleTargets: number;
    remainingTargets?: number;
    nextSyncAt?: string;
    permissionErrors: AnalyticsPermissionError[];
}

export interface AnalyticsOverview {
    range: { from: string; to: string; preset: string; timezone: string };
    totals: AnalyticsSummary;
    byPlatform: { facebook: AnalyticsSummary; instagram: AnalyticsSummary };
    activity: AnalyticsActivityBucket[];
    bestTimes: AnalyticsBestTime[];
    sync: AnalyticsSyncState;
}

export interface AnalyticsMonitorPoint {
    capturedAt: string;
    reach: number;
    views: number;
    interactions: number;
    engagementRate: number | null;
}

export interface AnalyticsMonitor {
    scope: { connectionId: string | null; pageName: string };
    summary: AnalyticsSummary;
    series: {
        all: AnalyticsMonitorPoint[];
        facebook: AnalyticsMonitorPoint[];
        instagram: AnalyticsMonitorPoint[];
    };
    seriesTruncated: boolean;
    recentPosts: Array<{
        postId: string;
        caption: string;
        mediaUrl: string;
        pageName: string;
        platform: Platform;
        publishedAt: string;
        metrics: AnalyticsMetrics | null;
    }>;
    sync: AnalyticsSyncState;
}

export interface AnalyticsPostTarget {
    platform: Platform;
    externalId: string;
    publishedAt: string;
    metrics: AnalyticsMetrics | null;
    availableMetrics: string[];
    snapshotAt: string | null;
    status: 'ok' | 'partial' | 'unavailable' | 'permission_error';
    error: string;
}

export interface AnalyticsPost {
    postId: string;
    caption: string;
    mediaUrl: string;
    status: PostStatus;
    connection: {
        id: string;
        pageId: string;
        pageName: string;
        instagramUsername: string;
    };
    targets: AnalyticsPostTarget[];
}

export interface AnalyticsPostsResponse {
    posts: AnalyticsPost[];
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
}

export interface AnalyticsRuleTip {
    id: string;
    title: string;
    body: string;
    severity: 'info' | 'success' | 'warning';
    actionLabel: string;
    actionHref: string;
}

export interface AnalyticsAiTip {
    title: string;
    body: string;
    severity: 'info' | 'success' | 'warning';
    actionLabel: string;
    actionHref: string;
}

export interface AnalyticsAiInsight {
    cached: boolean;
    generatedAt: string;
    expiresAt: string;
    model: string;
    tips: AnalyticsAiTip[];
}

export interface AnalyticsTipsResponse {
    ruleBased: AnalyticsRuleTip[];
    ai: AnalyticsAiInsight | null;
}

export function formatIstDateTime(value: string | null | undefined): string {
    if (!value) return 'Not published';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not published';
    const formatted = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).format(date);
    return `${formatted} IST`;
}

export function formatElapsed(
    value: string | null | undefined,
    now = Date.now()
): string {
    if (!value) return '';
    const then = new Date(value).getTime();
    if (Number.isNaN(then)) return '';
    const seconds = Math.max(0, Math.floor((now - then) / 1000));
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ${hours % 24}h ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
}

export function latestPublishedAt(post: Post): string | null {
    const times = post.targets
        .filter((target) => target.status === 'published' && target.publishedAt)
        .map((target) => new Date(target.publishedAt as string).getTime())
        .filter((time) => Number.isFinite(time));
    if (times.length > 0) return new Date(Math.max(...times)).toISOString();
    return post.publishedAt;
}
```

- [ ] **Step 2: Add the API client**

In `apiClient.ts`, extend the type import:

```ts
import type {
    AnalyticsMonitor,
    AnalyticsOverview,
    AnalyticsPostsResponse,
    AnalyticsTipsResponse,
    DeleteMediaResult,
    StorageOverview,
} from './types';
```

Append:

```ts
export const analyticsApi = {
    overview: (params: Record<string, string>) =>
        api.get<{ success: boolean } & AnalyticsOverview>('/analytics/overview', params),
    monitor: (params: Record<string, string>) =>
        api.get<{ success: boolean } & AnalyticsMonitor>('/analytics/monitor', params),
    posts: (params: Record<string, string>) =>
        api.get<{ success: boolean } & AnalyticsPostsResponse>('/analytics/posts', params),
    sync: (data: {
        from: string;
        to: string;
        mode: 'stale' | 'live';
        connectionId?: string;
        platform?: string;
    }) => api.post('/analytics/sync', data),
    tips: (params: Record<string, string>) =>
        api.get<{ success: boolean } & AnalyticsTipsResponse>('/analytics/tips', params),
    generateTips: (data: {
        from: string;
        to: string;
        connectionId?: string;
        platform?: string;
    }) => api.post('/analytics/tips', data),
};
```

- [ ] **Step 3: Verify TypeScript**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/apiClient.ts
git commit -m "feat: add analytics types and API client"
```

---

## Task 10: Chart components

**Files:**
- Create: `frontend/src/components/AnalyticsCharts.tsx`

- [ ] **Step 1: Implement the chart components**

```tsx
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
            <div className={`mt-2 text-2xl font-black ${tones[tone]}`}>{value}</div>
            {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
        </div>
    );
}

export function AnalyticsBarChart({
    data,
    height = 180,
    valueLabel = 'posts',
}: {
    data: Array<{ label: string; value: number; secondary?: number }>;
    height?: number;
    valueLabel?: string;
}) {
    const max = Math.max(1, ...data.map((item) => Math.max(item.value, item.secondary || 0)));
    return (
        <div className="w-full">
            <div className="flex items-end gap-1 overflow-x-auto pb-2" style={{ height }}>
                {data.map((item) => (
                    <div key={item.label} className="flex min-w-3 flex-1 flex-col items-center justify-end gap-1">
                        <div className="relative flex h-full w-full items-end justify-center gap-0.5">
                            <div
                                className="w-2 rounded-t bg-indigo-500/80"
                                style={{ height: `${(item.value / max) * 100}%` }}
                                title={`${item.label}: ${item.value} ${valueLabel}`}
                            />
                            {item.secondary !== undefined ? (
                                <div
                                    className="w-2 rounded-t bg-emerald-500/70"
                                    style={{ height: `${(item.secondary / max) * 100}%` }}
                                    title={`${item.label}: ${item.secondary}`}
                                />
                            ) : null}
                        </div>
                        <span className="text-[9px] text-slate-600">{item.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export function AnalyticsLineChart({
    points,
    height = 180,
    color = '#818cf8',
}: {
    points: Array<{ label: string; value: number }>;
    height?: number;
    color?: string;
}) {
    if (points.length === 0) {
        return <div className="py-16 text-center text-sm text-slate-500">No history yet.</div>;
    }
    if (points.length === 1) {
        return (
            <div className="py-16 text-center text-sm text-slate-500">
                One data point captured. Keep the monitor open to build history.
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
    return (
        <svg viewBox={`0 0 ${width} ${height}`} className="h-48 w-full" role="img" aria-label="Engagement over time">
            <path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" />
            <path
                d={`${path} L ${width} ${height} L 0 ${height} Z`}
                fill={color}
                opacity="0.08"
            />
        </svg>
    );
}

export function AnalyticsHeatmap({ buckets }: { buckets: AnalyticsBestTime[] }) {
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
                    {['00', '03', '06', '09', '12', '15', '18', '21'].map((hour) => (
                        <div key={hour} className="text-center text-[9px] text-slate-600">
                            {hour}
                        </div>
                    ))}
                </div>
                {days.map((day, dayIndex) => (
                    <div key={day} className="mb-1 grid grid-cols-[44px_repeat(8,1fr)] gap-1">
                        <div className="text-[10px] font-bold text-slate-500">{day}</div>
                        {Array.from({ length: 8 }, (_, block) => {
                            const bucket = buckets.find(
                                (item) => item.day === dayIndex + 1 && item.block === block
                            );
                            const rate = bucket?.avgEngagementRate;
                            const opacity = rate ? 0.15 + (rate / max) * 0.75 : 0.04;
                            return (
                                <div
                                    key={block}
                                    title={
                                        bucket
                                            ? `${day} ${bucket.label}: ${bucket.posts} posts${rate ? `, ${rate}% avg` : ''}`
                                            : ''
                                    }
                                    className="h-7 rounded-md border border-white/5"
                                    style={{ backgroundColor: `rgba(129, 140, 248, ${opacity})` }}
                                />
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/AnalyticsCharts.tsx
git commit -m "feat: add analytics chart components"
```

---

## Task 11: Post card and overview page

**Files:**
- Create: `frontend/src/components/AnalyticsPostCard.tsx`
- Create: `frontend/src/app/analytics/page.tsx`

- [ ] **Step 1: Implement the post card**

```tsx
'use client';

import React from 'react';
import Link from 'next/link';
import {
    formatElapsed,
    formatIstDateTime,
    type AnalyticsPost,
    type AnalyticsPostTarget,
} from '@/lib/types';

function metricValue(value: number | null, suffix = ''): string {
    return value === null ? '—' : `${value}${suffix}`;
}

function TargetMetrics({ target }: { target: AnalyticsPostTarget }) {
    const metrics = target.metrics;
    return (
        <div className="rounded-xl border border-white/5 bg-slate-950/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-300">
                    {target.platform}
                </span>
                <span className="text-[11px] text-slate-500">
                    {formatIstDateTime(target.publishedAt)}
                </span>
                <span className="text-[11px] text-slate-600">
                    {formatElapsed(target.publishedAt)}
                </span>
            </div>
            {target.status === 'permission_error' ? (
                <div className="mt-2 text-xs text-amber-300">
                    <Link href="/connections" className="underline">
                        Reconnect for insights
                    </Link>
                </div>
            ) : !metrics ? (
                <div className="mt-2 text-xs text-slate-500">Meta has not reported insights yet.</div>
            ) : (
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs sm:grid-cols-6">
                    <div><span className="text-slate-500">Reach</span><div className="font-bold text-white">{metricValue(metrics.reach)}</div></div>
                    <div><span className="text-slate-500">Views</span><div className="font-bold text-white">{metricValue(metrics.views)}</div></div>
                    <div><span className="text-slate-500">Likes</span><div className="font-bold text-white">{metricValue(metrics.likes)}</div></div>
                    <div><span className="text-slate-500">Comments</span><div className="font-bold text-white">{metricValue(metrics.comments)}</div></div>
                    <div><span className="text-slate-500">Shares</span><div className="font-bold text-white">{metricValue(metrics.shares)}</div></div>
                    <div><span className="text-slate-500">Rate</span><div className="font-bold text-emerald-300">{metricValue(metrics.engagementRate, '%')}</div></div>
                </div>
            )}
        </div>
    );
}

export function AnalyticsPostCard({ post }: { post: AnalyticsPost }) {
    return (
        <article className="rounded-3xl border border-white/5 bg-slate-900/40 p-5 shadow-xl">
            <div className="flex flex-col gap-4 sm:flex-row">
                <div className="h-40 w-full overflow-hidden rounded-2xl border border-white/5 bg-slate-800 sm:h-28 sm:w-28 sm:shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={post.mediaUrl} alt="" className="h-full w-full object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-white">{post.connection.pageName}</span>
                        <span className="text-[10px] uppercase tracking-widest text-slate-500">
                            {post.status}
                        </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-slate-300">{post.caption}</p>
                    <div className="mt-3 space-y-2">
                        {post.targets.map((target) => (
                            <TargetMetrics key={target.platform} target={target} />
                        ))}
                    </div>
                </div>
            </div>
        </article>
    );
}
```

- [ ] **Step 2: Implement the page shell and Overview**

Create `frontend/src/app/analytics/page.tsx` with:

```tsx
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { AnalyticsPostCard } from '@/components/AnalyticsPostCard';
import {
    AnalyticsBarChart,
    AnalyticsHeatmap,
    MetricCard,
} from '@/components/AnalyticsCharts';
import { analyticsApi, connectionsApi } from '@/lib/apiClient';
import {
    formatElapsed,
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
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function daysAgoKey(days: number): string {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - days);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date);
}

function rangeFor(preset: RangeKey, customFrom: string, customTo: string) {
    if (preset === 'custom') return { from: customFrom, to: customTo };
    return { from: daysAgoKey(Number(preset) - 1), to: istTodayKey() };
}

function formatMetric(value: number | null, suffix = ''): string {
    return value === null ? '—' : `${value}${suffix}`;
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
    const [posts, setPosts] = useState<AnalyticsPost[]>([]);
    const [tips, setTips] = useState<AnalyticsTipsResponse | null>(null);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [now, setNow] = useState(Date.now());
    const syncingRef = useRef(false);

    useEffect(() => {
        const requested = new URLSearchParams(window.location.search).get('tab');
        if (TABS.some((item) => item.key === requested)) setTab(requested as TabKey);
        void connectionsApi.list().then((data: any) => setConnections(data.connections || []));
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

    const loadAll = useCallback(async (showSpinner = false) => {
        if (showSpinner) setLoading(true);
        setError('');
        try {
            const [overviewData, postsData, tipsData] = await Promise.all([
                analyticsApi.overview(params),
                analyticsApi.posts({ ...params, page: '1', limit: '25' }),
                analyticsApi.tips(params),
            ]);
            setOverview(overviewData);
            setPosts(postsData.posts);
            setPage(1);
            setHasMore(postsData.hasMore);
            setTips(tipsData);
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not load analytics');
        } finally {
            setLoading(false);
        }
    }, [params]);

    useEffect(() => {
        void loadAll(true);
    }, [loadAll]);

    const loadMore = async () => {
        const next = page + 1;
        const data = await analyticsApi.posts({ ...params, page: String(next), limit: '25' });
        setPosts((current) => [...current, ...data.posts]);
        setPage(next);
        setHasMore(data.hasMore);
    };

    const refresh = async () => {
        if (syncingRef.current) return;
        syncingRef.current = true;
        setSyncing(true);
        setNotice('');
        setError('');
        try {
            const result: any = await analyticsApi.sync({ ...params, mode: 'stale' });
            setNotice(
                result.synced
                    ? `Updated ${result.synced} insight${result.synced === 1 ? '' : 's'}.`
                    : 'Analytics are already up to date.'
            );
            await loadAll();
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not refresh insights');
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
            {notice ? <div className="mb-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{notice}</div> : null}
            {error ? <div className="mb-5 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div> : null}
            {reconnectCount > 0 ? (
                <div className="mb-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                    {reconnectCount} Page{reconnectCount === 1 ? '' : 's'} need reconnecting to load engagement insights.{' '}
                    <Link href="/connections" className="font-bold underline">Open connections</Link>
                </div>
            ) : null}

            <div className="mb-6 flex flex-wrap items-center gap-2">
                {(['7', '30', '60', '90'] as RangeKey[]).map((value) => (
                    <button key={value} onClick={() => setRange(value)} className={`rounded-xl border px-3 py-2 text-xs font-bold ${range === value ? 'border-indigo-500/20 bg-indigo-500/15 text-indigo-300' : 'border-white/5 bg-slate-900/40 text-slate-400'}`}>
                        {value} days
                    </button>
                ))}
                <button onClick={() => setRange('custom')} className={`rounded-xl border px-3 py-2 text-xs font-bold ${range === 'custom' ? 'border-indigo-500/20 bg-indigo-500/15 text-indigo-300' : 'border-white/5 bg-slate-900/40 text-slate-400'}`}>Custom</button>
                {range === 'custom' ? (
                    <>
                        <input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white" />
                        <input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white" />
                    </>
                ) : null}
                <select value={connectionId} onChange={(event) => setConnectionId(event.target.value)} className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white">
                    <option value="">All Pages</option>
                    {connections.map((connection) => <option key={connection._id} value={connection._id}>{connection.pageName}</option>)}
                </select>
                <select value={platform} onChange={(event) => setPlatform(event.target.value)} className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white">
                    <option value="">All platforms</option>
                    <option value="facebook">Facebook</option>
                    <option value="instagram">Instagram</option>
                </select>
                <span className="ml-auto text-xs text-slate-500">
                    {overview?.sync.lastSyncedAt ? `Last synced ${formatElapsed(overview.sync.lastSyncedAt, now)}` : 'Not synced yet'}
                </span>
            </div>

            <div className="mb-6 flex gap-2 overflow-x-auto">
                {TABS.map((item) => (
                    <button key={item.key} onClick={() => setTab(item.key)} className={`whitespace-nowrap rounded-xl border px-4 py-2.5 text-xs font-bold ${tab === item.key ? 'border-indigo-500/20 bg-indigo-500/15 text-indigo-300' : 'border-white/5 bg-slate-900/40 text-slate-400'}`}>
                        {item.label}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="flex justify-center py-24"><div className="h-10 w-10 animate-spin rounded-full border-t-2 border-indigo-500" /></div>
            ) : tab === 'overview' && overview ? (
                <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                        <MetricCard label="Published posts" value={String(overview.totals.posts)} />
                        <MetricCard label="Reach" value={String(overview.totals.reach)} tone="sky" />
                        <MetricCard label="Views" value={String(overview.totals.views)} tone="sky" />
                        <MetricCard label="Interactions" value={String(overview.totals.interactions)} tone="emerald" />
                        <MetricCard label="Engagement rate" value={formatMetric(overview.totals.engagementRate, '%')} tone="amber" />
                    </div>
                    <div className="grid gap-5 lg:grid-cols-2">
                        <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-5">
                            <h2 className="mb-4 text-sm font-bold text-white">Publishing activity</h2>
                            <AnalyticsBarChart data={overview.activity.map((item) => ({ label: item.label, value: item.posts, secondary: item.instagram }))} />
                        </section>
                        <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-5">
                            <h2 className="mb-4 text-sm font-bold text-white">Engagement by publish date</h2>
                            <AnalyticsBarChart data={overview.activity.map((item) => ({ label: item.label, value: item.interactions }))} valueLabel="interactions" />
                        </section>
                    </div>
                    <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-5">
                        <h2 className="mb-4 text-sm font-bold text-white">Best posting times (IST)</h2>
                        <AnalyticsHeatmap buckets={overview.bestTimes} />
                    </section>
                    {tips?.ruleBased.length ? (
                        <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-5">
                            <h2 className="mb-4 text-sm font-bold text-white">Engagement tips</h2>
                            <div className="grid gap-3 sm:grid-cols-2">
                                {tips.ruleBased.map((tip) => (
                                    <div key={tip.id} className="rounded-2xl border border-white/5 bg-slate-950/40 p-4">
                                        <div className="text-sm font-bold text-white">{tip.title}</div>
                                        <p className="mt-1 text-xs text-slate-400">{tip.body}</p>
                                        {tip.actionHref ? <Link href={tip.actionHref} className="mt-2 inline-block text-xs font-bold text-indigo-300">{tip.actionLabel || 'Open'}</Link> : null}
                                    </div>
                                ))}
                            </div>
                        </section>
                    ) : null}
                    <div className="space-y-4">
                        {posts.length === 0 ? (
                            <div className="rounded-3xl border border-dashed border-white/10 bg-slate-900/30 p-12 text-center text-sm text-slate-400">
                                No published posts in this range. <Link href="/composer" className="font-bold text-indigo-300">Create a post</Link>.
                            </div>
                        ) : posts.map((post) => <AnalyticsPostCard key={post.postId} post={post} />)}
                    </div>
                    {hasMore ? <button onClick={loadMore} className="w-full rounded-xl border border-white/10 bg-slate-900/40 px-4 py-3 text-sm font-bold text-slate-300">Load more</button> : null}
                </div>
            ) : tab === 'monitor' ? (
                <div className="rounded-3xl border border-dashed border-white/10 bg-slate-900/30 p-12 text-center text-sm text-slate-400">
                    Turn on the live monitor to build engagement history.
                </div>
            ) : tab === 'tracker' ? (
                <div className="rounded-3xl border border-dashed border-white/10 bg-slate-900/30 p-12 text-center text-sm text-slate-400">
                    Select a month to view published post dates and times.
                </div>
            ) : (
                <div className="rounded-3xl border border-dashed border-white/10 bg-slate-900/30 p-12 text-center text-sm text-slate-400">
                    Run an AI analysis to generate page, engagement, and timing tips.
                </div>
            )}
        </AppShell>
    );
}
```

- [ ] **Step 3: Verify TypeScript**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/AnalyticsPostCard.tsx frontend/src/app/analytics/page.tsx
git commit -m "feat: add analytics overview page"
```

## Task 12: Live engagement monitor

**Files:**
- Create: `frontend/src/components/AnalyticsMonitor.tsx`
- Modify: `frontend/src/app/analytics/page.tsx`

- [ ] **Step 1: Create the monitor component**

```tsx
'use client';

import React, { useState } from 'react';
import { AnalyticsLineChart, MetricCard } from './AnalyticsCharts';
import {
    formatElapsed,
    formatIstDateTime,
    type AnalyticsMonitor as AnalyticsMonitorData,
} from '@/lib/types';

function last<T>(values: T[]): T | undefined {
    return values[values.length - 1];
}

function number(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : value.toLocaleString('en-IN');
}

export function AnalyticsMonitor({
    data,
    live,
    onToggleLive,
    onRefresh,
    refreshing,
    now,
}: {
    data: AnalyticsMonitorData;
    live: boolean;
    onToggleLive: () => void;
    onRefresh: () => void;
    refreshing: boolean;
    now: number;
}) {
    const [seriesKey, setSeriesKey] = useState<
        'reach' | 'interactions' | 'engagementRate'
    >('reach');

    const points = data.series.all.map((point) => ({
        label: new Intl.DateTimeFormat('en-IN', {
            timeZone: 'Asia/Kolkata',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        }).format(new Date(point.capturedAt)),
        value:
            seriesKey === 'reach'
                ? point.reach
                : seriesKey === 'interactions'
                  ? point.interactions
                  : point.engagementRate ?? 0,
    }));

    const facebook = last(data.series.facebook);
    const instagram = last(data.series.instagram);
    const maxReach = Math.max(1, facebook?.reach ?? 0, instagram?.reach ?? 0);

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3 rounded-3xl border border-white/5 bg-slate-900/40 p-4">
                <div>
                    <div className="text-sm font-bold text-white">
                        {data.scope.pageName}
                    </div>
                    <div className="text-xs text-slate-500">
                        {data.sync.lastSyncedAt
                            ? `Last synced ${formatElapsed(data.sync.lastSyncedAt, now)}`
                            : 'Not synced yet'}
                    </div>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <span
                        className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${
                            live
                                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                                : 'border-white/10 bg-slate-950/40 text-slate-400'
                        }`}
                    >
                        {live ? 'Live' : 'Paused'}
                    </span>
                    <button
                        type="button"
                        onClick={onToggleLive}
                        className="rounded-xl border border-white/10 bg-slate-950/40 px-4 py-2 text-xs font-bold text-slate-300"
                    >
                        {live ? 'Pause live' : 'Go live'}
                    </button>
                    <button
                        type="button"
                        onClick={onRefresh}
                        disabled={refreshing}
                        className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                    >
                        {refreshing ? 'Refreshing...' : 'Refresh'}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <MetricCard label="Posts" value={String(data.summary.posts)} />
                <MetricCard label="Reach" value={number(data.summary.reach)} tone="sky" />
                <MetricCard label="Views" value={number(data.summary.views)} tone="sky" />
                <MetricCard
                    label="Interactions"
                    value={number(data.summary.interactions)}
                    tone="emerald"
                />
                <MetricCard
                    label="Engagement rate"
                    value={
                        data.summary.engagementRate === null
                            ? '—'
                            : `${data.summary.engagementRate}%`
                    }
                    tone="amber"
                />
            </div>

            <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-5">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-bold text-white">Engagement over time</h2>
                    <div className="ml-auto flex gap-1">
                        {(
                            [
                                ['reach', 'Reach'],
                                ['interactions', 'Interactions'],
                                ['engagementRate', 'Rate'],
                            ] as const
                        ).map(([key, label]) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setSeriesKey(key)}
                                className={`rounded-lg px-2.5 py-1.5 text-[10px] font-bold ${
                                    seriesKey === key
                                        ? 'bg-indigo-500/15 text-indigo-300'
                                        : 'text-slate-500'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
                <AnalyticsLineChart points={points} />
                <p className="mt-2 text-[11px] text-slate-500">
                    Meta insights can lag up to 48 hours. History builds while Live is on.
                </p>
                {data.seriesTruncated && (
                    <p className="mt-1 text-[11px] text-amber-300">
                        The chart shows the 100 most recent targets. Summary totals cover the full scope.
                    </p>
                )}
            </section>

            <div className="grid gap-5 lg:grid-cols-2">
                <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-5">
                    <h2 className="mb-4 text-sm font-bold text-white">Platform reach</h2>
                    <div className="space-y-4">
                        {[
                            ['Facebook', facebook?.reach ?? 0],
                            ['Instagram', instagram?.reach ?? 0],
                        ].map(([label, reach]) => (
                            <div key={String(label)}>
                                <div className="mb-1 flex justify-between text-xs">
                                    <span className="text-slate-400">{label}</span>
                                    <span className="font-bold text-white">
                                        {number(Number(reach))}
                                    </span>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-slate-950">
                                    <div
                                        className="h-full rounded-full bg-indigo-500"
                                        style={{
                                            width: `${(Number(reach) / maxReach) * 100}%`,
                                        }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-5">
                    <h2 className="mb-4 text-sm font-bold text-white">Recent posts</h2>
                    <div className="space-y-3">
                        {data.recentPosts.length === 0 ? (
                            <div className="text-sm text-slate-500">
                                No published posts in this scope.
                            </div>
                        ) : (
                            data.recentPosts.map((post) => (
                                <div
                                    key={`${post.postId}-${post.platform}`}
                                    className="flex items-center gap-3 rounded-xl border border-white/5 bg-slate-950/40 p-2"
                                >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={post.mediaUrl}
                                        alt=""
                                        className="h-10 w-10 rounded-lg object-cover"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-xs font-bold text-white">
                                            {post.pageName} · {post.platform}
                                        </div>
                                        <div className="text-[10px] text-slate-500">
                                            {formatIstDateTime(post.publishedAt)} ·{' '}
                                            {formatElapsed(post.publishedAt, now)}
                                        </div>
                                    </div>
                                    <div className="text-right text-xs font-bold text-emerald-300">
                                        {post.metrics?.engagementRate === null ||
                                        post.metrics?.engagementRate === undefined
                                            ? '—'
                                            : `${post.metrics.engagementRate}%`}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Wire the monitor into the page**

Add the import:

```tsx
import { AnalyticsMonitor } from '@/components/AnalyticsMonitor';
```

Extend the type import with:

```tsx
type AnalyticsMonitor as AnalyticsMonitorData,
```

Add state near the other state:

```tsx
const [monitor, setMonitor] = useState<AnalyticsMonitorData | null>(null);
const [live, setLive] = useState(false);
const [monitorLoading, setMonitorLoading] = useState(false);
```

Add the loader:

```tsx
const loadMonitor = useCallback(async () => {
    setMonitorLoading(true);
    try {
        setMonitor(await analyticsApi.monitor(params));
    } catch {
        setError('Could not load the live monitor.');
    } finally {
        setMonitorLoading(false);
    }
}, [params]);

useEffect(() => {
    if (tab === 'monitor') void loadMonitor();
}, [tab, loadMonitor]);
```

Add the live timers:

```tsx
useEffect(() => {
    if (tab !== 'monitor' || !live) return;

    const tick = () => {
        if (document.visibilityState === 'visible') void loadMonitor();
    };

    const syncLive = async () => {
        if (document.visibilityState !== 'visible' || syncingRef.current) return;
        syncingRef.current = true;
        try {
            await analyticsApi.sync({ ...params, mode: 'live' });
            await loadMonitor();
        } finally {
            syncingRef.current = false;
        }
    };

    const uiTimer = window.setInterval(tick, 30_000);
    const syncTimer = window.setInterval(() => void syncLive(), 5 * 60_000);
    const onVisibility = () => {
        if (document.visibilityState === 'visible') tick();
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => {
        window.clearInterval(uiTimer);
        window.clearInterval(syncTimer);
        document.removeEventListener('visibilitychange', onVisibility);
    };
}, [tab, live, loadMonitor, params]);
```

Replace the monitor placeholder with:

```tsx
) : tab === 'monitor' ? (
    monitor ? (
        <AnalyticsMonitor
            data={monitor}
            live={live}
            onToggleLive={() => setLive((value) => !value)}
            onRefresh={refresh}
            refreshing={syncing}
            now={now}
        />
    ) : (
        <div className="rounded-3xl border border-dashed border-white/10 bg-slate-900/30 p-12 text-center text-sm text-slate-400">
            {monitorLoading ? 'Loading monitor...' : 'No monitor data yet.'}
        </div>
    )
) : tab === 'tracker' ? (
```

- [ ] **Step 3: Verify TypeScript**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/AnalyticsMonitor.tsx frontend/src/app/analytics/page.tsx
git commit -m "feat: add live analytics monitor"
```

## Task 13: Post tracker calendar

**Files:**
- Create: `frontend/src/components/PostTrackerCalendar.tsx`
- Modify: `frontend/src/app/analytics/page.tsx`

- [ ] **Step 1: Create the calendar component**

```tsx
'use client';

import React, { useMemo } from 'react';
import {
    formatElapsed,
    formatIstDateTime,
    type AnalyticsPost,
} from '@/lib/types';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function dayKey(value: string): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
    }).format(new Date(value));
}

function shiftMonth(month: string, delta: number): string {
    const [year, monthNumber] = month.split('-').map(Number);
    const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function PostTrackerCalendar({
    month,
    posts,
    selectedDay,
    onSelectDay,
    onMonthChange,
    loading,
}: {
    month: string;
    posts: AnalyticsPost[];
    selectedDay: string | null;
    onSelectDay: (day: string | null) => void;
    onMonthChange: (month: string) => void;
    loading: boolean;
}) {
    const [year, monthNumber] = month.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const firstWeekday =
        (new Date(`${month}-01T12:00:00+05:30`).getUTCDay() + 6) % 7;
    const monthLabel = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        month: 'long',
        year: 'numeric',
    }).format(new Date(`${month}-15T12:00:00+05:30`));
    const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
    }).format(new Date());

    const byDay = useMemo(() => {
        const map = new Map<string, AnalyticsPost[]>();
        for (const post of posts) {
            for (const target of post.targets) {
                const key = dayKey(target.publishedAt);
                const list = map.get(key) ?? [];
                if (!list.some((item) => item.postId === post.postId)) {
                    list.push(post);
                }
                map.set(key, list);
            }
        }
        return map;
    }, [posts]);

    const selectedPosts = selectedDay ? byDay.get(selectedDay) ?? [] : [];

    return (
        <div className="space-y-5">
            <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-5">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-bold text-white">Post date &amp; time tracker</h2>
                    <span className="text-[10px] text-slate-500">IST</span>
                    <div className="ml-auto flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => onMonthChange(shiftMonth(month, -1))}
                            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300"
                        >
                            ←
                        </button>
                        <span className="min-w-36 text-center text-xs font-bold text-white">
                            {monthLabel}
                        </span>
                        <button
                            type="button"
                            onClick={() => onMonthChange(shiftMonth(month, 1))}
                            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300"
                        >
                            →
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                onMonthChange(today.slice(0, 7));
                                onSelectDay(today);
                            }}
                            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-indigo-300"
                        >
                            Today
                        </button>
                    </div>
                </div>

                {loading ? (
                    <div className="flex justify-center py-16">
                        <div className="h-8 w-8 animate-spin rounded-full border-t-2 border-indigo-500" />
                    </div>
                ) : (
                    <div className="grid grid-cols-7 gap-1">
                        {WEEKDAYS.map((day) => (
                            <div
                                key={day}
                                className="pb-2 text-center text-[10px] font-bold uppercase tracking-widest text-slate-600"
                            >
                                {day}
                            </div>
                        ))}
                        {Array.from({ length: firstWeekday }, (_, index) => (
                            <div key={`blank-${index}`} />
                        ))}
                        {Array.from({ length: daysInMonth }, (_, index) => {
                            const dayNumber = index + 1;
                            const key = `${month}-${String(dayNumber).padStart(2, '0')}`;
                            const dayPosts = byDay.get(key) ?? [];
                            const isSelected = selectedDay === key;
                            const isToday = today === key;
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => onSelectDay(key)}
                                    className={`min-h-16 rounded-xl border p-1.5 text-left transition-colors ${
                                        isSelected
                                            ? 'border-indigo-500/30 bg-indigo-500/10'
                                            : isToday
                                              ? 'border-white/15 bg-slate-950/40'
                                              : 'border-white/5 bg-slate-950/20 hover:border-white/10'
                                    }`}
                                >
                                    <div className="text-[10px] font-bold text-slate-400">
                                        {dayNumber}
                                    </div>
                                    {dayPosts.length > 0 ? (
                                        <div className="mt-1 flex flex-wrap items-center gap-1">
                                            <span className="rounded-full bg-indigo-500/15 px-1.5 py-0.5 text-[9px] font-bold text-indigo-300">
                                                {dayPosts.length}
                                            </span>
                                            {dayPosts.some((post) =>
                                                post.targets.some(
                                                    (target) => target.platform === 'facebook'
                                                )
                                            ) ? (
                                                <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                                            ) : null}
                                            {dayPosts.some((post) =>
                                                post.targets.some(
                                                    (target) => target.platform === 'instagram'
                                                )
                                            ) ? (
                                                <span className="h-1.5 w-1.5 rounded-full bg-pink-400" />
                                            ) : null}
                                        </div>
                                    ) : null}
                                </button>
                            );
                        })}
                    </div>
                )}
            </section>

            <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-5">
                <h2 className="mb-4 text-sm font-bold text-white">
                    {selectedDay ? `Posts on ${selectedDay} (IST)` : 'Select a day'}
                </h2>
                {selectedPosts.length === 0 ? (
                    <div className="text-sm text-slate-500">
                        No published posts on this day.
                    </div>
                ) : (
                    <div className="space-y-3">
                        {selectedPosts.map((post) => (
                            <div
                                key={post.postId}
                                className="rounded-2xl border border-white/5 bg-slate-950/40 p-4"
                            >
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-white">
                                        {post.connection.pageName}
                                    </span>
                                    <span className="text-[10px] uppercase tracking-widest text-slate-500">
                                        {post.status}
                                    </span>
                                </div>
                                <p className="mt-1 line-clamp-1 text-xs text-slate-400">
                                    {post.caption}
                                </p>
                                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                    {post.targets
                                        .filter(
                                            (target) => dayKey(target.publishedAt) === selectedDay
                                        )
                                        .map((target) => (
                                            <div
                                                key={target.platform}
                                                className="rounded-xl border border-white/5 bg-slate-900/40 p-3"
                                            >
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-300">
                                                        {target.platform}
                                                    </span>
                                                    <span className="text-[11px] text-slate-400">
                                                        {formatIstDateTime(target.publishedAt)}
                                                    </span>
                                                    <span className="text-[10px] text-slate-600">
                                                        {formatElapsed(target.publishedAt)}
                                                    </span>
                                                </div>
                                                <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-400">
                                                    <span>
                                                        Reach{' '}
                                                        <strong className="text-white">
                                                            {target.metrics?.reach ?? '—'}
                                                        </strong>
                                                    </span>
                                                    <span>
                                                        Interactions{' '}
                                                        <strong className="text-white">
                                                            {target.metrics?.interactions ?? '—'}
                                                        </strong>
                                                    </span>
                                                    <span>
                                                        Rate{' '}
                                                        <strong className="text-emerald-300">
                                                            {target.metrics?.engagementRate ===
                                                                null ||
                                                            target.metrics?.engagementRate ===
                                                                undefined
                                                                ? '—'
                                                                : `${target.metrics.engagementRate}%`}
                                                        </strong>
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
```

- [ ] **Step 2: Wire the tracker into the page**

Add the import:

```tsx
import { PostTrackerCalendar } from '@/components/PostTrackerCalendar';
```

Add state:

```tsx
const [trackerMonth, setTrackerMonth] = useState(() =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })
        .format(new Date())
        .slice(0, 7)
);
const [trackerPosts, setTrackerPosts] = useState<AnalyticsPost[]>([]);
const [trackerLoading, setTrackerLoading] = useState(false);
const [selectedDay, setSelectedDay] = useState<string | null>(null);
```

Add the loader:

```tsx
const loadTracker = useCallback(async () => {
    setTrackerLoading(true);
    try {
        const [year, monthNumber] = trackerMonth.split('-').map(Number);
        const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
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
```

Replace the tracker placeholder block with:

```tsx
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
    />
) : (
```

- [ ] **Step 3: Verify TypeScript**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/PostTrackerCalendar.tsx frontend/src/app/analytics/page.tsx
git commit -m "feat: add analytics post tracker calendar"
```

## Task 14: AI analysis UI

**Files:**
- Create: `frontend/src/components/AnalyticsTips.tsx`
- Create: `frontend/src/components/AnalyticsAiTips.tsx`
- Modify: `frontend/src/app/analytics/page.tsx`

- [ ] **Step 1: Create the rule-based tips component**

```tsx
'use client';

import React from 'react';
import Link from 'next/link';
import type { AnalyticsRuleTip } from '@/lib/types';

const TONES: Record<string, string> = {
    info: 'border-sky-500/15 bg-sky-500/5 text-sky-200',
    success: 'border-emerald-500/15 bg-emerald-500/5 text-emerald-200',
    warning: 'border-amber-500/15 bg-amber-500/5 text-amber-200',
};

export function AnalyticsTips({ tips }: { tips: AnalyticsRuleTip[] }) {
    return (
        <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-5">
            <div className="mb-4 flex items-center gap-2">
                <h2 className="text-sm font-bold text-white">Engagement tips</h2>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                    Rule-based
                </span>
            </div>
            {tips.length === 0 ? (
                <p className="text-sm text-slate-500">
                    Publish a few posts to unlock tips.
                </p>
            ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                    {tips.map((tip) => (
                        <div
                            key={tip.id}
                            className={`rounded-2xl border p-4 ${TONES[tip.severity] || TONES.info}`}
                        >
                            <div className="text-sm font-bold">{tip.title}</div>
                            <p className="mt-1 text-xs opacity-80">{tip.body}</p>
                            {tip.actionHref ? (
                                <Link
                                    href={tip.actionHref}
                                    className="mt-2 inline-block text-xs font-bold underline"
                                >
                                    {tip.actionLabel || 'Open'}
                                </Link>
                            ) : null}
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
```

- [ ] **Step 2: Create the AI tips component**

```tsx
'use client';

import React from 'react';
import Link from 'next/link';
import { formatIstDateTime, type AnalyticsAiInsight } from '@/lib/types';

const TONES: Record<string, string> = {
    info: 'border-sky-500/15 bg-sky-500/5 text-sky-200',
    success: 'border-emerald-500/15 bg-emerald-500/5 text-emerald-200',
    warning: 'border-amber-500/15 bg-amber-500/5 text-amber-200',
};

export function AnalyticsAiTips({
    ai,
    onGenerate,
    loading,
    error,
}: {
    ai: AnalyticsAiInsight | null;
    onGenerate: () => void;
    loading: boolean;
    error: string;
}) {
    return (
        <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-5">
            <div className="mb-4 flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-bold text-white">AI analysis</h2>
                <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-indigo-300">
                    Gemini
                </span>
                <div className="ml-auto flex items-center gap-2">
                    {ai ? (
                        <span className="text-[10px] text-slate-500">
                            Generated {formatIstDateTime(ai.generatedAt)}
                        </span>
                    ) : null}
                    <button
                        type="button"
                        onClick={onGenerate}
                        disabled={loading}
                        className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                    >
                        {loading
                            ? 'Analyzing...'
                            : ai
                              ? 'Refresh AI analysis'
                              : 'Run AI analysis'}
                    </button>
                </div>
            </div>

            {error ? (
                <div className="mb-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                    {error}
                </div>
            ) : null}

            {ai ? (
                <>
                    <div className="grid gap-3 sm:grid-cols-2">
                        {ai.tips.map((tip, index) => (
                            <div
                                key={`${tip.title}-${index}`}
                                className={`rounded-2xl border p-4 ${TONES[tip.severity] || TONES.info}`}
                            >
                                <div className="text-sm font-bold">{tip.title}</div>
                                <p className="mt-1 text-xs opacity-80">{tip.body}</p>
                                {tip.actionHref ? (
                                    <Link
                                        href={tip.actionHref}
                                        className="mt-2 inline-block text-xs font-bold underline"
                                    >
                                        {tip.actionLabel || 'Open'}
                                    </Link>
                                ) : null}
                            </div>
                        ))}
                    </div>
                    <p className="mt-3 text-[10px] text-slate-500">
                        Cached for 6 hours. AI uses stored page, engagement, and timing
                        aggregates only.
                    </p>
                </>
            ) : (
                <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">
                    Run an AI analysis to turn your stored page, engagement, and posting-time
                    data into specific recommendations.
                </div>
            )}
        </section>
    );
}
```

- [ ] **Step 3: Wire AI tips into the page**

Add imports:

```tsx
import { AnalyticsTips } from '@/components/AnalyticsTips';
import { AnalyticsAiTips } from '@/components/AnalyticsAiTips';
```

Add state:

```tsx
const [aiLoading, setAiLoading] = useState(false);
const [aiError, setAiError] = useState('');
```

Add the generator:

```tsx
const generateAi = async () => {
    setAiLoading(true);
    setAiError('');
    try {
        await analyticsApi.generateTips(params);
        setTips(await analyticsApi.tips(params));
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
```

Replace the final AI placeholder block with:

```tsx
) : (
    <div className="space-y-6">
        <AnalyticsTips tips={tips?.ruleBased || []} />
        <AnalyticsAiTips
            ai={tips?.ai || null}
            onGenerate={generateAi}
            loading={aiLoading}
            error={aiError}
        />
    </div>
)}
```

- [ ] **Step 4: Verify TypeScript**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AnalyticsTips.tsx frontend/src/components/AnalyticsAiTips.tsx frontend/src/app/analytics/page.tsx
git commit -m "feat: add analytics AI tips UI"
```

## Task 15: Queue IST time, navigation, and auth path

**Files:**
- Modify: `frontend/src/app/queue/page.tsx`
- Modify: `frontend/src/components/AppShell.tsx`
- Modify: `frontend/src/context/AuthContext.tsx`

- [ ] **Step 1: Show IST publish time in Queue**

Update the import:

```tsx
import {
    connectionName,
    formatDate,
    formatElapsed,
    formatIstDateTime,
    latestPublishedAt,
    type Post,
    type TokenStatus,
} from '@/lib/types';
```

Replace the timestamp span:

```tsx
<span className="text-xs text-slate-500">
    {formatDate(post.createdAt)}
</span>
```

with:

```tsx
<span className="text-xs text-slate-500">
    {post.status === 'published' || post.status === 'partial' ? (
        <>
            Published {formatIstDateTime(latestPublishedAt(post))}
            {latestPublishedAt(post)
                ? ` · ${formatElapsed(latestPublishedAt(post))}`
                : ''}
        </>
    ) : (
        formatDate(post.createdAt)
    )}
</span>
```

- [ ] **Step 2: Add the Analytics nav item**

In `AppShell.tsx`, add after the Queue item:

```tsx
{ href: '/analytics', label: 'Analytics', icon: 'chart' },
```

Add the icon before the final settings fallback:

```tsx
if (name === 'chart') {
    return (
        <svg {...common}>
            <path d="M4 19V5" />
            <path d="M4 19h16" />
            <path d="M8 16v-5" />
            <path d="M12 16V8" />
            <path d="M16 16v-3" />
        </svg>
    );
}
```

- [ ] **Step 3: Protect the Analytics route**

In `AuthContext.tsx`, add `'/analytics'` to `PRIVATE_PATHS`.

- [ ] **Step 4: Verify frontend**

Run:

```bash
cd frontend
npx tsc --noEmit
npm run lint
npm run build
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/queue/page.tsx frontend/src/components/AppShell.tsx frontend/src/context/AuthContext.tsx
git commit -m "feat: add analytics navigation and IST publish times"
```

---

## Task 16: Final verification

- [ ] **Step 1: Read the local Next.js guidance before any frontend edits**

Run:

```bash
cd frontend
sed -n '1,80p' AGENTS.md
ls node_modules/next/dist/docs
```

Read the App Router/client-component guide relevant to the files being changed. This repository uses a Next.js version with breaking changes, so do not rely on older Next.js conventions.

- [ ] **Step 2: Backend verification**

```bash
cd backend
npm run build
npm test
```

Expected: build succeeds and all tests pass.

- [ ] **Step 3: Frontend verification**

```bash
cd frontend
npx tsc --noEmit
npm run lint
npm run build
```

Expected: all pass.

- [ ] **Step 4: Manual verification**

1. Restart the backend and frontend.
2. Open Profile and confirm the Meta scopes include `read_insights` and `instagram_manage_insights`.
3. Reconnect a Page from Connections.
4. Publish a post or use an existing published post.
5. Open `/analytics`.
6. Confirm the published time is shown in IST and the elapsed label updates.
7. Press `Refresh insights` and confirm a `PostMetricSnapshot` document is created.
8. Open the Live monitor, turn Live on, and confirm the 30-second UI refresh and 5-minute sync.
9. Hide the browser tab and confirm the timers pause.
10. Open Post tracker and confirm the post is on the correct IST date.
11. Run AI analysis, confirm the 6-hour cache, and refresh within 6 hours to confirm the cached result.
12. Remove insight permission from a Page and confirm the reconnect banner.
13. Confirm Queue shows `Published <IST time> · <elapsed>`.
14. Confirm an unauthenticated API call to `/api/analytics/overview` returns `401`.

- [ ] **Step 5: Commit any final fixes**

```bash
git status --short
git add <changed-files>
git commit -m "fix: polish analytics verification issues"
```

---

## Notes for the implementer

- Do not add a chart library.
- Do not change the existing publishing flow.
- Do not add a 24/7 analytics job.
- Keep all analytics queries scoped to `req.user.id`.
- Keep Meta calls out of read endpoints.
- Keep the UI consistent with the existing slate/indigo Tailwind style.
- If a backend helper from this plan does not compile because of Mongoose typing, prefer a small typed adapter over `any`.
- If the frontend page becomes too large, extract the Overview, Monitor, Tracker, and AI sections into components without changing behavior.
