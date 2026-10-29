'use client';

import React, { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { StatusBadge } from '@/components/Dashboards';
import { postsApi } from '@/lib/apiClient';
import {
    connectionName,
    formatDate,
    postThumbnailUrl,
    type Post,
} from '@/lib/types';

export default function ActivityPage() {
    const [posts, setPosts] = useState<Post[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [filter, setFilter] = useState<'all' | 'published' | 'failed'>('all');

    const load = async () => {
        try {
            const data: any = await postsApi.list({ limit: '200' });
            setPosts(
                (data.posts || []).filter(
                    (post: Post) =>
                        post.status === 'published' ||
                        post.status === 'partial' ||
                        post.status === 'failed'
                )
            );
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not load activity');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
        const interval = setInterval(() => void load(), 30_000);
        return () => clearInterval(interval);
    }, []);

    const visible = posts.filter((post) => {
        if (filter === 'published') {
            return post.status === 'published' || post.status === 'partial';
        }
        if (filter === 'failed') {
            return post.status === 'failed' || post.status === 'partial';
        }
        return true;
    });

    return (
        <AppShell
            title="Activity"
            subtitle="Publishing results and errors from Facebook and Instagram."
        >
            {error ? (
                <div className="mb-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                    {error}
                </div>
            ) : null}

            <div className="flex gap-2 mb-7">
                {[
                    { key: 'all', label: 'All' },
                    { key: 'published', label: 'Published' },
                    { key: 'failed', label: 'Failed' },
                ].map((item) => (
                    <button
                        key={item.key}
                        onClick={() => setFilter(item.key as typeof filter)}
                        className={`px-4 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                            filter === item.key
                                ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/20'
                                : 'bg-surface text-muted border-line hover:text-fg'
                        }`}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="flex justify-center py-24">
                    <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-indigo-500" />
                </div>
            ) : visible.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-line-strong bg-surface p-12 text-center">
                    <div className="text-lg font-bold text-fg">
                        No publishing activity yet
                    </div>
                    <p className="text-sm text-muted mt-2">
                        Published and failed posts will appear here.
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    {visible.map((post) => (
                        <article
                            key={post._id}
                            className="rounded-2xl border border-line bg-surface p-5 sm:p-6 shadow-card"
                        >
                            <div className="flex flex-col sm:flex-row gap-5">
                                <div className="w-full sm:w-24 h-36 sm:h-24 rounded-2xl overflow-hidden bg-sunken shrink-0 border border-line">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={postThumbnailUrl(post)}
                                        alt=""
                                        className="w-full h-full object-cover"
                                    />
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex flex-wrap items-center gap-2 mb-2">
                                        <StatusBadge status={post.status} />
                                        <span className="text-xs text-subtle">
                                            {connectionName(post)}
                                        </span>
                                        <span className="text-xs text-faint">·</span>
                                        <span className="text-xs text-subtle">
                                            {formatDate(post.publishedAt || post.updatedAt)}
                                        </span>
                                    </div>

                                    <p className="text-sm text-fg-2 whitespace-pre-wrap line-clamp-2">
                                        {post.caption}
                                    </p>

                                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {post.targets.map((target) => (
                                            <div
                                                key={target.platform}
                                                className={`rounded-2xl border px-4 py-3 ${
                                                    target.status === 'published'
                                                        ? 'border-emerald-500/15 bg-emerald-500/5'
                                                        : target.status === 'failed'
                                                          ? 'border-rose-500/15 bg-rose-500/5'
                                                          : 'border-line bg-surface-2'
                                                }`}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="text-xs font-bold uppercase tracking-widest text-fg-2">
                                                        {target.platform}
                                                    </span>
                                                    <span
                                                        className={`text-[10px] font-bold uppercase tracking-widest ${
                                                            target.status === 'published'
                                                                ? 'text-emerald-700 dark:text-emerald-400'
                                                                : target.status === 'failed'
                                                                  ? 'text-rose-700 dark:text-rose-400'
                                                                  : 'text-subtle'
                                                        }`}
                                                    >
                                                        {target.status}
                                                    </span>
                                                </div>
                                                {target.externalId ? (
                                                    <div className="text-[11px] text-subtle mt-1 break-all">
                                                        {target.platform === 'facebook' ? (
                                                            <a
                                                                href={`https://www.facebook.com/${target.externalId}`}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className="text-indigo-700 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
                                                            >
                                                                {target.externalId}
                                                            </a>
                                                        ) : (
                                                            <>Media ID {target.externalId}</>
                                                        )}
                                                    </div>
                                                ) : null}
                                                {target.error ? (
                                                    <div className="text-[11px] text-rose-700 dark:text-rose-400 mt-1">
                                                        {target.error}
                                                    </div>
                                                ) : null}
                                            </div>
                                        ))}
                                    </div>

                                    {post.attempts > 0 ? (
                                        <div className="text-[11px] text-faint mt-3">
                                            Attempts: {post.attempts}
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </AppShell>
    );
}
