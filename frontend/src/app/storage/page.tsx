'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { Modal } from '@/components/Modal';
import { StorageAssetCard } from '@/components/StorageAssetCard';
import { mediaApi } from '@/lib/apiClient';
import {
    formatBytes,
    type DeleteMediaResult,
    type StorageAsset,
    type StorageOverview,
} from '@/lib/types';

type StorageFilter = 'all' | 'duplicates' | 'unused' | 'used';
type StorageSort = 'newest' | 'oldest' | 'largest' | 'smallest';
type NoticeKind = 'success' | 'warning';
type StorageKind = 'all' | 'image' | 'video';

const KINDS: Array<{ key: StorageKind; label: string }> = [
    { key: 'all', label: 'All types' },
    { key: 'image', label: 'Images' },
    { key: 'video', label: 'Reels' },
];

function files(count: number): string {
    return count === 1 ? 'file' : 'files';
}

const PAGE_SIZE = 24;
const DELETE_BATCH_SIZE = 500;
const EMPTY_ASSETS: StorageAsset[] = [];

const FILTERS: Array<{ key: StorageFilter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'duplicates', label: 'Duplicates' },
    { key: 'unused', label: 'Unused' },
    { key: 'used', label: 'Used' },
];

function dateValue(value: string): number {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
}

function errorMessage(error: unknown, fallback: string): string {
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    return fallback;
}

function SummaryCard({
    label,
    value,
    hint,
    accent,
    action,
}: {
    label: string;
    value: string;
    hint: string;
    accent: string;
    action?: React.ReactNode;
}) {
    return (
        <div className={`rounded-2xl border p-5 shadow-card ${accent}`}>
            <div className="text-[11px] font-bold uppercase tracking-widest opacity-70">
                {label}
            </div>
            <div className="text-2xl font-bold text-fg mt-2">
                {value}
            </div>
            <div className="text-xs mt-1 opacity-60">{hint}</div>
            {action ? <div className="mt-3">{action}</div> : null}
        </div>
    );
}

