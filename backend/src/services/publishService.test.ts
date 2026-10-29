import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { MetaMediaDeps } from './metaMediaJobs.js';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { publishPost } = await import('./publishService.js');
const { SocialConnection } = await import('../models/socialConnectionModel.js');
const { User } = await import('../models/userModel.js');
const { encryptSecret } = await import('./cryptoService.js');

const USER_ID = '64b7f1c2a1b2c3d4e5f60719';
const CONNECTION_ID = '64b7f1c2a1b2c3d4e5f60718';

afterEach(() => mock.restoreAll());

test('publishPost does not mark a disconnected Page as needs_reauth', async () => {
    const connection = {
        _id: { toString: () => CONNECTION_ID },
        tokenStatus: 'disconnected',
        pageAccessTokenEnc: '',
    };
    const post = {
        userId: USER_ID,
        platforms: { facebook: true, instagram: false },
        targets: [],
        status: 'queued',
        lastError: '',
        save: async () => post,
    };

    // No Meta credentials -> publishPost takes the META_NOT_CONFIGURED branch,
    // which calls markConnectionNeedsReauth.
    mock.method(User, 'findById', () => ({
        select: async () => ({ credentialsEnc: '' }),
    }));

    let capturedFilter: Record<string, unknown> | undefined;
    mock.method(SocialConnection, 'updateOne', (filter: unknown) => {
        capturedFilter = filter as Record<string, unknown>;
        return { matchedCount: 0 };
    });

    await publishPost(post as never, connection as never);

    assert.equal(connection.tokenStatus, 'disconnected');
    assert.ok(capturedFilter);
    assert.deepEqual(capturedFilter.tokenStatus, { $ne: 'disconnected' });
});

const REEL_URL = 'https://res.cloudinary.com/demo/video/upload/c_pad/v1/meta-bru/user/reel-1.mp4';

function metaUser() {
    return {
        select: async () => ({
            credentialsEnc: encryptSecret(
                JSON.stringify({ meta: { appId: 'app-1', appSecret: 'app-secret' } })
            ),
        }),
    };
}

function reelPost(overrides: Record<string, unknown> = {}) {
    const post: Record<string, unknown> & { targets: Array<Record<string, unknown>> } = {
        userId: USER_ID,
        mediaType: 'reel',
        mediaUrl: REEL_URL,
        mediaPublicId: `meta-bru/${USER_ID}/reel-1`,
        mediaDuration: 30,
        caption: 'Reel caption',
        platforms: { facebook: false, instagram: true },
        targets: [],
        storyTargets: [],
        shareToStory: false,
        status: 'publishing',
        attempts: 0,
        lastError: '',
        publishedAt: null,
        save: async () => post,
        ...overrides,
    };
    return post;
}

function reelConnection() {
    return {
        _id: { toString: () => CONNECTION_ID },
        tokenStatus: 'active',
        pageId: 'page-1',
        instagram: { id: 'ig-1' },
        pageAccessTokenEnc: encryptSecret('page-token'),
    };
}

