import { v2 as cloudinary } from 'cloudinary';
import { credentialsOptions } from './cloudinaryStorageService.js';
import type { CloudinaryCredentials } from './credentialService.js';
import { META_VIDEO_CODECS, REEL_LIMITS, VIDEO_PAD } from './mediaDerivativeService.js';

/**
 * Mixes one of the user's tracks into a reel with a Cloudinary audio layer.
 * Meta has no music API for Facebook, so the music has to be in the file.
 */

export interface TrackMix {
    /** The track's Cloudinary public id. */
    publicId: string;
    /** Seconds into the track where the music starts. */
    trackStart: number;
    /** 1-100. */
    musicVolume: number;
    /** The video's own sound, 0-100; 0 mutes it. */
    videoVolume: number;
}

/** Cloudinary volume for a 0-100 level, where 100 leaves it unchanged. */
export function volumeEffect(level: number): string {
    const rounded = Math.round(Math.min(Math.max(level, 0), 100));
    if (rounded === 100) return '';
    if (rounded === 0) return 'e_volume:mute';
    return `e_volume:${rounded - 100}`;
}

function seconds(value: number): string {
    return String(Math.round(Math.max(value, 0) * 10) / 10);
}

/**
 * The reel or Story transformation with the track laid over the video's own
 * sound. The music is cut to the video's length so the video does not grow.
 */
export function musicMixTransform(
    kind: 'reel' | 'story',
    mix: TrackMix,
    videoSeconds: number
): string {
    const story = kind === 'story';
    const length = story ? Math.min(videoSeconds, REEL_LIMITS.storySeconds) : videoSeconds;

    return [
        VIDEO_PAD,
        story ? `du_${REEL_LIMITS.storySeconds}` : '',
        volumeEffect(mix.videoVolume),
        `l_audio:${mix.publicId.replace(/\//g, ':')}`,
        `so_${seconds(mix.trackStart)},du_${seconds(length)}`,
        volumeEffect(mix.musicVolume),
        'fl_layer_apply',
        META_VIDEO_CODECS,
    ]
        .filter(Boolean)
        .join('/');
}

function mixUrl(cloudName: string, videoPublicId: string, transformation: string): string {
    return cloudinary.url(videoPublicId, {
        cloud_name: cloudName,
        secure: true,
        resource_type: 'video',
        raw_transformation: transformation,
        format: 'mp4',
    });
}

export interface MixedVideos {
    mixUrl: string;
    storyMixUrl: string;
    /** The transformations behind the two URLs, for an eager request. */
    transforms: string[];
}

export function musicMixUrls(
    cloudName: string,
    videoPublicId: string,
    mix: TrackMix,
    videoSeconds: number
): MixedVideos {
    const reel = musicMixTransform('reel', mix, videoSeconds);
    const story = musicMixTransform('story', mix, videoSeconds);
    return {
        mixUrl: mixUrl(cloudName, videoPublicId, reel),
        storyMixUrl: mixUrl(cloudName, videoPublicId, story),
        transforms: [reel, story],
    };
}

/**
 * Asks Cloudinary to build the mixed videos now, in the background, so they
 * are usually ready when the post publishes. Publishing still waits for the
 * URL, so a failed request here only costs time.
 */
export async function requestMixDerivatives(
    credentials: CloudinaryCredentials,
    videoPublicId: string,
    transforms: string[]
): Promise<void> {
    try {
        await cloudinary.uploader.explicit(videoPublicId, {
            ...credentialsOptions(credentials),
            type: 'upload',
            resource_type: 'video',
            eager: transforms.map((transformation) => ({
                raw_transformation: transformation,
                format: 'mp4',
            })),
            eager_async: true,
        });
    } catch (error) {
        console.error(`[music] Could not queue the mixed videos for ${videoPublicId}:`, error);
    }
}
