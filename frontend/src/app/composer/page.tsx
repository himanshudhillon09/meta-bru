'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import {
    ImageCropper,
    isUntouchedCrop,
    renderCropFromSource,
    UNTOUCHED_CROP,
    type CropResult,
    type CropState,
} from '@/components/ImageCropper';
import { AiLabelToggle, useAiLabelPreference } from '@/components/AiLabelToggle';
import { PageAvatar } from '@/components/PageBrandPanel';
import { ShareToStoryToggle } from '@/components/ShareToStoryToggle';
import { ToggleChip } from '@/components/ToggleChip';
import { useAuth } from '@/context/AuthContext';
import { aiApi, connectionsApi, mediaApi, postsApi } from '@/lib/apiClient';
import { useIdeaFromUrl } from '@/lib/useIdeaFromUrl';
import type { MediaAsset, SocialConnection } from '@/lib/types';

const KNOWN_ASPECTS: Array<[string, number]> = [
    ['4:5', 4 / 5],
    ['1:1', 1],
    ['4:3', 4 / 3],
    ['3:2', 3 / 2],
    ['16:9', 16 / 9],
    ['1.91:1', 1.91],
];

function aspectLabel(width: number, height: number): string {
    if (!width || !height) return '';
    const ratio = width / height;
    const known = KNOWN_ASPECTS.find(
        ([, value]) => Math.abs(ratio - value) / value < 0.01
    );
    return known ? known[0] : `${ratio.toFixed(2)}:1`;
}

interface ComposerDraft {
    connectionId: string;
    caption: string;
    topic: string;
    imagePrompt: string;
    media: MediaAsset | null;
    facebook: boolean;
    instagram: boolean;
    shareToStory: boolean;
    overlayEnabled: boolean;
    overlayText: string;
}

const OVERLAY_MAX_CHARS = 90;
const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** The original picture behind the current image, kept so it can be re-cropped. */
interface ImageSource {
    /** Object URL for an upload, data URL for an AI image. */
    url: string;
    file?: File;
    /** The crop that produced the current image. */
    crop: CropState;
}

function releaseSource(source: ImageSource | null) {
    if (source?.url.startsWith('blob:')) URL.revokeObjectURL(source.url);
}

function CropIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M6 2v14a2 2 0 0 0 2 2h14" />
            <path d="M18 22V8a2 2 0 0 0-2-2H2" />
        </svg>
    );
}

