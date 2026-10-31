'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AiLabelChip } from '@/components/AiLabelToggle';
import { AppShell } from '@/components/AppShell';
import { StatusBadge } from '@/components/Dashboards';
import { EmptyState, ListSkeleton } from '@/components/Feedback';
import { Modal } from '@/components/Modal';
import { activePageId, pagesOf, postPageId } from '@/components/PageFilter';
import { ShareStoryButton, StoryShareNotice, useStoryShare } from '@/components/ShareStory';
import { Tabs } from '@/components/Tabs';
import { postsApi } from '@/lib/apiClient';
import {
    connectionName,
    formatElapsed,
    isReel,
    postThumbnailUrl,
    type Platform,
    type Post,
    type PostTarget,
} from '@/lib/types';
import { useNow } from '@/lib/useNow';

const FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'published', label: 'Published' },
    { key: 'failed', label: 'Failed' },
    { key: 'instagram-missing', label: 'Not on Instagram' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

const PLATFORM_FILTERS = [
    { key: 'all', label: 'Both platforms' },
    { key: 'facebook', label: 'Facebook' },
    { key: 'instagram', label: 'Instagram' },
] as const;

type PlatformKey = (typeof PLATFORM_FILTERS)[number]['key'];

const PLATFORMS: Array<{ key: Platform; label: string }> = [
    { key: 'facebook', label: 'Facebook' },
    { key: 'instagram', label: 'Instagram' },
];

const POLL_MS = 30_000;

/** The day a post belongs to in IST, for grouping. */
function istDay(value: string): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(value));
}

function dayHeading(day: string, now: number): string {
    if (now > 0) {
        if (day === istDay(new Date(now).toISOString())) return 'Today';
        if (day === istDay(new Date(now - 86_400_000).toISOString())) return 'Yesterday';
    }
    return new Date(`${day}T00:00:00+05:30`).toLocaleDateString('en-IN', {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
        timeZone: 'Asia/Kolkata',
    });
}

function istTime(value: string): string {
    return new Date(value).toLocaleTimeString('en-IN', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata',
    });
}

function postTime(post: Post): string {
    return post.publishedAt || post.updatedAt;
}

function instagramHandle(post: Post): string {
    return typeof post.connectionId === 'string' ? '' : post.connectionId?.instagram?.username || '';
}

function pageHasInstagram(post: Post): boolean {
    return typeof post.connectionId !== 'string' && Boolean(post.connectionId?.instagram);
}

/** Reached Facebook or Instagram, so it is still live there after a delete. */
function wentOut(post: Post): boolean {
    return post.targets.some((target) => target.status === 'published');
}

/** Published on Facebook, its Page now has Instagram, and Instagram does not have it yet. */
function canAddToInstagram(post: Post): boolean {
    return (
        (post.status === 'published' || post.status === 'partial') &&
        pageHasInstagram(post) &&
        post.targets.some((target) => target.platform === 'facebook' && target.status === 'published') &&
        !post.targets.some((target) => target.platform === 'instagram' && target.status === 'published')
    );
}

const STATE_STYLES = {
    ok: 'text-emerald-700 dark:text-emerald-300',
    bad: 'text-rose-700 dark:text-rose-300',
    busy: 'text-amber-700 dark:text-amber-300',
    none: 'text-subtle',
} as const;

function deliveryState(target: PostTarget | undefined, story: boolean): {
    tone: keyof typeof STATE_STYLES;
    icon: string;
    label: string;
} {
    if (!target) return { tone: 'none', icon: '–', label: story ? 'Not shared' : 'Not sent' };
    if (target.status === 'published') return { tone: 'ok', icon: '✓', label: story ? 'Shared' : 'Published' };
    if (target.status === 'failed') return { tone: 'bad', icon: '✕', label: 'Failed' };
    if (target.status === 'publishing') return { tone: 'busy', icon: '…', label: story ? 'Sharing' : 'Publishing' };
    return { tone: 'busy', icon: '…', label: 'Waiting' };
}

