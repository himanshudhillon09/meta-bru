'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { musicApi, uploadToCloudinary } from '@/lib/apiClient';
import {
    PHOTO_REEL_SECONDS,
    TRACK_ACCEPT,
    TRACK_LIMITS,
    hasMusic,
    musicProblem,
    musicSummary,
    readAudioDuration,
    songLabel,
    titleFromFileName,
    type MusicChoice,
    type MusicTargets,
} from '@/lib/music';
import { formatDuration, type InstagramSongResult, type MusicTrack } from '@/lib/types';

interface MusicPickerProps {
    value: MusicChoice;
    onChange: (next: MusicChoice) => void;
    /** The Page whose Instagram account searches Instagram's library. */
    connectionId: string;
    instagramLinked: boolean;
    targets: MusicTargets;
    /** Photo reel length; only for image posts. */
    photoSeconds?: number;
    onPhotoSecondsChange?: (seconds: number) => void;
}

type Source = 'instagram' | 'tracks';

const ROW =
    'flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors';
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

function PlayButton({ active, onClick, disabled }: { active: boolean; onClick: () => void; disabled?: boolean }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={active ? 'Stop preview' : 'Play preview'}
            title={disabled ? 'No preview available' : undefined}
            className="shrink-0 grid h-8 w-8 place-items-center rounded-full border border-line-strong bg-surface text-fg hover:bg-hover disabled:opacity-40"
        >
            {active ? '■' : '▶'}
        </button>
    );
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

