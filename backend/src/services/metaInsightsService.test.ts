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
    const request = async (
        path: string,
        options?: { params?: { metric?: string } }
    ) => {
        if (path.endsWith('/insights')) {
            // The optional legacy `impressions` probe is not part of the ladder.
            if (options?.params?.metric !== 'impressions') insightCalls += 1;
            if (insightCalls === 1) {
                throw new MetaApiError('invalid metric', 400, 100);
            }
            return {
                data: [
                    { name: 'reach', values: [{ value: 500 }] },
                    { name: 'likes', values: [{ value: 40 }] },
                    { name: 'comments', values: [{ value: 5 }] },
                ],
            };
        }
        return { like_count: 40, comments_count: 5 };
    };

    const result = await fetchInstagramMetrics('media-1', 'token', request);
    assert.equal(insightCalls, 2);
    assert.equal(result.metrics.reach, 500);
    assert.equal(result.metrics.likes, 40);
    assert.equal(result.metrics.comments, 5);
    assert.equal(result.status, 'partial');
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
    assert.equal(result.error.includes('access_token=SUPERSECRET'), false);
    assert.equal(result.error.includes('?'), false);
    assert.equal(
        sanitizeErrorMessage('token access_token=abc123'),
        'token access_token=[redacted]'
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
