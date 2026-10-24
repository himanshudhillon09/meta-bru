'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { StatusBadge } from '@/components/Dashboards';
import { postsApi } from '@/lib/apiClient';
import {
    connectionName,
    formatDate,
    type Post,
    type TokenStatus,
} from '@/lib/types';

const TABS = [
    { key: 'queued', label: 'Queue' },
    { key: 'draft', label: 'Drafts' },
    { key: 'failed', label: 'Failed' },
    { key: 'published', label: 'Published' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function matchesTab(post: Post, tab: TabKey): boolean {
    if (tab === 'failed') return post.status === 'failed' || post.status === 'partial';
    if (tab === 'published') return post.status === 'published' || post.status === 'partial';
    return post.status === tab;
}

function destinationStatus(post: Post): TokenStatus | null {
    if (!post.connectionId || typeof post.connectionId === 'string') {
        return null;
    }
    return post.connectionId.tokenStatus;
}

export default function QueuePage() {
    const [posts, setPosts] = useState<Post[]>([]);
    const [tab, setTab] = useState<TabKey>('queued');
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState('');
    const [editingId, setEditingId] = useState('');
    const [editCaption, setEditCaption] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const load = async (showSpinner = false) => {
        if (showSpinner) setLoading(true);
        try {
            const data: any = await postsApi.list({ limit: '200' });
            setPosts(data.posts || []);
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not load posts');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const requestedTab = new URLSearchParams(window.location.search).get('tab');
        if (TABS.some((item) => item.key === requestedTab)) {
            setTab(requestedTab as TabKey);
        }

        void load(true);
        const interval = setInterval(() => void load(false), 30_000);
        return () => clearInterval(interval);
    }, []);

    const publishNow = async (post: Post) => {
        setBusyId(post._id);
        setError('');
        setNotice('');
        try {
            const data: any = await postsApi.publishNow(post._id);
            if (
                data.post?.status === 'failed' ||
                data.post?.status === 'partial'
            ) {
                setError(data.post.lastError || 'Publishing failed');
            } else {
                setNotice('Post published.');
            }
            await load();
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not publish post');
        } finally {
            setBusyId('');
        }
    };

    const retry = async (post: Post) => {
        setBusyId(post._id);
        setError('');
        setNotice('');
        try {
            const data: any = await postsApi.retry(post._id);
            if (
                data.post?.status === 'published' &&
                !data.post?.lastError
            ) {
                setNotice('Retry completed.');
            } else {
                setError(
                    data.post?.lastError ||
                        'Retry did not publish every platform. Check Activity.'
                );
            }
            await load();
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not retry post');
        } finally {
            setBusyId('');
        }
    };

    const remove = async (post: Post) => {
        setBusyId(post._id);
        setError('');
        try {
            await postsApi.remove(post._id);
            setPosts((current) => current.filter((item) => item._id !== post._id));
            setNotice('Post deleted.');
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not delete post');
        } finally {
            setBusyId('');
        }
    };

    const startEdit = (post: Post) => {
        setEditingId(post._id);
        setEditCaption(post.caption);
    };

    const saveEdit = async (post: Post) => {
        if (!editCaption.trim()) return;
        setBusyId(post._id);
        setError('');
        setNotice('');
        try {
            const data: any = await postsApi.update(post._id, {
                caption: editCaption.trim(),
            });
            setPosts((current) =>
                current.map((item) => (item._id === post._id ? data.post : item))
            );
            setEditingId('');
            setNotice('Caption updated.');
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not update post');
        } finally {
            setBusyId('');
        }
    };

    const visible = posts.filter((post) => matchesTab(post, tab));

    return (
        <AppShell
            title="Queue"
            subtitle="One post per Page per day, in the order you added them."
            actions={
                <Link
                    href="/composer"
                    className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
                >
                    New post
                </Link>
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

            <div className="flex gap-2 overflow-x-auto mb-7">
                {TABS.map((item) => (
                    <button
                        key={item.key}
                        onClick={() => setTab(item.key)}
                        className={`whitespace-nowrap px-4 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                            tab === item.key
                                ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/20'
                                : 'bg-slate-900/40 text-slate-400 border-white/5 hover:text-white'
                        }`}
                    >
                        {item.label}
                        <span className="ml-2 text-slate-500">
                            {posts.filter((post) => matchesTab(post, item.key)).length}
                        </span>
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="flex justify-center py-24">
                    <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-indigo-500" />
                </div>
            ) : visible.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-white/10 bg-slate-900/30 p-12 text-center">
                    <div className="text-lg font-bold text-white">
                        Nothing in {TABS.find((item) => item.key === tab)?.label.toLowerCase()}
                    </div>
                    <p className="text-sm text-slate-400 mt-2">
                        Posts you create in the composer show up here.
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    {visible.map((post) => {
                        const status = destinationStatus(post);
                        const publishBlocked = status !== 'active';

                        return (
                            <article
                                key={post._id}
                                className="rounded-3xl border border-white/5 bg-slate-900/40 p-5 sm:p-6 shadow-xl"
                            >
                                <div className="flex flex-col sm:flex-row gap-5">
                                    <div className="w-full sm:w-28 h-40 sm:h-28 rounded-2xl overflow-hidden bg-slate-800 shrink-0 border border-white/5">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={post.mediaUrl}
                                            alt=""
                                            className="w-full h-full object-cover"
                                        />
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-2 mb-2">
                                            <StatusBadge status={post.status} />
                                            <span className="text-xs text-slate-500">
                                                {connectionName(post)}
                                            </span>
                                            {status === 'disconnected' ||
                                            status === 'needs_reauth' ? (
                                                <Link
                                                    href="/connections"
                                                    className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border ${
                                                        status === 'disconnected'
                                                            ? 'bg-slate-500/10 text-slate-300 border-slate-500/20'
                                                            : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                                                    }`}
                                                >
                                                    {status === 'disconnected'
                                                        ? 'Page disconnected'
                                                        : 'Reconnect needed'}
                                                </Link>
                                            ) : null}
                                            <span className="text-xs text-slate-600">·</span>
                                            <span className="text-xs text-slate-500">
                                                {formatDate(post.createdAt)}
                                            </span>
                                            {post.attempts > 0 ? (
                                                <span className="text-xs text-slate-600">
                                                    attempts: {post.attempts}
                                                </span>
                                            ) : null}
                                        </div>

                                        {editingId === post._id ? (
                                            <div className="mt-2">
                                                <textarea
                                                    value={editCaption}
                                                    onChange={(event) =>
                                                        setEditCaption(
                                                            event.target.value.slice(0, 2200)
                                                        )
                                                    }
                                                    rows={5}
                                                    className="w-full bg-slate-950/80 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                                />
                                                <div className="flex gap-3 mt-2">
                                                    <button
                                                        onClick={() => saveEdit(post)}
                                                        disabled={busyId === post._id}
                                                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-xs font-bold"
                                                    >
                                                        Save
                                                    </button>
                                                    <button
                                                        onClick={() => setEditingId('')}
                                                        className="text-slate-400 px-4 py-2 rounded-lg text-xs font-bold hover:text-white"
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-sm text-slate-300 whitespace-pre-wrap line-clamp-3">
                                                {post.caption}
                                            </p>
                                        )}

                                        <div className="flex flex-wrap gap-2 mt-3">
                                            {post.targets.map((target) => (
                                                <span
                                                    key={target.platform}
                                                    className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border ${
                                                        target.status === 'published'
                                                            ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                                                            : target.status === 'failed'
                                                              ? 'bg-rose-500/10 text-rose-300 border-rose-500/20'
                                                              : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                                                    }`}
                                                >
                                                    {target.platform}: {target.status}
                                                </span>
                                            ))}
                                        </div>

                                        {post.lastError ? (
                                            <div className="mt-3 text-xs text-rose-400">
                                                {post.lastError}
                                            </div>
                                        ) : null}
                                    </div>

                                    <div className="flex sm:flex-col flex-wrap gap-2 sm:w-36 shrink-0">
                                        {(post.status === 'queued' ||
                                            post.status === 'draft' ||
                                            post.status === 'failed') && (
                                            <button
                                                onClick={() => publishNow(post)}
                                                disabled={
                                                    busyId === post._id ||
                                                    publishBlocked
                                                }
                                                title={
                                                    publishBlocked
                                                        ? 'Reconnect this Page before publishing.'
                                                        : undefined
                                                }
                                                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all"
                                            >
                                                {busyId === post._id ? 'Working...' : 'Post now'}
                                            </button>
                                        )}
                                        {(post.status === 'failed' ||
                                            post.status === 'partial') && (
                                            <button
                                                onClick={() => retry(post)}
                                                disabled={
                                                    busyId === post._id ||
                                                    publishBlocked
                                                }
                                                title={
                                                    publishBlocked
                                                        ? 'Reconnect this Page before retrying.'
                                                        : undefined
                                                }
                                                className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 px-4 py-2.5 rounded-xl text-xs font-bold transition-all"
                                            >
                                                Retry failed
                                            </button>
                                        )}
                                        {post.status !== 'publishing' &&
                                            post.status !== 'published' &&
                                            post.status !== 'partial' && (
                                                <>
                                                    <button
                                                        onClick={() => startEdit(post)}
                                                        className="bg-white/5 hover:bg-white/10 text-white border border-white/10 px-4 py-2.5 rounded-xl text-xs font-bold transition-all"
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        onClick={() => remove(post)}
                                                        disabled={busyId === post._id}
                                                        className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/10 px-4 py-2.5 rounded-xl text-xs font-bold transition-all"
                                                    >
                                                        Delete
                                                    </button>
                                                </>
                                            )}
                                    </div>
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}
        </AppShell>
    );
}