export function MusicPicker({
    value,
    onChange,
    connectionId,
    instagramLinked,
    targets,
    photoSeconds,
    onPhotoSecondsChange,
}: MusicPickerProps) {
    const [source, setSource] = useState<Source>(
        value.track && !value.instagram ? 'tracks' : instagramLinked ? 'instagram' : 'tracks'
    );
    const { playing, toggle } = usePreview();

    // Instagram library
    const [query, setQuery] = useState('');
    const [songs, setSongs] = useState<InstagramSongResult[]>([]);
    const [songsLoading, setSongsLoading] = useState(false);
    const [songsError, setSongsError] = useState('');

    // The user's tracks
    const [tracks, setTracks] = useState<MusicTrack[] | null>(null);
    const [configured, setConfigured] = useState(true);
    const [tracksError, setTracksError] = useState('');
    const [uploadProgress, setUploadProgress] = useState<number | null>(null);
    const [confirmDelete, setConfirmDelete] = useState('');
    const fileInput = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (source !== 'instagram' || !instagramLinked || !connectionId) return;
        let cancelled = false;
        const timer = setTimeout(() => {
            setSongsLoading(true);
            setSongsError('');
            musicApi
                .searchInstagram(connectionId, query)
                .then((data) => {
                    if (!cancelled) setSongs(data.songs);
                })
                .catch((err) => {
                    if (!cancelled) {
                        setSongs([]);
                        setSongsError(typeof err === 'string' ? err : 'Could not search Instagram music');
                    }
                })
                .finally(() => {
                    if (!cancelled) setSongsLoading(false);
                });
        }, query ? 400 : 0);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [source, query, connectionId, instagramLinked]);

    useEffect(() => {
        if (source !== 'tracks' || tracks !== null) return;
        musicApi
            .tracks()
            .then((data) => {
                setConfigured(data.configured);
                setTracks(data.tracks);
            })
            .catch((err) => {
                setTracks([]);
                setTracksError(typeof err === 'string' ? err : 'Could not load your tracks');
            });
    }, [source, tracks]);

    const set = (patch: Partial<MusicChoice>) => onChange({ ...value, ...patch });

    const chooseTrack = (track: MusicTrack) =>
        set({
            track: { trackId: track._id, title: track.title, artist: track.artist, duration: track.duration },
            trackStart: 0,
        });

    const upload = async (file: File | undefined) => {
        if (!file) return;
        setTracksError('');
        if (file.size > TRACK_LIMITS.maxBytes) {
            setTracksError('Tracks can be at most 20 MB.');
            return;
        }
        const duration = await readAudioDuration(file);
        if (duration !== null && duration > TRACK_LIMITS.maxSeconds) {
            setTracksError('Tracks can be at most 10 minutes long.');
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
            chooseTrack(track);
        } catch (err) {
            setTracksError(typeof err === 'string' ? err : 'Upload failed');
        } finally {
            setUploadProgress(null);
            if (fileInput.current) fileInput.current.value = '';
        }
    };

    const removeTrack = async (track: MusicTrack) => {
        setTracksError('');
        try {
            await musicApi.deleteTrack(track._id);
            setTracks((current) => (current ?? []).filter((item) => item._id !== track._id));
            if (value.track?.trackId === track._id) set({ track: null, trackStart: 0 });
        } catch (err) {
            setTracksError(typeof err === 'string' ? err : 'Could not delete the track');
        } finally {
            setConfirmDelete('');
        }
    };

    const problem = musicProblem(value, targets);
    const summary = musicSummary(value, targets);

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface-2 p-1" role="tablist">
                {(
                    [
                        ['instagram', 'Instagram library'],
                        ['tracks', 'Your tracks'],
                    ] as const
                ).map(([key, label]) => (
                    <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={source === key}
                        onClick={() => setSource(key)}
                        className={`rounded-lg px-3 py-2 text-xs font-bold transition-all ${
                            source === key ? 'bg-indigo-600 text-white shadow' : 'text-muted hover:text-fg'
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {source === 'instagram' ? (
                !instagramLinked ? (
                    <p className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-xs text-muted">
                        This Page has no linked Instagram account, so Instagram&apos;s library is not available.
                        Use one of your own tracks instead.
                    </p>
                ) : (
                    <div className="space-y-2">
                        <input
                            type="search"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search songs or artists (trending when empty)"
                            className="w-full bg-surface-2 border border-line-strong rounded-xl px-4 py-2.5 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                        />
                        <p className="text-[11px] text-subtle">
                            Plays on Instagram reels only. Instagram picks where the song starts.
                        </p>
                        {songsError ? (
                            <p className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                                {songsError}
                            </p>
                        ) : null}
                        <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                            {songsLoading && songs.length === 0 ? (
                                <p className="py-6 text-center text-xs text-subtle">Loading songs…</p>
                            ) : !songsError && songs.length === 0 ? (
                                <p className="py-6 text-center text-xs text-subtle">No songs found.</p>
                            ) : (
                                songs.map((song) => {
                                    const selected = value.instagram?.audioId === song.audioId;
                                    return (
                                        <div
                                            key={song.audioId}
                                            className={`${ROW} ${
                                                selected ? 'border-indigo-500/40 bg-indigo-500/10' : 'border-line bg-surface-2'
                                            }`}
                                        >
                                            {song.coverUrl ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={song.coverUrl} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" />
                                            ) : (
                                                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-sunken text-subtle">♪</span>
                                            )}
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-xs font-bold text-fg">{song.title}</span>
                                                <span className="block truncate text-[11px] text-muted">
                                                    {song.artist || 'Unknown artist'} · {formatDuration(song.durationMs / 1000)}
                                                </span>
                                            </span>
                                            <PlayButton
                                                active={playing === `ig-${song.audioId}`}
                                                disabled={!song.previewUrl}
                                                onClick={() => toggle(`ig-${song.audioId}`, song.previewUrl)}
                                            />
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    set({
                                                        instagram: selected
                                                            ? null
                                                            : {
                                                                  audioId: song.audioId,
                                                                  title: song.title,
                                                                  artist: song.artist,
                                                                  coverUrl: song.coverUrl,
                                                                  durationMs: song.durationMs,
                                                              },
                                                    })
                                                }
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
                    </div>
                )
            ) : (
                <div className="space-y-2">
                    {!configured ? (
                        <p className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-xs text-muted">
                            Add your Cloudinary account under Profile to upload your own tracks.
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
                                    : '+ Upload a track (MP3, M4A, AAC or WAV, up to 20 MB)'}
                            </button>
                            <p className="text-[11px] text-subtle">
                                Mixed into the video, so it plays on Facebook, Instagram and Stories. Use music you
                                have the rights to.
                            </p>
                        </>
                    )}
                    {tracksError ? (
                        <p className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                            {tracksError}
                        </p>
                    ) : null}
                    <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                        {tracks === null ? (
                            <p className="py-6 text-center text-xs text-subtle">Loading your tracks…</p>
                        ) : tracks.length === 0 ? (
                            configured ? (
                                <p className="py-6 text-center text-xs text-subtle">No tracks yet. Upload one above.</p>
                            ) : null
                        ) : (
                            tracks.map((track) => {
                                const selected = value.track?.trackId === track._id;
                                return (
                                    <div
                                        key={track._id}
                                        className={`${ROW} ${
                                            selected ? 'border-indigo-500/40 bg-indigo-500/10' : 'border-line bg-surface-2'
                                        }`}
                                    >
                                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-sunken text-subtle">♪</span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-xs font-bold text-fg">{track.title}</span>
                                            <span className="block truncate text-[11px] text-muted">
                                                {track.artist ? `${track.artist} · ` : ''}
                                                {formatDuration(track.duration)}
                                            </span>
                                        </span>
                                        <PlayButton
                                            active={playing === `track-${track._id}`}
                                            onClick={() => toggle(`track-${track._id}`, track.previewUrl)}
                                        />
                                        {confirmDelete === track._id ? (
                                            <button
                                                type="button"
                                                onClick={() => void removeTrack(track)}
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
                                            onClick={() => (selected ? set({ track: null, trackStart: 0 }) : chooseTrack(track))}
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
                </div>
            )}

            {hasMusic(value) ? (
                <div className="space-y-3 rounded-2xl border border-line bg-surface-2 p-4">
                    <div className="flex flex-wrap gap-2">
                        {value.instagram ? (
                            <span className="inline-flex items-center gap-2 rounded-full border border-fuchsia-500/20 bg-fuchsia-500/10 px-3 py-1 text-[11px] font-bold text-fuchsia-700 dark:text-fuchsia-300">
                                ♪ {songLabel(value.instagram)} · Instagram
                                <button type="button" aria-label="Remove Instagram song" onClick={() => set({ instagram: null })}>
                                    ✕
                                </button>
                            </span>
                        ) : null}
                        {value.track ? (
                            <span className="inline-flex items-center gap-2 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
                                ♪ {songLabel(value.track)} · Your track
                                <button type="button" aria-label="Remove your track" onClick={() => set({ track: null, trackStart: 0 })}>
                                    ✕
                                </button>
                            </span>
                        ) : null}
                    </div>

                    {value.track ? (
                        <Slider
                            label="Your track starts at"
                            value={Math.round(value.trackStart)}
                            min={0}
                            max={Math.max(0, Math.floor(value.track.duration) - 1)}
                            suffix={` s (${formatDuration(value.trackStart)})`}
                            onChange={(trackStart) => set({ trackStart })}
                        />
                    ) : null}
                    <Slider
                        label="Music volume"
                        value={value.musicVolume}
                        min={1}
                        max={100}
                        suffix="%"
                        onChange={(musicVolume) => set({ musicVolume })}
                    />
                    {!targets.isImage ? (
                        <Slider
                            label="Video's own sound"
                            value={value.videoVolume}
                            min={0}
                            max={100}
                            suffix={value.videoVolume === 0 ? '% (muted)' : '%'}
                            onChange={(videoVolume) => set({ videoVolume })}
                        />
                    ) : null}
                    {targets.isImage && onPhotoSecondsChange ? (
                        <Slider
                            label="Reel length"
                            value={photoSeconds ?? PHOTO_REEL_SECONDS.default}
                            min={PHOTO_REEL_SECONDS.min}
                            max={PHOTO_REEL_SECONDS.max}
                            suffix=" s"
                            onChange={onPhotoSecondsChange}
                        />
                    ) : null}

                    <ul className="space-y-1 text-[11px] text-muted">
                        {summary.map((line) => (
                            <li key={line}>{line}</li>
                        ))}
                    </ul>
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
