import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const {
    buildAnalyticsAiPrompt,
    parseAnalyticsAiTips,
    getCachedAnalyticsAiInsight,
    generateAnalyticsAiInsight,
} = await import('./analyticsAiService.js');
const { AnalyticsAiInsight } = await import(
    '../models/analyticsAiInsightModel.js'
);
const { AppError } = await import('../utils/errors.js');
const { env } = await import('../config/env.js');

const USER_ID = '64b000000000000000000001';
const CONNECTION_ID = '64b000000000000000000002';
const INSIGHT_ID = '64b000000000000000000003';
const FIXED_NOW = new Date('2026-10-24T09:30:00.000Z');
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

const SAMPLE_PAYLOAD = {
    range: { from: '2026-09-25', to: '2026-10-24', timezone: 'Asia/Kolkata' },
    scopeName: 'Page One',
    summary: { posts: 4, reach: 1200, interactions: 64, engagementRate: 5.3 },
    byPlatform: {},
    activity: [],
    publishingFrequency: { posts: 4 },
    longestGapDays: 3,
    bestTimes: [{ dayLabel: 'Wed', label: '18:00–21:00 IST', posts: 3 }],
    permissionErrors: [],
    topPosts: [],
    topEngagementPosts: [],
    brandProfile: { niche: 'coffee' },
};

function validTipsJson(): string {
    return JSON.stringify({
        tips: [
            {
                title: 'Post on Wednesday evenings',
                body: 'Your 18:00–21:00 IST posts perform best.',
                severity: 'success',
                actionLabel: 'Open composer',
                actionHref: '/composer',
            },
        ],
    });
}

function mockFindOne(
    result: unknown,
    captured?: {
        query?: Record<string, unknown>;
        sort?: Record<string, unknown>;
    }
) {
    return mock.method(
        AnalyticsAiInsight,
        'findOne',
        (query: Record<string, unknown>) => {
            if (captured) captured.query = query;
            return {
                sort: async (spec: Record<string, unknown>) => {
                    if (captured) captured.sort = spec;
                    return result;
                },
            };
        }
    );
}

function mockCreate() {
    const calls: Array<Record<string, unknown>> = [];
    const createMock = mock.method(
        AnalyticsAiInsight,
        'create',
        (data: Record<string, unknown>) => {
            calls.push(data);
            return Promise.resolve({ ...data, _id: INSIGHT_ID });
        }
    );
    return { calls, createMock };
}

function geminiResponse(text: string, status = 200): Response {
    return new Response(
        JSON.stringify({
            candidates: [{ content: { parts: [{ text }] } }],
        }),
        { status, headers: { 'Content-Type': 'application/json' } }
    );
}

function mockFetch(
    handler: (url: string, init: RequestInit) => Response | Promise<Response>
) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fn = (async (input: string | URL | Request, init?: RequestInit) => {
        const url =
            typeof input === 'string'
                ? input
                : input instanceof URL
                  ? input.toString()
                  : input.url;
        calls.push({ url, init: init ?? {} });
        return handler(url, init ?? {});
    }) as typeof fetch;

    return { fn, calls };
}

function bodyText(init: RequestInit): string {
    return typeof init.body === 'string' ? init.body : '';
}

function headersOf(init: RequestInit): Record<string, string> {
    return (init.headers ?? {}) as Record<string, string>;
}

function isAppError(
    statusCode: number,
    code: string
): (error: unknown) => boolean {
    return (error: unknown) => {
        assert.ok(error instanceof AppError, 'expected an AppError');
        assert.equal(error.statusCode, statusCode);
        assert.equal(error.code, code);
        return true;
    };
}

function generate(
    payload: Record<string, unknown> = SAMPLE_PAYLOAD,
    deps: Record<string, unknown> = {}
) {
    return generateAnalyticsAiInsight(
        USER_ID,
        'user:all',
        '2026-09-25..2026-10-24',
        payload,
        CONNECTION_ID,
        deps as never
    );
}

