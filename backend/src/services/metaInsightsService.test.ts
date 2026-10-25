import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { MetaApiError } = await import('./metaService.js');
const { fetchFacebookMetrics, fetchInstagramMetrics, sanitizeErrorMessage } =
    await import('./metaInsightsService.js');

test('normalizes Facebook fields and insights', async () => {
    const request = async (path: string) => {
        if (path.endsWith('/insights')) {
            return {
                data: [
                    { name: 'post_media_view', values: [{ value: 3100 }] },
                    { name: 'post_total_media_view_unique', total_value: { value: 2400 } },
                    { name: 'post_clicks', values: [{ value: 32 }] },
                ],
            };
        }
        return {
            reactions: { summary: { total_count: 120 } },
            comments: { summary: { total_count: 14 } },
            shares: { count: 8 },
        };
    };

    const result = await fetchFacebookMetrics('post-1', 'token', request);
    assert.equal(result.metrics.likes, 120);
    assert.equal(result.metrics.reach, 2400);
    assert.equal(result.metrics.views, 3100);
    assert.equal(result.metrics.clicks, 32);
    assert.equal(result.metrics.interactions, 142);
    assert.equal(result.status, 'ok');
});

test('retries Facebook insights when one metric is invalid', async () => {
    let insightCalls = 0;
    const request = async (path: string) => {
        if (path.endsWith('/insights')) {
            insightCalls += 1;
            if (insightCalls === 1) {
                throw new MetaApiError('invalid metric', 400, 100);
            }
            return {
                data: [
                    { name: 'post_media_view', values: [{ value: 100 }] },
                    { name: 'post_total_media_view_unique', total_value: { value: 80 } },
                ],
            };
        }
        return {};
    };

    const result = await fetchFacebookMetrics('post-1', 'token', request);
    assert.equal(insightCalls, 2);
    assert.equal(result.metrics.views, 100);
    assert.equal(result.metrics.reach, 80);
    assert.equal(result.status, 'partial');
});

test('marks Facebook permission errors without losing field metrics', async () => {
    const request = async (path: string) => {
        if (path.endsWith('/insights')) {
            throw new MetaApiError('permission denied', 403, 200);
        }
        return { reactions: { summary: { total_count: 3 } } };
    };

    const result = await fetchFacebookMetrics('post-1', 'token', request);
    assert.equal(result.metrics.likes, 3);
    assert.equal(result.status, 'permission_error');
});

test('normalizes Instagram insights after retrying an invalid metric', async () => {
    let insightCalls = 0;
    const request = async (path: string) => {
        if (!path.endsWith('/insights')) {
            throw new Error(`unexpected media fields request: ${path}`);
        }
        insightCalls += 1;
        if (insightCalls === 1) {
            throw new MetaApiError('invalid metric', 400, 100);
        }
        // Views are returned here so the test stays focused on the ladder retry;
        // the legacy impressions fallback has its own test below.
        return {
            data: [
                { name: 'reach', values: [{ value: 500 }] },
                { name: 'views', values: [{ value: 900 }] },
                { name: 'likes', values: [{ value: 40 }] },
                { name: 'comments', values: [{ value: 5 }] },
            ],
        };
    };

    const result = await fetchInstagramMetrics('media-1', 'token', request);
    assert.equal(insightCalls, 2);
    assert.equal(result.metrics.reach, 500);
    assert.equal(result.metrics.views, 900);
    assert.equal(result.metrics.likes, 40);
    assert.equal(result.metrics.comments, 5);
    assert.equal(result.status, 'partial');
});

