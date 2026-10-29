'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { ConnectionCard } from '@/components/ConnectionCard';
import { Modal } from '@/components/Modal';
import { connectionsApi } from '@/lib/apiClient';
import type { MetaLoginResult, SocialConnection } from '@/lib/types';

// The Meta login leaves the app, so remember where the user came from in
// session storage. Only known in-app pages are accepted.
const RETURN_TO_KEY = 'metaBru.connections.returnTo';
const RETURN_LABELS: Record<string, string> = {
    '/analytics': 'Back to Analytics',
    '/composer': 'Back to Composer',
    '/queue': 'Back to Queue',
};

function safeReturnTo(value: string | null): string | null {
    return value && RETURN_LABELS[value] ? value : null;
}

function readReturnTo(): string | null {
    try {
        return safeReturnTo(window.sessionStorage.getItem(RETURN_TO_KEY));
    } catch {
        return null;
    }
}

function writeReturnTo(value: string | null): void {
    try {
        if (value) window.sessionStorage.setItem(RETURN_TO_KEY, value);
        else window.sessionStorage.removeItem(RETURN_TO_KEY);
    } catch {
        // Storage can be unavailable; the link back is only a convenience.
    }
}

function loginSummary(result: MetaLoginResult): {
    notice: string;
    warnings: string[];
} {
    const added = result.added ?? [];
    const reconnected = result.reconnected ?? [];
    const parts: string[] = [];
    if (added.length > 0) parts.push(`Added ${added.join(', ')}.`);
    if (reconnected.length > 0) {
        parts.push(`Refreshed access for ${reconnected.join(', ')}.`);
    }
    if (parts.length === 0) {
        const count = Number(result.connected || 0);
        parts.push(`${count} Page${count === 1 ? '' : 's'} connected.`);
    }
    parts.push(
        reconnected.length > 0
            ? 'Schedules, queued posts, and analytics history were kept.'
            : 'Set the daily time and targets below.'
    );

    const warnings: string[] = [];
    const notIncluded = result.notIncluded ?? [];
    if (notIncluded.length > 0) {
        const one = notIncluded.length === 1;
        warnings.push(
            `Facebook left ${notIncluded.join(', ')} out of this login. If you unticked ${
                one ? 'it' : 'them'
            }, Facebook removed Meta-Bru's access, so scheduled posts and insights for ${
                one ? 'that Page' : 'those Pages'
            } will fail. Connect again and keep every Page selected. ${
                one ? 'Its' : 'Their'
            } settings and history are still saved here.`
        );
    }
    const notGranted = result.notGranted ?? [];
    if (notGranted.length > 0) {
        warnings.push(
            `Facebook did not grant ${notGranted.join(', ')}. Publishing or insights that need ${
                notGranted.length === 1 ? 'it' : 'them'
            } will fail until you connect again and allow every permission.`
        );
    }

    return { notice: parts.join(' '), warnings };
}

export default function ConnectionsPage() {
    const [connections, setConnections] = useState<SocialConnection[]>([]);
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(false);
    const [guideOpen, setGuideOpen] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [warnings, setWarnings] = useState<string[]>([]);
    const [returnTo, setReturnTo] = useState<string | null>(null);
    const completionStarted = useRef(false);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(
            window.location.hash.replace(/^#/, '')
        );
        const connected = params.get('connected');
        const oauthError = params.get('error');
        const requestedReturn = safeReturnTo(params.get('returnTo'));
        const code = hashParams.get('code');
        const state = hashParams.get('state');

        if (requestedReturn) writeReturnTo(requestedReturn);
        setReturnTo(readReturnTo());

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
        if (connected || oauthError || code || state || requestedReturn) {
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
                    const data = await connectionsApi.complete({
                        code,
                        state,
                    });
                    const summary = loginSummary(data);
                    setNotice(summary.notice);
                    setWarnings(summary.warnings);
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
            // The server schedules every Page in the Profile timezone.
            const data: any = await connectionsApi.start();
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

    const leave = () => {
        writeReturnTo(null);
    };

    const connectedPageNames = connections
        .filter((connection) => connection.tokenStatus !== 'disconnected')
        .map((connection) => connection.pageName);

    return (
        <AppShell
            title="Connections"
            subtitle="Connect the Facebook Pages and Instagram accounts this workspace can publish to."
            actions={
                <button
                    onClick={() => setGuideOpen(true)}
                    disabled={connecting}
                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
                >
                    {connecting
                        ? 'Connecting...'
                        : connections.length > 0
                          ? 'Add or reconnect Pages'
                          : 'Connect Facebook Page'}
                </button>
            }
        >
            <Modal
                isOpen={guideOpen}
                onClose={() => setGuideOpen(false)}
                onConfirm={() => void connect()}
                title="Before you continue to Facebook"
                message="Facebook will ask which Pages and Instagram accounts Meta-Bru can use, then which permissions to allow."
                confirmText="Continue to Facebook"
            >
                <ul className="space-y-2 text-sm text-fg-2 list-disc pl-5">
                    {connectedPageNames.length > 0 ? (
                        <li>
                            Keep every Page you already use selected (
                            {connectedPageNames.join(', ')}), or choose{' '}
                            <strong className="text-fg">
                                all current and future Pages
                            </strong>
                            . Facebook removes Meta-Bru&apos;s access to any
                            Page you untick.
                        </li>
                    ) : null}
                    <li>Select any new Page and its Instagram account.</li>
                    <li>
                        Leave every permission switched on, including
                        insights, so analytics can load.
                    </li>
                    {connectedPageNames.length > 0 ? (
                        <li>
                            Existing Pages are updated in place. Schedules,
                            queued posts, and analytics history stay saved.
                        </li>
                    ) : null}
                </ul>
            </Modal>

            {notice ? (
                <div className="mb-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <span>{notice}</span>
                    {returnTo && !connecting ? (
                        <Link
                            href={returnTo}
                            onClick={leave}
                            className="self-start sm:self-auto shrink-0 rounded-xl bg-emerald-500/15 px-4 py-2 text-xs font-bold text-emerald-700 dark:text-emerald-200 hover:bg-emerald-500/25"
                        >
                            {RETURN_LABELS[returnTo]}
                        </Link>
                    ) : null}
                </div>
            ) : null}
            {warnings.map((warning) => (
                <div
                    key={warning}
                    className="mb-6 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-200"
                >
                    {warning}
                </div>
            ))}
            {error ? (
                <div className="mb-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                    {error}
                </div>
            ) : null}

            {loading ? (
                <div className="flex justify-center py-24">
                    <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-indigo-500" />
                </div>
            ) : connections.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-line-strong bg-surface p-12 text-center">
                    <div className="text-xl font-bold text-fg">
                        No Pages connected yet
                    </div>
                    <p className="text-sm text-muted mt-2 max-w-md mx-auto">
                        Connect a Facebook Page you manage. If it has an
                        Instagram Business account linked, Meta-Bru will detect
                        it automatically.
                    </p>
                    <button
                        onClick={() => setGuideOpen(true)}
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
                            onReconnect={() => setGuideOpen(true)}
                        />
                    ))}
                </div>
            )}
        </AppShell>
    );
}
