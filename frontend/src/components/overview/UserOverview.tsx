'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { GridSkeleton } from '@/components/Feedback';
import { StoryShareNotice, useStoryShare } from '@/components/ShareStory';
import { useAuth } from '@/context/AuthContext';
import { analyticsApi, overviewApi, postsApi } from '@/lib/apiClient';
import { formatElapsed, type AnalyticsOverview, type OverviewReport, type Post } from '@/lib/types';
import { useNow } from '@/lib/useNow';
import { AttentionList, StatusStrip } from './OverviewHealth';
import { PublishingChart, RecentActivity, ResultsStrip, WeekTiles } from './OverviewActivity';
import { PageCards, UpNext } from './PageCards';

/** The status refreshes this often while the tab is visible. */
const REFRESH_MS = 60_000;
const RECENT_LIMIT = 6;

function istDay(offsetDays: number): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
        new Date(Date.now() - offsetDays * 86_400_000)
    );
}

/** Posts that went out or failed, newest first. */
function recentOf(posts: Post[]): Post[] {
    return posts
        .filter((post) => ['publishing', 'published', 'partial', 'failed'].includes(post.status))
        .sort((a, b) => (b.publishedAt || b.updatedAt).localeCompare(a.publishedAt || a.updatedAt))
        .slice(0, RECENT_LIMIT);
}

export function UserOverview() {
    const { user } = useAuth();
    const now = useNow(30_000);
    const [report, setReport] = useState<OverviewReport | null>(null);
    const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null);
    const [posts, setPosts] = useState<Post[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');
    // The share response is not populated; keep the Page details we have.
    const story = useStoryShare((updated) =>
        setPosts((current) =>
            current.map((item) => (item._id === updated._id ? { ...updated, connectionId: item.connectionId } : item))
        )
    );

    const load = useCallback(async (withExtras: boolean) => {
        setRefreshing(true);
        try {
            const [overviewData, postData, analyticsData] = await Promise.all([
                overviewApi.get(),
                postsApi.list({ limit: '40' }) as Promise<{ posts?: Post[] }>,
                withExtras
                    ? analyticsApi.overview({ from: istDay(6), to: istDay(0) }).catch(() => null)
                    : Promise.resolve(undefined),
            ]);
            setReport(overviewData.overview);
            setPosts(postData.posts || []);
            if (analyticsData !== undefined) setAnalytics(analyticsData);
            setError('');
        } catch (err) {
            setError(typeof err === 'string' ? err : 'Could not load the overview.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        // Initial data load; state updates happen after the requests resolve.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load(true);
        const timer = setInterval(() => {
            if (document.visibilityState === 'visible') void load(false);
        }, REFRESH_MS);
        return () => clearInterval(timer);
    }, [load]);

    if (!user) return null;

    const recent = recentOf(posts);

    return (
        <AppShell
            title="Overview"
            subtitle={`Welcome back, ${user.name}. Here is how your Pages are running right now.`}
            actions={
                <>
                    <Link
                        href="/composer"
                        className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-indigo-500"
                    >
                        New post
                    </Link>
                    <Link
                        href="/connections"
                        className="rounded-xl border border-line-strong bg-hover px-5 py-2.5 text-sm font-bold text-fg transition-all hover:bg-hover-strong"
                    >
                        Pages &amp; Schedule
                    </Link>
                </>
            }
        >
            <StoryShareNotice outcome={story.outcome} onDismiss={story.clearOutcome} />

            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-subtle">
                <span aria-live="polite">
                    {report
                        ? `Live status · updated ${formatElapsed(report.generatedAt, now).toLowerCase() || 'just now'} · refreshes every minute`
                        : loading
                          ? 'Loading status…'
                          : ''}
                </span>
                <button
                    type="button"
                    onClick={() => void load(true)}
                    disabled={refreshing}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-hover px-3 py-1.5 font-bold text-fg transition-colors hover:bg-hover-strong disabled:opacity-60"
                >
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
                        aria-hidden="true"
                    >
                        <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
                    </svg>
                    {refreshing ? 'Refreshing' : 'Refresh'}
                </button>
            </div>

            {error ? (
                <div
                    role="alert"
                    className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300"
                >
                    <span>
                        {report
                            ? `Could not refresh, so this shows the status from ${formatElapsed(report.generatedAt, now).toLowerCase()}.`
                            : error}
                    </span>
                    <button type="button" onClick={() => void load(true)} className="text-xs font-bold underline-offset-2 hover:underline">
                        Try again
                    </button>
                </div>
            ) : null}

            {!report ? (
                loading ? (
                    <GridSkeleton tiles={6} />
                ) : null
            ) : (
                <div className="space-y-6">
                    <StatusStrip report={report} now={now} />
                    <AttentionList items={report.attention} />
                    <WeekTiles report={report} />
                    <PageCards pages={report.pages} now={now} />
                    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                        <UpNext slots={report.upcoming} timezone={report.timezone} now={now} />
                        <PublishingChart report={report} />
                    </div>
                    <ResultsStrip analytics={analytics} now={now} />
                    <RecentActivity posts={recent} now={now} onShareStory={story.open} sharingId={story.sharingId} />
                </div>
            )}
            {story.modal}
        </AppShell>
    );
}
