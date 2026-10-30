'use client';

import React from 'react';
import {
    formatBytes,
    formatDuration,
    type PostStatus,
    type StorageAsset,
} from '@/lib/types';

const STATUS_CLASSES: Record<PostStatus, string> = {
    draft: 'bg-slate-500/10 text-fg-2 border-slate-500/20',
    queued: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20',
    publishing: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20',
    published: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
    partial: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
    failed: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20',
};

function uploadDate(value: string): string {
    if (!value) return 'Unknown date';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown date';
    return date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function usageBadge(asset: StorageAsset): {
    label: string;
    className: string;
} {
    if (!asset.canDelete) {
        return {
            label: 'In use',
            className:
                'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
        };
    }

    if (asset.posts.length > 0) {
        return {
            label: 'Published',
            className:
                'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
        };
    }

    return {
        label: 'Unused',
        className: 'bg-slate-500/10 text-fg-2 border-slate-500/20',
    };
}

interface StorageAssetCardProps {
    asset: StorageAsset;
    selected: boolean;
    onToggle: (assetId: string) => void;
}

export function StorageAssetCard({
    asset,
    selected,
    onToggle,
}: StorageAssetCardProps) {
    const usage = usageBadge(asset);
    const duplicate = asset.duplicateCount > 1;
    const isVideo = asset.resourceType === 'video';

    return (
        <article
            className={`group rounded-2xl border bg-surface overflow-hidden shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover ${
                selected
                    ? 'border-indigo-500/50 ring-2 ring-indigo-500/20'
                    : 'border-line hover:border-line-strong'
            }`}
        >
            <div className="relative aspect-square overflow-hidden bg-sunken">
                <a
                    href={asset.secureUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block w-full h-full"
                    title={isVideo ? 'Open video' : 'Open full image'}
                >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={asset.thumbnailUrl || asset.secureUrl}
                        alt={asset.publicId}
                        loading="lazy"
                        onError={(event) => {
                            const image = event.currentTarget;
                            if (
                                !isVideo &&
                                asset.secureUrl &&
                                image.src !== asset.secureUrl
                            ) {
                                image.src = asset.secureUrl;
                            }
                        }}
                        className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                    />
                </a>

                <div className="absolute top-3 left-3">
                    <button
                        type="button"
                        onClick={() => onToggle(asset.assetId)}
                        disabled={!asset.canDelete}
                        aria-label={
                            asset.canDelete
                                ? selected
                                    ? 'Deselect file'
                                    : 'Select file'
                                : 'This file cannot be deleted'
                        }
                        aria-pressed={selected}
                        className={`w-8 h-8 rounded-xl border flex items-center justify-center transition-all ${
                            selected
                                ? 'bg-indigo-500 border-indigo-400 text-white'
                                : 'bg-surface-2 border-line-strong text-transparent hover:border-faint'
                        } ${
                            !asset.canDelete
                                ? 'opacity-40 cursor-not-allowed'
                                : ''
                        }`}
                    >
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="w-4 h-4"
                        >
                            <path d="m5 12 4 4L19 6" />
                        </svg>
                    </button>
                </div>

                <div className="absolute top-3 right-3 flex flex-col items-end gap-1.5">
                    {isVideo ? (
                        <span className="rounded-full border border-fuchsia-500/25 bg-surface-2 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-fuchsia-700 dark:text-fuchsia-300 backdrop-blur">
                            ▶ Reel{asset.duration > 0 ? ` · ${formatDuration(asset.duration)}` : ''}
                        </span>
                    ) : null}
                    {duplicate ? (
                        <span className="rounded-full border border-indigo-500/25 bg-surface-2 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300 backdrop-blur">
                            {asset.duplicateMatch === 'exact'
                                ? 'Exact duplicate'
                                : 'Possible duplicate'}{' '}
                            · {asset.duplicateCount}
                        </span>
                    ) : null}
                    {duplicate ? (
                        <span
                            className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider backdrop-blur ${
                                asset.recommendedKeep
                                    ? 'border-emerald-500/25 bg-surface-2 text-emerald-700 dark:text-emerald-300'
                                    : 'border-rose-500/25 bg-surface-2 text-rose-700 dark:text-rose-300'
                            }`}
                        >
                            {asset.recommendedKeep ? 'Keep' : 'Extra copy'}
                        </span>
                    ) : null}
                </div>

                {!asset.canDelete ? (
                    <div className="absolute bottom-3 left-3 right-3 rounded-xl border border-amber-500/20 bg-surface-2 px-3 py-2 text-[11px] font-semibold text-amber-700 dark:text-amber-300 backdrop-blur">
                        Locked by an unfinished post
                    </div>
                ) : null}
            </div>

            <div className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div
                            className="text-sm font-bold text-fg truncate"
                            title={asset.publicId}
                        >
                            {asset.publicId}
                        </div>
                        <div className="text-[11px] text-subtle mt-1">
                            {asset.format
                                ? asset.format.toUpperCase()
                                : isVideo
                                  ? 'Video'
                                  : 'Image'}{' '}
                            · {asset.width}×{asset.height} ·{' '}
                            {isVideo && asset.duration > 0 ? `${formatDuration(asset.duration)} · ` : ''}
                            {formatBytes(asset.bytes)}
                        </div>
                        <div className="text-[11px] text-subtle mt-0.5">
                            Uploaded {uploadDate(asset.createdAt)}
                        </div>
                    </div>
                    <span
                        className={`shrink-0 inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${usage.className}`}
                    >
                        {usage.label}
                    </span>
                </div>

                {asset.posts.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                        {asset.posts.slice(0, 4).map((post) => (
                            <span
                                key={post.id}
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_CLASSES[post.status]}`}
                            >
                                {post.status}
                            </span>
                        ))}
                        {asset.posts.length > 4 ? (
                            <span className="text-[10px] text-subtle self-center">
                                +{asset.posts.length - 4} more
                            </span>
                        ) : null}
                    </div>
                ) : null}

                {!asset.canDelete ? (
                    <p className="mt-3 text-[11px] leading-relaxed text-amber-700/80 dark:text-amber-300/80">
                        {asset.deleteBlockedReason}
                    </p>
                ) : null}

                {duplicate ? (
                    <p className="mt-3 text-[11px] text-muted">
                        <span
                            className={
                                asset.recommendedKeep
                                    ? 'text-emerald-700 dark:text-emerald-300'
                                    : 'text-rose-700 dark:text-rose-300'
                            }
                        >
                            {asset.recommendedKeep
                                ? 'Recommended keep'
                                : 'Extra copy'}
                        </span>{' '}
                        ·{' '}
                        {asset.duplicateMatch === 'exact'
                            ? 'Identical file'
                            : 'Same size and dimensions'}
                    </p>
                ) : null}
            </div>
        </article>
    );
}
