'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Tabs } from '@/components/Tabs';
import { formatIstDateTime, ideaHref, type AnalyticsTopPost } from '@/lib/types';
import { formatCompact, formatPercent } from './format';

const VIEWS = [
    { key: 'reach', label: 'Most reach' },
    { key: 'engagement', label: 'Best engagement' },
] as const;

type ViewKey = (typeof VIEWS)[number]['key'];

/** The posts worth repeating, with a one-click start on another like them. */
export function TopPosts({ topPosts }: { topPosts: { byReach: AnalyticsTopPost[]; byEngagement: AnalyticsTopPost[] } }) {
    const [view, setView] = useState<ViewKey>('reach');
    const posts = view === 'reach' ? topPosts.byReach : topPosts.byEngagement;

    return (
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="text-sm font-bold text-fg">Top posts</h2>
                    <p className="mt-0.5 text-xs text-muted">
                        What worked best in this range. Make more like these.
                    </p>
                </div>
                <Tabs label="Rank posts by" variant="segmented" items={VIEWS} value={view} onChange={setView} />
            </div>

            {posts.length === 0 ? (
                <p className="mt-4 rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-xs text-subtle">
                    {view === 'engagement'
                        ? 'No post has reached 10 people yet, so engagement rates are not reliable.'
                        : 'No insights yet for posts in this range. Refresh insights to load them.'}
                </p>
            ) : (
                <ol className="mt-4 divide-y divide-line">
                    {posts.map((post, index) => (
                        <li key={post.postId} className="flex items-center gap-3 py-3">
                            <span className="w-5 shrink-0 text-center text-sm font-bold text-subtle">{index + 1}</span>
                            {post.mediaUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    src={post.mediaUrl}
                                    alt=""
                                    loading="lazy"
                                    className="h-12 w-12 shrink-0 rounded-lg border border-line object-cover"
                                />
                            ) : (
                                <span className="h-12 w-12 shrink-0 rounded-lg border border-line bg-sunken" />
                            )}
                            <div className="min-w-0 flex-1">
                                <p className="line-clamp-1 text-xs font-semibold text-fg">
                                    {post.caption || 'No caption'}
                                </p>
                                <p className="mt-0.5 text-[11px] text-subtle">
                                    {post.source === 'native' ? (
                                        <span className="mr-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                                            Posted directly
                                        </span>
                                    ) : null}
                                    {post.mediaType === 'reel' ? 'Reel' : 'Post'} · {post.pageName} ·{' '}
                                    {post.platforms
                                        .map((platform) => (platform === 'facebook' ? 'Facebook' : 'Instagram'))
                                        .join(' + ')}{' '}
                                    · {formatIstDateTime(post.publishedAt)}
                                </p>
                            </div>
                            <dl className="hidden shrink-0 grid-cols-3 gap-4 text-right text-xs tabular-nums sm:grid">
                                <div>
                                    <dt className="text-[10px] text-subtle">Reach</dt>
                                    <dd className={`font-bold ${view === 'reach' ? 'text-fg' : 'text-fg-2'}`}>
                                        {formatCompact(post.reach)}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-[10px] text-subtle">Interactions</dt>
                                    <dd className="font-bold text-fg-2">{formatCompact(post.interactions)}</dd>
                                </div>
                                <div>
                                    <dt className="text-[10px] text-subtle">Engagement</dt>
                                    <dd className={`font-bold ${view === 'engagement' ? 'text-fg' : 'text-fg-2'}`}>
                                        {formatPercent(post.engagementRate)}
                                    </dd>
                                </div>
                            </dl>
                            <Link
                                href={ideaHref({
                                    format: post.mediaType === 'reel' ? 'reel' : 'post',
                                    topic: post.caption.split('\n')[0]?.slice(0, 140) || post.caption.slice(0, 140),
                                })}
                                className="shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-indigo-700 hover:bg-indigo-500/10 dark:text-indigo-300"
                                title="Open the Composer with this post's topic"
                            >
                                More like this →
                            </Link>
                        </li>
                    ))}
                </ol>
            )}
        </section>
    );
}
