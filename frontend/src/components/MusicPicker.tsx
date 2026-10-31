'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { musicApi, uploadToCloudinary } from '@/lib/apiClient';
import {
    PHOTO_REEL_SECONDS,
    TRACK_ACCEPT,
    TRACK_LIMITS,
    musicProblem,
    readAudioDuration,
    songLabel,
    titleFromFileName,
    type MusicChoice,
} from '@/lib/music';
import { formatDuration, type MusicTrack } from '@/lib/types';

interface MusicPickerProps {
    value: MusicChoice;
    onChange: (next: MusicChoice) => void;
    /** An image post, which publishes as a photo reel once it has music. */
    isImage: boolean;
    /** Photo reel length; only for image posts. */
    photoSeconds?: number;
    onPhotoSecondsChange?: (seconds: number) => void;
}

const SMALL_BUTTON =
    'shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-all disabled:opacity-40';

/** One audio element for every preview, so only one plays at a time. */
function usePreview() {
    const audio = useRef<HTMLAudioElement | null>(null);
    const [playing, setPlaying] = useState('');

    useEffect(() => () => audio.current?.pause(), []);

    const toggle = useCallback(
        (id: string, url: string) => {
            if (!audio.current) {
                audio.current = new Audio();
                audio.current.onended = () => setPlaying('');
                audio.current.onerror = () => setPlaying('');
            }
            const player = audio.current;
            if (playing === id) {
                player.pause();
                setPlaying('');
                return;
            }
            player.src = url;
            player.currentTime = 0;
            void player.play().catch(() => setPlaying(''));
            setPlaying(id);
        },
        [playing]
    );

    return { playing, toggle };
}

function Slider({
    label,
    value,
    min,
    max,
    suffix,
    onChange,
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    suffix: string;
    onChange: (value: number) => void;
}) {
    return (
        <label className="block">
            <span className="flex justify-between text-[11px] font-bold text-muted">
                <span>{label}</span>
                <span className="text-fg">
                    {value}
                    {suffix}
                </span>
            </span>
            <input
                type="range"
                min={min}
                max={max}
                value={value}
                onChange={(event) => onChange(Number(event.target.value))}
                className="mt-1 w-full accent-indigo-500"
            />
        </label>
    );
}

