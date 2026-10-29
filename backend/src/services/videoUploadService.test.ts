import test from 'node:test';
import assert from 'node:assert/strict';
import { v2 as cloudinary } from 'cloudinary';
import type { AppError } from '../utils/errors.js';
import type { VideoStore } from './videoUploadService.js';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { loadReelVideo, signVideoUpload, videoRejection } = await import(
    './videoUploadService.js'
);
const { REEL_EAGER, reelCoverUrl, reelVideoUrl } = await import(
    './mediaDerivativeService.js'
);

const USER_ID = '64b7f1c2a1b2c3d4e5f60719';
const PUBLIC_ID = `meta-bru/${USER_ID}/reel-1`;
const CREDENTIALS = { cloudName: 'demo', apiKey: 'key-123', apiSecret: 'secret-456' };

function videoResource(overrides: Record<string, unknown> = {}) {
    return {
        public_id: PUBLIC_ID,
        asset_folder: `meta-bru/${USER_ID}`,
        secure_url: `https://res.cloudinary.com/demo/video/upload/v1/${PUBLIC_ID}.mov`,
        format: 'mov',
        bytes: 5_000_000,
        width: 1080,
        height: 1920,
        duration: 12.34,
        ...overrides,
    };
}

function fakeStore(resource: Record<string, unknown> | null) {
    const removed: string[] = [];
    const store: VideoStore = {
        find: async () => resource,
        remove: async (publicId) => {
            removed.push(publicId);
        },
    };
    return { store, removed };
}

function hasCode(code: string) {
    return (error: unknown) => (error as AppError).code === code;
}

test('signs a direct upload into the user folder', () => {
    const upload = signVideoUpload(CREDENTIALS, USER_ID, 1_700_000_000_123);

    assert.equal(upload.cloudName, 'demo');
    assert.equal(upload.apiKey, 'key-123');
    assert.equal(upload.timestamp, 1_700_000_000);
    assert.equal(upload.folder, `meta-bru/${USER_ID}`);
    assert.equal(upload.eager, REEL_EAGER);
    assert.equal(upload.eagerAsync, 'true');
    assert.equal(upload.allowedFormats, 'mp4,mov');
    assert.equal(
        upload.signature,
        cloudinary.utils.api_sign_request(
            {
                timestamp: 1_700_000_000,
                folder: `meta-bru/${USER_ID}`,
                eager: REEL_EAGER,
                eager_async: 'true',
                allowed_formats: 'mp4,mov',
            },
            'secret-456'
        )
    );
    assert.ok(!JSON.stringify(upload).includes('secret-456'));
});

test('accepts a reel within the limits', () => {
    assert.equal(videoRejection(videoResource()), null);
});

test('rejects unsupported, oversized, short, and long videos', () => {
    assert.equal(videoRejection(videoResource({ format: 'webm' }))?.code, 'UNSUPPORTED_MEDIA_TYPE');
    assert.equal(
        videoRejection(videoResource({ bytes: 100 * 1024 * 1024 + 1 }))?.code,
        'MEDIA_TOO_LARGE'
    );
    assert.equal(videoRejection(videoResource({ duration: 2.9 }))?.code, 'REEL_TOO_SHORT');
    assert.equal(videoRejection(videoResource({ duration: 901 }))?.code, 'REEL_TOO_LONG');
});

test('loads an owned reel with its derivative URLs', async () => {
    const { store, removed } = fakeStore(videoResource());

    const media = await loadReelVideo(USER_ID, PUBLIC_ID, CREDENTIALS, {}, store);

    assert.deepEqual(media, {
        publicId: PUBLIC_ID,
        url: reelVideoUrl('demo', PUBLIC_ID),
        coverUrl: reelCoverUrl('demo', PUBLIC_ID),
        originalUrl: `https://res.cloudinary.com/demo/video/upload/v1/${PUBLIC_ID}.mov`,
        width: 1080,
        height: 1920,
        duration: 12.3,
        format: 'mov',
        bytes: 5_000_000,
    });
    assert.deepEqual(removed, []);
});

test('rejects a video outside the user folder without deleting it', async () => {
    const { store, removed } = fakeStore(
        videoResource({ public_id: 'other/reel-1', asset_folder: 'other' })
    );

    await assert.rejects(
        () =>
            loadReelVideo(USER_ID, 'other/reel-1', CREDENTIALS, { deleteIfRejected: true }, store),
        hasCode('INVALID_MEDIA')
    );
    assert.deepEqual(removed, []);
});

test('accepts a dynamic-folder video by its asset folder', async () => {
    const { store } = fakeStore(videoResource({ public_id: 'abc123' }));

    const media = await loadReelVideo(USER_ID, 'abc123', CREDENTIALS, {}, store);

    assert.equal(media.publicId, 'abc123');
});

test('reports a video Cloudinary no longer has', async () => {
    const { store } = fakeStore(null);

    await assert.rejects(
        () => loadReelVideo(USER_ID, PUBLIC_ID, CREDENTIALS, {}, store),
        hasCode('MEDIA_NOT_FOUND')
    );
});

test('deletes a rejected upload only when asked', async () => {
    const short = fakeStore(videoResource({ duration: 1 }));
    await assert.rejects(
        () => loadReelVideo(USER_ID, PUBLIC_ID, CREDENTIALS, { deleteIfRejected: true }, short.store),
        hasCode('REEL_TOO_SHORT')
    );
    assert.deepEqual(short.removed, [PUBLIC_ID]);

    const kept = fakeStore(videoResource({ duration: 1 }));
    await assert.rejects(
        () => loadReelVideo(USER_ID, PUBLIC_ID, CREDENTIALS, {}, kept.store),
        hasCode('REEL_TOO_SHORT')
    );
    assert.deepEqual(kept.removed, []);
});