test('retries Instagram insights for common invalid-metric variants', async () => {
    const variants = [
        'The following metric is invalid: views',
        'The following metrics are not valid: views',
        'Unknown metric: views',
    ];

    for (const message of variants) {
        const requested: string[] = [];
        const request = async (
            path: string,
            options?: { params?: { metric?: string } }
        ) => {
            if (!path.endsWith('/insights')) {
                throw new Error(`unexpected request: ${path}`);
            }
            requested.push(options?.params?.metric ?? '');
            if (requested.length === 1) {
                throw new MetaApiError(message, 400, 100);
            }
            return {
                data: [
                    { name: 'reach', values: [{ value: 70 }] },
                    { name: 'views', values: [{ value: 90 }] },
                    { name: 'likes', values: [{ value: 5 }] },
                    { name: 'comments', values: [{ value: 1 }] },
                ],
            };
        };

        const result = await fetchInstagramMetrics('media-1', 'token', request);
        assert.equal(requested.length, 2, message);
        assert.equal(
            requested[0],
            'reach,views,likes,comments,shares,saved',
            message
        );
        assert.equal(
            requested[1],
            'reach,likes,comments,shares,saved',
            message
        );
        assert.equal(result.metrics.reach, 70, message);
        assert.equal(result.metrics.views, 90, message);
    }
});

test('skips optional Instagram probes after a permission error', async () => {
    const requestedPaths: string[] = [];
    const request = async (path: string) => {
        requestedPaths.push(path);
        throw new MetaApiError('permission denied', 403, 200);
    };

    const result = await fetchInstagramMetrics('media-1', 'token', request);
    assert.equal(requestedPaths.length, 1);
    assert.equal(result.status, 'permission_error');
});

test('does not let an optional probe failure override primary Instagram success', async () => {
    const request = async (
        path: string,
        options?: { params?: { metric?: string } }
    ) => {
        if (!path.endsWith('/insights')) {
            throw new Error(`unexpected media fields request: ${path}`);
        }
        if (options?.params?.metric === 'impressions') {
            throw new MetaApiError('permission denied', 403, 200);
        }
        return {
            data: [
                { name: 'reach', values: [{ value: 300 }] },
                { name: 'likes', values: [{ value: 20 }] },
                { name: 'comments', values: [{ value: 4 }] },
            ],
        };
    };

    const result = await fetchInstagramMetrics('media-1', 'token', request);
    assert.equal(result.metrics.reach, 300);
    assert.equal(result.status, 'partial');
    assert.equal(result.error.length > 0, true);
    assert.equal(result.error.includes('permission denied'), true);
});

test('treats null and missing Facebook field values as null, not zero', async () => {
    const request = async (path: string) => {
        if (path.endsWith('/insights')) {
            throw new MetaApiError('invalid metric', 400, 100);
        }
        return {
            reactions: { summary: { total_count: null } },
            comments: { summary: { total_count: 5 } },
            shares: { count: 0 },
        };
    };

    const result = await fetchFacebookMetrics('post-1', 'token', request);
    assert.equal(result.metrics.likes, null);
    assert.equal(result.metrics.comments, 5);
    assert.equal(result.metrics.shares, 0);
    assert.equal(result.metrics.interactions, 5);
    assert.equal(result.availableMetrics.includes('likes'), false);
    assert.equal(result.availableMetrics.includes('shares'), true);
    assert.equal(result.status, 'partial');
});

test('falls back to the first value when total_value is null', async () => {
    const request = async (
        path: string,
        options?: { params?: { metric?: string } }
    ) => {
        if (path.endsWith('/insights')) {
            if (options?.params?.metric === 'impressions') {
                return { data: [] };
            }
            return {
                data: [
                    {
                        name: 'reach',
                        total_value: { value: null },
                        values: [{ value: 42 }],
                    },
                ],
            };
        }
        return {};
    };

    const result = await fetchInstagramMetrics('media-1', 'token', request);
    assert.equal(result.metrics.reach, 42);
});

test('rejects invalid Facebook field values', async () => {
    const invalidValues = [true, [], '   ', -5];

    for (const value of invalidValues) {
        const request = async (path: string) => {
            if (path.endsWith('/insights')) {
                return { data: [] };
            }
            return {
                reactions: { summary: { total_count: value } },
                comments: { summary: { total_count: 1 } },
                shares: { count: 0 },
            };
        };

        const result = await fetchFacebookMetrics('post-1', 'token', request);
        assert.equal(result.metrics.likes, null, String(value));
        assert.equal(result.metrics.comments, 1);
        assert.equal(result.metrics.shares, 0);
    }
});

