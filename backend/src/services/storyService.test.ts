import test from 'node:test';
import assert from 'node:assert/strict';
import type { IPostTarget } from '../models/postModel.js';
import type { MetaMediaDeps } from './metaMediaJobs.js';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { publishStories, storyPlatforms } = await import('./storyService.js');
const { storyImageUrl, storyVideoUrl } = await import('./mediaDerivativeService.js');
const { MetaApiError } = await import('./metaService.js');
const { Deadline, PUBLISH_RUN_MS } = await import('./pollService.js');

const USER_ID = '64b7f1c2a1b2c3d4e5f60719';
const IMAGE_ID = `meta-bru/${USER_ID}/image-1`;
const REEL_ID = `meta-bru/${USER_ID}/reel-1`;

function published(platform: 'facebook' | 'instagram'): IPostTarget {
    return {
        platform,
        status: 'published',
        externalId: `${platform}-post`,
        creationId: '',
        error: '',
        publishedAt: new Date(),
    };
}

function storyPost(overrides: Record<string, unknown> = {}) {
    let saves = 0;
    const post = {
        userId: USER_ID,
        mediaType: 'image',
        mediaPublicId: IMAGE_ID,
        status: 'published',
        lastError: '',
        targets: [published('facebook'), published('instagram')],
        storyTargets: [] as IPostTarget[],
        save: async () => {
            saves += 1;
            return post;
        },
        saves: () => saves,
        ...overrides,
    };
    return post;
}

const CONNECTION = { pageId: 'page-1', instagram: { id: 'ig-1' } };

