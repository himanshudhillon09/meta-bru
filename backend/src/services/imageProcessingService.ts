import sharp, { type Sharp } from 'sharp';
import { AppError } from '../utils/errors.js';

/**
 * Instagram feed posts must be between 4:5 (tallest) and 1.91:1 (widest), and
 * Facebook shows the same range without cropping. Every post image is rendered
 * 1080px wide with a height inside that range before it reaches Cloudinary.
 */
export const POST_WIDTH = 1080;
export const MIN_POST_HEIGHT = Math.ceil(POST_WIDTH / 1.91);
export const MAX_POST_HEIGHT = Math.round(POST_WIDTH / 0.8);

/**
 * A photo within 12% of the target shape is cropped (attention-weighted) to
 * fill it. Anything further off is shown whole, so subjects are never cut off.
 */
export const MAX_COVER_CROP = 0.12;

const MAX_WORKING_EDGE = 2160;
const LOGO_MAX_EDGE = 640;
const LOGO_MIN_EDGE = 48;

export interface RawImage {
    data: Buffer;
    width: number;
    height: number;
    channels: 1 | 2 | 3 | 4;
}

export interface RenderedPostImage {
    buffer: Buffer;
    width: number;
    height: number;
    framed: boolean;
}

export interface PreparedLogo {
    data: Buffer;
    width: number;
    height: number;
}

export interface FrameLayout {
    width: number;
    height: number;
    scale: number;
    margin: number;
    band: number;
    radius: number;
    hairlineInset: number;
    maxPhotoWidth: number;
    maxPhotoHeight: number;
}

interface Rect {
    left: number;
    top: number;
    width: number;
    height: number;
}

interface FramePalette {
    start: string;
    end: string;
    accent: string;
    accentOpacity: number;
    glowOpacity: number;
    shadowOpacity: number;
}

function fromRaw(image: RawImage): Sharp {
    return sharp(image.data, {
        raw: {
            width: image.width,
            height: image.height,
            channels: image.channels,
        },
    });
}

