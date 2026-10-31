import type { IPostMusic, IPostPhoto, MediaType } from '../models/postModel.js';
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
 * asks Cloudinary to start building them.
 */
export async function withMixUrls(
    userId: string,
    music: IPostMusic,
    video: { publicId: string; duration: number }
): Promise<IPostMusic> {
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