test('uses Instagram media fields when likes and comments are missing', async () => {
    const requestedPaths: string[] = [];
    const request = async (path: string) => {
        requestedPaths.push(path);
        if (path.endsWith('/insights')) {
            return { data: [{ name: 'reach', values: [{ value: 250 }] }] };
        }
        return { like_count: 12, comments_count: 3 };
    };

    const result = await fetchInstagramMetrics('media-1', 'token', request);
    assert.equal(result.metrics.reach, 250);
    assert.equal(result.metrics.likes, 12);
    assert.equal(result.metrics.comments, 3);
    assert.equal(result.metrics.interactions, 15);
    assert.equal(result.status, 'partial');
    assert.equal(requestedPaths.includes('media-1'), true);
});

test('rethrows token errors from both fetchers', async () => {
    const tokenError = () => new MetaApiError('token expired', 400, 190, 0, true);

    const facebookRequest = async () => {
        throw tokenError();
    };
    await assert.rejects(
        () => fetchFacebookMetrics('post-1', 'token', facebookRequest),
        (error: unknown) => error instanceof MetaApiError && error.code === 190
    );

    const instagramRequest = async () => {
        throw tokenError();
    };
    await assert.rejects(
        () => fetchInstagramMetrics('media-1', 'token', instagramRequest),
        (error: unknown) => error instanceof MetaApiError && error.code === 190
    );
});

test('rethrows non-Meta errors from both fetchers', async () => {
    const boom = new Error('boom');

    await assert.rejects(
        () =>
            fetchFacebookMetrics('post-1', 'token', async () => {
                throw boom;
            }),
        (error: unknown) => error === boom
    );

    await assert.rejects(
        () =>
            fetchInstagramMetrics('media-1', 'token', async () => {
                throw boom;
            }),
        (error: unknown) => error === boom
    );
});

test('uses the spec Instagram insights ladder', async () => {
    const requested: string[] = [];
    const request = async (
        path: string,
        options?: { params?: { metric?: string } }
    ) => {
        if (path.endsWith('/insights')) {
            requested.push(options?.params?.metric ?? '');
            if (requested.length === 1) {
                throw new MetaApiError('invalid metric', 400, 100);
            }
            return {
                data: [
                    { name: 'reach', values: [{ value: 100 }] },
                    { name: 'views', values: [{ value: 200 }] },
                ],
            };
        }
        return {};
    };

    await fetchInstagramMetrics('media-1', 'token', request);
    assert.equal(requested[0], 'reach,views,likes,comments,shares,saved');
    assert.equal(requested[1], 'reach,likes,comments,shares,saved');
});

test('does not treat a metric requirement as a permission error', async () => {
    const request = async (path: string) => {
        if (path.endsWith('/insights')) {
            throw new MetaApiError(
                'This metric requires the Page to have at least 100 likes',
                400,
                100
            );
        }
        return { reactions: { summary: { total_count: 7 } } };
    };

    const result = await fetchFacebookMetrics('post-1', 'token', request);
    assert.equal(result.metrics.likes, 7);
    assert.notEqual(result.status, 'permission_error');
    assert.equal(result.status, 'partial');
});

test('treats a Page like requirement as an empty state', async () => {
    const request = async (path: string) => {
        if (path.endsWith('/insights')) {
            throw new MetaApiError(
                'This metric requires the Page to have at least 100 likes',
                400,
                100
            );
        }
        return { reactions: { summary: { total_count: 4 } } };
    };

    const result = await fetchFacebookMetrics('post-1', 'token', request);
    assert.equal(result.metrics.likes, 4);
    assert.equal(result.status, 'partial');
    assert.equal(result.error, '');
});

