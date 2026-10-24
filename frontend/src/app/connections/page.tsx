'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ConnectionCard } from '@/components/ConnectionCard';
import { useAuth } from '@/context/AuthContext';
import { connectionsApi } from '@/lib/apiClient';
import type { SocialConnection } from '@/lib/types';

export default function ConnectionsPage() {
    const { user } = useAuth();
    const [connections, setConnections] = useState<SocialConnection[]>([]);
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const completionStarted = useRef(false);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(
            window.location.hash.replace(/^#/, '')
        );
        const connected = params.get('connected');
        const oauthError = params.get('error');
        const code = hashParams.get('code');
        const state = hashParams.get('state');

        if (connected) {
            setNotice(
                `${connected} Page${connected === '1' ? '' : 's'} connected. Set the daily time and targets below.`
            );
        }
        if (oauthError) {
            // URLSearchParams already decodes percent escapes and "+".
            setError(oauthError);
        }

        // Remove the one-time OAuth code from the address bar and history.
        if (connected || oauthError || code || state) {
            window.history.replaceState({}, '', '/connections');
        }

        const load = async () => {
            try {
                const data: any = await connectionsApi.list();
                setConnections(data.connections || []);
            } catch (err: any) {
                setError(typeof err === 'string' ? err : 'Could not load connections');
            } finally {
                setLoading(false);
            }
        };

        if (code && state) {
            // The backend redirects here with a one-time code. Finish the
            // exchange with this browser's authenticated token, which binds the
            // callback to the account that started the OAuth flow.
            if (completionStarted.current) return;
            completionStarted.current = true;
            setConnecting(true);
            setNotice('Finishing Meta connection...');

            void (async () => {
                try {
                    const data: any = await connectionsApi.complete({
                        code,
                        state,
                    });
                    const count = Number(data.connected || 0);
                    setNotice(
                        `${count} Page${count === 1 ? '' : 's'} connected. Set the daily time and targets below.`
                    );
                } catch (err: any) {
                    setNotice('');
                    setError(
                        typeof err === 'string'
                            ? err
                            : 'Could not finish Meta connection'
                    );
                } finally {
                    setConnecting(false);
                }
                await load();
            })();
            return;
        }

        if (code || state) {
            setError('Meta login response was incomplete. Please connect again.');
        }
        void load();
    }, []);

    const connect = async () => {
        setConnecting(true);
        setError('');
        try {
            const timezone =
                user?.timezone ||
                Intl.DateTimeFormat().resolvedOptions().timeZone ||
                'Asia/Kolkata';
            const data: any = await connectionsApi.start(timezone);
            if (data.url) {
                window.location.href = data.url;
                return;
            }
            throw new Error('Meta login URL was not returned');
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not start Meta login');
            setConnecting(false);
        }
    };

    const mergeConnection = (updated: SocialConnection) => {
        setConnections((current) =>
            current.map((connection) =>
                connection._id === updated._id
                    ? {
                          ...connection,
                          ...updated,
                          queuedCount:
                              updated.queuedCount ?? connection.queuedCount,
                      }
                    : connection
            )
        );
    };

    const updateConnection = (updated: SocialConnection) => {
        mergeConnection(updated);
        setNotice('Connection settings saved.');
    };

    const disconnectConnection = (updated: SocialConnection) => {
        mergeConnection(updated);
        setNotice(
            'Page disconnected. Queued posts will resume when you reconnect this Page.'
        );
    };

    return (
        <AppShell
            title="Connections"
            subtitle="Connect the Facebook Pages and Instagram accounts this workspace can publish to."
            actions={
                <button
                    onClick={connect}
                    disabled={connecting}
                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
                >
                    {connecting ? 'Connecting...' : 'Connect Facebook Page'}
                </button>
            }
        >
            {notice ? (
                <div className="mb-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                    {notice}
                </div>
            ) : null}
            {error ? (
                <div className="mb-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                    {error}
                </div>
            ) : null}

            {loading ? (
                <div className="flex justify-center py-24">
                    <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-indigo-500" />
                </div>
            ) : connections.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-white/10 bg-slate-900/30 p-12 text-center">
                    <div className="text-xl font-bold text-white">
                        No Pages connected yet
                    </div>
                    <p className="text-sm text-slate-400 mt-2 max-w-md mx-auto">
                        Connect a Facebook Page you manage. If it has an
                        Instagram Business account linked, Meta-Bru will detect
                        it automatically.
                    </p>
                    <button
                        onClick={connect}
                        disabled={connecting}
                        className="mt-6 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white px-6 py-3 rounded-xl text-sm font-bold transition-all"
                    >
                        {connecting ? 'Connecting...' : 'Connect Facebook Page'}
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-6">
                    {connections.map((connection) => (
                        <ConnectionCard
                            key={connection._id}
                            connection={connection}
                            onUpdated={updateConnection}
                            onDisconnected={disconnectConnection}
                        />
                    ))}
                </div>
            )}
        </AppShell>
    );
}
