'use client';

import React, { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { connectionsApi } from '@/lib/apiClient';
import {
    formatDate,
    type SocialConnection,
} from '@/lib/types';
import {
    getInitialTimezoneOptions,
    getTimezoneOptions,
} from '@/lib/timezones';

interface ConnectionCardProps {
    connection: SocialConnection;
    onUpdated: (connection: SocialConnection) => void;
    onDisconnected: (connection: SocialConnection) => void;
}

export function ConnectionCard({
    connection,
    onUpdated,
    onDisconnected,
}: ConnectionCardProps) {
    const [dailyTime, setDailyTime] = useState(connection.dailyTime);
    const [timezone, setTimezone] = useState(connection.timezone);
    const [facebook, setFacebook] = useState(connection.publishToFacebook);
    const [instagram, setInstagram] = useState(connection.publishToInstagram);
    const [active, setActive] = useState(connection.isActive);
    const [timezones, setTimezones] = useState(() =>
        getInitialTimezoneOptions(connection.timezone)
    );
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [confirmOpen, setConfirmOpen] = useState(false);

    const isDisconnected = connection.tokenStatus === 'disconnected';
    const needsReauth = connection.tokenStatus === 'needs_reauth';
    const queuedCount = connection.queuedCount ?? 0;
    const queuedLabel = `${queuedCount} queued ${
        queuedCount === 1 ? 'post' : 'posts'
    }`;

    useEffect(() => {
        setDailyTime(connection.dailyTime);
        setTimezone(connection.timezone);
        setFacebook(connection.publishToFacebook);
        setInstagram(connection.publishToInstagram);
        setActive(connection.isActive);
    }, [connection]);

    useEffect(() => {
        setTimezones(getTimezoneOptions(connection.timezone));
    }, [connection.timezone]);

    const save = async () => {
        setSaving(true);
        setError('');
        try {
            const data: any = await connectionsApi.update(connection._id, {
                dailyTime,
                timezone,
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

    const reconnect = async () => {
        try {
            const data: any = await connectionsApi.start(timezone);
            if (data.url) window.location.href = data.url;
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not start Meta login');
        }
    };

    const disconnect = async () => {
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
        <div className="rounded-3xl border border-white/5 bg-slate-900/40 p-6 sm:p-8 shadow-xl">
            <Modal
                isOpen={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                onConfirm={disconnect}
                title="Disconnect this Page?"
                message={`Disconnect ${connection.pageName}? Your ${queuedLabel} and published history will be kept. If the schedule is active, it will resume when you reconnect this same Page.`}
                confirmText="Disconnect"
                type="danger"
            />

            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-500/15 border border-indigo-500/20 flex items-center justify-center text-lg font-black text-indigo-300">
                        {connection.pageName[0]?.toUpperCase() || 'P'}
                    </div>
                    <div>
                        <h3 className="font-bold text-white">{connection.pageName}</h3>
                        <div className="text-xs text-slate-500 mt-0.5">
                            Page ID {connection.pageId}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                            {connection.instagram ? (
                                <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-300 border border-rose-500/20">
                                    IG @{connection.instagram.username || connection.instagram.id}
                                </span>
                            ) : (
                                <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/20">
                                    No Instagram linked
                                </span>
                            )}
                            {isDisconnected ? (
                                <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-slate-500/10 text-slate-300 border border-slate-500/20">
                                    Disconnected
                                </span>
                            ) : null}
                            {needsReauth ? (
                                <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
                                    Reconnect needed
                                </span>
                            ) : null}
                            {!connection.isActive && !isDisconnected ? (
                                <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/20">
                                    Paused
                                </span>
                            ) : null}
                            <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                                {queuedCount} {queuedCount === 1 ? 'post' : 'posts'} waiting
                            </span>
                        </div>
                    </div>
                </div>

                {isDisconnected ? (
                    <button
                        onClick={reconnect}
                        className="self-start text-xs font-bold text-indigo-300 hover:text-indigo-200 px-3 py-2 rounded-lg hover:bg-indigo-500/10 transition-all"
                    >
                        Reconnect
                    </button>
                ) : (
                    <button
                        onClick={() => setConfirmOpen(true)}
                        className="self-start text-xs font-bold text-rose-400 hover:text-rose-300 px-3 py-2 rounded-lg hover:bg-rose-500/10 transition-all"
                    >
                        Disconnect
                    </button>
                )}
            </div>

            {isDisconnected ? (
                <div className="mt-5 rounded-2xl border border-slate-500/20 bg-slate-500/10 px-4 py-3 text-sm text-slate-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <span>
                        This Page is disconnected.{' '}
                        {queuedCount > 0
                            ? `${queuedLabel} will wait for this Page.`
                            : 'There are no queued posts waiting.'}{' '}
                        Reconnect the Facebook account that manages it to
                        resume.
                    </span>
                    <button
                        onClick={reconnect}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-black"
                    >
                        Reconnect
                    </button>
                </div>
            ) : null}

            {needsReauth ? (
                <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <span>
                        Meta rejected this Page token. Reconnect to resume
                        scheduled posting.
                    </span>
                    <button
                        onClick={reconnect}
                        className="bg-amber-500 hover:bg-amber-400 text-slate-950 px-4 py-2 rounded-xl text-xs font-black"
                    >
                        Reconnect
                    </button>
                </div>
            ) : null}

            {connection.lastError && connection.tokenStatus === 'active' ? (
                <div className="mt-5 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
                    Last error: {connection.lastError}
                </div>
            ) : null}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mt-7">
                <div>
                    <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                        Daily time
                    </label>
                    <input
                        type="time"
                        value={dailyTime}
                        onChange={(event) => setDailyTime(event.target.value)}
                        className="mt-2 w-full bg-slate-950/80 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    />
                </div>

                <div>
                    <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                        Timezone
                    </label>
                    <select
                        value={timezone}
                        onChange={(event) => setTimezone(event.target.value)}
                        className="mt-2 w-full bg-slate-950/80 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    >
                        {timezones.map((zone) => (
                            <option key={zone} value={zone}>
                                {zone}
                            </option>
                        ))}
                    </select>
                </div>

                <div>
                    <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                        Next slot
                    </label>
                    <div className="mt-2 w-full bg-slate-950/40 border border-white/5 rounded-xl px-4 py-3 text-sm text-slate-300">
                        {isDisconnected
                            ? 'Waiting for reconnect'
                            : connection.isActive
                              ? formatDate(connection.nextRunAt)
                              : 'Paused'}
                    </div>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 mt-6">
                <button
                    type="button"
                    onClick={() => setFacebook((value) => !value)}
                    className={`px-4 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                        facebook
                            ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                            : 'bg-slate-950/50 text-slate-500 border-white/5'
                    }`}
                >
                    Facebook {facebook ? 'on' : 'off'}
                </button>

                <button
                    type="button"
                    disabled={!connection.instagram}
                    onClick={() => setInstagram((value) => !value)}
                    className={`px-4 py-2.5 rounded-xl text-xs font-bold border transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                        instagram
                            ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                            : 'bg-slate-950/50 text-slate-500 border-white/5'
                    }`}
                >
                    Instagram {instagram ? 'on' : 'off'}
                </button>

                <button
                    type="button"
                    onClick={() => setActive((value) => !value)}
                    className={`px-4 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                        active
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                            : 'bg-slate-950/50 text-slate-500 border-white/5'
                    }`}
                >
                    {active ? 'Schedule active' : 'Schedule paused'}
                </button>

                <button
                    onClick={save}
                    disabled={saving}
                    className="ml-auto bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-xs font-black transition-all"
                >
                    {saving ? 'Saving...' : 'Save changes'}
                </button>
            </div>

            {error ? <div className="mt-4 text-xs text-rose-400">{error}</div> : null}
        </div>
    );
}