test('marks explicit permission errors as permission_error', async () => {
    for (const code of [10, 100]) {
        const request = async (path: string) => {
            if (path.endsWith('/insights')) {
                throw new MetaApiError('insufficient permission', 403, code);
            }
            return { reactions: { summary: { total_count: 2 } } };
        };

        const result = await fetchFacebookMetrics('post-1', 'token', request);
        assert.equal(result.metrics.likes, 2);
        assert.equal(result.status, 'permission_error');
    }
});

test('classifies code-100 missing-permission messages as permission errors', async () => {
    let insightCalls = 0;
    const request = async (path: string) => {
        if (path.endsWith('/insights')) {
            insightCalls += 1;
            throw new MetaApiError(
                "Unsupported get request. Object with ID 'p1' does not exist, cannot be loaded due to missing permissions, or does not support this operation.",
                403,
                100
            );
        }
        return { reactions: { summary: { total_count: 4 } } };
    };

    const result = await fetchFacebookMetrics('p1', 'token', request);
    assert.equal(insightCalls, 1);
    assert.equal(result.metrics.likes, 4);
    assert.equal(result.status, 'permission_error');
});

test('prefers permission_error over unavailable when both occur', async () => {
    const request = async (path: string) => {
        if (path.endsWith('/insights')) {
            throw new MetaApiError('socket hang up', 0, 1);
        }
        throw new MetaApiError('permission denied', 403, 200);
    };

    const result = await fetchFacebookMetrics('post-1', 'token', request);
    assert.equal(result.status, 'permission_error');
});

test('rethrows token errors from the legacy Instagram impressions probe', async () => {
    const request = async (
        path: string,
        options?: { params?: { metric?: string } }
    ) => {
        if (path.endsWith('/insights')) {
            if (options?.params?.metric === 'impressions') {
                throw new MetaApiError('token expired', 400, 190, 0, true);
            }
            return { data: [{ name: 'reach', values: [{ value: 50 }] }] };
        }
        return {};
    };

    await assert.rejects(
        () => fetchInstagramMetrics('media-1', 'token', request),
        (error: unknown) => error instanceof MetaApiError && error.code === 190
    );
});

test('preserves Instagram insights values when filling missing media fields', async () => {
    const request = async (path: string) => {
        if (path.endsWith('/insights')) {
            return { data: [{ name: 'likes', values: [{ value: 9 }] }] };
        }
        return { comments_count: 4 };
    };

    const result = await fetchInstagramMetrics('media-1', 'token', request);
    assert.equal(result.metrics.likes, 9);
    assert.equal(result.metrics.comments, 4);
});

test('sanitizes token-bearing URLs in stored errors', async () => {
    const request = async (path: string) => {
        if (path.endsWith('/insights')) {
            throw new MetaApiError(
                'Request failed for https://graph.facebook.com/v19.0/post-1/insights?access_token=SUPERSECRET&fields=id',
                500,
                1
            );
        }
        return { reactions: { summary: { total_count: 5 } } };
    };

    const result = await fetchFacebookMetrics('post-1', 'token', request);
    assert.equal(result.metrics.likes, 5);
    assert.equal(result.error.includes('SUPERSECRET'), false);
    assert.equal(result.error.includes('access_token'), false);
    assert.equal(result.error.includes('fields=id'), false);
    assert.equal(
        sanitizeErrorMessage('token access_token=abc123'),
        'token access_token=[redacted]'
    );
});

test('sanitizes encoded secrets and bare Meta tokens', () => {
    assert.equal(
        sanitizeErrorMessage(
            'request failed access_token%3DSUPERSECRET&fields=id'
        ),
        'request failed access_token%3D[redacted]&fields=id'
    );

    const bareToken = `EAA${'a'.repeat(24)}`;
    assert.equal(
        sanitizeErrorMessage(`request failed ${bareToken}`),
        'request failed [redacted]'
    );

    assert.equal(
        sanitizeErrorMessage('client_secret: abc123 fb_exchange_token=def456'),
        'client_secret: [redacted] fb_exchange_token=[redacted]'
    );
});

