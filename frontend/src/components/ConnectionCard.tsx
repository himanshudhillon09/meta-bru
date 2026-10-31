'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Modal } from '@/components/Modal';
import { PageAvatar, PageBrandPanel } from '@/components/PageBrandPanel';
import { Switch } from '@/components/Switch';
import { Tabs } from '@/components/Tabs';
import { connectionsApi } from '@/lib/apiClient';
import {
    MAX_DAILY_SLOTS,
    addSlot,
    friendlySlot,
    suggestDailyTimes,
    validateDailyTimes,
} from '@/lib/schedule';
import { formatTimeUntil, type SocialConnection } from '@/lib/types';

interface ConnectionCardProps {
    connection: SocialConnection;
    /** Current time in ms, 0 until the page has mounted. */
    now: number;
    onUpdated: (connection: SocialConnection) => void;
    onDisconnected: (connection: SocialConnection) => void;
    /** Opens the shared Meta login guide; one login refreshes every Page. */
    onReconnect: () => void;
    /** A new logo or brand voice; updates the list without a "saved" banner. */
    onBrandChanged: (connection: SocialConnection) => void;
}

const VIEWS = [
    { key: 'schedule', label: 'Publishing & schedule' },
    { key: 'brand', label: 'Brand & logo' },
] as const;

type ViewKey = (typeof VIEWS)[number]['key'];

export type PageStatus = 'live' | 'paused' | 'reconnect' | 'disconnected';

export function pageStatus(connection: SocialConnection): PageStatus {
    if (connection.tokenStatus === 'disconnected') return 'disconnected';
    if (connection.tokenStatus === 'needs_reauth') return 'reconnect';
    return connection.isActive ? 'live' : 'paused';
}

const STATUS_PILL: Record<PageStatus, { label: string; className: string; dot: string }> = {
    live: {
        label: 'Live',
        className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
        dot: 'bg-emerald-500 animate-pulse',
    },
    paused: {
        label: 'Paused',
        className: 'bg-slate-500/10 text-muted border-slate-500/20',
        dot: 'bg-slate-400',
    },
    reconnect: {
        label: 'Reconnect needed',
        className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
        dot: 'bg-amber-500',
    },
    disconnected: {
        label: 'Disconnected',
        className: 'bg-slate-500/10 text-fg-2 border-slate-500/20',
        dot: 'bg-slate-400',
    },
};

