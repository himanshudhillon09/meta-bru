import sharp from 'sharp';
import { SocialConnection } from '../models/socialConnectionModel.js';
import { AppError } from '../utils/errors.js';
import {
    prepareLogo,
    renderPostImage,
    type RenderedPostImage,
} from './imageProcessingService.js';

export interface BrandLogoSummary {
    dataUrl: string;
    width: number;
    height: number;
    bytes: number;
    updatedAt: string;
}

export interface BrandFramePreview {
    label: string;
    dataUrl: string;
    width: number;
    height: number;
}

export interface BrandLogoDetails {
    logo: BrandLogoSummary | null;
    previews: BrandFramePreview[];
}

interface StoredLogo {
    data: Buffer;
    width: number;
    height: number;
    bytes: number;
    updatedAt: Date;
}

/** The user's own Page; another user's Page is reported as not found. */
async function findOwnedPage(userId: string, connectionId: string, withLogo = false) {
    if (!/^[a-f\d]{24}$/i.test(connectionId)) {
        throw new AppError(400, 'Invalid connection ID', 'INVALID_ID');
    }
    const query = SocialConnection.findOne({ _id: connectionId, userId });
    const page = await (withLogo ? query.select('+brandLogo.data') : query);
    if (!page) {
        throw new AppError(404, 'Connection not found', 'CONNECTION_NOT_FOUND');
    }
    return page;
}

async function readStoredLogo(userId: string, connectionId: string): Promise<StoredLogo | null> {
    const page = await findOwnedPage(userId, connectionId, true);
    const logo = page.brandLogo;
    if (!logo?.data || logo.data.length === 0 || !logo.updatedAt) return null;

    return {
        data: Buffer.from(logo.data),
        width: logo.width ?? 0,
        height: logo.height ?? 0,
        bytes: logo.bytes ?? logo.data.length,
        updatedAt: logo.updatedAt,
    };
}

/** A simple illustrated scene, so previews show the frame on a real-looking photo. */
function sampleScene(
    width: number,
    height: number,
    colors: { skyTop: string; skyBottom: string; sun: string; far: string; near: string }
): Buffer {
    return Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
            `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${colors.skyTop}"/><stop offset="1" stop-color="${colors.skyBottom}"/></linearGradient></defs>` +
            `<rect width="${width}" height="${height}" fill="url(#sky)"/>` +
            `<circle cx="${width * 0.66}" cy="${height * 0.42}" r="${Math.min(width, height) * 0.12}" fill="${colors.sun}"/>` +
            `<path d="M0 ${height * 0.7} Q ${width * 0.3} ${height * 0.55} ${width * 0.6} ${height * 0.7} T ${width} ${height * 0.66} V ${height} H 0 Z" fill="${colors.far}"/>` +
            `<path d="M0 ${height * 0.82} Q ${width * 0.4} ${height * 0.7} ${width} ${height * 0.85} V ${height} H 0 Z" fill="${colors.near}"/>` +
            '</svg>'
    );
}

const PREVIEW_SAMPLES = [
    {
        label: 'Portrait photo',
        scene: () =>
            sampleScene(1200, 1500, {
                skyTop: '#ff9a5a',
                skyBottom: '#ffd6a5',
                sun: '#ffe08a',
                far: '#2a9d8f',
                near: '#123d3a',
            }),
    },
    {
        label: 'Landscape photo',
        scene: () =>
            sampleScene(1500, 1000, {
                skyTop: '#3a5bd9',
                skyBottom: '#a2d2ff',
                sun: '#ffd27a',
                far: '#4f7cff',
                near: '#1b2a4a',
            }),
    },
];

async function renderPreviews(logo: Buffer): Promise<BrandFramePreview[]> {
    return Promise.all(
        PREVIEW_SAMPLES.map(async (sample) => {
            const scene = await sharp(sample.scene()).png().toBuffer();
            const rendered = await renderPostImage(scene, logo);
            const small = await sharp(rendered.buffer)
                .resize(540)
                .jpeg({ quality: 82, mozjpeg: true })
                .toBuffer();

            return {
                label: sample.label,
                dataUrl: `data:image/jpeg;base64,${small.toString('base64')}`,
                width: rendered.width,
                height: rendered.height,
            };
        })
    );
}

function summary(logo: StoredLogo): BrandLogoSummary {
    return {
        dataUrl: `data:image/png;base64,${logo.data.toString('base64')}`,
        width: logo.width,
        height: logo.height,
        bytes: logo.bytes,
        updatedAt: logo.updatedAt.toISOString(),
    };
}

/** A small square version of the logo for Page avatars and lists. */
export async function logoThumbDataUrl(logo: Buffer): Promise<string> {
    const thumb = await sharp(logo)
        .resize(96, 96, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
    return `data:image/png;base64,${thumb.toString('base64')}`;
}

export async function getBrandLogoDetails(
    userId: string,
    connectionId: string
): Promise<BrandLogoDetails> {
    const logo = await readStoredLogo(userId, connectionId);
    if (!logo) return { logo: null, previews: [] };

    return { logo: summary(logo), previews: await renderPreviews(logo.data) };
}

export async function saveBrandLogo(
    userId: string,
    connectionId: string,
    input: Buffer
): Promise<BrandLogoDetails & { thumb: string }> {
    await findOwnedPage(userId, connectionId);
    const prepared = await prepareLogo(input);
    const stored: StoredLogo = {
        data: prepared.data,
        width: prepared.width,
        height: prepared.height,
        bytes: prepared.data.length,
        updatedAt: new Date(),
    };
    const thumb = await logoThumbDataUrl(stored.data);

    await SocialConnection.updateOne(
        { _id: connectionId, userId },
        { $set: { brandLogo: { ...stored, thumb } } }
    );

    return { logo: summary(stored), previews: await renderPreviews(stored.data), thumb };
}

export async function removeBrandLogo(userId: string, connectionId: string): Promise<void> {
    await findOwnedPage(userId, connectionId);
    await SocialConnection.updateOne({ _id: connectionId, userId }, { $unset: { brandLogo: 1 } });
}

/**
 * Turns any post image (upload or AI) into a feed-ready JPEG for one of the
 * user's Pages: framed with that Page's logo when it has one, otherwise only
 * resized. Without a Page the image is only resized. The result also says
 * where the photo sits, for overlay text.
 */
export async function preparePostImage(
    userId: string,
    connectionId: string | null,
    input: Buffer
): Promise<RenderedPostImage & { framedFor: string }> {
    const logo = connectionId ? await readStoredLogo(userId, connectionId) : null;
    const image = await renderPostImage(input, logo?.data ?? null);
    // The Page whose logo framed it; empty when no logo was used.
    return { ...image, framedFor: logo?.data && connectionId ? connectionId : '' };
}
