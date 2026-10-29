import test from 'node:test';
import assert from 'node:assert/strict';

import {
    REEL_COVER_TRANSFORM,
    REEL_EAGER,
    REEL_VIDEO_TRANSFORM,
    STORY_IMAGE_TRANSFORM,
    STORY_VIDEO_TRANSFORM,
    reelCoverUrl,
    reelVideoUrl,
    storyImageUrl,
    storyVideoUrl,
    waitForDerivative,
} from './mediaDerivativeService.js';
import { Deadline } from './pollService.js';

const PUBLIC_ID = 'meta-bru/user-1/reel-1';

function fakeClock() {
    let time = 0;
    return {
        now: () => time,
        sleep: async (ms: number) => {
            time += ms;
        },
    };
}

test('builds reel and Story URLs on the owning cloud', () => {
    const video = reelVideoUrl('demo', PUBLIC_ID);
    assert.ok(video.startsWith('https://res.cloudinary.com/demo/video/upload/'));
    assert.ok(video.includes(`/${REEL_VIDEO_TRANSFORM}/`));
    assert.match(video, /\/meta-bru\/user-1\/reel-1\.mp4/);

    const cover = reelCoverUrl('demo', PUBLIC_ID);
    assert.ok(cover.startsWith('https://res.cloudinary.com/demo/video/upload/'));
    assert.ok(cover.includes(`/${REEL_COVER_TRANSFORM}/`));
    assert.match(cover, /reel-1\.jpg/);

    const storyVideo = storyVideoUrl('demo', PUBLIC_ID);
    assert.ok(storyVideo.includes(`/${STORY_VIDEO_TRANSFORM}/`));
    assert.ok(storyVideo.includes('/du_60/'));
    assert.match(storyVideo, /reel-1\.mp4/);

    const storyImage = storyImageUrl('demo', 'meta-bru/user-1/image-1');
    assert.ok(
        storyImage.startsWith('https://res.cloudinary.com/demo/image/upload/')
    );
    assert.ok(storyImage.includes(`/${STORY_IMAGE_TRANSFORM}/`));
    assert.match(storyImage, /image-1\.jpg/);
});

test('asks Cloudinary for every derivative at upload', () => {
    assert.deepEqual(REEL_EAGER.split('|'), [
        `${REEL_VIDEO_TRANSFORM}/mp4`,
        `${REEL_COVER_TRANSFORM}/jpg`,
        `${STORY_VIDEO_TRANSFORM}/mp4`,
    ]);
});

test('waitForDerivative resolves once Cloudinary serves the file', async () => {
    const clock = fakeClock();
    const statuses = [423, 423, 200];
    const seen: string[] = [];

    const ready = await waitForDerivative(
        'https://res.cloudinary.com/demo/video/upload/reel.mp4',
        Deadline.after(600_000, clock),
        async (url) => {
            seen.push(url);
            return statuses.shift() ?? 200;
        }
    );

    assert.equal(ready, true);
    assert.equal(seen.length, 3);
    assert.equal(clock.now(), 10_000);
});

test('waitForDerivative gives up after its timeout', async () => {
    const clock = fakeClock();

    const ready = await waitForDerivative(
        'https://res.cloudinary.com/demo/video/upload/reel.mp4',
        Deadline.after(600_000, clock),
        async () => 423,
        12_000
    );

    assert.equal(ready, false);
    assert.equal(clock.now(), 12_000);
});