// ---------------------------------------------------------------------------
// parseAnalyticsAiTips
// ---------------------------------------------------------------------------

test('parses and normalizes a valid tips payload', () => {
    const tips = parseAnalyticsAiTips(validTipsJson());

    assert.equal(tips.length, 1);
    assert.deepEqual(tips[0], {
        title: 'Post on Wednesday evenings',
        body: 'Your 18:00–21:00 IST posts perform best.',
        severity: 'success',
        actionLabel: 'Open composer',
        actionHref: '/composer',
    });
});

test('strips markdown code fences before parsing', () => {
    const tips = parseAnalyticsAiTips(
        '```json\n' + validTipsJson() + '\n```'
    );

    assert.equal(tips.length, 1);
    assert.equal(tips[0]?.title, 'Post on Wednesday evenings');
});

test('strips bare markdown fences before parsing', () => {
    const tips = parseAnalyticsAiTips('```\n' + validTipsJson() + '\n```');

    assert.equal(tips.length, 1);
});

test('rejects non-JSON output with AI_TIPS_INVALID', () => {
    assert.throws(
        () => parseAnalyticsAiTips('not json'),
        isAppError(502, 'AI_TIPS_INVALID')
    );
});

test('rejects output without a tips array', () => {
    assert.throws(
        () => parseAnalyticsAiTips(JSON.stringify({ result: [] })),
        isAppError(502, 'AI_TIPS_INVALID')
    );
});

test('rejects output whose tips value is not an array', () => {
    assert.throws(
        () => parseAnalyticsAiTips(JSON.stringify({ tips: 'nope' })),
        isAppError(502, 'AI_TIPS_INVALID')
    );
});

test('rejects output with no usable tips', () => {
    assert.throws(
        () => parseAnalyticsAiTips(JSON.stringify({ tips: [] })),
        isAppError(502, 'AI_TIPS_INVALID')
    );

    assert.throws(
        () =>
            parseAnalyticsAiTips(
                JSON.stringify({
                    tips: [
                        null,
                        'tip',
                        { title: '', body: 'Body' },
                        { title: 'Title', body: '   ' },
                        { body: 'Missing title' },
                        { title: 'Missing body' },
                    ],
                })
            ),
        isAppError(502, 'AI_TIPS_INVALID')
    );
});

test('skips malformed tips but keeps valid ones', () => {
    const tips = parseAnalyticsAiTips(
        JSON.stringify({
            tips: [
                null,
                42,
                { title: '   ', body: 'Body' },
                { title: 'Kept', body: 'Body text' },
            ],
        })
    );

    assert.equal(tips.length, 1);
    assert.equal(tips[0]?.title, 'Kept');
});

test('defaults severity to info and accepts info, success, warning', () => {
    const tips = parseAnalyticsAiTips(
        JSON.stringify({
            tips: [
                { title: 'A', body: 'a', severity: 'danger' },
                { title: 'B', body: 'b' },
                { title: 'C', body: 'c', severity: 'info' },
                { title: 'D', body: 'd', severity: 'warning' },
                { title: 'E', body: 'e', severity: 'success' },
            ],
        })
    );

    assert.deepEqual(
        tips.map((tip) => tip.severity),
        ['info', 'info', 'info', 'warning', 'success']
    );
});

test('only keeps safe internal action paths', () => {
    const tips = parseAnalyticsAiTips(
        JSON.stringify({
            tips: [
                { title: 'A', body: 'a', actionHref: '/composer' },
                { title: 'B', body: 'b', actionHref: 'https://evil.example/x' },
                { title: 'C', body: 'c', actionHref: '//evil.example/x' },
                { title: 'D', body: 'd', actionHref: '/\\evil.example' },
                { title: 'E', body: 'e', actionHref: 'composer' },
            ],
        })
    );

    assert.deepEqual(
        tips.map((tip) => tip.actionHref),
        ['/composer', '', '', '', '']
    );
});

