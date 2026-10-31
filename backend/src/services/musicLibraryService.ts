import { v2 as cloudinary } from 'cloudinary';
import mongoose from 'mongoose';
import { z } from 'zod';
import { MusicTrack, type IMusicTrack } from '../models/musicTrackModel.js';
import { Post, type IPostMusic, type PostStatus } from '../models/postModel.js';
import { AppError } from '../utils/errors.js';
import { isAssetInUserFolder, userFolder } from './cloudinaryStorageService.js';
import { getCloudinaryCredentials, type CloudinaryCredentials } from './credentialService.js';
import { cloudinaryVideoStore, videoDuration, type VideoStore } from './videoUploadService.js';

/** The user's own music, kept in their Cloudinary account. */

export const TRACK_LIMITS = {
    // m4a uploads can be detected as mp4.
    formats: ['mp3', 'm4a', 'aac', 'wav', 'mp4'],
    maxBytes: 20 * 1024 * 1024,
    maxSeconds: 10 * 60,
} as const;

/** Statuses whose music can still change, so their track must stay. */
const TRACK_IN_USE_STATUSES: PostStatus[] = ['draft', 'queued', 'failed', 'publishing'];

export function musicFolder(userId: string): string {
    return `${userFolder(userId)}/music`;
}

/** True for files in the user's music folder. */
export function isMusicAsset(
    asset: { publicId?: string; assetFolder?: string },
    userId: string
): boolean {
    const folder = musicFolder(userId);
    return (
        (typeof asset.publicId === 'string' && asset.publicId.startsWith(`${folder}/`)) ||
        asset.assetFolder === folder ||
        (typeof asset.assetFolder === 'string' && asset.assetFolder.startsWith(`${folder}/`))
    );
}

export interface TrackUploadSignature {
    cloudName: string;
    apiKey: string;
    timestamp: number;
    signature: string;
    folder: string;
    allowedFormats: string;
}

/** Signs a direct browser upload of a track into the user's music folder. */
export function signTrackUpload(
    credentials: CloudinaryCredentials,
    userId: string,
    nowMs = Date.now()
): TrackUploadSignature {
    const signed = {
        timestamp: Math.floor(nowMs / 1000),
        folder: musicFolder(userId),
        allowed_formats: TRACK_LIMITS.formats.join(','),
    };

    return {
        cloudName: credentials.cloudName,
        apiKey: credentials.apiKey,
        timestamp: signed.timestamp,
        signature: cloudinary.utils.api_sign_request(signed, credentials.apiSecret),
        folder: signed.folder,
        allowedFormats: signed.allowed_formats,
    };
}

export interface MusicTrackView {
    _id: string;
    publicId: string;
    title: string;
    artist: string;
    duration: number;
    bytes: number;
    previewUrl: string;
    createdAt: Date;
}

function trackView(track: IMusicTrack, cloudName: string): MusicTrackView {
    return {
        _id: String(track._id),
        publicId: track.publicId,
        title: track.title,
        artist: track.artist,
        duration: track.duration,
        bytes: track.bytes,
        // MP3 plays in every browser, whatever the upload's format.
        previewUrl: cloudinary.url(track.publicId, {
            cloud_name: cloudName,
            secure: true,
            resource_type: 'video',
            format: 'mp3',
        }),
        createdAt: track.createdAt,
    };
}

function rejection(resource: { format?: unknown; bytes?: unknown }, duration: number): AppError | null {
    const format = typeof resource.format === 'string' ? resource.format.toLowerCase() : '';
    if (!(TRACK_LIMITS.formats as readonly string[]).includes(format)) {
        return new AppError(400, 'Unsupported audio type. Use MP3, M4A, AAC or WAV.', 'UNSUPPORTED_MEDIA_TYPE');
    }
    if (Number(resource.bytes) > TRACK_LIMITS.maxBytes) {
        return new AppError(400, 'Tracks can be at most 20 MB.', 'MEDIA_TOO_LARGE');
    }
    if (duration <= 0) {
        return new AppError(400, 'This file has no audio Cloudinary could read.', 'TRACK_NO_AUDIO');
    }
    if (duration > TRACK_LIMITS.maxSeconds) {
        return new AppError(400, 'Tracks can be at most 10 minutes long.', 'TRACK_TOO_LONG');
    }
    return null;
}

/**
 * Checks a track the browser just uploaded and adds it to the library. A file
 * outside the music folder is refused; one that breaks the limits is deleted.
 */
