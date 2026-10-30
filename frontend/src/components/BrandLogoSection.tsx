'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/Modal';
import { connectionsApi } from '@/lib/apiClient';
import { formatBytes, type BrandLogoDetails } from '@/lib/types';

interface BrandLogoSectionProps {
    /** The Page whose logo frames its post images. */
    connectionId: string;
    pageName: string;
    onNotice: (message: string) => void;
    onError: (message: string) => void;
    /** Reports the new logo state so the Page card can update its avatar. */
    onLogoChange: (hasLogo: boolean, thumb: string) => void;
}

const EMPTY: BrandLogoDetails = { logo: null, previews: [] };

const removeButtonClass =
    'bg-hover hover:bg-rose-500/10 disabled:opacity-60 text-rose-700 dark:text-rose-300 border border-line-strong px-4 py-2.5 rounded-xl text-xs font-bold transition-all';

function LogoSwatch({
    src,
    tone,
}: {
    src: string;
    tone: 'light' | 'dark';
}) {
    return (
        <div
            className={`flex h-28 items-center justify-center rounded-2xl border p-4 ${
                tone === 'light'
                    ? 'border-line-strong bg-slate-100'
                    : 'border-line bg-canvas'
            }`}
        >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={src}
                alt={`Brand logo on ${tone} background`}
                className="max-h-full max-w-full object-contain"
            />
        </div>
    );
}

export function BrandLogoSection({
    connectionId,
    pageName,
    onNotice,
    onError,
    onLogoChange,
}: BrandLogoSectionProps) {
    const [details, setDetails] = useState<BrandLogoDetails>(EMPTY);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<'' | 'upload' | 'remove'>('');
    const [confirmRemove, setConfirmRemove] = useState(false);
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
                    onError(
                        typeof err === 'string'
                            ? err
                            : 'Could not load this Page logo'
                    );
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
        setBusy('upload');
        onError('');
        onNotice('');
        try {
            const data = await connectionsApi.uploadBrandLogo(connectionId, file);
            if (data.success) {
                setDetails({ logo: data.logo, previews: data.previews });
                onLogoChange(true, data.thumb);
                onNotice(
                    `Logo saved. New ${pageName} uploads and AI images will be framed with it.`
                );
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
                onNotice(
                    `Logo removed. New ${pageName} post images are only resized, without a frame.`
                );
            }
        } catch (err: unknown) {
            onError(typeof err === 'string' ? err : 'Could not remove your logo');
        } finally {
            setBusy('');
        }
    };

    const { logo, previews } = details;

    return (
        <div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h4 className="text-sm font-bold text-fg">Logo frame</h4>
                    <p className="mt-1 max-w-2xl text-xs text-muted">
                        New uploads and AI images for {pageName} are resized for the feed. With a
                        logo, each photo also gets a branded frame with this logo in the bottom
                        border.
                    </p>
                </div>
                {loading ? null : (
                    <span
                        className={`inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${
                            logo
                                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                : 'border-slate-500/20 bg-slate-500/10 text-fg-2'
                        }`}
                    >
                        <span
                            className={`h-1.5 w-1.5 rounded-full ${
                                logo ? 'bg-emerald-400' : 'bg-slate-400'
                            }`}
                        />
                        {logo ? 'Frame on' : 'No logo'}
                    </span>
                )}
            </div>

            <div className="mt-4 grid grid-cols-1 items-start gap-6 lg:grid-cols-[0.8fr_1.2fr]">
                <div>
                    <div className="text-xs font-bold uppercase tracking-widest text-subtle">
                        Logo
                    </div>

                    {loading ? (
                        <div className="mt-3 h-28 animate-pulse rounded-2xl border border-line bg-surface-2" />
                    ) : logo ? (
                        <>
                            <div className="mt-3 grid grid-cols-2 gap-3">
                                <LogoSwatch src={logo.dataUrl} tone="light" />
                                <LogoSwatch src={logo.dataUrl} tone="dark" />
                            </div>
                            <p className="mt-2 text-[11px] text-subtle">
                                {logo.width} × {logo.height} · {formatBytes(logo.bytes)} ·
                                transparent edges trimmed automatically
                            </p>
                        </>
                    ) : (
                        <button
                            type="button"
                            onClick={() => fileInput.current?.click()}
                            disabled={Boolean(busy)}
                            className="mt-3 flex h-28 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface-2 text-center transition-all hover:border-indigo-500/40 disabled:opacity-60"
                        >
                            <span className="text-sm font-bold text-fg">
                                {busy === 'upload' ? 'Uploading...' : `Upload ${pageName}'s logo`}
                            </span>
                            <span className="mt-1 text-xs text-subtle">
                                PNG with a transparent background works best
                            </span>
                        </button>
                    )}

                    <input
                        ref={fileInput}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(event) => upload(event.target.files?.[0])}
                    />

                    <div className="mt-4 flex flex-wrap gap-2">
                        {logo ? (
                            <>
                                <button
                                    type="button"
                                    onClick={() => fileInput.current?.click()}
                                    disabled={Boolean(busy)}
                                    className="rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white transition-all hover:bg-indigo-500 disabled:opacity-60"
                                >
                                    {busy === 'upload' ? 'Uploading...' : 'Replace logo'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setConfirmRemove(true)}
                                    disabled={Boolean(busy)}
                                    className={removeButtonClass}
                                >
                                    {busy === 'remove' ? 'Removing...' : 'Remove logo'}
                                </button>
                            </>
                        ) : null}
                    </div>
                    <p className="mt-3 text-xs text-subtle">
                        JPEG, PNG or WebP · max 10 MB · 400px or wider looks
                        sharpest. A logo without transparency is shown as a
                        rounded badge.
                    </p>
                </div>

                <div>
                    <div className="text-xs font-bold uppercase tracking-widest text-subtle">
                        {logo ? 'How your posts will look' : 'Without a logo'}
                    </div>

                    {loading || (busy === 'upload' && !logo) ? (
                        <div className="mt-3 grid grid-cols-2 gap-4">
                            <div className="aspect-[4/5] animate-pulse rounded-2xl bg-surface-2" />
                            <div className="aspect-square animate-pulse rounded-2xl bg-surface-2" />
                        </div>
                    ) : logo && previews.length > 0 ? (
                        <div className="mt-3 grid grid-cols-2 items-start gap-4">
                            {previews.map((preview) => (
                                <figure key={preview.label}>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={preview.dataUrl}
                                        alt={`${preview.label} in the branded frame`}
                                        className="h-auto w-full rounded-2xl border border-line-strong shadow-lg"
                                    />
                                    <figcaption className="mt-2 text-[11px] text-subtle">
                                        <span className="font-bold text-fg-2">
                                            {preview.label}
                                        </span>{' '}
                                        · {preview.width} × {preview.height}
                                    </figcaption>
                                </figure>
                            ))}
                        </div>
                    ) : (
                        <div className="mt-3 rounded-2xl border border-line bg-surface-2 p-5 text-sm leading-relaxed text-muted">
                            Photos are only resized, 1080px wide, to fit the
                            feed: from 4:5 portrait (1080 × 1350) to 1.91:1
                            landscape (1080 × 566). A photo already in that range
                            keeps its exact shape. A taller or wider one gets a
                            light crop if it is close, or is shown whole over a
                            soft blurred fill, so nothing important is cut off.
                        </div>
                    )}

                    {logo ? (
                        <p className="mt-3 text-xs text-subtle">
                            The frame colour follows each photo and switches
                            between light and dark to keep your logo readable.
                            Already uploaded images are not changed.
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
        </div>
    );
}