test('caps the result at five tips', () => {
    const tips = parseAnalyticsAiTips(
        JSON.stringify({
            tips: Array.from({ length: 8 }, (_, index) => ({
                title: `Tip ${index}`,
                body: `Body ${index}`,
            })),
        })
    );

    assert.equal(tips.length, 5);
    assert.deepEqual(
        tips.map((tip) => tip.title),
        ['Tip 0', 'Tip 1', 'Tip 2', 'Tip 3', 'Tip 4']
    );
});

test('trims and truncates title, body, and action label', () => {
    const tips = parseAnalyticsAiTips(
        JSON.stringify({
            tips: [
                {
                    title: `  ${'t'.repeat(150)}  `,
                    body: `  ${'b'.repeat(300)}  `,
                    actionLabel: `  ${'l'.repeat(60)}  `,
                    actionHref: '  /composer  ',
                },
            ],
        })
    );

    assert.equal(tips[0]?.title.length, 120);
    assert.equal(tips[0]?.body.length, 240);
    assert.equal(tips[0]?.actionLabel.length, 40);
    assert.equal(tips[0]?.actionHref, '/composer');
});

// ---------------------------------------------------------------------------
// buildAnalyticsAiPrompt
// ---------------------------------------------------------------------------

test('prompt includes the scope, IST timing, strict JSON, and payload', () => {
    const prompt = buildAnalyticsAiPrompt(SAMPLE_PAYLOAD);

    assert.match(prompt, /Page One/);
    assert.match(prompt, /Asia\/Kolkata/);
    assert.match(prompt, /IST/);
    assert.match(prompt, /strict JSON/i);
    assert.match(prompt, /"tips"/);
    assert.match(prompt, /3 to 5 tips/i);
    assert.match(prompt, /under 240 characters/i);
    assert.match(prompt, /internal path/i);
    assert.match(prompt, /Use only the data/i);
    assert.match(prompt, /Wednesday|Wed/);
    assert.match(prompt, /18:00/);
    assert.ok(prompt.includes(JSON.stringify(SAMPLE_PAYLOAD)));
});

