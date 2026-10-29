import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import type { AppError } from '../utils/errors.js';

import {
    OVERLAY_MAX_CHARS,
    cleanOverlayText,
    clampTextArea,
    fitOverlay,
    loadOverlayFont,
    parseOverlayText,
    renderTextOverlay,
} from './textOverlayService.js';

async function solid(width: number, height: number, color: string): Promise<Buffer> {
    return sharp({ create: { width, height, channels: 3, background: color } })
        .jpeg()
        .toBuffer();
}

async function regionMean(
    image: Buffer,
    region: { left: number; top: number; width: number; height: number }
): Promise<number> {
    // stats() ignores earlier operations, so crop into a new image first.
    const cropped = await sharp(image).extract(region).toBuffer();
    const { channels } = await sharp(cropped).stats();
    return channels.slice(0, 3).reduce((sum, channel) => sum + channel.mean, 0) / 3;
}

test('parses highlighted words wrapped in stars', () => {
    assert.deepEqual(parseOverlayText('Real life wali bandi *ko* Social *Media wali*'), [
        { text: 'Real', highlight: false },
        { text: 'life', highlight: false },
        { text: 'wali', highlight: false },
        { text: 'bandi', highlight: false },
        { text: 'ko', highlight: true },
        { text: 'Social', highlight: false },
        { text: 'Media', highlight: true },
        { text: 'wali', highlight: true },
    ]);
});

test('drops an unpaired star, emojis, and extra spaces', () => {
    assert.equal(cleanOverlayText('  Hello 😂🔥  *world  ✨ '), 'Hello world');
    assert.deepEqual(parseOverlayText('Hello *world'), [
        { text: 'Hello', highlight: false },
        { text: 'world', highlight: false },
    ]);
    assert.deepEqual(parseOverlayText('😂 *'), []);
});

test('limits the line length', () => {
    const long = 'word '.repeat(40);
    assert.ok(cleanOverlayText(long).length <= OVERLAY_MAX_CHARS);
});

test('rejects scripts the font cannot shape', () => {
    assert.throws(
        () => parseOverlayText('यह हिंदी है'),
        (error: unknown) => (error as AppError).code === 'OVERLAY_SCRIPT_UNSUPPORTED'
    );
    assert.doesNotThrow(() => parseOverlayText('Café crème, 100% sahi! (2026)'));
});

test('keeps the photo area inside the image', () => {
    assert.deepEqual(clampTextArea(undefined, 1080, 1350), {
        left: 0,
        top: 0,
        width: 1080,
        height: 1350,
        radius: 0,
    });
    assert.deepEqual(
        clampTextArea({ left: 50, top: 40, width: 2000, height: 900, radius: 24 }, 1080, 1350),
        { left: 50, top: 40, width: 1030, height: 900, radius: 24 }
    );
    assert.deepEqual(
        clampTextArea({ left: 5000, top: 5000, width: 10, height: 10, radius: 0 }, 1080, 1350),
        { left: 0, top: 0, width: 1080, height: 1350, radius: 0 }
    );
});

test('fits long lines into three lines within the width', () => {
    const font = loadOverlayFont();
    const words = parseOverlayText(
        'Real life wali bandi ko Social Media wali bandi ke bare me pata chal gaya aur phir kya hua dekho'
    );
    const fitted = fitOverlay(words, font, { width: 940, height: 1200 });

    assert.ok(fitted.lines.length <= 3);
    for (const line of fitted.lines) {
        assert.ok(line.width <= 940 * 0.86 + 0.5, `line too wide: ${line.width}`);
    }
    assert.ok(fitted.lines.length * fitted.lineHeight <= 1200 * 0.34 + 0.5);
});

test('keeps short lines large', () => {
    const font = loadOverlayFont();
    const fitted = fitOverlay(parseOverlayText('Monday *mood*'), font, { width: 1000, height: 1000 });

    assert.equal(fitted.lines.length, 1);
    assert.equal(fitted.size, 75);
});

test('renders the overlay inside the photo area only', async () => {
    const image = await solid(1080, 1350, '#4a90d9');
    const area = { left: 49, top: 49, width: 982, height: 1100, radius: 24 };

    const output = await renderTextOverlay(image, 'Real life wali *bandi*', area);
    const meta = await sharp(output).metadata();

    assert.equal(meta.width, 1080);
    assert.equal(meta.height, 1350);

    const beforeBand = await regionMean(image, { left: 0, top: 1160, width: 1080, height: 150 });
    const afterBand = await regionMean(output, { left: 0, top: 1160, width: 1080, height: 150 });
    assert.ok(Math.abs(beforeBand - afterBand) < 3, 'the logo band below the photo changed');

    const beforeTop = await regionMean(image, { left: 100, top: 100, width: 880, height: 200 });
    const afterTop = await regionMean(output, { left: 100, top: 100, width: 880, height: 200 });
    assert.ok(Math.abs(beforeTop - afterTop) < 3, 'the top of the photo changed');

    const beforeBottom = await regionMean(image, { left: 100, top: 950, width: 880, height: 180 });
    const afterBottom = await regionMean(output, { left: 100, top: 950, width: 880, height: 180 });
    assert.ok(Math.abs(beforeBottom - afterBottom) > 10, 'the text area did not change');
});

test('returns the image unchanged when there is no text left', async () => {
    const image = await solid(400, 400, '#222222');
    const output = await renderTextOverlay(image, ' 😂 ', undefined);
    assert.equal(output, image);
});