export default function StoragePage() {
    const [overview, setOverview] = useState<StorageOverview | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [needsSetup, setNeedsSetup] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [noticeKind, setNoticeKind] = useState<NoticeKind>('success');
    const [filter, setFilter] = useState<StorageFilter>('all');
    const [kind, setKind] = useState<StorageKind>('all');
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<StorageSort>('newest');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const load = useCallback(async (showSpinner: boolean) => {
        if (showSpinner) setLoading(true);
        else setRefreshing(true);

        setError('');

        try {
            const data = await mediaApi.storage();

            if (!data.configured) {
                setNeedsSetup(true);
                setOverview(null);
                setSelected(new Set());
                return;
            }

            setNeedsSetup(false);
            setOverview({
                configured: data.configured,
                assets: data.assets,
                summary: data.summary,
            });
            setSelected(new Set());
        } catch (err: unknown) {
            setNeedsSetup(false);
            setError(
                errorMessage(
                    err,
                    'Could not load your Cloudinary storage. Try again.'
                )
            );
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        // Initial data load; state updates happen after the request resolves.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load(true);
    }, [load]);

    const assets = overview?.assets ?? EMPTY_ASSETS;
    const summary = overview?.summary;

    const filteredAssets = useMemo(() => {
        const query = search.trim().toLowerCase();
        let list = assets;

        if (kind !== 'all') {
            list = list.filter((asset) => asset.resourceType === kind);
        }

        if (filter === 'duplicates') {
            list = list.filter((asset) => asset.duplicateCount > 1);
        } else if (filter === 'unused') {
            list = list.filter((asset) => asset.posts.length === 0);
        } else if (filter === 'used') {
            list = list.filter((asset) => asset.posts.length > 0);
        }

        if (query) {
            list = list.filter(
                (asset) =>
                    asset.publicId.toLowerCase().includes(query) ||
                    asset.assetFolder.toLowerCase().includes(query)
            );
        }

        const sorted = [...list];
        sorted.sort((a, b) => {
            if (sort === 'oldest') {
                return dateValue(a.createdAt) - dateValue(b.createdAt);
            }
            if (sort === 'largest') return b.bytes - a.bytes;
            if (sort === 'smallest') return a.bytes - b.bytes;
            return dateValue(b.createdAt) - dateValue(a.createdAt);
        });

        return sorted;
    }, [assets, filter, kind, search, sort]);

    const visibleAssets = filteredAssets.slice(0, visibleCount);
    const hasMore = visibleCount < filteredAssets.length;

    const selectedAssets = useMemo(
        () => assets.filter((asset) => selected.has(asset.assetId)),
        [assets, selected]
    );
    const selectedBytes = selectedAssets.reduce(
        (total, asset) => total + asset.bytes,
        0
    );
    const publishedSelected = selectedAssets.filter(
        (asset) => asset.posts.length > 0
    );
    const lockedSelected = selectedAssets.filter(
        (asset) => !asset.canDelete
    );

    const exactExtraCount = assets.filter(
        (asset) =>
            asset.duplicateMatch === 'exact' &&
            !asset.recommendedKeep &&
            asset.canDelete
    ).length;
    const unusedDeletableCount = assets.filter(
        (asset) => asset.posts.length === 0 && asset.canDelete
    ).length;
    const videoCount = assets.filter((asset) => asset.resourceType === 'video').length;
    const imageCount = assets.length - videoCount;

    const changeFilter = (next: StorageFilter) => {
        setFilter(next);
        setVisibleCount(PAGE_SIZE);
    };

    const changeKind = (next: StorageKind) => {
        setKind(next);
        setVisibleCount(PAGE_SIZE);
    };

    const changeSearch = (next: string) => {
        setSearch(next);
        setVisibleCount(PAGE_SIZE);
    };

    const changeSort = (next: StorageSort) => {
        setSort(next);
        setVisibleCount(PAGE_SIZE);
    };

    const toggleAsset = (assetId: string) => {
        setNotice('');
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(assetId)) next.delete(assetId);
            else next.add(assetId);
            return next;
        });
    };

    const clearSelection = () => {
        setSelected(new Set());
        setNotice('');
    };

    const selectExtraCopies = () => {
        const ids = assets
            .filter(
                (asset) =>
                    asset.duplicateMatch === 'exact' &&
                    !asset.recommendedKeep &&
                    asset.canDelete
            )
            .map((asset) => asset.assetId);

        setSelected(new Set(ids));
        setNotice(
            ids.length > 0
                ? `Selected ${ids.length} extra duplicate${
                      ids.length === 1 ? '' : 's'
                  }. Review the selection before deleting.`
                : 'No deletable exact duplicate extras were found.'
        );
        setNoticeKind(ids.length > 0 ? 'success' : 'warning');
    };

    const selectUnused = () => {
        const ids = assets
            .filter(
                (asset) => asset.posts.length === 0 && asset.canDelete
            )
            .map((asset) => asset.assetId);

        setSelected(new Set(ids));
        setNotice(
            ids.length > 0
                ? `Selected ${ids.length} unused ${files(ids.length)}.`
                : 'No deletable unused files were found.'
        );
        setNoticeKind(ids.length > 0 ? 'success' : 'warning');
    };

    const confirmDelete = async () => {
        if (selected.size === 0 || deleting) return;

        setDeleting(true);
        setError('');
        setNotice('');

        try {
            const ids = Array.from(selected);
            const deleted: DeleteMediaResult['deleted'] = [];
            const blocked: DeleteMediaResult['blocked'] = [];
            const skipped: DeleteMediaResult['skipped'] = [];
            let freedBytes = 0;

            for (
                let index = 0;
                index < ids.length;
                index += DELETE_BATCH_SIZE
            ) {
                const result = await mediaApi.deleteAssets(
                    ids.slice(index, index + DELETE_BATCH_SIZE)
                );

                deleted.push(...result.deleted);
                blocked.push(...result.blocked);
                skipped.push(...result.skipped);
                freedBytes += result.freedBytes;
            }

            const parts: string[] = [];

            if (deleted.length > 0) {
                parts.push(
                    `Deleted ${deleted.length} ${files(deleted.length)} and freed ${formatBytes(freedBytes)}.`
                );
            }

            if (blocked.length > 0) {
                parts.push(
                    `${blocked.length} ${files(blocked.length)} ${
                        blocked.length === 1 ? 'is' : 'are'
                    } still used by unfinished posts and ${
                        blocked.length === 1 ? 'was' : 'were'
                    } not deleted.`
                );
            }

            if (skipped.length > 0) {
                parts.push(
                    `${skipped.length} ${files(skipped.length)} ${
                        skipped.length === 1 ? 'was' : 'were'
                    } skipped.`
                );
            }

            if (parts.length === 0) {
                parts.push('No files were deleted.');
            }

            const firstReason =
                blocked[0]?.reason || skipped[0]?.reason;
            if (firstReason) parts.push(firstReason);

            setNotice(parts.join(' '));
            setNoticeKind(
                blocked.length > 0 || skipped.length > 0
                    ? 'warning'
                    : 'success'
            );

            await load(false);
        } catch (err: unknown) {
            setError(
                errorMessage(
                    err,
                    'Could not delete the selected files. Try again.'
                )
            );
        } finally {
            setDeleting(false);
            setDeleteOpen(false);
            setSelected(new Set());
        }
    };

    const storagePercent = summary
        ? summary.account.storageLimit > 0
            ? Math.min(
                  100,
                  summary.account.storagePercent ||
                      (summary.account.storageUsed /
                          summary.account.storageLimit) *
                          100
              )
            : 0
        : 0;

    const deleteMessage = `Permanently delete ${selected.size} ${files(
        selected.size
    )} (${formatBytes(selectedBytes)}) from Cloudinary? This cannot be undone.${
        publishedSelected.length > 0
            ? ` ${publishedSelected.length} selected ${files(publishedSelected.length)} ${
                  publishedSelected.length === 1 ? 'is' : 'are'
              } used by published posts; those previews will stop loading.`
            : ''
    }${
        lockedSelected.length > 0
            ? ` ${lockedSelected.length} selected ${files(lockedSelected.length)} ${
                  lockedSelected.length === 1 ? 'is' : 'are'
              } locked by unfinished posts and will be skipped.`
            : ''
    } Deleting a file can also break an unsaved Composer or Reels draft that still references it.`;

    return (
        <AppShell
            title="Storage"
            subtitle="Manage the images and reels Meta-Bru uploaded to your own Cloudinary account."
            actions={
                <button
                    onClick={() => {
                        setNotice('');
                        void load(false);
                    }}
                    disabled={loading || refreshing || deleting}
                    className="px-4 py-2.5 rounded-xl text-xs font-bold border border-line-strong bg-hover text-fg hover:bg-hover-strong disabled:opacity-50 transition-all"
                >
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            }
        >
            {needsSetup ? (
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-8 text-center">
                    <div className="text-lg font-bold text-fg">
                        Connect Cloudinary to manage storage
                    </div>
                    <p className="text-sm text-muted mt-2 max-w-xl mx-auto">
                        Add your Cloudinary cloud name, API key, and API
                        secret under Profile. Meta-Bru uses your own
                        Cloudinary account, so only you can see and manage
                        these uploads.
                    </p>
                    <Link
                        href="/settings"
                        className="inline-flex mt-6 px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold transition-all"
                    >
                        Open Profile
                    </Link>
                </div>
            ) : null}

            {error ? (
                <div className="mb-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                    {error}
                    <Link
                        href="/settings"
                        className="underline underline-offset-2 ml-2 font-semibold"
                    >
                        Check Profile
                    </Link>
                </div>
            ) : null}

            {loading && !overview ? (
                <div className="flex justify-center py-24">
                    <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-indigo-500" />
                </div>
            ) : null}

            {!needsSetup && overview ? (
                <>
                    {notice ? (
                        <div
                            className={`mb-6 rounded-2xl border px-4 py-3 text-sm ${
                                noticeKind === 'success'
                                    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                    : 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                            }`}
                        >
                            {notice}
                        </div>
                    ) : null}

                    {summary ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
                            <div className="sm:col-span-2 rounded-2xl border border-line bg-surface p-5 sm:p-6 shadow-card">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="text-[11px] font-bold uppercase tracking-widest text-indigo-700 dark:text-indigo-400">
                                            Cloudinary account
                                        </div>
                                        <div className="text-2xl font-bold text-fg mt-2">
                                            {summary.account.error
                                                ? 'Usage unavailable'
                                                : formatBytes(
                                                      summary.account
                                                          .storageUsed
                                                  )}
                                            {!summary.account.error &&
                                            summary.account.storageLimit >
                                                0 ? (
                                                <span className="text-sm font-semibold text-subtle">
                                                    {' / '}
                                                    {formatBytes(
                                                        summary.account
                                                            .storageLimit
                                                    )}
                                                </span>
                                            ) : null}
                                        </div>
                                    </div>
                                    <span className="shrink-0 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                                        {summary.account.plan ||
                                            'Cloudinary'}
                                    </span>
                                </div>

                                {!summary.account.error ? (
                                    <>
                                        {summary.account.storageLimit > 0 ? (
                                            <div className="mt-4 h-2.5 rounded-full bg-canvas overflow-hidden border border-line">
                                                <div
                                                    className={`h-full rounded-full transition-all ${
                                                        storagePercent >= 90
                                                            ? 'bg-rose-500'
                                                            : storagePercent >=
                                                                70
                                                              ? 'bg-amber-500'
                                                              : 'bg-indigo-500'
                                                    }`}
                                                    style={{
                                                        width: `${storagePercent}%`,
                                                    }}
                                                />
                                            </div>
                                        ) : null}

                                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-subtle mt-2">
                                            <span>
                                                {summary.account
                                                    .storageLimit > 0
                                                    ? `${storagePercent.toFixed(
                                                          1
                                                      )}% of plan limit`
                                                    : 'Plan limit not reported'}
                                            </span>
                                            <span>
                                                {summary.account.resources.toLocaleString()}{' '}
                                                account assets
                                            </span>
                                            {summary.account
                                                .lastUpdated ? (
                                                <span>
                                                    Updated{' '}
                                                    {
                                                        summary.account
                                                            .lastUpdated
                                                    }
                                                </span>
                                            ) : null}
                                            {summary.account
                                                .bandwidthLimit > 0 ? (
                                                <span>
                                                    Bandwidth{' '}
                                                    {formatBytes(
                                                        summary.account
                                                            .bandwidthUsed
                                                    )}{' '}
                                                    /{' '}
                                                    {formatBytes(
                                                        summary.account
                                                            .bandwidthLimit
                                                    )}
                                                </span>
                                            ) : null}
                                        </div>
                                    </>
                                ) : (
                                    <div className="mt-3 text-[11px] text-amber-700 dark:text-amber-300">
                                        {summary.account.error}
                                    </div>
                                )}

                                <p className="mt-3 text-[11px] text-subtle">
                                    This is your whole Cloudinary account.
                                    The folder totals below include only
                                    Meta-Bru uploads.
                                </p>
                            </div>

                            <SummaryCard
                                label="Meta-Bru uploads"
                                value={formatBytes(summary.folder.bytes)}
                                hint={`${imageCount} image${
                                    imageCount === 1 ? '' : 's'
                                } · ${videoCount} reel${videoCount === 1 ? '' : 's'}`}
                                accent="border-line bg-surface"
                            />

                            <SummaryCard
                                label="Duplicate extras"
                                value={formatBytes(
                                    summary.duplicates.extraBytes
                                )}
                                hint={`${
                                    summary.duplicates.extraAssets
                                } extra cop${
                                    summary.duplicates.extraAssets === 1
                                        ? 'y'
                                        : 'ies'
                                } · ${
                                    summary.duplicates.exactGroups
                                } exact group${
                                    summary.duplicates.exactGroups === 1
                                        ? ''
                                        : 's'
                                }`}
                                accent="border-indigo-500/15 bg-indigo-500/5"
                                action={
                                    <button
                                        onClick={selectExtraCopies}
                                        disabled={exactExtraCount === 0}
                                        className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300 hover:text-indigo-800 dark:hover:text-indigo-200 disabled:opacity-40 transition-all"
                                    >
                                        Select exact extras
                                    </button>
                                }
                            />

                            <SummaryCard
                                label="Unused files"
                                value={String(summary.unused.assets)}
                                hint={formatBytes(summary.unused.bytes)}
                                accent="border-emerald-500/15 bg-emerald-500/5"
                                action={
                                    <button
                                        onClick={selectUnused}
                                        disabled={
                                            unusedDeletableCount === 0
                                        }
                                        className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 hover:text-emerald-800 dark:hover:text-emerald-200 disabled:opacity-40 transition-all"
                                    >
                                        Select unused
                                    </button>
                                }
                            />

                            <SummaryCard
                                label="Locked files"
                                value={String(summary.protected.assets)}
                                hint={formatBytes(summary.protected.bytes)}
                                accent="border-amber-500/15 bg-amber-500/5"
                            />

                            <div className="sm:col-span-2 rounded-2xl border border-line bg-surface p-5">
                                <div className="text-[11px] font-bold uppercase tracking-widest text-subtle">
                                    How this works
                                </div>
                                <ul className="mt-3 space-y-2 text-xs text-muted">
                                    <li>
                                        Only images and reels in your own
                                        meta-bru/your-user-id/ folder are
                                        listed. Another user cannot access
                                        your Cloudinary account through
                                        Meta-Bru.
                                    </li>
                                    <li>
                                        Files used by draft, queued,
                                        publishing, failed, or partial posts
                                        are locked.
                                    </li>
                                    <li>
                                        Published files can be deleted, but
                                        their previews in Activity will stop
                                        loading.
                                    </li>
                                    <li>
                                        Deleting a draft or queued post in
                                        Queue also removes its file when no
                                        other post uses it.
                                    </li>
                                </ul>
                            </div>
                        </div>
                    ) : null}

                    {summary?.folder.truncated ? (
                        <div className="mb-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
                            Showing the first{' '}
                            {summary.folder.assetCount.toLocaleString()}{' '}
                            uploads. Older uploads are not included in this
                            view.
                        </div>
                    ) : null}

                    {summary && summary.duplicates.likelyGroups > 0 ? (
                        <div className="mb-4 rounded-2xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-3 text-xs text-indigo-700 dark:text-indigo-200">
                            {summary.duplicates.likelyGroups} possible
                            duplicate group
                            {summary.duplicates.likelyGroups === 1
                                ? ''
                                : 's'}{' '}
                            matched by size and dimensions. Review them
                            before deleting; they may be different images.
                        </div>
                    ) : null}

                    <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5 shadow-card mb-6">
                        <div className="flex flex-col xl:flex-row xl:items-center gap-3">
                            <div className="relative flex-1 min-w-0">
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle"
                                >
                                    <circle cx="11" cy="11" r="7" />
                                    <path d="m20 20-3.5-3.5" />
                                </svg>
                                <input
                                    value={search}
                                    onChange={(event) =>
                                        changeSearch(event.target.value)
                                    }
                                    placeholder="Search by public ID or folder"
                                    aria-label="Search files"
                                    className="w-full bg-surface-2 border border-line-strong rounded-xl pl-10 pr-4 py-3 text-sm text-fg placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                />
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <div className="flex gap-1 rounded-xl border border-line bg-surface-2 p-1">
                                    {KINDS.map((item) => (
                                        <button
                                            key={item.key}
                                            onClick={() => changeKind(item.key)}
                                            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                                                kind === item.key
                                                    ? 'bg-hover-strong text-fg'
                                                    : 'text-subtle hover:text-fg'
                                            }`}
                                        >
                                            {item.label}
                                        </button>
                                    ))}
                                </div>

                                {FILTERS.map((item) => (
                                    <button
                                        key={item.key}
                                        onClick={() =>
                                            changeFilter(item.key)
                                        }
                                        className={`px-3.5 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                                            filter === item.key
                                                ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/20'
                                                : 'bg-surface-2 text-muted border-line hover:text-fg'
                                        }`}
                                    >
                                        {item.label}
                                    </button>
                                ))}

                                <select
                                    value={sort}
                                    aria-label="Sort files"
                                    onChange={(event) =>
                                        changeSort(
                                            event.target
                                                .value as StorageSort
                                        )
                                    }
                                    className="bg-surface-2 border border-line-strong rounded-xl px-3 py-2.5 text-xs font-semibold text-fg-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                >
                                    <option value="newest">
                                        Newest first
                                    </option>
                                    <option value="oldest">
                                        Oldest first
                                    </option>
                                    <option value="largest">
                                        Largest first
                                    </option>
                                    <option value="smallest">
                                        Smallest first
                                    </option>
                                </select>
                            </div>
                        </div>

                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4 pt-4 border-t border-line">
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    onClick={selectExtraCopies}
                                    disabled={exactExtraCount === 0}
                                    className="px-3.5 py-2 rounded-xl text-[11px] font-bold border border-indigo-500/20 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/15 disabled:opacity-40 transition-all"
                                >
                                    Select extra copies
                                </button>
                                <button
                                    onClick={selectUnused}
                                    disabled={unusedDeletableCount === 0}
                                    className="px-3.5 py-2 rounded-xl text-[11px] font-bold border border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15 disabled:opacity-40 transition-all"
                                >
                                    Select unused
                                </button>
                                <button
                                    onClick={clearSelection}
                                    disabled={selected.size === 0}
                                    className="px-3.5 py-2 rounded-xl text-[11px] font-bold border border-line-strong bg-hover text-fg-2 hover:bg-hover-strong disabled:opacity-40 transition-all"
                                >
                                    Clear selection
                                </button>
                            </div>

                            <div className="flex items-center gap-3">
                                <div className="text-xs text-muted">
                                    {selected.size > 0
                                        ? `${selected.size} selected · ${formatBytes(
                                              selectedBytes
                                          )}`
                                        : `${filteredAssets.length} ${files(
                                              filteredAssets.length
                                          )}`}
                                </div>
                                <button
                                    onClick={() => setDeleteOpen(true)}
                                    disabled={
                                        selected.size === 0 || deleting
                                    }
                                    className="px-4 py-2.5 rounded-xl text-xs font-bold bg-rose-500 hover:bg-rose-400 text-white shadow-lg shadow-rose-500/20 disabled:opacity-40 transition-all"
                                >
                                    {deleting
                                        ? 'Deleting...'
                                        : 'Delete selected'}
                                </button>
                            </div>
                        </div>
                    </div>

                    {assets.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-line-strong bg-surface p-12 text-center">
                            <div className="text-lg font-bold text-fg">
                                No Meta-Bru uploads yet
                            </div>
                            <p className="text-sm text-muted mt-2">
                                Images from the Composer and videos from the
                                Reels page will appear here.
                            </p>
                            <Link
                                href="/composer"
                                className="inline-flex mt-6 px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold transition-all"
                            >
                                Open Composer
                            </Link>
                        </div>
                    ) : filteredAssets.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-line-strong bg-surface p-12 text-center">
                            <div className="text-lg font-bold text-fg">
                                No files match this view
                            </div>
                            <p className="text-sm text-muted mt-2">
                                Try a different search or filter.
                            </p>
                            <button
                                onClick={() => {
                                    changeKind('all');
                                    changeFilter('all');
                                    changeSearch('');
                                }}
                                className="inline-flex mt-6 px-5 py-3 rounded-xl bg-hover hover:bg-hover-strong text-fg text-sm font-bold border border-line-strong transition-all"
                            >
                                Clear filters
                            </button>
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                                {visibleAssets.map((asset) => (
                                    <StorageAssetCard
                                        key={asset.assetId}
                                        asset={asset}
                                        selected={selected.has(
                                            asset.assetId
                                        )}
                                        onToggle={toggleAsset}
                                    />
                                ))}
                            </div>

                            {hasMore ? (
                                <div className="flex justify-center mt-6">
                                    <button
                                        onClick={() =>
                                            setVisibleCount(
                                                (count) =>
                                                    count + PAGE_SIZE
                                            )
                                        }
                                        className="px-5 py-3 rounded-xl text-xs font-bold border border-line-strong bg-hover text-fg hover:bg-hover-strong transition-all"
                                    >
                                        Load more (
                                        {filteredAssets.length -
                                            visibleCount}{' '}
                                        remaining)
                                    </button>
                                </div>
                            ) : null}
                        </>
                    )}
                </>
            ) : null}

            <Modal
                isOpen={deleteOpen}
                onClose={() => setDeleteOpen(false)}
                onConfirm={() => void confirmDelete()}
                title="Delete selected files?"
                message={deleteMessage}
                confirmText="Delete permanently"
                type="danger"
            />
        </AppShell>
    );
}
