import { v2 as cloudinary } from 'cloudinary';
import { env, isCloudinaryConfigured } from '../config/env.js';
import { AppError } from '../utils/errors.js';

if (isCloudinaryConfigured) {
    cloudinary.config({
        cloud_name: env.cloudinary.cloudName,
        api_key: env.cloudinary.apiKey,
        api_secret: env.cloudinary.apiSecret,
        secure: true,
    });
}

export interface UploadedMedia {
    url: string;
    publicId: string;
    width: number;
    height: number;
    format: string;
    bytes: number;
}

function assertConfigured(): void {
    if (!isCloudinaryConfigured) {
        throw new AppError(
            503,
            'Media storage is not configured. Add Cloudinary credentials to the backend environment.',
            'MEDIA_NOT_CONFIGURED'
        );
    }
}

export async function uploadImage(buffer: Buffer): Promise<UploadedMedia> {
    assertConfigured();

    return new Promise<UploadedMedia>((resolve, reject) => {
        const upload = cloudinary.uploader.upload_stream(
            {
                folder: 'meta-bru',
                resource_type: 'image',
            },
            (error, result) => {
                if (error || !result) {
                    reject(
                        new AppError(
                            502,
                            error?.message || 'Cloudinary upload failed',
                            'MEDIA_UPLOAD_FAILED'
                        )
                    );
                    return;
                }

                resolve({
                    url: result.secure_url,
                    publicId: result.public_id,
                    width: result.width ?? 0,
                    height: result.height ?? 0,
                    format: result.format ?? '',
                    bytes: result.bytes ?? 0,
                });
            }
        );

        upload.end(buffer);
    });
}

/**
 * Instagram only accepts JPEG images fetched from a public URL.
 * Cloudinary can transcode on delivery, so we derive a JPEG URL from the
 * stored asset without keeping a second copy.
 */
export function getJpegUrl(publicId: string): string {
    assertConfigured();
    return cloudinary.url(publicId, {
        secure: true,
        format: 'jpg',
        transformation: [{ quality: 'auto:good' }],
    });
}