function fakeDeps(overrides: Partial<MetaMediaDeps> = {}) {
    const calls: string[] = [];
    const containerParams: Array<Record<string, string | number>> = [];
    const finishParams: Array<Record<string, string>> = [];
    let time = 0;
    let containers = 0;

    const deps: MetaMediaDeps = {
        instagram: {
            createContainer: async (_igUserId, _token, params) => {
                calls.push(`ig:create:${params.media_type}`);
                containerParams.push(params);
                containers += 1;
                return `container-${containers}`;
            },
            containerState: async () => ({ statusCode: 'FINISHED', status: '' }),
            publishContainer: async (_igUserId, _token, creationId) => {
                calls.push(`ig:publish:${creationId}`);
                return `ig-media-${creationId}`;
            },
        },
        instagramUsage: async () => ({ quotaUsage: 0, quotaTotal: 100 }),
        facebookVideo: {
            start: async (_pageId, _token, edge) => {
                calls.push(`fb:start:${edge}`);
                return {
                    videoId: `${edge}-video`,
                    uploadUrl: 'https://rupload.facebook.com/video-upload/v26.0/video',
                };
            },
            upload: async (_uploadUrl, _token, fileUrl) => {
                calls.push(`fb:upload:${fileUrl}`);
            },
            finish: async (_pageId, _token, edge, params) => {
                calls.push(`fb:finish:${edge}`);
                finishParams.push(params);
                return { postId: edge === 'video_stories' ? 'fb-story-post' : '' };
            },
            status: async () => ({
                videoStatus: 'ready',
                uploading: 'complete',
                processing: 'complete',
                publishing: 'complete',
                error: '',
            }),
        },
        facebookPhoto: {
            uploadUnpublished: async () => {
                calls.push('fb:photo');
                return 'photo-1';
            },
            publishStory: async () => {
                calls.push('fb:photo-story');
                return { postId: 'fb-photo-story' };
            },
        },
        waitForDerivative: async (url) => {
            calls.push(`wait:${url}`);
            return true;
        },
        cloudName: async () => 'demo',
        clock: {
            now: () => time,
            sleep: async (ms) => {
                time += ms;
            },
        },
        ...overrides,
    };

    return { deps, calls, containerParams, finishParams };
}

test('publishPost publishes an Instagram reel through a REELS container', async () => {
    mock.method(User, 'findById', () => metaUser());
    const post = reelPost();
    const { deps, calls, containerParams } = fakeDeps();

    await publishPost(post as never, reelConnection() as never, {}, deps);

    assert.deepEqual(calls, [
        `wait:${REEL_URL}`,
        'ig:create:REELS',
        'ig:publish:container-1',
    ]);
    assert.deepEqual(containerParams[0], {
        media_type: 'REELS',
        video_url: REEL_URL,
        caption: 'Reel caption',
        share_to_feed: 'true',
        thumb_offset: 1000,
    });
    assert.equal(post.status, 'published');
    assert.equal(post.targets[0]?.externalId, 'ig-media-container-1');
});

test('publishPost uploads a Facebook reel and keeps its video id', async () => {
    mock.method(User, 'findById', () => metaUser());
    const post = reelPost({ platforms: { facebook: true, instagram: false } });
    const { deps, calls, finishParams } = fakeDeps();

    await publishPost(post as never, reelConnection() as never, {}, deps);

    assert.deepEqual(calls, [
        `wait:${REEL_URL}`,
        'fb:start:video_reels',
        `fb:upload:${REEL_URL}`,
        'fb:finish:video_reels',
    ]);
    assert.deepEqual(finishParams[0], {
        video_id: 'video_reels-video',
        video_state: 'PUBLISHED',
        description: 'Reel caption',
    });
    assert.equal(post.status, 'published');
    assert.equal(post.targets[0]?.creationId, 'video_reels-video');
    assert.equal(post.targets[0]?.externalId, 'video_reels-video');
});

test('publishPost fails a Facebook reel over 90 seconds without calling Meta', async () => {
    mock.method(User, 'findById', () => metaUser());
    const post = reelPost({
        mediaDuration: 120,
        platforms: { facebook: true, instagram: false },
    });
    const { deps, calls } = fakeDeps();

    await publishPost(post as never, reelConnection() as never, {}, deps);

    assert.deepEqual(calls, []);
    assert.equal(post.status, 'failed');
    assert.match(String(post.targets[0]?.error), /at most 90 seconds/);
});

test('publishPost fails cleanly while Cloudinary is still preparing a reel', async () => {
    mock.method(User, 'findById', () => metaUser());
    const post = reelPost({ platforms: { facebook: true, instagram: false } });
    const { deps, calls } = fakeDeps({ waitForDerivative: async () => false });

    await publishPost(post as never, reelConnection() as never, {}, deps);

    assert.deepEqual(calls, []);
    assert.equal(post.status, 'failed');
    assert.match(String(post.targets[0]?.error), /still preparing this reel/);
    assert.doesNotMatch(String(post.targets[0]?.error), /Check the Page/);
});
