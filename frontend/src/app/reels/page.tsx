'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { ShareToStoryToggle } from '@/components/ShareToStoryToggle';
import { ToggleChip } from '@/components/ToggleChip';
import { useAuth } from '@/context/AuthContext';
import {
    aiApi,
    connectionsApi,
    mediaApi,
    postsApi,
    uploadVideoToCloudinary,
    type VideoUploadHandle,
} from '@/lib/apiClient';
import {
    REEL_ACCEPT,
    REEL_LIMITS,
    isNineBySixteen,
    readVideoFileInfo,
    reelFileProblem,
} from '@/lib/reels';
import {
    formatBytes,
    formatDuration,
    type SocialConnection,
    type VideoMedia,
} from '@/lib/types';

interface ReelDraft {
    connectionId: string;
    caption: string;
    topic: string;
    video: VideoMedia | null;
    facebook: boolean;
    instagram: boolean;
    shareToStory: boolean;
}

export default function ReelsPage() {
    const router = useRouter();
    const { user } = useAuth();
    const draftKey = user?.id ? `meta-bru:reel-draft:${user.id}` : null;
    const [connections, setConnections] = useState<SocialConnection[]>([]);
    const [connectionId, setConnectionId] = useState('');
    const [caption, setCaption] = useState('');
    const [topic, setTopic] = useState('');
    const [video, setVideo] = useState<VideoMedia | null>(null);
    const [facebook, setFacebook] = useState(true);
    const [instagram, setInstagram] = useState(false);
    const [shareToStory, setShareToStory] = useState(false);
    const [loading, setLoading] = useState(true);
    const [uploadProgress, setUploadProgress] = useState<number | null>(null);
    const [previewFailedFor, setPreviewFailedFor] = useState('');
    const [drafting, setDrafting] = useState(false);
    const [submitting, setSubmitting] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [hydratedDraftKey, setHydratedDraftKey] = useState<string | null>(null);
    const connectionIdRef = useRef('');
    const connectionsRef = useRef<SocialConnection[]>([]);
    const draftClearedRef = useRef(false);
    const uploadRef = useRef<VideoUploadHandle | null>(null);
    const uploading = uploadProgress !== null;
    const submitDisabled = Boolean(submitting) || uploading;
    // Facebook Reels stop at 90 seconds; Instagram takes up to 15 minutes.
    const facebookAllowed =
        !video || video.duration <= REEL_LIMITS.maxFacebookSeconds;
    const publishFacebook = facebook && facebookAllowed;

    useEffect(() => {
        if (!draftKey || hydratedDraftKey === draftKey) return;

        // If the signed-in user changed, clear the previous user's form first.
        if (hydratedDraftKey !== null && hydratedDraftKey !== draftKey) {
            setConnectionId('');
            connectionIdRef.current = '';
            setCaption('');
            setTopic('');
            setVideo(null);
            setFacebook(true);
            setInstagram(false);
            setShareToStory(false);
        }

        try {
            const raw = window.localStorage.getItem(draftKey);
            if (raw) {
                const draft = JSON.parse(raw) as Partial<ReelDraft>;

                if (typeof draft.connectionId === 'string') {
                    setConnectionId(draft.connectionId);
                    connectionIdRef.current = draft.connectionId;
                }
                if (typeof draft.caption === 'string') {
                    setCaption(draft.caption.slice(0, 2200));
                }
                if (typeof draft.topic === 'string') {
                    setTopic(draft.topic);
                }
                if (
                    draft.video &&
                    typeof draft.video.url === 'string' &&
                    typeof draft.video.publicId === 'string'
                ) {
                    setVideo(draft.video);
                }
                if (typeof draft.facebook === 'boolean') {
                    setFacebook(draft.facebook);
                }
                if (typeof draft.instagram === 'boolean') {
                    setInstagram(draft.instagram);
                }
                if (typeof draft.shareToStory === 'boolean') {
                    setShareToStory(draft.shareToStory);
                }
            }
        } catch {
            // Ignore malformed drafts and start with a clean form.
        }

        // Connections may already be loaded if the draft hydrated late. If the
        // saved Page is gone or disconnected, fall back to the first usable one.
        if (connectionsRef.current.length > 0) {
            const restored = connectionsRef.current.some(
                (connection) =>
                    connection._id === connectionIdRef.current &&
                    connection.tokenStatus === 'active'
            );
            if (!restored) {
                const first = connectionsRef.current.find(
                    (connection) =>
                        connection.isActive && connection.tokenStatus === 'active'
                );
                if (first) {
                    selectConnection(first);
                } else {
                    setConnectionId('');
                    connectionIdRef.current = '';
                }
            }
        }

        draftClearedRef.current = false;
        setHydratedDraftKey(draftKey);
    }, [draftKey, hydratedDraftKey]);

    useEffect(() => {
        const load = async () => {
            try {
                const data: any = await connectionsApi.list();
                const list: SocialConnection[] = data.connections || [];
                connectionsRef.current = list;
                setConnections(list);
                const restored = list.find(
                    (connection) =>
                        connection._id === connectionIdRef.current &&
                        connection.tokenStatus === 'active'
                );
                if (!restored) {
                    const first = list.find(
                        (connection) =>
                            connection.isActive && connection.tokenStatus === 'active'
                    );
                    if (first) selectConnection(first);
                }
            } catch (err: any) {
                setError(typeof err === 'string' ? err : 'Could not load connections');
            } finally {
                setLoading(false);
            }
        };
        void load();
    }, []);

    // Stop an in-flight upload when the user leaves the page.
    useEffect(() => () => uploadRef.current?.abort(), []);

    useEffect(() => {
        if (!draftKey || hydratedDraftKey !== draftKey || draftClearedRef.current) return;

        const draft: ReelDraft = {
            connectionId,
            caption,
            topic,
            video,
            facebook,
            instagram,
            shareToStory,
        };

        try {
            window.localStorage.setItem(draftKey, JSON.stringify(draft));
        } catch {
            // Ignore storage failures (private mode, quota, etc.).
        }
    }, [
        draftKey,
        hydratedDraftKey,
        connectionId,
        caption,
        topic,
        video,
        facebook,
        instagram,
        shareToStory,
    ]);

    const selectedConnection = useMemo(
        () => connections.find((connection) => connection._id === connectionId),
        [connections, connectionId]
    );

    const activeConnections = useMemo(
        () => connections.filter((connection) => connection.tokenStatus === 'active'),
        [connections]
    );

    function selectConnection(connection: SocialConnection) {
        setConnectionId(connection._id);
        connectionIdRef.current = connection._id;
        setFacebook(connection.publishToFacebook);
        setInstagram(connection.publishToInstagram && Boolean(connection.instagram));
    }

    const handleFile = async (file: File | undefined) => {
        if (!file) return;
        setError('');
        setNotice('');

        const problem = reelFileProblem(file, await readVideoFileInfo(file));
        if (problem) {
            setError(problem);
            return;
        }

        setUploadProgress(0);
        try {
            const { upload } = await mediaApi.videoSignature();
            const handle = uploadVideoToCloudinary(file, upload, setUploadProgress);
            uploadRef.current = handle;
            const { publicId } = await handle.promise;
            uploadRef.current = null;
            setUploadProgress(1);

            const data = await mediaApi.registerVideo(publicId);
            setVideo(data.media);
            setPreviewFailedFor('');
        } catch (err: any) {
            if (err === 'Upload cancelled.') {
                setNotice('Upload cancelled.');
            } else {
                setError(typeof err === 'string' ? err : 'Upload failed');
            }
        } finally {
            uploadRef.current = null;
            setUploadProgress(null);
        }
    };

    const draftCaption = async () => {
        setDrafting(true);
        setError('');
        try {
            const data: any = await aiApi.caption({
                ...(topic ? { topic } : {}),
                platform:
                    publishFacebook && instagram
                        ? 'both'
                        : instagram
                          ? 'instagram'
                          : 'facebook',
            });
            setCaption(data.caption || '');
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'AI caption failed');
        } finally {
            setDrafting(false);
        }
    };

    const submit = async (action: 'draft' | 'queue' | 'now') => {
        setError('');
        setNotice('');

        if (!connectionId) {
            setError('Choose a connection first.');
            return;
        }
        if (selectedConnection?.tokenStatus !== 'active') {
            setError(
                selectedConnection?.tokenStatus === 'disconnected'
                    ? 'This Page is disconnected. Reconnect it under Connections.'
                    : 'Reconnect this Page before publishing.'
            );
            return;
        }
        if (!publishFacebook && !instagram) {
            setError(
                facebookAllowed
                    ? 'Select Facebook, Instagram, or both.'
                    : 'This reel is over 90 seconds, so only Instagram can publish it. Turn on Instagram.'
            );
            return;
        }
        if (!caption.trim()) {
            setError('Write a caption or generate one with AI.');
            return;
        }
        if (!video) {
            setError('Upload a reel video first.');
            return;
        }
        if (instagram && !selectedConnection?.instagram) {
            setError('This Page has no linked Instagram Business account.');
            return;
        }

        setSubmitting(action);
        try {
            const data: any = await postsApi.create({
                connectionId,
                caption: caption.trim(),
                mediaType: 'reel',
                mediaPublicId: video.publicId,
                platforms: { facebook: publishFacebook, instagram },
                shareToStory,
                action,
            });

            if (action === 'now' && data.post?.status === 'failed') {
                setError(data.post.lastError || 'Publishing failed. Check Activity.');
                setSubmitting('');
                return;
            }

            draftClearedRef.current = true;
            if (draftKey) {
                window.localStorage.removeItem(draftKey);
            }

            const partiallyPublished = action === 'now' && data.post?.status === 'partial';
            setNotice(
                action === 'now'
                    ? partiallyPublished
                        ? 'Partially published. Opening the failed tab so you can retry the failed platform...'
                        : 'Reel published. Opening activity...'
                    : action === 'queue'
                      ? 'Reel added to the queue.'
                      : 'Draft saved.'
            );
            setTimeout(() => {
                router.push(
                    action === 'now'
                        ? partiallyPublished
                            ? '/queue?tab=failed'
                            : '/activity'
                        : action === 'draft'
                          ? '/queue?tab=draft'
                          : '/queue'
                );
            }, 900);
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not create reel');
            setSubmitting('');
        }
    };

    const previewSrc =
        video && previewFailedFor === video.publicId ? video.originalUrl : video?.url;

    return (
        <AppShell
            title="Reels"
            subtitle="Upload a vertical video, then queue it or post it now. Reels use each Page's daily posting times."
            actions={
                <button
                    onClick={() => submit('queue')}
                    disabled={submitDisabled}
                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
                >
                    {submitting === 'queue' ? 'Adding...' : 'Add to queue'}
                </button>
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

            {loading ? (
                <div className="flex justify-center py-24">
                    <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-indigo-500/20 border-t-indigo-500" />
                </div>
            ) : activeConnections.length === 0 ? (
                <div className="animate-fade-up rounded-2xl border border-dashed border-line-strong bg-surface p-12 text-center">
                    <div className="text-xl font-bold text-fg">No active Pages</div>
                    <p className="text-sm text-muted mt-2">
                        Reconnect a Page under Connections to create and publish a reel.
                    </p>
                    <Link
                        href="/connections"
                        className="inline-flex mt-6 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl text-sm font-bold"
                    >
                        Go to connections
                    </Link>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-6 items-start">
                    <div className="stagger space-y-6">
                        <section className="rounded-2xl border border-line bg-surface p-6 sm:p-8 shadow-card">
                            <label className="text-xs font-bold uppercase tracking-widest text-subtle">
                                Publishing as
                            </label>
                            <select
                                value={connectionId}
                                onChange={(event) => {
                                    const connection = connections.find(
                                        (item) => item._id === event.target.value
                                    );
                                    if (connection) selectConnection(connection);
                                }}
                                className="mt-2 w-full bg-surface-2 border border-line-strong rounded-xl px-4 py-3.5 text-fg focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                            >
                                <option value="">Select a Page</option>
                                {activeConnections.map((connection) => (
                                    <option key={connection._id} value={connection._id}>
                                        {connection.pageName}
                                        {connection.instagram
                                            ? ` + @${connection.instagram.username || 'instagram'}`
                                            : ''}
                                    </option>
                                ))}
                            </select>

                            {selectedConnection && !selectedConnection.isActive ? (
                                <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-200">
                                    This Page is paused. Scheduled reels wait until you
                                    reactivate it under Connections.
                                </div>
                            ) : null}

                            <div className="flex gap-3 mt-4">
                                <ToggleChip
                                    tone="facebook"
                                    checked={publishFacebook}
                                    disabled={!facebookAllowed}
                                    onToggle={() => setFacebook((value) => !value)}
                                    title={
                                        facebookAllowed
                                            ? undefined
                                            : 'Facebook Reels can be at most 90 seconds long.'
                                    }
                                >
                                    Facebook
                                </ToggleChip>
                                <ToggleChip
                                    tone="instagram"
                                    checked={instagram}
                                    disabled={!selectedConnection?.instagram}
                                    onToggle={() => setInstagram((value) => !value)}
                                >
                                    Instagram
                                </ToggleChip>
                            </div>

                            {!facebookAllowed ? (
                                <p className="mt-3 text-[11px] text-amber-700 dark:text-amber-300">
                                    This reel is over 90 seconds. Facebook Reels stop at
                                    90 seconds, so it can only go to Instagram.
                                </p>
                            ) : null}

                            <ShareToStoryToggle
                                checked={shareToStory}
                                onChange={setShareToStory}
                                detail={`Shares the first ${REEL_LIMITS.storySeconds} seconds as a 9:16 Story once the reel publishes.`}
                            />
                        </section>

                        <section className="rounded-2xl border border-line bg-surface p-6 sm:p-8 shadow-card">
                            <label className="text-xs font-bold uppercase tracking-widest text-subtle">
                                Video
                            </label>

                            {uploading ? (
                                <div className="mt-3 rounded-2xl border border-indigo-500/20 bg-indigo-500/5 px-4 py-5">
                                    <div className="flex items-center justify-between gap-3 text-xs font-bold text-fg">
                                        <span>
                                            {(uploadProgress ?? 0) < 1
                                                ? `Uploading to Cloudinary... ${Math.round(
                                                      (uploadProgress ?? 0) * 100
                                                  )}%`
                                                : 'Checking the video...'}
                                        </span>
                                        {(uploadProgress ?? 0) < 1 ? (
                                            <button
                                                type="button"
                                                onClick={() => uploadRef.current?.abort()}
                                                className="text-rose-700 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300"
                                            >
                                                Cancel
                                            </button>
                                        ) : null}
                                    </div>
                                    <div className="mt-3 h-2 rounded-full bg-canvas overflow-hidden border border-line">
                                        <div
                                            className="h-full rounded-full bg-indigo-500 transition-all"
                                            style={{
                                                width: `${Math.round((uploadProgress ?? 0) * 100)}%`,
                                            }}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <label className="mt-3 block cursor-pointer rounded-2xl border border-dashed border-line-strong bg-surface-2 px-4 py-6 text-center hover:border-indigo-500/40 transition-all">
                                    <input
                                        type="file"
                                        accept={REEL_ACCEPT}
                                        className="hidden"
                                        onChange={(event) => {
                                            const file = event.target.files?.[0];
                                            // Allow picking the same file again after an error.
                                            event.target.value = '';
                                            void handleFile(file);
                                        }}
                                    />
                                    <div className="text-sm font-bold text-fg">
                                        {video ? 'Replace video' : 'Upload video'}
                                    </div>
                                    <div className="text-xs text-subtle mt-1">
                                        MP4 or MOV · 3 seconds to 15 minutes · max 100 MB
                                    </div>
                                    <div className="text-[11px] text-subtle mt-2">
                                        Uploads straight to your Cloudinary account. Facebook
                                        takes reels up to 90 seconds.
                                    </div>
                                </label>
                            )}

                            {video ? (
                                <div className="mt-4 flex items-center gap-4 rounded-2xl border border-line bg-surface-2 p-3">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={video.coverUrl}
                                        alt="Reel cover"
                                        className="w-12 h-20 rounded-lg object-cover border border-line bg-sunken"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs font-bold text-fg truncate">
                                            {formatDuration(video.duration)} · {video.width} ×{' '}
                                            {video.height} · {video.format.toUpperCase()} ·{' '}
                                            {formatBytes(video.bytes)}
                                        </div>
                                        <div className="text-[11px] text-subtle truncate">
                                            {video.publicId}
                                        </div>
                                        <div className="text-[11px] text-subtle mt-1">
                                            {isNineBySixteen(video.width, video.height)
                                                ? 'Vertical 9:16, ready for Reels.'
                                                : 'Not 9:16, so it will be padded to 9:16 with a blurred background.'}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setVideo(null)}
                                        className="text-xs font-bold text-rose-700 dark:text-rose-400 px-3 py-2 rounded-lg hover:bg-rose-500/10"
                                    >
                                        Remove
                                    </button>
                                </div>
                            ) : null}
                        </section>

                        <section className="rounded-2xl border border-line bg-surface p-6 sm:p-8 shadow-card">
                            <div className="flex items-center justify-between gap-3">
                                <label className="text-xs font-bold uppercase tracking-widest text-subtle">
                                    Caption
                                </label>
                                <span className="text-xs text-subtle">
                                    {caption.length}/2200
                                </span>
                            </div>
                            <textarea
                                value={caption}
                                onChange={(event) => setCaption(event.target.value.slice(0, 2200))}
                                rows={6}
                                placeholder="Write your reel caption..."
                                className="mt-2 w-full bg-surface-2 border border-line-strong rounded-2xl px-4 py-3.5 text-fg leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-y"
                            />

                            <div className="mt-4 flex flex-col sm:flex-row gap-3">
                                <input
                                    value={topic}
                                    onChange={(event) => setTopic(event.target.value)}
                                    placeholder="What is the reel about? (for AI)"
                                    className="flex-1 bg-surface-2 border border-line-strong rounded-xl px-4 py-3 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                />
                                <button
                                    onClick={draftCaption}
                                    disabled={drafting}
                                    className="bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-white px-5 py-3 rounded-xl text-xs font-bold transition-all"
                                >
                                    {drafting ? 'Drafting...' : 'AI draft caption'}
                                </button>
                            </div>
                            <p className="text-xs text-subtle mt-2">
                                AI uses your topic and the brand profile from{' '}
                                <Link href="/settings" className="text-indigo-700 dark:text-indigo-400">
                                    Profile
                                </Link>
                                . It does not watch the video.
                            </p>
                        </section>

                        <div className="flex flex-col sm:flex-row gap-3">
                            <button
                                onClick={() => submit('draft')}
                                disabled={submitDisabled}
                                className="flex-1 bg-hover hover:bg-hover-strong disabled:opacity-60 text-fg border border-line-strong px-5 py-3.5 rounded-2xl text-sm font-bold transition-all"
                            >
                                {submitting === 'draft' ? 'Saving...' : 'Save draft'}
                            </button>
                            <button
                                onClick={() => submit('queue')}
                                disabled={submitDisabled}
                                className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white px-5 py-3.5 rounded-2xl text-sm font-bold transition-all"
                            >
                                {submitting === 'queue' ? 'Adding...' : 'Add to queue'}
                            </button>
                            <button
                                onClick={() => submit('now')}
                                disabled={submitDisabled}
                                className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white px-5 py-3.5 rounded-2xl text-sm font-bold transition-all"
                            >
                                {submitting === 'now'
                                    ? 'Publishing reel… this can take a few minutes'
                                    : 'Post now'}
                            </button>
                        </div>
                    </div>

                    <aside className="rounded-2xl border border-line bg-surface p-6 shadow-card lg:sticky lg:top-8">
                        <div className="text-xs font-bold uppercase tracking-widest text-subtle mb-4">
                            Preview
                        </div>
                        <div className="mx-auto max-w-[280px] rounded-3xl overflow-hidden border border-line-strong bg-canvas">
                            <div className="relative aspect-[9/16] bg-surface">
                                {video && previewSrc ? (
                                    <video
                                        key={previewSrc}
                                        src={previewSrc}
                                        poster={video.coverUrl}
                                        controls
                                        playsInline
                                        muted
                                        loop
                                        onError={() => setPreviewFailedFor(video.publicId)}
                                        className="w-full h-full object-contain bg-black"
                                    />
                                ) : (
                                    <div className="absolute inset-0 flex items-center justify-center text-sm text-faint">
                                        9:16 video preview
                                    </div>
                                )}
                            </div>
                            <div className="px-4 py-4">
                                <div className="text-sm font-bold text-fg">
                                    {selectedConnection?.pageName || 'Your Page'}
                                </div>
                                <div className="text-[10px] uppercase tracking-widest text-subtle">
                                    {publishFacebook && instagram
                                        ? 'Facebook + Instagram Reels'
                                        : instagram
                                          ? 'Instagram Reels'
                                          : 'Facebook Reels'}
                                </div>
                                <div className="mt-3 text-sm text-fg-2 whitespace-pre-wrap leading-relaxed line-clamp-6">
                                    {caption || (
                                        <span className="text-faint">
                                            Your caption will appear here.
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                        {video && previewFailedFor === video.publicId ? (
                            <p className="mt-3 text-[11px] text-subtle text-center">
                                Cloudinary is still preparing the 9:16 version. Showing
                                the original upload.
                            </p>
                        ) : null}
                    </aside>
                </div>
            )}
        </AppShell>
    );
}
