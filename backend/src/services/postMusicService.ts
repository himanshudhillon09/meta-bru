import type { IPostMusic, IPostPhoto, MediaType } from '../models/postModel.js';
import { AppError } from '../utils/errors.js';
import { getCloudinaryCredentials } from './credentialService.js';
import { musicMixUrls, requestMixDerivatives } from './musicMixService.js';
import { createPhotoReel, photoReelSeconds } from './photoReelService.js';

/** The media fields a post stores, with its music and photo-reel source. */
export interface PostMediaWithMusic {
    mediaType: MediaType;
    mediaUrl: string;
    mediaJpegUrl: string;
    mediaPublicId: string;
    mediaDuration: number;
    mediaCoverUrl: string;
    hasTextOverlay: boolean;
    music: IPostMusic | null;
    photo: IPostPhoto | null;
}

/**
 * Refuses music that would not play where the post goes: an Instagram song
 * only plays on Instagram, and a photo reel on Facebook without one of the
 * user's tracks would just be a silent video of the image.
 */
export function assertMusicFits(
    music: IPostMusic | null,
    options: { facebook: boolean; instagram: boolean; photoReel: boolean }
): void {
    if (!music) return;
    if (music.instagram && !music.track && !options.instagram) {
        throw new AppError(
            400,
            'An Instagram song only plays on Instagram. Turn on Instagram or choose one of your tracks.',
            'INSTAGRAM_SONG_NEEDS_INSTAGRAM'
        );
    }
    if (options.photoReel && options.facebook && !music.track) {
        throw new AppError(
            400,
            "Facebook can't play Instagram songs. Choose one of your tracks for Facebook, or turn Facebook off.",
            'FACEBOOK_NEEDS_TRACK'
        );
    }
}

/** Renders an image post's image into a photo reel. */
export async function toPhotoReel(
    userId: string,
    photo: IPostPhoto,
    seconds: number | undefined
): Promise<Omit<PostMediaWithMusic, 'music'>> {
    const credentials = await getCloudinaryCredentials(userId);
    const video = await createPhotoReel(
        userId,
        photo.jpegUrl || photo.url,
        photoReelSeconds(seconds),
        credentials
    );

    return {
        mediaType: 'reel',
        mediaUrl: video.url,
        mediaJpegUrl: '',
        mediaPublicId: video.publicId,
        mediaDuration: video.duration,
        mediaCoverUrl: video.coverUrl,
        hasTextOverlay: photo.hasTextOverlay,
        photo,
    };
}

/**
 * Fills in the URLs of the reel and Story with the user's track mixed in, and
 * asks Cloudinary to start building them. Music without a track has none.
 */
export async function withMixUrls(
    userId: string,
    music: IPostMusic,
    video: { publicId: string; duration: number }
): Promise<IPostMusic> {
    if (!music.track) return { ...music, mixUrl: '', storyMixUrl: '' };

    const credentials = await getCloudinaryCredentials(userId);
    const mixed = musicMixUrls(
        credentials.cloudName,
        video.publicId,
        {
            publicId: music.track.publicId,
            trackStart: music.trackStart,
            musicVolume: music.musicVolume,
            videoVolume: music.videoVolume,
        },
        video.duration
    );
    await requestMixDerivatives(credentials, video.publicId, mixed.transforms);

    return { ...music, mixUrl: mixed.mixUrl, storyMixUrl: mixed.storyMixUrl };
}