export function StatusPill({ status }: { status: PageStatus }) {
    const pill = STATUS_PILL[status];
    return (
        <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest ${pill.className}`}
        >
            <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} aria-hidden="true" />
            {pill.label}
        </span>
    );
}

function Fact({ label, value, detail }: { label: string; value: React.ReactNode; detail?: React.ReactNode }) {
    return (
        <div className="rounded-xl border border-line bg-surface-2 px-4 py-3">
            <dt className="text-[10px] font-bold uppercase tracking-[0.16em] text-subtle">{label}</dt>
            <dd className="mt-1 text-sm font-bold text-fg">{value}</dd>
            {detail ? <dd className="mt-0.5 text-xs text-muted">{detail}</dd> : null}
        </div>
    );
}

function sameTimes(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((time, index) => time === b[index]);
}

export function ConnectionCard({
    connection,
    now,
    onUpdated,
    onDisconnected,
    onReconnect,
    onBrandChanged,
}: ConnectionCardProps) {
    const [view, setView] = useState<ViewKey>('schedule');
    const [times, setTimes] = useState<string[]>(connection.dailyTimes);
    const [facebook, setFacebook] = useState(connection.publishToFacebook);
    const [instagram, setInstagram] = useState(connection.publishToInstagram);
    const [active, setActive] = useState(connection.isActive);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');
    const [confirmOpen, setConfirmOpen] = useState(false);

    const status = pageStatus(connection);
    const isDisconnected = status === 'disconnected';
    const needsReauth = status === 'reconnect';
    const queuedCount = connection.queuedCount ?? 0;
    const scheduleError = validateDailyTimes(times);
    const dirty =
        !sameTimes(times, connection.dailyTimes) ||
        facebook !== connection.publishToFacebook ||
        instagram !== connection.publishToInstagram ||
        active !== connection.isActive;
    const nothingOn = !facebook && !instagram;
    const upcoming = connection.upcomingSlots ?? [];

    useEffect(() => {
        setTimes(connection.dailyTimes);
        setFacebook(connection.publishToFacebook);
        setInstagram(connection.publishToInstagram);
        setActive(connection.isActive);
    }, [connection]);

    useEffect(() => {
        if (!saved) return;
        const timer = setTimeout(() => setSaved(false), 4000);
        return () => clearTimeout(timer);
    }, [saved]);

    const discard = () => {
        setTimes(connection.dailyTimes);
        setFacebook(connection.publishToFacebook);
        setInstagram(connection.publishToInstagram);
        setActive(connection.isActive);
        setError('');
    };

    const save = async () => {
        setSaving(true);
        setError('');
        try {
            const data: any = await connectionsApi.update(connection._id, {
                dailyTimes: times,
                publishToFacebook: facebook,
                publishToInstagram: instagram,
                isActive: active,
            });
            if (data.success) {
                onUpdated(data.connection);
                setSaved(true);
            }
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not save changes');
        } finally {
            setSaving(false);
        }
    };

    const disconnect = async () => {
        setError('');
        try {
            const data: any = await connectionsApi.disconnect(connection._id);
            if (data.connection) onDisconnected(data.connection);
            setConfirmOpen(false);
        } catch (err: any) {
            setError(
                typeof err === 'string' ? err : 'Could not disconnect Page'
            );
        }
    };

    // What happens next for this Page, in plain words.
    const nextPost =
        status === 'disconnected' || status === 'reconnect'
            ? { value: 'On hold', detail: 'Reconnect this Page to resume' }
            : status === 'paused'
              ? { value: 'Paused', detail: 'Turn on auto-posting to resume' }
              : upcoming[0] && queuedCount > 0
                ? {
                      value: friendlySlot(upcoming[0], connection.timezone, now),
                      detail: now > 0 ? `Publishes ${formatTimeUntil(upcoming[0], now)}` : '',
                  }
                : {
                      value: 'Nothing queued',
                      detail: connection.nextRunAt
                          ? `Next open slot ${friendlySlot(connection.nextRunAt, connection.timezone, now)}`
                          : 'Add a post to fill the next slot',
                  };
    const targets = [
        connection.publishToFacebook ? 'Facebook' : '',
        connection.publishToInstagram && connection.instagram ? 'Instagram' : '',
    ].filter(Boolean);

    return (
        <article className="rounded-2xl border border-line bg-surface p-5 sm:p-7 shadow-card">
            <Modal
                isOpen={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                onConfirm={disconnect}
                title="Disconnect this Page?"
                message={`Disconnect ${connection.pageName}? Your queued posts and published history will be kept. If auto-posting is on, it will resume when you reconnect this same Page.`}
                confirmText="Disconnect"
                type="danger"
            />

            <header className="flex items-start gap-4">
                <PageAvatar connection={connection} />
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-lg font-bold text-fg">{connection.pageName}</h3>
                        <StatusPill status={status} />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
                        {connection.instagram ? (
                            <span className="font-semibold text-rose-700 dark:text-rose-300">
                                Instagram @{connection.instagram.username || connection.instagram.id}
                            </span>
                        ) : (
                            <span>No Instagram linked</span>
                        )}
                        <span aria-hidden="true">·</span>
                        <span>Page ID {connection.pageId}</span>
                    </div>
                </div>
                {isDisconnected ? (
                    <button
                        onClick={onReconnect}
                        className="shrink-0 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-indigo-500"
                    >
                        Reconnect
                    </button>
                ) : (
                    <button
                        onClick={() => setConfirmOpen(true)}
                        className="shrink-0 rounded-lg px-3 py-2 text-xs font-bold text-subtle transition-colors hover:bg-rose-500/10 hover:text-rose-700 dark:hover:text-rose-300"
                    >
                        Disconnect
                    </button>
                )}
            </header>

            {isDisconnected ? (
                <div className="mt-5 rounded-2xl border border-slate-500/20 bg-slate-500/10 px-4 py-3 text-sm text-fg-2">
                    This Page is disconnected. Reconnect the Facebook account that manages it to
                    resume posting.
                </div>
            ) : null}

            {needsReauth ? (
                <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <span>
                        Meta stopped accepting this Page&apos;s access. Reconnect to resume scheduled
                        posting.
                    </span>
                    <button
                        onClick={onReconnect}
                        className="shrink-0 bg-amber-500 hover:bg-amber-400 text-slate-950 px-4 py-2 rounded-xl text-xs font-bold"
                    >
                        Reconnect
                    </button>
                </div>
            ) : null}

            {connection.lastError && connection.tokenStatus === 'active' ? (
                <div className="mt-5 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-xs text-rose-700 dark:text-rose-300">
                    Last error: {connection.lastError}
                </div>
            ) : null}

            <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Fact label="Next post" value={nextPost.value} detail={nextPost.detail} />
                <Fact
                    label="Waiting in queue"
                    value={`${queuedCount} ${queuedCount === 1 ? 'post' : 'posts'}`}
                    detail={
                        queuedCount > 0 ? (
                            <Link href="/queue" className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">
                                Open the Queue →
                            </Link>
                        ) : (
                            <Link href="/composer" className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">
                                Create a post →
                            </Link>
                        )
                    }
                />
                <Fact
                    label="Posts a day"
                    value={`${connection.dailyTimes.length} ${connection.dailyTimes.length === 1 ? 'slot' : 'slots'}`}
                    detail={targets.length > 0 ? `To ${targets.join(' + ')}` : 'No platform turned on'}
                />
            </dl>

            <Tabs
                label={`${connection.pageName} settings`}
                variant="segmented"
                items={VIEWS}
                value={view}
                onChange={setView}
                className="mt-6"
            />

            {view === 'brand' ? (
                <div className="mt-5 animate-fade-in">
                    <PageBrandPanel connection={connection} onChange={onBrandChanged} />
                </div>
            ) : (
                <div className="mt-5 grid grid-cols-1 gap-6 animate-fade-in lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
                    <section aria-labelledby={`where-${connection._id}`}>
                        <h4
                            id={`where-${connection._id}`}
                            className="text-xs font-bold uppercase tracking-widest text-subtle"
                        >
                            Where it posts
                        </h4>
                        <div className="mt-2 -mx-3 space-y-0.5">
                            <Switch
                                tone="facebook"
                                checked={facebook}
                                onChange={setFacebook}
                                label="Facebook Page"
                                description={`Posts go to ${connection.pageName} on Facebook.`}
                            />
                            <Switch
                                tone="instagram"
                                checked={instagram && Boolean(connection.instagram)}
                                onChange={setInstagram}
                                disabled={!connection.instagram}
                                label="Instagram"
                                description={
                                    connection.instagram
                                        ? `Posts also go to @${connection.instagram.username || connection.instagram.id}.`
                                        : 'Link an Instagram professional account to this Page on Facebook, then reconnect.'
                                }
                            />
                            <Switch
                                tone="emerald"
                                checked={active}
                                onChange={setActive}
                                label="Auto-posting"
                                description={
                                    active
                                        ? 'Queued posts publish on their own at the times on the right.'
                                        : 'Paused: queued posts wait until you turn this back on.'
                                }
                            />
                        </div>
                        {nothingOn ? (
                            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                                Turn on Facebook or Instagram, or this Page&apos;s posts have nowhere to go.
                            </p>
                        ) : null}
                    </section>

                    <section aria-labelledby={`when-${connection._id}`}>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <h4
                                id={`when-${connection._id}`}
                                className="text-xs font-bold uppercase tracking-widest text-subtle"
                            >
                                When it posts
                            </h4>
                            <label className="flex items-center gap-2 text-xs text-muted">
                                <span>Posts a day</span>
                                <select
                                    value={times.length}
                                    onChange={(event) =>
                                        setTimes(suggestDailyTimes(Number(event.target.value)))
                                    }
                                    className="bg-surface-2 border border-line-strong rounded-lg px-2 py-1.5 text-fg focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                >
                                    {Array.from({ length: MAX_DAILY_SLOTS }, (_, index) => index + 1).map(
                                        (count) => (
                                            <option key={count} value={count}>
                                                {count}
                                            </option>
                                        )
                                    )}
                                </select>
                            </label>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                            {times.map((time, index) => (
                                <div
                                    key={index}
                                    className="flex items-center rounded-xl border border-line-strong bg-surface-2 focus-within:ring-2 focus-within:ring-indigo-500/50"
                                >
                                    <input
                                        type="time"
                                        aria-label={`Posting time ${index + 1}`}
                                        value={time}
                                        onChange={(event) =>
                                            setTimes((current) =>
                                                current.map((value, position) =>
                                                    position === index ? event.target.value : value
                                                )
                                            )
                                        }
                                        className="bg-transparent pl-3 py-2 text-sm text-fg focus:outline-none"
                                    />
                                    <button
                                        type="button"
                                        aria-label={`Remove posting time ${index + 1}`}
                                        disabled={times.length === 1}
                                        onClick={() =>
                                            setTimes((current) =>
                                                current.filter((_, position) => position !== index)
                                            )
                                        }
                                        className="px-2.5 py-2 text-subtle hover:text-rose-700 dark:hover:text-rose-300 disabled:opacity-30 disabled:cursor-not-allowed"
                                    >
                                        ×
                                    </button>
                                </div>
                            ))}
                            {times.length < MAX_DAILY_SLOTS ? (
                                <button
                                    type="button"
                                    onClick={() => setTimes(addSlot)}
                                    className="rounded-xl border border-dashed border-line-strong px-3 py-2 text-xs font-bold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/10"
                                >
                                    + Add time
                                </button>
                            ) : null}
                        </div>

                        {scheduleError ? (
                            <div className="mt-2 text-xs text-rose-700 dark:text-rose-400">{scheduleError}</div>
                        ) : null}
                        <p className="mt-2 text-xs text-subtle">
                            One queued post goes out at each time, every day, in {connection.timezone} (
                            <Link
                                href="/settings"
                                className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300"
                            >
                                change in Profile
                            </Link>
                            ). Picking a number spreads the times from 9 am to 9 pm; edit any time
                            after.
                        </p>

                        {upcoming.length > 0 && queuedCount > 0 && !dirty ? (
                            <div className="mt-4 rounded-xl border border-line bg-surface-2 px-4 py-3">
                                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-subtle">
                                    Coming up
                                </div>
                                <ol className="mt-2 space-y-1 text-xs text-fg-2">
                                    {upcoming.slice(0, 3).map((slot, index) => (
                                        <li key={slot} className="flex justify-between gap-3">
                                            <span>Queued post {index + 1}</span>
                                            <span className="font-semibold text-fg">
                                                {friendlySlot(slot, connection.timezone, now)}
                                            </span>
                                        </li>
                                    ))}
                                </ol>
                                {queuedCount > 3 ? (
                                    <div className="mt-1.5 text-[11px] text-subtle">
                                        and {queuedCount - 3} more after that
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                    </section>
                </div>
            )}

            {view === 'schedule' && (dirty || saving) ? (
                <div className="mt-6 flex flex-col gap-3 rounded-xl border border-indigo-500/25 bg-indigo-500/5 px-4 py-3 animate-fade-in sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-xs font-semibold text-indigo-800 dark:text-indigo-200">
                        You have unsaved changes for {connection.pageName}.
                    </span>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={discard}
                            disabled={saving}
                            className="rounded-xl border border-line-strong bg-surface px-4 py-2 text-xs font-bold text-fg hover:bg-hover disabled:opacity-50"
                        >
                            Discard
                        </button>
                        <button
                            type="button"
                            onClick={() => void save()}
                            disabled={saving || Boolean(scheduleError)}
                            className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
                        >
                            {saving ? 'Saving...' : 'Save changes'}
                        </button>
                    </div>
                </div>
            ) : null}

            {saved && !dirty ? (
                <div className="mt-4 text-xs font-semibold text-emerald-700 dark:text-emerald-300 animate-fade-in" role="status">
                    ✓ Saved. {connection.pageName} will post on this schedule.
                </div>
            ) : null}

            {error ? <div className="mt-4 text-xs text-rose-700 dark:text-rose-400">{error}</div> : null}
        </article>
    );
}
