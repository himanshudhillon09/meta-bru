import { v2 as cloudinary } from 'cloudinary';
import { pollUntil, type Deadline } from './pollService.js';

/**
 * Cloudinary derivatives that Meta-Bru hands to Meta. The upload signature,
 * the delivery URLs, and Storage thumbnails all use these exact strings, so
 * an eager derivative built at upload is the file a URL points to.
 */

export interface ReelLimits {
    formats: readonly string[];
    maxBytes: number;
    minSeconds: number;
    maxFacebookSeconds: number;
    maxInstagramSeconds: number;
    storySeconds: number;
}

export const REEL_LIMITS: ReelLimits = {
    formats: ['mp4', 'mov'],
    // Cloudinary's single-request upload limit.
    maxBytes: 100 * 1024 * 1024,
    minSeconds: 3,
    maxFacebookSeconds: 90,
    maxInstagramSeconds: 15 * 60,
    storySeconds: 60,
};

// 1080×1920 meets Facebook's 9:16 and 540×960 minimum for any input shape.
export const VIDEO_PAD = 'c_pad,w_1080,h_1920,b_blurred:400:15';
export const META_VIDEO_CODECS = 'vc_h264,ac_aac,q_auto';

export const REEL_VIDEO_TRANSFORM = `${VIDEO_PAD}/${META_VIDEO_CODECS}`;
export const REEL_COVER_TRANSFORM = 'so_1,c_fill,w_540,h_960,q_auto';
export const STORY_VIDEO_TRANSFORM = `${VIDEO_PAD}/du_60/${META_VIDEO_CODECS}`;
// b_blurred is video-only; images pad with a colour taken from their edges.
export const STORY_IMAGE_TRANSFORM = 'c_pad,w_1080,h_1920,b_auto,q_auto:good';

/** Instagram reel thumbnail position, matching the cover frame (so_1). */
export const REEL_THUMB_OFFSET_MS = 1000;

/** Eager derivatives requested at upload, as `transformation/format|…`. */
export const REEL_EAGER = [
    `${REEL_VIDEO_TRANSFORM}/mp4`,
    `${REEL_COVER_TRANSFORM}/jpg`,
    `${STORY_VIDEO_TRANSFORM}/mp4`,
].join('|');

/** How long a publish waits for Cloudinary to finish a derivative. */
export const DERIVATIVE_WAIT_MS = 3 * 60 * 1000;
const DERIVATIVE_POLL_MS = 5_000;

function derivativeUrl(
    cloudName: string,
    publicId: string,
    resourceType: 'image' | 'video',
    transformation: string,
    format: string
): string {
    return cloudinary.url(publicId, {
        cloud_name: cloudName,
        secure: true,
        resource_type: resourceType,
        raw_transformation: transformation,
        format,
    });
}

export function reelVideoUrl(cloudName: string, publicId: string): string {
    return derivativeUrl(cloudName, publicId, 'video', REEL_VIDEO_TRANSFORM, 'mp4');
}

export function reelCoverUrl(cloudName: string, publicId: string): string {
    return derivativeUrl(cloudName, publicId, 'video', REEL_COVER_TRANSFORM, 'jpg');
}

export function storyVideoUrl(cloudName: string, publicId: string): string {
    return derivativeUrl(cloudName, publicId, 'video', STORY_VIDEO_TRANSFORM, 'mp4');
}

export function storyImageUrl(cloudName: string, publicId: string): string {
    return derivativeUrl(cloudName, publicId, 'image', STORY_IMAGE_TRANSFORM, 'jpg');
}

export type HeadRequest = (url: string) => Promise<number>;

async function headStatus(url: string): Promise<number> {
    try {
        const response = await fetch(url, {
            method: 'HEAD',
            signal: AbortSignal.timeout(15_000),
        });
        return response.status;
    } catch {
        return 0;
    }
}

/**
 * Waits until Cloudinary serves a derivative. Eager video derivatives are
 * built in the background after upload, and the delivery URL may not return
 * 200 until they finish.
 */
export async function waitForDerivative(
    url: string,
    deadline: Deadline,
    head: HeadRequest = headStatus,
    timeoutMs = DERIVATIVE_WAIT_MS
): Promise<boolean> {
    const ready = await pollUntil<true>(
        async () =>
            (await head(url)) === 200
                ? { done: true, value: true }
                : { done: false },
        { intervalMs: DERIVATIVE_POLL_MS, timeoutMs, deadline }
    );
    return ready === true;
}