test('marks status unavailable on network errors while preserving field metrics', async () => {
    const request = async (path: string) => {
        if (path.endsWith('/insights')) {
            throw new MetaApiError('socket hang up', 0, 1);
        }
        return { reactions: { summary: { total_count: 11 } } };
    };

    const result = await fetchFacebookMetrics('post-1', 'token', request);
    assert.equal(result.metrics.likes, 11);
    assert.equal(result.status, 'unavailable');
});

test('does not treat rate-limit errors as network errors', async () => {
    const request = async (path: string) => {
        if (path.endsWith('/insights')) {
            throw new MetaApiError('rate limit', 400, 4);
        }
        return { reactions: { summary: { total_count: 6 } } };
    };

    const result = await fetchFacebookMetrics('post-1', 'token', request);
    assert.equal(result.metrics.likes, 6);
    assert.equal(result.status, 'partial');
});

test('falls back to legacy Instagram impressions for views', async () => {
    const request = async (
        path: string,
        options?: { params?: { metric?: string } }
    ) => {
        if (path.endsWith('/insights')) {
            if (options?.params?.metric === 'impressions') {
                return { data: [{ name: 'impressions', values: [{ value: 700 }] }] };
            }
            return { data: [{ name: 'reach', values: [{ value: 300 }] }] };
        }
        return {};
    };

    const result = await fetchInstagramMetrics('media-1', 'token', request);
    assert.equal(result.metrics.reach, 300);
    assert.equal(result.metrics.views, 700);
});

test('maps Instagram saved to saves', async () => {
    const request = async (path: string) => {
        if (path.endsWith('/insights')) {
            return {
                data: [
                    { name: 'reach', values: [{ value: 100 }] },
                    { name: 'views', values: [{ value: 200 }] },
                    { name: 'saved', values: [{ value: 3 }] },
                ],
            };
        }
        return {};
    };

    const result = await fetchInstagramMetrics('media-1', 'token', request);
    assert.equal(result.metrics.saves, 3);
});

test('computes engagement rate from reach and falls back to views', async () => {
    const fields = {
        reactions: { summary: { total_count: 20 } },
        comments: { summary: { total_count: 5 } },
        shares: { count: 5 },
    };

    const withReach = async (path: string) => {
        if (path.endsWith('/insights')) {
            return {
                data: [
                    { name: 'post_media_view', values: [{ value: 1000 }] },
                    { name: 'post_total_media_view_unique', total_value: { value: 200 } },
                ],
            };
        }
        return fields;
    };
    const reachResult = await fetchFacebookMetrics('post-1', 'token', withReach);
    assert.equal(reachResult.metrics.interactions, 30);
    assert.equal(reachResult.metrics.engagementRate, 15);

    const withZeroReach = async (path: string) => {
        if (path.endsWith('/insights')) {
            return {
                data: [
                    { name: 'post_media_view', values: [{ value: 1000 }] },
                    { name: 'post_total_media_view_unique', total_value: { value: 0 } },
                ],
            };
        }
        return fields;
    };
    const zeroReachResult = await fetchFacebookMetrics('post-1', 'token', withZeroReach);
    assert.equal(zeroReachResult.metrics.reach, 0);
    assert.equal(zeroReachResult.metrics.engagementRate, 3);

    const withViews = async (path: string) => {
        if (path.endsWith('/insights')) {
            return { data: [{ name: 'post_media_view', values: [{ value: 1000 }] }] };
        }
        return fields;
    };
    const viewsResult = await fetchFacebookMetrics('post-1', 'token', withViews);
    assert.equal(viewsResult.metrics.reach, null);
    assert.equal(viewsResult.metrics.engagementRate, 3);
});

