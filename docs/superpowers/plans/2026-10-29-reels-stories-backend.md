# Reels and Story Sharing — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the API accept reels uploaded straight from the browser to the user's Cloudinary account, publish them to Facebook and Instagram Reels, share published posts and reels to Stories, list videos in Storage, and remove a deleted post's Cloudinary file.

**Architecture:** Reels are `Post` documents with `mediaType: 'reel'`, so the queue, scheduler, locks, and retries are reused. Cloudinary builds three eager derivatives at upload (Meta MP4, cover JPG, Story MP4) whose transformation strings live in one module. Meta's resumable video and container flows live in `metaMediaJobs`, behind small API interfaces that tests replace with fakes. Stories are a separate `storyTargets` list that never changes the post's own status.

**Tech Stack:** Node 22, Express 5, Mongoose 9, Zod 4, Cloudinary Node SDK 2.11, Meta Graph API v26.0, `node:test` with `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-29-reels-and-story-sharing-design.md`

**Frontend plan:** `docs/superpowers/plans/2026-10-29-reels-stories-frontend.md` (run after this one).

**Working directory:** `/Users/himanshudhillon/Development/meta-bru` on branch `feat/reels-stories`. Commits use the repo-local identity `Himanshu Dhillon <himanshu.dhillon09@gmail.com>`. Do not push.

**Conventions:**

- Backend tests: `cd backend && node --import tsx --test <file>`; full suite `cd backend && npm test`.
- Backend types: `cd backend && npx tsc --noEmit -p .` (test files are excluded from `tsc`).
- Test files that import code reaching `config/env.ts` must set `JWT_SECRET` and `TOKEN_ENCRYPTION_KEY` before a dynamic `import()`, as the existing tests do.
- `tsconfig` has `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`; index reads need `?.` or a guard.
- Commit messages have a subject and optional body only. **Do not add `Co-Authored-By` or any other AI attribution lines.**

---

## File Structure

| File | Responsibility |
| --- | --- |
| `backend/src/models/postModel.ts` | Add `mediaType: 'reel'`, `mediaDuration`, `mediaCoverUrl`, `shareToStory`, `storyTargets`. |
| `backend/src/models/postModel.test.ts` (new) | Schema defaults and validation for the new fields. |
| `backend/src/services/pollService.ts` (new) | `Clock`, `Deadline`, `pollUntil`, `PUBLISH_RUN_MS`. No I/O. |
| `backend/src/services/pollService.test.ts` (new) | Polling and deadline rules with a fake clock. |
| `backend/src/services/mediaDerivativeService.ts` (new) | Reel limits, transformation strings, eager list, derivative URLs, `waitForDerivative`. |
| `backend/src/services/mediaDerivativeService.test.ts` (new) | URL shapes and readiness polling. |
| `backend/src/services/metaService.ts` | Instagram container and Facebook video/photo-story Graph wrappers, API interfaces, default API objects. |
| `backend/src/services/metaService.test.ts` (new) | Facebook video status parsing and the hosted-upload request. |
| `backend/src/services/metaMediaJobs.ts` (new) | `MetaMediaDeps`, resumable Instagram container job, resumable Facebook video job, quota check. |
| `backend/src/services/metaMediaJobs.test.ts` (new) | Create/poll/publish, timeouts, and resume paths for both jobs. |
| `backend/src/services/videoUploadService.ts` (new) | Signed upload parameters, reel validation, loading a reel from Cloudinary. |
| `backend/src/services/videoUploadService.test.ts` (new) | Signature, validation, ownership, and rejected-upload cleanup. |
| `backend/src/controllers/mediaController.ts` | `createVideoSignature`, `registerVideo`. |
| `backend/src/controllers/mediaController.test.ts` | Signature endpoint test. |
| `backend/src/routes/mediaRoutes.ts` | `POST /video-signature`, `POST /videos`. |
| `backend/src/controllers/postController.ts` | Reel creation, `shareToStory`, `shareStory` endpoint, delete cleanup. |
| `backend/src/controllers/postController.test.ts` | Reel creation, Story endpoint, and delete cleanup tests. |
| `backend/src/routes/postRoutes.ts` | `POST /:id/story`. |
| `backend/src/services/publishService.ts` | Dispatch reels, run deadline, automatic Stories, `sharePostToStory`. |
| `backend/src/services/publishService.test.ts` | Reel publishing and automatic Story tests. |
| `backend/src/services/storyService.ts` (new) | `storyPlatforms`, `publishStories`. |
| `backend/src/services/storyService.test.ts` (new) | Image and reel Stories on both platforms, skips, and failures. |
| `backend/src/services/cloudinaryStorageService.ts` | List videos, `resourceType`/`duration`, `deletePostMediaIfUnused`, exported helpers. |
| `backend/src/services/cloudinaryStorageService.test.ts` | Video normalization and post-media cleanup tests. |
| `backend/src/services/analyticsService.ts` | Use the reel cover as `mediaUrl`. |
| `backend/src/services/analyticsService.test.ts` | Reel cover test. |
| `README.md`, spec | Describe Reels and Stories; image Story padding uses `b_auto`. |

---

### Task 1: Post model fields

**Files:**
- Modify: `backend/src/models/postModel.ts`
- Test: `backend/src/models/postModel.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `backend/src/models/postModel.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { Post } from './postModel.js';

function validPostInput() {
    return {
        userId: new mongoose.Types.ObjectId(),
        connectionId: new mongoose.Types.ObjectId(),
        caption: 'A caption',
        mediaUrl:
            'https://res.cloudinary.com/demo/image/upload/v1/meta-bru/user-1/image.jpg',
    };
}

test('a post defaults to an image with no Story share', () => {
    const post = new Post(validPostInput());

    assert.equal(post.validateSync(), undefined);
    assert.equal(post.mediaType, 'image');
    assert.equal(post.mediaDuration, 0);
    assert.equal(post.mediaCoverUrl, '');
    assert.equal(post.shareToStory, false);
    assert.equal(post.storyTargets.length, 0);
});

test('a post accepts a reel with Story targets', () => {
    const post = new Post({
        ...validPostInput(),
        mediaType: 'reel',
        mediaDuration: 42.5,
        mediaCoverUrl:
            'https://res.cloudinary.com/demo/video/upload/so_1/reel.jpg',
        shareToStory: true,
        storyTargets: [
            { platform: 'instagram', status: 'failed', error: 'Meta said no' },
        ],
    });

    assert.equal(post.validateSync(), undefined);
    assert.equal(post.mediaType, 'reel');
    assert.equal(post.mediaDuration, 42.5);
    assert.equal(post.storyTargets[0]?.platform, 'instagram');
    assert.equal(post.storyTargets[0]?.status, 'failed');
    assert.equal(post.storyTargets[0]?.externalId, '');
});

