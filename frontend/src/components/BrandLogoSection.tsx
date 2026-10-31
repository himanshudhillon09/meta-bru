'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/Modal';
import { connectionsApi } from '@/lib/apiClient';
import { formatBytes, type BrandLogoDetails } from '@/lib/types';

interface BrandLogoSectionProps {
    /** The Page whose logo frames its post images. */
    connectionId: string;
    pageName: string;
    /** What the Page list already knows, shown while the details load. */
    hasLogo: boolean;
    logoThumb: string;
    onNotice: (message: string) => void;
    onError: (message: string) => void;
    /** Reports the new logo state so the Page card can update its avatar. */
    onLogoChange: (hasLogo: boolean, thumb: string) => void;
}

const EMPTY: BrandLogoDetails = { logo: null, previews: [] };

function LogoSwatch({ src, tone }: { src: string; tone: 'light' | 'dark' }) {
    return (
        <div
            className={`flex h-24 items-center justify-center rounded-xl border p-3 ${
                tone === 'light' ? 'border-line-strong bg-slate-100' : 'border-slate-700 bg-slate-900'
            }`}
        >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`Logo on a ${tone} background`} className="max-h-full max-w-full object-contain" />
        </div>
    );
}

function PreviewSkeleton({ aspect, label }: { aspect: string; label: string }) {
    return (
        <div
            className={`flex ${aspect} flex-col items-center justify-center gap-2 rounded-2xl border border-line bg-surface animate-pulse`}
        >
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500/20 border-t-indigo-500" />
            <span className="text-[11px] font-semibold text-subtle">{label}</span>
        </div>
    );
}