/** Picks one of the user's own tracks, which is mixed into the video for every platform. */
export function MusicPicker({ value, onChange, isImage, photoSeconds, onPhotoSecondsChange }: MusicPickerProps) {
    const { playing, toggle } = usePreview();
    const [tracks, setTracks] = useState<MusicTrack[] | null>(null);
    const [configured, setConfigured] = useState(true);
    const [error, setError] = useState('');
    const [uploadProgress, setUploadProgress] = useState<number | null>(null);
    const [confirmDelete, setConfirmDelete] = useState('');
    const fileInput = useRef<HTMLInputElement>(null);

    useEffect(() => {
        let cancelled = false;
        musicApi
            .tracks()
            .then((data) => {
                if (cancelled) return;
                setConfigured(data.configured);
                setTracks(data.tracks);
            })
            .catch((err) => {
                if (cancelled) return;
                setTracks([]);
                setError(typeof err === 'string' ? err : 'Could not load your tracks');
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const set = (patch: Partial<MusicChoice>) => onChange({ ...value, ...patch });

    const choose = (track: MusicTrack) =>
        set({
            track: { trackId: track._id, title: track.title, artist: track.artist, duration: track.duration },
            trackStart: 0,
        });

    const upload = async (file: File | undefined) => {
        if (!file) return;
        setError('');
        if (file.size > TRACK_LIMITS.maxBytes) {
            setError('Tracks can be at most 20 MB.');
            return;
        }
        const duration = await readAudioDuration(file);
        if (duration !== null && duration > TRACK_LIMITS.maxSeconds) {
            setError('Tracks can be at most 10 minutes long.');
            return;
        }

        setUploadProgress(0);
        try {
            const { upload: signature } = await musicApi.trackSignature();
            const { publicId } = await uploadToCloudinary(file, signature, setUploadProgress).promise;
            const { track } = await musicApi.addTrack({
                publicId,
                title: titleFromFileName(file.name),
                artist: '',
            });
            setTracks((current) => [track, ...(current ?? []).filter((item) => item._id !== track._id)]);
            choose(track);
        } catch (err) {
            setError(typeof err === 'string' ? err : 'Upload failed');
        } finally {
            setUploadProgress(null);
            if (fileInput.current) fileInput.current.value = '';
        }
    };

    const remove = async (track: MusicTrack) => {
        setError('');
        try {
            await musicApi.deleteTrack(track._id);
            setTracks((current) => (current ?? []).filter((item) => item._id !== track._id));
            if (value.track?.trackId === track._id) set({ track: null, trackStart: 0 });
        } catch (err) {
            setError(typeof err === 'string' ? err : 'Could not delete the track');
        } finally {
            setConfirmDelete('');
        }
    };

    const problem = musicProblem(value);

    return (
        <div className="space-y-3">
            {!configured ? (
                <p className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-xs text-muted">
                    Add your Cloudinary account under Profile to upload your own music.
                </p>
            ) : (
                <>
                    <input
                        ref={fileInput}
                        type="file"
                        accept={TRACK_ACCEPT}
                        className="hidden"
                        onChange={(event) => void upload(event.target.files?.[0])}
                    />
                    <button
                        type="button"
                        onClick={() => fileInput.current?.click()}
                        disabled={uploadProgress !== null}
                        className="w-full rounded-xl border border-dashed border-line-strong bg-surface-2 px-4 py-3 text-xs font-bold text-fg hover:border-indigo-500/50 disabled:opacity-60"
                    >
                        {uploadProgress !== null
                            ? `Uploading… ${Math.round(uploadProgress * 100)}%`
                            : '+ Upload music (MP3, M4A, AAC or WAV, up to 20 MB)'}
                    </button>
                    <p className="text-[11px] text-subtle">
                        Mixed into the video, so it plays on Facebook, Instagram and Stories. Use music you have
                        the rights to.
                    </p>
                </>
            )}

            {error ? (
                <p className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                    {error}
                </p>
            ) : null}

            <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {tracks === null ? (
                    <p className="py-6 text-center text-xs text-subtle">Loading your music…</p>
                ) : tracks.length === 0 ? (
                    configured ? (
                        <p className="py-6 text-center text-xs text-subtle">No music yet. Upload a track above.</p>
                    ) : null
                ) : (
                    tracks.map((track) => {
                        const selected = value.track?.trackId === track._id;
                        return (
                            <div
                                key={track._id}
                                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                                    selected ? 'border-indigo-500/40 bg-indigo-500/10' : 'border-line bg-surface-2'
                                }`}
                            >
                                <button
                                    type="button"
                                    onClick={() => toggle(track._id, track.previewUrl)}
                                    aria-label={playing === track._id ? 'Stop preview' : 'Play preview'}
                                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line-strong bg-surface text-fg hover:bg-hover"
                                >
                                    {playing === track._id ? '■' : '▶'}
                                </button>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-xs font-bold text-fg">{track.title}</span>
                                    <span className="block truncate text-[11px] text-muted">
                                        {track.artist ? `${track.artist} · ` : ''}
                                        {formatDuration(track.duration)}
                                    </span>
                                </span>
                                {confirmDelete === track._id ? (
                                    <button
                                        type="button"
                                        onClick={() => void remove(track)}
                                        className={`${SMALL_BUTTON} bg-rose-600 text-white`}
                                    >
                                        Delete?
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setConfirmDelete(track._id)}
                                        aria-label={`Delete ${track.title}`}
                                        className={`${SMALL_BUTTON} text-rose-700 dark:text-rose-300 hover:bg-rose-500/10`}
                                    >
                                        ✕
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => (selected ? set({ track: null, trackStart: 0 }) : choose(track))}
                                    className={`${SMALL_BUTTON} ${
                                        selected
                                            ? 'bg-indigo-600 text-white'
                                            : 'border border-line-strong bg-surface text-fg hover:bg-hover'
                                    }`}
                                >
                                    {selected ? 'Selected' : 'Use'}
                                </button>
                            </div>
                        );
                    })
                )}
            </div>

            {value.track ? (
                <div className="space-y-3 rounded-2xl border border-line bg-surface-2 p-4">
                    <span className="inline-flex items-center gap-2 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
                        ♪ {songLabel(value.track)}
                        <button type="button" aria-label="Remove music" onClick={() => set({ track: null, trackStart: 0 })}>
                            ✕
                        </button>
                    </span>
                    <Slider
                        label="Starts at"
                        value={Math.round(value.trackStart)}
                        min={0}
                        max={Math.max(0, Math.floor(value.track.duration) - 1)}
                        suffix={` s (${formatDuration(value.trackStart)})`}
                        onChange={(trackStart) => set({ trackStart })}
                    />
                    <Slider
                        label="Music volume"
                        value={value.musicVolume}
                        min={1}
                        max={100}
                        suffix="%"
                        onChange={(musicVolume) => set({ musicVolume })}
                    />
                    {isImage ? (
                        onPhotoSecondsChange ? (
                            <Slider
                                label="Reel length"
                                value={photoSeconds ?? PHOTO_REEL_SECONDS.default}
                                min={PHOTO_REEL_SECONDS.min}
                                max={PHOTO_REEL_SECONDS.max}
                                suffix=" s"
                                onChange={onPhotoSecondsChange}
                            />
                        ) : null
                    ) : (
                        <Slider
                            label="Video's own sound"
                            value={value.videoVolume}
                            min={0}
                            max={100}
                            suffix={value.videoVolume === 0 ? '% (muted)' : '%'}
                            onChange={(videoVolume) => set({ videoVolume })}
                        />
                    )}
                    <p className="text-[11px] text-muted">
                        {isImage
                            ? 'Publishes as a reel of this image on Facebook and Instagram, since neither plays music on photos.'
                            : 'Plays on Facebook, Instagram and Stories.'}
                    </p>
                    {problem ? (
                        <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
                            {problem}
                        </p>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