test('a post rejects unknown media types and negative durations', () => {
    const post = new Post({
        ...validPostInput(),
        mediaType: 'video',
        mediaDuration: -1,
    });

    const error = post.validateSync();
    assert.ok(error?.errors.mediaType);
    assert.ok(error?.errors.mediaDuration);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/models/postModel.test.ts`
Expected: FAIL. The first test fails on `post.mediaDuration` (`undefined !== 0`).

- [ ] **Step 3: Add the fields**

In `backend/src/models/postModel.ts`, add the media type alias after `TargetStatus`:

```ts
export type MediaType = 'image' | 'reel';
```

Replace the `mediaType: 'image';` line in `IPost` with:

```ts
    mediaType: MediaType;
    /** Reel length in seconds; 0 for images. */
    mediaDuration: number;
    /** Reel cover JPG used for thumbnails; empty for images. */
    mediaCoverUrl: string;
    shareToStory: boolean;
    /** Story shares. They never change status, lastError, or publishedAt. */
    storyTargets: IPostTarget[];
```

Replace the `mediaType` schema line with:

```ts
        mediaType: { type: String, enum: ['image', 'reel'], default: 'image' },
        mediaDuration: { type: Number, default: 0, min: 0 },
        mediaCoverUrl: { type: String, default: '' },
        shareToStory: { type: Boolean, default: false },
        storyTargets: { type: [targetSchema], default: [] },
```

Update the `mediaJpegUrl` comment so it covers reels:

```ts
        /** JPEG delivery URL for Meta. Empty for reels and legacy/external media. */
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --import tsx --test src/models/postModel.test.ts`
Expected: PASS (3 tests).

Run: `cd backend && npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/models/postModel.ts backend/src/models/postModel.test.ts
git commit -m "feat: store reel media and Story targets on posts"
```

---

### Task 2: Polling and the publish deadline

**Files:**
- Create: `backend/src/services/pollService.ts`
- Test: `backend/src/services/pollService.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/pollService.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { Deadline, pollUntil, type PollResult } from './pollService.js';

function fakeClock(start = 0) {
    let time = start;
    const sleeps: number[] = [];
    return {
        now: () => time,
        sleep: async (ms: number) => {
            sleeps.push(ms);
            time += ms;
        },
        sleeps,
    };
}

test('pollUntil returns the value as soon as a check is done', async () => {
    const clock = fakeClock();
    let calls = 0;

    const value = await pollUntil<string>(
        async (): Promise<PollResult<string>> => {
            calls += 1;
            return calls === 3 ? { done: true, value: 'ready' } : { done: false };
        },
        {
            intervalMs: 10_000,
            timeoutMs: 60_000,
            deadline: Deadline.after(600_000, clock),
        }
    );

    assert.equal(value, 'ready');
    assert.equal(calls, 3);
    assert.deepEqual(clock.sleeps, [10_000, 10_000]);
});

test('pollUntil gives up at its timeout after a final check', async () => {
    const clock = fakeClock();
    let calls = 0;

    const value = await pollUntil<string>(
        async () => {
            calls += 1;
            return { done: false };
        },
        {
            intervalMs: 10_000,
            timeoutMs: 25_000,
            deadline: Deadline.after(600_000, clock),
        }
    );

    assert.equal(value, null);
    assert.equal(calls, 4);
    assert.deepEqual(clock.sleeps, [10_000, 10_000, 5_000]);
});

test('pollUntil stops at the run deadline when it comes first', async () => {
    const clock = fakeClock();
    let calls = 0;

    const value = await pollUntil<string>(
        async () => {
            calls += 1;
            return { done: false };
        },
        {
            intervalMs: 10_000,
            timeoutMs: 60_000,
            deadline: Deadline.after(15_000, clock),
        }
    );

    assert.equal(value, null);
    assert.equal(calls, 3);
    assert.equal(clock.now(), 15_000);
});

test('a deadline expires on its clock', async () => {
    const clock = fakeClock(1_000);
    const deadline = Deadline.after(5_000, clock);

    assert.equal(deadline.endsAt, 6_000);
    assert.equal(deadline.expired(), false);
    await clock.sleep(5_000);
    assert.equal(deadline.expired(), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/services/pollService.test.ts`
Expected: FAIL with `Cannot find module './pollService.js'`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/pollService.ts`:

```ts
export interface Clock {
    now(): number;
    sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Time budget for one publish run, including its automatic Stories. It keeps
 * a reel run inside STALE_LOCK_MS (15 minutes), so the Page lock and the
 * publishing post are never treated as stale while Meta is still working.
 */
export const PUBLISH_RUN_MS = 12 * 60 * 1000;

export class Deadline {
    readonly endsAt: number;
    readonly clock: Clock;

    constructor(endsAt: number, clock: Clock = systemClock) {
        this.endsAt = endsAt;
        this.clock = clock;
    }

    static after(ms: number, clock: Clock = systemClock): Deadline {
        return new Deadline(clock.now() + ms, clock);
    }

    expired(): boolean {
        return this.clock.now() >= this.endsAt;
    }
}

export type PollResult<T> = { done: true; value: T } | { done: false };

export interface PollOptions {
    intervalMs: number;
    timeoutMs: number;
    deadline: Deadline;
}

/**
 * Runs `check` now and then every `intervalMs` until it reports done. Gives up
 * after `timeoutMs` or at the run deadline, whichever comes first, and returns
 * null. The last check always runs at the cut-off.
 */
export async function pollUntil<T>(
    check: () => Promise<PollResult<T>>,
    options: PollOptions
): Promise<T | null> {
    const { clock } = options.deadline;
    const stopAt = Math.min(
        clock.now() + options.timeoutMs,
        options.deadline.endsAt
    );

    for (;;) {
        const result = await check();
        if (result.done) return result.value;

        const remaining = stopAt - clock.now();
        if (remaining <= 0) return null;
        await clock.sleep(Math.min(options.intervalMs, remaining));
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --import tsx --test src/services/pollService.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/pollService.ts backend/src/services/pollService.test.ts
git commit -m "feat: add polling with a shared publish deadline"
```

---

### Task 3: Cloudinary derivatives for reels and Stories

**Files:**
- Create: `backend/src/services/mediaDerivativeService.ts`
- Test: `backend/src/services/mediaDerivativeService.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/mediaDerivativeService.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/services/mediaDerivativeService.test.ts`
Expected: FAIL with `Cannot find module './mediaDerivativeService.js'`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/mediaDerivativeService.ts`:

```ts
import { v2 as cloudinary } from 'cloudinary';
import { pollUntil, type Deadline } from './pollService.js';

/**
 * Cloudinary derivatives that Meta-Bru hands to Meta. The upload signature,
 * the delivery URLs, and Storage thumbnails all use these exact strings, so
 * an eager derivative built at upload is the file a URL points to.
 */

export interface ReelLimits {
    formats: readonly string[];
    maxBytes: number;
    minSeconds: number;
    maxFacebookSeconds: number;
    maxInstagramSeconds: number;
    storySeconds: number;
}

export const REEL_LIMITS: ReelLimits = {
    formats: ['mp4', 'mov'],
    // Cloudinary's single-request upload limit.
    maxBytes: 100 * 1024 * 1024,
    minSeconds: 3,
    maxFacebookSeconds: 90,
    maxInstagramSeconds: 15 * 60,
    storySeconds: 60,
};

// 1080×1920 meets Facebook's 9:16 and 540×960 minimum for any input shape.
const VIDEO_PAD = 'c_pad,w_1080,h_1920,b_blurred:400:15';
const META_VIDEO_CODECS = 'vc_h264,ac_aac,q_auto';

export const REEL_VIDEO_TRANSFORM = `${VIDEO_PAD}/${META_VIDEO_CODECS}`;
export const REEL_COVER_TRANSFORM = 'so_1,c_fill,w_540,h_960,q_auto';
export const STORY_VIDEO_TRANSFORM = `${VIDEO_PAD}/du_60/${META_VIDEO_CODECS}`;
// b_blurred is video-only; images pad with a colour taken from their edges.
export const STORY_IMAGE_TRANSFORM = 'c_pad,w_1080,h_1920,b_auto,q_auto:good';

/** Instagram reel thumbnail position, matching the cover frame (so_1). */
export const REEL_THUMB_OFFSET_MS = 1000;

/** Eager derivatives requested at upload, as `transformation/format|…`. */
export const REEL_EAGER = [
    `${REEL_VIDEO_TRANSFORM}/mp4`,
    `${REEL_COVER_TRANSFORM}/jpg`,
    `${STORY_VIDEO_TRANSFORM}/mp4`,
].join('|');

/** How long a publish waits for Cloudinary to finish a derivative. */
export const DERIVATIVE_WAIT_MS = 3 * 60 * 1000;
const DERIVATIVE_POLL_MS = 5_000;

function derivativeUrl(
    cloudName: string,
    publicId: string,
    resourceType: 'image' | 'video',
    transformation: string,
    format: string
): string {
    return cloudinary.url(publicId, {
        cloud_name: cloudName,
        secure: true,
        resource_type: resourceType,
        raw_transformation: transformation,
        format,
    });
}

export function reelVideoUrl(cloudName: string, publicId: string): string {
    return derivativeUrl(cloudName, publicId, 'video', REEL_VIDEO_TRANSFORM, 'mp4');
}

export function reelCoverUrl(cloudName: string, publicId: string): string {
    return derivativeUrl(cloudName, publicId, 'video', REEL_COVER_TRANSFORM, 'jpg');
}

export function storyVideoUrl(cloudName: string, publicId: string): string {
    return derivativeUrl(cloudName, publicId, 'video', STORY_VIDEO_TRANSFORM, 'mp4');
}

export function storyImageUrl(cloudName: string, publicId: string): string {
    return derivativeUrl(cloudName, publicId, 'image', STORY_IMAGE_TRANSFORM, 'jpg');
}

export type HeadRequest = (url: string) => Promise<number>;

async function headStatus(url: string): Promise<number> {
    try {
        const response = await fetch(url, {
            method: 'HEAD',
            signal: AbortSignal.timeout(15_000),
        });
        return response.status;
    } catch {
        return 0;
    }
}

/**
 * Waits until Cloudinary serves a derivative. Eager video derivatives are
 * built in the background after upload, and the delivery URL may not return
 * 200 until they finish.
 */
export async function waitForDerivative(
    url: string,
    deadline: Deadline,
    head: HeadRequest = headStatus,
    timeoutMs = DERIVATIVE_WAIT_MS
): Promise<boolean> {
    const ready = await pollUntil<true>(
        async () =>
            (await head(url)) === 200
                ? { done: true, value: true }
                : { done: false },
        { intervalMs: DERIVATIVE_POLL_MS, timeoutMs, deadline }
    );
    return ready === true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --import tsx --test src/services/mediaDerivativeService.test.ts`
Expected: PASS (4 tests).

Run: `cd backend && npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/mediaDerivativeService.ts backend/src/services/mediaDerivativeService.test.ts
git commit -m "feat: define Cloudinary derivatives for reels and Stories"
```

---

### Task 4: Meta Graph wrappers for reels and Stories

**Files:**
- Modify: `backend/src/services/metaService.ts` (append after `getInstagramContainerStatus`)
- Test: `backend/src/services/metaService.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/metaService.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/services/metaService.test.ts`
Expected: FAIL. `parseFacebookVideoStatus is not a function`.

- [ ] **Step 3: Add the wrappers**

Append to `backend/src/services/metaService.ts`:

```ts
export interface InstagramContainerState {
    /** IN_PROGRESS, FINISHED, PUBLISHED, ERROR, EXPIRED, or UNKNOWN. */
    statusCode: string;
    /** Meta's human-readable status, which explains an ERROR. */
    status: string;
}

export interface InstagramMediaApi {
    createContainer(
        igUserId: string,
        accessToken: string,
        params: Record<string, string | number>
    ): Promise<string>;
    containerState(
        containerId: string,
        accessToken: string
    ): Promise<InstagramContainerState>;
    publishContainer(
        igUserId: string,
        accessToken: string,
        creationId: string
    ): Promise<string>;
}

export async function createInstagramMediaContainer(
    igUserId: string,
    accessToken: string,
    params: Record<string, string | number>
): Promise<string> {
    const data = await graphRequest<{ id?: string }>(`${igUserId}/media`, {
        method: 'POST',
        accessToken,
        params,
    });

    if (!data.id) {
        throw new MetaApiError('Instagram did not return a media container ID', 502);
    }
    return data.id;
}

export async function getInstagramContainerState(
    containerId: string,
    accessToken: string
): Promise<InstagramContainerState> {
    const data = await graphRequest<{ status_code?: string; status?: string }>(
        containerId,
        { accessToken, params: { fields: 'status_code,status' } }
    );
    return {
        statusCode: data.status_code || 'UNKNOWN',
        status: data.status || '',
    };
}

export const instagramMediaApi: InstagramMediaApi = {
    createContainer: createInstagramMediaContainer,
    containerState: getInstagramContainerState,
    publishContainer: (igUserId, accessToken, creationId) =>
        publishInstagramContainer({ igUserId, accessToken, creationId }),
};

export type FacebookVideoEdge = 'video_reels' | 'video_stories';

export interface FacebookVideoStatus {
    videoStatus: string;
    uploading: string;
    processing: string;
    publishing: string;
    /** Why Meta rejected the video, or '' while it is fine. */
    error: string;
}

export interface FacebookVideoApi {
    start(
        pageId: string,
        pageToken: string,
        edge: FacebookVideoEdge
    ): Promise<{ videoId: string; uploadUrl: string }>;
    upload(uploadUrl: string, pageToken: string, fileUrl: string): Promise<void>;
    finish(
        pageId: string,
        pageToken: string,
        edge: FacebookVideoEdge,
        params: Record<string, string>
    ): Promise<{ postId: string }>;
    status(videoId: string, pageToken: string): Promise<FacebookVideoStatus>;
}

export interface FacebookPhotoStoryApi {
    uploadUnpublished(
        pageId: string,
        pageToken: string,
        imageUrl: string
    ): Promise<string>;
    publishStory(
        pageId: string,
        pageToken: string,
        photoId: string
    ): Promise<{ postId: string }>;
}

export async function startFacebookVideoUpload(
    pageId: string,
    pageToken: string,
    edge: FacebookVideoEdge
): Promise<{ videoId: string; uploadUrl: string }> {
    const data = await graphRequest<{ video_id?: string; upload_url?: string }>(
        `${pageId}/${edge}`,
        { method: 'POST', accessToken: pageToken, params: { upload_phase: 'start' } }
    );

    if (!data.video_id || !data.upload_url) {
        throw new MetaApiError('Facebook did not return a video upload session', 502);
    }
    return { videoId: data.video_id, uploadUrl: data.upload_url };
}

function isFacebookHost(url: string): boolean {
    try {
        const { protocol, hostname } = new URL(url);
        return (
            protocol === 'https:' &&
            (hostname === 'facebook.com' || hostname.endsWith('.facebook.com'))
        );
    } catch {
        return false;
    }
}

/**
 * Asks Meta to download a hosted video into an upload session. The Page token
 * is sent as a header, so it only ever goes to a Facebook host.
 */
export async function uploadFacebookVideoFromUrl(
    uploadUrl: string,
    pageToken: string,
    fileUrl: string
): Promise<void> {
    if (!isFacebookHost(uploadUrl)) {
        throw new MetaApiError('Meta returned an unexpected video upload address', 502);
    }

    let response: Response;
    try {
        response = await fetch(uploadUrl, {
            method: 'POST',
            headers: { Authorization: `OAuth ${pageToken}`, file_url: fileUrl },
            signal: AbortSignal.timeout(120_000),
        });
    } catch (error) {
        throw new MetaApiError(
            error instanceof Error ? error.message : 'Could not reach the Meta upload service',
            0
        );
    }

    const data = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        debug_info?: { message?: string };
    };
    if (!response.ok || data.success !== true) {
        throw new MetaApiError(
            data.debug_info?.message ||
                `Meta video upload failed with status ${response.status}`,
            response.status
        );
    }
}

export async function finishFacebookVideoUpload(
    pageId: string,
    pageToken: string,
    edge: FacebookVideoEdge,
    params: Record<string, string>
): Promise<{ postId: string }> {
    const data = await graphRequest<{ success?: boolean; post_id?: string }>(
        `${pageId}/${edge}`,
        {
            method: 'POST',
            accessToken: pageToken,
            params: { ...params, upload_phase: 'finish' },
        }
    );

    if (data.success === false) {
        throw new MetaApiError('Facebook did not accept the video', 502);
    }
    return { postId: data.post_id || '' };
}

interface RawVideoPhase {
    status?: string;
    errors?: Array<{ message?: string }>;
}

const FAILED_VIDEO_STATUSES: Record<string, string> = {
    error: 'Facebook could not process this video',
    upload_failed: 'Facebook video upload failed',
    expired: 'Facebook video upload expired',
};

export function parseFacebookVideoStatus(raw: unknown): FacebookVideoStatus {
    const status =
        (raw as {
            status?: {
                video_status?: string;
                uploading_phase?: RawVideoPhase;
                processing_phase?: RawVideoPhase;
                publishing_phase?: RawVideoPhase;
            };
        } | null)?.status ?? {};
    const phases = [
        status.uploading_phase,
        status.processing_phase,
        status.publishing_phase,
    ];
    const failedPhase = phases.find((phase) => phase?.status === 'error');
    const videoStatus = status.video_status ?? '';

    return {
        videoStatus,
        uploading: status.uploading_phase?.status ?? '',
        processing: status.processing_phase?.status ?? '',
        publishing: status.publishing_phase?.status ?? '',
        error: failedPhase
            ? failedPhase.errors?.[0]?.message || 'Facebook could not process this video'
            : FAILED_VIDEO_STATUSES[videoStatus] ?? '',
    };
}

export async function getFacebookVideoStatus(
    videoId: string,
    pageToken: string
): Promise<FacebookVideoStatus> {
    const data = await graphRequest<unknown>(videoId, {
        accessToken: pageToken,
        params: { fields: 'status' },
    });
    return parseFacebookVideoStatus(data);
}

export const facebookVideoApi: FacebookVideoApi = {
    start: startFacebookVideoUpload,
    upload: uploadFacebookVideoFromUrl,
    finish: finishFacebookVideoUpload,
    status: getFacebookVideoStatus,
};

/** Photo Stories need a fresh, unpublished photo; a feed photo cannot be reused. */
export async function uploadUnpublishedFacebookPhoto(
    pageId: string,
    pageToken: string,
    imageUrl: string
): Promise<string> {
    const data = await graphRequest<{ id?: string }>(`${pageId}/photos`, {
        method: 'POST',
        accessToken: pageToken,
        params: { url: imageUrl, published: 'false' },
    });

    if (!data.id) {
        throw new MetaApiError('Facebook did not return a photo ID', 502);
    }
    return data.id;
}

export async function publishFacebookPhotoStory(
    pageId: string,
    pageToken: string,
    photoId: string
): Promise<{ postId: string }> {
    const data = await graphRequest<{ success?: boolean; post_id?: string }>(
        `${pageId}/photo_stories`,
        { method: 'POST', accessToken: pageToken, params: { photo_id: photoId } }
    );

    if (data.success === false) {
        throw new MetaApiError('Facebook did not accept the Story', 502);
    }
    return { postId: data.post_id || '' };
}

export const facebookPhotoStoryApi: FacebookPhotoStoryApi = {
    uploadUnpublished: uploadUnpublishedFacebookPhoto,
    publishStory: publishFacebookPhotoStory,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --import tsx --test src/services/metaService.test.ts`
Expected: PASS (6 tests).

Run: `cd backend && npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/metaService.ts backend/src/services/metaService.test.ts
git commit -m "feat: add Meta Graph wrappers for reels and Stories"
```

---

### Task 5: Resumable Meta media jobs

**Files:**
- Create: `backend/src/services/metaMediaJobs.ts`
- Test: `backend/src/services/metaMediaJobs.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/metaMediaJobs.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/services/metaMediaJobs.test.ts`
Expected: FAIL with `Cannot find module './metaMediaJobs.js'`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/metaMediaJobs.ts`:

```ts
import type { IPostTarget } from '../models/postModel.js';
import { getCloudinaryCredentials } from './credentialService.js';
import { waitForDerivative } from './mediaDerivativeService.js';
import {
    MetaApiError,
    facebookPhotoStoryApi,
    facebookVideoApi,
    getInstagramPublishingUsage,
    instagramMediaApi,
    type FacebookPhotoStoryApi,
    type FacebookVideoApi,
    type FacebookVideoEdge,
    type FacebookVideoStatus,
    type InstagramContainerState,
    type InstagramMediaApi,
} from './metaService.js';
import {
    pollUntil,
    systemClock,
    type Clock,
    type Deadline,
} from './pollService.js';

export const INSTAGRAM_VIDEO_WAIT_MS = 5 * 60 * 1000;
export const INSTAGRAM_IMAGE_WAIT_MS = 60 * 1000;
export const FACEBOOK_REEL_STATUS_WAIT_MS = 2 * 60 * 1000;
const META_POLL_MS = 10_000;

type InstagramUsage = (
    igUserId: string,
    accessToken: string
) => Promise<{ quotaUsage: number; quotaTotal: number }>;

/** Everything a reel or Story publish needs from outside. Tests swap these. */
export interface MetaMediaDeps {
    instagram: InstagramMediaApi;
    instagramUsage: InstagramUsage;
    facebookVideo: FacebookVideoApi;
    facebookPhoto: FacebookPhotoStoryApi;
    waitForDerivative: (url: string, deadline: Deadline) => Promise<boolean>;
    cloudName: (userId: string) => Promise<string>;
    clock: Clock;
}

export const defaultMetaMediaDeps: MetaMediaDeps = {
    instagram: instagramMediaApi,
    instagramUsage: getInstagramPublishingUsage,
    facebookVideo: facebookVideoApi,
    facebookPhoto: facebookPhotoStoryApi,
    waitForDerivative: (url, deadline) => waitForDerivative(url, deadline),
    cloudName: async (userId) => (await getCloudinaryCredentials(userId)).cloudName,
    clock: systemClock,
};

export function markTargetPublished(target: IPostTarget, externalId: string): void {
    target.status = 'published';
    if (externalId) target.externalId = externalId;
    target.error = '';
    target.publishedAt = new Date();
}

export async function assertInstagramQuota(
    igUserId: string,
    accessToken: string,
    usageFor: InstagramUsage = getInstagramPublishingUsage
): Promise<void> {
    const usage = await usageFor(igUserId, accessToken);
    if (usage.quotaUsage >= usage.quotaTotal) {
        throw new MetaApiError(
            `Instagram publishing limit reached (${usage.quotaUsage}/${usage.quotaTotal} in 24h)`,
            429
        );
    }
}

export interface InstagramContainerJob {
    igUserId: string;
    accessToken: string;
    /** Container fields such as media_type and video_url. */
    params: Record<string, string | number>;
    /** Holds the container id between attempts. */
    target: IPostTarget;
    waitMs: number;
    stillProcessingMessage: string;
}

/**
 * Creates or resumes an Instagram container and publishes it once Meta has
 * processed it. The container id stays on the target, so a retry after a
 * timeout publishes the same container instead of creating a duplicate.
 */
export async function publishInstagramContainerJob(
    job: InstagramContainerJob,
    api: InstagramMediaApi,
    deadline: Deadline
): Promise<void> {
    const { igUserId, accessToken, target } = job;

    if (target.creationId) {
        const existing = await api.containerState(target.creationId, accessToken);
        if (existing.statusCode === 'PUBLISHED') {
            // An earlier attempt published it but its response was lost.
            markTargetPublished(target, '');
            return;
        }
        if (existing.statusCode === 'ERROR' || existing.statusCode === 'EXPIRED') {
            target.creationId = '';
        }
    }

    if (!target.creationId) {
        target.creationId = await api.createContainer(igUserId, accessToken, job.params);
    }
    const creationId = target.creationId;

    const state = await pollUntil<InstagramContainerState>(
        async () => {
            const current = await api.containerState(creationId, accessToken);
            return current.statusCode === 'IN_PROGRESS' ||
                current.statusCode === 'UNKNOWN'
                ? { done: false }
                : { done: true, value: current };
        },
        { intervalMs: META_POLL_MS, timeoutMs: job.waitMs, deadline }
    );

    if (!state) {
        throw new MetaApiError(job.stillProcessingMessage, 504);
    }
    if (state.statusCode === 'PUBLISHED') {
        markTargetPublished(target, '');
        return;
    }
    if (state.statusCode !== 'FINISHED') {
        target.creationId = '';
        throw new MetaApiError(
            state.status || `Instagram container is ${state.statusCode}`,
            422
        );
    }

    const mediaId = await api.publishContainer(igUserId, accessToken, creationId);
    markTargetPublished(target, mediaId);
}

export interface FacebookVideoJob {
    pageId: string;
    accessToken: string;
    edge: FacebookVideoEdge;
    /** Public URL Meta downloads the video from. */
    fileUrl: string;
    finishParams: Record<string, string>;
    /** Holds the Facebook video id between attempts. */
    target: IPostTarget;
    /** Reels keep processing after finish; poll this long for errors. 0 skips. */
    statusWaitMs: number;
}

/**
 * Publishes a hosted video to a Page edge (Reels or video Stories) with the
 * start, upload, finish flow. The video id stays on the target, so a retry
 * resumes a video Meta already has instead of posting it again.
 */
export async function publishFacebookVideoJob(
    job: FacebookVideoJob,
    api: FacebookVideoApi,
    deadline: Deadline
): Promise<void> {
    const { pageId, accessToken, edge, target } = job;
    let alreadyFinished = false;

    if (target.creationId) {
        const existing = await api.status(target.creationId, accessToken);
        if (existing.publishing === 'complete') {
            markTargetPublished(target, target.creationId);
            return;
        }
        if (existing.error || existing.uploading !== 'complete') {
            // Meta rejected or never received the earlier upload.
            target.creationId = '';
        } else {
            alreadyFinished = existing.publishing === 'in_progress';
        }
    }

    if (!target.creationId) {
        const session = await api.start(pageId, accessToken, edge);
        target.creationId = session.videoId;
        await api.upload(session.uploadUrl, accessToken, job.fileUrl);
    }
    const videoId = target.creationId;

    let postId = '';
    if (!alreadyFinished) {
        ({ postId } = await api.finish(pageId, accessToken, edge, {
            video_id: videoId,
            ...job.finishParams,
        }));
    }

    if (job.statusWaitMs > 0) {
        const status = await pollUntil<FacebookVideoStatus>(
            async () => {
                const current = await api.status(videoId, accessToken);
                return current.error || current.publishing === 'complete'
                    ? { done: true, value: current }
                    : { done: false };
            },
            { intervalMs: META_POLL_MS, timeoutMs: job.statusWaitMs, deadline }
        );

        if (status?.error) {
            target.creationId = '';
            // 422: Meta rejected the video, so nothing was published.
            throw new MetaApiError(status.error, 422);
        }
    }

    markTargetPublished(target, postId || videoId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --import tsx --test src/services/metaMediaJobs.test.ts`
Expected: PASS (10 tests).

Run: `cd backend && npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/metaMediaJobs.ts backend/src/services/metaMediaJobs.test.ts
git commit -m "feat: add resumable Instagram container and Facebook video jobs"
```

---

### Task 6: Signed reel uploads and the video endpoints

**Files:**
- Modify: `backend/src/services/cloudinaryStorageService.ts` (export three helpers)
- Create: `backend/src/services/videoUploadService.ts`
- Modify: `backend/src/controllers/mediaController.ts`, `backend/src/routes/mediaRoutes.ts`
- Test: `backend/src/services/videoUploadService.test.ts` (new), `backend/src/controllers/mediaController.test.ts`

- [ ] **Step 1: Export the Cloudinary helpers the video service reuses**

In `backend/src/services/cloudinaryStorageService.ts`:

1. Change `function credentialsOptions(` to `export function credentialsOptions(`.
2. Change `function cloudinaryErrorMessage(` to `export function cloudinaryErrorMessage(`.
3. Add after `cloudinaryErrorMessage`:

```ts
/** The HTTP status of a Cloudinary SDK error, which nests it under `error`. */
export function cloudinaryHttpCode(error: unknown): number | undefined {
    const shape = error as
        | { http_code?: unknown; error?: { http_code?: unknown } }
        | null
        | undefined;
    const code = shape?.error?.http_code ?? shape?.http_code;
    return typeof code === 'number' ? code : undefined;
}
```

- [ ] **Step 2: Write the failing service test**

Create `backend/src/services/videoUploadService.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { v2 as cloudinary } from 'cloudinary';
import type { AppError } from '../utils/errors.js';
import type { VideoStore } from './videoUploadService.js';

process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

const { loadReelVideo, signVideoUpload, videoRejection } = await import(
    './videoUploadService.js'
);
const { REEL_EAGER, reelCoverUrl, reelVideoUrl } = await import(
    './mediaDerivativeService.js'
);

const USER_ID = '64b7f1c2a1b2c3d4e5f60719';
const PUBLIC_ID = `meta-bru/${USER_ID}/reel-1`;
const CREDENTIALS = { cloudName: 'demo', apiKey: 'key-123', apiSecret: 'secret-456' };

function videoResource(overrides: Record<string, unknown> = {}) {
    return {
        public_id: PUBLIC_ID,
        asset_folder: `meta-bru/${USER_ID}`,
        secure_url: `https://res.cloudinary.com/demo/video/upload/v1/${PUBLIC_ID}.mov`,
        format: 'mov',
        bytes: 5_000_000,
        width: 1080,
        height: 1920,
        duration: 12.34,
        ...overrides,
    };
}

function fakeStore(resource: Record<string, unknown> | null) {
    const removed: string[] = [];
    const store: VideoStore = {
        find: async () => resource,
        remove: async (publicId) => {
            removed.push(publicId);
        },
    };
    return { store, removed };
}

function hasCode(code: string) {
    return (error: unknown) => (error as AppError).code === code;
}

test('signs a direct upload into the user folder', () => {
    const upload = signVideoUpload(CREDENTIALS, USER_ID, 1_700_000_000_123);

    assert.equal(upload.cloudName, 'demo');
    assert.equal(upload.apiKey, 'key-123');
    assert.equal(upload.timestamp, 1_700_000_000);
    assert.equal(upload.folder, `meta-bru/${USER_ID}`);
    assert.equal(upload.eager, REEL_EAGER);
    assert.equal(upload.eagerAsync, 'true');
    assert.equal(upload.allowedFormats, 'mp4,mov');
    assert.equal(
        upload.signature,
        cloudinary.utils.api_sign_request(
            {
                timestamp: 1_700_000_000,
                folder: `meta-bru/${USER_ID}`,
                eager: REEL_EAGER,
                eager_async: 'true',
                allowed_formats: 'mp4,mov',
            },
            'secret-456'
        )
    );
    assert.ok(!JSON.stringify(upload).includes('secret-456'));
});

test('accepts a reel within the limits', () => {
    assert.equal(videoRejection(videoResource()), null);
});

test('rejects unsupported, oversized, short, and long videos', () => {
    assert.equal(videoRejection(videoResource({ format: 'webm' }))?.code, 'UNSUPPORTED_MEDIA_TYPE');
    assert.equal(
        videoRejection(videoResource({ bytes: 100 * 1024 * 1024 + 1 }))?.code,
        'MEDIA_TOO_LARGE'
    );
    assert.equal(videoRejection(videoResource({ duration: 2.9 }))?.code, 'REEL_TOO_SHORT');
    assert.equal(videoRejection(videoResource({ duration: 901 }))?.code, 'REEL_TOO_LONG');
});

test('loads an owned reel with its derivative URLs', async () => {
    const { store, removed } = fakeStore(videoResource());

    const media = await loadReelVideo(USER_ID, PUBLIC_ID, CREDENTIALS, {}, store);

    assert.deepEqual(media, {
        publicId: PUBLIC_ID,
        url: reelVideoUrl('demo', PUBLIC_ID),
        coverUrl: reelCoverUrl('demo', PUBLIC_ID),
        originalUrl: `https://res.cloudinary.com/demo/video/upload/v1/${PUBLIC_ID}.mov`,
        width: 1080,
        height: 1920,
        duration: 12.3,
        format: 'mov',
        bytes: 5_000_000,
    });
    assert.deepEqual(removed, []);
});

test('rejects a video outside the user folder without deleting it', async () => {
    const { store, removed } = fakeStore(
        videoResource({ public_id: 'other/reel-1', asset_folder: 'other' })
    );

    await assert.rejects(
        () =>
            loadReelVideo(USER_ID, 'other/reel-1', CREDENTIALS, { deleteIfRejected: true }, store),
        hasCode('INVALID_MEDIA')
    );
    assert.deepEqual(removed, []);
});

test('accepts a dynamic-folder video by its asset folder', async () => {
    const { store } = fakeStore(videoResource({ public_id: 'abc123' }));

    const media = await loadReelVideo(USER_ID, 'abc123', CREDENTIALS, {}, store);

    assert.equal(media.publicId, 'abc123');
});

test('reports a video Cloudinary no longer has', async () => {
    const { store } = fakeStore(null);

    await assert.rejects(
        () => loadReelVideo(USER_ID, PUBLIC_ID, CREDENTIALS, {}, store),
        hasCode('MEDIA_NOT_FOUND')
    );
});

test('deletes a rejected upload only when asked', async () => {
    const short = fakeStore(videoResource({ duration: 1 }));
    await assert.rejects(
        () => loadReelVideo(USER_ID, PUBLIC_ID, CREDENTIALS, { deleteIfRejected: true }, short.store),
        hasCode('REEL_TOO_SHORT')
    );
    assert.deepEqual(short.removed, [PUBLIC_ID]);

    const kept = fakeStore(videoResource({ duration: 1 }));
    await assert.rejects(
        () => loadReelVideo(USER_ID, PUBLIC_ID, CREDENTIALS, {}, kept.store),
        hasCode('REEL_TOO_SHORT')
    );
    assert.deepEqual(kept.removed, []);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/services/videoUploadService.test.ts`
Expected: FAIL with `Cannot find module './videoUploadService.js'`.

- [ ] **Step 4: Write the service**

Create `backend/src/services/videoUploadService.ts`:

```ts
import { v2 as cloudinary } from 'cloudinary';
import { AppError } from '../utils/errors.js';
import {
    cloudinaryErrorMessage,
    cloudinaryHttpCode,
    credentialsOptions,
    isAssetInUserFolder,
    userFolder,
} from './cloudinaryStorageService.js';
import type { CloudinaryCredentials } from './credentialService.js';
import {
    REEL_EAGER,
    REEL_LIMITS,
    reelCoverUrl,
    reelVideoUrl,
} from './mediaDerivativeService.js';

export interface VideoUploadSignature {
    cloudName: string;
    apiKey: string;
    timestamp: number;
    signature: string;
    folder: string;
    eager: string;
    eagerAsync: string;
    allowedFormats: string;
}

export interface VideoMedia {
    publicId: string;
    /** Meta-ready MP4 derivative. */
    url: string;
    coverUrl: string;
    /** The uploaded file, for previews while the derivative is still building. */
    originalUrl: string;
    width: number;
    height: number;
    duration: number;
    format: string;
    bytes: number;
}

export interface VideoResource {
    public_id?: unknown;
    asset_folder?: unknown;
    secure_url?: unknown;
    format?: unknown;
    bytes?: unknown;
    width?: unknown;
    height?: unknown;
    duration?: unknown;
}

export interface VideoStore {
    /** Returns null when Cloudinary has no such video. */
    find(publicId: string): Promise<VideoResource | null>;
    remove(publicId: string): Promise<void>;
}

/**
 * Signs a direct browser upload to the user's own Cloudinary account.
 * Cloudinary rejects any change to a signed field, so the upload always lands
 * in the user's folder with the reel derivatives queued. The API secret never
 * leaves the server.
 */
export function signVideoUpload(
    credentials: CloudinaryCredentials,
    userId: string,
    nowMs = Date.now()
): VideoUploadSignature {
    const signed = {
        timestamp: Math.floor(nowMs / 1000),
        folder: userFolder(userId),
        eager: REEL_EAGER,
        eager_async: 'true',
        allowed_formats: REEL_LIMITS.formats.join(','),
    };

    return {
        cloudName: credentials.cloudName,
        apiKey: credentials.apiKey,
        timestamp: signed.timestamp,
        signature: cloudinary.utils.api_sign_request(signed, credentials.apiSecret),
        folder: signed.folder,
        eager: signed.eager,
        eagerAsync: signed.eager_async,
        allowedFormats: signed.allowed_formats,
    };
}

function numberOrZero(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function formatOf(resource: VideoResource): string {
    return typeof resource.format === 'string' ? resource.format.toLowerCase() : '';
}

/** Why a video cannot be a reel, or null when it can. */
export function videoRejection(resource: VideoResource): AppError | null {
    const duration = numberOrZero(resource.duration);

    if (!REEL_LIMITS.formats.includes(formatOf(resource))) {
        return new AppError(400, 'Unsupported video type. Use MP4 or MOV.', 'UNSUPPORTED_MEDIA_TYPE');
    }
    if (numberOrZero(resource.bytes) > REEL_LIMITS.maxBytes) {
        return new AppError(400, 'Reels can be at most 100 MB.', 'MEDIA_TOO_LARGE');
    }
    if (duration < REEL_LIMITS.minSeconds) {
        return new AppError(400, 'Reels must be at least 3 seconds long.', 'REEL_TOO_SHORT');
    }
    if (duration > REEL_LIMITS.maxInstagramSeconds) {
        return new AppError(400, 'Reels can be at most 15 minutes long.', 'REEL_TOO_LONG');
    }
    return null;
}

export function cloudinaryVideoStore(credentials: CloudinaryCredentials): VideoStore {
    const options = { ...credentialsOptions(credentials), resource_type: 'video' };

    return {
        async find(publicId) {
            try {
                return (await cloudinary.api.resource(publicId, options)) as VideoResource;
            } catch (error) {
                if (cloudinaryHttpCode(error) === 404) return null;
                throw new AppError(502, cloudinaryErrorMessage(error), 'CLOUDINARY_API_FAILED');
            }
        },
        async remove(publicId) {
            await cloudinary.api.delete_resources([publicId], { ...options, type: 'upload' });
        },
    };
}

/**
 * Loads a reel video from the user's Cloudinary account and checks it is in
 * their Meta-Bru folder and within the reel limits. A freshly uploaded video
 * that fails the limits can be deleted so it does not linger in storage.
 */
export async function loadReelVideo(
    userId: string,
    publicId: string,
    credentials: CloudinaryCredentials,
    options: { deleteIfRejected?: boolean } = {},
    store: VideoStore = cloudinaryVideoStore(credentials)
): Promise<VideoMedia> {
    const resource = await store.find(publicId);
    if (!resource) {
        throw new AppError(
            400,
            'This video is no longer in your Cloudinary account. Upload it again.',
            'MEDIA_NOT_FOUND'
        );
    }

    const assetFolder = typeof resource.asset_folder === 'string' ? resource.asset_folder : '';
    if (!isAssetInUserFolder({ publicId, assetFolder }, userId)) {
        throw new AppError(400, 'This video is not in your Meta-Bru folder.', 'INVALID_MEDIA');
    }

    const rejection = videoRejection(resource);
    if (rejection) {
        if (options.deleteIfRejected) {
            try {
                await store.remove(publicId);
            } catch (error) {
                console.error(`[media] Could not delete rejected video ${publicId}:`, error);
            }
        }
        throw rejection;
    }

    return {
        publicId,
        url: reelVideoUrl(credentials.cloudName, publicId),
        coverUrl: reelCoverUrl(credentials.cloudName, publicId),
        originalUrl: typeof resource.secure_url === 'string' ? resource.secure_url : '',
        width: numberOrZero(resource.width),
        height: numberOrZero(resource.height),
        duration: Math.round(numberOrZero(resource.duration) * 10) / 10,
        format: formatOf(resource),
        bytes: numberOrZero(resource.bytes),
    };
}
```

- [ ] **Step 5: Run the service test**

Run: `cd backend && node --import tsx --test src/services/videoUploadService.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Write the failing controller test**

In `backend/src/controllers/mediaController.test.ts`, change the import block to:

```ts
const { createVideoSignature, deleteMedia, getStorageOverview } = await import(
    './mediaController.js'
);
const { User } = await import('../models/userModel.js');
const { encryptSecret } = await import('../services/cryptoService.js');
```

Append:

```ts
function configuredUser(): Record<string, unknown> {
    return {
        select: async () => ({
            _id: USER_ID,
            credentialsEnc: encryptSecret(
                JSON.stringify({
                    cloudinary: {
                        cloudName: 'demo',
                        apiKey: 'key-123',
                        apiSecret: 'secret-456',
                    },
                })
            ),
        }),
    };
}

test('video signature signs the authenticated user folder and hides the secret', async () => {
    const findById = mock.method(user, 'findById', () => configuredUser());
    const { res, json } = response();

    await createVideoSignature(
        request({ folder: `meta-bru/${OTHER_ID}`, userId: OTHER_ID }),
        res
    );

    assert.equal(findById.mock.calls[0]?.arguments[0], USER_ID);
    const payload = json.mock.calls[0]?.arguments[0] as {
        success: boolean;
        upload: Record<string, unknown>;
    };
    assert.equal(payload.success, true);
    assert.equal(payload.upload.folder, `meta-bru/${USER_ID}`);
    assert.equal(payload.upload.apiKey, 'key-123');
    assert.ok(!JSON.stringify(payload).includes('secret-456'));
});

test('video signature reports unconfigured Cloudinary', async () => {
    mock.method(user, 'findById', () => unconfiguredUser());
    const { res } = response();

    await assert.rejects(
        () => createVideoSignature(request(), res),
        assertAppError(503, 'MEDIA_NOT_CONFIGURED')
    );
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/controllers/mediaController.test.ts`
Expected: FAIL. `createVideoSignature is not a function`.

- [ ] **Step 8: Add the controller handlers and routes**

In `backend/src/controllers/mediaController.ts`, add imports:

```ts
import { getCloudinaryCredentials } from '../services/credentialService.js';
import {
    loadReelVideo,
    signVideoUpload,
} from '../services/videoUploadService.js';
```

Add after `deleteMediaSchema`:

```ts
const registerVideoSchema = z.object({
    publicId: z.string().trim().min(1).max(300),
});
```

Append:

```ts
/**
 * Signs a direct browser upload of a reel to the user's own Cloudinary
 * account. Large videos never pass through this server.
 */
export async function createVideoSignature(
    req: Request,
    res: Response
): Promise<void> {
    const credentials = await getCloudinaryCredentials(req.user.id);
    res.json({ success: true, upload: signVideoUpload(credentials, req.user.id) });
}

/**
 * Checks a reel the browser just uploaded and returns its media details. A
 * video that breaks the reel limits is deleted from Cloudinary.
 */
export async function registerVideo(req: Request, res: Response): Promise<void> {
    const { publicId } = parseBody(registerVideoSchema, req);
    const credentials = await getCloudinaryCredentials(req.user.id);
    const media = await loadReelVideo(req.user.id, publicId, credentials, {
        deleteIfRejected: true,
    });

    res.status(201).json({ success: true, media });
}
```

In `backend/src/routes/mediaRoutes.ts`, import the two handlers alongside the others and add:

```ts
router.post('/video-signature', protect, mediaLimiter, createVideoSignature);
router.post('/videos', protect, mediaLimiter, registerVideo);
```

- [ ] **Step 9: Run tests and types**

Run: `cd backend && node --import tsx --test src/controllers/mediaController.test.ts src/services/videoUploadService.test.ts src/services/cloudinaryStorageService.test.ts`
Expected: PASS.

Run: `cd backend && npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add backend/src/services/cloudinaryStorageService.ts backend/src/services/videoUploadService.ts backend/src/services/videoUploadService.test.ts backend/src/controllers/mediaController.ts backend/src/controllers/mediaController.test.ts backend/src/routes/mediaRoutes.ts
git commit -m "feat: sign direct reel uploads and check uploaded videos"
```

---

### Task 7: Create reel posts

**Files:**
- Modify: `backend/src/controllers/postController.ts`
- Test: `backend/src/controllers/postController.test.ts`

- [ ] **Step 1: Write the failing tests**

In `backend/src/controllers/postController.test.ts`, add imports after the `Post` import:

```ts
const { User } = await import('../models/userModel.js');
const { encryptSecret } = await import('../services/cryptoService.js');
const { v2: cloudinary } = await import('cloudinary');
```

Add after the `post` constant:

```ts
const user = User as unknown as MockableModel;
const cloudinaryApi = cloudinary.api as unknown as MockableModel;
const REEL_ID = `meta-bru/${USER_ID}/reel-1`;

function cloudinaryUser(): Record<string, unknown> {
    return {
        select: async () => ({
            _id: USER_ID,
            credentialsEnc: encryptSecret(
                JSON.stringify({
                    cloudinary: { cloudName: 'demo', apiKey: 'key', apiSecret: 'secret' },
                })
            ),
        }),
    };
}

function reelResource(duration: number): Record<string, unknown> {
    return {
        public_id: REEL_ID,
        asset_folder: `meta-bru/${USER_ID}`,
        secure_url: `https://res.cloudinary.com/demo/video/upload/v1/${REEL_ID}.mp4`,
        format: 'mp4',
        bytes: 8_000_000,
        width: 1080,
        height: 1920,
        duration,
    };
}

function reelBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        connectionId: CONNECTION_ID,
        caption: 'A test reel',
        mediaType: 'reel',
        mediaPublicId: REEL_ID,
        platforms: { facebook: true, instagram: false },
        action: 'queue',
        ...overrides,
    };
}
```

Add after the `response` helper:

```ts
function createdResponse(): { res: Response; json: JsonMock } {
    const json = mock.fn();
    const res = { json } as unknown as Response & { status: unknown };
    res.status = mock.fn(() => res);
    return { res, json };
}
```

Append the tests:

```ts
test('createPost fills reel media from Cloudinary and ignores client URLs', async () => {
    mock.method(socialConnection, 'findOne', () => ({
        select: async () => connectionDoc(),
    }));
    mock.method(user, 'findById', () => cloudinaryUser());
    mock.method(cloudinaryApi, 'resource', async () => reelResource(30));
    let created: Record<string, unknown> | undefined;
    mock.method(post, 'create', async (doc: unknown) => {
        created = doc as Record<string, unknown>;
        return doc;
    });

    const { res } = createdResponse();
    await createPost(
        requestWithBody(
            reelBody({
                mediaUrl: 'https://evil.example/fake.mp4',
                shareToStory: true,
            })
        ),
        res
    );

    assert.ok(created);
    assert.equal(created.mediaType, 'reel');
    assert.equal(created.mediaPublicId, REEL_ID);
    assert.match(
        String(created.mediaUrl),
        /^https:\/\/res\.cloudinary\.com\/demo\/video\/upload\/c_pad/
    );
    assert.match(String(created.mediaCoverUrl), /reel-1\.jpg/);
    assert.equal(created.mediaJpegUrl, '');
    assert.equal(created.mediaDuration, 30);
    assert.equal(created.shareToStory, true);
    assert.equal(created.status, 'queued');
});

test('createPost rejects a Facebook reel over 90 seconds', async () => {
    mock.method(socialConnection, 'findOne', () => ({
        select: async () => connectionDoc(),
    }));
    mock.method(user, 'findById', () => cloudinaryUser());
    mock.method(cloudinaryApi, 'resource', async () => reelResource(120));
    const create = mock.method(post, 'create', async () => {
        throw new Error('Post.create should not be called');
    });

    const { res } = createdResponse();
    await assert.rejects(
        () => createPost(requestWithBody(reelBody()), res),
        assertAppError(400, 'FACEBOOK_REEL_TOO_LONG')
    );
    assert.equal(create.mock.callCount(), 0);
});

test('createPost requires a reel video', async () => {
    const { res } = createdResponse();

    await assert.rejects(
        () => createPost(requestWithBody(reelBody({ mediaPublicId: '' })), res),
        assertAppError(400, 'VALIDATION_ERROR')
    );
});

test('createPost keeps image posts working without a mediaType', async () => {
    mock.method(socialConnection, 'findOne', () => ({
        select: async () => connectionDoc(),
    }));
    let created: Record<string, unknown> | undefined;
    mock.method(post, 'create', async (doc: unknown) => {
        created = doc as Record<string, unknown>;
        return doc;
    });

    const { res } = createdResponse();
    await createPost(requestWithBody(createBody()), res);

    assert.ok(created);
    assert.equal(created.mediaType, 'image');
    assert.equal(created.mediaUrl, 'https://example.com/image.jpg');
    assert.equal(created.mediaDuration, 0);
    assert.equal(created.shareToStory, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --import tsx --test src/controllers/postController.test.ts`
Expected: FAIL. The reel test fails validation on `mediaUrl` and the image test fails on `created.mediaType` (`undefined`).

- [ ] **Step 3: Accept reels in `createPost`**

In `backend/src/controllers/postController.ts`:

1. Extend the model import with `type MediaType`.
2. Add imports:

```ts
import { getCloudinaryCredentials } from '../services/credentialService.js';
import { REEL_LIMITS } from '../services/mediaDerivativeService.js';
import { loadReelVideo } from '../services/videoUploadService.js';
```

3. Replace the whole `createPostSchema` declaration with:

```ts
function publicUrl(label: string) {
    return z
        .string()
        .url(`${label} must be a public URL`)
        .refine(
            (value) => /^https?:\/\//i.test(value),
            `${label} must use http or https`
        );
}

const postFields = {
    connectionId: z.string().min(1),
    caption: z.string().trim().min(1, 'Caption is required').max(2200),
    platforms: platformSchema,
    action: z.enum(['draft', 'queue', 'now']).default('queue'),
    shareToStory: z.boolean().default(false),
};

const createImagePostSchema = z.object({
    ...postFields,
    mediaType: z.literal('image'),
    mediaUrl: publicUrl('mediaUrl'),
    mediaJpegUrl: publicUrl('mediaJpegUrl').optional().default(''),
    mediaPublicId: z.string().max(300).optional().default(''),
});

// A reel's URLs and duration are read back from Cloudinary, never taken from
// the client.
const createReelPostSchema = z.object({
    ...postFields,
    mediaType: z.literal('reel'),
    mediaPublicId: z.string().trim().min(1, 'Upload a reel video first').max(300),
});

const createPostSchema = z.preprocess(
    (body) =>
        body && typeof body === 'object' && !('mediaType' in body)
            ? { ...body, mediaType: 'image' }
            : body,
    z.discriminatedUnion('mediaType', [createImagePostSchema, createReelPostSchema])
);

type CreatePostInput = z.infer<typeof createPostSchema>;

interface PostMediaFields {
    mediaType: MediaType;
    mediaUrl: string;
    mediaJpegUrl: string;
    mediaPublicId: string;
    mediaDuration: number;
    mediaCoverUrl: string;
}

async function resolvePostMedia(
    userId: string,
    parsed: CreatePostInput
): Promise<PostMediaFields> {
    if (parsed.mediaType === 'image') {
        return {
            mediaType: 'image',
            mediaUrl: parsed.mediaUrl,
            mediaJpegUrl: parsed.mediaJpegUrl,
            mediaPublicId: parsed.mediaPublicId,
            mediaDuration: 0,
            mediaCoverUrl: '',
        };
    }

    const credentials = await getCloudinaryCredentials(userId);
    const video = await loadReelVideo(userId, parsed.mediaPublicId, credentials);
    if (parsed.platforms.facebook && video.duration > REEL_LIMITS.maxFacebookSeconds) {
        throw new AppError(
            400,
            'Facebook Reels can be at most 90 seconds long. Turn off Facebook or upload a shorter reel.',
            'FACEBOOK_REEL_TOO_LONG'
        );
    }

    return {
        mediaType: 'reel',
        mediaUrl: video.url,
        mediaJpegUrl: '',
        mediaPublicId: video.publicId,
        mediaDuration: video.duration,
        mediaCoverUrl: video.coverUrl,
    };
}
```

4. In `createPost`, add after the Instagram checks (before `if (parsed.action === 'now')`):

```ts
    const media = await resolvePostMedia(req.user.id, parsed);
```

5. In both `Post.create({ ... })` calls, replace the three lines `mediaUrl: parsed.mediaUrl, mediaJpegUrl: parsed.mediaJpegUrl, mediaPublicId: parsed.mediaPublicId,` with:

```ts
                ...media,
                shareToStory: parsed.shareToStory,
```

- [ ] **Step 4: Run tests and types**

Run: `cd backend && node --import tsx --test src/controllers/postController.test.ts`
Expected: PASS (all tests, including the 4 new ones).

Run: `cd backend && npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/postController.ts backend/src/controllers/postController.test.ts
git commit -m "feat: create reel posts from verified Cloudinary videos"
```

---

### Task 8: Publish reels

**Files:**
- Modify: `backend/src/services/publishService.ts`
- Test: `backend/src/services/publishService.test.ts`

- [ ] **Step 1: Write the failing tests**

In `backend/src/services/publishService.test.ts`, add this line under the existing `import assert …` line at the top (type-only imports are erased, so it can sit above the env setup):

```ts
import type { MetaMediaDeps } from './metaMediaJobs.js';
```

Add after the `User` import:

```ts
const { encryptSecret } = await import('./cryptoService.js');
```

Append:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --import tsx --test src/services/publishService.test.ts`
Expected: FAIL. The reel tests reach `publishToInstagram`/`publishToFacebook` and call the real Graph API (`calls` stays empty, target errors are network errors).

- [ ] **Step 3: Dispatch reels in `publishService`**

In `backend/src/services/publishService.ts`:

1. Replace the `metaService` import with:

```ts
import { REEL_LIMITS, REEL_THUMB_OFFSET_MS } from './mediaDerivativeService.js';
import {
    FACEBOOK_REEL_STATUS_WAIT_MS,
    INSTAGRAM_VIDEO_WAIT_MS,
    assertInstagramQuota,
    defaultMetaMediaDeps,
    publishFacebookVideoJob,
    publishInstagramContainerJob,
    type MetaMediaDeps,
} from './metaMediaJobs.js';
import {
    MetaApiError,
    createInstagramContainer,
    getInstagramContainerStatus,
    publishFacebookPhoto,
    publishInstagramContainer,
} from './metaService.js';
import { Deadline, PUBLISH_RUN_MS } from './pollService.js';
```

2. Add below the `PublishOptions` interface:

```ts
const TOKEN_ERROR_MESSAGE =
    'Meta access token is invalid or was revoked. Reconnect this Page.';
```

3. In `publishToInstagram`, replace the `usage` lines (from `const usage = await getInstagramPublishingUsage(...)` through the closing `}` of its `if`) with:

```ts
    await assertInstagramQuota(igUserId, accessToken);
```

4. Add this function after `publishToInstagram`:

```ts
async function publishReel(
    post: IPost,
    connection: ISocialConnection,
    accessToken: string,
    target: IPostTarget,
    deps: MetaMediaDeps,
    deadline: Deadline
): Promise<void> {
    if (!post.mediaUrl) {
        throw new MetaApiError('This reel has no video', 400);
    }
    if (
        target.platform === 'facebook' &&
        post.mediaDuration > REEL_LIMITS.maxFacebookSeconds
    ) {
        throw new MetaApiError('Facebook Reels can be at most 90 seconds long.', 400);
    }
    // 425 (Too Early): nothing reached Meta, so a retry cannot duplicate it.
    if (!(await deps.waitForDerivative(post.mediaUrl, deadline))) {
        throw new MetaApiError(
            'Cloudinary is still preparing this reel. Retry in a few minutes.',
            425
        );
    }

    if (target.platform === 'facebook') {
        await publishFacebookVideoJob(
            {
                pageId: connection.pageId,
                accessToken,
                edge: 'video_reels',
                fileUrl: post.mediaUrl,
                finishParams: { video_state: 'PUBLISHED', description: post.caption },
                target,
                statusWaitMs: FACEBOOK_REEL_STATUS_WAIT_MS,
            },
            deps.facebookVideo,
            deadline
        );
        return;
    }

    const igUserId = connection.instagram?.id;
    if (!igUserId) {
        throw new MetaApiError(
            'No Instagram Business account is linked to this Facebook Page',
            400
        );
    }
    await assertInstagramQuota(igUserId, accessToken, deps.instagramUsage);
    await publishInstagramContainerJob(
        {
            igUserId,
            accessToken,
            target,
            params: {
                media_type: 'REELS',
                video_url: post.mediaUrl,
                caption: post.caption,
                share_to_feed: 'true',
                thumb_offset: REEL_THUMB_OFFSET_MS,
            },
            waitMs: INSTAGRAM_VIDEO_WAIT_MS,
            stillProcessingMessage:
                'Instagram is still processing this reel. Retry in a few minutes.',
        },
        deps.instagram,
        deadline
    );
}
```

5. Change the `publishPost` signature to:

```ts
export async function publishPost(
    post: IPost,
    connection: ISocialConnection,
    options: PublishOptions = {},
    deps: MetaMediaDeps = defaultMetaMediaDeps
): Promise<IPost> {
```

6. Replace the target loop's `try` body:

```ts
            if (target.platform === 'facebook') {
                await publishToFacebook(post, connection, accessToken, target);
            } else {
                await publishToInstagram(post, connection, accessToken, target);
            }
```

with:

```ts
            if (post.mediaType === 'reel') {
                await publishReel(post, connection, accessToken, target, deps, deadline);
            } else if (target.platform === 'facebook') {
                await publishToFacebook(post, connection, accessToken, target);
            } else {
                await publishToInstagram(post, connection, accessToken, target);
            }
```

`publishPost` has two loops over `targets`: the first marks each target `publishing` and is followed by `await post.save();`, the second publishes. Add this line between that `await post.save();` and the second loop:

```ts
    const deadline = Deadline.after(PUBLISH_RUN_MS, deps.clock);
```

7. In the loop's `catch`, replace the literal token message with `TOKEN_ERROR_MESSAGE`:

```ts
            if (error instanceof MetaApiError && error.isTokenError) {
                await markConnectionNeedsReauth(connection, TOKEN_ERROR_MESSAGE);
            }
```

- [ ] **Step 4: Run tests and types**

Run: `cd backend && node --import tsx --test src/services/publishService.test.ts`
Expected: PASS (5 tests).

Run: `cd backend && npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/publishService.ts backend/src/services/publishService.test.ts
git commit -m "feat: publish reels to Facebook and Instagram"
```

---

### Task 9: Story sharing and automatic Stories

**Files:**
- Create: `backend/src/services/storyService.ts`
- Modify: `backend/src/services/publishService.ts`
- Test: `backend/src/services/storyService.test.ts` (new), `backend/src/services/publishService.test.ts`

- [ ] **Step 1: Write the failing Story tests**

Create `backend/src/services/storyService.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/services/storyService.test.ts`
Expected: FAIL with `Cannot find module './storyService.js'`.

- [ ] **Step 3: Write `storyService`**

Create `backend/src/services/storyService.ts`:

```ts
import type { IPost, IPostTarget, Platform } from '../models/postModel.js';
import type { ISocialConnection } from '../models/socialConnectionModel.js';
import { storyImageUrl, storyVideoUrl } from './mediaDerivativeService.js';
import {
    INSTAGRAM_IMAGE_WAIT_MS,
    INSTAGRAM_VIDEO_WAIT_MS,
    assertInstagramQuota,
    markTargetPublished,
    publishFacebookVideoJob,
    publishInstagramContainerJob,
    type MetaMediaDeps,
} from './metaMediaJobs.js';
import { MetaApiError } from './metaService.js';
import type { Deadline } from './pollService.js';

export interface StoryShare {
    post: IPost;
    connection: ISocialConnection;
    accessToken: string;
    /** Requested platforms; storyPlatforms decides which are attempted. */
    platforms: Platform[];
    deadline: Deadline;
    /** Called when Meta rejects the Page token. */
    onTokenError: () => Promise<void>;
}

interface StoryMedia {
    kind: 'image' | 'video';
    url: string;
}

/** Platforms where the post itself published and its Story has not yet. */
export function storyPlatforms(
    post: Pick<IPost, 'targets' | 'storyTargets'>,
    requested: Platform[]
): Platform[] {
    return [...new Set(requested)].filter(
        (platform) =>
            post.targets.some(
                (target) => target.platform === platform && target.status === 'published'
            ) &&
            !(post.storyTargets ?? []).some(
                (target) => target.platform === platform && target.status === 'published'
            )
    );
}

function ensureStoryTarget(post: IPost, platform: Platform): IPostTarget {
    let target = post.storyTargets.find((item) => item.platform === platform);
    if (!target) {
        post.storyTargets.push({
            platform,
            status: 'pending',
            externalId: '',
            creationId: '',
            error: '',
            publishedAt: null,
        });
        target = post.storyTargets[post.storyTargets.length - 1] as IPostTarget;
    }
    return target;
}

async function storyMedia(
    post: IPost,
    deps: MetaMediaDeps,
    deadline: Deadline
): Promise<StoryMedia> {
    if (!post.mediaPublicId) {
        throw new MetaApiError('Stories need an image uploaded through Meta-Bru.', 400);
    }

    const cloudName = await deps.cloudName(String(post.userId));
    if (post.mediaType !== 'reel') {
        return { kind: 'image', url: storyImageUrl(cloudName, post.mediaPublicId) };
    }

    const url = storyVideoUrl(cloudName, post.mediaPublicId);
    if (!(await deps.waitForDerivative(url, deadline))) {
        throw new MetaApiError(
            'Cloudinary is still preparing this Story. Share it again in a few minutes.',
            425
        );
    }
    return { kind: 'video', url };
}

async function shareToInstagram(
    connection: ISocialConnection,
    accessToken: string,
    media: StoryMedia,
    target: IPostTarget,
    deps: MetaMediaDeps,
    deadline: Deadline
): Promise<void> {
    const igUserId = connection.instagram?.id;
    if (!igUserId) {
        throw new MetaApiError(
            'No Instagram Business account is linked to this Facebook Page',
            400
        );
    }

    await assertInstagramQuota(igUserId, accessToken, deps.instagramUsage);
    await publishInstagramContainerJob(
        {
            igUserId,
            accessToken,
            target,
            params:
                media.kind === 'video'
                    ? { media_type: 'STORIES', video_url: media.url }
                    : { media_type: 'STORIES', image_url: media.url },
            waitMs: media.kind === 'video' ? INSTAGRAM_VIDEO_WAIT_MS : INSTAGRAM_IMAGE_WAIT_MS,
            stillProcessingMessage:
                'Instagram is still processing this Story. Share it again in a few minutes.',
        },
        deps.instagram,
        deadline
    );
}

async function shareToFacebook(
    connection: ISocialConnection,
    accessToken: string,
    media: StoryMedia,
    target: IPostTarget,
    deps: MetaMediaDeps,
    deadline: Deadline
): Promise<void> {
    if (media.kind === 'video') {
        // video_stories finish returns the Story's post_id, so no status poll.
        await publishFacebookVideoJob(
            {
                pageId: connection.pageId,
                accessToken,
                edge: 'video_stories',
                fileUrl: media.url,
                finishParams: {},
                target,
                statusWaitMs: 0,
            },
            deps.facebookVideo,
            deadline
        );
        return;
    }

    const photoId = await deps.facebookPhoto.uploadUnpublished(
        connection.pageId,
        accessToken,
        media.url
    );
    const story = await deps.facebookPhoto.publishStory(
        connection.pageId,
        accessToken,
        photoId
    );
    markTargetPublished(target, story.postId || photoId);
}

/**
 * Shares a published post or reel to Stories. Each platform succeeds or fails
 * on its own, and the post's own status, lastError, and publishedAt never
 * change.
 */
export async function publishStories(
    share: StoryShare,
    deps: MetaMediaDeps
): Promise<void> {
    const { post, connection, accessToken, deadline } = share;
    const platforms = storyPlatforms(post, share.platforms);
    if (platforms.length === 0) return;

    const targets = platforms.map((platform) => ensureStoryTarget(post, platform));
    for (const target of targets) {
        target.status = 'publishing';
        target.error = '';
    }
    await post.save();

    let media: StoryMedia | null = null;
    let mediaError: unknown = null;
    try {
        media = await storyMedia(post, deps, deadline);
    } catch (error) {
        mediaError = error;
    }

    for (const target of targets) {
        try {
            if (!media) throw mediaError;
            if (deadline.expired()) {
                throw new MetaApiError('Ran out of time. Share this Story again from Queue.', 425);
            }

            if (target.platform === 'instagram') {
                await shareToInstagram(connection, accessToken, media, target, deps, deadline);
            } else {
                await shareToFacebook(connection, accessToken, media, target, deps, deadline);
            }
        } catch (error) {
            target.status = 'failed';
            target.error = error instanceof Error ? error.message : 'Story sharing failed';
            if (error instanceof MetaApiError && error.isTokenError) {
                await share.onTokenError();
            }
        }

        // Save each Story as it finishes, as publishing does for targets.
        await post.save();
    }
}
```

- [ ] **Step 4: Run the Story tests**

Run: `cd backend && node --import tsx --test src/services/storyService.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the failing automatic-Story test**

Append to `backend/src/services/publishService.test.ts`:

```ts
test('publishPost shares a published reel to Story when asked', async () => {
    mock.method(User, 'findById', () => metaUser());
    const post = reelPost({ shareToStory: true });
    const { deps, calls, containerParams } = fakeDeps();

    await publishPost(post as never, reelConnection() as never, {}, deps);

    assert.equal(post.status, 'published');
    assert.deepEqual(containerParams.map((params) => params.media_type), ['REELS', 'STORIES']);
    assert.ok(calls.some((call) => call.startsWith('wait:') && call.includes('du_60')));
    const storyTargets = post.storyTargets as Array<Record<string, unknown>>;
    assert.equal(storyTargets[0]?.platform, 'instagram');
    assert.equal(storyTargets[0]?.status, 'published');
});

test('publishPost leaves the post published when its Story fails', async () => {
    mock.method(User, 'findById', () => metaUser());
    const post = reelPost({ shareToStory: true });
    const { deps } = fakeDeps();
    deps.instagram.createContainer = async (_igUserId, _token, params) => {
        if (params.media_type === 'STORIES') {
            throw new Error('Story rejected');
        }
        return 'container-1';
    };

    await publishPost(post as never, reelConnection() as never, {}, deps);

    assert.equal(post.status, 'published');
    assert.equal(post.lastError, '');
    const storyTargets = post.storyTargets as Array<Record<string, unknown>>;
    assert.equal(storyTargets[0]?.status, 'failed');
    assert.equal(storyTargets[0]?.error, 'Story rejected');
});

test('publishPost skips Stories when shareToStory is off', async () => {
    mock.method(User, 'findById', () => metaUser());
    const post = reelPost();
    const { deps, containerParams } = fakeDeps();

    await publishPost(post as never, reelConnection() as never, {}, deps);

    assert.deepEqual(containerParams.map((params) => params.media_type), ['REELS']);
    assert.deepEqual(post.storyTargets, []);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/services/publishService.test.ts`
Expected: FAIL. The two `shareToStory: true` tests see only the `REELS` container.

- [ ] **Step 7: Share Stories after publishing**

In `backend/src/services/publishService.ts`:

1. Add the import:

```ts
import { publishStories } from './storyService.js';
```

2. Replace the end of `publishPost`:

```ts
    await post.save();
    return post;
}
```

with:

```ts
    await post.save();

    if (post.shareToStory) {
        await publishStories(
            {
                post,
                connection,
                accessToken,
                platforms,
                deadline,
                onTokenError: () =>
                    markConnectionNeedsReauth(connection, TOKEN_ERROR_MESSAGE),
            },
            deps
        );
    }

    return post;
}
```

- [ ] **Step 8: Run tests and types**

Run: `cd backend && node --import tsx --test src/services/publishService.test.ts src/services/storyService.test.ts`
Expected: PASS.

Run: `cd backend && npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/storyService.ts backend/src/services/storyService.test.ts backend/src/services/publishService.ts backend/src/services/publishService.test.ts
git commit -m "feat: share posts and reels to Stories after publishing"
```

---

### Task 10: Share-to-Story endpoint

**Files:**
- Modify: `backend/src/services/publishService.ts`, `backend/src/controllers/postController.ts`, `backend/src/routes/postRoutes.ts`
- Test: `backend/src/controllers/postController.test.ts`

- [ ] **Step 1: Write the failing tests**

In `backend/src/controllers/postController.test.ts`, change the controller import to:

```ts
const { createPost, publishNow, retryPost, shareStory } = await import(
    './postController.js'
);
```

Append:

```ts
function publishedPost(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return queuedPost({
        status: 'published',
        targets: [
            {
                platform: 'facebook',
                status: 'published',
                externalId: 'fb-post-1',
                creationId: '',
                error: '',
                publishedAt: new Date(),
            },
        ],
        storyTargets: [],
        ...overrides,
    });
}

test('shareStory validates the requested platforms', async () => {
    const { res } = response();

    await assert.rejects(
        () => shareStory(requestWithBody({ platforms: [] }), res),
        assertAppError(400, 'VALIDATION_ERROR')
    );
});

test('shareStory rejects a post that has not published', async () => {
    mock.method(post, 'findOne', async () => queuedPost());
    const { res } = response();

    await assert.rejects(
        () => shareStory(requestWithBody({ platforms: ['facebook'] }), res),
        assertAppError(400, 'POST_NOT_PUBLISHED')
    );
});

test('shareStory rejects platforms with nothing left to share', async () => {
    mock.method(post, 'findOne', async () =>
        publishedPost({
            storyTargets: [
                {
                    platform: 'facebook',
                    status: 'published',
                    externalId: 'story-1',
                    creationId: '',
                    error: '',
                    publishedAt: new Date(),
                },
            ],
        })
    );
    const claim = mock.method(socialConnection, 'findOneAndUpdate', () => {
        throw new Error('the Page lock should not be claimed');
    });
    const { res } = response();

    await assert.rejects(
        () => shareStory(requestWithBody({ platforms: ['facebook', 'instagram'] }), res),
        assertAppError(400, 'NOTHING_TO_SHARE')
    );
    assert.equal(claim.mock.callCount(), 0);
});

test('shareStory releases the Page lock when sharing fails', async () => {
    mock.method(post, 'findOne', async () => publishedPost());
    mock.method(socialConnection, 'findOneAndUpdate', () => ({
        select: async () => connectionDoc(),
    }));
    // No Meta credentials: sharePostToStory throws META_NOT_CONFIGURED.
    mock.method(user, 'findById', () => ({
        select: async () => ({ credentialsEnc: '' }),
    }));
    const release = mock.method(socialConnection, 'updateOne', () => ({
        matchedCount: 1,
    }));
    const { res } = response();

    await assert.rejects(
        () => shareStory(requestWithBody({ platforms: ['facebook'] }), res),
        assertAppError(503, 'META_NOT_CONFIGURED')
    );
    assert.equal(release.mock.callCount(), 1);
    assert.deepEqual(
        (release.mock.calls[0]?.arguments[1] as Record<string, unknown>).$set,
        { lockedAt: null }
    );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --import tsx --test src/controllers/postController.test.ts`
Expected: FAIL. `shareStory is not a function`.

- [ ] **Step 3: Add `sharePostToStory`**

In `backend/src/services/publishService.ts`, add after `publishPost`:

```ts
/**
 * Shares an already published post or reel to Stories on demand. The caller
 * must hold the Page lock and pass a connection fetched with
 * `+pageAccessTokenEnc`.
 */
export async function sharePostToStory(
    post: IPost,
    connection: ISocialConnection,
    platforms: Platform[],
    deps: MetaMediaDeps = defaultMetaMediaDeps
): Promise<IPost> {
    // Same rule as publishing: only the owner's own Meta app may be used.
    await getMetaCredentials(String(post.userId));

    let accessToken: string;
    try {
        accessToken = decryptSecret(connection.pageAccessTokenEnc);
    } catch {
        const message = 'Stored Page token could not be decrypted. Reconnect this Page.';
        await markConnectionNeedsReauth(connection, message);
        throw new AppError(409, message, 'RECONNECT_REQUIRED');
    }

    await publishStories(
        {
            post,
            connection,
            accessToken,
            platforms,
            deadline: Deadline.after(PUBLISH_RUN_MS, deps.clock),
            onTokenError: () => markConnectionNeedsReauth(connection, TOKEN_ERROR_MESSAGE),
        },
        deps
    );
    return post;
}
```

- [ ] **Step 4: Add the controller and route**

In `backend/src/controllers/postController.ts`:

1. Change the publish service import to:

```ts
import { publishPost, sharePostToStory } from '../services/publishService.js';
import { storyPlatforms } from '../services/storyService.js';
```

2. Add after `updatePostSchema`:

```ts
const shareStorySchema = z.object({
    platforms: z.array(z.enum(['facebook', 'instagram'])).min(1).max(2),
});
```

3. Append:

```ts
export async function shareStory(req: Request, res: Response): Promise<void> {
    const { platforms } = parseBody(shareStorySchema, req);
    const existing = await ownedPost(String(req.params.id), req.user.id);

    if (existing.status !== 'published' && existing.status !== 'partial') {
        throw new AppError(
            400,
            'Only published posts can be shared to Story',
            'POST_NOT_PUBLISHED'
        );
    }
    if (storyPlatforms(existing, platforms).length === 0) {
        throw new AppError(
            400,
            'Nothing left to share to Story on those platforms',
            'NOTHING_TO_SHARE'
        );
    }

    // The Page lock stops a second click or the scheduler from racing this.
    const { connection, lockedAt } = await claimConnectionForPublish(
        existing.connectionId.toString(),
        req.user.id
    );

    try {
        // Re-read under the lock so a share that just finished is not repeated.
        const post = await ownedPost(String(req.params.id), req.user.id);
        await sharePostToStory(post, connection, platforms);
        res.json({ success: true, post });
    } finally {
        await releaseConnectionLock(connection._id.toString(), lockedAt);
    }
}
```

In `backend/src/routes/postRoutes.ts`, import `shareStory` and add:

```ts
router.post('/:id/story', shareStory);
```

- [ ] **Step 5: Run tests and types**

Run: `cd backend && node --import tsx --test src/controllers/postController.test.ts`
Expected: PASS.

Run: `cd backend && npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/publishService.ts backend/src/controllers/postController.ts backend/src/controllers/postController.test.ts backend/src/routes/postRoutes.ts
git commit -m "feat: share a published post or reel to Story on demand"
```

---

### Task 11: List videos in Storage

**Files:**
- Modify: `backend/src/services/cloudinaryStorageService.ts`
- Test: `backend/src/services/cloudinaryStorageService.test.ts`

- [ ] **Step 1: Update the fixture and write the failing test**

In `backend/src/services/cloudinaryStorageService.test.ts`, add to the object returned by `baseAsset` (before `...overrides`):

```ts
        resourceType: 'image',
        duration: 0,
```

Add this import after the `cloudinaryStorageService.js` dynamic import block:

```ts
const { reelCoverUrl } = await import('./mediaDerivativeService.js');
```

Append:

```ts
test('normalizes a Cloudinary video with its cover as the thumbnail', () => {
    const asset = normalizeAsset(
        {
            asset_id: 'video-1',
            public_id: 'meta-bru/user-1/reel-1',
            asset_folder: 'meta-bru/user-1',
            resource_type: 'video',
            secure_url: 'https://res.cloudinary.com/demo/video/upload/reel-1.mp4',
            format: 'mp4',
            width: 1080,
            height: 1920,
            bytes: 9_000_000,
            duration: 12.5,
            created_at: '2026-10-29T00:00:00Z',
        },
        'demo'
    );

    assert.ok(asset);
    assert.equal(asset.resourceType, 'video');
    assert.equal(asset.duration, 12.5);
    assert.equal(asset.thumbnailUrl, reelCoverUrl('demo', 'meta-bru/user-1/reel-1'));
});

test('treats assets without a resource type as images', () => {
    const asset = normalizeAsset(
        { asset_id: 'asset-1', public_id: 'meta-bru/user-1/image', format: 'jpg' },
        'demo'
    );

    assert.ok(asset);
    assert.equal(asset.resourceType, 'image');
    assert.equal(asset.duration, 0);
    assert.equal(asset.thumbnailUrl, thumbnailUrlFor('demo', 'meta-bru/user-1/image'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/services/cloudinaryStorageService.test.ts`
Expected: FAIL. `asset.resourceType` is `undefined`.

- [ ] **Step 3: Add videos to the storage service**

In `backend/src/services/cloudinaryStorageService.ts`:

1. Add the import:

```ts
import { reelCoverUrl } from './mediaDerivativeService.js';
```

2. Add after `export type DuplicateMatch`:

```ts
export type MediaResourceType = 'image' | 'video';
```

3. Add to `StorageAssetBase` after `assetFolder`:

```ts
    resourceType: MediaResourceType;
    /** Video length in seconds; 0 for images. */
    duration: number;
```

4. Add to `RawAsset`:

```ts
    resource_type?: unknown;
    duration?: unknown;
```

5. In `normalizeAsset`, add before the `return`:

```ts
    const resourceType: MediaResourceType =
        raw.resource_type === 'video' ? 'video' : 'image';
```

and in the returned object, add after `assetFolder`:

```ts
        resourceType,
        duration: numberOrZero(raw.duration),
```

and replace `thumbnailUrl: thumbnailUrlFor(cloudName, publicId),` with:

```ts
        thumbnailUrl:
            resourceType === 'video'
                ? reelCoverUrl(cloudName, publicId)
                : thumbnailUrlFor(cloudName, publicId),
```

6. In `searchUserAssets`, change the expression to:

```ts
    const expression = `(public_id:${folder}/* OR asset_folder=${folder}) AND (resource_type:image OR resource_type:video) AND type:upload`;
```

7. Replace the whole `listUserAssetsByPrefix` function with:

```ts
async function listUserAssetsByPrefix(
    credentials: CloudinaryCredentials,
    userId: string,
    cap: number
): Promise<AssetListResult> {
    const prefix = userFolderPrefix(userId);
    const assets: StorageAssetBase[] = [];
    let truncated = false;

    // The Admin API lists one resource type per call.
    for (const resourceType of ['image', 'video'] as const) {
        let cursor = '';

        do {
            const options: Record<string, unknown> = {
                ...credentialsOptions(credentials),
                resource_type: resourceType,
                type: 'upload',
                prefix,
                max_results: 500,
            };
            if (cursor) options.next_cursor = cursor;

            const raw = await cloudinary.api.resources(options);
            const page = normalizePage(raw, credentials.cloudName);
            assets.push(
                ...page.assets.filter((asset) =>
                    isAssetInUserFolder(asset, userId)
                )
            );
            cursor = page.nextCursor;

            if (assets.length >= cap) {
                truncated = Boolean(cursor) || resourceType !== 'video';
                break;
            }
        } while (cursor);

        if (assets.length >= cap) break;
    }

    return { assets: assets.slice(0, cap), truncated };
}
```

8. In `deleteUserAssets`, change the two messages to:

```ts
            'Select at least one file to delete.',
```

```ts
            `You can delete at most ${MAX_DELETE_IDS} files at a time.`,
```

- [ ] **Step 4: Run tests and types**

Run: `cd backend && node --import tsx --test src/services/cloudinaryStorageService.test.ts src/controllers/mediaController.test.ts`
Expected: PASS.

Run: `cd backend && npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/cloudinaryStorageService.ts backend/src/services/cloudinaryStorageService.test.ts
git commit -m "feat: list reel videos in Storage"
```

---

### Task 12: Remove a deleted post's Cloudinary file

**Files:**
- Modify: `backend/src/services/cloudinaryStorageService.ts`, `backend/src/controllers/postController.ts`
- Test: `backend/src/services/cloudinaryStorageService.test.ts`, `backend/src/controllers/postController.test.ts`

- [ ] **Step 1: Write the failing service tests**

In `backend/src/services/cloudinaryStorageService.test.ts`, change the first line to:

```ts
import test, { afterEach, mock } from 'node:test';
```

add `deletePostMediaIfUnused` to the destructured dynamic import from `./cloudinaryStorageService.js`, and add after that import:

```ts
const { Post } = await import('../models/postModel.js');
const { User } = await import('../models/userModel.js');
const { encryptSecret } = await import('./cryptoService.js');

type MockableModel = Record<string, (...args: unknown[]) => unknown>;
const postModel = Post as unknown as MockableModel;
const userModel = User as unknown as MockableModel;
const OWNER_ID = '64b7f1c2a1b2c3d4e5f60719';

afterEach(() => mock.restoreAll());

function cloudinaryOwner() {
    return {
        select: async () => ({
            credentialsEnc: encryptSecret(
                JSON.stringify({
                    cloudinary: { cloudName: 'demo', apiKey: 'key', apiSecret: 'secret' },
                })
            ),
        }),
    };
}

function fakeFileStore(assetFolder: string | null, removeError?: Error) {
    const removed: Array<[string, string]> = [];
    return {
        removed,
        storeFor: () => ({
            assetFolder: async () => assetFolder,
            remove: async (publicId: string, resourceType: string) => {
                if (removeError) throw removeError;
                removed.push([publicId, resourceType]);
            },
        }),
    };
}
```

Append:

```ts
test('deletes an unused post file from the user folder', async () => {
    mock.method(postModel, 'exists', async () => null);
    mock.method(userModel, 'findById', () => cloudinaryOwner());
    const files = fakeFileStore(`meta-bru/${OWNER_ID}`);

    const result = await deletePostMediaIfUnused(
        OWNER_ID,
        { publicId: `meta-bru/${OWNER_ID}/reel-1`, resourceType: 'video' },
        files.storeFor
    );

    assert.deepEqual(result, { mediaDeleted: true, mediaError: '' });
    assert.deepEqual(files.removed, [[`meta-bru/${OWNER_ID}/reel-1`, 'video']]);
});

test('keeps a file another post still uses', async () => {
    mock.method(postModel, 'exists', async () => ({ _id: 'other-post' }));
    const files = fakeFileStore(`meta-bru/${OWNER_ID}`);

    const result = await deletePostMediaIfUnused(
        OWNER_ID,
        { publicId: `meta-bru/${OWNER_ID}/image-1`, resourceType: 'image' },
        files.storeFor
    );

    assert.deepEqual(result, { mediaDeleted: false, mediaError: '' });
    assert.deepEqual(files.removed, []);
});

test('never deletes a file outside the user folder', async () => {
    mock.method(postModel, 'exists', async () => null);
    mock.method(userModel, 'findById', () => cloudinaryOwner());
    const files = fakeFileStore('somewhere-else');

    const result = await deletePostMediaIfUnused(
        OWNER_ID,
        { publicId: 'somewhere-else/image-1', resourceType: 'image' },
        files.storeFor
    );

    assert.deepEqual(result, { mediaDeleted: false, mediaError: '' });
    assert.deepEqual(files.removed, []);
});

test('reports a Cloudinary failure instead of throwing', async () => {
    mock.method(postModel, 'exists', async () => null);
    mock.method(userModel, 'findById', () => cloudinaryOwner());
    const files = fakeFileStore(`meta-bru/${OWNER_ID}`, new Error('Cloudinary is down'));

    const result = await deletePostMediaIfUnused(
        OWNER_ID,
        { publicId: `meta-bru/${OWNER_ID}/image-1`, resourceType: 'image' },
        files.storeFor
    );

    assert.deepEqual(result, { mediaDeleted: false, mediaError: 'Cloudinary is down' });
});

test('skips cleanup quietly without Cloudinary credentials or media', async () => {
    mock.method(postModel, 'exists', async () => null);
    mock.method(userModel, 'findById', () => ({
        select: async () => ({ credentialsEnc: '' }),
    }));
    const files = fakeFileStore(`meta-bru/${OWNER_ID}`);

    assert.deepEqual(
        await deletePostMediaIfUnused(
            OWNER_ID,
            { publicId: `meta-bru/${OWNER_ID}/image-1`, resourceType: 'image' },
            files.storeFor
        ),
        { mediaDeleted: false, mediaError: '' }
    );
    assert.deepEqual(
        await deletePostMediaIfUnused(OWNER_ID, { publicId: '', resourceType: 'image' }, files.storeFor),
        { mediaDeleted: false, mediaError: '' }
    );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/services/cloudinaryStorageService.test.ts`
Expected: FAIL. `deletePostMediaIfUnused is not a function`.

- [ ] **Step 3: Write the cleanup**

Append to `backend/src/services/cloudinaryStorageService.ts`:

```ts
export interface PostMediaCleanup {
    mediaDeleted: boolean;
    mediaError: string;
}

export interface MediaFileStore {
    /** The file's asset folder, or null when Cloudinary no longer has it. */
    assetFolder(publicId: string, resourceType: MediaResourceType): Promise<string | null>;
    remove(publicId: string, resourceType: MediaResourceType): Promise<void>;
}

export function cloudinaryMediaFileStore(
    credentials: CloudinaryCredentials
): MediaFileStore {
    const options = credentialsOptions(credentials);

    return {
        async assetFolder(publicId, resourceType) {
            try {
                const raw = (await cloudinary.api.resource(publicId, {
                    ...options,
                    resource_type: resourceType,
                })) as { asset_folder?: unknown };
                return typeof raw.asset_folder === 'string' ? raw.asset_folder : '';
            } catch (error) {
                if (cloudinaryHttpCode(error) === 404) return null;
                throw error;
            }
        },
        async remove(publicId, resourceType) {
            const response = (await cloudinary.api.delete_resources([publicId], {
                ...options,
                resource_type: resourceType,
                type: 'upload',
            })) as DeleteApiResponse;
            const status = response.deleted?.[publicId];
            if (status !== 'deleted' && status !== 'not_found') {
                throw new Error(
                    typeof status === 'string'
                        ? `Cloudinary returned: ${status}`
                        : 'Cloudinary did not confirm deletion.'
                );
            }
        },
    };
}

/**
 * Deletes a deleted post's Cloudinary file when no other post of the same
 * user still uses it and it sits in the user's Meta-Bru folder. Failures are
 * reported, never thrown: the post is already gone.
 */
export async function deletePostMediaIfUnused(
    userId: string,
    media: { publicId: string; resourceType: MediaResourceType },
    storeFor: (credentials: CloudinaryCredentials) => MediaFileStore = cloudinaryMediaFileStore
): Promise<PostMediaCleanup> {
    const { publicId, resourceType } = media;
    const kept: PostMediaCleanup = { mediaDeleted: false, mediaError: '' };
    if (!publicId) return kept;

    try {
        if (await Post.exists({ userId, mediaPublicId: publicId })) return kept;

        const store = storeFor(await getCloudinaryCredentials(userId));
        const assetFolder = await store.assetFolder(publicId, resourceType);
        if (assetFolder === null || !isAssetInUserFolder({ publicId, assetFolder }, userId)) {
            return kept;
        }

        await store.remove(publicId, resourceType);
        return { mediaDeleted: true, mediaError: '' };
    } catch (error) {
        if (error instanceof AppError && error.code === 'MEDIA_NOT_CONFIGURED') {
            return kept;
        }
        return { mediaDeleted: false, mediaError: cloudinaryErrorMessage(error) };
    }
}
```

- [ ] **Step 4: Run the service tests**

Run: `cd backend && node --import tsx --test src/services/cloudinaryStorageService.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing controller test**

In `backend/src/controllers/postController.test.ts`, change the controller import to:

```ts
const { createPost, deletePost, publishNow, retryPost, shareStory } = await import(
    './postController.js'
);
```

Append:

```ts
test('deletePost keeps a file another post still uses and reports it', async () => {
    const draft = queuedPost({
        status: 'draft',
        mediaType: 'image',
        mediaPublicId: `meta-bru/${USER_ID}/image-1`,
    });
    mock.method(post, 'findOne', async () => draft);
    mock.method(post, 'findOneAndDelete', async () => draft);
    mock.method(post, 'exists', async () => ({ _id: 'another-post' }));
    const { res, json } = response();

    await deletePost(request(), res);

    assert.deepEqual(json.mock.calls[0]?.arguments[0], {
        success: true,
        message: 'Post deleted',
        mediaDeleted: false,
        mediaError: '',
    });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/controllers/postController.test.ts`
Expected: FAIL. The response lacks `mediaDeleted`.

- [ ] **Step 7: Clean up after `deletePost`**

In `backend/src/controllers/postController.ts`:

1. Add the import:

```ts
import { deletePostMediaIfUnused } from '../services/cloudinaryStorageService.js';
```

2. In `deletePost`, replace `res.json({ success: true, message: 'Post deleted' });` with:

```ts
    const cleanup = await deletePostMediaIfUnused(req.user.id, {
        publicId: post.mediaPublicId,
        resourceType: post.mediaType === 'reel' ? 'video' : 'image',
    });

    res.json({ success: true, message: 'Post deleted', ...cleanup });
```

- [ ] **Step 8: Run tests and types**

Run: `cd backend && node --import tsx --test src/controllers/postController.test.ts src/services/cloudinaryStorageService.test.ts`
Expected: PASS.

Run: `cd backend && npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/cloudinaryStorageService.ts backend/src/services/cloudinaryStorageService.test.ts backend/src/controllers/postController.ts backend/src/controllers/postController.test.ts
git commit -m "feat: remove a deleted post's Cloudinary file when unused"
```

---

### Task 13: Reel covers in analytics

**Files:**
- Modify: `backend/src/services/analyticsService.ts`
- Test: `backend/src/services/analyticsService.test.ts`

- [ ] **Step 1: Write the failing test**

In `backend/src/services/analyticsService.test.ts`, append (it reuses the file's existing `analyticsRange`, `mockPostFind`, `post`, `POST_1`, and `USER_ID` helpers):

```ts
test('uses the reel cover as the media preview', async (t) => {
    t.after(() => mock.restoreAll());
    const range = analyticsRange('2026-10-01', '2026-10-31');
    mockPostFind([
        post({
            _id: POST_1,
            mediaType: 'reel',
            mediaUrl: 'https://res.cloudinary.com/demo/video/upload/reel.mp4',
            mediaCoverUrl: 'https://res.cloudinary.com/demo/video/upload/so_1/reel.jpg',
            publishedAt: new Date('2026-10-05T09:00:00.000Z'),
        }),
    ]);

    const targets = await loadPublishedTargets(USER_ID, range, {});

    assert.ok(targets.length > 0);
    assert.equal(
        targets[0]?.mediaUrl,
        'https://res.cloudinary.com/demo/video/upload/so_1/reel.jpg'
    );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --import tsx --test src/services/analyticsService.test.ts`
Expected: FAIL. `mediaUrl` is the `.mp4` URL.

- [ ] **Step 3: Map reels to their cover**

In `backend/src/services/analyticsService.ts`, add to `PostLike` after `mediaUrl?: string;`:

```ts
    mediaType?: 'image' | 'reel';
    mediaCoverUrl?: string;
```

In `targetsFromPost`, replace `mediaUrl: post.mediaUrl || '',` with:

```ts
            // A reel's mediaUrl is an MP4; previews need its cover image.
            mediaUrl:
                post.mediaType === 'reel'
                    ? post.mediaCoverUrl || ''
                    : post.mediaUrl || '',
```

- [ ] **Step 4: Run tests and types**

Run: `cd backend && node --import tsx --test src/services/analyticsService.test.ts`
Expected: PASS.

Run: `cd backend && npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/analyticsService.ts backend/src/services/analyticsService.test.ts
git commit -m "feat: show reel covers in analytics"
```

---

### Task 14: Docs and backend verification

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-10-29-reels-and-story-sharing-design.md`

- [ ] **Step 1: Correct the spec's image Story padding**

In the spec, replace:

```
Image Stories use an on-the-fly image derivative,
`c_pad,w_1080,h_1920,b_blurred:400:15,q_auto:good` as JPG, built from the
post's existing `mediaPublicId`.
```

with:

```
Image Stories use an on-the-fly image derivative,
`c_pad,w_1080,h_1920,b_auto,q_auto:good` as JPG, built from the post's
existing `mediaPublicId`. Cloudinary's blurred padding is video-only, so images
pad with a colour taken from their edges.
```

- [ ] **Step 2: Update the README**

In `README.md`, add these bullets after the "Optional brand logo…" bullet:

```markdown
- Reels: MP4 or MOV videos upload straight from the browser to the user's own
  Cloudinary account, then publish to Facebook Reels (3–90 seconds) and
  Instagram Reels (up to 15 minutes) from the same queue as image posts
- Story sharing: share any published post or reel to Facebook and Instagram
  Stories, automatically after publishing or on demand from Queue
- Deleting an unpublished post also removes its Cloudinary file when no other
  post uses it
```

Replace the paragraph:

```markdown
Image posts only in v1. Video, Reels, carousels, Stories, analytics, and billing
are intentionally out of scope.
```

with:

```markdown
Carousels, long videos over 100 MB, Reel and Story analytics, and billing are
intentionally out of scope.
```

- [ ] **Step 3: Run the full backend suite and build**

Run: `cd backend && npm test`
Expected: every test passes, 0 failures.

Run: `cd backend && npm run build`
Expected: `tsc` exits 0.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-10-29-reels-and-story-sharing-design.md
git commit -m "docs: describe reels and Story sharing"
```
