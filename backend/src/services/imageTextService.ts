import { v2 as cloudinary } from 'cloudinary';
import sharp from 'sharp';
import { AppError } from '../utils/errors.js';
import { pageLogo } from './brandLogoService.js';
import { uploadImage, type UploadedMedia } from './cloudinaryService.js';
import { getCloudinaryCredentials } from './credentialService.js';
import { renderCaptionedFrame } from './imageProcessingService.js';
import {
    clampTextArea,
    drawableOverlayWords,
    renderTextOverlay,
    type TextArea,
} from './textOverlayService.js';

const PUBLIC_ID = /^[\w\-.]+(?:\/[\w\-.]+)*$/;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const PREVIEW_WIDTH = 720;

export type ImageFetcher = (url: string) => Promise<Buffer>;

export interface ApplyImageTextDeps {
    fetchImage: ImageFetcher;
    upload: (userId: string, buffer: Buffer) => Promise<UploadedMedia>;
}

/** A Cloudinary public id: path segments of word characters, no `..`. */
export function isSafePublicId(publicId: string): boolean {
    return (
        publicId.length <= 300 &&
        PUBLIC_ID.test(publicId) &&
        !publicId.split('/').some((segment) => segment === '..' || segment === '.')
    );
}

async function fetchImage(url: string): Promise<Buffer> {
    let response: Response;
    try {
        response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    } catch {
        throw new AppError(502, 'Could not load the image from Cloudinary.', 'MEDIA_FETCH_FAILED');
    }

    if (response.status === 404) {
        throw new AppError(
            400,
            'This image is no longer in your Cloudinary account. Upload it again.',
            'MEDIA_NOT_FOUND'
        );
    }
    if (!response.ok) {
        throw new AppError(
            502,
            `Cloudinary returned ${response.status} for the image.`,
            'MEDIA_FETCH_FAILED'
        );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES) {
        throw new AppError(400, 'The image is too large to add text to.', 'MEDIA_TOO_LARGE');
    }
    return buffer;
}

/**
 * Loads one of the user's post images. The URL is always built from their own
 * cloud name and the public id, never taken from the client.
 */
async function loadPostImage(
    userId: string,
    publicId: string,
    fetcher: ImageFetcher
): Promise<Buffer> {
    if (!isSafePublicId(publicId)) {
        throw new AppError(400, 'This image cannot be used.', 'INVALID_MEDIA');
    }

    const { cloudName } = await getCloudinaryCredentials(userId);
    return fetcher(cloudinary.url(publicId, { cloud_name: cloudName, secure: true }));
}

/**
 * Adds the text to a post image. A photo framed with the Page's logo gets the
 * text as a caption in the frame's border, under the photo; an unframed image
 * gets it across the bottom of the photo.
 */
async function renderImageText(
    userId: string,
    image: Buffer,
    text: string,
    area: TextArea | undefined,
    connectionId: string
): Promise<Buffer> {
    const meta = await sharp(image).metadata();
    const photo = clampTextArea(area, meta.width ?? 0, meta.height ?? 0);
    // Only framed photos have rounded corners and a border to hold the caption.
    const logo = photo.radius > 0 && connectionId ? await pageLogo(userId, connectionId) : null;
    if (!logo) return renderTextOverlay(image, text, area);

    const words = drawableOverlayWords(text);
    if (words.length === 0) return image;
    return (await renderCaptionedFrame(image, photo, logo, words)).buffer;
}

/** Renders the text on the image and returns a smaller JPEG data URL; nothing is uploaded. */
export async function previewImageText(
    userId: string,
    publicId: string,
    text: string,
    area: TextArea | undefined,
    connectionId = '',
    fetcher: ImageFetcher = fetchImage
): Promise<string> {
    const image = await loadPostImage(userId, publicId, fetcher);
    const rendered = await renderImageText(userId, image, text, area, connectionId);
    const preview = await sharp(rendered)
        .resize({ width: PREVIEW_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer();

    return `data:image/jpeg;base64,${preview.toString('base64')}`;
}

/** Renders the text on the image and uploads the result as a new post image. */
export async function applyImageText(
    userId: string,
    publicId: string,
    text: string,
    area: TextArea | undefined,
    connectionId = '',
    deps: ApplyImageTextDeps = { fetchImage, upload: uploadImage }
): Promise<UploadedMedia> {
    const image = await loadPostImage(userId, publicId, deps.fetchImage);
    const rendered = await renderImageText(userId, image, text, area, connectionId);
    return deps.upload(userId, rendered);
}
