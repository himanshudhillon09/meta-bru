import { v2 as cloudinary } from 'cloudinary';
import { getCloudinaryCredentials } from './credentialService.js';
import { AppError } from '../utils/errors.js';
import type { TextArea } from './textOverlayService.js';

export interface UploadedMedia {
    url: string;
    jpegUrl: string;
    publicId: string;
    width: number;
    height: number;
    format: string;
    bytes: number;
}

/** An uploaded post image plus where its photo sits, for overlay text. */
export interface PostImageMedia extends UploadedMedia {
    textArea: TextArea;
}

function jpegUrlFor(cloudName: string, publicId: string): string {
    return cloudinary.url(publicId, {
        cloud_name: cloudName,
        secure: true,
        format: 'jpg',
        transformation: [{ quality: 'auto:good' }],
    });
}

/**
 * Uploads to the owning user's Cloudinary account. Credentials are passed per
 * call rather than configured globally, so concurrent users cannot cross-use
 * each other's Cloudinary accounts.
 */
export async function uploadImage(
    userId: string,
    buffer: Buffer
): Promise<UploadedMedia> {
    const credentials = await getCloudinaryCredentials(userId);

    return new Promise<UploadedMedia>((resolve, reject) => {
        const upload = cloudinary.uploader.upload_stream(
            {
                cloud_name: credentials.cloudName,
                api_key: credentials.apiKey,
                api_secret: credentials.apiSecret,
                folder: `meta-bru/${userId}`,
                resource_type: 'image',
            },
            (error, result) => {
                if (error || !result) {
                    const status = (error as { http_code?: number } | undefined)?.http_code;
                    reject(
                        new AppError(
                            502,
                            status === 401 || status === 403
                                ? 'Cloudinary rejected your credentials. Check your Cloudinary API key and secret under Profile.'
                                : error?.message || 'Cloudinary upload failed',
                            'MEDIA_UPLOAD_FAILED'
                        )
                    );
                    return;
                }

                resolve({
                    url: result.secure_url,
                    jpegUrl: jpegUrlFor(credentials.cloudName, result.public_id),
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

export { jpegUrlFor };