/**
 * Where one post went: a row per platform, with its feed post and its Story,
 * so a glance shows what published, what failed, and why.
 */
function DeliveryGrid({
    post,
    onAddToInstagram,
    adding,
}: {
    post: Post;
    onAddToInstagram: (post: Post) => void;
    adding: boolean;
}) {
    const handle = instagramHandle(post);
    const addable = canAddToInstagram(post);
    return (
        <div className="mt-3 overflow-hidden rounded-xl border border-line">
            <table className="w-full text-xs">
                <thead className="bg-surface-2 text-[10px] uppercase tracking-widest text-subtle">
                    <tr>
                        <th className="px-3 py-2 text-left font-bold">Platform</th>
                        <th className="px-3 py-2 text-left font-bold">{isReel(post) ? 'Reel' : 'Feed post'}</th>
                        <th className="px-3 py-2 text-left font-bold">Story</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-line">
                    {PLATFORMS.map((platform) => {
                        const target = post.targets.find((item) => item.platform === platform.key);
                        const storyTarget = (post.storyTargets ?? []).find((item) => item.platform === platform.key);
                        const noAccount = platform.key === 'instagram' && !pageHasInstagram(post) && !target;
                        const feed = deliveryState(target, false);
                        const story = deliveryState(storyTarget, true);
                        const link =
                            target?.status === 'published' && target.externalId
                                ? platform.key === 'facebook'
                                    ? { href: `https://www.facebook.com/${target.externalId}`, label: 'View ↗' }
                                    : handle
                                      ? { href: `https://www.instagram.com/${handle}/`, label: `@${handle} ↗` }
                                      : null
                                : null;
                        return (
                            <tr key={platform.key} className={!target && !storyTarget ? 'bg-surface-2/40' : ''}>
                                <td className="px-3 py-2.5 align-top">
                                    <span className="inline-flex items-center gap-1.5 font-semibold text-fg">
                                        <span
                                            aria-hidden="true"
                                            className={`h-2 w-2 rounded-full ${
                                                platform.key === 'facebook' ? 'bg-[color:var(--viz-facebook)]' : 'bg-[color:var(--viz-instagram)]'
                                            }`}
                                        />
                                        {platform.label}
                                    </span>
                                </td>
                                <td className="px-3 py-2.5 align-top">
                                    {noAccount ? (
                                        <span className="text-subtle">No Instagram on this Page</span>
                                    ) : (
                                        <>
                                            <span className={`font-semibold ${STATE_STYLES[feed.tone]}`}>
                                                <span aria-hidden="true">{feed.icon}</span> {feed.label}
                                            </span>
                                            {link ? (
                                                <a
                                                    href={link.href}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    title={target?.externalId}
                                                    className="ml-2 font-semibold text-indigo-700 hover:underline dark:text-indigo-300"
                                                >
                                                    {link.label}
                                                </a>
                                            ) : null}
                                            {target?.error ? (
                                                <div className="mt-1 text-[11px] text-rose-700 dark:text-rose-300">{target.error}</div>
                                            ) : null}
                                            {platform.key === 'instagram' && addable ? (
                                                <button
                                                    type="button"
                                                    onClick={() => onAddToInstagram(post)}
                                                    disabled={adding}
                                                    className="mt-1.5 block rounded-lg bg-gradient-to-r from-fuchsia-600 via-rose-500 to-orange-400 px-2.5 py-1 text-[11px] font-bold text-white hover:brightness-110 disabled:opacity-60"
                                                >
                                                    {adding
                                                        ? 'Publishing...'
                                                        : target?.status === 'failed'
                                                          ? 'Try Instagram again'
                                                          : 'Publish to Instagram'}
                                                </button>
                                            ) : null}
                                        </>
                                    )}
                                </td>
                                <td className="px-3 py-2.5 align-top">
                                    {noAccount ? (
                                        <span className="text-subtle">–</span>
                                    ) : (
                                        <>
                                            <span className={`font-semibold ${STATE_STYLES[story.tone]}`}>
                                                <span aria-hidden="true">{story.icon}</span> {story.label}
                                            </span>
                                            {storyTarget?.status === 'published' && storyTarget.publishedAt ? (
                                                <span className="ml-1.5 text-subtle">{istTime(storyTarget.publishedAt)}</span>
                                            ) : null}
                                            {storyTarget?.error ? (
                                                <div className="mt-1 text-[11px] text-rose-700 dark:text-rose-300">{storyTarget.error}</div>
                                            ) : null}
                                        </>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function TrashIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
        </svg>
    );
}

export default function ActivityPage() {
    const [posts, setPosts] = useState<Post[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    // The first load failed; the banner then offers Retry.
    const [loadFailed, setLoadFailed] = useState(false);
    // A background refresh that failed; the list on screen is kept.
    const [offline, setOffline] = useState(false);
    const [loadedAt, setLoadedAt] = useState<string | null>(null);
    const [filter, setFilter] = useState<FilterKey>('all');
    const [platform, setPlatform] = useState<PlatformKey>('all');
    const [chosenPageId, setPageId] = useState('');
    const pageId = activePageId(posts, chosenPageId);
    const [notice, setNotice] = useState('');
    const [deleteTarget, setDeleteTarget] = useState<Post | null>(null);
    const [deletingId, setDeletingId] = useState('');
    const [clearOpen, setClearOpen] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [instagramTarget, setInstagramTarget] = useState<Post | null>(null);
    const [addingId, setAddingId] = useState('');
    const hasLoaded = useRef(false);
    const now = useNow(15_000);
    // The share response is not populated; keep the Page details we have.
    const story = useStoryShare((updated) =>
        setPosts((current) =>
            current.map((item) =>
                item._id === updated._id ? { ...updated, connectionId: item.connectionId } : item
            )
        )
    );

    const load = useCallback(async () => {
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
            hasLoaded.current = true;
            setOffline(false);
            setLoadFailed(false);
            setLoadedAt(new Date().toISOString());
        } catch (err: any) {
            // After the first load, a failed refresh keeps the list and says so
            // quietly; the next refresh usually recovers (the server may be waking up).
            if (hasLoaded.current) setOffline(true);
            else {
                setLoadFailed(true);
                setError(typeof err === 'string' && err !== 'Failed to fetch' ? err : 'Could not reach Meta-Bru. Check your connection, then retry.');
            }
        } finally {
            setLoading(false);
        }
    }, []);

    // Overview links straight to a filter, e.g. /activity?filter=failed.
    useEffect(() => {
        const requested = new URLSearchParams(window.location.search).get('filter');
        const match = FILTERS.find((item) => item.key === requested);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (match) setFilter(match.key);
    }, []);

    useEffect(() => {
        // Initial data load; state updates happen after the request resolves.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load();
        const interval = setInterval(() => {
            if (document.visibilityState === 'visible') void load();
        }, POLL_MS);
        const onVisible = () => {
            if (document.visibilityState === 'visible') void load();
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [load]);

    const matchesPlatform = (post: Post) =>
        platform === 'all' || post.targets.some((target) => target.platform === platform);
    const matchesStatus = (post: Post) => {
        if (filter === 'instagram-missing') return canAddToInstagram(post);
        if (filter === 'published') return post.status === 'published' || post.status === 'partial';
        if (filter === 'failed') return post.status === 'failed' || post.status === 'partial';
        return true;
    };
    const visible = posts.filter(
        (post) => (!pageId || postPageId(post) === pageId) && matchesStatus(post) && matchesPlatform(post)
    );
    const filterLabel = FILTERS.find((item) => item.key === filter)?.label ?? 'All';

    // Page by Page totals, so it is clear which Page each post belongs to.
    const pages = pagesOf(posts).map((page) => {
        const pagePosts = posts.filter((post) => postPageId(post) === page.id && matchesPlatform(post));
        return {
            ...page,
            total: pagePosts.length,
            failed: pagePosts.filter((post) => post.status === 'failed' || post.status === 'partial').length,
            stories: pagePosts.filter((post) =>
                (post.storyTargets ?? []).some((target) => target.status === 'published')
            ).length,
        };
    });
    const totals = {
        published: visible.filter((post) => post.status === 'published').length,
        failed: visible.filter((post) => post.status === 'failed' || post.status === 'partial').length,
        facebook: visible.filter((post) => post.targets.some((t) => t.platform === 'facebook' && t.status === 'published')).length,
        instagram: visible.filter((post) => post.targets.some((t) => t.platform === 'instagram' && t.status === 'published')).length,
        stories: visible.reduce(
            (sum, post) => sum + (post.storyTargets ?? []).filter((t) => t.status === 'published').length,
            0
        ),
    };

    const groups: Array<{ day: string; posts: Post[] }> = [];
    for (const post of [...visible].sort((a, b) => postTime(b).localeCompare(postTime(a)))) {
        const day = istDay(postTime(post));
        const group = groups.at(-1);
        if (group && group.day === day) group.posts.push(post);
        else groups.push({ day, posts: [post] });
    }

    const addToInstagram = async (post: Post) => {
        setAddingId(post._id);
        setError('');
        setNotice('');
        try {
            const data = await postsApi.publishToInstagram(post._id);
            // The response is not populated; keep the Page details we have.
            setPosts((current) =>
                current.map((item) => (item._id === post._id ? { ...data.post, connectionId: item.connectionId } : item))
            );
            const instagram = data.post.targets.find((target) => target.platform === 'instagram');
            if (instagram?.status === 'published') {
                setNotice(`Published to Instagram${instagramHandle(post) ? ` @${instagramHandle(post)}` : ''}.`);
            } else {
                setError(`Instagram did not accept it: ${instagram?.error || 'unknown error'}`);
            }
        } catch (err) {
            setError(typeof err === 'string' ? err : 'Could not publish to Instagram');
        } finally {
            setAddingId('');
        }
    };
    const missingInstagram = posts.filter(canAddToInstagram).length;

    const remove = async (post: Post) => {
        setDeletingId(post._id);
        setError('');
        setNotice('');
        try {
            const data = await postsApi.remove(post._id);
            setPosts((current) => current.filter((item) => item._id !== post._id));
            setNotice(
                (data.mediaDeleted
                    ? 'Deleted from Meta-Bru, along with its Cloudinary file.'
                    : 'Deleted from Meta-Bru.') +
                    (wentOut(post)
                        ? ' It is still live, so Refresh insights on Analytics reads it back from Facebook and Instagram as posted directly.'
                        : '')
            );
            if (data.mediaError) setError(`Could not remove its Cloudinary file: ${data.mediaError}`);
        } catch (err) {
            setError(typeof err === 'string' ? err : 'Could not delete this post');
        } finally {
            setDeletingId('');
        }
    };

    const clearAll = async () => {
        setClearing(true);
        setError('');
        setNotice('');
        try {
            if (filter === 'instagram-missing') return;
            const data = await postsApi.clearActivity(filter, pageId);
            const statuses =
                filter === 'published'
                    ? ['published', 'partial']
                    : filter === 'failed'
                      ? ['failed', 'partial']
                      : ['published', 'partial', 'failed'];
            setPosts((current) =>
                current.filter(
                    (post) =>
                        !statuses.includes(post.status) || (pageId !== '' && postPageId(post) !== pageId)
                )
            );
            setNotice(
                `Deleted ${data.deleted} post${data.deleted === 1 ? '' : 's'} from Meta-Bru` +
                    (data.mediaDeleted > 0
                        ? ` and ${data.mediaDeleted} unused Cloudinary file${data.mediaDeleted === 1 ? '' : 's'}`
                        : '') +
                    '.' +
                    (filter === 'failed'
                        ? ''
                        : ' What went out is still live, so Refresh insights on Analytics reads it back from Facebook and Instagram as posted directly.')
            );
            if (data.mediaErrors > 0) {
                setError(`${data.mediaErrors} Cloudinary file${data.mediaErrors === 1 ? '' : 's'} could not be removed. Clean them up from Storage.`);
            }
        } catch (err) {
            setError(typeof err === 'string' ? err : 'Could not clear activity');
        } finally {
            setClearing(false);
        }
    };

    return (
        <AppShell
            title="Activity"
            subtitle="Everything Meta-Bru published or tried to publish, by Page, platform, and Story."
            actions={
                <div className="flex flex-col items-start gap-1 sm:items-end">
                    <button
                        type="button"
                        onClick={() => setClearOpen(true)}
                        disabled={loading || clearing || visible.length === 0 || platform !== 'all' || filter === 'instagram-missing'}
                        title={platform !== 'all' ? 'Clear works on both platforms; switch to Both platforms first.' : undefined}
                        className="inline-flex items-center gap-2 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-2.5 text-sm font-bold text-rose-700 hover:bg-rose-500/15 disabled:opacity-40 dark:text-rose-300"
                    >
                        <TrashIcon />
                        {clearing ? 'Clearing...' : filter === 'all' ? 'Clear all' : `Clear ${filterLabel.toLowerCase()}`}
                    </button>
                    <span className={`text-[11px] ${offline ? 'text-amber-700 dark:text-amber-300' : 'text-subtle'}`}>
                        {offline ? (
                            <>
                                Could not refresh; showing the last list.{' '}
                                <button type="button" onClick={() => void load()} className="font-bold underline">
                                    Retry
                                </button>
                            </>
                        ) : loadedAt ? (
                            `Updated ${formatElapsed(loadedAt, now) || 'just now'} · refreshes every 30s`
                        ) : null}
                    </span>
                </div>
            }
        >
            {notice ? (
                <div className="animate-fade-up mb-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
                    {notice}
                </div>
            ) : null}
            {error ? (
                <div className="animate-fade-up mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                    <span>{error}</span>
                    {loadFailed ? (
                        <button
                            type="button"
                            onClick={() => {
                                setError('');
                                setLoading(true);
                                void load();
                            }}
                            className="rounded-lg px-3 py-1.5 text-xs font-bold hover:bg-rose-500/10"
                        >
                            Retry
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setError('')}
                            aria-label="Dismiss"
                            className="rounded-lg px-2 py-1 text-xs font-bold hover:bg-rose-500/10"
                        >
                            ✕
                        </button>
                    )}
                </div>
            ) : null}
            <StoryShareNotice outcome={story.outcome} onDismiss={story.clearOutcome} />

            {pages.length > 0 ? (
                <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
                    <button
                        type="button"
                        onClick={() => setPageId('')}
                        className={`shrink-0 rounded-2xl border px-4 py-2.5 text-left transition-colors ${
                            !pageId ? 'border-indigo-500/40 bg-indigo-500/10' : 'border-line bg-surface hover:bg-hover'
                        }`}
                    >
                        <div className="text-xs font-bold text-fg">All Pages</div>
                        <div className="text-[11px] text-subtle">{posts.filter(matchesPlatform).length} posts</div>
                    </button>
                    {pages.map((page) => (
                        <button
                            key={page.id}
                            type="button"
                            onClick={() => setPageId(page.id === pageId ? '' : page.id)}
                            className={`shrink-0 rounded-2xl border px-4 py-2.5 text-left transition-colors ${
                                pageId === page.id ? 'border-indigo-500/40 bg-indigo-500/10' : 'border-line bg-surface hover:bg-hover'
                            }`}
                        >
                            <div className="text-xs font-bold text-fg">{page.name}</div>
                            <div className="text-[11px] text-subtle">
                                {page.total} posts · {page.stories} with Story
                                {page.failed > 0 ? (
                                    <span className="font-semibold text-rose-700 dark:text-rose-300"> · {page.failed} failed</span>
                                ) : null}
                            </div>
                        </button>
                    ))}
                </div>
            ) : null}

            {missingInstagram > 0 && filter !== 'instagram-missing' ? (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/5 px-4 py-3 text-sm text-fg-2">
                    <span>
                        <strong>{missingInstagram}</strong> post{missingInstagram === 1 ? ' is' : 's are'} on Facebook but
                        not on Instagram, though the Page now has Instagram linked.
                    </span>
                    <button
                        type="button"
                        onClick={() => setFilter('instagram-missing')}
                        className="rounded-xl px-3 py-1.5 text-xs font-bold text-fuchsia-700 hover:bg-fuchsia-500/10 dark:text-fuchsia-300"
                    >
                        Show them →
                    </button>
                </div>
            ) : null}

            <div className="mb-5 flex flex-wrap items-center gap-2">
                <Tabs
                    label="Activity filter"
                    items={FILTERS.map((item) =>
                        item.key === 'instagram-missing' && missingInstagram > 0 ? { ...item, count: missingInstagram } : item
                    )}
                    value={filter}
                    onChange={setFilter}
                />
                <Tabs
                    label="Platform filter"
                    variant="segmented"
                    items={PLATFORM_FILTERS}
                    value={platform}
                    onChange={setPlatform}
                />
            </div>

            {!loading && visible.length > 0 ? (
                <div className="mb-5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
                    <span>
                        <strong className="text-fg">{totals.published}</strong> published
                    </span>
                    <span>
                        <strong className={totals.failed > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-fg'}>{totals.failed}</strong>{' '}
                        failed or partly failed
                    </span>
                    <span>
                        <strong className="text-fg">{totals.facebook}</strong> on Facebook
                    </span>
                    <span>
                        <strong className="text-fg">{totals.instagram}</strong> on Instagram
                    </span>
                    <span>
                        <strong className="text-fg">{totals.stories}</strong> Stories shared
                    </span>
                </div>
            ) : null}

            {loading ? (
                <ListSkeleton />
            ) : visible.length === 0 ? (
                <EmptyState
                    key={`${filter}-${platform}`}
                    title={
                        filter === 'all'
                            ? 'No publishing activity yet'
                            : filter === 'instagram-missing'
                              ? 'Every post is on Instagram'
                              : `Nothing ${filter} yet`
                    }
                    body={
                        filter === 'instagram-missing'
                            ? 'Posts published only to Facebook show here once their Page has Instagram linked.'
                            : 'Published and failed posts will appear here.'
                    }
                />
            ) : (
                <div key={`${filter}-${pageId}-${platform}`} className="space-y-6">
                    {groups.map((group) => (
                        <section key={group.day}>
                            <h2 className="mb-2.5 text-xs font-bold uppercase tracking-widest text-subtle">
                                {dayHeading(group.day, now)}{' '}
                                <span className="font-semibold normal-case tracking-normal text-faint">
                                    · {group.posts.length} post{group.posts.length === 1 ? '' : 's'}
                                </span>
                            </h2>
                            <div className="space-y-3">
                                {group.posts.map((post) => (
                                    <article
                                        key={post._id}
                                        className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5"
                                    >
                                        <div className="flex gap-4">
                                            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-line bg-sunken">
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img src={postThumbnailUrl(post)} alt="" className="h-full w-full object-cover" />
                                                {isReel(post) ? (
                                                    <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                                                        Reel
                                                    </span>
                                                ) : null}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="text-sm font-bold text-fg">{connectionName(post)}</span>
                                                    <span className="text-xs text-subtle">{istTime(postTime(post))}</span>
                                                    <StatusBadge status={post.status} />
                                                    {post.aiGenerated ? <AiLabelChip /> : null}
                                                    <div className="ml-auto flex items-center gap-2">
                                                        <ShareStoryButton
                                                            post={post}
                                                            onOpen={story.open}
                                                            sharing={story.sharingId === post._id}
                                                            size="sm"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => setDeleteTarget(post)}
                                                            disabled={deletingId === post._id}
                                                            aria-label="Delete from Meta-Bru"
                                                            title="Delete from Meta-Bru"
                                                            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-line text-subtle hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-600 disabled:opacity-40 dark:hover:text-rose-300"
                                                        >
                                                            {deletingId === post._id ? (
                                                                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current/30 border-t-current" />
                                                            ) : (
                                                                <TrashIcon />
                                                            )}
                                                        </button>
                                                    </div>
                                                </div>
                                                <p className="mt-1.5 line-clamp-2 whitespace-pre-wrap text-sm text-fg-2">
                                                    {post.caption}
                                                </p>
                                                {post.attempts > 1 ? (
                                                    <p className="mt-1 text-[11px] text-subtle">
                                                        Took {post.attempts} attempts
                                                    </p>
                                                ) : null}
                                            </div>
                                        </div>
                                        <DeliveryGrid
                                            post={post}
                                            onAddToInstagram={setInstagramTarget}
                                            adding={addingId === post._id}
                                        />
                                    </article>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            )}
            {story.modal}

            <Modal
                isOpen={instagramTarget !== null}
                onClose={() => setInstagramTarget(null)}
                onConfirm={() => {
                    if (instagramTarget) void addToInstagram(instagramTarget);
                    setInstagramTarget(null);
                }}
                title="Publish this post to Instagram now?"
                message={`It goes live on ${
                    instagramTarget && instagramHandle(instagramTarget) ? `@${instagramHandle(instagramTarget)}` : 'Instagram'
                } right away, with the same caption and ${
                    instagramTarget && isReel(instagramTarget) ? 'reel' : 'image'
                }${
                    instagramTarget?.shareToStory ? ', and is shared to its Instagram Story too' : ''
                }. The Facebook post is not changed.`}
                confirmText="Publish to Instagram"
            />
            <Modal
                isOpen={deleteTarget !== null}
                onClose={() => setDeleteTarget(null)}
                onConfirm={() => {
                    if (deleteTarget) void remove(deleteTarget);
                }}
                title="Delete this post from Meta-Bru?"
                message={`It is removed from Activity, Queue, Overview, and Analytics, and its Cloudinary file is deleted when no other post uses it.${
                    deleteTarget && wentOut(deleteTarget)
                        ? ' It stays live on Facebook and Instagram, and the next Refresh insights on Analytics reads it back from there as posted directly.'
                        : ''
                } This cannot be undone.`}
                confirmText="Delete"
                type="danger"
            />
            <Modal
                isOpen={clearOpen}
                onClose={() => setClearOpen(false)}
                onConfirm={() => void clearAll()}
                title={`Delete ${visible.length} post${visible.length === 1 ? '' : 's'} from Meta-Bru?`}
                message={`Every post in ${filter === 'all' ? 'Activity' : `the ${filterLabel} filter`}${
                    pageId ? ' for this Page' : ''
                } is removed from Activity, Queue, Overview, and Analytics, with Cloudinary files no other post uses.${
                    filter === 'failed'
                        ? ''
                        : ' Posts that went out stay live on Facebook and Instagram, and the next Refresh insights on Analytics reads them back from there as posted directly.'
                } This cannot be undone.`}
                confirmText={`Delete ${visible.length}`}
                type="danger"
            />
        </AppShell>
    );
}