test('excludes derived metrics from availableMetrics', async () => {
    const request = async (path: string) => {
        if (path.endsWith('/insights')) {
            return {
                data: [
                    { name: 'post_media_view', values: [{ value: 1000 }] },
                    { name: 'post_total_media_view_unique', total_value: { value: 500 } },
                    { name: 'post_clicks', values: [{ value: 3 }] },
                ],
            };
        }
        return {
            reactions: { summary: { total_count: 20 } },
            comments: { summary: { total_count: 5 } },
            shares: { count: 5 },
        };
    };

    const result = await fetchFacebookMetrics('post-1', 'token', request);
    assert.deepEqual(result.availableMetrics, [
        'likes',
        'comments',
        'shares',
        'reach',
        'views',
        'clicks',
    ]);
    assert.equal(result.availableMetrics.includes('interactions'), false);
    assert.equal(result.availableMetrics.includes('engagementRate'), false);
});

test('marks status unavailable when no metrics are returned', async () => {
    const request = async () => ({});

    const result = await fetchFacebookMetrics('post-1', 'token', request);
    assert.deepEqual(result.availableMetrics, []);
    assert.equal(result.status, 'unavailable');
});

test('retries the Facebook ladder when a metric has insufficient data', async () => {
    const requested: string[] = [];
    const request = async (
        path: string,
        options?: { params?: { metric?: string } }
    ) => {
        if (path.endsWith('/insights')) {
            requested.push(options?.params?.metric ?? '');
            if (requested.length === 1) {
                throw new MetaApiError(
                    'Not enough data to compute this metric',
                    400,
                    100
                );
            }
            return {
                data: [
                    { name: 'post_media_view', values: [{ value: 100 }] },
                    { name: 'post_total_media_view_unique', total_value: { value: 80 } },
                ],
            };
        }
        return {};
    };

    const result = await fetchFacebookMetrics('post-1', 'token', request);
    assert.equal(requested.length, 2);
    assert.equal(
        requested[1],
        'post_media_view,post_total_media_view_unique'
    );
    assert.equal(result.metrics.views, 100);
    assert.equal(result.metrics.reach, 80);
    assert.notEqual(result.status, 'permission_error');
});

test('retries the Instagram ladder when a metric has insufficient data', async () => {
    const requested: string[] = [];
    const request = async (
        path: string,
        options?: { params?: { metric?: string } }
    ) => {
        if (!path.endsWith('/insights')) return {};
        const metric = options?.params?.metric ?? '';
        requested.push(metric);
        if (requested.length === 1) {
            throw new MetaApiError(
                'Not enough data to compute this metric',
                400,
                100
            );
        }
        if (metric === 'impressions') return { data: [] };
        return {
            data: [
                { name: 'reach', values: [{ value: 300 }] },
                { name: 'likes', values: [{ value: 20 }] },
                { name: 'comments', values: [{ value: 4 }] },
            ],
        };
    };

    const result = await fetchInstagramMetrics('media-1', 'token', request);
    assert.equal(
        requested[1],
        'reach,likes,comments,shares,saved'
    );
    assert.equal(result.metrics.reach, 300);
    assert.equal(result.metrics.likes, 20);
    assert.equal(result.metrics.comments, 4);
    assert.notEqual(result.status, 'permission_error');
});

test('runs optional Instagram probes when every ladder has insufficient data', async () => {
    const ladderMetrics: string[] = [];
    let mediaFieldsCalls = 0;
    const request = async (
        path: string,
        options?: { params?: { metric?: string } }
    ) => {
        if (path.endsWith('/insights')) {
            const metric = options?.params?.metric ?? '';
            if (metric === 'impressions') {
                return {
                    data: [{ name: 'impressions', values: [{ value: 700 }] }],
                };
            }
            ladderMetrics.push(metric);
            throw new MetaApiError(
                'Not enough data to compute this metric',
                400,
                100
            );
        }
        mediaFieldsCalls += 1;
        return { like_count: 12, comments_count: 3 };
    };

    const result = await fetchInstagramMetrics('media-1', 'token', request);
    assert.equal(ladderMetrics.length, 4);
    assert.equal(mediaFieldsCalls, 1);
    assert.equal(result.metrics.views, 700);
    assert.equal(result.metrics.likes, 12);
    assert.equal(result.metrics.comments, 3);
});

