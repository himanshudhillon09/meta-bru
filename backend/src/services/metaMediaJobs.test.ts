import test from 'node:test';
import assert from 'node:assert/strict';
import type { IPostTarget } from '../models/postModel.js';
import type {
    FacebookVideoApi,
    FacebookVideoStatus,
    InstagramContainerState,
    InstagramMediaApi,
} from './metaService.js';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { publishFacebookVideoJob, publishInstagramContainerJob } = await import(
    './metaMediaJobs.js'
);
const { MetaApiError } = await import('./metaService.js');
const { Deadline, PUBLISH_RUN_MS } = await import('./pollService.js');

function fakeClock() {
    let time = 0;
    return {
        now: () => time,
        sleep: async (ms: number) => {
            time += ms;
        },
    };
}

function deadline() {
    return Deadline.after(PUBLISH_RUN_MS, fakeClock());
}

function target(overrides: Partial<IPostTarget> = {}): IPostTarget {
    return {
        platform: 'instagram',
        status: 'publishing',
        externalId: '',
        creationId: '',
        error: '',
        publishedAt: null,
        ...overrides,
    };
}

function fakeInstagram(states: InstagramContainerState[]) {
    const calls: string[] = [];
    const params: Array<Record<string, string | number>> = [];
    const api: InstagramMediaApi = {
        createContainer: async (_igUserId, _token, containerParams) => {
            calls.push('create');
            params.push(containerParams);
            return 'container-1';
        },
        containerState: async () => {
            calls.push('state');
            return states.length > 1 ? states.shift()! : states[0]!;
        },
        publishContainer: async () => {
            calls.push('publish');
            return 'ig-media-1';
        },
    };
    return { api, calls, params };
}

function state(statusCode: string, status = ''): InstagramContainerState {
    return { statusCode, status };
}

const REEL_JOB = {
    igUserId: 'ig-1',
    accessToken: 'page-token',
    params: { media_type: 'REELS', video_url: 'https://cdn.example/reel.mp4' },
    waitMs: 5 * 60_000,
    stillProcessingMessage: 'Instagram is still processing this reel.',
};

test('creates, waits for, and publishes an Instagram container', async () => {
    const { api, calls, params } = fakeInstagram([
        state('IN_PROGRESS'),
        state('IN_PROGRESS'),
        state('FINISHED'),
    ]);
    const reelTarget = target();

    await publishInstagramContainerJob({ ...REEL_JOB, target: reelTarget }, api, deadline());

    assert.deepEqual(calls, ['create', 'state', 'state', 'state', 'publish']);
    assert.deepEqual(params[0], REEL_JOB.params);
    assert.equal(reelTarget.status, 'published');
    assert.equal(reelTarget.externalId, 'ig-media-1');
    assert.equal(reelTarget.creationId, 'container-1');
    assert.ok(reelTarget.publishedAt instanceof Date);
});

test('keeps the container when Instagram is still processing at the timeout', async () => {
    const { api } = fakeInstagram([state('IN_PROGRESS')]);
    const reelTarget = target();

    await assert.rejects(
        () =>
            publishInstagramContainerJob(
                { ...REEL_JOB, waitMs: 30_000, target: reelTarget },
                api,
                deadline()
            ),
        (error: unknown) =>
            error instanceof MetaApiError &&
            error.message === REEL_JOB.stillProcessingMessage &&
            error.status === 504
    );
    assert.equal(reelTarget.creationId, 'container-1');
});

test('marks a container that already published without creating another', async () => {
    const { api, calls } = fakeInstagram([state('PUBLISHED')]);
    const reelTarget = target({ creationId: 'container-1' });

    await publishInstagramContainerJob({ ...REEL_JOB, target: reelTarget }, api, deadline());

    assert.deepEqual(calls, ['state']);
    assert.equal(reelTarget.status, 'published');
});

test('recreates an expired Instagram container', async () => {
    const { api, calls } = fakeInstagram([state('EXPIRED'), state('FINISHED')]);
    const reelTarget = target({ creationId: 'old-container' });

    await publishInstagramContainerJob({ ...REEL_JOB, target: reelTarget }, api, deadline());

    assert.deepEqual(calls, ['state', 'create', 'state', 'publish']);
    assert.equal(reelTarget.creationId, 'container-1');
    assert.equal(reelTarget.status, 'published');
});

test('clears a container Instagram rejected', async () => {
    const { api } = fakeInstagram([state('ERROR', 'Error: unsupported video codec')]);
    const reelTarget = target();

    await assert.rejects(
        () => publishInstagramContainerJob({ ...REEL_JOB, target: reelTarget }, api, deadline()),
        (error: unknown) =>
            error instanceof MetaApiError &&
            error.message === 'Error: unsupported video codec' &&
            error.status === 422
    );
    assert.equal(reelTarget.creationId, '');
});

function videoStatus(overrides: Partial<FacebookVideoStatus> = {}): FacebookVideoStatus {
    return {
        videoStatus: 'processing',
        uploading: 'complete',
        processing: 'in_progress',
        publishing: 'not_started',
        error: '',
        ...overrides,
    };
}

