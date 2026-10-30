'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Modal } from '@/components/Modal';
import { PageAvatar, PageBrandPanel } from '@/components/PageBrandPanel';
import { Tabs } from '@/components/Tabs';
import { ToggleChip } from '@/components/ToggleChip';
import { connectionsApi } from '@/lib/apiClient';
import {
    MAX_DAILY_SLOTS,
    addSlot,
    suggestDailyTimes,
    validateDailyTimes,
} from '@/lib/schedule';
import {
    formatDate,
    type SocialConnection,
} from '@/lib/types';

interface ConnectionCardProps {
    connection: SocialConnection;
    onUpdated: (connection: SocialConnection) => void;
    onDisconnected: (connection: SocialConnection) => void;
    /** Opens the shared Meta login guide; one login refreshes every Page. */
    onReconnect: () => void;
    /** A new logo or brand voice; updates the list without a "saved" banner. */
    onBrandChanged: (connection: SocialConnection) => void;
}

const VIEWS = [
    { key: 'schedule', label: 'Schedule' },
    { key: 'brand', label: 'Brand & logo' },
] as const;

type ViewKey = (typeof VIEWS)[number]['key'];

export function ConnectionCard({
    connection,
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
    const [error, setError] = useState('');
    const [confirmOpen, setConfirmOpen] = useState(false);

    const isDisconnected = connection.tokenStatus === 'disconnected';
    const needsReauth = connection.tokenStatus === 'needs_reauth';
    const queuedCount = connection.queuedCount ?? 0;
    const queuedLabel =
        queuedCount > 0
            ? `${queuedCount} ${
                  queuedCount === 1 ? 'post' : 'posts'
              } waiting for this Page`
            : 'No posts waiting';
    const scheduleError = validateDailyTimes(times);

    useEffect(() => {
        setTimes(connection.dailyTimes);
        setFacebook(connection.publishToFacebook);
        setInstagram(connection.publishToInstagram);
        setActive(connection.isActive);
    }, [connection]);

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
            if (data.success) onUpdated(data.connection);
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

    return (
        <div className="rounded-2xl border border-line bg-surface p-6 sm:p-8 shadow-card">
            <Modal
                isOpen={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                onConfirm={disconnect}
                title="Disconnect this Page?"
                message={`Disconnect ${connection.pageName}? Your queued posts and published history will be kept. If the schedule is active, it will resume when you reconnect this same Page.`}
                confirmText="Disconnect"
                type="danger"
            />

            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div className="flex items-center gap-4">
                    <PageAvatar connection={connection} />
                    <div>
                        <h3 className="font-bold text-fg">{connection.pageName}</h3>
                        <div className="text-xs text-subtle mt-0.5">
                            Page ID {connection.pageId}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                            {connection.instagram ? (
                                <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20">
                                    IG @{connection.instagram.username || connection.instagram.id}
                                </span>
                            ) : (
                                <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-slate-500/10 text-muted border border-slate-500/20">
                                    No Instagram linked
                                </span>
                            )}
                            {isDisconnected ? (
                                <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-slate-500/10 text-fg-2 border border-slate-500/20">
                                    Disconnected
                                </span>
                            ) : null}
                            {needsReauth ? (
                                <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">
                                    Reconnect needed
                                </span>
                            ) : null}
                            {!connection.isActive && !isDisconnected ? (
                                <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-slate-500/10 text-muted border border-slate-500/20">
                                    Paused
                                </span>
                            ) : null}
                            <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-500/20">
                                {queuedLabel}
                            </span>
                            <button
                                type="button"
                                onClick={() => setView('brand')}
                                className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border ${
                                    connection.hasBrandLogo
                                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20'
                                        : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20'
                                }`}
                            >
                                {connection.hasBrandLogo ? 'Logo frame on' : 'No logo yet'}
                            </button>
                        </div>
                    </div>
                </div>

                {isDisconnected ? (
                    <button
                        onClick={onReconnect}
                        className="self-start text-xs font-bold text-indigo-700 dark:text-indigo-300 hover:text-indigo-800 dark:hover:text-indigo-200 px-3 py-2 rounded-lg hover:bg-indigo-500/10 transition-all"
                    >
                        Reconnect
                    </button>
                ) : (
                    <button
                        onClick={() => setConfirmOpen(true)}
                        className="self-start text-xs font-bold text-rose-700 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 px-3 py-2 rounded-lg hover:bg-rose-500/10 transition-all"
                    >
                        Disconnect
                    </button>
                )}
            </div>

            {isDisconnected ? (
                <div className="mt-5 rounded-2xl border border-slate-500/20 bg-slate-500/10 px-4 py-3 text-sm text-fg-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <span>
                        This Page is disconnected. Reconnect the Facebook
                        account that manages it to resume.
                    </span>
                    <button
                        onClick={onReconnect}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-bold"
                    >
                        Reconnect
                    </button>
                </div>
            ) : null}

            {needsReauth ? (
                <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <span>
                        Meta rejected this Page token. Reconnect to resume
                        scheduled posting.
                    </span>
                    <button
                        onClick={onReconnect}
                        className="bg-amber-500 hover:bg-amber-400 text-slate-950 px-4 py-2 rounded-xl text-xs font-bold"
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
            <div className="animate-fade-in">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mt-5">
                <div className="sm:col-span-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <label
                            htmlFor={`posts-per-day-${connection._id}`}
                            className="text-xs font-bold uppercase tracking-widest text-subtle"
                        >
                            Posting schedule
                        </label>
                        <div className="flex items-center gap-2 text-xs text-muted">
                            <select
                                id={`posts-per-day-${connection._id}`}
                                value={times.length}
                                onChange={(event) =>
                                    setTimes(
                                        suggestDailyTimes(Number(event.target.value))
                                    )
                                }
                                className="bg-surface-2 border border-line-strong rounded-lg px-2 py-1.5 text-fg focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                            >
                                {Array.from(
                                    { length: MAX_DAILY_SLOTS },
                                    (_, index) => index + 1
                                ).map((count) => (
                                    <option key={count} value={count}>
                                        {count}
                                    </option>
                                ))}
                            </select>
                            <span>
                                {times.length === 1 ? 'post a day' : 'posts a day'}
                            </span>
                        </div>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
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
                                                position === index
                                                    ? event.target.value
                                                    : value
                                            )
                                        )
                                    }
                                    className="bg-transparent pl-3 py-2.5 text-fg focus:outline-none"
                                />
                                <button
                                    type="button"
                                    aria-label={`Remove posting time ${index + 1}`}
                                    disabled={times.length === 1}
                                    onClick={() =>
                                        setTimes((current) =>
                                            current.filter(
                                                (_, position) => position !== index
                                            )
                                        )
                                    }
                                    className="px-3 py-2.5 text-subtle hover:text-rose-700 dark:hover:text-rose-300 disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                    ×
                                </button>
                            </div>
                        ))}
                        {times.length < MAX_DAILY_SLOTS ? (
                            <button
                                type="button"
                                onClick={() => setTimes(addSlot)}
                                className="rounded-xl border border-dashed border-line-strong px-3 py-2.5 text-xs font-bold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/10"
                            >
                                + Add time
                            </button>
                        ) : null}
                    </div>

                    {scheduleError ? (
                        <div className="mt-2 text-xs text-rose-700 dark:text-rose-400">
                            {scheduleError}
                        </div>
                    ) : null}
                    <p className="mt-2 text-xs text-subtle">
                        Times use your Profile timezone ({connection.timezone}).{' '}
                        <Link
                            href="/settings"
                            className="font-bold text-indigo-700 dark:text-indigo-300 hover:text-indigo-800 dark:hover:text-indigo-200"
                        >
                            Change it in Profile
                        </Link>
                    </p>
                </div>

                <div>
                    <label className="text-xs font-bold uppercase tracking-widest text-subtle">
                        Next slot
                    </label>
                    <div className="mt-2 w-full bg-surface-2 border border-line rounded-xl px-4 py-3 text-sm text-fg-2">
                        {isDisconnected
                            ? 'Waiting for reconnect'
                            : connection.isActive
                              ? formatDate(connection.nextRunAt)
                              : 'Paused'}
                    </div>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 mt-6">
                <ToggleChip
                    tone="facebook"
                    checked={facebook}
                    onToggle={() => setFacebook((value) => !value)}
                >
                    Facebook {facebook ? 'on' : 'off'}
                </ToggleChip>

                <ToggleChip
                    tone="instagram"
                    checked={instagram}
                    disabled={!connection.instagram}
                    onToggle={() => setInstagram((value) => !value)}
                >
                    Instagram {instagram ? 'on' : 'off'}
                </ToggleChip>

                <ToggleChip
                    tone="emerald"
                    checked={active}
                    onToggle={() => setActive((value) => !value)}
                >
                    {active ? 'Schedule active' : 'Schedule paused'}
                </ToggleChip>

                <button
                    onClick={save}
                    disabled={saving || Boolean(scheduleError)}
                    className="ml-auto bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all"
                >
                    {saving ? 'Saving...' : 'Save changes'}
                </button>
            </div>
            </div>
            )}

            {error ? <div className="mt-4 text-xs text-rose-700 dark:text-rose-400">{error}</div> : null}
        </div>
    );
}
