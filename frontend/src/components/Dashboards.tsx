'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { Modal } from '@/components/Modal';
import { PasswordResetModal } from '@/components/PasswordResetModal';
import { ShareStoryButton, StoryShareNotice, useStoryShare } from '@/components/ShareStory';
import { useAuth } from '@/context/AuthContext';
import { adminApi, authApi, connectionsApi, postsApi } from '@/lib/apiClient';
import {
    connectionName,
    formatDate,
    postThumbnailUrl,
    type AdminOverview,
    type Post,
    type PostStatus,
    type SocialConnection,
} from '@/lib/types';
import { formatDailyTimes } from '@/lib/schedule';

const STATUS_STYLES: Record<PostStatus, string> = {
    draft: 'bg-slate-500/10 text-fg-2 border-slate-500/20',
    queued: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20',
    publishing: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20',
    published: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
    partial: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
    failed: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20',
};

export function StatusBadge({ status }: { status: PostStatus }) {
    return (
        <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border ${STATUS_STYLES[status]}`}
        >
            {status}
        </span>
    );
}

function StatCard({
    label,
    value,
    accent,
    hint,
}: {
    label: string;
    value: string | number;
    accent: string;
    hint?: string;
}) {
    return (
        <div className={`rounded-2xl border p-6 shadow-card transition-[box-shadow,translate] duration-200 hover:-translate-y-0.5 hover:shadow-card-hover ${accent}`}>
            <div className="text-xs font-bold uppercase tracking-widest opacity-70">
                {label}
            </div>
            <div className="text-3xl font-bold text-fg mt-2">{value}</div>
            {hint ? <div className="text-xs mt-2 opacity-60">{hint}</div> : null}
        </div>
    );
}

function RecentPostRow({
    post,
    onShareStory,
    sharing,
}: {
    post: Post;
    /** Left out on the admin overview, which lists other users' posts. */
    onShareStory?: (post: Post) => void;
    sharing?: boolean;
}) {
    return (
        <div className="flex items-center gap-4 py-4 border-b border-line last:border-0">
            <div className="w-12 h-12 rounded-xl overflow-hidden bg-sunken shrink-0 border border-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={postThumbnailUrl(post)}
                    alt=""
                    className="w-full h-full object-cover"
                />
            </div>
            <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-fg truncate">
                    {post.caption || 'Untitled post'}
                </div>
                <div className="text-xs text-subtle mt-0.5">
                    {connectionName(post)} · {formatDate(post.createdAt)}
                </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
                {onShareStory ? (
                    <ShareStoryButton
                        post={post}
                        onOpen={() => onShareStory(post)}
                        sharing={Boolean(sharing)}
                        size="sm"
                    />
                ) : null}
                <StatusBadge status={post.status} />
            </div>
        </div>
    );
}

function NextSlotCard({ connections }: { connections: SocialConnection[] }) {
    const upcoming = connections
        .filter(
            (connection) =>
                connection.isActive &&
                connection.tokenStatus === 'active' &&
                connection.nextRunAt
        )
        .sort(
            (a, b) =>
                new Date(a.nextRunAt as string).getTime() -
                new Date(b.nextRunAt as string).getTime()
        )[0];

    return (
        <div className="rounded-2xl border border-line bg-surface p-8 shadow-card">
            <div className="text-xs font-bold uppercase tracking-widest text-indigo-700 dark:text-indigo-400">
                Next scheduled slot
            </div>
            {upcoming ? (
                <>
                    <div className="text-2xl font-bold text-fg mt-3">
                        {formatDate(upcoming.nextRunAt)}
                    </div>
                    <div className="text-sm text-muted mt-1">
                        {upcoming.pageName} · {upcoming.timezone}
                    </div>
                    <div className="text-xs text-subtle mt-4">
                        The next approved post in this queue will publish
                        automatically.
                    </div>
                </>
            ) : (
                <>
                    <div className="text-2xl font-bold text-fg mt-3">
                        Nothing scheduled
                    </div>
                    <div className="text-sm text-muted mt-1">
                        Connect a Page and add a post to the queue to start the
                        daily schedule.
                    </div>
                    <Link
                        href="/connections"
                        className="inline-flex mt-5 bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
                    >
                        Manage connections
                    </Link>
                </>
            )}
        </div>
    );
}

export function UserDashboard() {
    const { user } = useAuth();
    const [connections, setConnections] = useState<SocialConnection[]>([]);
    const [posts, setPosts] = useState<Post[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    // The share response is not populated; keep the Page details we have.
    const story = useStoryShare((updated) =>
        setPosts((current) =>
            current.map((item) =>
                item._id === updated._id ? { ...updated, connectionId: item.connectionId } : item
            )
        )
    );

    useEffect(() => {
        const load = async () => {
            try {
                const [connectionData, postData]: any[] = await Promise.all([
                    connectionsApi.list(),
                    postsApi.list({ limit: '200' }),
                ]);
                setConnections(connectionData.connections || []);
                setPosts(postData.posts || []);
            } catch (err: any) {
                setError(typeof err === 'string' ? err : 'Could not load overview');
            } finally {
                setLoading(false);
            }
        };
        void load();
    }, []);

    const queued = posts.filter((post) => post.status === 'queued').length;
    const published = posts.filter(
        (post) => post.status === 'published' || post.status === 'partial'
    ).length;
    const needsReauth = connections.filter(
        (connection) => connection.tokenStatus === 'needs_reauth'
    ).length;

    if (!user) return null;

    return (
        <AppShell
            title="Overview"
            subtitle={`Welcome back, ${user.name}`}
            actions={
                <>
                    <Link
                        href="/composer"
                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
                    >
                        New post
                    </Link>
                    <Link
                        href="/connections"
                        className="bg-hover hover:bg-hover-strong text-fg border border-line-strong px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
                    >
                        Connections
                    </Link>
                </>
            }
        >
            {error ? (
                <div className="animate-fade-up mb-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                    {error}
                </div>
            ) : null}
            <StoryShareNotice outcome={story.outcome} onDismiss={story.clearOutcome} />

            <div className="stagger grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <StatCard
                    label="Connections"
                    value={connections.length}
                    accent="border-indigo-500/20 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
                />
                <StatCard
                    label="Queued"
                    value={queued}
                    accent="border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                />
                <StatCard
                    label="Published"
                    value={published}
                    accent="border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                />
                <StatCard
                    label="Needs reconnect"
                    value={needsReauth}
                    accent="border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                />
            </div>

            <div className="stagger grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                <NextSlotCard connections={connections} />
                <div className="rounded-2xl border border-line bg-surface p-8 shadow-card">
                    <div className="text-xs font-bold uppercase tracking-widest text-purple-700 dark:text-purple-400">
                        Composer
                    </div>
                    <div className="text-2xl font-bold text-fg mt-3">
                        Build your next post
                    </div>
                    <div className="text-sm text-muted mt-1">
                        Write a caption, upload an image, or ask Gemini for a
                        draft. Then add it to a connection&apos;s daily queue.
                    </div>
                    <Link
                        href="/composer"
                        className="inline-flex mt-5 bg-purple-600 hover:bg-purple-500 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
                    >
                        Open composer
                    </Link>
                </div>
            </div>

            <section className="rounded-2xl border border-line bg-surface p-6 sm:p-8 shadow-card">
                <div className="flex items-center justify-between mb-2">
                    <h2 className="text-lg font-bold text-fg">Recent posts</h2>
                    <Link
                        href="/queue"
                        className="text-sm font-semibold text-indigo-700 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
                    >
                        View queue
                    </Link>
                </div>
                {loading ? (
                    <div className="flex justify-center py-12">
                        <div className="animate-spin rounded-full h-8 w-8 border-[3px] border-indigo-500/20 border-t-indigo-500" />
                    </div>
                ) : posts.length === 0 ? (
                    <div className="py-10 text-center text-sm text-subtle">
                        No posts yet. Create your first one in the composer.
                    </div>
                ) : (
                    <div>
                        {posts.slice(0, 5).map((post) => (
                            <RecentPostRow
                                key={post._id}
                                post={post}
                                onShareStory={story.open}
                                sharing={story.sharingId === post._id}
                            />
                        ))}
                    </div>
                )}
            </section>
            {story.modal}
        </AppShell>
    );
}

interface AdminUser {
    _id: string;
    name: string;
    email: string;
    role: string;
    isActive: boolean;
    mustChangePassword?: boolean;
}

interface AdminConnection extends SocialConnection {
    userId?: {
        name?: string;
        email?: string;
    } | null;
}

function ConnectionStatus({
    isActive,
    tokenStatus,
}: Pick<SocialConnection, 'isActive' | 'tokenStatus'>) {
    const isDisconnected = tokenStatus === 'disconnected';
    const needsReauth = tokenStatus === 'needs_reauth';

    return (
        <span
            className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border ${
                isDisconnected
                    ? 'bg-slate-500/10 text-muted border-slate-500/20'
                    : needsReauth
                      ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20'
                      : !isActive
                        ? 'bg-slate-500/10 text-muted border-slate-500/20'
                        : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20'
            }`}
        >
            {isDisconnected
                ? 'Disconnected'
                : needsReauth
                  ? 'Reconnect'
                  : !isActive
                    ? 'Paused'
                    : 'Active'}
        </span>
    );
}

