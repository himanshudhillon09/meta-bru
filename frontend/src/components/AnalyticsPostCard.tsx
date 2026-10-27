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
    return (
        <div className="rounded-xl border border-white/5 bg-slate-950/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-300">
                    {target.platform}
                </span>
                <span className="text-[11px] text-slate-500">
                    {formatIstDateTime(target.publishedAt)}
                </span>
                <span className="text-[11px] text-slate-600">
                    {formatElapsed(target.publishedAt, now)}
                </span>
                {target.snapshotAt ? (
                    <span className="text-[10px] text-slate-600">
                        Updated{' '}
                        {formatElapsed(target.snapshotAt, now) || 'recently'}
                    </span>
                ) : null}
            </div>
            {target.status === 'permission_error' ? (
                <div className="mt-2 text-xs text-amber-300">
                    <Link href="/connections" className="underline">
                        Reconnect for insights
                    </Link>
                </div>
            ) : null}
            {metrics ? (
                <div className="mt-2 grid grid-cols-4 gap-2 text-xs lg:grid-cols-8">
                    <div>
                        <span className="text-slate-500">Reach</span>
                        <div
                            className="font-bold text-white"
                            title={metricTitle(metrics.reach, 'reach')}
                        >
                            {metricValue(metrics.reach)}
                        </div>
                    </div>
                    <div>
                        <span className="text-slate-500">Views</span>
                        <div
                            className="font-bold text-white"
                            title={metricTitle(metrics.views, 'views')}
                        >
                            {metricValue(metrics.views)}
                        </div>
                    </div>
                    <div>
                        <span className="text-slate-500">Likes</span>
                        <div
                            className="font-bold text-white"
                            title={metricTitle(metrics.likes, 'likes')}
                        >
                            {metricValue(metrics.likes)}
                        </div>
                    </div>
                    <div>
                        <span className="text-slate-500">Comments</span>
                        <div
                            className="font-bold text-white"
                            title={metricTitle(metrics.comments, 'comments')}
                        >
                            {metricValue(metrics.comments)}
                        </div>
                    </div>
                    <div>
                        <span className="text-slate-500">Shares</span>
                        <div
                            className="font-bold text-white"
                            title={metricTitle(metrics.shares, 'shares')}
                        >
                            {metricValue(metrics.shares)}
                        </div>
                    </div>
                    <div>
                        <span className="text-slate-500">Saves</span>
                        <div
                            className="font-bold text-white"
                            title={metricTitle(metrics.saves, 'saves')}
                        >
                            {metricValue(metrics.saves)}
                        </div>
                    </div>
                    <div>
                        <span className="text-slate-500">Clicks</span>
                        <div
                            className="font-bold text-white"
                            title={metricTitle(metrics.clicks, 'clicks')}
                        >
                            {metricValue(metrics.clicks)}
                        </div>
                    </div>
                    <div>
                        <span className="text-slate-500">Rate</span>
                        <div
                            className="font-bold text-emerald-300"
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
                <div className="mt-2 text-xs text-slate-500">
                    Meta has not reported insights yet.
                </div>
            ) : null}
            {target.error && target.status !== 'permission_error' ? (
                <div className="mt-2 text-[10px] text-slate-500">
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
        <article className="rounded-3xl border border-white/5 bg-slate-900/40 p-5 shadow-xl">
            <div className="flex flex-col gap-4 sm:flex-row">
                <div className="flex h-40 w-full items-center justify-center overflow-hidden rounded-2xl border border-white/5 bg-slate-800 sm:h-28 sm:w-28 sm:shrink-0">
                    {post.mediaUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={post.mediaUrl}
                            alt=""
                            className="h-full w-full object-cover"
                        />
                    ) : (
                        <span className="text-[10px] text-slate-600">
                            No media
                        </span>
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-white">
                            {post.connection.pageName}
                        </span>
                        <span className="text-[10px] uppercase tracking-widest text-slate-500">
                            {post.status}
                        </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-slate-300">
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