function fakeDeps(overrides: Partial<MetaMediaDeps> = {}) {
    const calls: string[] = [];
    const containerParams: Array<Record<string, string | number>> = [];
    const photoUrls: string[] = [];
    const videoUploads: string[] = [];
    let time = 0;

    const deps: MetaMediaDeps = {
        instagram: {
            createContainer: async (_igUserId, _token, params) => {
                calls.push('ig:create');
                containerParams.push(params);
                return 'container-1';
            },
            containerState: async () => ({ statusCode: 'FINISHED', status: '' }),
            publishContainer: async () => {
                calls.push('ig:publish');
                return 'ig-story-1';
            },
        },
        instagramUsage: async () => ({ quotaUsage: 0, quotaTotal: 100 }),
        facebookVideo: {
            start: async (_pageId, _token, edge) => {
                calls.push(`fb:start:${edge}`);
                return {
                    videoId: 'story-video-1',
                    uploadUrl: 'https://rupload.facebook.com/video-upload/v26.0/story-video-1',
                };
            },
            upload: async (_uploadUrl, _token, fileUrl) => {
                calls.push('fb:upload');
                videoUploads.push(fileUrl);
            },
            finish: async (_pageId, _token, edge) => {
                calls.push(`fb:finish:${edge}`);
                return { postId: 'fb-video-story' };
            },
            status: async () => {
                calls.push('fb:status');
                return {
                    videoStatus: 'ready',
                    uploading: 'complete',
                    processing: 'complete',
                    publishing: 'complete',
                    error: '',
                };
            },
        },
        facebookPhoto: {
            uploadUnpublished: async (_pageId, _token, imageUrl) => {
                calls.push('fb:photo');
                photoUrls.push(imageUrl);
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

    return { deps, calls, containerParams, photoUrls, videoUploads };
}

function share(post: ReturnType<typeof storyPost>, deps: MetaMediaDeps, onTokenError = async () => {}) {
    return publishStories(
        {
            post: post as never,
            connection: CONNECTION as never,
            accessToken: 'page-token',
            platforms: ['facebook', 'instagram'],
            deadline: Deadline.after(PUBLISH_RUN_MS, deps.clock),
            onTokenError,
        },
        deps
    );
}

test('storyPlatforms keeps published platforms without a published Story', () => {
    const post = storyPost({
        targets: [published('facebook'), { ...published('instagram'), status: 'failed' }],
        storyTargets: [{ ...published('facebook'), status: 'failed' }],
    });

    assert.deepEqual(storyPlatforms(post as never, ['facebook', 'instagram', 'facebook']), [
        'facebook',
    ]);

    post.storyTargets = [published('facebook')];
    assert.deepEqual(storyPlatforms(post as never, ['facebook', 'instagram']), []);
});

test('shares an image post to Instagram and Facebook Stories', async () => {
    const post = storyPost();
    const { deps, calls, containerParams, photoUrls } = fakeDeps();

    await share(post, deps);

    const storyUrl = storyImageUrl('demo', IMAGE_ID);
    assert.deepEqual(calls, ['fb:photo', 'fb:photo-story', 'ig:create', 'ig:publish']);
    assert.deepEqual(photoUrls, [storyUrl]);
    assert.deepEqual(containerParams[0], { media_type: 'STORIES', image_url: storyUrl });
    assert.deepEqual(
        post.storyTargets.map((target) => [target.platform, target.status, target.externalId]),
        [
            ['facebook', 'published', 'fb-photo-story'],
            ['instagram', 'published', 'ig-story-1'],
        ]
    );
    assert.equal(post.status, 'published');
});

test('shares a reel as a 9:16 video Story', async () => {
    const post = storyPost({ mediaType: 'reel', mediaPublicId: REEL_ID });
    const { deps, calls, containerParams, videoUploads } = fakeDeps();

    await share(post, deps);

    const storyUrl = storyVideoUrl('demo', REEL_ID);
    assert.deepEqual(calls, [
        `wait:${storyUrl}`,
        'fb:start:video_stories',
        'fb:upload',
        'fb:finish:video_stories',
        'ig:create',
        'ig:publish',
    ]);
    assert.deepEqual(videoUploads, [storyUrl]);
    assert.deepEqual(containerParams[0], { media_type: 'STORIES', video_url: storyUrl });
    assert.equal(post.storyTargets[0]?.externalId, 'fb-video-story');
    assert.equal(post.storyTargets[1]?.status, 'published');
});

test('fails Stories for media not uploaded through Meta-Bru', async () => {
    const post = storyPost({ mediaPublicId: '' });
    const { deps, calls } = fakeDeps();

    await share(post, deps);

    assert.deepEqual(calls, []);
    assert.deepEqual(
        post.storyTargets.map((target) => target.status),
        ['failed', 'failed']
    );
    assert.equal(post.storyTargets[0]?.error, 'Stories need an image uploaded through Meta-Bru.');
    assert.equal(post.status, 'published');
});

test('fails reel Stories while Cloudinary is still preparing them', async () => {
    const post = storyPost({ mediaType: 'reel', mediaPublicId: REEL_ID });
    const { deps } = fakeDeps({ waitForDerivative: async () => false });

    await share(post, deps);

    assert.match(String(post.storyTargets[0]?.error), /still preparing this Story/);
    assert.equal(post.storyTargets[1]?.status, 'failed');
});

test('only shares platforms whose Story has not published', async () => {
    const post = storyPost({ storyTargets: [{ ...published('instagram'), externalId: 'old-story' }] });
    const { deps, calls } = fakeDeps();

    await share(post, deps);

    assert.deepEqual(calls, ['fb:photo', 'fb:photo-story']);
    assert.equal(post.storyTargets.find((t) => t.platform === 'instagram')?.externalId, 'old-story');
});

test('reports a Meta token error and keeps the post published', async () => {
    const post = storyPost({ targets: [published('instagram')] });
    let tokenErrors = 0;
    const { deps } = fakeDeps();
    deps.instagram.createContainer = async () => {
        throw new MetaApiError('Invalid OAuth access token', 400, 190, 0, true);
    };

    await share(post, deps, async () => {
        tokenErrors += 1;
    });

    assert.equal(tokenErrors, 1);
    assert.equal(post.storyTargets[0]?.status, 'failed');
    assert.equal(post.storyTargets[0]?.error, 'Invalid OAuth access token');
    assert.equal(post.status, 'published');
});
