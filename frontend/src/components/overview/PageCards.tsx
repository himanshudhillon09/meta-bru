'use client';

import React from 'react';
import Link from 'next/link';
import { PageAvatar } from '@/components/PageBrandPanel';
import { formatTimeUntil, type OverviewPage, type OverviewSlot } from '@/lib/types';
import {
    DeliveryChips,
    PageStatePill,
    PlatformChips,
    Section,
    Thumb,
    dayHeading,
    dayKey,
    formatSlotTime,
    linkClass,
} from './parts';

/** A week of posts is a healthy queue; the bar fills toward it. */
const RUNWAY_TARGET_DAYS = 7;
/** Running Pages first; the attention list already leads with the broken ones. */
const STATE_ORDER = { active: 0, paused: 1, reconnect: 2, disconnected: 3 } as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="grid grid-cols-[88px_1fr] gap-3 py-2.5 text-xs">
            <dt className="pt-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-subtle">{label}</dt>
            <dd className="min-w-0 text-fg-2">{children}</dd>
        </div>
    );
}

function runwayText(page: OverviewPage): string {
    if (page.queued === 0) return 'Empty';
    const days = page.runwayDays;
    const span =
        days < 1
            ? 'less than a day'
            : days < 1.5
              ? 'about 1 day'
              : `about ${Math.round(days)} days`;
    return `${page.queued} queued · ${span} of posts`;
}

function NextPost({ page, now }: { page: OverviewPage; now: number }) {
    if (page.state === 'reconnect') {
        return <span className="font-semibold text-rose-700 dark:text-rose-300">On hold until you reconnect this Page.</span>;
    }
    if (page.state === 'disconnected') return <span className="text-subtle">Disconnected.</span>;
    if (page.state === 'paused') {
        return (
            <span className="font-semibold text-amber-700 dark:text-amber-300">
                Schedule paused{page.queued > 0 ? `; ${page.queued} waiting` : ''}.
            </span>
        );
    }
    if (!page.nextSlotAt) return <span className="text-subtle">No posting time set.</span>;
    const when = (
        <span className="font-semibold text-fg">
            {formatSlotTime(page.nextSlotAt, page.timezone)}
            {now > 0 ? <span className="font-normal text-subtle"> · {formatTimeUntil(page.nextSlotAt, now)}</span> : null}
        </span>
    );
    if (!page.nextPost) {
        return (
            <div>
                {when}
                <p className="mt-1 font-semibold text-amber-700 dark:text-amber-300">
                    Nothing queued, so this slot will pass without a post.
                </p>
            </div>
        );
    }
    return (
        <div>
            {when}
            <div className="mt-1.5 flex items-center gap-2">
                <Thumb src={page.nextPost.thumb} size="sm" />
                <div className="min-w-0">
                    <p className="line-clamp-1 text-fg">{page.nextPost.caption || 'No caption'}</p>
                    <div className="mt-1">
                        <PlatformChips platforms={page.nextPost.platforms} story={page.nextPost.story} />
                    </div>
                </div>
            </div>
        </div>
    );
}

function PageCard({ page, now }: { page: OverviewPage; now: number }) {
    const fill = Math.min(page.runwayDays / RUNWAY_TARGET_DAYS, 1);
    const low = page.state === 'active' && page.runwayDays < 1;
    return (
        <article className="flex flex-col rounded-2xl border border-line bg-surface p-5 shadow-card">
            <header className="flex items-start gap-3">
                <PageAvatar connection={{ pageName: page.pageName, logoThumb: page.logoThumb }} />
                <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-bold text-fg">{page.pageName}</h3>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-subtle">
                        <span className="inline-flex items-center gap-1">
                            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--viz-facebook)' }} />
                            Facebook
                        </span>
                        {page.instagram ? (
                            <span className="inline-flex items-center gap-1">
                                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--viz-instagram)' }} />
                                @{page.instagram.username || 'instagram'}
                            </span>
                        ) : (
                            <span>No Instagram linked</span>
                        )}
                    </p>
                </div>
                <PageStatePill state={page.state} />
            </header>

            <dl className="mt-3 divide-y divide-line border-t border-line">
                <Row label="Next post">
                    <NextPost page={page} now={now} />
                </Row>
                <Row label="Queue">
                    <div className="flex items-center justify-between gap-2">
                        <span className={low ? 'font-semibold text-amber-700 dark:text-amber-300' : ''}>{runwayText(page)}</span>
                        {page.queueEndsAt ? (
                            <span className="shrink-0 text-[11px] text-subtle">
                                until {formatSlotTime(page.queueEndsAt, page.timezone)}
                            </span>
                        ) : null}
                    </div>
                    <div
                        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken"
                        role="img"
                        aria-label={`${Math.round(page.runwayDays * 10) / 10} of ${RUNWAY_TARGET_DAYS} days of posts queued`}
                    >
                        <div
                            className={`h-full rounded-full ${low ? 'bg-amber-500' : 'bg-indigo-500'}`}
                            style={{ width: `${Math.max(fill * 100, page.queued > 0 ? 4 : 0)}%` }}
                        />
                    </div>
                    {page.queuedWithoutInstagram > 0 ? (
                        <p className="mt-1.5 text-[11px] text-sky-700 dark:text-sky-300">
                            {page.queuedWithoutInstagram} of them {page.queuedWithoutInstagram === 1 ? 'skips' : 'skip'} Instagram.
                        </p>
                    ) : null}
                </Row>
                <Row label="Posts at">
                    {page.dailyTimes.length > 0 ? page.dailyTimes.join(' · ') : 'No times set'}
                    <span className="text-subtle"> ({page.timezone})</span>
                </Row>
                <Row label="Last post">
                    {page.lastPublished ? (
                        <div className="space-y-1.5">
                            <div>
                                <span className="text-fg">{formatSlotTime(page.lastPublished.at, page.timezone)}</span>
                                <span className="text-subtle"> · {page.lastPublished.caption.slice(0, 60) || 'No caption'}</span>
                            </div>
                            <DeliveryChips
                                targets={page.lastPublished.targets}
                                storyTargets={page.lastPublished.storyTargets}
                            />
                        </div>
                    ) : (
                        <span className="text-subtle">Nothing published from Meta-Bru yet.</span>
                    )}
                </Row>
                <Row label="This week">
                    <span className="tabular-nums">
                        {page.week.published} published · {page.week.stories} {page.week.stories === 1 ? 'Story' : 'Stories'}
                        {page.week.failed > 0 ? (
                            <span className="font-semibold text-rose-700 dark:text-rose-300"> · {page.week.failed} failed</span>
                        ) : null}
                    </span>
                </Row>
            </dl>

            {page.lastError && page.state !== 'reconnect' ? (
                <p className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
                    {page.lastError}
                </p>
            ) : null}

            <footer className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-3">
                <Link href="/queue" className={linkClass}>
                    Queue
                </Link>
                <Link href="/connections" className={linkClass}>
                    {page.state === 'reconnect' ? 'Reconnect' : 'Schedule & brand'}
                </Link>
                <Link href="/analytics" className={linkClass}>
                    Analytics →
                </Link>
            </footer>
        </article>
    );
}