export function BrandLogoSection({
    connectionId,
    pageName,
    hasLogo,
    logoThumb,
    onNotice,
    onError,
    onLogoChange,
}: BrandLogoSectionProps) {
    const [details, setDetails] = useState<BrandLogoDetails>(EMPTY);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<'' | 'upload' | 'remove'>('');
    const [confirmRemove, setConfirmRemove] = useState(false);
    const [dragging, setDragging] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);

    useEffect(() => {
        let cancelled = false;
        connectionsApi
            .getBrandLogo(connectionId)
            .then((data) => {
                if (!cancelled && data.success) {
                    setDetails({ logo: data.logo, previews: data.previews });
                }
            })
            .catch((err: unknown) => {
                if (!cancelled) {
                    onError(typeof err === 'string' ? err : 'Could not load this Page logo');
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
        // Load once per Page; the callbacks only report into the banners.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connectionId]);

    const upload = async (file: File | undefined) => {
        if (!file) return;
        if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
            onError('Use a PNG, JPEG, or WebP image for the logo.');
            return;
        }
        setBusy('upload');
        onError('');
        onNotice('');
        try {
            const data = await connectionsApi.uploadBrandLogo(connectionId, file);
            if (data.success) {
                setDetails({ logo: data.logo, previews: data.previews });
                onLogoChange(true, data.thumb);
                onNotice(`Logo saved. New ${pageName} uploads and AI images will be framed with it.`);
            }
        } catch (err: unknown) {
            onError(typeof err === 'string' ? err : 'Could not save your logo');
        } finally {
            setBusy('');
            if (fileInput.current) fileInput.current.value = '';
        }
    };

    const remove = async () => {
        setConfirmRemove(false);
        setBusy('remove');
        onError('');
        onNotice('');
        try {
            const data = await connectionsApi.removeBrandLogo(connectionId);
            if (data.success) {
                setDetails(EMPTY);
                onLogoChange(false, '');
                onNotice(`Logo removed. New ${pageName} post images are only resized, without a frame.`);
            }
        } catch (err: unknown) {
            onError(typeof err === 'string' ? err : 'Could not remove your logo');
        } finally {
            setBusy('');
        }
    };

    const { logo, previews } = details;
    // Until the details arrive, trust what the Page list says.
    const showsLogo = loading ? hasLogo : Boolean(logo);
    const logoSrc = logo?.dataUrl || logoThumb;

    const dropProps = {
        onDragOver: (event: React.DragEvent) => {
            event.preventDefault();
            setDragging(true);
        },
        onDragLeave: () => setDragging(false),
        onDrop: (event: React.DragEvent) => {
            event.preventDefault();
            setDragging(false);
            void upload(event.dataTransfer.files?.[0]);
        },
    };

    return (
        <section className="rounded-2xl border border-line bg-surface-2 p-5" {...dropProps}>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h4 className="text-sm font-bold text-fg">Logo frame</h4>
                    <p className="mt-0.5 max-w-2xl text-xs text-muted">
                        {showsLogo
                            ? `New ${pageName} uploads and AI images get a branded frame with this logo in the bottom border.`
                            : `Add a logo and every new ${pageName} photo gets a branded frame. Without one, photos are only resized for the feed.`}
                    </p>
                </div>
                <span
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${
                        showsLogo
                            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'border-slate-500/20 bg-slate-500/10 text-fg-2'
                    }`}
                >
                    <span className={`h-1.5 w-1.5 rounded-full ${showsLogo ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                    {showsLogo ? 'Frame on' : 'No logo'}
                </span>
            </div>

            <div className="mt-4 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <div>
                    <div className="text-xs font-semibold text-fg-2">Your logo</div>
                    {showsLogo && logoSrc ? (
                        <>
                            <div className="mt-2 grid grid-cols-2 gap-3">
                                <LogoSwatch src={logoSrc} tone="light" />
                                <LogoSwatch src={logoSrc} tone="dark" />
                            </div>
                            <p className="mt-2 text-[11px] text-subtle">
                                {logo
                                    ? `${logo.width} × ${logo.height} · ${formatBytes(logo.bytes)} · transparent edges trimmed`
                                    : 'Loading details...'}
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => fileInput.current?.click()}
                                    disabled={Boolean(busy)}
                                    className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-indigo-500 disabled:opacity-60"
                                >
                                    {busy === 'upload' ? 'Uploading...' : 'Replace logo'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setConfirmRemove(true)}
                                    disabled={Boolean(busy) || loading}
                                    className="rounded-xl border border-line-strong bg-surface px-4 py-2 text-xs font-bold text-rose-700 transition-all hover:bg-rose-500/10 disabled:opacity-60 dark:text-rose-300"
                                >
                                    {busy === 'remove' ? 'Removing...' : 'Remove'}
                                </button>
                            </div>
                        </>
                    ) : (
                        <button
                            type="button"
                            onClick={() => fileInput.current?.click()}
                            disabled={Boolean(busy)}
                            className={`mt-2 flex h-36 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed text-center transition-all disabled:opacity-60 ${
                                dragging
                                    ? 'border-indigo-500 bg-indigo-500/10'
                                    : 'border-line-strong bg-surface hover:border-indigo-500/50 hover:bg-indigo-500/5'
                            }`}
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-indigo-600 dark:text-indigo-300" aria-hidden="true">
                                <path d="M12 16V4m0 0-4 4m4-4 4 4" />
                                <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                            </svg>
                            <span className="mt-2 text-sm font-bold text-fg">
                                {busy === 'upload' ? 'Uploading...' : dragging ? 'Drop to upload' : `Upload ${pageName}'s logo`}
                            </span>
                            <span className="mt-0.5 text-[11px] text-subtle">Click or drag a file here</span>
                        </button>
                    )}

                    <input
                        ref={fileInput}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(event) => upload(event.target.files?.[0])}
                    />
                    <p className="mt-3 text-[11px] text-subtle">
                        PNG with a transparent background looks best. JPEG, PNG, or WebP up to 10 MB, 400px or
                        wider. A logo without transparency is shown as a rounded badge.
                    </p>
                </div>

                <div>
                    <div className="text-xs font-semibold text-fg-2">
                        {showsLogo ? 'How your posts will look' : 'Without a logo'}
                    </div>
                    {showsLogo && (loading || busy === 'upload') ? (
                        <div className="mt-2 grid grid-cols-2 gap-4">
                            <PreviewSkeleton aspect="aspect-[4/5]" label="Rendering portrait preview..." />
                            <PreviewSkeleton aspect="aspect-square" label="Rendering square preview..." />
                        </div>
                    ) : showsLogo && previews.length > 0 ? (
                        <div className="mt-2 grid grid-cols-2 items-start gap-4">
                            {previews.map((preview) => (
                                <figure key={preview.label}>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={preview.dataUrl}
                                        alt={`${preview.label} in the branded frame`}
                                        className="h-auto w-full rounded-2xl border border-line-strong shadow-card"
                                    />
                                    <figcaption className="mt-1.5 text-[11px] text-subtle">
                                        <span className="font-bold text-fg-2">{preview.label}</span> · {preview.width} ×{' '}
                                        {preview.height}
                                    </figcaption>
                                </figure>
                            ))}
                        </div>
                    ) : (
                        <ul className="mt-2 space-y-2 rounded-2xl border border-line bg-surface p-4 text-xs leading-relaxed text-muted">
                            <li>• Photos are resized to 1080px wide to fit the feed.</li>
                            <li>• Anything from 4:5 portrait (1080 × 1350) to 1.91:1 landscape keeps its shape.</li>
                            <li>
                                • Taller or wider photos get a light crop when close, or sit whole over a soft
                                blurred fill, so nothing important is cut off.
                            </li>
                        </ul>
                    )}
                    {showsLogo ? (
                        <p className="mt-3 text-[11px] text-subtle">
                            The frame colour follows each photo and switches between light and dark to keep your
                            logo readable. Images you already uploaded are not changed.
                        </p>
                    ) : null}
                </div>
            </div>

            <Modal
                isOpen={confirmRemove}
                onClose={() => setConfirmRemove(false)}
                onConfirm={remove}
                title="Remove logo?"
                message={`New ${pageName} uploads and AI images will only be resized, without the branded frame. Images you already uploaded keep their frame.`}
                confirmText="Remove logo"
                type="danger"
            />
        </section>
    );
}
