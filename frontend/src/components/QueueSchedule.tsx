'use client';

import React from 'react';
import Link from 'next/link';
import { PageAvatar } from '@/components/PageBrandPanel';
import { postPageId } from '@/components/PageFilter';
import { HEALTH_URL, type SchedulerStatus } from '@/lib/apiClient';
import {
    formatElapsed,
    formatTimeUntil,
    type Post,
    type SocialConnection,
} from '@/lib/types';

/** A scheduler that has not checked for this long is not running. */
const STALE_TICK_MS = 3 * 60_000;
/** A server this new was most likely asleep until the app woke it. */
const RECENT_START_MS = 15 * 60_000;

/** "Fri, 31 Oct, 09:00" in the Page's timezone. */
export function formatSlot(value: string, timezone: string): string {
    const date = new Date(value);
    try {
        return date.toLocaleString(undefined, {
            timeZone: timezone,
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return date.toLocaleString();
    }
}

/** A Page's queued posts in publish order: oldest first. */
function queueOf(posts: Post[], pageId: string): Post[] {
    return posts
        .filter((post) => post.status === 'queued' && postPageId(post) === pageId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export type PostTiming =
    | { kind: 'scheduled'; at: string; timezone: string; position: number }
    | { kind: 'waiting'; reason: string };

/** When a queued post publishes, or why it is waiting. */
export function queuedPostTiming(
    post: Post,
    posts: Post[],
    pages: SocialConnection[]
): PostTiming | null {
    if (post.status !== 'queued') return null;
    const page = pages.find((item) => item._id === postPageId(post));
    // Disconnected Pages already show a reconnect chip.
    if (!page || page.tokenStatus !== 'active') return null;
    if (!page.isActive) {
        return {
            kind: 'waiting',
            reason: `${page.pageName}'s schedule is paused. Turn it on in Pages & Schedule, or use Post now.`,
        };
    }

    const position = queueOf(posts, page._id).findIndex((item) => item._id === post._id);
    const at = page.upcomingSlots?.[position];
    return at ? { kind: 'scheduled', at, timezone: page.timezone, position: position + 1 } : null;
}

export function PostTimingLine({ timing }: { timing: PostTiming | null }) {
    if (!timing) return null;
    if (timing.kind === 'waiting') {
        return <div className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300">{timing.reason}</div>;
    }
    return (
        <div className="mt-2 inline-flex flex-wrap items-center gap-1.5 text-xs text-fg-2">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
            </svg>
            <span className="font-semibold text-fg">Publishes {formatSlot(timing.at, timing.timezone)}</span>
            <span className="text-subtle">
                · {formatTimeUntil(timing.at)}
                {timing.position > 1 ? ` · #${timing.position} in line` : ' · next in line'}
            </span>
        </div>
    );
}

/**
 * How automatic posting stands: whether the server's scheduler is checking
 * the queue, and each Page's posting times and next slot.
 */
export function ScheduleSummary({
    pages,
    posts,
    scheduler,
    now,
}: {
    pages: SocialConnection[];
    posts: Post[];
    scheduler: SchedulerStatus | null;
    /** When `scheduler` was fetched. */
    now: number;
}) {
    const lastTick = scheduler?.lastTickAt ? new Date(scheduler.lastTickAt).getTime() : 0;
    const startedAt = scheduler?.startedAt ? new Date(scheduler.startedAt).getTime() : 0;
    const stale = Boolean(scheduler?.enabled) && (!lastTick || now - lastTick > STALE_TICK_MS);
    const justStarted = Boolean(startedAt) && now - startedAt < RECENT_START_MS;
    const waitingPages = pages.filter((page) => queueOf(posts, page._id).length > 0);

    return (
        <section className="mb-6 rounded-2xl border border-line bg-surface p-4 sm:p-5 shadow-card">
            {scheduler && !scheduler.enabled ? (
                <p className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                    Automatic posting is turned off on the server, so queued posts only go out with Post
                    now. Remove <code>SCHEDULER_ENABLED=false</code> from the backend&apos;s environment and
                    redeploy.
                </p>
            ) : stale ? (
                <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                    The scheduler last checked the queue {lastTick ? formatElapsed(scheduler?.lastTickAt) : 'never'},
                    so it is not running right now. Restart the backend; posts go out once it checks again.
                </p>
            ) : scheduler ? (
                <p className="text-xs text-subtle">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Automatic posting is on
                    </span>{' '}
                    · checked {formatElapsed(scheduler.lastTickAt).toLowerCase()}. Each Page publishes one
                    queued post at each of its posting times, oldest first.
                    {justStarted ? (
                        <span className="mt-1 block text-amber-700 dark:text-amber-300">
                            The server started {formatElapsed(scheduler.startedAt).toLowerCase()}, so it was
                            probably asleep. Slots it sleeps through by more than 3 hours are skipped. Point your
                            uptime monitor at <code className="break-all">{HEALTH_URL}</code> every 5 to 10 minutes
                            to keep it awake.
                        </span>
                    ) : null}
                </p>
            ) : null}

            {waitingPages.length > 0 ? (
                <div className="mt-3 divide-y divide-line">
                    {waitingPages.map((page) => {
                        const queued = queueOf(posts, page._id).length;
                        const next = page.upcomingSlots?.[0];
                        return (
                            <div key={page._id} className="flex items-start gap-3 py-2.5">
                                <PageAvatar connection={page} size="sm" />
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-semibold text-fg">
                                        {page.pageName}
                                        <span className="ml-2 text-xs font-normal text-subtle">
                                            {queued} queued · posts at {page.dailyTimes.join(', ')}
                                        </span>
                                    </div>
                                    <div className="mt-0.5 text-xs text-fg-2">
                                        {page.tokenStatus !== 'active' ? (
                                            <Link href="/connections" className="font-semibold text-amber-700 dark:text-amber-300">
                                                Reconnect to resume
                                            </Link>
                                        ) : !page.isActive ? (
                                            <Link href="/connections" className="font-semibold text-amber-700 dark:text-amber-300">
                                                Schedule paused
                                            </Link>
                                        ) : next ? (
                                            <>
                                                Next post <span className="font-semibold text-fg">{formatSlot(next, page.timezone)}</span>{' '}
                                                <span className="text-subtle">({formatTimeUntil(next)})</span>
                                            </>
                                        ) : null}
                                    </div>
                                    {page.lastError ? (
                                        <div className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">{page.lastError}</div>
                                    ) : null}
                                </div>
                            </div>
                        );
                    })}
                    <div className="pt-2.5 text-[11px] text-subtle">
                        Want posts to go out sooner? Add more posting times in{' '}
                        <Link href="/connections" className="text-indigo-700 dark:text-indigo-400">
                            Pages &amp; Schedule
                        </Link>
                        , or use Post now.
                    </div>
                </div>
            ) : null}
        </section>
    );
}