function fakeFacebook(statuses: FacebookVideoStatus[], finishPostId = '') {
    const calls: string[] = [];
    const finishParams: Array<Record<string, string>> = [];
    const uploads: Array<{ uploadUrl: string; token: string; fileUrl: string }> = [];
    const api: FacebookVideoApi = {
        start: async (_pageId, _token, edge) => {
            calls.push(`start:${edge}`);
            return {
                videoId: 'video-1',
                uploadUrl: 'https://rupload.facebook.com/video-upload/v26.0/video-1',
            };
        },
        upload: async (uploadUrl, token, fileUrl) => {
            calls.push('upload');
            uploads.push({ uploadUrl, token, fileUrl });
        },
        finish: async (_pageId, _token, edge, params) => {
            calls.push(`finish:${edge}`);
            finishParams.push(params);
            return { postId: finishPostId };
        },
        status: async () => {
            calls.push('status');
            return statuses.length > 1 ? statuses.shift()! : statuses[0]!;
        },
    };
    return { api, calls, finishParams, uploads };
}

const REEL_VIDEO_JOB = {
    pageId: 'page-1',
    accessToken: 'page-token',
    edge: 'video_reels' as const,
    fileUrl: 'https://cdn.example/reel.mp4',
    finishParams: { video_state: 'PUBLISHED', description: 'Reel caption' },
    statusWaitMs: 2 * 60_000,
};

test('uploads, finishes, and waits for a Facebook reel', async () => {
    const { api, calls, finishParams, uploads } = fakeFacebook([
        videoStatus({ publishing: 'in_progress' }),
        videoStatus({ processing: 'complete', publishing: 'complete' }),
    ]);
    const reelTarget = target({ platform: 'facebook' });

    await publishFacebookVideoJob({ ...REEL_VIDEO_JOB, target: reelTarget }, api, deadline());

    assert.deepEqual(calls, [
        'start:video_reels',
        'upload',
        'finish:video_reels',
        'status',
        'status',
    ]);
    assert.deepEqual(uploads[0], {
        uploadUrl: 'https://rupload.facebook.com/video-upload/v26.0/video-1',
        token: 'page-token',
        fileUrl: 'https://cdn.example/reel.mp4',
    });
    assert.deepEqual(finishParams[0], {
        video_id: 'video-1',
        video_state: 'PUBLISHED',
        description: 'Reel caption',
    });
    assert.equal(reelTarget.status, 'published');
    assert.equal(reelTarget.externalId, 'video-1');
    assert.equal(reelTarget.creationId, 'video-1');
});

test('clears the video id when Facebook rejects the reel', async () => {
    const { api } = fakeFacebook([
        videoStatus({ processing: 'error', error: 'Aspect ratio is not supported' }),
    ]);
    const reelTarget = target({ platform: 'facebook' });

    await assert.rejects(
        () => publishFacebookVideoJob({ ...REEL_VIDEO_JOB, target: reelTarget }, api, deadline()),
        (error: unknown) =>
            error instanceof MetaApiError &&
            error.message === 'Aspect ratio is not supported' &&
            error.status === 422
    );
    assert.equal(reelTarget.creationId, '');
});

test('marks a Facebook video that already published', async () => {
    const { api, calls } = fakeFacebook([videoStatus({ publishing: 'complete' })]);
    const reelTarget = target({ platform: 'facebook', creationId: 'video-1' });

    await publishFacebookVideoJob({ ...REEL_VIDEO_JOB, target: reelTarget }, api, deadline());

    assert.deepEqual(calls, ['status']);
    assert.equal(reelTarget.status, 'published');
    assert.equal(reelTarget.externalId, 'video-1');
});

test('does not finish twice while Facebook is already publishing', async () => {
    const { api, calls } = fakeFacebook([
        videoStatus({ publishing: 'in_progress' }),
        videoStatus({ publishing: 'complete' }),
    ]);
    const reelTarget = target({ platform: 'facebook', creationId: 'video-1' });

    await publishFacebookVideoJob({ ...REEL_VIDEO_JOB, target: reelTarget }, api, deadline());

    assert.deepEqual(calls, ['status', 'status']);
    assert.equal(reelTarget.status, 'published');
});

test('starts again when an earlier Facebook upload never completed', async () => {
    const { api, calls } = fakeFacebook(
        [videoStatus({ uploading: 'in_progress' })],
        'story-post-1'
    );
    const storyTarget = target({ platform: 'facebook', creationId: 'old-video' });

    await publishFacebookVideoJob(
        {
            ...REEL_VIDEO_JOB,
            edge: 'video_stories',
            finishParams: {},
            statusWaitMs: 0,
            target: storyTarget,
        },
        api,
        deadline()
    );

    assert.deepEqual(calls, [
        'status',
        'start:video_stories',
        'upload',
        'finish:video_stories',
    ]);
    assert.equal(storyTarget.creationId, 'video-1');
    assert.equal(storyTarget.externalId, 'story-post-1');
});
