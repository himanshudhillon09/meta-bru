import type { MusicTrack, Post } from './types';

/** Mirrors PHOTO_REEL_SECONDS in the backend's photoReelService. */
export const PHOTO_REEL_SECONDS = { min: 5, max: 60, default: 15 } as const;

/** Mirrors TRACK_LIMITS in the backend's musicLibraryService. */
export const TRACK_LIMITS = { maxBytes: 20 * 1024 * 1024, maxSeconds: 10 * 60 } as const;

export const TRACK_ACCEPT = 'audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/x-wav,.mp3,.m4a,.aac,.wav';

/** The music an editor is choosing for a post. */
export interface MusicChoice {
    track: (Pick<MusicTrack, 'title' | 'artist' | 'duration'> & { trackId: string }) | null;
    /** Seconds into the track. */
    trackStart: number;
    /** 1-100. */
    musicVolume: number;
    /** The video's own sound, 0-100; 0 mutes it. */
    videoVolume: number;
}

export const NO_MUSIC: MusicChoice = {
    track: null,
    trackStart: 0,
    musicVolume: 80,
    videoVolume: 30,
};

export function hasMusic(choice: MusicChoice | null | undefined): choice is MusicChoice {
    return Boolean(choice?.track);
}

export function musicFromPost(post: Pick<Post, 'music'>): MusicChoice {
    const music = post.music;
    if (!music?.track) return NO_MUSIC;
    return {
        track: {
            trackId: music.track.trackId,
            title: music.track.title,
            artist: music.track.artist,
            duration: music.track.duration,
        },
        trackStart: music.trackStart,
        musicVolume: music.musicVolume,
        videoVolume: music.videoVolume,
    };
}

/** The request body for a post's music, or null for none. */
export function musicInput(choice: MusicChoice) {
    if (!choice.track) return null;
    return {
        trackId: choice.track.trackId,
        trackStart: choice.trackStart,
        musicVolume: choice.musicVolume,
        videoVolume: choice.videoVolume,
    };
}

export function songLabel(song: { title: string; artist: string }): string {
    return song.artist ? `${song.title} — ${song.artist}` : song.title;
}

/** Why this music cannot be saved, or '' when it can. Mirrors the server. */
export function musicProblem(choice: MusicChoice): string {
    if (choice.track && choice.trackStart >= choice.track.duration) {
        return 'The start time is past the end of the track.';
    }
    return '';
}

/** Reads an audio file's length in the browser; null when it cannot. */
export function readAudioDuration(file: File): Promise<number | null> {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const audio = document.createElement('audio');
        const finish = (value: number | null) => {
            URL.revokeObjectURL(url);
            resolve(value);
        };
        audio.preload = 'metadata';
        audio.onloadedmetadata = () =>
            finish(Number.isFinite(audio.duration) ? audio.duration : null);
        audio.onerror = () => finish(null);
        audio.src = url;
    });
}

/** "Song name" from "Song name.mp3". */
export function titleFromFileName(name: string): string {
    return name.replace(/\.[a-z\d]{2,4}$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 120) || 'Untitled';
}
