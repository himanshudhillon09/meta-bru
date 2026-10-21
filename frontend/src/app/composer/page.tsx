'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { useAuth } from '@/context/AuthContext';
import { aiApi, connectionsApi, mediaApi, postsApi } from '@/lib/apiClient';
import type { MediaAsset, SocialConnection } from '@/lib/types';

export default function ComposerPage() {
    const router = useRouter();
    const { user } = useAuth();
    const [connections, setConnections] = useState<SocialConnection[]>([]);
    const [connectionId, setConnectionId] = useState('');
    const [caption, setCaption] = useState('');
    const [topic, setTopic] = useState('');
    const [imagePrompt, setImagePrompt] = useState('');
    const [media, setMedia] = useState<MediaAsset | null>(null);
    const [facebook, setFacebook] = useState(true);
    const [instagram, setInstagram] = useState(false);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [drafting, setDrafting] = useState(false);
    const [generatingImage, setGeneratingImage] = useState(false);
    const [submitting, setSubmitting] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const submitDisabled =
        Boolean(submitting) || uploading || generatingImage;

    useEffect(() => {
        const load = async () => {
            try {
                const data: any = await connectionsApi.list();
                const list: SocialConnection[] = data.connections || [];
                setConnections(list);
                const first = list.find(
                    (connection) =>
                        connection.isActive &&
                        connection.tokenStatus === 'active'
                );
                if (first) selectConnection(first);
            } catch (err: any) {
                setError(typeof err === 'string' ? err : 'Could not load connections');
            } finally {
                setLoading(false);
            }
        };
        void load();
    }, []);

    const selectedConnection = useMemo(
        () => connections.find((connection) => connection._id === connectionId),
        [connections, connectionId]
    );

    function selectConnection(connection: SocialConnection) {
        setConnectionId(connection._id);
        setFacebook(connection.publishToFacebook);
        setInstagram(connection.publishToInstagram && Boolean(connection.instagram));
    }

    const handleFile = async (file: File | undefined) => {
        if (!file) return;
        setUploading(true);
        setError('');
        try {
            const data: any = await mediaApi.upload(file);
            setMedia(data.media);
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Upload failed');
        } finally {
            setUploading(false);
        }
    };

    const draftCaption = async () => {
        setDrafting(true);
        setError('');
        try {
            const data: any = await aiApi.caption({
                ...(topic ? { topic } : {}),
                platform: facebook && instagram ? 'both' : instagram ? 'instagram' : 'facebook',
            });
            setCaption(data.caption || '');
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'AI caption failed');
        } finally {
            setDrafting(false);
        }
    };

    const generateImage = async () => {
        const prompt = imagePrompt || topic;
        if (!prompt) {
            setError('Describe the image you want, or enter a post topic first.');
            return;
        }
        setGeneratingImage(true);
        setError('');
        try {
            const data: any = await aiApi.image({ prompt });
            setMedia(data.media);
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'AI image failed');
        } finally {
            setGeneratingImage(false);
        }
    };

    const submit = async (action: 'draft' | 'queue' | 'now') => {
        setError('');
        setNotice('');

        if (!connectionId) {
            setError('Choose a connection first.');
            return;
        }
        if (selectedConnection?.tokenStatus === 'needs_reauth') {
            setError('Reconnect this Page before publishing.');
            return;
        }
        if (!facebook && !instagram) {
            setError('Select Facebook, Instagram, or both.');
            return;
        }
        if (!caption.trim()) {
            setError('Write a caption or generate one with AI.');
            return;
        }
        if (!media) {
            setError('Upload an image or generate one with AI.');
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
                mediaUrl: media.url,
                mediaJpegUrl: media.jpegUrl || '',
                mediaPublicId: media.publicId,
                platforms: { facebook, instagram },
                action,
            });

            if (action === 'now' && data.post?.status === 'failed') {
                setError(data.post.lastError || 'Publishing failed. Check Activity.');
                setSubmitting('');
                return;
            }

            const partiallyPublished =
                action === 'now' && data.post?.status === 'partial';
            setNotice(
                action === 'now'
                    ? partiallyPublished
                        ? 'Partially published. Opening the failed tab so you can retry the failed platform...'
                        : 'Post published. Opening activity...'
                    : action === 'queue'
                      ? 'Post added to the queue.'
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
            setError(typeof err === 'string' ? err : 'Could not create post');
            setSubmitting('');
        }
    };

    return (
        <AppShell
            title="Composer"
            subtitle="Build an image post, use AI if you want, then queue it for the daily slot."
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
                <div className="mb-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                    {notice}
                </div>
            ) : null}
            {error ? (
                <div className="mb-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                    {error}
                </div>
            ) : null}

            {loading ? (
                <div className="flex justify-center py-24">
                    <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-indigo-500" />
                </div>
            ) : connections.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-white/10 bg-slate-900/30 p-12 text-center">
                    <div className="text-xl font-bold text-white">
                        Connect a Page to start composing
                    </div>
                    <p className="text-sm text-slate-400 mt-2">
                        The composer needs at least one Facebook Page connection.
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
                    <div className="space-y-6">
                        <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-6 sm:p-8 shadow-xl">
                            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
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
                                className="mt-2 w-full bg-slate-950/80 border border-white/10 rounded-xl px-4 py-3.5 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                            >
                                <option value="">Select a Page</option>
                                {connections.map((connection) => (
                                    <option key={connection._id} value={connection._id}>
                                        {connection.pageName}
                                        {connection.instagram
                                            ? ` + @${connection.instagram.username || 'instagram'}`
                                            : ''}
                                    </option>
                                ))}
                            </select>

                            {selectedConnection?.tokenStatus === 'needs_reauth' ? (
                                <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                                    This Page needs to be reconnected before it
                                    can publish.
                                </div>
                            ) : null}
                            {selectedConnection && !selectedConnection.isActive ? (
                                <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                                    This Page is paused. Scheduled posts wait
                                    until you reactivate it under Connections.
                                </div>
                            ) : null}

                            <div className="flex gap-3 mt-4">
                                <button
                                    type="button"
                                    onClick={() => setFacebook((value) => !value)}
                                    className={`px-4 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                                        facebook
                                            ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                                            : 'bg-slate-950/50 text-slate-500 border-white/5'
                                    }`}
                                >
                                    Facebook
                                </button>
                                <button
                                    type="button"
                                    disabled={!selectedConnection?.instagram}
                                    onClick={() => setInstagram((value) => !value)}
                                    className={`px-4 py-2.5 rounded-xl text-xs font-bold border transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                                        instagram
                                            ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                                            : 'bg-slate-950/50 text-slate-500 border-white/5'
                                    }`}
                                >
                                    Instagram
                                </button>
                            </div>
                        </section>

                        <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-6 sm:p-8 shadow-xl">
                            <div className="flex items-center justify-between gap-3">
                                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                                    Caption
                                </label>
                                <span className="text-xs text-slate-500">
                                    {caption.length}/2200
                                </span>
                            </div>
                            <textarea
                                value={caption}
                                onChange={(event) => setCaption(event.target.value.slice(0, 2200))}
                                rows={8}
                                placeholder="Write your post..."
                                className="mt-2 w-full bg-slate-950/80 border border-white/10 rounded-2xl px-4 py-3.5 text-white leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-y"
                            />

                            <div className="mt-4 flex flex-col sm:flex-row gap-3">
                                <input
                                    value={topic}
                                    onChange={(event) => setTopic(event.target.value)}
                                    placeholder="Topic for AI (optional)"
                                    className="flex-1 bg-slate-950/80 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                />
                                <button
                                    onClick={draftCaption}
                                    disabled={drafting}
                                    className="bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-white px-5 py-3 rounded-xl text-xs font-bold transition-all"
                                >
                                    {drafting ? 'Drafting...' : 'AI draft caption'}
                                </button>
                            </div>
                            <p className="text-xs text-slate-500 mt-2">
                                AI uses the brand profile from{' '}
                                <Link href="/settings" className="text-indigo-400">
                                    Profile
                                </Link>
                                .
                            </p>
                        </section>

                        <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-6 sm:p-8 shadow-xl">
                            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                                Image
                            </label>

                            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <label className="cursor-pointer rounded-2xl border border-dashed border-white/10 bg-slate-950/40 px-4 py-6 text-center hover:border-indigo-500/40 transition-all">
                                    <input
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp"
                                        className="hidden"
                                        onChange={(event) =>
                                            handleFile(event.target.files?.[0])
                                        }
                                    />
                                    <div className="text-sm font-bold text-white">
                                        {uploading ? 'Uploading...' : 'Upload image'}
                                    </div>
                                    <div className="text-xs text-slate-500 mt-1">
                                        JPEG, PNG or WebP · max 10 MB
                                    </div>
                                </label>

                                <div className="rounded-2xl border border-white/5 bg-slate-950/40 px-4 py-4">
                                    <input
                                        value={imagePrompt}
                                        onChange={(event) => setImagePrompt(event.target.value)}
                                        placeholder="Describe an image..."
                                        className="w-full bg-transparent text-sm text-white placeholder:text-slate-600 focus:outline-none"
                                    />
                                    <button
                                        onClick={generateImage}
                                        disabled={generatingImage}
                                        className="mt-3 w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-white px-4 py-2.5 rounded-xl text-xs font-bold"
                                    >
                                        {generatingImage ? 'Generating...' : 'Generate with AI'}
                                    </button>
                                </div>
                            </div>

                            {media ? (
                                <div className="mt-4 flex items-center gap-4 rounded-2xl border border-white/5 bg-slate-950/40 p-3">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={media.url}
                                        alt="Post preview"
                                        className="w-20 h-20 rounded-xl object-cover border border-white/5"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs font-bold text-white truncate">
                                            {media.width} × {media.height} · {media.format.toUpperCase()}
                                        </div>
                                        <div className="text-[11px] text-slate-500 truncate">
                                            {media.publicId}
                                        </div>
                                        <div className="text-[11px] text-slate-500 mt-1">
                                            Instagram receives an automatic JPEG version.
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setMedia(null)}
                                        className="text-xs font-bold text-rose-400 px-3 py-2 rounded-lg hover:bg-rose-500/10"
                                    >
                                        Remove
                                    </button>
                                </div>
                            ) : null}
                        </section>

                        <div className="flex flex-col sm:flex-row gap-3">
                            <button
                                onClick={() => submit('draft')}
                                disabled={submitDisabled}
                                className="flex-1 bg-white/5 hover:bg-white/10 disabled:opacity-60 text-white border border-white/10 px-5 py-3.5 rounded-2xl text-sm font-bold transition-all"
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
                                {submitting === 'now' ? 'Publishing...' : 'Post now'}
                            </button>
                        </div>
                    </div>

                    <aside className="rounded-3xl border border-white/5 bg-slate-900/40 p-6 shadow-xl lg:sticky lg:top-8">
                        <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4">
                            Preview
                        </div>
                        <div className="rounded-2xl overflow-hidden border border-white/10 bg-slate-950">
                            <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
                                <div className="w-9 h-9 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-sm font-black text-indigo-300">
                                    {selectedConnection?.pageName[0]?.toUpperCase() || 'P'}
                                </div>
                                <div>
                                    <div className="text-sm font-bold text-white">
                                        {selectedConnection?.pageName || 'Your Page'}
                                    </div>
                                    <div className="text-[10px] uppercase tracking-widest text-slate-500">
                                        {facebook && instagram
                                            ? 'Facebook + Instagram'
                                            : instagram
                                              ? 'Instagram'
                                              : 'Facebook'}
                                    </div>
                                </div>
                            </div>
                            {media ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    src={media.url}
                                    alt=""
                                    className="w-full aspect-square object-cover"
                                />
                            ) : (
                                <div className="aspect-square flex items-center justify-center text-sm text-slate-600 bg-slate-900/40">
                                    Image preview
                                </div>
                            )}
                            <div className="px-4 py-4">
                                <div className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
                                    {caption || (
                                        <span className="text-slate-600">
                                            Your caption will appear here.
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                        {user?.brandProfile?.niche ? (
                            <div className="mt-4 text-[11px] text-slate-500">
                                Brand niche: {user.brandProfile.niche}
                            </div>
                        ) : null}
                    </aside>
                </div>
            )}
        </AppShell>
    );
}
