import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import type { AppError } from '../utils/errors.js';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const {
    MAX_POST_HEIGHT,
    MIN_POST_HEIGHT,
    POST_WIDTH,
    frameLayout,
    framePalette,
    plainPostSize,
    prepareLogo,
    renderPostImage,
} = await import('./imageProcessingService.js');

function solid(
    width: number,
    height: number,
    color: string,
    format: 'png' | 'jpeg' = 'png'
): Promise<Buffer> {
    const image = sharp({
        create: { width, height, channels: 3, background: color },
    });
    return format === 'png' ? image.png().toBuffer() : image.jpeg().toBuffer();
}

/** A transparent canvas with a solid block in the middle. */
function paddedMark(
    canvas: number,
    markWidth: number,
    markHeight: number,
    color: string
): Promise<Buffer> {
    const x = (canvas - markWidth) / 2;
    const y = (canvas - markHeight) / 2;
    return sharp(
        Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}">` +
                `<rect x="${x}" y="${y}" width="${markWidth}" height="${markHeight}" fill="${color}"/></svg>`
        )
    )
        .png()
        .toBuffer();
}

async function pixel(
    image: Buffer,
    left: number,
    top: number
): Promise<{ r: number; g: number; b: number }> {
    const [r = 0, g = 0, b = 0] = await sharp(image)
        .extract({ left, top, width: 1, height: 1 })
        .removeAlpha()
        .raw()
        .toBuffer();
    return { r, g, b };
}

function assertAppError(statusCode: number, code: string) {
    return (error: unknown): boolean => {
        const appError = error as AppError;
        return appError.statusCode === statusCode && appError.code === code;
    };
}

test('keeps photos that Instagram accepts at their own shape', () => {
    assert.deepEqual(plainPostSize(4000, 3000), { width: 1080, height: 810 });
    assert.deepEqual(plainPostSize(1000, 1000), { width: 1080, height: 1080 });
    assert.deepEqual(plainPostSize(1600, 2000), { width: 1080, height: 1350 });
});

test('clamps photos outside 4:5 to 1.91:1 to the nearest feed limit', () => {
    assert.deepEqual(plainPostSize(1080, 1920), {
        width: POST_WIDTH,
        height: MAX_POST_HEIGHT,
    });
    assert.deepEqual(plainPostSize(3000, 1000), {
        width: POST_WIDTH,
        height: MIN_POST_HEIGHT,
    });
    assert.ok(POST_WIDTH / MIN_POST_HEIGHT <= 1.91);
    assert.equal(POST_WIDTH / MAX_POST_HEIGHT, 0.8);
});

test('frame spacing is identical for every photo shape', () => {
    const tall = frameLayout(900, 1600);
    const wide = frameLayout(1920, 1080);

    assert.equal(tall.margin, wide.margin);
    assert.equal(tall.band, wide.band);
    assert.equal(tall.height, MAX_POST_HEIGHT);
    assert.ok(wide.height >= MIN_POST_HEIGHT && wide.height < MAX_POST_HEIGHT);
});

test('frame tone keeps the logo legible', () => {
    const photo = { r: 42, g: 157, b: 143 };

    assert.equal(framePalette(photo, 0.02).tone, 'light');
    assert.equal(framePalette(photo, 0.9).tone, 'dark');
});

test('renders an unframed photo as a feed-sized JPEG', async () => {
    const rendered = await renderPostImage(await solid(400, 300, '#3366cc'), null);
    const meta = await sharp(rendered.buffer).metadata();

    assert.equal(rendered.framed, false);
    assert.equal(meta.format, 'jpeg');
    assert.equal(meta.width, 1080);
    assert.equal(meta.height, 810);
});

test('renders a tall phone photo at 4:5 without stretching it', async () => {
    const rendered = await renderPostImage(await solid(900, 1600, '#cc3366'), null);
    const meta = await sharp(rendered.buffer).metadata();

    assert.equal(meta.width, 1080);
    assert.equal(meta.height, 1350);
});

test('frames the photo and places the logo in the bottom band', async () => {
    const logo = await prepareLogo(await paddedMark(400, 300, 120, '#d00000'));
    const rendered = await renderPostImage(await solid(1000, 1000, '#2a9d8f'), logo.data);
    const meta = await sharp(rendered.buffer).metadata();
    const layout = frameLayout(1000, 1000);

    assert.equal(rendered.framed, true);
    assert.equal(meta.width, layout.width);
    assert.equal(meta.height, layout.height);

    const bandCentre = Math.round(
        layout.height - layout.band + (layout.band - layout.hairlineInset) / 2
    );
    const logoPixel = await pixel(rendered.buffer, Math.round(layout.width / 2), bandCentre);
    assert.ok(logoPixel.r > 180 && logoPixel.g < 60 && logoPixel.b < 60);

    const photoPixel = await pixel(
        rendered.buffer,
        Math.round(layout.width / 2),
        Math.round(layout.margin + layout.maxPhotoHeight / 2)
    );
    assert.ok(Math.abs(photoPixel.g - 0x9d) < 12);

    const framePixel = await pixel(rendered.buffer, 5, 5);
    assert.ok(Math.abs(framePixel.g - 0x9d) > 30);
});

test('trims transparent padding from a logo', async () => {
    const logo = await prepareLogo(await paddedMark(500, 200, 80, '#111111'));

    assert.equal(logo.width, 200);
    assert.equal(logo.height, 80);
});

test('gives an opaque logo an even margin after trimming', async () => {
    const jpeg = await sharp(
        Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300">' +
                '<rect width="600" height="300" fill="#ffffff"/>' +
                '<rect x="200" y="100" width="200" height="100" fill="#000000"/></svg>'
        )
    )
        .jpeg()
        .toBuffer();
    const logo = await prepareLogo(jpeg);

    assert.ok(logo.width > 200 && logo.width < 320);
    assert.ok(logo.height > 100 && logo.height < 220);
    const edge = await pixel(logo.data, Math.round(logo.width / 2), 2);
    assert.ok(edge.r > 240 && edge.g > 240 && edge.b > 240);
    const { channels } = await sharp(logo.data).stats();
    assert.equal(channels[3]?.min, 0, 'badge corners are rounded');
});

test('keeps a transparent logo that trims to a solid shape unpadded', async () => {
    const logo = await prepareLogo(await paddedMark(400, 200, 100, '#1d3557'));
    const corner = await pixel(logo.data, 0, 0);

    assert.equal(logo.width, 200);
    assert.equal(logo.height, 100);
    assert.ok(corner.b > 70, 'no black padding was added');
});

test('caps stored logo size', async () => {
    const logo = await prepareLogo(await paddedMark(2000, 1800, 900, '#123456'));

    assert.ok(Math.max(logo.width, logo.height) <= 640);
});

test('rejects unreadable, empty, and tiny logos', async () => {
    await assert.rejects(
        () => prepareLogo(Buffer.from('not an image')),
        assertAppError(400, 'INVALID_IMAGE')
    );

    const transparent = await sharp({
        create: {
            width: 200,
            height: 200,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
    })
        .png()
        .toBuffer();
    await assert.rejects(
        () => prepareLogo(transparent),
        assertAppError(400, 'INVALID_LOGO')
    );

    const tiny = await paddedMark(300, 20, 20, '#000000');
    await assert.rejects(
        () => prepareLogo(tiny),
        assertAppError(400, 'LOGO_TOO_SMALL')
    );
});

test('rejects unreadable post images', async () => {
    await assert.rejects(
        () => renderPostImage(Buffer.from('nope'), null),
        assertAppError(400, 'INVALID_IMAGE')
    );
});