test('prompt forbids inventing metrics and external links', () => {
    const prompt = buildAnalyticsAiPrompt(SAMPLE_PAYLOAD);

    assert.match(prompt, /Do not invent metrics/i);
    assert.match(prompt, /beginning with \//);
    assert.match(prompt, /not enough data/i);
});

// ---------------------------------------------------------------------------
// getCachedAnalyticsAiInsight
// ---------------------------------------------------------------------------

test('cache lookup filters by scope, hash, and unexpired rows', async (t) => {
    t.after(() => mock.restoreAll());
    const captured: {
        query?: Record<string, unknown>;
        sort?: Record<string, unknown>;
    } = {};
    mockFindOne(null, captured);

    const before = Date.now();
    const result = await getCachedAnalyticsAiInsight(
        USER_ID,
        'user:all',
        '2026-09-25..2026-10-24',
        'hash-1'
    );
    const after = Date.now();

    assert.equal(result, null);
    assert.equal(captured.query?.userId, USER_ID);
    assert.equal(captured.query?.scopeKey, 'user:all');
    assert.equal(captured.query?.rangeKey, '2026-09-25..2026-10-24');
    assert.equal(captured.query?.dataHash, 'hash-1');

    const expiresAt = captured.query?.expiresAt as { $gt?: Date };
    assert.ok(expiresAt?.$gt instanceof Date);
    assert.ok((expiresAt.$gt as Date).getTime() >= before);
    assert.ok((expiresAt.$gt as Date).getTime() <= after);
    assert.deepEqual(captured.sort, { generatedAt: -1 });
});

// ---------------------------------------------------------------------------
// generateAnalyticsAiInsight
// ---------------------------------------------------------------------------

test('returns the cached insight without calling Gemini or writing a row', async (t) => {
    t.after(() => mock.restoreAll());
    const cachedRow = {
        _id: INSIGHT_ID,
        tips: [{ title: 'Cached', body: 'Body' }],
        generatedAt: FIXED_NOW,
    };
    mockFindOne(cachedRow);
    const { createMock } = mockCreate();

    let credentialsCalled = false;
    let fetchCalled = false;

    const result = await generate(SAMPLE_PAYLOAD, {
        now: () => FIXED_NOW,
        getCredentials: async () => {
            credentialsCalled = true;
            return { apiKey: 'user-key' };
        },
        fetch: (async () => {
            fetchCalled = true;
            throw new Error('fetch should not be called');
        }) as typeof fetch,
    });

    assert.equal(result.cached, true);
    assert.equal(result.insight, cachedRow);
    assert.equal(credentialsCalled, false);
    assert.equal(fetchCalled, false);
    assert.equal(createMock.mock.callCount(), 0);
});

test('generates, parses, and caches tips on a cache miss', async (t) => {
    t.after(() => mock.restoreAll());
    const captured: { query?: Record<string, unknown> } = {};
    mockFindOne(null, captured);
    const { calls } = mockCreate();
    const { fn } = mockFetch(() => geminiResponse(validTipsJson()));

    const result = await generate(SAMPLE_PAYLOAD, {
        now: () => FIXED_NOW,
        getCredentials: async () => ({ apiKey: 'user-key' }),
        fetch: fn,
    });

    assert.equal(result.cached, false);
    assert.equal(calls.length, 1);

    const row = calls[0]!;
    assert.equal(row.userId, USER_ID);
    assert.equal(row.scopeKey, 'user:all');
    assert.equal(row.rangeKey, '2026-09-25..2026-10-24');
    assert.equal(row.connectionId, CONNECTION_ID);
    assert.equal(row.model, env.gemini.textModel);
    assert.equal(
        row.dataHash,
        crypto
            .createHash('sha256')
            .update(JSON.stringify(SAMPLE_PAYLOAD))
            .digest('hex')
    );
    assert.deepEqual(row.generatedAt, FIXED_NOW);
    assert.deepEqual(row.expiresAt, new Date(FIXED_NOW.getTime() + SIX_HOURS_MS));

    const tips = row.tips as Array<Record<string, unknown>>;
    assert.equal(tips.length, 1);
    assert.equal(tips[0]?.title, 'Post on Wednesday evenings');
    assert.equal(tips[0]?.severity, 'success');

    // The cache query used the same hash and the injected clock.
    assert.equal(captured.query?.dataHash, row.dataHash);
    const expiresAt = captured.query?.expiresAt as { $gt?: Date };
    assert.deepEqual(expiresAt.$gt, FIXED_NOW);
});

test('requests Gemini with the user key, configured model, and JSON mode', async (t) => {
    t.after(() => mock.restoreAll());
    mockFindOne(null);
    mockCreate();
    const { fn, calls } = mockFetch(() => geminiResponse(validTipsJson()));

    await generate(SAMPLE_PAYLOAD, {
        now: () => FIXED_NOW,
        getCredentials: async () => ({ apiKey: 'user-key' }),
        fetch: fn,
    });

    assert.equal(calls.length, 1);
    const call = calls[0]!;
    assert.ok(
        call.url.includes(
            `${encodeURIComponent(env.gemini.textModel)}:generateContent`
        )
    );
    assert.equal(headersOf(call.init)['x-goog-api-key'], 'user-key');
    assert.equal(call.init.method, 'POST');
    assert.ok(call.init.signal instanceof AbortSignal);

    const body = JSON.parse(bodyText(call.init)) as {
        contents: Array<{ parts: Array<{ text: string }> }>;
        generationConfig: Record<string, unknown>;
    };
    assert.equal(
        body.contents[0]?.parts[0]?.text,
        buildAnalyticsAiPrompt(SAMPLE_PAYLOAD)
    );
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    if (env.gemini.textModel.includes('flash')) {
        assert.deepEqual(body.generationConfig.thinkingConfig, {
            thinkingBudget: 0,
        });
    }
});

test('never sends credentials, tokens, Page IDs, or external post IDs', async (t) => {
    t.after(() => mock.restoreAll());
    mockFindOne(null);
    mockCreate();
    const { fn, calls } = mockFetch(() => geminiResponse(validTipsJson()));

    await generate(
        {
            ...SAMPLE_PAYLOAD,
            brandProfile: { niche: 'coffee' },
        },
        {
            now: () => FIXED_NOW,
            getCredentials: async () => ({ apiKey: 'super-secret-key' }),
            fetch: fn,
        }
    );

    const requestText = bodyText(calls[0]!.init);
    const prompt = (
        JSON.parse(requestText) as {
            contents: Array<{ parts: Array<{ text: string }> }>;
        }
    ).contents[0]!.parts[0]!.text;

    assert.equal(requestText.includes('super-secret-key'), false);
    assert.doesNotMatch(prompt, /access_token|EAAG|pageAccessToken/);
    assert.doesNotMatch(prompt, /"pageId"|"externalId"|"postId"/);
    assert.doesNotMatch(prompt, /email|password/i);
});

test('translates AI_NOT_CONFIGURED into GEMINI_NOT_CONFIGURED without writing', async (t) => {
    t.after(() => mock.restoreAll());
    mockFindOne(null);
    const { createMock } = mockCreate();
    let fetchCalled = false;

    await assert.rejects(
        () =>
            generate(SAMPLE_PAYLOAD, {
                now: () => FIXED_NOW,
                getCredentials: async () => {
                    throw new AppError(
                        503,
                        'Gemini API key is not configured. Add your own key under Profile.',
                        'AI_NOT_CONFIGURED'
                    );
                },
                fetch: (async () => {
                    fetchCalled = true;
                    throw new Error('no');
                }) as typeof fetch,
            }),
        isAppError(400, 'GEMINI_NOT_CONFIGURED')
    );

    assert.equal(fetchCalled, false);
    assert.equal(createMock.mock.callCount(), 0);
});

test('rethrows other credential errors unchanged', async (t) => {
    t.after(() => mock.restoreAll());
    mockFindOne(null);
    const { createMock } = mockCreate();

    await assert.rejects(
        () =>
            generate(SAMPLE_PAYLOAD, {
                now: () => FIXED_NOW,
                getCredentials: async () => {
                    throw new AppError(
                        500,
                        'Stored credentials could not be decrypted.',
                        'CREDENTIALS_UNREADABLE'
                    );
                },
            }),
        isAppError(500, 'CREDENTIALS_UNREADABLE')
    );

    assert.equal(createMock.mock.callCount(), 0);
});

test('returns 502 AI_TIPS_FAILED on a non-OK Gemini response', async (t) => {
    t.after(() => mock.restoreAll());
    mockFindOne(null);
    const { createMock } = mockCreate();
    const { fn } = mockFetch(
        () =>
            new Response(
                JSON.stringify({ error: { message: 'quota exceeded' } }),
                { status: 429, headers: { 'Content-Type': 'application/json' } }
            )
    );

    await assert.rejects(
        () =>
            generate(SAMPLE_PAYLOAD, {
                now: () => FIXED_NOW,
                getCredentials: async () => ({ apiKey: 'user-key' }),
                fetch: fn,
            }),
        isAppError(502, 'AI_TIPS_FAILED')
    );

    assert.equal(createMock.mock.callCount(), 0);
});

test('returns 502 AI_TIPS_FAILED on a network failure', async (t) => {
    t.after(() => mock.restoreAll());
    mockFindOne(null);
    const { createMock } = mockCreate();
    const { fn } = mockFetch(() => {
        throw new Error('socket hang up');
    });

    await assert.rejects(
        () =>
            generate(SAMPLE_PAYLOAD, {
                now: () => FIXED_NOW,
                getCredentials: async () => ({ apiKey: 'user-key' }),
                fetch: fn,
            }),
        isAppError(502, 'AI_TIPS_FAILED')
    );

    assert.equal(createMock.mock.callCount(), 0);
});

test('returns 502 AI_TIPS_FAILED on an empty Gemini response', async (t) => {
    t.after(() => mock.restoreAll());
    mockFindOne(null);
    const { createMock } = mockCreate();
    const { fn } = mockFetch(
        () =>
            new Response(JSON.stringify({ candidates: [] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
    );

    await assert.rejects(
        () =>
            generate(SAMPLE_PAYLOAD, {
                now: () => FIXED_NOW,
                getCredentials: async () => ({ apiKey: 'user-key' }),
                fetch: fn,
            }),
        isAppError(502, 'AI_TIPS_FAILED')
    );

    assert.equal(createMock.mock.callCount(), 0);
});

test('returns 502 AI_TIPS_FAILED when the Gemini envelope is not JSON', async (t) => {
    t.after(() => mock.restoreAll());
    mockFindOne(null);
    const { createMock } = mockCreate();
    const { fn } = mockFetch(
        () =>
            new Response('not json', {
                status: 200,
                headers: { 'Content-Type': 'text/plain' },
            })
    );

    await assert.rejects(
        () =>
            generate(SAMPLE_PAYLOAD, {
                now: () => FIXED_NOW,
                getCredentials: async () => ({ apiKey: 'user-key' }),
                fetch: fn,
            }),
        isAppError(502, 'AI_TIPS_FAILED')
    );

    assert.equal(createMock.mock.callCount(), 0);
});

test('returns 502 AI_TIPS_INVALID when Gemini returns unusable tips', async (t) => {
    t.after(() => mock.restoreAll());
    mockFindOne(null);
    const { createMock } = mockCreate();
    const { fn } = mockFetch(() => geminiResponse('this is not JSON'));

    await assert.rejects(
        () =>
            generate(SAMPLE_PAYLOAD, {
                now: () => FIXED_NOW,
                getCredentials: async () => ({ apiKey: 'user-key' }),
                fetch: fn,
            }),
        isAppError(502, 'AI_TIPS_INVALID')
    );

    assert.equal(createMock.mock.callCount(), 0);
});

test('leaves the existing cache untouched when generation fails', async (t) => {
    t.after(() => mock.restoreAll());
    const captured: { query?: Record<string, unknown> } = {};
    const findOneMock = mockFindOne(null, captured);
    const { createMock } = mockCreate();
    const deleteMock = mock.method(AnalyticsAiInsight, 'deleteOne');
    const deleteManyMock = mock.method(AnalyticsAiInsight, 'deleteMany');
    const updateMock = mock.method(AnalyticsAiInsight, 'updateOne');
    const updateManyMock = mock.method(AnalyticsAiInsight, 'updateMany');
    const { fn } = mockFetch(() => {
        throw new Error('network down');
    });

    await assert.rejects(
        () =>
            generate(SAMPLE_PAYLOAD, {
                now: () => FIXED_NOW,
                getCredentials: async () => ({ apiKey: 'user-key' }),
                fetch: fn,
            }),
        isAppError(502, 'AI_TIPS_FAILED')
    );

    assert.equal(findOneMock.mock.callCount(), 1);
    assert.equal(createMock.mock.callCount(), 0);
    assert.equal(deleteMock.mock.callCount(), 0);
    assert.equal(deleteManyMock.mock.callCount(), 0);
    assert.equal(updateMock.mock.callCount(), 0);
    assert.equal(updateManyMock.mock.callCount(), 0);
    assert.equal(captured.query?.dataHash?.length, 64);
});
