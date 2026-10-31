'use client';

import React from 'react';
import Link from 'next/link';
import { ShareStoryButton } from '@/components/ShareStory';
import {
    formatDuration,
    formatElapsed,
    formatIstDateTime,
    formatWatchTime,
    type AnalyticsPost,
    type AnalyticsPostTarget,
    type StoryShareSubject,
} from '@/lib/types';

function metricValue(value: number | null, suffix = ''): string {
    return value === null ? '—' : `${value}${suffix}`;
}

function metricTitle(value: number | null, label: string): string | undefined {
    return value === null
        ? `Meta did not return ${label} for this post.`
        : undefined;
}

/** How much of the reel people watched, as a bar. */
function WatchBar({ avgWatchTimeMs, duration }: { avgWatchTimeMs: number; duration: number }) {
    const percent = Math.min(100, Math.round((avgWatchTimeMs / (duration * 1000)) * 100));
    const tone =
        percent >= 60 ? 'bg-emerald-500' : percent >= 35 ? 'bg-amber-500' : 'bg-rose-500';
    return (
        <div className="mt-3">
            <div className="flex items-center justify-between text-[11px]">
                <span className="text-subtle">
                    Watched on average: {formatWatchTime(avgWatchTimeMs)} of {formatDuration(duration)}
                </span>
                <span className="font-bold text-fg">{percent}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken">
                <div className={`h-full rounded-full ${tone}`} style={{ width: `${percent}%` }} />
            </div>
        </div>
    );
}

function TargetMetrics({
    target,
    now,
    reel,
    duration,
}: {
    target: AnalyticsPostTarget;
    now: number;
    reel: boolean;
    duration: number | null;
}) {
    const metrics = target.metrics;
    const avgWatch = metrics?.avgWatchTimeMs ?? null;
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
                        <span className="text-subtle">{reel ? 'Plays' : 'Views'}</span>
                        <div
                            className="font-bold text-fg"
                            title={metricTitle(metrics.views, reel ? 'plays' : 'views')}
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
                    {reel ? (
                        <div>
                            <span className="text-subtle">Avg watch</span>
                            <div
                                className="font-bold text-fg"
                                title={metricTitle(avgWatch, 'watch time')}
                            >
                                {formatWatchTime(avgWatch)}
                            </div>
                        </div>
                    ) : (
                        <div>
                            <span className="text-subtle">Clicks</span>
                            <div
                                className="font-bold text-fg"
                                title={metricTitle(metrics.clicks, 'clicks')}
                            >
                                {metricValue(metrics.clicks)}
                            </div>
                        </div>
                    )}
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
            {reel && duration && avgWatch !== null && avgWatch > 0 ? (
                <WatchBar avgWatchTimeMs={avgWatch} duration={duration} />
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
    onShareStory,
    sharing = false,
}: {
    post: AnalyticsPost;
    now: number;
    onShareStory?: (post: StoryShareSubject) => void;
    sharing?: boolean;
}) {
    const reel = post.mediaType === 'reel';
    // A post made outside Meta-Bru cannot be shared to Story from here.
    const native = post.source === 'native';
    // Analytics only lists published platforms, which is all sharing needs.
    const shareSubject: StoryShareSubject = {
        _id: post.postId,
        mediaType: post.mediaType,
        targets: post.targets.map((target) => ({ platform: target.platform, status: 'published' })),
        storyTargets: post.storyTargets ?? [],
    };
    return (
        <article className="rounded-2xl border border-line bg-surface p-5 shadow-card transition-[border-color,box-shadow] duration-200 hover:border-line-strong hover:shadow-card-hover">
            <div className="flex flex-col gap-4 sm:flex-row">
                <div className="relative flex h-40 w-full items-center justify-center overflow-hidden rounded-2xl border border-line bg-sunken sm:h-28 sm:w-28 sm:shrink-0">
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
                    {reel && post.mediaDuration ? (
                        <span className="absolute bottom-1.5 left-1.5 rounded-md bg-slate-950/70 px-1.5 py-0.5 text-[10px] font-bold text-white">
                            ▶ {formatDuration(post.mediaDuration)}
                        </span>
                    ) : null}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-fg">
                            {post.connection.pageName}
                        </span>
                        {reel ? (
                            <span className="rounded-full border border-fuchsia-500/20 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-fuchsia-700 dark:text-fuchsia-300">
                                Reel
                            </span>
                        ) : null}
                        {native ? (
                            <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">
                                Posted directly
                            </span>
                        ) : (
                            <span className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-indigo-700 dark:text-indigo-300">
                                Meta-Bru
                            </span>
                        )}
                        {native && post.permalink ? (
                            <a
                                href={post.permalink}
                                target="_blank"
                                rel="noreferrer"
                                className="ml-auto text-xs font-bold text-indigo-700 hover:underline dark:text-indigo-300"
                            >
                                Open on {post.targets[0]?.platform === 'instagram' ? 'Instagram' : 'Facebook'} ↗
                            </a>
                        ) : null}
                        {onShareStory && !native ? (
                            <div className="ml-auto">
                                <ShareStoryButton
                                    post={shareSubject}
                                    onOpen={onShareStory}
                                    sharing={sharing}
                                    size="sm"
                                />
                            </div>
                        ) : null}
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
                                reel={reel}
                                duration={post.mediaDuration ?? null}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </article>
    );
}
