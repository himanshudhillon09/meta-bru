import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import sharp from 'sharp';
import { AppError } from '../utils/errors.js';

/**
 * Burns a short, bold, meme-style line into a post image: white words with
 * *starred* words in yellow, centred near the bottom of the photo.
 *
 * Text is drawn as vector outlines from a bundled font. sharp's own text
 * rendering uses the operating system's font stack (CoreText on macOS) and
 * ignores bundled font files there, so outlines are the only way to get the
 * same image on every machine.
 */

export const OVERLAY_MAX_CHARS = 90;
export const OVERLAY_COLORS = { text: '#FFFFFF', highlight: '#FFD60A' } as const;

const FONT_PATH = fileURLToPath(
    new URL('../../assets/fonts/Poppins-ExtraBold.ttf', import.meta.url)
);

const MAX_LINES = 3;
const MAX_WIDTH_SHARE = 0.86;
const MAX_HEIGHT_SHARE = 0.34;
const START_SIZE_SHARE = 0.075;
const MIN_SIZE_SHARE = 0.035;
const LINE_HEIGHT = 1.22;
const BOTTOM_MARGIN_SHARE = 0.07;
const MIN_AREA = 32;

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}︎️‍⃣]/gu;
const UNSUPPORTED_SCRIPT = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;

/** The photo rectangle inside a post image, where the overlay may go. */
export interface TextArea {
    left: number;
    top: number;
    width: number;
    height: number;
    /** Corner radius of the photo box; 0 for unframed images. */
    radius: number;
}

export interface OverlayWord {
    text: string;
    highlight: boolean;
}

interface MeasuredWord extends OverlayWord {
    width: number;
}

export interface OverlayLine {
    words: MeasuredWord[];
    width: number;
}

export interface FittedOverlay {
    size: number;
    lineHeight: number;
    lines: OverlayLine[];
}

let cachedFont: opentype.Font | null = null;

export function loadOverlayFont(): opentype.Font {
    if (!cachedFont) cachedFont = opentype.loadSync(FONT_PATH);
    return cachedFont;
}

/**
 * Normalises a line: no emojis, single spaces, at most OVERLAY_MAX_CHARS
 * (cut at a word where possible), and no unpaired highlight star.
 */
export function cleanOverlayText(raw: string): string {
    let text = raw.replace(EMOJI, '').replace(/\s+/g, ' ').trim();

    if (text.length > OVERLAY_MAX_CHARS) {
        text = text.slice(0, OVERLAY_MAX_CHARS);
        const lastSpace = text.lastIndexOf(' ');
        if (lastSpace > OVERLAY_MAX_CHARS * 0.6) text = text.slice(0, lastSpace);
        text = text.trim();
    }

    if ((text.match(/\*/g) ?? []).length % 2 === 1) {
        const last = text.lastIndexOf('*');
        text = `${text.slice(0, last)}${text.slice(last + 1)}`.replace(/\s+/g, ' ').trim();
    }

    return text;
}

/** Splits a line into words, marking those between *stars* as highlighted. */
export function parseOverlayText(raw: string): OverlayWord[] {
    const text = cleanOverlayText(raw);

    if (UNSUPPORTED_SCRIPT.test(text)) {
        throw new AppError(
            400,
            'Image text supports English letters only. Write Hindi in Roman script (Hinglish).',
            'OVERLAY_SCRIPT_UNSUPPORTED'
        );
    }

    const words: OverlayWord[] = [];
    text.split('*').forEach((segment, index) => {
        for (const word of segment.split(' ')) {
            if (word) words.push({ text: word, highlight: index % 2 === 1 });
        }
    });
    return words;
}

/** Keeps a client-supplied photo area inside the image; falls back to all of it. */
export function clampTextArea(
    area: TextArea | undefined,
    width: number,
    height: number
): TextArea {
    const whole: TextArea = { left: 0, top: 0, width, height, radius: 0 };
    if (!area) return whole;

    const values = [area.left, area.top, area.width, area.height, area.radius];
    if (values.some((value) => !Number.isFinite(value))) return whole;

    const left = Math.max(0, Math.round(area.left));
    const top = Math.max(0, Math.round(area.top));
    if (left >= width || top >= height) return whole;

    const boxWidth = Math.min(Math.round(area.width), width - left);
    const boxHeight = Math.min(Math.round(area.height), height - top);
    if (boxWidth < MIN_AREA || boxHeight < MIN_AREA) return whole;

    return {
        left,
        top,
        width: boxWidth,
        height: boxHeight,
        radius: Math.max(0, Math.min(Math.round(area.radius), Math.floor(Math.min(boxWidth, boxHeight) / 2))),
    };
}