export default function ComposerPage() {
    const router = useRouter();
    const { user } = useAuth();
    const draftKey = user?.id ? `meta-bru:composer-draft:${user.id}` : null;
    const [connections, setConnections] = useState<SocialConnection[]>([]);
    const [connectionId, setConnectionId] = useState('');
    const [caption, setCaption] = useState('');
    const [topic, setTopic] = useState('');
    const [imagePrompt, setImagePrompt] = useState('');
    const [media, setMedia] = useState<MediaAsset | null>(null);
    const [imageSource, setImageSource] = useState<ImageSource | null>(null);
    const [cropping, setCropping] = useState<{ source: ImageSource; mode: 'new' | 'adjust' } | null>(null);
    const [cropError, setCropError] = useState('');
    const [facebook, setFacebook] = useState(true);
    const [instagram, setInstagram] = useState(false);
    const [shareToStory, setShareToStory] = useState(false);
    const [aiLabel, setAiLabel] = useAiLabelPreference();
    const [overlayEnabled, setOverlayEnabled] = useState(false);
    const [overlayText, setOverlayText] = useState('');
    const [overlayPreview, setOverlayPreview] = useState('');
    const [overlayError, setOverlayError] = useState('');
    const [previewingOverlay, setPreviewingOverlay] = useState(false);
    const [writingOverlay, setWritingOverlay] = useState(false);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [drafting, setDrafting] = useState(false);
    const [generatingImage, setGeneratingImage] = useState(false);
    const [submitting, setSubmitting] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [hydratedDraftKey, setHydratedDraftKey] = useState<string | null>(null);
    const sourceUrlRef = useRef('');
    const connectionIdRef = useRef('');
    const connectionsRef = useRef<SocialConnection[]>([]);
    const draftClearedRef = useRef(false);
    const submitDisabled =
        Boolean(submitting) || uploading || generatingImage;
    const overlayActive =
        overlayEnabled && Boolean(media) && overlayText.trim().length > 0;

    useEffect(() => {
        if (!draftKey || hydratedDraftKey === draftKey) return;

        // If the signed-in user changed, clear the previous user's form first.
        if (hydratedDraftKey !== null && hydratedDraftKey !== draftKey) {
            setConnectionId('');
            connectionIdRef.current = '';
            setCaption('');
            setTopic('');
            setImagePrompt('');
            setMedia(null);
            setFacebook(true);
            setInstagram(false);
            setShareToStory(false);
            setOverlayEnabled(false);
            setOverlayText('');
        }

        try {
            const raw = window.localStorage.getItem(draftKey);
            if (raw) {
                const draft = JSON.parse(raw) as Partial<ComposerDraft>;

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
                if (typeof draft.imagePrompt === 'string') {
                    setImagePrompt(draft.imagePrompt.slice(0, 1000));
                }
                if (
                    draft.media &&
                    typeof draft.media.url === 'string' &&
                    typeof draft.media.publicId === 'string'
                ) {
                    setMedia(draft.media);
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
                if (typeof draft.overlayEnabled === 'boolean') {
                    setOverlayEnabled(draft.overlayEnabled);
                }
                if (typeof draft.overlayText === 'string') {
                    setOverlayText(draft.overlayText.slice(0, OVERLAY_MAX_CHARS));
                }
            }
        } catch {
            // Ignore malformed drafts and start with a clean composer.
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
                        connection.isActive &&
                        connection.tokenStatus === 'active'
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
                            connection.isActive &&
                            connection.tokenStatus === 'active'
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

    useEffect(() => {
        if (!draftKey || hydratedDraftKey !== draftKey || draftClearedRef.current) return;

        const draft: ComposerDraft = {
            connectionId,
            caption,
            topic,
            imagePrompt,
            media,
            facebook,
            instagram,
            shareToStory,
            overlayEnabled,
            overlayText,
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
        imagePrompt,
        media,
        facebook,
        instagram,
        shareToStory,
        overlayEnabled,
        overlayText,
    ]);

    // Render the exact overlay on the server a moment after typing stops.
    useEffect(() => {
        if (!overlayActive || !media) {
            setOverlayPreview('');
            return;
        }

        let cancelled = false;
        const timer = setTimeout(async () => {
            setPreviewingOverlay(true);
            try {
                const data = await mediaApi.textPreview(
                    media.publicId,
                    overlayText,
                    media.textArea,
                    connectionId
                );
                if (!cancelled) {
                    setOverlayPreview(data.dataUrl);
                    setOverlayError('');
                }
            } catch (err: any) {
                if (!cancelled) {
                    setOverlayPreview('');
                    setOverlayError(
                        typeof err === 'string' ? err : 'Could not preview the image text'
                    );
                }
            } finally {
                if (!cancelled) setPreviewingOverlay(false);
            }
        }, 900);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [overlayActive, media, overlayText, connectionId]);

    // Free the last upload's object URL when leaving the Composer.
    useEffect(() => {
        sourceUrlRef.current = imageSource?.url ?? '';
    }, [imageSource]);
    useEffect(
        () => () => {
            if (sourceUrlRef.current.startsWith('blob:')) URL.revokeObjectURL(sourceUrlRef.current);
        },
        []
    );

    // "Create this post" on an Analytics tip opens the Composer with its idea.
    useIdeaFromUrl(hydratedDraftKey !== null, (idea) => {
        setTopic(idea);
        setNotice('Idea from Analytics added as the AI topic. Use AI draft caption to write the post.');
    });

    const selectedConnection = useMemo(
        () => connections.find((connection) => connection._id === connectionId),
        [connections, connectionId]
    );

    const activeConnections = useMemo(
        () =>
            connections.filter(
                (connection) => connection.tokenStatus === 'active'
            ),
        [connections]
    );

    function selectConnection(connection: SocialConnection) {
        setConnectionId(connection._id);
        connectionIdRef.current = connection._id;
        setFacebook(connection.publishToFacebook);
        setInstagram(connection.publishToInstagram && Boolean(connection.instagram));
    }

    // A picked file opens the crop editor first; nothing uploads until it is applied.
    const handleFile = (file: File | undefined) => {
        if (!file) return;
        if (!UPLOAD_TYPES.includes(file.type)) {
            setError('Upload a JPEG, PNG, or WebP image.');
            return;
        }
        if (file.size > MAX_UPLOAD_BYTES) {
            setError('Images can be at most 10 MB.');
            return;
        }
        setError('');
        setCropError('');
        setCropping({
            source: { url: URL.createObjectURL(file), file, crop: UNTOUCHED_CROP },
            mode: 'new',
        });
    };

    const closeCropper = () => {
        if (uploading) return;
        if (cropping?.mode === 'new') releaseSource(cropping.source);
        setCropping(null);
        setCropError('');
    };

    const applyCrop = async ({ blob, crop }: CropResult) => {
        if (!cropping) return;
        const { source, mode } = cropping;

        // Re-applying the whole, untouched picture changes nothing.
        if (mode === 'adjust' && isUntouchedCrop(crop) && isUntouchedCrop(source.crop)) {
            setCropping(null);
            return;
        }

        setUploading(true);
        setCropError('');
        try {
            const upload = blob ?? source.file ?? (await (await fetch(source.url)).blob());
            const data = await mediaApi.upload(upload, connectionId);
            const replaced = media;

            setMedia(data.media);
            if (imageSource && imageSource.url !== source.url) releaseSource(imageSource);
            setImageSource({ ...source, crop });
            setCropping(null);

            // The earlier crop of this same picture is no longer needed.
            if (mode === 'adjust' && replaced && replaced.publicId !== data.media.publicId) {
                void mediaApi.discard(replaced.publicId).catch(() => undefined);
            }
        } catch (err: any) {
            setCropError(typeof err === 'string' ? err : 'Upload failed');
        } finally {
            setUploading(false);
        }
    };

    const removeImage = () => {
        releaseSource(imageSource);
        setImageSource(null);
        setMedia(null);
    };

    // The Page whose logo should frame images; empty when it has none.
    const frameFor = (connection: SocialConnection | undefined) =>
        connection?.hasBrandLogo ? connection._id : '';

    // The image keeps the logo frame of the Page it was made for. Switching
    // to a Page with a different logo (or none) re-frames the original picture.
    const frameMismatch =
        Boolean(media) &&
        media?.brandConnectionId !== undefined &&
        media.brandConnectionId !== frameFor(selectedConnection);

    const reframeFor = async (target: SocialConnection) => {
        if (!imageSource || !media) return;
        setUploading(true);
        setError('');
        try {
            const blob = isUntouchedCrop(imageSource.crop)
                ? (imageSource.file ?? (await (await fetch(imageSource.url)).blob()))
                : await renderCropFromSource(imageSource.url, imageSource.crop, Boolean(target.hasBrandLogo));
            const data = await mediaApi.upload(blob, target._id);
            const replaced = media;
            setMedia(data.media);
            if (replaced.publicId !== data.media.publicId) {
                void mediaApi.discard(replaced.publicId).catch(() => undefined);
            }
            setNotice(
                target.hasBrandLogo
                    ? `Re-framed the image with ${target.pageName}'s logo.`
                    : `${target.pageName} has no logo, so the image is now unframed.`
            );
        } catch (err) {
            setError(typeof err === 'string' ? err : 'Could not re-frame the image for this Page');
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
                ...(media?.publicId ? { mediaPublicId: media.publicId } : {}),
                ...(connectionId ? { connectionId } : {}),
            });
            setCaption(data.caption || '');
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'AI caption failed');
        } finally {
            setDrafting(false);
        }
    };

    const writeOverlay = async (imageDescription = imagePrompt) => {
        const request = {
            ...(topic.trim() ? { topic: topic.trim().slice(0, 500) } : {}),
            ...(caption.trim() ? { caption: caption.trim().slice(0, 2200) } : {}),
            ...(imageDescription.trim()
                ? { prompt: imageDescription.trim().slice(0, 1000) }
                : {}),
        };
        if (Object.keys(request).length === 0) {
            setOverlayError('Write a topic or caption first, then let AI write the text.');
            return;
        }

        setWritingOverlay(true);
        setOverlayError('');
        try {
            const data = await aiApi.overlayText({
                ...request,
                ...(connectionId ? { connectionId } : {}),
            });
            setOverlayText(data.text.slice(0, OVERLAY_MAX_CHARS));
        } catch (err: any) {
            setOverlayError(typeof err === 'string' ? err : 'AI could not write the text');
        } finally {
            setWritingOverlay(false);
        }
    };

    const generateImage = async () => {
        const prompt = (imagePrompt || topic || caption).trim().slice(0, 1000);
        if (!prompt) {
            setError('Describe the image you want, or write a caption/topic first.');
            return;
        }
        setGeneratingImage(true);
        setError('');
        try {
            const data = await aiApi.image({ prompt, ...(connectionId ? { connectionId } : {}) });
            setMedia(data.media);
            releaseSource(imageSource);
            setImageSource(data.source ? { url: data.source, crop: UNTOUCHED_CROP } : null);
            // AI images get a bold text line by default.
            setOverlayEnabled(true);
            void writeOverlay(prompt);
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
        if (selectedConnection?.tokenStatus !== 'active') {
            setError(
                selectedConnection?.tokenStatus === 'disconnected'
                    ? 'This Page is disconnected. Reconnect it under Connections.'
                    : 'Reconnect this Page before publishing.'
            );
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
                ...(overlayActive
                    ? {
                          overlayText: overlayText.trim(),
                          ...(media.textArea ? { mediaTextArea: media.textArea } : {}),
                      }
                    : {}),
                platforms: { facebook, instagram },
                shareToStory,
                aiGenerated: aiLabel,
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
                    <div className="text-xl font-bold text-fg">
                        No active Pages
                    </div>
                    <p className="text-sm text-muted mt-2">
                        Reconnect a Page under Connections to create and publish
                        a new post.
                    </p>
                    <Link
                        href="/connections"
                        className="inline-flex mt-6 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl text-sm font-bold"
                    >
                        Go to connections
                    </Link>
                </div>
            ) : (
                <>
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
                                    if (!connection) return;
                                    selectConnection(connection);
                                    if (
                                        media &&
                                        imageSource &&
                                        media.brandConnectionId !== undefined &&
                                        media.brandConnectionId !== frameFor(connection)
                                    ) {
                                        void reframeFor(connection);
                                    }
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

                            {selectedConnection?.tokenStatus === 'needs_reauth' ? (
                                <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-200">
                                    This Page needs to be reconnected before it
                                    can publish.
                                </div>
                            ) : null}
                            {selectedConnection && !selectedConnection.isActive ? (
                                <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-200">
                                    This Page is paused. Scheduled posts wait
                                    until you reactivate it under Connections.
                                </div>
                            ) : null}

                            <div className="flex gap-3 mt-4">
                                <ToggleChip
                                    tone="facebook"
                                    checked={facebook}
                                    onToggle={() => setFacebook((value) => !value)}
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

                            <ShareToStoryToggle
                                checked={shareToStory}
                                onChange={setShareToStory}
                                detail="Shares the image as a 9:16 Story on each platform once the post publishes."
                            />
                            <AiLabelToggle checked={aiLabel} onChange={setAiLabel} />
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
                                rows={8}
                                placeholder="Write your post..."
                                className="mt-2 w-full bg-surface-2 border border-line-strong rounded-2xl px-4 py-3.5 text-fg leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-y"
                            />

                            <div className="mt-4 flex flex-col sm:flex-row gap-3">
                                <input
                                    value={topic}
                                    onChange={(event) => setTopic(event.target.value)}
                                    placeholder="Topic for AI (optional)"
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
                                AI uses the uploaded image when present, plus{' '}
                                {selectedConnection ? `${selectedConnection.pageName}'s` : 'the chosen Page’s'} brand
                                voice from{' '}
                                <Link href="/connections" className="text-indigo-700 dark:text-indigo-400">
                                    Connections
                                </Link>
                                .
                            </p>
                        </section>

                        <section className="rounded-2xl border border-line bg-surface p-6 sm:p-8 shadow-card">
                            <label className="text-xs font-bold uppercase tracking-widest text-subtle">
                                Image
                            </label>

                            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <label className="cursor-pointer rounded-2xl border border-dashed border-line-strong bg-surface-2 px-4 py-6 text-center hover:border-indigo-500/40 transition-all">
                                    <input
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp"
                                        className="hidden"
                                        onChange={(event) => {
                                            const file = event.target.files?.[0];
                                            event.target.value = '';
                                            handleFile(file);
                                        }}
                                    />
                                    <div className="text-sm font-bold text-fg">
                                        {uploading ? 'Uploading...' : 'Upload image'}
                                    </div>
                                    <div className="text-xs text-subtle mt-1">
                                        JPEG, PNG or WebP · max 10 MB
                                    </div>
                                    <div className="text-[11px] text-subtle mt-2">
                                        Crop, zoom, and position it before it uploads
                                        {selectedConnection?.hasBrandLogo
                                            ? `. Framed with ${selectedConnection.pageName}'s logo`
                                            : ''}
                                        .
                                    </div>
                                </label>

                                <div className="rounded-2xl border border-line bg-surface-2 px-4 py-4">
                                    <input
                                        value={imagePrompt}
                                        onChange={(event) => setImagePrompt(event.target.value)}
                                        maxLength={1000}
                                        placeholder="Describe an image..."
                                        className="w-full bg-transparent text-sm text-fg placeholder:text-faint focus:outline-none"
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
                                <div className="mt-4 flex items-center gap-4 rounded-2xl border border-line bg-surface-2 p-3">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={media.url}
                                        alt="Post preview"
                                        className="w-20 h-20 rounded-xl object-cover border border-line"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs font-bold text-fg truncate">
                                            {media.width} × {media.height}
                                            {aspectLabel(media.width, media.height)
                                                ? ` · ${aspectLabel(media.width, media.height)}`
                                                : ''}{' '}
                                            · {media.format.toUpperCase()}
                                        </div>
                                        <div className="text-[11px] text-subtle truncate">
                                            {media.publicId}
                                        </div>
                                        <div className="text-[11px] text-subtle mt-1">
                                            {frameMismatch ? (
                                                <span className="text-amber-700 dark:text-amber-300">
                                                    {media.brandConnectionId
                                                        ? 'Framed with another Page’s logo.'
                                                        : 'Not framed with this Page’s logo yet.'}{' '}
                                                    {imageSource ? (
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                selectedConnection && void reframeFor(selectedConnection)
                                                            }
                                                            disabled={uploading || !selectedConnection}
                                                            className="font-bold underline"
                                                        >
                                                            Re-frame for {selectedConnection?.pageName}
                                                        </button>
                                                    ) : (
                                                        'Upload it again to use this Page\'s logo.'
                                                    )}
                                                </span>
                                            ) : selectedConnection?.hasBrandLogo ? (
                                                <span className="inline-flex items-center gap-1.5">
                                                    <PageAvatar connection={selectedConnection} size="sm" />
                                                    Framed with {selectedConnection.pageName}&apos;s logo.
                                                </span>
                                            ) : (
                                                <>
                                                    Feed-sized for Instagram and Facebook.{' '}
                                                    <Link href="/connections" className="text-indigo-700 dark:text-indigo-400">
                                                        Add a logo to {selectedConnection?.pageName || 'this Page'}
                                                    </Link>{' '}
                                                    to frame new posts.
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row sm:items-center">
                                        {imageSource ? (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setCropError('');
                                                    setCropping({ source: imageSource, mode: 'adjust' });
                                                }}
                                                disabled={uploading}
                                                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-500/15 disabled:opacity-50 dark:text-indigo-300"
                                            >
                                                <CropIcon />
                                                Adjust
                                            </button>
                                        ) : null}
                                        <button
                                            onClick={removeImage}
                                            className="text-xs font-bold text-rose-700 dark:text-rose-400 px-3 py-2 rounded-lg hover:bg-rose-500/10"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </div>
                            ) : null}

                            {media ? (
                                <div className="mt-4 rounded-2xl border border-line bg-surface-2 p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <div className="text-xs font-bold text-fg">
                                                Text on image
                                            </div>
                                            <div className="text-[11px] text-subtle mt-0.5">
                                                {media.brandConnectionId && selectedConnection?.hasBrandLogo
                                                    ? `A bold caption in the frame, between the photo and ${selectedConnection.pageName}'s logo. The photo stays clear.`
                                                    : 'A bold line across the bottom of the photo, like a reel caption.'}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            role="switch"
                                            aria-checked={overlayEnabled}
                                            aria-label="Text on image"
                                            onClick={() => setOverlayEnabled((value) => !value)}
                                            className={`mt-0.5 relative inline-flex h-5 w-9 shrink-0 rounded-full transition-all ${
                                                overlayEnabled ? 'bg-amber-500' : 'bg-line-strong'
                                            }`}
                                        >
                                            <span
                                                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                                                    overlayEnabled ? 'left-[18px]' : 'left-0.5'
                                                }`}
                                            />
                                        </button>
                                    </div>

                                    {overlayEnabled ? (
                                        <>
                                            <div className="mt-3 flex flex-col sm:flex-row gap-2">
                                                <input
                                                    value={overlayText}
                                                    onChange={(event) =>
                                                        setOverlayText(
                                                            event.target.value.slice(0, OVERLAY_MAX_CHARS)
                                                        )
                                                    }
                                                    placeholder="Real life wali bandi *ko* pata chal gaya"
                                                    className="flex-1 bg-surface-2 border border-line-strong rounded-xl px-4 py-3 text-sm text-fg placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => void writeOverlay()}
                                                    disabled={writingOverlay}
                                                    className="bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-white px-4 py-3 rounded-xl text-xs font-bold transition-all"
                                                >
                                                    {writingOverlay ? 'Writing...' : 'AI write'}
                                                </button>
                                            </div>
                                            <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-subtle">
                                                <span>
                                                    Wrap words in *stars* to make them yellow. English letters only; write Hindi as Hinglish.
                                                </span>
                                                <span className="shrink-0">
                                                    {overlayText.length}/{OVERLAY_MAX_CHARS}
                                                </span>
                                            </div>
                                            {overlayError ? (
                                                <p className="mt-2 text-[11px] text-rose-700 dark:text-rose-300">
                                                    {overlayError}
                                                </p>
                                            ) : null}
                                        </>
                                    ) : null}
                                </div>
                            ) : null}
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
                                {submitting === 'now' ? 'Publishing...' : 'Post now'}
                            </button>
                        </div>
                    </div>

                    <aside className="rounded-2xl border border-line bg-surface p-6 shadow-card lg:sticky lg:top-8">
                        <div className="text-xs font-bold uppercase tracking-widest text-subtle mb-4">
                            Preview
                        </div>
                        <div className="rounded-2xl overflow-hidden border border-line-strong bg-canvas">
                            <div className="flex items-center gap-3 px-4 py-3 border-b border-line">
                                {selectedConnection?.logoThumb ? (
                                    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-white">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={selectedConnection.logoThumb} alt="" className="h-full w-full object-contain p-0.5" />
                                    </span>
                                ) : (
                                    <div className="w-9 h-9 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-sm font-bold text-indigo-700 dark:text-indigo-300">
                                        {selectedConnection?.pageName[0]?.toUpperCase() || 'P'}
                                    </div>
                                )}
                                <div>
                                    <div className="text-sm font-bold text-fg">
                                        {selectedConnection?.pageName || 'Your Page'}
                                    </div>
                                    <div className="text-[10px] uppercase tracking-widest text-subtle">
                                        {facebook && instagram
                                            ? 'Facebook + Instagram'
                                            : instagram
                                              ? 'Instagram'
                                              : 'Facebook'}
                                    </div>
                                </div>
                            </div>
                            {media ? (
                                <div className="group relative">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={overlayActive && overlayPreview ? overlayPreview : media.url}
                                        alt=""
                                        className="w-full h-auto"
                                    />
                                    {overlayActive && previewingOverlay ? (
                                        <span className="absolute top-2 right-2 rounded-full bg-surface-2 px-2.5 py-1 text-[10px] font-bold text-fg-2 backdrop-blur">
                                            Updating text...
                                        </span>
                                    ) : null}
                                    {imageSource ? (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setCropError('');
                                                setCropping({ source: imageSource, mode: 'adjust' });
                                            }}
                                            disabled={uploading}
                                            className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-slate-950/70 px-3.5 py-2 text-xs font-bold text-white opacity-0 shadow-lg backdrop-blur transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                                        >
                                            <CropIcon />
                                            Adjust crop
                                        </button>
                                    ) : null}
                                </div>
                            ) : (
                                <div className="aspect-square flex items-center justify-center text-sm text-faint bg-surface">
                                    Image preview
                                </div>
                            )}
                            <div className="px-4 py-4">
                                <div className="text-sm text-fg-2 whitespace-pre-wrap leading-relaxed">
                                    {caption || (
                                        <span className="text-faint">
                                            Your caption will appear here.
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                        {selectedConnection ? (
                            <div className="mt-4 text-[11px] text-subtle">
                                {selectedConnection.brandProfile?.niche ? (
                                    <>
                                        Brand voice: {selectedConnection.brandProfile.niche}
                                        {selectedConnection.brandProfile.tone
                                            ? ` · ${selectedConnection.brandProfile.tone}`
                                            : ''}
                                    </>
                                ) : (
                                    <>
                                        {selectedConnection.pageName} has no brand voice yet.{' '}
                                        <Link href="/connections" className="text-indigo-700 dark:text-indigo-400">
                                            Add one
                                        </Link>{' '}
                                        so AI captions sound like this Page.
                                    </>
                                )}
                            </div>
                        ) : null}
                    </aside>
                </div>

                <ImageCropper
                    src={cropping?.source.url ?? null}
                    framed={Boolean(selectedConnection?.hasBrandLogo)}
                    initial={cropping?.mode === 'adjust' ? cropping.source.crop : null}
                    busy={uploading}
                    error={cropError}
                    onCancel={closeCropper}
                    onApply={(result) => void applyCrop(result)}
                />
                </>
            )}
        </AppShell>
    );
}
