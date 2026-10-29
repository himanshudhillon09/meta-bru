import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const {
    buildCaptionPrompt,
    buildImageGenerationBody,
    buildOverlayPrompt,
    classifyGeminiModels,
    extractInlineImage,
    describeGeminiError,
    generateCaption,
    generateImage,
    generateOverlayText,
    listGeminiModels,
    parseCaptionResponse,
    parseOverlayResponse,
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
                    {
                        content: {
                            parts: [
                                {
                                    text: [
                                        'CAPTION:',
                                        'A caption from the image',
                                        'HASHTAGS:',
                                        '#cybersecurity #digitaltrust #technews #infosec #privacy #security #technology #news',
                                    ].join('\n'),
                                },
                            ],
                        },
                    },
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

    assert.equal(
        caption,
        'A caption from the image\n\n#cybersecurity #digitaltrust #technews #infosec #privacy #security #technology #news'
    );

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

test('parses the CAPTION/HASHTAGS response format', () => {
    const caption = parseCaptionResponse(
        'CAPTION:\nA clean caption\nHASHTAGS:\n#one #two #three',
        { platform: 'facebook' }
    );

    assert.equal(caption, 'A clean caption\n\n#one #two #three');
});

test('removes the CAPTION label even without a HASHTAGS section', () => {
    const caption = parseCaptionResponse(
        'CAPTION:\nA clean caption that ends here.',
        {
            platform: 'facebook',
            brandProfile: { niche: 'Science & Tech' },
        }
    );

    assert.equal(caption, 'A clean caption that ends here.\n\n#ScienceTech');
    assert.doesNotMatch(caption, /CAPTION:/);
});

test('never leaks a JSON wrapper into the caption', () => {
    const malformed = `{"caption": "Ever wondered which smartphone truly lasts the longest?

#ScienceTech #bytehorizon"}`;

    const caption = parseCaptionResponse(malformed, {
        platform: 'instagram',
        brandProfile: { niche: 'Science & Tech' },
    });

    assert.equal(
        caption,
        'Ever wondered which smartphone truly lasts the longest?\n\n#ScienceTech #bytehorizon'
    );
    assert.doesNotMatch(caption, /"caption"/);
});

test('adds brand hashtags when the model returns none', () => {
    const caption = parseCaptionResponse('A clean caption', {
        platform: 'facebook',
        brandProfile: {
            niche: 'Science & Tech',
            keywords: 'smartphones, battery',
        },
    });

    assert.equal(
        caption,
        'A clean caption\n\n#ScienceTech #smartphones #battery'
    );
});

test('asks for one short highlighted line in the caption language', () => {
    const prompt = buildOverlayPrompt({
        topic: 'Office wali bandi',
        caption: 'Jab real life wali bandi ko pata chala...',
        prompt: 'A surprised young man',
        brandProfile: { niche: 'Memes', tone: 'Funny' },
    });

    assert.match(prompt, /at most 12 words/);
    assert.match(prompt, /same language/i);
    assert.match(prompt, /Roman/);
    assert.match(prompt, /\*asterisks\*/);
    assert.match(prompt, /Office wali bandi/);
    assert.match(prompt, /Jab real life wali bandi/);
    assert.match(prompt, /A surprised young man/);
    assert.match(prompt, /Brand niche: Memes/);
});

test('cleans the overlay line Gemini returns', () => {
    assert.equal(
        parseOverlayResponse('Headline: "Real life wali bandi *ko* pata chal gaya." #meme 😂\nSecond line'),
        'Real life wali bandi *ko* pata chal gaya'
    );
    assert.equal(parseOverlayResponse('“Monday mood hits different”'), 'Monday mood hits *different*');
    assert.equal(parseOverlayResponse('   \n\n'), '');
});

test('generates an overlay line with Gemini', async () => {
    const credentialsEnc = encryptSecret(
        JSON.stringify({ gemini: { apiKey: 'gemini-test-key' } })
    );
    mock.method(User, 'findById', () => ({
        select: async () => ({ credentialsEnc }),
    }));
    let body = '';
    mock.method(globalThis, 'fetch', async (_input: string | URL | Request, init?: RequestInit) => {
        body = typeof init?.body === 'string' ? init.body : '';
        return new Response(
            JSON.stringify({
                candidates: [{ content: { parts: [{ text: 'Exam se pehle *full confidence*' }] } }],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
        );
    });

    const text = await generateOverlayText(USER_ID, { topic: 'Exams' });

    assert.equal(text, 'Exam se pehle *full confidence*');
    assert.match(body, /Exams/);
});

const FREE_TIER_IMAGE_ERROR = {
    error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        message:
            'You exceeded your current quota, please check your plan and billing details. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-2.5-flash-preview-image. Please retry in 20h1m4.388614383s.',
        details: [
            {
                '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
                violations: [
                    {
                        quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
                        quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
                    },
                ],
            },
            { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '72064s' },
        ],
    },
};

test('explains that free-tier keys cannot generate images', () => {
    const error = describeGeminiError(429, FREE_TIER_IMAGE_ERROR, 'image');

    assert.equal(error.code, 'AI_IMAGE_NEEDS_BILLING');
    assert.equal(error.statusCode, 402);
    assert.match(error.message, /free tier/);
    assert.match(error.message, /billing/);
    assert.doesNotMatch(error.message, /https?:\/\//);
    assert.doesNotMatch(error.message, /retry in/i);
});

test('reports an ordinary rate limit with a readable wait', () => {
    const error = describeGeminiError(
        429,
        {
            error: {
                code: 429,
                status: 'RESOURCE_EXHAUSTED',
                message: 'Quota exceeded for metric: requests per minute, limit: 10. Please retry in 41.2s.',
                details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '42s' }],
            },
        },
        'caption'
    );

    assert.equal(error.code, 'AI_RATE_LIMITED');
    assert.equal(error.statusCode, 429);
    assert.match(error.message, /about 1 minute/);
});

test('turns an invalid key into a Profile hint', () => {
    const error = describeGeminiError(
        400,
        { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } },
        'image'
    );

    assert.equal(error.code, 'AI_KEY_INVALID');
    assert.match(error.message, /Profile/);
});

