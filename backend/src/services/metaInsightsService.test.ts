import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { MetaApiError } = await import('./metaService.js');
const { fetchFacebookMetrics, fetchInstagramMetrics } = await import(
    './metaInsightsService.js'
);

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

test('normalizes Instagram insights and falls back to media fields', async () => {
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