async function toRaw(pipeline: Sharp): Promise<RawImage> {
    const { data, info } = await pipeline
        .raw()
        .toBuffer({ resolveWithObject: true });
    return {
        data,
        width: info.width,
        height: info.height,
        channels: info.channels as RawImage['channels'],
    };
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export function cropFraction(sourceRatio: number, targetRatio: number): number {
    return 1 - Math.min(sourceRatio / targetRatio, targetRatio / sourceRatio);
}

function clampPostHeight(height: number): number {
    return clamp(Math.round(height), MIN_POST_HEIGHT, MAX_POST_HEIGHT);
}

/** Feed size for an unframed photo: its own shape, clamped to 4:5–1.91:1. */
export function plainPostSize(
    width: number,
    height: number
): { width: number; height: number } {
    return {
        width: POST_WIDTH,
        height: clampPostHeight((POST_WIDTH * height) / width),
    };
}

/**
 * Frame metrics are derived from the fixed post width, so the border, logo
 * band, and logo spacing are identical on every post. The canvas height follows
 * the photo so it fills the frame without cropping, within the feed limits.
 */
export function frameLayout(width: number, height: number): FrameLayout {
    const scale = POST_WIDTH;
    const margin = Math.round(scale * 0.045);
    const band = Math.round(scale * 0.14);
    const maxPhotoWidth = POST_WIDTH - margin * 2;
    const canvasHeight = clampPostHeight(
        margin + (maxPhotoWidth * height) / width + band
    );

    return {
        width: POST_WIDTH,
        height: canvasHeight,
        scale,
        margin,
        band,
        radius: Math.round(scale * 0.022),
        hairlineInset: Math.round(margin * 0.42),
        maxPhotoWidth,
        maxPhotoHeight: canvasHeight - margin - band,
    };
}

/** Fits a width/height inside a box without changing its shape. */
function containSize(
    width: number,
    height: number,
    boxWidth: number,
    boxHeight: number
): { width: number; height: number } {
    const scale = Math.min(boxWidth / width, boxHeight / height);
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
}

/**
 * The logo sits between the photo and the inset hairline, so the gap around it
 * matches the gap between the photo and the hairline on the other sides.
 */
function logoBandSpace(layout: FrameLayout): number {
    return layout.band - layout.hairlineInset;
}

/** Logos are sized by shape so square marks and wide wordmarks look balanced. */
export function logoSize(
    width: number,
    height: number,
    layout: FrameLayout
): { width: number; height: number } {
    const ratio = width / height;
    const space = logoBandSpace(layout);
    let logoHeight = clamp(
        (space * 0.6) / Math.pow(ratio, 0.2),
        space * 0.36,
        space * 0.6
    );
    let logoWidth = logoHeight * ratio;
    const maxWidth = layout.width * 0.42;

    if (logoWidth > maxWidth) {
        logoWidth = maxWidth;
        logoHeight = logoWidth / ratio;
    }

    return {
        width: Math.max(1, Math.round(logoWidth)),
        height: Math.max(1, Math.round(logoHeight)),
    };
}

function srgbToLinear(channel: number): number {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(r: number, g: number, b: number): number {
    return (
        0.2126 * srgbToLinear(r) +
        0.7152 * srgbToLinear(g) +
        0.0722 * srgbToLinear(b)
    );
}

function contrastRatio(a: number, b: number): number {
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function hslToRgb(
    hue: number,
    saturation: number,
    lightness: number
): { r: number; g: number; b: number } {
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const segment = hue / 60;
    const x = chroma * (1 - Math.abs((segment % 2) - 1));
    const [r1, g1, b1] =
        segment < 1
            ? [chroma, x, 0]
            : segment < 2
              ? [x, chroma, 0]
              : segment < 3
                ? [0, chroma, x]
                : segment < 4
                  ? [0, x, chroma]
                  : segment < 5
                    ? [x, 0, chroma]
                    : [chroma, 0, x];
    const m = lightness - chroma / 2;

    return {
        r: Math.round((r1 + m) * 255),
        g: Math.round((g1 + m) * 255),
        b: Math.round((b1 + m) * 255),
    };
}

function hex({ r, g, b }: { r: number; g: number; b: number }): string {
    return `#${[r, g, b]
        .map((value) => clamp(value, 0, 255).toString(16).padStart(2, '0'))
        .join('')}`;
}

/**
 * Hue plus a chroma-based saturation. HSL saturation is unstable near white
 * and black, so a near-white photo would otherwise produce a loud frame.
 */
function hueAndChroma(color: { r: number; g: number; b: number }): {
    hue: number;
    chroma: number;
} {
    const r = color.r / 255;
    const g = color.g / 255;
    const b = color.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;

    if (chroma === 0) return { hue: 0, chroma: 0 };

    let hue =
        max === r
            ? ((g - b) / chroma) % 6
            : max === g
              ? (b - r) / chroma + 2
              : (r - g) / chroma + 4;
    hue *= 60;
    if (hue < 0) hue += 360;

    return { hue, chroma };
}

/**
 * The frame takes its hue from the photo, and its tone (light or dark) from
 * whichever gives the logo more contrast, so the logo always stays legible.
 */
export function framePalette(
    dominant: { r: number; g: number; b: number },
    logoLuminance: number
): FramePalette & { tone: 'light' | 'dark' } {
    const { hue, chroma } = hueAndChroma(dominant);
    const saturation = Math.min(0.55, chroma * 1.6);

    const darkMid = hslToRgb(hue, saturation, 0.17);
    const lightMid = hslToRgb(hue, Math.min(saturation, 0.42), 0.92);
    const darkContrast = contrastRatio(
        logoLuminance,
        relativeLuminance(darkMid.r, darkMid.g, darkMid.b)
    );
    const lightContrast = contrastRatio(
        logoLuminance,
        relativeLuminance(lightMid.r, lightMid.g, lightMid.b)
    );

    if (lightContrast > darkContrast) {
        return {
            tone: 'light',
            start: hex(hslToRgb(hue, Math.min(saturation, 0.4), 0.97)),
            end: hex(hslToRgb(hue, Math.min(saturation, 0.45), 0.87)),
            accent: hex(hslToRgb(hue, Math.min(saturation, 0.5), 0.3)),
            accentOpacity: 0.35,
            glowOpacity: 0.55,
            shadowOpacity: 0.22,
        };
    }

    return {
        tone: 'dark',
        start: hex(hslToRgb(hue, saturation, 0.24)),
        end: hex(hslToRgb(hue, Math.min(saturation * 1.1, 0.6), 0.1)),
        accent: hex(hslToRgb(hue, Math.min(saturation, 0.6), 0.78)),
        accentOpacity: 0.5,
        glowOpacity: 0.1,
        shadowOpacity: 0.5,
    };
}

/** Alpha-weighted average luminance of the visible logo pixels. */
export async function logoLuminance(logo: Buffer): Promise<number> {
    const raw = await toRaw(
        sharp(logo)
            .resize(128, 128, { fit: 'inside' })
            .toColourspace('srgb')
            .ensureAlpha()
    );

    let sum = 0;
    let weight = 0;
    for (let index = 0; index < raw.data.length; index += raw.channels) {
        const alpha = (raw.data[index + 3] ?? 255) / 255;
        if (alpha < 0.05) continue;
        sum +=
            relativeLuminance(
                raw.data[index] ?? 0,
                raw.data[index + 1] ?? 0,
                raw.data[index + 2] ?? 0
            ) * alpha;
        weight += alpha;
    }

    return weight > 0 ? sum / weight : 1;
}

function roundedRectSvg(width: number, height: number, radius: number): Buffer {
    return Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
            `<rect width="${width}" height="${height}" rx="${radius}" ry="${radius}"/>` +
            '</svg>'
    );
}

async function roundCorners(
    image: Sharp,
    width: number,
    height: number,
    radius: number
): Promise<Buffer> {
    const flat = await image.ensureAlpha().png().toBuffer();
    return sharp(flat)
        .composite([
            { input: roundedRectSvg(width, height, radius), blend: 'dest-in' },
        ])
        .png()
        .toBuffer();
}

/**
 * Decodes an upload into an upright, opaque sRGB working image. Very large
 * photos are reduced first so processing memory stays bounded.
 */
export async function loadPhoto(input: Buffer): Promise<RawImage> {
    try {
        return await toRaw(
            sharp(input, { failOn: 'error' })
                .rotate()
                .resize(MAX_WORKING_EDGE, MAX_WORKING_EDGE, {
                    fit: 'inside',
                    withoutEnlargement: true,
                })
                .flatten({ background: '#ffffff' })
                .toColourspace('srgb')
        );
    } catch {
        throw new AppError(
            400,
            'This image could not be read. Upload a valid JPEG, PNG, or WebP file.',
            'INVALID_IMAGE'
        );
    }
}

/**
 * Fills a box with the photo. Close shapes are cropped toward the most
 * interesting region; distant shapes are shown whole over a soft, blurred copy
 * of themselves so there is neither zoom nor empty bars.
 */
async function fillBox(
    photo: RawImage,
    width: number,
    height: number
): Promise<Buffer> {
    if (cropFraction(photo.width / photo.height, width / height) <= MAX_COVER_CROP) {
        return fromRaw(photo)
            .resize(width, height, { fit: 'cover', position: 'attention' })
            .png()
            .toBuffer();
    }

    // Blurring a small copy and scaling it up is far cheaper than a large
    // blur radius at full size. Sharp allows one resize per pipeline.
    const smallBackdrop = await fromRaw(photo)
        .resize(
            Math.max(8, Math.round(width / 12)),
            Math.max(8, Math.round(height / 12)),
            { fit: 'cover' }
        )
        .blur(2.5)
        .modulate({ brightness: 0.62, saturation: 1.1 })
        .png()
        .toBuffer();
    const backdrop = await sharp(smallBackdrop)
        .resize(width, height, { kernel: 'cubic' })
        .png()
        .toBuffer();

    const size = containSize(photo.width, photo.height, width, height);
    const foreground = await fromRaw(photo)
        .resize(size.width, size.height)
        .png()
        .toBuffer();

    return sharp(backdrop)
        .composite([
            {
                input: foreground,
                left: Math.round((width - size.width) / 2),
                top: Math.round((height - size.height) / 2),
            },
        ])
        .png()
        .toBuffer();
}

function ornamentsSvg(
    layout: FrameLayout,
    palette: FramePalette,
    logoRect: Rect
): string {
    const length = Math.round(layout.scale * 0.07);
    const gap = Math.round(layout.scale * 0.028);
    const stroke = Math.max(1.5, layout.scale * 0.0016);
    const dot = Math.max(2, layout.scale * 0.0028);
    const y = logoRect.top + logoRect.height / 2;
    const leftEnd = logoRect.left - gap;
    const rightStart = logoRect.left + logoRect.width + gap;

    return [
        `<line x1="${leftEnd - length}" y1="${y}" x2="${leftEnd}" y2="${y}" stroke="${palette.accent}" stroke-opacity="${palette.accentOpacity}" stroke-width="${stroke}" stroke-linecap="round"/>`,
        `<line x1="${rightStart}" y1="${y}" x2="${rightStart + length}" y2="${y}" stroke="${palette.accent}" stroke-opacity="${palette.accentOpacity}" stroke-width="${stroke}" stroke-linecap="round"/>`,
        `<circle cx="${leftEnd - length - dot * 2.5}" cy="${y}" r="${dot}" fill="${palette.accent}" fill-opacity="${palette.accentOpacity}"/>`,
        `<circle cx="${rightStart + length + dot * 2.5}" cy="${y}" r="${dot}" fill="${palette.accent}" fill-opacity="${palette.accentOpacity}"/>`,
    ].join('');
}

function frameSvg(
    layout: FrameLayout,
    palette: FramePalette,
    photoRect: Rect,
    logoRect: Rect
): Buffer {
    const { width, height } = layout;
    const inset = layout.hairlineInset;
    const stroke = Math.max(1.5, layout.scale * 0.0016);
    const shadowBlur = Math.round(layout.scale * 0.014);
    const shadowOffset = Math.round(layout.scale * 0.008);

    return Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
            '<defs>' +
            `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette.start}"/><stop offset="1" stop-color="${palette.end}"/></linearGradient>` +
            `<radialGradient id="glow" cx="0.18" cy="0.06" r="0.9"><stop offset="0" stop-color="#ffffff" stop-opacity="${palette.glowOpacity}"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>` +
            `<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${shadowBlur}"/></filter>` +
            '</defs>' +
            `<rect width="${width}" height="${height}" fill="url(#bg)"/>` +
            `<rect width="${width}" height="${height}" fill="url(#glow)"/>` +
            `<rect x="${inset}" y="${inset}" width="${width - inset * 2}" height="${height - inset * 2}" rx="${Math.round(layout.radius * 1.4)}" fill="none" stroke="${palette.accent}" stroke-opacity="${palette.accentOpacity}" stroke-width="${stroke}"/>` +
            `<rect x="${photoRect.left}" y="${photoRect.top + shadowOffset}" width="${photoRect.width}" height="${photoRect.height}" rx="${layout.radius}" fill="#000000" fill-opacity="${palette.shadowOpacity}" filter="url(#shadow)"/>` +
            ornamentsSvg(layout, palette, logoRect) +
            '</svg>'
    );
}

async function renderFramed(photo: RawImage, logo: Buffer): Promise<RenderedPostImage> {
    const layout = frameLayout(photo.width, photo.height);

    const photoSize =
        cropFraction(
            photo.width / photo.height,
            layout.maxPhotoWidth / layout.maxPhotoHeight
        ) <= MAX_COVER_CROP
            ? { width: layout.maxPhotoWidth, height: layout.maxPhotoHeight }
            : containSize(
                  photo.width,
                  photo.height,
                  layout.maxPhotoWidth,
                  layout.maxPhotoHeight
              );

    // When the photo is shown whole, the photo and logo band move together so
    // the gap between them stays the same on every post.
    const slack = layout.maxPhotoHeight - photoSize.height;
    const photoRect: Rect = {
        left: Math.round((layout.width - photoSize.width) / 2),
        top: layout.margin + Math.round(slack / 2),
        width: photoSize.width,
        height: photoSize.height,
    };

    const logoMeta = await sharp(logo).metadata();
    const logoDims = logoSize(logoMeta.width ?? 1, logoMeta.height ?? 1, layout);
    const bandTop = photoRect.top + photoRect.height;
    const logoRect: Rect = {
        left: Math.round((layout.width - logoDims.width) / 2),
        top: Math.round(bandTop + (logoBandSpace(layout) - logoDims.height) / 2),
        width: logoDims.width,
        height: logoDims.height,
    };

    const [{ dominant }, luminance] = await Promise.all([
        fromRaw(photo).stats(),
        logoLuminance(logo),
    ]);
    const palette = framePalette(dominant, luminance);

    const photoLayer = await roundCorners(
        sharp(await fillBox(photo, photoRect.width, photoRect.height)),
        photoRect.width,
        photoRect.height,
        layout.radius
    );

    const logoLayer = await sharp(logo)
        .resize(logoRect.width, logoRect.height, { fit: 'fill' })
        .png()
        .toBuffer();

    const buffer = await sharp(frameSvg(layout, palette, photoRect, logoRect))
        .composite([
            { input: photoLayer, left: photoRect.left, top: photoRect.top },
            { input: logoLayer, left: logoRect.left, top: logoRect.top },
        ])
        .flatten({ background: palette.end })
        .jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: '4:4:4' })
        .toBuffer();

    return {
        buffer,
        width: layout.width,
        height: layout.height,
        framed: true,
    };
}