test('does not treat insufficient data as a permission error', async () => {
    let insightCalls = 0;
    const request = async (path: string) => {
        if (path.endsWith('/insights')) {
            insightCalls += 1;
            if (insightCalls === 1) {
                throw new MetaApiError(
                    'Insufficient data to compute this metric',
                    400,
                    100
                );
            }
            return {
                data: [{ name: 'post_media_view', values: [{ value: 55 }] }],
            };
        }
        return { reactions: { summary: { total_count: 1 } } };
    };

    const result = await fetchFacebookMetrics('post-1', 'token', request);
    assert.equal(insightCalls, 2);
    assert.equal(result.metrics.views, 55);
    assert.notEqual(result.status, 'permission_error');
});

test('classifies insufficient permission as a permission error', async () => {
    let insightCalls = 0;
    const request = async (path: string) => {
        if (path.endsWith('/insights')) {
            insightCalls += 1;
            throw new MetaApiError(
                'Insufficient permission to access this resource',
                403,
                100
            );
        }
        return { reactions: { summary: { total_count: 1 } } };
    };

    const result = await fetchFacebookMetrics('post-1', 'token', request);
    assert.equal(insightCalls, 1);
    assert.equal(result.status, 'permission_error');
});

test('preserves a Facebook fields error when insights hit a Page like requirement', async () => {
    const request = async (path: string) => {
        if (path.endsWith('/insights')) {
            throw new MetaApiError(
                'This metric requires the Page to have at least 100 likes',
                400,
                100
            );
        }
        throw new MetaApiError('fields failed', 500, 1);
    };

    const result = await fetchFacebookMetrics('post-1', 'token', request);
    assert.deepEqual(result.availableMetrics, []);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.error.includes('fields failed'), true);
});

test('falls back to values when total_value is an empty string', async () => {
    const request = async (
        path: string,
        options?: { params?: { metric?: string } }
    ) => {
        if (path.endsWith('/insights')) {
            if (options?.params?.metric === 'impressions') {
                return { data: [] };
            }
            return {
                data: [
                    {
                        name: 'reach',
                        total_value: { value: '' },
                        values: [{ value: 42 }],
                    },
                ],
            };
        }
        return {};
    };

    const result = await fetchInstagramMetrics('media-1', 'token', request);
    assert.equal(result.metrics.reach, 42);
});

test('handles null fields payloads without throwing', async () => {
    const facebookRequest = async (path: string) => {
        if (path.endsWith('/insights')) return { data: [] };
        return null;
    };
    const facebookResult = await fetchFacebookMetrics(
        'post-1',
        'token',
        facebookRequest
    );
    assert.equal(facebookResult.metrics.likes, null);
    assert.equal(facebookResult.metrics.comments, null);
    assert.equal(facebookResult.metrics.shares, null);
    assert.equal(facebookResult.status, 'unavailable');

    const instagramRequest = async (path: string) => {
        if (path.endsWith('/insights')) return { data: [] };
        return null;
    };
    const instagramResult = await fetchInstagramMetrics(
        'media-1',
        'token',
        instagramRequest
    );
    assert.equal(instagramResult.metrics.likes, null);
    assert.equal(instagramResult.metrics.comments, null);
    assert.equal(instagramResult.status, 'unavailable');
});

test('sanitizes JSON-style secrets', () => {
    assert.equal(
        sanitizeErrorMessage('{"access_token":"SECRET"}'),
        '{"access_token":"[redacted]"}'
    );
    assert.equal(
        sanitizeErrorMessage('{"client_secret": "SECRET"}'),
        '{"client_secret": "[redacted]"}'
    );
    assert.equal(
        sanitizeErrorMessage("{'fb_exchange_token':'SECRET'}"),
        "{'fb_exchange_token':'[redacted]'}"
    );
});
