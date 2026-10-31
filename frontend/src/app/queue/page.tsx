'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { AiLabelChip } from '@/components/AiLabelToggle';
import { AppShell } from '@/components/AppShell';
import { StatusBadge } from '@/components/Dashboards';
import { EmptyState, ListSkeleton } from '@/components/Feedback';
import { Modal } from '@/components/Modal';
import { MusicChip } from '@/components/MusicChip';
import { MusicModal } from '@/components/MusicModal';
import { PageFilter, activePageId, postPageId } from '@/components/PageFilter';
import { PostTimingLine, ScheduleSummary, queuedPostTiming } from '@/components/QueueSchedule';
import { StoryChip } from '@/components/ShareToStoryToggle';
import { StoryShareModal } from '@/components/StoryShareModal';
import { Tabs } from '@/components/Tabs';
import { connectionsApi, postsApi, systemApi, type SchedulerStatus } from '@/lib/apiClient';
import {
    connectionName,
    formatDate,
    formatDuration,
    formatElapsed,
    formatIstDateTime,
    isReel,
    latestPublishedAt,
    postThumbnailUrl,
    publishedPlatforms,
    unsharedStoryPlatforms,
    type Platform,
    type Post,
    type SocialConnection,
    type TargetStatus,
    type TokenStatus,
} from '@/lib/types';

