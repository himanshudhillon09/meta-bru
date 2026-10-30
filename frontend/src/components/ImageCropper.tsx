'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Tabs } from '@/components/Tabs';

export type CropAspect = 'original' | 'tall' | 'square' | 'wide';

export interface CropState {
    aspect: CropAspect;
    /** 1 shows the largest crop of this shape; higher values zoom in. */
    zoom: number;
    /** Crop centre as a fraction of the image width and height. */
    x: number;
    y: number;
}

export const UNTOUCHED_CROP: CropState = { aspect: 'original', zoom: 1, x: 0.5, y: 0.5 };

/** The whole image, exactly as it was picked. */
export function isUntouchedCrop(crop: CropState): boolean {
    return crop.aspect === 'original' && crop.zoom <= 1.001;
}

// Mirrors frameLayout in the backend: with a logo, the photo sits 982px wide in
// a frame at most 1350px tall, which leaves at most 1150px for the photo.
const FRAME_MARGIN = Math.round(1080 * 0.045);
const FRAME_BAND = Math.round(1080 * 0.14);
const FRAMED_TALL_RATIO = (1080 - FRAME_MARGIN * 2) / (1350 - FRAME_MARGIN - FRAME_BAND);

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const MAX_OUTPUT_EDGE = 2160;
/** Posts are about 1000px wide, so a much narrower crop is visibly upscaled. */
const SOFT_BELOW_WIDTH = 720;
const STAGE_PADDING = 24;

const ASPECTS: Array<{ key: CropAspect; label: string }> = [
    { key: 'original', label: 'Original' },
    { key: 'tall', label: 'Tall 4:5' },
    { key: 'square', label: 'Square' },
    { key: 'wide', label: 'Wide' },
];

interface Size {
    width: number;
    height: number;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function aspectRatio(aspect: CropAspect, image: Size, framed: boolean): number {
    if (aspect === 'tall') return framed ? FRAMED_TALL_RATIO : 4 / 5;
    if (aspect === 'square') return 1;
    if (aspect === 'wide') return 1.91;
    return image.width / image.height;
}

/** Crop size in image pixels. */
function cropSize(crop: CropState, image: Size, framed: boolean): Size {
    const ratio = aspectRatio(crop.aspect, image, framed);
    const base =
        image.width / image.height > ratio
            ? { width: image.height * ratio, height: image.height }
            : { width: image.width, height: image.width / ratio };
    return { width: base.width / crop.zoom, height: base.height / crop.zoom };
}

/** Keeps the zoom in range and the crop inside the image. */
function clampCrop(crop: CropState, image: Size, framed: boolean): CropState {
    const zoom = clamp(crop.zoom, MIN_ZOOM, MAX_ZOOM);
    const size = cropSize({ ...crop, zoom }, image, framed);
    const halfX = size.width / 2 / image.width;
    const halfY = size.height / 2 / image.height;
    return {
        aspect: crop.aspect,
        zoom,
        x: clamp(crop.x, halfX, 1 - halfX),
        y: clamp(crop.y, halfY, 1 - halfY),
    };
}

interface Geometry {
    frame: Size;
    /** Screen pixels per image pixel. */
    scale: number;
}

function geometry(crop: CropState, image: Size, stage: Size, framed: boolean): Geometry {
    const ratio = aspectRatio(crop.aspect, image, framed);
    const frameWidth = Math.max(
        1,
        Math.min(stage.width - STAGE_PADDING * 2, (stage.height - STAGE_PADDING * 2) * ratio)
    );
    const frame = { width: frameWidth, height: frameWidth / ratio };
    return { frame, scale: frame.width / cropSize(crop, image, framed).width };
}

function renderCrop(image: HTMLImageElement, crop: CropState, framed: boolean): Promise<Blob> {
    const natural = { width: image.naturalWidth, height: image.naturalHeight };
    const size = cropSize(crop, natural, framed);
    const left = crop.x * natural.width - size.width / 2;
    const top = crop.y * natural.height - size.height / 2;
    const outputScale = Math.min(1, MAX_OUTPUT_EDGE / Math.max(size.width, size.height));

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(size.width * outputScale));
    canvas.height = Math.max(1, Math.round(size.height * outputScale));
    const context = canvas.getContext('2d');
    if (!context) return Promise.reject('Your browser could not crop this image.');

    // Transparent PNGs get the same white background the server would add.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, left, top, size.width, size.height, 0, 0, canvas.width, canvas.height);

    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject('Your browser could not crop this image.')),
            'image/jpeg',
            0.92
        );
    });
}

/**
 * Renders a saved crop of a picture without opening the editor, for example
 * to re-frame it for a Page whose logo frame has a different shape.
 */
