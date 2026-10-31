import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { v2 as cloudinary } from 'cloudinary';
import { AppError } from '../utils/errors.js';
import { credentialsOptions, userFolder } from './cloudinaryStorageService.js';
import type { CloudinaryCredentials } from './credentialService.js';
import { REEL_EAGER } from './mediaDerivativeService.js';
import { loadReelVideo, type VideoMedia } from './videoUploadService.js';

/**
 * Photo reels: neither Facebook nor Instagram accepts sound on a photo, so an
 * image post with music is published as a short video of the image.
 */

export const PHOTO_REEL_SECONDS = { min: 5, max: 60, default: 15 } as const;

const run = promisify(execFile);
// ffmpeg-static is CommonJS; its typings do not match an ESM default import.
const ffmpegStatic = createRequire(import.meta.url)('ffmpeg-static') as string | null;
const FAILED_MESSAGE = 'Could not turn this image into a video. Try again, or post it without music.';

export function photoReelSeconds(value: number | undefined): number {
    const seconds = Math.round(value ?? PHOTO_REEL_SECONDS.default);
    return Math.min(Math.max(seconds, PHOTO_REEL_SECONDS.min), PHOTO_REEL_SECONDS.max);
}

/**
 * Renders a still image into an H.264/AAC MP4 with a silent stereo track, so
 * Cloudinary has an audio stream to mix music into. The reel derivative pads
 * it to 9:16 later, the same way it pads uploaded videos.
 */
export async function renderPhotoReelFile(
    image: Buffer,
    seconds: number,
    ffmpegPath: string | null = ffmpegStatic
): Promise<Buffer> {
    if (!ffmpegPath) throw new Error('ffmpeg is not available on this server');

    const dir = await mkdtemp(path.join(tmpdir(), 'photo-reel-'));
    try {
        const input = path.join(dir, 'image');
        const output = path.join(dir, 'reel.mp4');
        await writeFile(input, image);
        await run(
            ffmpegPath,
            [
                '-y',
                '-loop', '1',
                '-framerate', '30',
                '-i', input,
                '-f', 'lavfi',
                '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
                '-t', String(seconds),
                // Even dimensions, at most 1080 wide, in a pixel format every player reads.
                '-vf', "scale='min(1080,iw)':-2,format=yuv420p",
                '-c:v', 'libx264',
                '-preset', 'veryfast',
                '-tune', 'stillimage',
                '-c:a', 'aac',
                '-b:a', '128k',
                '-shortest',
                '-movflags', '+faststart',
                output,
            ],
            { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }
        );
        return await readFile(output);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

async function downloadImage(url: string): Promise<Buffer> {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Image download failed with status ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}

function uploadVideo(
    credentials: CloudinaryCredentials,
    userId: string,
    file: Buffer
): Promise<string> {
    return new Promise((resolve, reject) => {
        const upload = cloudinary.uploader.upload_stream(
            {
                ...credentialsOptions(credentials),
                folder: userFolder(userId),
                resource_type: 'video',
                eager: REEL_EAGER,
                eager_async: true,
            },
            (error, result) => {
                if (error || !result?.public_id) {
                    reject(error ?? new Error('Cloudinary did not return the video'));
                    return;
                }
                resolve(result.public_id);
            }
        );
        upload.end(file);
    });
}

/**
 * Makes a photo reel from one of the user's post images and stores it in
 * their Cloudinary folder with the usual reel derivatives.
 */
export async function createPhotoReel(
    userId: string,
    imageUrl: string,
    seconds: number,
    credentials: CloudinaryCredentials
): Promise<VideoMedia> {
    let publicId: string;
    try {
        const file = await renderPhotoReelFile(await downloadImage(imageUrl), seconds);
        publicId = await uploadVideo(credentials, userId, file);
    } catch (error) {
        console.error(`[music] Photo reel failed for ${imageUrl}:`, error);
        throw new AppError(502, FAILED_MESSAGE, 'PHOTO_REEL_FAILED');
    }

    return loadReelVideo(userId, publicId, credentials, { deleteIfRejected: true });
}