test('keeps other Gemini errors as they are', () => {
    const error = describeGeminiError(
        500,
        { error: { code: 500, status: 'INTERNAL', message: 'Internal error encountered.' } },
        'caption'
    );

    assert.equal(error.code, 'AI_CAPTION_FAILED');
    assert.equal(error.message, 'Internal error encountered.');
});

test('generateImage returns the billing explanation from Gemini', async () => {
    const credentialsEnc = encryptSecret(
        JSON.stringify({ gemini: { apiKey: 'gemini-test-key' } })
    );
    mock.method(User, 'findById', () => ({
        select: async () => ({ credentialsEnc }),
    }));
    mock.method(globalThis, 'fetch', async () =>
        new Response(JSON.stringify(FREE_TIER_IMAGE_ERROR), {
            status: 429,
            headers: { 'content-type': 'application/json' },
        })
    );

    await assert.rejects(
        () => generateImage(USER_ID, 'A robot reading a newspaper'),
        (error: unknown) => (error as { code?: string }).code === 'AI_IMAGE_NEEDS_BILLING'
    );
});

function geminiUser() {
    const credentialsEnc = encryptSecret(JSON.stringify({ gemini: { apiKey: 'gemini-test-key' } }));
    mock.method(User, 'findById', () => ({
        select: async () => ({ credentialsEnc }),
    }));
}

const MODEL_LIST = [
    { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
    { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.1-flash-lite-image', displayName: 'Nano Banana 2 Lite', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash-preview-tts', displayName: 'TTS', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-embedding-001', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/imagen-4.0-generate', displayName: 'Imagen 4', supportedGenerationMethods: ['predict'] },
    { name: 'models/gemma-3-27b-it', displayName: 'Gemma 3', supportedGenerationMethods: ['generateContent'] },
];

test('sorts Gemini models into caption and image choices', () => {
    assert.deepEqual(classifyGeminiModels(MODEL_LIST), {
        text: [
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
        ],
        image: [{ id: 'gemini-3.1-flash-lite-image', name: 'Nano Banana 2 Lite' }],
    });
});

test('lists every page of models the key can use', async () => {
    geminiUser();
    const urls: string[] = [];
    mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
        const url = String(input);
        urls.push(url);
        const firstPage = !url.includes('pageToken');
        return new Response(
            JSON.stringify(
                firstPage
                    ? { models: MODEL_LIST.slice(0, 3), nextPageToken: 'next' }
                    : { models: MODEL_LIST.slice(3) }
            ),
            { status: 200, headers: { 'content-type': 'application/json' } }
        );
    });

    const list = await listGeminiModels(USER_ID);

    assert.equal(urls.length, 2);
    assert.match(urls[1] ?? '', /pageToken=next/);
    assert.equal(list.text.length, 2);
    assert.equal(list.image[0]?.id, 'gemini-3.1-flash-lite-image');
    assert.ok(list.defaults.text);
    assert.ok(list.defaults.image);
});

test('writes captions with the model chosen for captions', async () => {
    geminiUser();
    let url = '';
    let body = '';
    mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
        url = String(input);
        body = typeof init?.body === 'string' ? init.body : '';
        return new Response(
            JSON.stringify({
                candidates: [{ content: { parts: [{ text: 'CAPTION:\nHello\nHASHTAGS:\n#a #b #c' }] } }],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
        );
    });

    await generateCaption(USER_ID, { platform: 'facebook', topic: 'Hello', model: 'gemini-2.5-pro' });

    assert.match(url, /models\/gemini-2\.5-pro:generateContent/);
    assert.doesNotMatch(body, /thinkingBudget/);
});

test('generates images with the model chosen for images', async () => {
    geminiUser();
    let url = '';
    mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
        url = String(input);
        return new Response(JSON.stringify(FREE_TIER_IMAGE_ERROR), {
            status: 429,
            headers: { 'content-type': 'application/json' },
        });
    });

    await assert.rejects(() => generateImage(USER_ID, 'A robot', 'gemini-3.1-flash-lite-image'));

    assert.match(url, /models\/gemini-3\.1-flash-lite-image:generateContent/);
});
