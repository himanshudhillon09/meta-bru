import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const {
    buildCaptionPrompt,
    buildImageGenerationBody,
    extractInlineImage,
    generateCaption,
    resolveImageModel,
} = await import('./aiService.js');
const { User } = await import('../models/userModel.js');
const { encryptSecret } = await import('./cryptoService.js');

const USER_ID = '64b7f1c2a1b2c3d4e5f60719';

afterEach(() => mock.restoreAll());

test('uses a Gemini image model when the configured model is retired Imagen', () => {
    assert.equal(
        resolveImageModel('imagen-4.0-generate-001'),
        'gemini-2.5-flash-image'
    );
    assert.equal(
        resolveImageModel('gemini-3.1-flash-image'),
        'gemini-3.1-flash-image'
    );
});

test('builds a Gemini generateContent image request', () => {
    const body = buildImageGenerationBody('a red car on a coastal road');

    assert.deepEqual(body, {
        contents: [{ parts: [{ text: 'a red car on a coastal road' }] }],
        generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: { aspectRatio: '1:1' },
        },
    });
});

test('extracts inline image data from a Gemini response', () => {
    const image = extractInlineImage({
        candidates: [
            {
                content: {
                    parts: [
                        { text: 'Here is your image.' },
                        {
                            inlineData: {
                                mimeType: 'image/png',
                                data: 'aW1hZ2U=',
                            },
                        },
                    ],
                },
            },
        ],
    });

    assert.deepEqual(image, { mimeType: 'image/png', data: 'aW1hZ2U=' });
    assert.equal(extractInlineImage({ candidates: [] }), null);
});

test('adds image instructions to the caption prompt', () => {
    const withImage = buildCaptionPrompt({
        platform: 'instagram',
        mediaPublicId: 'meta-bru/user/image',
    });
    const withoutImage = buildCaptionPrompt({ platform: 'instagram' });

    assert.match(withImage, /attached image/);
    assert.doesNotMatch(withoutImage, /attached image/);
});

test('asks for platform-appropriate, trending, image-relevant hashtags', () => {
    const instagram = buildCaptionPrompt({
        platform: 'instagram',
        mediaPublicId: 'meta-bru/user/image',
    });
    const facebook = buildCaptionPrompt({ platform: 'facebook' });
    const both = buildCaptionPrompt({ platform: 'both' });

    assert.match(instagram, /8-12 currently popular or trending hashtags/);
    assert.match(facebook, /3-5 currently popular or trending hashtags/);
    assert.match(both, /6-8 currently popular or trending hashtags/);
    assert.match(instagram, /image subject/);
    assert.match(instagram, /Do not use unrelated generic hashtags/);
});

test('sends the uploaded image to Gemini as inline data for captions', async () => {
    const credentialsEnc = encryptSecret(
        JSON.stringify({
            gemini: { apiKey: 'gemini-test-key' },
            cloudinary: {
                cloudName: 'test-cloud',
                apiKey: 'cloud-key',
                apiSecret: 'cloud-secret',
            },
        })
    );

    mock.method(User, 'findById', () => ({
        select: async () => ({ credentialsEnc }),
    }));

    const calls: Array<{ url: string; body?: string }> = [];

    mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push({
            url,
            ...(typeof init?.body === 'string' ? { body: init.body } : {}),
        });

        if (url.includes('res.cloudinary.com')) {
            return new Response('image-bytes', {
                status: 200,
                headers: { 'content-type': 'image/jpeg' },
            });
        }

        return new Response(
            JSON.stringify({
                candidates: [
                    { content: { parts: [{ text: 'A caption from the image' }] } },
                ],
            }),
            {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }
        );
    });

    const caption = await generateCaption(USER_ID, {
        platform: 'instagram',
        mediaPublicId: 'meta-bru/user/image',
    });

    assert.equal(caption, 'A caption from the image');

    const geminiCall = calls.find((call) => call.url.includes('generativelanguage'));
    assert.ok(geminiCall);
    assert.ok(geminiCall.body);

    const payload = JSON.parse(geminiCall.body) as {
        contents: Array<{
            parts: Array<{
                text?: string;
                inlineData?: { mimeType?: string; data?: string };
            }>;
        }>;
    };
    const parts = payload.contents[0]?.parts || [];

    assert.equal(parts[0]?.text?.includes('attached image'), true);
    assert.deepEqual(parts[1]?.inlineData, {
        mimeType: 'image/jpeg',
        data: Buffer.from('image-bytes').toString('base64'),
    });
});