function wrapWords(
    words: OverlayWord[],
    font: opentype.Font,
    size: number,
    maxWidth: number
): OverlayLine[] {
    const space = font.getAdvanceWidth(' ', size);
    const lines: OverlayLine[] = [];
    let current: OverlayLine = { words: [], width: 0 };

    for (const word of words) {
        const measured = { ...word, width: font.getAdvanceWidth(word.text, size) };
        const nextWidth = current.words.length
            ? current.width + space + measured.width
            : measured.width;

        if (current.words.length && nextWidth > maxWidth) {
            lines.push(current);
            current = { words: [measured], width: measured.width };
        } else {
            current.words.push(measured);
            current.width = nextWidth;
        }
    }

    if (current.words.length) lines.push(current);
    return lines;
}

/**
 * Picks the largest font size, from 7.5% of the photo width down to 3.5%,
 * at which the line fits in three lines, 86% of the width, and 34% of the
 * height.
 */
export function fitOverlay(
    words: OverlayWord[],
    font: opentype.Font,
    box: { width: number; height: number }
): FittedOverlay {
    const maxWidth = box.width * MAX_WIDTH_SHARE;
    const maxHeight = box.height * MAX_HEIGHT_SHARE;
    const minSize = Math.max(12, Math.round(box.width * MIN_SIZE_SHARE));
    let size = Math.max(minSize, Math.round(box.width * START_SIZE_SHARE));

    for (;;) {
        const lineHeight = size * LINE_HEIGHT;
        const lines = wrapWords(words, font, size, maxWidth);
        const fits =
            lines.length <= MAX_LINES &&
            lines.every((line) => line.width <= maxWidth) &&
            lines.length * lineHeight <= maxHeight;

        if (fits || size <= minSize) return { size, lineHeight, lines };
        size = Math.max(minSize, Math.floor(size * 0.93));
    }
}

function drawableWords(words: OverlayWord[], font: opentype.Font): OverlayWord[] {
    return words
        .map((word) => ({
            ...word,
            text: [...word.text].filter((char) => font.charToGlyphIndex(char) > 0).join(''),
        }))
        .filter((word) => word.text.length > 0);
}

function overlaySvg(fitted: FittedOverlay, box: TextArea, font: opentype.Font): string {
    const { size, lineHeight, lines } = fitted;
    const ascender = (font.ascender / font.unitsPerEm) * size;
    const descender = (font.descender / font.unitsPerEm) * size;
    const glyphHeight = ascender - descender;
    const space = font.getAdvanceWidth(' ', size);

    const blockTop = box.height - box.height * BOTTOM_MARGIN_SHARE - lines.length * lineHeight;
    const fadeTop = Math.max(0, blockTop - box.height * 0.16);

    const paths: string[] = [];
    lines.forEach((line, index) => {
        const baseline = blockTop + index * lineHeight + (lineHeight - glyphHeight) / 2 + ascender;
        let x = (box.width - line.width) / 2;
        for (const word of line.words) {
            const color = word.highlight ? OVERLAY_COLORS.highlight : OVERLAY_COLORS.text;
            const d = font.getPath(word.text, x, baseline, size).toPathData(2);
            paths.push(`<path d="${d}" fill="${color}"/>`);
            x += word.width + space;
        }
    });

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}">
<defs>
<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#000000" stop-opacity="0"/>
<stop offset="1" stop-color="#000000" stop-opacity="0.78"/>
</linearGradient>
<clipPath id="photo"><rect width="${box.width}" height="${box.height}" rx="${box.radius}" ry="${box.radius}"/></clipPath>
<filter id="shadow" x="-10%" y="-20%" width="120%" height="160%">
<feDropShadow dx="0" dy="${(size * 0.04).toFixed(1)}" stdDeviation="${(size * 0.08).toFixed(1)}" flood-color="#000000" flood-opacity="0.6"/>
</filter>
</defs>
<rect y="${fadeTop.toFixed(1)}" width="${box.width}" height="${(box.height - fadeTop).toFixed(1)}" fill="url(#fade)" clip-path="url(#photo)"/>
<g filter="url(#shadow)">${paths.join('')}</g>
</svg>`;
}

/**
 * Draws the line inside `area` of a post image and returns a JPEG. Returns the
 * input untouched when nothing drawable is left after cleaning.
 */
export async function renderTextOverlay(
    image: Buffer,
    rawText: string,
    area: TextArea | undefined
): Promise<Buffer> {
    const font = loadOverlayFont();
    const words = drawableWords(parseOverlayText(rawText), font);
    if (words.length === 0) return image;

    const meta = await sharp(image).metadata();
    const box = clampTextArea(area, meta.width ?? 0, meta.height ?? 0);
    const fitted = fitOverlay(words, font, box);

    return sharp(image)
        .composite([
            {
                input: Buffer.from(overlaySvg(fitted, box, font)),
                left: box.left,
                top: box.top,
            },
        ])
        .jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: '4:4:4' })
        .toBuffer();
}
