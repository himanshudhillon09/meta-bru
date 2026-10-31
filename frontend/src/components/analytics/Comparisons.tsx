'use client';

import React from 'react';
import Link from 'next/link';
import { formatWatchTime, type AnalyticsSummary } from '@/lib/types';
import { formatCompact, formatPercent } from './format';

interface Side {
    name: string;
    color: string;
}

interface PairRow {
    label: string;
    a: number | null;
    b: number | null;
    format: (value: number | null) => string;
}

/**
 * Two things compared metric by metric. Each metric has its own scale, so a
 * rate never shares an axis with a count.
 */
function PairedBars({ a, b, rows }: { a: Side; b: Side; rows: PairRow[] }) {
    return (
        <div>
            <div className="flex flex-wrap gap-4 text-xs text-muted">
                {[a, b].map((side) => (
                    <span key={side.name} className="inline-flex items-center gap-1.5">
                        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: side.color }} />
                        {side.name}
                    </span>
                ))}
            </div>
            <dl className="mt-3 space-y-3">
                {rows.map((row) => {
                    const max = Math.max(row.a ?? 0, row.b ?? 0);
                    return (
                        <div key={row.label}>
                            <dt className="text-[11px] font-semibold text-subtle">{row.label}</dt>
                            {[
                                { side: a, value: row.a },
                                { side: b, value: row.b },
                            ].map(({ side, value }) => (
                                <dd key={side.name} className="mt-1 flex items-center gap-2">
                                    <div className="h-2.5 flex-1 overflow-hidden rounded-r bg-sunken">
                                        <div
                                            className="h-full rounded-r transition-[width] duration-700 ease-out"
                                            style={{
                                                width: `${max > 0 && value ? Math.max(2, (value / max) * 100) : 0}%`,
                                                background: side.color,
                                            }}
                                            title={`${side.name}: ${row.format(value)}`}
                                        />
                                    </div>
                                    <span className="w-16 shrink-0 text-right text-xs font-semibold tabular-nums text-fg">
                                        {row.format(value)}
                                    </span>
                                </dd>
                            ))}
                        </div>
                    );
                })}
            </dl>
        </div>
    );
}

function ratio(a: number, b: number): string {
    const value = a / b;
    return value >= 10 ? `${Math.round(value)}×` : `${Math.round(value * 10) / 10}×`;
}

function perPost(summary: AnalyticsSummary, key: 'reach' | 'interactions'): number | null {
    return summary.posts > 0 ? Math.round(summary[key] / summary.posts) : null;
}

export function PlatformCompare({ facebook, instagram }: { facebook: AnalyticsSummary; instagram: AnalyticsSummary }) {
    const both = facebook.posts > 0 && instagram.posts > 0;
    const fbRate = facebook.engagementRate;
    const igRate = instagram.engagementRate;
    let verdict = 'Publish to both to compare them.';
    if (both && fbRate !== null && igRate !== null && fbRate !== igRate) {
        const [winner, loser, high, low] =
            igRate > fbRate ? ['Instagram', 'Facebook', igRate, fbRate] : ['Facebook', 'Instagram', fbRate, igRate];
        verdict =
            low > 0
                ? `${winner} engages ${ratio(high, low)} better than ${loser}.`
                : `${winner} is getting all the engagement.`;
    } else if (both) {
        verdict = 'Both platforms engage about the same.';
    } else if (facebook.posts > 0 || instagram.posts > 0) {
        verdict = `Only ${facebook.posts > 0 ? 'Facebook' : 'Instagram'} has posts in this range.`;
    }

    return (
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <h2 className="text-sm font-bold text-fg">Facebook vs Instagram</h2>
            <p className="mt-0.5 text-xs text-muted">{verdict}</p>
            <div className="mt-4">
                <PairedBars
                    a={{ name: 'Facebook', color: 'var(--viz-facebook)' }}
                    b={{ name: 'Instagram', color: 'var(--viz-instagram)' }}
                    rows={[
                        { label: 'Reach', a: facebook.reach, b: instagram.reach, format: formatCompact },
                        { label: 'Interactions', a: facebook.interactions, b: instagram.interactions, format: formatCompact },
                        { label: 'Engagement rate', a: fbRate, b: igRate, format: formatPercent },
                        { label: 'Posts', a: facebook.facebookPosts || facebook.posts, b: instagram.instagramPosts || instagram.posts, format: formatCompact },
                    ]}
                />
            </div>
        </section>
    );
}

export function FormatCompare({ image, reel }: { image: AnalyticsSummary; reel: AnalyticsSummary }) {
    const imageReach = perPost(image, 'reach');
    const reelReach = perPost(reel, 'reach');
    let verdict = 'Post both images and reels to see which grows faster.';
    if (imageReach !== null && reelReach !== null && imageReach !== reelReach) {
        verdict =
            reelReach > imageReach
                ? imageReach > 0
                    ? `Reels reach ${ratio(reelReach, imageReach)} more people per post than images. Make more reels.`
                    : 'Reels are reaching people; image posts are not yet.'
                : reelReach > 0
                  ? `Image posts reach ${ratio(imageReach, reelReach)} more people per post than reels.`
                  : 'Image posts are reaching people; reels are not yet.';
    } else if (reel.posts === 0 && image.posts > 0) {
        verdict = 'No reels in this range. Reels reach people who do not follow you yet.';
    }

    return (
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                    <h2 className="text-sm font-bold text-fg">Image posts vs Reels</h2>
                    <p className="mt-0.5 text-xs text-muted">{verdict}</p>
                </div>
                {reel.posts === 0 ? (
                    <Link
                        href="/reels"
                        className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-indigo-700 hover:bg-indigo-500/10 dark:text-indigo-300"
                    >
                        Make a reel →
                    </Link>
                ) : null}
            </div>
            <div className="mt-4">
                <PairedBars
                    a={{ name: `Image posts (${image.posts})`, color: 'var(--viz-1)' }}
                    b={{ name: `Reels (${reel.posts})`, color: 'var(--viz-reel)' }}
                    rows={[
                        { label: 'Average reach per post', a: imageReach, b: reelReach, format: formatCompact },
                        {
                            label: 'Average interactions per post',
                            a: perPost(image, 'interactions'),
                            b: perPost(reel, 'interactions'),
                            format: formatCompact,
                        },
                        { label: 'Engagement rate', a: image.engagementRate, b: reel.engagementRate, format: formatPercent },
                    ]}
                />
            </div>
            {reel.posts > 0 ? (
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 text-xs">
                    <div>
                        <div className="text-subtle">Average watch time</div>
                        <div className="mt-0.5 font-bold text-fg">{formatWatchTime(reel.avgWatchTimeMs)}</div>
                    </div>
                    <div>
                        <div className="text-subtle">Share of each reel watched</div>
                        <div className="mt-0.5 font-bold text-fg">{formatPercent(reel.watchedPercent ?? null)}</div>
                    </div>
                </div>
            ) : null}
        </section>
    );
}