async function renderPlain(photo: RawImage): Promise<RenderedPostImage> {
    const size = plainPostSize(photo.width, photo.height);
    const buffer = await sharp(await fillBox(photo, size.width, size.height))
        .jpeg({ quality: 90, mozjpeg: true })
        .toBuffer();

    return { buffer, ...size, framed: false };
}

/**
 * Renders an upload as a feed-ready JPEG. With a logo, the photo is placed in
 * a branded frame with the logo in the bottom band; without one, the photo is
 * only resized to fit Instagram/Facebook feed limits.
 */
export async function renderPostImage(
    input: Buffer,
    logo: Buffer | null
): Promise<RenderedPostImage> {
    const photo = await loadPhoto(input);
    return logo ? renderFramed(photo, logo) : renderPlain(photo);
}

/**
 * Normalises an uploaded logo: upright, transparent padding trimmed so its
 * spacing in the frame is exact, and capped in size before it is stored.
 */
export async function prepareLogo(input: Buffer): Promise<PreparedLogo> {
    let upright: Buffer;
    try {
        upright = await sharp(input, { failOn: 'error' })
            .rotate()
            .toColourspace('srgb')
            .ensureAlpha()
            .png()
            .toBuffer();
    } catch {
        throw new AppError(
            400,
            'This logo could not be read. Upload a valid PNG, JPEG, or WebP file.',
            'INVALID_IMAGE'
        );
    }

    // Decided before trimming: a logo with a transparent background can trim
    // down to a solid shape, which must not be mistaken for a JPEG badge.
    const isBadge = (await sharp(upright).stats()).isOpaque;

    let trimmed = upright;
    try {
        trimmed = await sharp(upright).trim({ threshold: 12 }).png().toBuffer();
    } catch {
        // A uniform image cannot be trimmed; the visibility check below
        // decides whether it is usable.
    }

    const [trimmedMeta, trimmedStats] = await Promise.all([
        sharp(trimmed).metadata(),
        sharp(trimmed).stats(),
    ]);
    const alpha = trimmedStats.channels[3];
    if (alpha && alpha.max === 0) {
        throw new AppError(400, 'This logo is fully transparent.', 'INVALID_LOGO');
    }

    const artworkWidth = trimmedMeta.width ?? 0;
    const artworkHeight = trimmedMeta.height ?? 0;
    if (Math.max(artworkWidth, artworkHeight) < LOGO_MIN_EDGE) {
        throw new AppError(
            400,
            `This logo is too small. Upload one at least ${LOGO_MIN_EDGE}px wide or tall (400px or more looks best).`,
            'LOGO_TOO_SMALL'
        );
    }

    if (isBadge) {
        // Trimming takes an opaque logo (for example a JPEG on white) right to
        // its artwork. Give it an even margin in its own background colour and
        // rounded corners so it reads as a neat badge, not cropped text.
        const [r = 255, g = 255, b = 255] = await sharp(upright)
            .extract({ left: 0, top: 0, width: 1, height: 1 })
            .removeAlpha()
            .raw()
            .toBuffer();
        const pad = Math.round(Math.min(artworkWidth, artworkHeight) * 0.22);
        const padded = sharp(trimmed).extend({
            top: pad,
            bottom: pad,
            left: pad,
            right: pad,
            background: { r, g, b, alpha: 1 },
        });
        const badgeWidth = artworkWidth + pad * 2;
        const badgeHeight = artworkHeight + pad * 2;
        trimmed = await roundCorners(
            padded,
            badgeWidth,
            badgeHeight,
            Math.round(Math.min(badgeWidth, badgeHeight) * 0.14)
        );
    }

    const { data, info } = await sharp(trimmed)
        .resize(LOGO_MAX_EDGE, LOGO_MAX_EDGE, {
            fit: 'inside',
            withoutEnlargement: true,
        })
        .png({ compressionLevel: 9 })
        .toBuffer({ resolveWithObject: true });

    return { data, width: info.width, height: info.height };
}