export function AdminDashboard() {
    const { user } = useAuth();
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [overview, setOverview] = useState<AdminOverview | null>(null);
    const [adminConnections, setAdminConnections] = useState<AdminConnection[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
    const [modal, setModal] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        confirmText: string;
        type: 'danger' | 'info' | 'success';
        onConfirm: () => void;
    }>({
        isOpen: false,
        title: '',
        message: '',
        confirmText: 'Confirm',
        type: 'info',
        onConfirm: () => undefined,
    });

    const load = async () => {
        setError('');
        try {
            const [overviewData, usersData, connectionData]: any[] = await Promise.all([
                adminApi.overview(),
                authApi.getUsers(),
                adminApi.connections(),
            ]);
            setOverview(overviewData);
            setUsers(usersData.users || []);
            setAdminConnections(connectionData.connections || []);
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not load admin data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const requestStatusChange = (target: AdminUser) => {
        const approving = !target.isActive;
        setModal({
            isOpen: true,
            title: approving ? 'Approve Account?' : 'Mark as Inactive?',
            message: approving
                ? `This will grant ${target.name} full access to the platform.`
                : `This will immediately restrict ${target.name} from accessing platform features.`,
            confirmText: approving ? 'Approve' : 'Mark Inactive',
            type: approving ? 'success' : 'danger',
            onConfirm: async () => {
                try {
                    const data: any = await authApi.toggleUserStatus(
                        target._id,
                        !target.isActive
                    );
                    if (data.success) {
                        // Refresh so paused connections and stats stay in sync.
                        await load();
                    }
                } catch (err: any) {
                    setError(typeof err === 'string' ? err : 'Could not update user');
                }
            },
        });
    };

    if (!user) return null;

    const stats = overview?.stats;

    return (
        <AppShell
            title="Admin Command Center"
            subtitle={`Administrator: ${user.name}`}
            actions={
                <button
                    onClick={() => void load()}
                    className="bg-hover hover:bg-hover-strong text-fg border border-line-strong px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
                >
                    Refresh
                </button>
            }
        >
            <Modal
                {...modal}
                onClose={() => setModal((current) => ({ ...current, isOpen: false }))}
            />

            {resetTarget ? (
                <PasswordResetModal
                    target={resetTarget}
                    onClose={() => setResetTarget(null)}
                    onResetComplete={load}
                />
            ) : null}

            {error ? (
                <div className="animate-fade-up mb-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                    {error}
                </div>
            ) : null}

            <div className="stagger grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
                <StatCard
                    label="Users"
                    value={stats?.users ?? users.length}
                    accent="border-indigo-500/20 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
                />
                <StatCard
                    label="Connections"
                    value={stats?.connections ?? 0}
                    accent="border-purple-500/20 bg-purple-500/10 text-purple-700 dark:text-purple-300"
                />
                <StatCard
                    label="Queued"
                    value={stats?.queued ?? 0}
                    accent="border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                />
                <StatCard
                    label="Published 7d"
                    value={stats?.publishedThisWeek ?? 0}
                    accent="border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                />
                <StatCard
                    label="Reconnects"
                    value={stats?.needsReauth ?? 0}
                    accent="border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                />
            </div>

            <section className="rounded-2xl border border-line bg-surface p-6 sm:p-8 shadow-card mb-8">
                <h2 className="text-lg font-bold text-fg mb-2">
                    Recent platform activity
                </h2>
                {loading ? (
                    <div className="flex justify-center py-10">
                        <div className="animate-spin rounded-full h-8 w-8 border-[3px] border-indigo-500/20 border-t-indigo-500" />
                    </div>
                ) : (overview?.recentPosts.length ?? 0) === 0 ? (
                    <div className="py-8 text-center text-sm text-subtle">
                        No posts have been created yet.
                    </div>
                ) : (
                    overview?.recentPosts.map((post) => (
                        <RecentPostRow key={post._id} post={post} />
                    ))
                )}
            </section>

            <section className="rounded-2xl border border-line bg-surface p-6 sm:p-8 shadow-card mb-8">
                <h2 className="text-lg font-bold text-fg mb-6">
                    Connected Pages
                </h2>

                {loading ? (
                    <div className="flex justify-center py-10">
                        <div className="animate-spin rounded-full h-8 w-8 border-[3px] border-indigo-500/20 border-t-indigo-500" />
                    </div>
                ) : adminConnections.length === 0 ? (
                    <div className="py-8 text-center text-sm text-subtle">
                        No Pages have been connected yet.
                    </div>
                ) : (
                    <>
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full min-w-[840px] text-left">
                            <thead>
                                <tr className="text-subtle text-xs font-bold uppercase tracking-wider border-b border-line">
                                    <th className="pb-4 pl-4">User</th>
                                    <th className="pb-4">Page</th>
                                    <th className="pb-4">Instagram</th>
                                    <th className="pb-4">Schedule</th>
                                    <th className="pb-4">Status</th>
                                    <th className="pb-4 text-right pr-4">
                                        Next slot
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                                {adminConnections.map((connection) => (
                                    <tr
                                        key={connection._id}
                                        className="hover:bg-hover transition-colors"
                                    >
                                        <td className="py-4 pl-4">
                                            <div className="text-sm font-semibold text-fg">
                                                {connection.userId?.name ||
                                                    'Unknown user'}
                                            </div>
                                            <div className="text-xs text-subtle">
                                                {connection.userId?.email || ''}
                                            </div>
                                        </td>
                                        <td className="py-4">
                                            <div className="text-sm text-fg">
                                                {connection.pageName}
                                            </div>
                                            <div className="text-[11px] text-subtle">
                                                {connection.pageId}
                                            </div>
                                        </td>
                                        <td className="py-4 text-sm text-muted">
                                            {connection.instagram?.username
                                                ? `@${connection.instagram.username}`
                                                : 'Not linked'}
                                        </td>
                                        <td className="py-4 text-sm text-muted">
                                            {formatDailyTimes(connection.dailyTimes)}
                                            <div className="text-[11px] text-subtle">
                                                {connection.timezone}
                                            </div>
                                        </td>
                                        <td className="py-4">
                                            <ConnectionStatus
                                                isActive={connection.isActive}
                                                tokenStatus={
                                                    connection.tokenStatus
                                                }
                                            />
                                        </td>
                                        <td className="py-4 text-right pr-4 text-sm text-muted">
                                            {formatDate(connection.nextRunAt)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="md:hidden space-y-3">
                        {adminConnections.map((connection) => (
                            <article
                                key={connection._id}
                                className="rounded-2xl border border-line bg-surface-2 p-4"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="text-sm font-semibold text-fg truncate">
                                            {connection.pageName}
                                        </div>
                                        <div className="text-xs text-subtle truncate">
                                            {connection.userId?.name ||
                                                'Unknown user'}{' '}
                                            {connection.userId?.email
                                                ? `· ${connection.userId.email}`
                                                : ''}
                                        </div>
                                    </div>
                                    <ConnectionStatus
                                        isActive={connection.isActive}
                                        tokenStatus={connection.tokenStatus}
                                    />
                                </div>
                                <dl className="grid grid-cols-2 gap-3 mt-4 text-xs">
                                    <div>
                                        <dt className="text-subtle">
                                            Instagram
                                        </dt>
                                        <dd className="text-fg-2 mt-0.5">
                                            {connection.instagram?.username
                                                ? `@${connection.instagram.username}`
                                                : 'Not linked'}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-subtle">
                                            Daily schedule
                                        </dt>
                                        <dd className="text-fg-2 mt-0.5">
                                            {formatDailyTimes(connection.dailyTimes)} ·{' '}
                                            {connection.timezone}
                                        </dd>
                                    </div>
                                    <div className="col-span-2">
                                        <dt className="text-subtle">
                                            Next slot
                                        </dt>
                                        <dd className="text-fg-2 mt-0.5">
                                            {formatDate(connection.nextRunAt)}
                                        </dd>
                                    </div>
                                </dl>
                            </article>
                        ))}
                    </div>
                    </>
                )}
            </section>

            <section className="rounded-2xl border border-line bg-surface p-6 sm:p-8 shadow-card">
                <h2 className="text-lg font-bold text-fg mb-6">
                    User Management
                </h2>

                {loading ? (
                    <div className="flex justify-center py-10">
                        <div className="animate-spin rounded-full h-8 w-8 border-[3px] border-indigo-500/20 border-t-indigo-500" />
                    </div>
                ) : (
                    <>
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full min-w-[620px] text-left">
                            <thead>
                                <tr className="text-subtle text-xs font-bold uppercase tracking-wider border-b border-line">
                                    <th className="pb-4 pl-4">User</th>
                                    <th className="pb-4">Role</th>
                                    <th className="pb-4">Status</th>
                                    <th className="pb-4 text-right pr-4">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                                {users.map((item) => (
                                    <tr
                                        key={item._id}
                                        className="group hover:bg-hover transition-colors"
                                    >
                                        <td className="py-5 pl-4">
                                            <div className="flex items-center gap-4">
                                                <div className="w-10 h-10 rounded-xl bg-sunken flex items-center justify-center font-bold text-indigo-700 dark:text-indigo-400 border border-line">
                                                    {item.name[0]?.toUpperCase() || 'U'}
                                                </div>
                                                <div>
                                                    <div className="text-fg font-semibold">
                                                        {item.name}
                                                    </div>
                                                    <div className="text-subtle text-xs">
                                                        {item.email}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="py-5 text-sm">
                                            <div className="capitalize text-muted">
                                                {item.role}
                                            </div>
                                            {item.mustChangePassword ? (
                                                <span className="mt-1.5 inline-flex rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">
                                                    Password reset required
                                                </span>
                                            ) : null}
                                        </td>
                                        <td className="py-5">
                                            <span
                                                className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border ${
                                                    item.isActive
                                                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20'
                                                        : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20'
                                                }`}
                                            >
                                                {item.isActive ? 'Active' : 'Pending'}
                                            </span>
                                        </td>
                                        <td className="py-5 text-right pr-4">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setResetTarget(item)
                                                    }
                                                    disabled={item._id === user.id}
                                                    title={
                                                        item._id === user.id
                                                            ? 'Use your own Profile to change your password.'
                                                            : `Reset ${item.name}'s password`
                                                    }
                                                    className={`px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                                                        item._id === user.id
                                                            ? 'opacity-30 cursor-not-allowed bg-sunken text-subtle border border-line'
                                                            : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 border border-amber-500/10'
                                                    }`}
                                                >
                                                    Reset password
                                                </button>
                                                <button
                                                    onClick={() =>
                                                        requestStatusChange(item)
                                                    }
                                                    disabled={item._id === user.id}
                                                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                                                        item._id === user.id
                                                            ? 'opacity-30 cursor-not-allowed bg-sunken text-subtle border border-line'
                                                            : item.isActive
                                                              ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400 hover:bg-rose-500/20 border border-rose-500/10'
                                                              : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-500/20'
                                                    }`}
                                                >
                                                    {item._id === user.id
                                                        ? 'You'
                                                        : item.isActive
                                                          ? 'Mark Inactive'
                                                          : 'Approve Access'}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="md:hidden space-y-3">
                        {users.map((item) => (
                            <article
                                key={item._id}
                                className="rounded-2xl border border-line bg-surface-2 p-4"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-sunken flex items-center justify-center font-bold text-indigo-700 dark:text-indigo-400 border border-line shrink-0">
                                        {item.name[0]?.toUpperCase() || 'U'}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="text-sm font-semibold text-fg truncate">
                                            {item.name}
                                        </div>
                                        <div className="text-xs text-subtle truncate">
                                            {item.email}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
                                    <div className="flex flex-col gap-2">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs capitalize text-muted">
                                                {item.role}
                                            </span>
                                            <span
                                                className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border ${
                                                    item.isActive
                                                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20'
                                                        : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20'
                                                }`}
                                            >
                                                {item.isActive
                                                    ? 'Active'
                                                    : 'Pending'}
                                            </span>
                                        </div>
                                        {item.mustChangePassword ? (
                                            <span className="inline-flex w-fit rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">
                                                Password reset required
                                            </span>
                                        ) : null}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setResetTarget(item)}
                                            disabled={item._id === user.id}
                                            title={
                                                item._id === user.id
                                                    ? 'Use your own Profile to change your password.'
                                                    : `Reset ${item.name}'s password`
                                            }
                                            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                                                item._id === user.id
                                                    ? 'opacity-30 cursor-not-allowed bg-sunken text-subtle border border-line'
                                                    : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 border border-amber-500/10'
                                            }`}
                                        >
                                            Reset
                                        </button>
                                        <button
                                            onClick={() =>
                                                requestStatusChange(item)
                                            }
                                            disabled={item._id === user.id}
                                            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                                                item._id === user.id
                                                    ? 'opacity-30 cursor-not-allowed bg-sunken text-subtle border border-line'
                                                    : item.isActive
                                                      ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400 hover:bg-rose-500/20 border border-rose-500/10'
                                                      : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-500/20'
                                            }`}
                                        >
                                            {item._id === user.id
                                                ? 'You'
                                                : item.isActive
                                                  ? 'Mark Inactive'
                                                  : 'Approve'}
                                        </button>
                                    </div>
                                </div>
                            </article>
                        ))}
                    </div>
                    </>
                )}
            </section>
        </AppShell>
    );
}