/** Each Page's schedule state, queue length, next post, and last delivery. */
export function PageCards({ pages, now }: { pages: OverviewPage[]; now: number }) {
    return (
        <section aria-labelledby="overview-pages">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                    <h2 id="overview-pages" className="text-sm font-bold text-fg">
                        Your Pages
                    </h2>
                    <p className="mt-0.5 text-xs text-muted">
                        Each Page publishes one queued post at each posting time, oldest first.
                    </p>
                </div>
                <Link href="/connections" className={linkClass}>
                    Manage Pages →
                </Link>
            </div>
            {pages.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-line-strong px-4 py-10 text-center text-sm text-subtle">
                    No Pages connected yet.{' '}
                    <Link href="/connections" className={linkClass}>
                        Connect a Facebook Page
                    </Link>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    {[...pages]
                        .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.pageName.localeCompare(b.pageName))
                        .map((page) => (
                        <PageCard key={page.connectionId} page={page} now={now} />
                    ))}
                </div>
            )}
        </section>
    );
}

/** The next two days of slots across every Page, with the post each one publishes. */
export function UpNext({ slots, timezone, now }: { slots: OverviewSlot[]; timezone: string; now: number }) {
    const groups: Array<{ day: string; slots: OverviewSlot[] }> = [];
    for (const slot of slots) {
        const day = dayKey(slot.at, timezone);
        const group = groups.find((item) => item.day === day);
        if (group) group.slots.push(slot);
        else groups.push({ day, slots: [slot] });
    }

    return (
        <Section
            title="Up next"
            description="What publishes in the next 48 hours."
            action={
                <Link href="/queue" className={linkClass}>
                    Open queue →
                </Link>
            }
        >
            {slots.length === 0 ? (
                <p className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-xs text-subtle">
                    Nothing is scheduled in the next 48 hours.
                </p>
            ) : (
                <div className="space-y-4">
                    {groups.map((group) => (
                        <div key={group.day}>
                            <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-subtle">
                                {dayHeading(group.day, timezone, now)}
                            </h3>
                            <ol className="mt-2 space-y-2">
                                {group.slots.map((slot) => (
                                    <li
                                        key={`${slot.connectionId}-${slot.at}`}
                                        className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                                            slot.post
                                                ? 'border-line bg-surface-2'
                                                : 'border-dashed border-amber-500/40 bg-amber-500/5'
                                        }`}
                                    >
                                        <div className="w-[4.5rem] shrink-0 text-center">
                                            <div className="text-sm font-bold tabular-nums text-fg">
                                                {formatSlotTime(slot.at, slot.timezone, false)}
                                            </div>
                                            {now > 0 ? (
                                                <div className="whitespace-nowrap text-[10px] text-subtle">{formatTimeUntil(slot.at, now)}</div>
                                            ) : null}
                                        </div>
                                        {slot.post ? <Thumb src={slot.post.thumb} size="sm" /> : null}
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-[11px] font-semibold text-subtle">{slot.pageName}</p>
                                            {slot.post ? (
                                                <>
                                                    <p className="line-clamp-1 text-xs text-fg">{slot.post.caption || 'No caption'}</p>
                                                    <div className="mt-1">
                                                        <PlatformChips platforms={slot.post.platforms} story={slot.post.story} />
                                                    </div>
                                                </>
                                            ) : (
                                                <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                                                    Empty slot: nothing queued, so it is skipped.
                                                </p>
                                            )}
                                        </div>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    ))}
                </div>
            )}
        </Section>
    );
}