export function renderCropFromSource(src: string, crop: CropState, framed: boolean): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            const natural = { width: image.naturalWidth, height: image.naturalHeight };
            renderCrop(image, clampCrop(crop, natural, framed), framed).then(resolve, reject);
        };
        image.onerror = () => reject('This image could not be opened.');
        image.src = src;
    });
}

export interface CropResult {
    /** The cropped JPEG, or null when the whole image is kept unchanged. */
    blob: Blob | null;
    crop: CropState;
}

interface ImageCropperProps {
    /** Image to adjust; null keeps the editor closed. */
    src: string | null;
    /** The user's logo frame changes the shape of a tall photo. */
    framed: boolean;
    initial?: CropState | null;
    busy?: boolean;
    error?: string;
    onCancel: () => void;
    onApply: (result: CropResult) => void;
}

/** Crop, zoom, and drag an image into the shape it will be posted in. */
export function ImageCropper(props: ImageCropperProps) {
    if (!props.src) return null;
    return <CropperDialog key={props.src} {...props} src={props.src} />;
}

function CropperDialog({
    src,
    framed,
    initial,
    busy = false,
    error,
    onCancel,
    onApply,
}: ImageCropperProps & { src: string }) {
    const stageRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLImageElement | null>(null);
    const pointers = useRef(new Map<number, { x: number; y: number }>());
    const [natural, setNatural] = useState<Size | null>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    const [stage, setStage] = useState<Size>({ width: 0, height: 0 });
    const [crop, setCrop] = useState<CropState>(initial ?? UNTOUCHED_CROP);
    const [dragging, setDragging] = useState(false);
    const [smooth, setSmooth] = useState(false);
    const [rendering, setRendering] = useState(false);
    const [renderError, setRenderError] = useState('');

    useEffect(() => {
        const image = new Image();
        image.onload = () => {
            imageRef.current = image;
            setNatural({ width: image.naturalWidth, height: image.naturalHeight });
        };
        image.onerror = () => setLoadFailed(true);
        image.src = src;
    }, [src]);

    useEffect(() => {
        const element = stageRef.current;
        if (!element) return;
        const observer = new ResizeObserver(([entry]) =>
            setStage({ width: entry.contentRect.width, height: entry.contentRect.height })
        );
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const working = busy || rendering;

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !working) onCancel();
        };
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', onKey);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', onKey);
        };
    }, [working, onCancel]);

    const ready = natural !== null && stage.width > 0 && stage.height > 0;

    /** Moves the image by a distance in screen pixels. */
    const pan = useCallback(
        (dx: number, dy: number) => {
            if (!natural) return;
            setCrop((current) => {
                const { scale } = geometry(current, natural, stage, framed);
                return clampCrop(
                    {
                        ...current,
                        x: current.x - dx / scale / natural.width,
                        y: current.y - dy / scale / natural.height,
                    },
                    natural,
                    framed
                );
            });
        },
        [natural, stage, framed]
    );

    /** Zooms while keeping the image point under (px, py) in place. */
    const zoomAt = useCallback(
        (nextZoom: (zoom: number) => number, px = 0, py = 0) => {
            if (!natural) return;
            setCrop((current) => {
                const before = geometry(current, natural, stage, framed).scale;
                const pointX = current.x * natural.width + px / before;
                const pointY = current.y * natural.height + py / before;
                const next = { ...current, zoom: clamp(nextZoom(current.zoom), MIN_ZOOM, MAX_ZOOM) };
                const after = geometry(next, natural, stage, framed).scale;
                return clampCrop(
                    {
                        ...next,
                        x: (pointX - px / after) / natural.width,
                        y: (pointY - py / after) / natural.height,
                    },
                    natural,
                    framed
                );
            });
        },
        [natural, stage, framed]
    );

    // React wheel handlers are passive, so the page would scroll as well.
    useEffect(() => {
        const element = stageRef.current;
        if (!element) return;
        const onWheel = (event: WheelEvent) => {
            event.preventDefault();
            if (working) return;
            const rect = element.getBoundingClientRect();
            setSmooth(false);
            zoomAt(
                (zoom) => zoom * Math.exp(-event.deltaY * 0.0015),
                event.clientX - rect.left - rect.width / 2,
                event.clientY - rect.top - rect.height / 2
            );
        };
        element.addEventListener('wheel', onWheel, { passive: false });
        return () => element.removeEventListener('wheel', onWheel);
    }, [zoomAt, working]);

    const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (working || !ready) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        setDragging(true);
        setSmooth(false);
    };

    const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const previous = pointers.current.get(event.pointerId);
        if (!previous) return;
        const point = { x: event.clientX, y: event.clientY };

        if (pointers.current.size === 1) {
            pan(point.x - previous.x, point.y - previous.y);
        } else if (pointers.current.size === 2) {
            // Pinch: zoom by the change in distance between the two fingers.
            const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)?.[1];
            if (other) {
                const before = Math.hypot(previous.x - other.x, previous.y - other.y);
                const after = Math.hypot(point.x - other.x, point.y - other.y);
                const rect = event.currentTarget.getBoundingClientRect();
                if (before > 0) {
                    zoomAt(
                        (zoom) => zoom * (after / before),
                        (point.x + other.x) / 2 - rect.left - rect.width / 2,
                        (point.y + other.y) / 2 - rect.top - rect.height / 2
                    );
                }
            }
        }
        pointers.current.set(event.pointerId, point);
    };

    const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
        pointers.current.delete(event.pointerId);
        if (pointers.current.size === 0) setDragging(false);
    };

    const onStageKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (working) return;
        const step = event.shiftKey ? 40 : 10;
        const moves: Record<string, [number, number]> = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
        };
        if (moves[event.key]) {
            event.preventDefault();
            setSmooth(true);
            pan(...moves[event.key]);
        } else if (event.key === '+' || event.key === '=') {
            event.preventDefault();
            setSmooth(true);
            zoomAt((zoom) => zoom * 1.15);
        } else if (event.key === '-') {
            event.preventDefault();
            setSmooth(true);
            zoomAt((zoom) => zoom / 1.15);
        }
    };

    const changeAspect = (aspect: CropAspect) => {
        if (!natural) return;
        setSmooth(true);
        setCrop((current) => clampCrop({ ...current, aspect }, natural, framed));
    };

    const reset = () => {
        setSmooth(true);
        setCrop({ ...UNTOUCHED_CROP, aspect: crop.aspect });
    };

    const view = natural ? clampCrop(crop, natural, framed) : crop;
    const layout = natural && ready ? geometry(view, natural, stage, framed) : null;
    const output = natural ? cropSize(view, natural, framed) : null;
    const outputScale = output ? Math.min(1, MAX_OUTPUT_EDGE / Math.max(output.width, output.height)) : 1;
    const transition = smooth
        ? 'transform 0.25s ease, width 0.25s ease, height 0.25s ease, left 0.25s ease, top 0.25s ease'
        : 'none';

    const apply = async () => {
        if (!natural || !imageRef.current || working) return;
        if (isUntouchedCrop(view)) {
            onApply({ blob: null, crop: view });
            return;
        }
        setRendering(true);
        setRenderError('');
        try {
            onApply({ blob: await renderCrop(imageRef.current, view, framed), crop: view });
        } catch (err) {
            setRenderError(typeof err === 'string' ? err : 'Could not crop this image.');
        } finally {
            setRendering(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-0 sm:p-4">
            <div
                className="absolute inset-0 animate-fade-in bg-slate-950/60 backdrop-blur-sm"
                onClick={working ? undefined : onCancel}
            />
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Adjust image"
                className="relative flex h-full w-full max-w-3xl animate-pop-in flex-col overflow-hidden bg-surface shadow-2xl sm:h-auto sm:rounded-3xl sm:border sm:border-line-strong"
            >
                <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-4 sm:px-6">
                    <div>
                        <h3 className="text-lg font-bold text-fg">Adjust image</h3>
                        <p className="text-xs text-muted">
                            Drag to move · scroll or pinch to zoom · arrow keys nudge
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={working}
                        aria-label="Close"
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5" aria-hidden="true">
                            <path d="M6 6l12 12M18 6 6 18" />
                        </svg>
                    </button>
                </div>

                <div
                    ref={stageRef}
                    tabIndex={0}
                    aria-label="Image position. Drag, or use the arrow keys, plus, and minus."
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerEnd}
                    onPointerCancel={onPointerEnd}
                    onKeyDown={onStageKey}
                    className={`relative min-h-0 flex-1 touch-none select-none overflow-hidden bg-[#0b0f19] outline-none sm:h-[min(58vh,520px)] sm:flex-none ${
                        ready ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : ''
                    }`}
                >
                    {loadFailed ? (
                        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-slate-300">
                            This image could not be opened.
                        </div>
                    ) : !layout || !natural ? (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-white/15 border-t-white/80" />
                        </div>
                    ) : (
                        <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={src}
                                alt=""
                                draggable={false}
                                className="pointer-events-none absolute left-0 top-0 max-w-none select-none"
                                style={{
                                    width: natural.width * layout.scale,
                                    height: natural.height * layout.scale,
                                    transform: `translate3d(${stage.width / 2 - view.x * natural.width * layout.scale}px, ${
                                        stage.height / 2 - view.y * natural.height * layout.scale
                                    }px, 0)`,
                                    transition,
                                }}
                            />
                            <div
                                className="pointer-events-none absolute rounded-[3px] ring-[1.5px] ring-white/90"
                                style={{
                                    width: layout.frame.width,
                                    height: layout.frame.height,
                                    left: (stage.width - layout.frame.width) / 2,
                                    top: (stage.height - layout.frame.height) / 2,
                                    boxShadow: '0 0 0 9999px rgb(2 6 23 / 0.62)',
                                    transition,
                                }}
                            >
                                <div
                                    className={`absolute inset-0 transition-opacity duration-200 ${
                                        dragging ? 'opacity-100' : 'opacity-40'
                                    }`}
                                >
                                    <div className="absolute inset-y-0 left-1/3 w-px bg-white/60" />
                                    <div className="absolute inset-y-0 left-2/3 w-px bg-white/60" />
                                    <div className="absolute inset-x-0 top-1/3 h-px bg-white/60" />
                                    <div className="absolute inset-x-0 top-2/3 h-px bg-white/60" />
                                </div>
                                <span className="absolute -left-[3px] -top-[3px] h-4 w-4 rounded-tl-[4px] border-l-[3px] border-t-[3px] border-white" />
                                <span className="absolute -right-[3px] -top-[3px] h-4 w-4 rounded-tr-[4px] border-r-[3px] border-t-[3px] border-white" />
                                <span className="absolute -bottom-[3px] -left-[3px] h-4 w-4 rounded-bl-[4px] border-b-[3px] border-l-[3px] border-white" />
                                <span className="absolute -bottom-[3px] -right-[3px] h-4 w-4 rounded-br-[4px] border-b-[3px] border-r-[3px] border-white" />
                            </div>
                        </>
                    )}
                </div>

                <div className="space-y-4 px-5 py-4 sm:px-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <Tabs
                            label="Crop shape"
                            variant="segmented"
                            items={ASPECTS}
                            value={view.aspect}
                            onChange={changeAspect}
                            className="self-start"
                        />
                        <div className="text-[11px] text-subtle">
                            {output
                                ? `${Math.round(output.width * outputScale).toLocaleString()} × ${Math.round(
                                      output.height * outputScale
                                  ).toLocaleString()} px`
                                : ''}
                            {output && output.width < SOFT_BELOW_WIDTH ? (
                                <span className="text-amber-700 dark:text-amber-300"> · zoomed past the photo&apos;s detail, may look soft</span>
                            ) : framed ? (
                                ' · your logo frame is added after cropping'
                            ) : null}
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => {
                                setSmooth(true);
                                zoomAt((zoom) => zoom / 1.25);
                            }}
                            disabled={working || view.zoom <= MIN_ZOOM}
                            aria-label="Zoom out"
                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line-strong bg-surface text-fg hover:bg-hover disabled:opacity-40"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4" aria-hidden="true">
                                <path d="M5 12h14" />
                            </svg>
                        </button>
                        <input
                            type="range"
                            min={MIN_ZOOM}
                            max={MAX_ZOOM}
                            step={0.01}
                            value={view.zoom}
                            disabled={working || !ready}
                            aria-label="Zoom"
                            onChange={(event) => {
                                setSmooth(false);
                                const value = Number(event.target.value);
                                zoomAt(() => value);
                            }}
                            className="h-1.5 flex-1 accent-indigo-600"
                        />
                        <button
                            type="button"
                            onClick={() => {
                                setSmooth(true);
                                zoomAt((zoom) => zoom * 1.25);
                            }}
                            disabled={working || view.zoom >= MAX_ZOOM}
                            aria-label="Zoom in"
                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line-strong bg-surface text-fg hover:bg-hover disabled:opacity-40"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4" aria-hidden="true">
                                <path d="M12 5v14M5 12h14" />
                            </svg>
                        </button>
                        <span className="w-12 text-right text-xs font-semibold tabular-nums text-muted">
                            {Math.round(view.zoom * 100)}%
                        </span>
                        <button
                            type="button"
                            onClick={reset}
                            disabled={working}
                            className="rounded-xl px-3 py-2 text-xs font-bold text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
                        >
                            Reset
                        </button>
                    </div>

                    {error || renderError ? (
                        <div className="animate-fade-up rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                            {error || renderError}
                        </div>
                    ) : null}

                    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                        <button
                            type="button"
                            onClick={onCancel}
                            disabled={working}
                            className="rounded-xl border border-line-strong bg-surface px-5 py-3 text-sm font-bold text-fg hover:bg-hover disabled:opacity-40"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={() => void apply()}
                            disabled={working || !ready}
                            className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-bold text-white shadow-sm shadow-indigo-600/25 hover:bg-indigo-500 disabled:opacity-60"
                        >
                            {working ? 'Saving...' : 'Use this image'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