export async function registerTrack(
    userId: string,
    input: { publicId: string; title: string; artist: string },
    store?: VideoStore
): Promise<MusicTrackView> {
    const credentials = await getCloudinaryCredentials(userId);
    const videos = store ?? cloudinaryVideoStore(credentials);
    const resource = await videos.find(input.publicId);
    if (!resource) {
        throw new AppError(400, 'This track is no longer in your Cloudinary account. Upload it again.', 'MEDIA_NOT_FOUND');
    }

    const assetFolder = typeof resource.asset_folder === 'string' ? resource.asset_folder : '';
    if (
        !isAssetInUserFolder({ publicId: input.publicId, assetFolder }, userId) ||
        !isMusicAsset({ publicId: input.publicId, assetFolder }, userId)
    ) {
        throw new AppError(400, 'This file is not in your Meta-Bru music folder.', 'INVALID_MEDIA');
    }

    const duration = Math.round(videoDuration(resource) * 10) / 10;
    const problem = rejection(resource, duration);
    if (problem) {
        try {
            await videos.remove(input.publicId);
        } catch (error) {
            console.error(`[music] Could not delete rejected track ${input.publicId}:`, error);
        }
        throw problem;
    }

    const track = await MusicTrack.findOneAndUpdate(
        { userId, publicId: input.publicId },
        {
            $set: {
                title: input.title,
                artist: input.artist,
                duration,
                bytes: Number(resource.bytes) || 0,
            },
        },
        { upsert: true, new: true, runValidators: true }
    );
    return trackView(track, credentials.cloudName);
}

export async function listTracks(userId: string): Promise<MusicTrackView[]> {
    const credentials = await getCloudinaryCredentials(userId);
    const tracks = await MusicTrack.find({ userId }).sort({ createdAt: -1 });
    return tracks.map((track) => trackView(track, credentials.cloudName));
}

/** Removes a track and its file, unless a post that can still publish uses it. */
export async function deleteTrack(userId: string, trackId: string): Promise<void> {
    if (!mongoose.isValidObjectId(trackId)) {
        throw new AppError(400, 'Invalid track ID', 'INVALID_ID');
    }
    const track = await MusicTrack.findOne({ _id: trackId, userId });
    if (!track) throw new AppError(404, 'Track not found', 'TRACK_NOT_FOUND');

    const inUse = await Post.countDocuments({
        userId,
        'music.track.trackId': track._id,
        status: { $in: TRACK_IN_USE_STATUSES },
    });
    if (inUse > 0) {
        throw new AppError(
            409,
            `${inUse === 1 ? 'A post' : `${inUse} posts`} in your queue ${
                inUse === 1 ? 'uses' : 'use'
            } this track. Change their music first.`,
            'TRACK_IN_USE'
        );
    }

    const credentials = await getCloudinaryCredentials(userId);
    try {
        await cloudinaryVideoStore(credentials).remove(track.publicId);
    } catch (error) {
        console.error(`[music] Could not delete track file ${track.publicId}:`, error);
    }
    await track.deleteOne();
}

export const musicInputSchema = z
    .object({
        /** A song from Instagram's library. */
        instagram: z
            .object({
                audioId: z.string().trim().regex(/^\d{1,40}$/, 'Invalid Instagram audio ID'),
                title: z.string().trim().max(200).default(''),
                artist: z.string().trim().max(200).default(''),
                coverUrl: z.union([z.string().url(), z.literal('')]).default(''),
                durationMs: z.number().int().min(0).default(0),
            })
            .nullable()
            .optional(),
        /** One of the user's own tracks. */
        trackId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid track ID').nullable().optional(),
        trackStart: z.number().finite().min(0).max(TRACK_LIMITS.maxSeconds).default(0),
        musicVolume: z.number().int().min(1).max(100).default(80),
        videoVolume: z.number().int().min(0).max(100).default(30),
    })
    .refine((music) => Boolean(music.instagram || music.trackId), {
        message: 'Choose an Instagram song or one of your tracks',
    });

export type MusicInput = z.infer<typeof musicInputSchema>;

/**
 * Turns the editor's music choice into what a post stores, copying the
 * track's details from the user's library. The mix URLs are filled in once
 * the post's video is known.
 */
export async function resolvePostMusic(userId: string, input: MusicInput): Promise<IPostMusic> {
    let track: IPostMusic['track'] = null;
    let trackStart = 0;

    if (input.trackId) {
        const found = await MusicTrack.findOne({ _id: input.trackId, userId });
        if (!found) {
            throw new AppError(400, 'That track is no longer in your music library.', 'TRACK_NOT_FOUND');
        }
        track = {
            trackId: found._id as mongoose.Types.ObjectId,
            publicId: found.publicId,
            title: found.title,
            artist: found.artist,
            duration: found.duration,
        };
        if (input.trackStart >= found.duration) {
            throw new AppError(400, 'The start time is past the end of the track.', 'TRACK_START_INVALID');
        }
        trackStart = Math.round(input.trackStart * 10) / 10;
    }

    return {
        instagram: input.instagram ?? null,
        track,
        trackStart,
        musicVolume: input.musicVolume,
        videoVolume: input.videoVolume,
        mixUrl: '',
        storyMixUrl: '',
    };
}
