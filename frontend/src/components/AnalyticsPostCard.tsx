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
            </div>
            {target.status === 'permission_error' ? (
                <div className="mt-2 text-xs text-amber-300">
                    <Link href="/connections" className="underline">
                        Reconnect for insights
                    </Link>
                </div>
            ) : !metrics ? (
                <div className="mt-2 text-xs text-slate-500">
                    Meta has not reported insights yet.
                </div>
            ) : (
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs sm:grid-cols-6">
                    <div>
                        <span className="text-slate-500">Reach</span>
                        <div className="font-bold text-white">
                            {metricValue(metrics.reach)}
                        </div>
                    </div>
                    <div>
                        <span className="text-slate-500">Views</span>
                        <div className="font-bold text-white">
                            {metricValue(metrics.views)}
                        </div>
                    </div>
                    <div>
                        <span className="text-slate-500">Likes</span>
                        <div className="font-bold text-white">
                            {metricValue(metrics.likes)}
                        </div>
                    </div>
                    <div>
                        <span className="text-slate-500">Comments</span>
                        <div className="font-bold text-white">
                            {metricValue(metrics.comments)}
                        </div>
                    </div>
                    <div>
                        <span className="text-slate-500">Shares</span>
                        <div className="font-bold text-white">
                            {metricValue(metrics.shares)}
                        </div>
                    </div>
                    <div>
                        <span className="text-slate-500">Rate</span>
                        <div className="font-bold text-emerald-300">
                            {metricValue(metrics.engagementRate, '%')}
                        </div>
                    </div>
                </div>
            )}
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
                <div className="h-40 w-full overflow-hidden rounded-2xl border border-white/5 bg-slate-800 sm:h-28 sm:w-28 sm:shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={post.mediaUrl}
                        alt=""
                        className="h-full w-full object-cover"
                    />
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
