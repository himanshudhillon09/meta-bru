'use client';

import React from 'react';
import Link from 'next/link';
import {
    formatElapsed,
    formatIstDateTime,
    type AnalyticsPost,
    type AnalyticsPostTarget,
} from '@/lib/types';

function metricValue(value: number | null, suffix = ''): string {
    return value === null ? '—' : `${value}${suffix}`;
}

function metricTitle(value: number | null, label: string): string | undefined {
    return value === null
        ? `Meta did not return ${label} for this post.`
        : undefined;
}

function TargetMetrics({
    target,
    now,
}: {
    target: AnalyticsPostTarget;
    now: number;
}) {
    const metrics = target.metrics;
    // A failed sync keeps the last numbers Meta reported.
    const keptValues = Boolean(
        metrics &&
            target.metricsAt &&
            target.snapshotAt &&
            target.metricsAt !== target.snapshotAt
    );
    return (
        <div className="rounded-xl border border-line bg-surface-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-700 dark:text-indigo-300">
                    {target.platform}
                </span>
                <span className="text-[11px] text-subtle">
                    {formatIstDateTime(target.publishedAt)}
                </span>
                <span className="text-[11px] text-faint">
                    {formatElapsed(target.publishedAt, now)}
                </span>
                {target.snapshotAt ? (
                    <span className="text-[10px] text-faint">
                        Updated{' '}
                        {formatElapsed(target.snapshotAt, now) || 'recently'}
                    </span>
                ) : null}
            </div>
            {target.status === 'permission_error' ? (
                <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                    {target.reconnectRequired !== false ? (
                        <Link
                            href="/connections?returnTo=/analytics"
                            className="underline"
                        >
                            Reconnect for insights
                        </Link>
                    ) : (
                        <span>Meta is blocking insights for this post.</span>
                    )}
                    {target.error ? (
                        <div className="mt-1 text-[10px] text-amber-700/80 dark:text-amber-200/80">
                            Meta says: {target.error}
                        </div>
                    ) : null}
                </div>
            ) : null}
            {keptValues ? (
                <div className="mt-2 text-[10px] text-subtle">
                    Showing the last values Meta reported
                    {formatElapsed(target.metricsAt, now)
                        ? ` (${formatElapsed(target.metricsAt, now)})`
                        : ''}
                    .
                </div>
            ) : null}
            {metrics ? (
                <div className="mt-2 grid grid-cols-4 gap-2 text-xs lg:grid-cols-8">
                    <div>
                        <span className="text-subtle">Reach</span>
                        <div
                            className="font-bold text-fg"
                            title={metricTitle(metrics.reach, 'reach')}
                        >
                            {metricValue(metrics.reach)}
                        </div>
                    </div>
                    <div>
                        <span className="text-subtle">Views</span>
                        <div
                            className="font-bold text-fg"
                            title={metricTitle(metrics.views, 'views')}
                        >
                            {metricValue(metrics.views)}
                        </div>
                    </div>
                    <div>
                        <span className="text-subtle">Likes</span>
                        <div
                            className="font-bold text-fg"
                            title={metricTitle(metrics.likes, 'likes')}
                        >
                            {metricValue(metrics.likes)}
                        </div>
                    </div>
                    <div>
                        <span className="text-subtle">Comments</span>
                        <div
                            className="font-bold text-fg"
                            title={metricTitle(metrics.comments, 'comments')}
                        >
                            {metricValue(metrics.comments)}
                        </div>
                    </div>
                    <div>
                        <span className="text-subtle">Shares</span>
                        <div
                            className="font-bold text-fg"
                            title={metricTitle(metrics.shares, 'shares')}
                        >
                            {metricValue(metrics.shares)}
                        </div>
                    </div>
                    <div>
                        <span className="text-subtle">Saves</span>
                        <div
                            className="font-bold text-fg"
                            title={metricTitle(metrics.saves, 'saves')}
                        >
                            {metricValue(metrics.saves)}
                        </div>
                    </div>
                    <div>
                        <span className="text-subtle">Clicks</span>
                        <div
                            className="font-bold text-fg"
                            title={metricTitle(metrics.clicks, 'clicks')}
                        >
                            {metricValue(metrics.clicks)}
                        </div>
                    </div>
                    <div>
                        <span className="text-subtle">Rate</span>
                        <div
                            className="font-bold text-emerald-700 dark:text-emerald-300"
                            title={metricTitle(
                                metrics.engagementRate,
                                'engagement rate'
                            )}
                        >
                            {metricValue(metrics.engagementRate, '%')}
                        </div>
                    </div>
                </div>
            ) : target.status !== 'permission_error' ? (
                <div className="mt-2 text-xs text-subtle">
                    Meta has not reported insights yet.
                </div>
            ) : null}
            {target.error && target.status !== 'permission_error' ? (
                <div className="mt-2 text-[10px] text-subtle">
                    {target.error}
                </div>
            ) : null}
        </div>
    );
}

export function AnalyticsPostCard({
    post,
    now,
}: {
    post: AnalyticsPost;
    now: number;
}) {
    return (
        <article className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <div className="flex flex-col gap-4 sm:flex-row">
                <div className="flex h-40 w-full items-center justify-center overflow-hidden rounded-2xl border border-line bg-sunken sm:h-28 sm:w-28 sm:shrink-0">
                    {post.mediaUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={post.mediaUrl}
                            alt=""
                            className="h-full w-full object-cover"
                        />
                    ) : (
                        <span className="text-[10px] text-faint">
                            No media
                        </span>
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-fg">
                            {post.connection.pageName}
                        </span>
                        <span className="text-[10px] uppercase tracking-widest text-subtle">
                            {post.status}
                        </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-fg-2">
                        {post.caption}
                    </p>
                    <div className="mt-3 space-y-2">
                        {post.targets.map((target) => (
                            <TargetMetrics
                                key={target.platform}
                                target={target}
                                now={now}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </article>
    );
}
