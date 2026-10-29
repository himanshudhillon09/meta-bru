import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import type { AppError } from '../utils/errors.js';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { applyImageText, isSafePublicId, previewImageText } = await import(
    './imageTextService.js'
);
const { User } = await import('../models/userModel.js');
const { encryptSecret } = await import('./cryptoService.js');

const USER_ID = '64b7f1c2a1b2c3d4e5f60719';
const PUBLIC_ID = `meta-bru/${USER_ID}/photo-1`;

afterEach(() => mock.restoreAll());

function cloudinaryUser() {
    return {
        select: async () => ({
            credentialsEnc: encryptSecret(
                JSON.stringify({
                    cloudinary: { cloudName: 'demo', apiKey: 'key', apiSecret: 'secret' },
                })
            ),
        }),
    };
}

async function photo(): Promise<Buffer> {
    return sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#4a90d9' } })
        .jpeg()
        .toBuffer();
}

test('accepts Cloudinary public ids and rejects path tricks', () => {
    assert.equal(isSafePublicId(PUBLIC_ID), true);
    assert.equal(isSafePublicId('meta-bru/user/my_photo-2.v1'), true);
    assert.equal(isSafePublicId('../secrets'), false);
    assert.equal(isSafePublicId('meta-bru/../other'), false);
    assert.equal(isSafePublicId('/absolute'), false);
    assert.equal(isSafePublicId('has space'), false);
    assert.equal(isSafePublicId('https://evil.example/x.jpg'), false);
});

test('previews text on the image from the user’s own cloud', async () => {
    mock.method(User, 'findById', () => cloudinaryUser());
    const image = await photo();
    const fetched: string[] = [];

    const dataUrl = await previewImageText(
        USER_ID,
        PUBLIC_ID,
        'Real life wali *bandi*',
        undefined,
        async (url) => {
            fetched.push(url);
            return image;
        }
    );

    assert.equal(fetched.length, 1);
    assert.ok(fetched[0]?.startsWith(`https://res.cloudinary.com/demo/image/upload/`));
    assert.ok(fetched[0]?.includes(PUBLIC_ID));
    assert.ok(dataUrl.startsWith('data:image/jpeg;base64,'));

    const preview = await sharp(Buffer.from(dataUrl.split(',')[1] ?? '', 'base64')).metadata();
    assert.equal(preview.width, 720);
});

test('rejects an unsafe public id before fetching anything', async () => {
    const fetchImage = mock.fn(async () => Buffer.alloc(0));

    await assert.rejects(
        () => previewImageText(USER_ID, '../x', 'Hello', undefined, fetchImage),
        (error: unknown) => (error as AppError).code === 'INVALID_MEDIA'
    );
    assert.equal(fetchImage.mock.callCount(), 0);
});

test('applies text and uploads the result', async () => {
    mock.method(User, 'findById', () => cloudinaryUser());
    const image = await photo();
    let uploaded: Buffer | undefined;

    const media = await applyImageText(USER_ID, PUBLIC_ID, 'Hello *world*', undefined, {
        fetchImage: async () => image,
        upload: async (_userId, buffer) => {
            uploaded = buffer;
            return {
                url: 'https://res.cloudinary.com/demo/image/upload/v1/new.jpg',
                jpegUrl: 'https://res.cloudinary.com/demo/image/upload/q_auto:good/v1/new.jpg',
                publicId: `meta-bru/${USER_ID}/new`,
                width: 1080,
                height: 1350,
                format: 'jpg',
                bytes: 1234,
            };
        },
    });

    assert.equal(media.publicId, `meta-bru/${USER_ID}/new`);
    assert.ok(uploaded);
    assert.notEqual(uploaded, image);
    const meta = await sharp(uploaded).metadata();
    assert.equal(meta.width, 1080);
    assert.equal(meta.height, 1350);
});
