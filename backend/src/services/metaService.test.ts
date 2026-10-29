import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { MetaApiError, parseFacebookVideoStatus, uploadFacebookVideoFromUrl } =
    await import('./metaService.js');

const UPLOAD_URL = 'https://rupload.facebook.com/video-upload/v26.0/video-1';
const FILE_URL = 'https://res.cloudinary.com/demo/video/upload/reel-1.mp4';

afterEach(() => mock.restoreAll());

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

test('reads every Facebook video phase', () => {
    const status = parseFacebookVideoStatus({
        status: {
            video_status: 'processing',
            uploading_phase: { status: 'complete' },
            processing_phase: { status: 'in_progress' },
            publishing_phase: { status: 'not_started' },
        },
    });

    assert.deepEqual(status, {
        videoStatus: 'processing',
        uploading: 'complete',
        processing: 'in_progress',
        publishing: 'not_started',
        error: '',
    });
});

test('reports the first Facebook phase error', () => {
    const status = parseFacebookVideoStatus({
        status: {
            video_status: 'error',
            uploading_phase: { status: 'complete' },
            processing_phase: {
                status: 'error',
                errors: [{ code: 1363040, message: 'Aspect ratio is not supported' }],
            },
        },
    });

    assert.equal(status.error, 'Aspect ratio is not supported');
});

test('reports a failed or expired Facebook video', () => {
    assert.equal(
        parseFacebookVideoStatus({ status: { video_status: 'expired' } }).error,
        'Facebook video upload expired'
    );
    assert.equal(
        parseFacebookVideoStatus({ status: { video_status: 'upload_failed' } })
            .error,
        'Facebook video upload failed'
    );
    assert.equal(parseFacebookVideoStatus({}).error, '');
});

test('asks Meta to fetch a hosted video', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () =>
        jsonResponse({ success: true })
    );

    await uploadFacebookVideoFromUrl(UPLOAD_URL, 'page-token', FILE_URL);

    assert.equal(fetchMock.mock.callCount(), 1);
    const [url, init] = fetchMock.mock.calls[0]!.arguments as [
        string,
        RequestInit,
    ];
    assert.equal(url, UPLOAD_URL);
    assert.equal(init.method, 'POST');
    assert.deepEqual(init.headers, {
        Authorization: 'OAuth page-token',
        file_url: FILE_URL,
    });
});

test('reports a failed hosted upload with Meta’s message', async () => {
    mock.method(globalThis, 'fetch', async () =>
        jsonResponse({ debug_info: { message: 'Video URL is not reachable' } }, 400)
    );

    await assert.rejects(
        () => uploadFacebookVideoFromUrl(UPLOAD_URL, 'page-token', FILE_URL),
        (error: unknown) =>
            error instanceof MetaApiError &&
            error.message === 'Video URL is not reachable' &&
            error.status === 400
    );
});

test('never sends the Page token to a host other than Facebook', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => {
        throw new Error('fetch should not be called');
    });

    await assert.rejects(
        () =>
            uploadFacebookVideoFromUrl(
                'https://uploads.example.com/video-1',
                'page-token',
                FILE_URL
            ),
        (error: unknown) => error instanceof MetaApiError
    );
    assert.equal(fetchMock.mock.callCount(), 0);
});
