'use client';

import React, { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { StatusBadge } from '@/components/Dashboards';
import { EmptyState, ListSkeleton } from '@/components/Feedback';
import { ShareStoryButton, StoryShareNotice, useStoryShare } from '@/components/ShareStory';
import { Tabs } from '@/components/Tabs';
import { postsApi } from '@/lib/apiClient';
import {
    connectionName,
    formatDate,
    postThumbnailUrl,
    type Post,
} from '@/lib/types';

const FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'published', label: 'Published' },
    { key: 'failed', label: 'Failed' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

export default function ActivityPage() {
    const [posts, setPosts] = useState<Post[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [filter, setFilter] = useState<FilterKey>('all');
    // The share response is not populated; keep the Page details we have.
    const story = useStoryShare((updated) =>
        setPosts((current) =>
            current.map((item) =>
                item._id === updated._id ? { ...updated, connectionId: item.connectionId } : item
            )
        )
    );

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
                <div className="animate-fade-up mb-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                    {error}
                </div>
            ) : null}
            <StoryShareNotice outcome={story.outcome} onDismiss={story.clearOutcome} />

            <Tabs
                label="Activity filter"
                items={FILTERS}
                value={filter}
                onChange={setFilter}
                className="mb-7"
            />

            {loading ? (
                <ListSkeleton />
            ) : visible.length === 0 ? (
                <EmptyState
                    key={filter}
                    title={filter === 'all' ? 'No publishing activity yet' : `Nothing ${filter} yet`}
                    body="Published and failed posts will appear here."
                />
            ) : (
                <div key={filter} className="stagger space-y-4">
                    {visible.map((post) => (
                        <article
                            key={post._id}
                            className="rounded-2xl border border-line bg-surface p-5 sm:p-6 shadow-card transition-[border-color,box-shadow,translate] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-card-hover"
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
                                        <div className="ml-auto">
                                            <ShareStoryButton
                                                post={post}
                                                onOpen={story.open}
                                                sharing={story.sharingId === post._id}
                                                size="sm"
                                            />
                                        </div>
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
            {story.modal}
        </AppShell>
    );
}
