/** Mirrors the backend's REEL_LIMITS in mediaDerivativeService. */
export const REEL_LIMITS = {
    maxBytes: 100 * 1024 * 1024,
    minSeconds: 3,
    maxFacebookSeconds: 90,
    maxInstagramSeconds: 15 * 60,
    storySeconds: 60,
} as const;

const REEL_FILE_TYPES = ['video/mp4', 'video/quicktime'];

export const REEL_ACCEPT = REEL_FILE_TYPES.join(',');

export interface VideoFileInfo {
    duration: number;
    width: number;
    height: number;
}

/**
 * Reads a local video's length and size before upload. Resolves null when the
 * browser cannot decode the file; the server still checks it after upload.
 */
export function readVideoFileInfo(file: File): Promise<VideoFileInfo | null> {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const video = document.createElement('video');
        let settled = false;

        const finish = (info: VideoFileInfo | null) => {
            if (settled) return;
            settled = true;
            URL.revokeObjectURL(url);
            resolve(info);
        };

        video.preload = 'metadata';
        video.muted = true;
        video.onloadedmetadata = () =>
            finish(
                Number.isFinite(video.duration)
                    ? {
                          duration: video.duration,
                          width: video.videoWidth,
                          height: video.videoHeight,
                      }
                    : null
            );
        video.onerror = () => finish(null);
        video.src = url;
    });
}

/** Why a file cannot be uploaded as a reel, or '' when it can. */
export function reelFileProblem(file: File, info: VideoFileInfo | null): string {
    // Some browsers leave file.type empty for MOV files, so check the name too.
    const typeOk =
        REEL_FILE_TYPES.includes(file.type) || /\.(mp4|mov)$/i.test(file.name);
    if (!typeOk) return 'Choose an MP4 or MOV video.';
    if (file.size > REEL_LIMITS.maxBytes) {
        return 'Reels can be at most 100 MB. Compress or trim the video first.';
    }
    if (info && info.duration < REEL_LIMITS.minSeconds) {
        return 'Reels must be at least 3 seconds long.';
    }
    if (info && info.duration > REEL_LIMITS.maxInstagramSeconds) {
        return 'Reels can be at most 15 minutes long.';
    }
    return '';
}

export function isNineBySixteen(width: number, height: number): boolean {
    if (!width || !height) return false;
    return Math.abs(width / height - 9 / 16) < 0.01;
}