const TABS = [
    { key: 'queued', label: 'Queue' },
    { key: 'draft', label: 'Drafts' },
    { key: 'failed', label: 'Failed' },
    { key: 'published', label: 'Published' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const KINDS = [
    { key: 'all', label: 'All' },
    { key: 'image', label: 'Posts' },
    { key: 'reel', label: 'Reels' },
] as const;

type KindKey = (typeof KINDS)[number]['key'];

function matchesTab(post: Post, tab: TabKey): boolean {
    if (tab === 'failed') return post.status === 'failed' || post.status === 'partial';
    if (tab === 'published') return post.status === 'published' || post.status === 'partial';
    return post.status === tab;
}

function matchesKind(post: Post, kind: KindKey): boolean {
    if (kind === 'all') return true;
    return kind === 'reel' ? isReel(post) : !isReel(post);
}

function destinationStatus(post: Post): TokenStatus | null {
    if (!post.connectionId || typeof post.connectionId === 'string') {
        return null;
    }
    return post.connectionId.tokenStatus;
}

function targetChipClass(status: TargetStatus): string {
    if (status === 'published') {
        return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20';
    }
    if (status === 'failed') {
        return 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20';
    }
    return 'bg-slate-500/10 text-muted border-slate-500/20';
}

export default function QueuePage() {
    const [posts, setPosts] = useState<Post[]>([]);
    const [tab, setTab] = useState<TabKey>('queued');
    const [kind, setKind] = useState<KindKey>('all');
    const [chosenPageId, setPageId] = useState('');
    const pageId = activePageId(posts, chosenPageId);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState('');
    const [sharingId, setSharingId] = useState('');
    const [deleteTarget, setDeleteTarget] = useState<Post | null>(null);
    const [storyPost, setStoryPost] = useState<Post | null>(null);
    const [musicPost, setMusicPost] = useState<Post | null>(null);
    const [storySelection, setStorySelection] = useState<Platform[]>([]);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    // Each Page's schedule and the server's scheduler, for when posts publish.
    const [pages, setPages] = useState<SocialConnection[]>([]);
    const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
    const [checkedAt, setCheckedAt] = useState(0);

    const load = async (showSpinner = false) => {
        if (showSpinner) setLoading(true);
        try {
            const [data, pageData, health] = await Promise.all([
                postsApi.list({ limit: '200' }) as Promise<{ posts?: Post[] }>,
                (connectionsApi.list() as Promise<{ connections?: SocialConnection[] }>).catch(() => null),
                systemApi.health().catch(() => null),
            ]);
            setPosts(data.posts || []);
            if (pageData) setPages(pageData.connections || []);
            setScheduler(health?.scheduler ?? null);
            setCheckedAt(Date.now());
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not load posts');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const requestedTab = params.get('tab');
        if (TABS.some((item) => item.key === requestedTab)) {
            setTab(requestedTab as TabKey);
        }
        const requestedKind = params.get('kind');
        if (KINDS.some((item) => item.key === requestedKind)) {
            setKind(requestedKind as KindKey);
        }

        void load(true);
        const interval = setInterval(() => void load(false), 30_000);
        return () => clearInterval(interval);
    }, []);

    const publishNow = async (post: Post) => {
        setBusyId(post._id);
        setError('');
        setNotice('');
        try {
            const data: any = await postsApi.publishNow(post._id);
            if (
                data.post?.status === 'failed' ||
                data.post?.status === 'partial'
            ) {
                setError(data.post.lastError || 'Publishing failed');
            } else {
                setNotice(isReel(post) ? 'Reel published.' : 'Post published.');
            }
            await load();
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not publish post');
        } finally {
            setBusyId('');
        }
    };

    const retry = async (post: Post) => {
        setBusyId(post._id);
        setError('');
        setNotice('');
        try {
            const data: any = await postsApi.retry(post._id);
            if (
                data.post?.status === 'published' &&
                !data.post?.lastError
            ) {
                setNotice('Retry completed.');
            } else {
                setError(
                    data.post?.lastError ||
                        'Retry did not publish every platform. Check Activity.'
                );
            }
            await load();
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not retry post');
        } finally {
            setBusyId('');
        }
    };

    const remove = async (post: Post) => {
        setBusyId(post._id);
        setError('');
        setNotice('');
        try {
            const data = await postsApi.remove(post._id);
            setPosts((current) => current.filter((item) => item._id !== post._id));
            setNotice(
                data.mediaDeleted
                    ? `Post deleted. Its ${isReel(post) ? 'video' : 'image'} was also removed from Cloudinary.`
                    : 'Post deleted.'
            );
            if (data.mediaError) {
                setError(`Could not remove its Cloudinary file: ${data.mediaError}`);
            }
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not delete post');
        } finally {
            setBusyId('');
        }
    };

    const musicSaved = (saved: Post) => {
        // The response is not populated; keep the Page details we have.
        setPosts((current) =>
            current.map((item) =>
                item._id === saved._id ? { ...saved, connectionId: item.connectionId } : item
            )
        );
        setMusicPost(null);
        setError('');
        setNotice(saved.music ? 'Music saved.' : 'Music removed.');
    };

    const openStoryShare = (post: Post) => {
        setStorySelection(unsharedStoryPlatforms(post));
        setStoryPost(post);
    };

    const toggleStoryPlatform = (platform: Platform) => {
        setStorySelection((current) =>
            current.includes(platform)
                ? current.filter((item) => item !== platform)
                : [...current, platform]
        );
    };

    const shareStory = async (post: Post, platforms: Platform[]) => {
        if (platforms.length === 0) return;
        setBusyId(post._id);
        setSharingId(post._id);
        setError('');
        setNotice('');
        try {
            const data = await postsApi.shareStory(post._id, platforms);
            // The response is not populated; keep the Page details we have.
            setPosts((current) =>
                current.map((item) =>
                    item._id === post._id
                        ? { ...data.post, connectionId: item.connectionId }
                        : item
                )
            );
            const failed = (data.post.storyTargets ?? []).filter(
                (target) =>
                    platforms.includes(target.platform) && target.status === 'failed'
            );
            if (failed.length > 0) {
                setError(
                    failed
                        .map((target) => `${target.platform} Story: ${target.error}`)
                        .join(' | ')
                );
            } else {
                setNotice('Shared to Story.');
            }
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not share to Story');
        } finally {
            setBusyId('');
            setSharingId('');
        }
    };


    const kindPosts = posts.filter(
        (post) => matchesKind(post, kind) && (!pageId || postPageId(post) === pageId)
    );
    const visible = kindPosts.filter((post) => matchesTab(post, tab));

    return (
        <AppShell
            title="Queue"
            subtitle="Posts and reels publish at each Page's daily times, in the order you added them."
            actions={
                <>
                    <Link
                        href="/reels"
                        className="bg-hover hover:bg-hover-strong text-fg border border-line-strong px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
                    >
                        New reel
                    </Link>
                    <Link
                        href="/composer"
                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
                    >
                        New post
                    </Link>
                </>
            }
        >
            {notice ? (
                <div className="animate-fade-up mb-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
                    {notice}
                </div>
            ) : null}
            {error ? (
                <div className="animate-fade-up mb-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                    {error}
                </div>
            ) : null}

            {/* The filters move to their own line when they do not fit beside the tabs. */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-7">
                <Tabs
                    label="Post status"
                    items={TABS.map((item) => ({
                        ...item,
                        count: kindPosts.filter((post) => matchesTab(post, item.key)).length,
                    }))}
                    value={tab}
                    onChange={setTab}
                />

                <div className="flex flex-wrap items-center gap-2">
                    <PageFilter posts={posts} value={pageId} onChange={setPageId} />
                    <Tabs
                        label="Post type"
                        variant="segmented"
                        items={KINDS}
                        value={kind}
                        onChange={setKind}
                    />
                </div>
            </div>

            {!loading && tab === 'queued' ? (
                <ScheduleSummary
                    pages={pages.filter((page) => !pageId || page._id === pageId)}
                    posts={posts}
                    scheduler={scheduler}
                    now={checkedAt}
                />
            ) : null}

            {loading ? (
                <ListSkeleton />
            ) : visible.length === 0 ? (
                <EmptyState
                    key={`${tab}-${kind}`}
                    title={`Nothing in ${TABS.find((item) => item.key === tab)?.label.toLowerCase()}`}
                    body="Posts from the Composer and reels from the Reels page show up here."
                />
            ) : (
                <div key={`${tab}-${kind}-${pageId}`} className="stagger space-y-4">
                    {visible.map((post) => {
                        const status = destinationStatus(post);
                        const publishBlocked = status !== 'active';
                        const thumbnail = postThumbnailUrl(post);
                        const canShareStory =
                            (post.status === 'published' || post.status === 'partial') &&
                            publishedPlatforms(post).length > 0;
                        const storyLeft = unsharedStoryPlatforms(post).length;

                        return (
                            <article
                                key={post._id}
                                className="rounded-2xl border border-line bg-surface p-5 sm:p-6 shadow-card transition-[border-color,box-shadow,translate] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-card-hover"
                            >
                                <div className="flex flex-col sm:flex-row gap-5">
                                    <div className="relative w-full sm:w-28 h-40 sm:h-28 rounded-2xl overflow-hidden bg-sunken shrink-0 border border-line">
                                        {thumbnail ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                src={thumbnail}
                                                alt=""
                                                className="w-full h-full object-cover"
                                            />
                                        ) : null}
                                        {isReel(post) ? (
                                            <span className="absolute bottom-1.5 left-1.5 rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-fg backdrop-blur">
                                                {post.music ? '♪' : '▶'} {formatDuration(post.mediaDuration ?? 0)}
                                            </span>
                                        ) : null}
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-2 mb-2">
                                            <StatusBadge status={post.status} />
                                            {isReel(post) ? (
                                                <span
                                                    title={post.photo ? 'An image post published as a reel, so it can have music' : undefined}
                                                    className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/20"
                                                >
                                                    {post.photo ? 'Photo reel' : 'Reel'}
                                                </span>
                                            ) : null}
                                            <MusicChip music={post.music} />
                                            {post.aiGenerated ? <AiLabelChip /> : null}
                                            {post.status !== 'published' && post.status !== 'partial' ? (
                                                <StoryChip on={Boolean(post.shareToStory)} />
                                            ) : null}
                                            <span className="text-xs text-subtle">
                                                {connectionName(post)}
                                            </span>
                                            {status === 'disconnected' ||
                                            status === 'needs_reauth' ? (
                                                <Link
                                                    href="/connections"
                                                    className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border ${
                                                        status === 'disconnected'
                                                            ? 'bg-slate-500/10 text-fg-2 border-slate-500/20'
                                                            : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20'
                                                    }`}
                                                >
                                                    {status === 'disconnected'
                                                        ? 'Page disconnected'
                                                        : 'Reconnect needed'}
                                                </Link>
                                            ) : null}
                                            <span className="text-xs text-faint">·</span>
                                            <span className="text-xs text-subtle">
                                                {post.status === 'published' ||
                                                post.status === 'partial' ? (
                                                    latestPublishedAt(post) ? (
                                                        <>
                                                            Published{' '}
                                                            {formatIstDateTime(
                                                                latestPublishedAt(post)
                                                            )}
                                                            {` · ${formatElapsed(
                                                                latestPublishedAt(post)
                                                            )}`}
                                                        </>
                                                    ) : (
                                                        'Publish time unavailable'
                                                    )
                                                ) : (
                                                    formatDate(post.createdAt)
                                                )}
                                            </span>
                                            {post.attempts > 0 ? (
                                                <span className="text-xs text-faint">
                                                    attempts: {post.attempts}
                                                </span>
                                            ) : null}
                                        </div>

                                        <p className="text-sm text-fg-2 whitespace-pre-wrap line-clamp-3">
                                            {post.caption}
                                        </p>
                                        <PostTimingLine timing={queuedPostTiming(post, posts, pages)} />

                                        <div className="flex flex-wrap gap-2 mt-3">
                                            {post.targets.map((target) => (
                                                <span
                                                    key={target.platform}
                                                    className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border ${targetChipClass(target.status)}`}
                                                >
                                                    {target.platform}: {target.status}
                                                </span>
                                            ))}
                                            {(post.storyTargets ?? []).map((target) => (
                                                <span
                                                    key={`story-${target.platform}`}
                                                    title={target.error || undefined}
                                                    className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border ${targetChipClass(target.status)}`}
                                                >
                                                    {target.platform} story: {target.status}
                                                </span>
                                            ))}
                                        </div>

                                        {post.lastError ? (
                                            <div className="mt-3 text-xs text-rose-700 dark:text-rose-400">
                                                {post.lastError}
                                            </div>
                                        ) : null}
                                    </div>

                                    <div className="flex sm:flex-col flex-wrap gap-2 sm:w-36 shrink-0">
                                        {(post.status === 'queued' ||
                                            post.status === 'draft' ||
                                            post.status === 'failed') && (
                                            <button
                                                onClick={() => publishNow(post)}
                                                disabled={busyId === post._id || publishBlocked}
                                                title={
                                                    publishBlocked
                                                        ? 'Reconnect this Page before publishing.'
                                                        : undefined
                                                }
                                                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all"
                                            >
                                                {busyId === post._id && !sharingId
                                                    ? 'Working...'
                                                    : 'Post now'}
                                            </button>
                                        )}
                                        {(post.status === 'failed' ||
                                            post.status === 'partial') && (
                                            <button
                                                onClick={() => retry(post)}
                                                disabled={busyId === post._id || publishBlocked}
                                                title={
                                                    publishBlocked
                                                        ? 'Reconnect this Page before retrying.'
                                                        : undefined
                                                }
                                                className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 px-4 py-2.5 rounded-xl text-xs font-bold transition-all"
                                            >
                                                Retry failed
                                            </button>
                                        )}
                                        {canShareStory && (
                                            <button
                                                onClick={() => openStoryShare(post)}
                                                disabled={
                                                    busyId === post._id ||
                                                    publishBlocked ||
                                                    storyLeft === 0
                                                }
                                                title={
                                                    publishBlocked
                                                        ? 'Reconnect this Page before sharing.'
                                                        : storyLeft === 0
                                                          ? 'Already shared to Story on every published platform.'
                                                          : undefined
                                                }
                                                className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-200 border border-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 rounded-xl text-xs font-bold transition-all"
                                            >
                                                {sharingId === post._id
                                                    ? 'Sharing...'
                                                    : storyLeft === 0
                                                      ? 'Shared to Story'
                                                      : 'Share to Story'}
                                            </button>
                                        )}
                                        {post.status !== 'publishing' &&
                                            post.status !== 'published' &&
                                            post.status !== 'partial' && (
                                                <>
                                                    <button
                                                        onClick={() => setMusicPost(post)}
                                                        disabled={busyId === post._id}
                                                        className="bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-500/20 disabled:opacity-40 px-4 py-2.5 rounded-xl text-xs font-bold transition-all"
                                                    >
                                                        {post.music ? '♪ Change music' : '♪ Add music'}
                                                    </button>
                                                    {/* Opens the Composer (or Reels page) filled with this post. A photo reel is edited as its image. */}
                                                    <Link
                                                        href={`${isReel(post) && !post.photo ? '/reels' : '/composer'}?edit=${post._id}`}
                                                        className="bg-hover hover:bg-hover-strong text-fg border border-line-strong px-4 py-2.5 rounded-xl text-xs font-bold text-center transition-all"
                                                    >
                                                        Edit
                                                    </Link>
                                                    <button
                                                        onClick={() => setDeleteTarget(post)}
                                                        disabled={busyId === post._id}
                                                        className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/10 px-4 py-2.5 rounded-xl text-xs font-bold transition-all"
                                                    >
                                                        Delete
                                                    </button>
                                                </>
                                            )}
                                    </div>
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}

            <Modal
                isOpen={deleteTarget !== null}
                onClose={() => setDeleteTarget(null)}
                onConfirm={() => {
                    if (deleteTarget) void remove(deleteTarget);
                }}
                title={deleteTarget && isReel(deleteTarget) ? 'Delete this reel?' : 'Delete this post?'}
                message={`This removes it from Meta-Bru. Its ${
                    deleteTarget && isReel(deleteTarget) ? 'video' : 'image'
                } is also deleted from your Cloudinary account when no other post uses it. This cannot be undone.`}
                confirmText="Delete"
                type="danger"
            />

            <MusicModal
                post={musicPost}
                onClose={() => setMusicPost(null)}
                onSaved={musicSaved}
            />

            <StoryShareModal
                post={storyPost}
                selected={storySelection}
                onToggle={toggleStoryPlatform}
                onClose={() => setStoryPost(null)}
                onConfirm={() => {
                    if (storyPost) void shareStory(storyPost, storySelection);
                }}
            />
        </AppShell>
    );
}
