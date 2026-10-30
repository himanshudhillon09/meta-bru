import { v2 as cloudinary } from 'cloudinary';
import { AppError } from '../utils/errors.js';
import {
    cloudinaryErrorMessage,
    cloudinaryHttpCode,
    credentialsOptions,
    isAssetInUserFolder,
    userFolder,
} from './cloudinaryStorageService.js';
import type { CloudinaryCredentials } from './credentialService.js';
import {
    REEL_EAGER,
    REEL_LIMITS,
    reelCoverUrl,
    reelVideoUrl,
} from './mediaDerivativeService.js';

export interface VideoUploadSignature {
    cloudName: string;
    apiKey: string;
    timestamp: number;
    signature: string;
    folder: string;
    eager: string;
    eagerAsync: string;
    allowedFormats: string;
}

export interface VideoMedia {
    publicId: string;
    /** Meta-ready MP4 derivative. */
    url: string;
    coverUrl: string;
    /** The uploaded file, for previews while the derivative is still building. */
    originalUrl: string;
    width: number;
    height: number;
    duration: number;
    format: string;
    bytes: number;
}

export interface VideoResource {
    public_id?: unknown;
    asset_folder?: unknown;
    secure_url?: unknown;
    format?: unknown;
    bytes?: unknown;
    width?: unknown;
    height?: unknown;
    duration?: unknown;
    /** Probe details Cloudinary returns with media_metadata. */
    video_metadata?: { format?: { duration?: unknown } };
}

export interface VideoStore {
    /** Returns null when Cloudinary has no such video. */
    find(publicId: string): Promise<VideoResource | null>;
    remove(publicId: string): Promise<void>;
}

/**
 * Signs a direct browser upload to the user's own Cloudinary account.
 * Cloudinary rejects any change to a signed field, so the upload always lands
 * in the user's folder with the reel derivatives queued. The API secret never
 * leaves the server.
 */
export function signVideoUpload(
    credentials: CloudinaryCredentials,
    userId: string,
    nowMs = Date.now()
): VideoUploadSignature {
    const signed = {
        timestamp: Math.floor(nowMs / 1000),
        folder: userFolder(userId),
        eager: REEL_EAGER,
        eager_async: 'true',
        allowed_formats: REEL_LIMITS.formats.join(','),
    };

    return {
        cloudName: credentials.cloudName,
        apiKey: credentials.apiKey,
        timestamp: signed.timestamp,
        signature: cloudinary.utils.api_sign_request(signed, credentials.apiSecret),
        folder: signed.folder,
        eager: signed.eager,
        eagerAsync: signed.eager_async,
        allowedFormats: signed.allowed_formats,
    };
}

function numberOrZero(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function formatOf(resource: VideoResource): string {
    return typeof resource.format === 'string' ? resource.format.toLowerCase() : '';
}

/** The video's length in seconds, or 0 when Cloudinary did not report it. */
export function videoDuration(resource: VideoResource): number {
    return (
        numberOrZero(resource.duration) ||
        numberOrZero(resource.video_metadata?.format?.duration)
    );
}

/** Why a video cannot be a reel, or null when it can. */
export function videoRejection(resource: VideoResource): AppError | null {
    const duration = videoDuration(resource);

    if (!REEL_LIMITS.formats.includes(formatOf(resource))) {
        return new AppError(400, 'Unsupported video type. Use MP4 or MOV.', 'UNSUPPORTED_MEDIA_TYPE');
    }
    if (numberOrZero(resource.bytes) > REEL_LIMITS.maxBytes) {
        return new AppError(400, 'Reels can be at most 100 MB.', 'MEDIA_TOO_LARGE');
    }
    // An unknown length is not a short video; say so instead of rejecting it as one.
    if (duration === 0) {
        return new AppError(
            502,
            'Cloudinary did not report how long this video is. Upload it again.',
            'VIDEO_DURATION_UNKNOWN'
        );
    }
    if (duration < REEL_LIMITS.minSeconds) {
        return new AppError(400, 'Reels must be at least 3 seconds long.', 'REEL_TOO_SHORT');
    }
    if (duration > REEL_LIMITS.maxInstagramSeconds) {
        return new AppError(400, 'Reels can be at most 15 minutes long.', 'REEL_TOO_LONG');
    }
    return null;
}

export function cloudinaryVideoStore(credentials: CloudinaryCredentials): VideoStore {
    const options = { ...credentialsOptions(credentials), resource_type: 'video' };

    return {
        async find(publicId) {
            try {
                // Without media_metadata the Admin API leaves out the video's
                // duration, which made every reel look shorter than 3 seconds.
                return (await cloudinary.api.resource(publicId, {
                    ...options,
                    media_metadata: true,
                })) as VideoResource;
            } catch (error) {
                if (cloudinaryHttpCode(error) === 404) return null;
                throw new AppError(502, cloudinaryErrorMessage(error), 'CLOUDINARY_API_FAILED');
            }
        },
        async remove(publicId) {
            await cloudinary.api.delete_resources([publicId], { ...options, type: 'upload' });
        },
    };
}

/**
 * Loads a reel video from the user's Cloudinary account and checks it is in
 * their Meta-Bru folder and within the reel limits. A freshly uploaded video
 * that fails the limits can be deleted so it does not linger in storage.
 */
export async function loadReelVideo(
    userId: string,
    publicId: string,
    credentials: CloudinaryCredentials,
    options: { deleteIfRejected?: boolean } = {},
    store: VideoStore = cloudinaryVideoStore(credentials)
): Promise<VideoMedia> {
    const resource = await store.find(publicId);
    if (!resource) {
        throw new AppError(
            400,
            'This video is no longer in your Cloudinary account. Upload it again.',
            'MEDIA_NOT_FOUND'
        );
    }

    const assetFolder = typeof resource.asset_folder === 'string' ? resource.asset_folder : '';
    if (!isAssetInUserFolder({ publicId, assetFolder }, userId)) {
        throw new AppError(400, 'This video is not in your Meta-Bru folder.', 'INVALID_MEDIA');
    }

    const rejection = videoRejection(resource);
    if (rejection) {
        if (options.deleteIfRejected) {
            try {
                await store.remove(publicId);
            } catch (error) {
                console.error(`[media] Could not delete rejected video ${publicId}:`, error);
            }
        }
        throw rejection;
    }

    return {
        publicId,
        url: reelVideoUrl(credentials.cloudName, publicId),
        coverUrl: reelCoverUrl(credentials.cloudName, publicId),
        originalUrl: typeof resource.secure_url === 'string' ? resource.secure_url : '',
        width: numberOrZero(resource.width),
        height: numberOrZero(resource.height),
        duration: Math.round(videoDuration(resource) * 10) / 10,
        format: formatOf(resource),
        bytes: numberOrZero(resource.bytes),
    };
}
