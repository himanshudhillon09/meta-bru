# Reels and Story Sharing — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Reels page that uploads a video straight to the user's Cloudinary account and queues or publishes it, add Story sharing to the composers and Queue, show reels in Queue and Storage, and confirm deletes that also remove Cloudinary files.

**Architecture:** The Reels page follows the Composer's patterns: client component, `localStorage` draft, the same submit flow, with `mediaType: 'reel'`. Uploads use an `XMLHttpRequest` to Cloudinary for progress, signed by the backend. Shared helpers (`postThumbnailUrl`, `formatDuration`, Story platform helpers) live in `lib/types.ts`; reel file checks live in `lib/reels.ts`.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind 4, TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-29-reels-and-story-sharing-design.md`

**Prerequisite:** `docs/superpowers/plans/2026-10-29-reels-stories-backend.md` is complete (the endpoints below exist).

**Working directory:** `/Users/himanshudhillon/Development/meta-bru` on branch `feat/reels-stories`. Commits use the repo-local identity `Himanshu Dhillon <himanshu.dhillon09@gmail.com>`. Do not push.

**Conventions:**

- `frontend/AGENTS.md`: this Next.js version differs from older releases. Before Task 4, read `frontend/node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`. Every page here is a `'use client'` component, like the existing pages.
- Frontend checks: `cd frontend && npx tsc --noEmit -p .`, `npx eslint src` (0 errors expected; warnings already exist), `./node_modules/.bin/next build`.
- There is no frontend test runner; each task ends with type and lint checks, and Task 9 runs the app.
- Commit messages have a subject and optional body only. **Do not add `Co-Authored-By` or any other AI attribution lines.**

---

## File Structure

| File | Responsibility |
| --- | --- |
| `frontend/src/lib/types.ts` | Reel/Story fields on `Post`, `VideoMedia`, `VideoUploadSignature`, storage `resourceType`, helpers. |
| `frontend/src/lib/reels.ts` (new) | Reel limits, accepted types, reading a local video's length, file checks. |
| `frontend/src/lib/apiClient.ts` | Video signature/register calls, Cloudinary XHR upload, `shareStory`, typed `remove`. |
| `frontend/src/components/AppShell.tsx` | **Reels** nav item and film icon. |
| `frontend/src/components/ShareToStoryToggle.tsx` (new) | The "Also share to Story" switch used by both composers. |
| `frontend/src/app/composer/page.tsx` | Story toggle, saved in the draft and sent on submit. |
| `frontend/src/app/reels/page.tsx` (new) | Reel composer. |
| `frontend/src/components/StoryShareModal.tsx` (new) | Platform picker for sharing a published item to Story. |
| `frontend/src/app/queue/page.tsx` | Posts/Reels filter, reel thumbnails and badges, Story button and chips, delete confirmation. |
| `frontend/src/components/StorageAssetCard.tsx` | Reel badge, duration, and video-safe thumbnail. |
| `frontend/src/app/storage/page.tsx` | Images/Reels filter and "files" wording. |
| `frontend/src/app/activity/page.tsx`, `frontend/src/components/Dashboards.tsx` | Reel covers as thumbnails. |

---

### Task 1: Types and reel helpers

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Create: `frontend/src/lib/reels.ts`

- [ ] **Step 1: Extend the types**

In `frontend/src/lib/types.ts`, add after `export type TargetStatus = …;`:

```ts
export type MediaType = 'image' | 'reel';
```

Add to the `Post` interface after `mediaPublicId: string;`:

```ts
    mediaType?: MediaType;
    /** Reel length in seconds. */
    mediaDuration?: number;
    /** Reel cover JPG; empty for images. */
    mediaCoverUrl?: string;
    shareToStory?: boolean;
    storyTargets?: PostTarget[];
```

Add after the `MediaAsset` interface:

```ts
export interface VideoMedia {
    publicId: string;
    /** Meta-ready MP4 derivative. */
    url: string;
    coverUrl: string;
    /** The uploaded file, used while the derivative is still processing. */
    originalUrl: string;
    width: number;
    height: number;
    duration: number;
    format: string;
    bytes: number;
}

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
```

Add to `StorageAsset` after `assetFolder: string;`:

```ts
    resourceType: 'image' | 'video';
    /** Video length in seconds; 0 for images. */
    duration: number;
```

Add after `connectionName`:

```ts
export function isReel(post: Pick<Post, 'mediaType'>): boolean {
    return post.mediaType === 'reel';
}

/** The image to show for a post: a reel's mediaUrl is an MP4, so use its cover. */
export function postThumbnailUrl(
    post: Pick<Post, 'mediaType' | 'mediaUrl' | 'mediaCoverUrl'>
): string {
    return isReel(post) ? post.mediaCoverUrl || '' : post.mediaUrl;
}

export function publishedPlatforms(post: Pick<Post, 'targets'>): Platform[] {
    return post.targets
        .filter((target) => target.status === 'published')
        .map((target) => target.platform);
}

export function storyTarget(
    post: Pick<Post, 'storyTargets'>,
    platform: Platform
): PostTarget | undefined {
    return (post.storyTargets ?? []).find((target) => target.platform === platform);
}

/** Published platforms whose Story has not published yet. */
export function unsharedStoryPlatforms(
    post: Pick<Post, 'targets' | 'storyTargets'>
): Platform[] {
    return publishedPlatforms(post).filter(
        (platform) => storyTarget(post, platform)?.status !== 'published'
    );
}

export function formatDuration(seconds: number): string {
    const total = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(total / 60);
    return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}
```

- [ ] **Step 2: Add the reel helpers**

Create `frontend/src/lib/reels.ts`:

```ts
/** Mirrors the backend's REEL_LIMITS in mediaDerivativeService. */
export const REEL_LIMITS = {
    maxBytes: 100 * 1024 * 1024,
    minSeconds: 3,
    maxFacebookSeconds: 90,
    maxInstagramSeconds: 15 * 60,
    storySeconds: 60,
} as const;

const REEL_FILE_TYPES = ['video/mp4', 'video/quicktime'];

export const REEL_ACCEPT = REEL_FILE_TYPES.join(',');

export interface VideoFileInfo {
    duration: number;
    width: number;
    height: number;
}

/**
 * Reads a local video's length and size before upload. Resolves null when the
 * browser cannot decode the file; the server still checks it after upload.
 */
export function readVideoFileInfo(file: File): Promise<VideoFileInfo | null> {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const video = document.createElement('video');
        let settled = false;

        const finish = (info: VideoFileInfo | null) => {
            if (settled) return;
            settled = true;
            URL.revokeObjectURL(url);
            resolve(info);
        };

        video.preload = 'metadata';
        video.muted = true;
        video.onloadedmetadata = () =>
            finish(
                Number.isFinite(video.duration)
                    ? {
                          duration: video.duration,
                          width: video.videoWidth,
                          height: video.videoHeight,
                      }
                    : null
            );
        video.onerror = () => finish(null);
        video.src = url;
    });
}

/** Why a file cannot be uploaded as a reel, or '' when it can. */
export function reelFileProblem(file: File, info: VideoFileInfo | null): string {
    // Some browsers leave file.type empty for MOV files, so check the name too.
    const typeOk =
        REEL_FILE_TYPES.includes(file.type) || /\.(mp4|mov)$/i.test(file.name);
    if (!typeOk) return 'Choose an MP4 or MOV video.';
    if (file.size > REEL_LIMITS.maxBytes) {
        return 'Reels can be at most 100 MB. Compress or trim the video first.';
    }
    if (info && info.duration < REEL_LIMITS.minSeconds) {
        return 'Reels must be at least 3 seconds long.';
    }
    if (info && info.duration > REEL_LIMITS.maxInstagramSeconds) {
        return 'Reels can be at most 15 minutes long.';
    }
    return '';
}

export function isNineBySixteen(width: number, height: number): boolean {
    if (!width || !height) return false;
    return Math.abs(width / height - 9 / 16) < 0.01;
}
```

- [ ] **Step 3: Check types and lint**

Run: `cd frontend && npx tsc --noEmit -p .`
Expected: no errors. (No existing code builds a `StorageAsset` literal, so the new required fields break nothing.)

Run: `cd frontend && npx eslint src/lib`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/reels.ts
git commit -m "feat: add reel and Story types and helpers"
```

---

### Task 2: API client

**Files:**
- Modify: `frontend/src/lib/apiClient.ts`

- [ ] **Step 1: Add the calls**

In `frontend/src/lib/apiClient.ts`, extend the type import:

```ts
import type {
    AnalyticsMonitor,
    AnalyticsOverview,
    AnalyticsPostsResponse,
    AnalyticsTipsResponse,
    BrandLogoDetails,
    DeleteMediaResult,
    MetaLoginResult,
    Platform,
    Post,
    StorageOverview,
    VideoMedia,
    VideoUploadSignature,
} from './types';
```

Add after the `uploadRequest` function:

```ts
export interface VideoUploadHandle {
    promise: Promise<{ publicId: string }>;
    abort: () => void;
}

/**
 * Sends a reel straight from the browser to the user's own Cloudinary
 * account, using the signature from /media/video-signature, and reports
 * progress from 0 to 1. Rejects with a readable message string, like the
 * other API helpers.
 */
export function uploadVideoToCloudinary(
    file: File,
    upload: VideoUploadSignature,
    onProgress: (fraction: number) => void
): VideoUploadHandle {
    const xhr = new XMLHttpRequest();

    const promise = new Promise<{ publicId: string }>((resolve, reject) => {
        const form = new FormData();
        form.append('file', file);
        form.append('api_key', upload.apiKey);
        form.append('timestamp', String(upload.timestamp));
        form.append('signature', upload.signature);
        form.append('folder', upload.folder);
        form.append('eager', upload.eager);
        form.append('eager_async', upload.eagerAsync);
        form.append('allowed_formats', upload.allowedFormats);

        xhr.open(
            'POST',
            `https://api.cloudinary.com/v1_1/${encodeURIComponent(upload.cloudName)}/video/upload`
        );
        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) onProgress(event.loaded / event.total);
        };
        xhr.onload = () => {
            let data: { public_id?: unknown; error?: { message?: string } } | null = null;
            try {
                data = JSON.parse(xhr.responseText);
            } catch {
                data = null;
            }

            if (xhr.status >= 200 && xhr.status < 300 && typeof data?.public_id === 'string') {
                resolve({ publicId: data.public_id });
                return;
            }
            reject(data?.error?.message || `Cloudinary upload failed (${xhr.status})`);
        };
        xhr.onerror = () =>
            reject('Could not reach Cloudinary. Check your connection and try again.');
        xhr.onabort = () => reject('Upload cancelled.');
        xhr.send(form);
    });

    return { promise, abort: () => xhr.abort() };
}
```

In `postsApi`, replace the `remove` line and add `shareStory`:

```ts
    remove: (postId: string) =>
        api.delete<{
            success: boolean;
            message: string;
            mediaDeleted?: boolean;
            mediaError?: string;
        }>(`/posts/${postId}`),
    shareStory: (postId: string, platforms: Platform[]) =>
        api.post<{ success: boolean; post: Post }>(`/posts/${postId}/story`, {
            platforms,
        }),
```

In `mediaApi`, add:

```ts
    videoSignature: () =>
        api.post<{ success: boolean; upload: VideoUploadSignature }>(
            '/media/video-signature'
        ),
    registerVideo: (publicId: string) =>
        api.post<{ success: boolean; media: VideoMedia }>('/media/videos', {
            publicId,
        }),
```

- [ ] **Step 2: Check types and lint**

Run: `cd frontend && npx tsc --noEmit -p .`
Expected: no errors.

Run: `cd frontend && npx eslint src/lib`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/apiClient.ts
git commit -m "feat: add reel upload and Story sharing API calls"
```

---

### Task 3: Navigation and the Story toggle in the Composer

**Files:**
- Modify: `frontend/src/components/AppShell.tsx`, `frontend/src/app/composer/page.tsx`
- Create: `frontend/src/components/ShareToStoryToggle.tsx`

- [ ] **Step 1: Add the Reels nav item**

In `frontend/src/components/AppShell.tsx`, add to `NAV_ITEMS` after the Composer entry:

```ts
    { href: '/reels', label: 'Reels', icon: 'film' },
```

Add this branch in `NavIcon` after the `plus` branch:

```tsx
    if (name === 'film') {
        return (
            <svg {...common}>
                <rect x="3" y="3" width="18" height="18" rx="2.5" />
                <path d="M3 8h18M3 16h18M8 3v5M16 3v5M8 16v5M16 16v5" />
            </svg>
        );
    }
```

- [ ] **Step 2: Create the toggle**

Create `frontend/src/components/ShareToStoryToggle.tsx`:

```tsx
'use client';

import React from 'react';

interface ShareToStoryToggleProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    /** One line on what the Story will contain. */
    detail: string;
}

export function ShareToStoryToggle({
    checked,
    onChange,
    detail,
}: ShareToStoryToggleProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className={`mt-4 w-full flex items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-all ${
                checked
                    ? 'border-amber-500/30 bg-amber-500/10'
                    : 'border-white/5 bg-slate-950/40 hover:border-white/10'
            }`}
        >
            <span
                className={`mt-0.5 relative inline-flex h-5 w-9 shrink-0 rounded-full transition-all ${
                    checked ? 'bg-amber-500' : 'bg-slate-700'
                }`}
            >
                <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                        checked ? 'left-[18px]' : 'left-0.5'
                    }`}
                />
            </span>
            <span>
                <span className="block text-xs font-bold text-white">
                    Also share to Story
                </span>
                <span className="block text-[11px] text-slate-400 mt-0.5">
                    {detail}
                </span>
            </span>
        </button>
    );
}
```

- [ ] **Step 3: Add the toggle to the Composer**

In `frontend/src/app/composer/page.tsx`:

1. Add the import after the `AppShell` import:

```ts
import { ShareToStoryToggle } from '@/components/ShareToStoryToggle';
```

2. Add `shareToStory: boolean;` to `ComposerDraft` after `instagram: boolean;`.

3. Add state after `const [instagram, setInstagram] = useState(false);`:

```ts
    const [shareToStory, setShareToStory] = useState(false);
```

4. In the "signed-in user changed" reset block, add after `setInstagram(false);`:

```ts
            setShareToStory(false);
```

5. In the draft hydration, add after the `draft.instagram` block:

```ts
                if (typeof draft.shareToStory === 'boolean') {
                    setShareToStory(draft.shareToStory);
                }
```

6. In the draft-saving effect, add `shareToStory,` to the `draft` object after `instagram,` and add `shareToStory,` to its dependency list after `instagram,`.

7. In `submit`, add `shareToStory,` to the `postsApi.create({ … })` payload after `platforms: { facebook, instagram },`.

8. In the "Publishing as" section, add after the closing `</div>` of the Facebook/Instagram toggle row (`<div className="flex gap-3 mt-4">…</div>`):

```tsx
                            <ShareToStoryToggle
                                checked={shareToStory}
                                onChange={setShareToStory}
                                detail="Shares the image as a 9:16 Story on each platform once the post publishes."
                            />
```

- [ ] **Step 4: Check types and lint**

Run: `cd frontend && npx tsc --noEmit -p .`
Expected: no errors.

Run: `cd frontend && npx eslint src/components src/app/composer`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AppShell.tsx frontend/src/components/ShareToStoryToggle.tsx frontend/src/app/composer/page.tsx
git commit -m "feat: add the Reels nav item and a Story toggle in the Composer"
```

---

### Task 4: Reels page

**Files:**
- Create: `frontend/src/app/reels/page.tsx`

- [ ] **Step 1: Read the client component guide**

Read `frontend/node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`. The page below is a client component like `app/composer/page.tsx`; follow any deprecation notices in the guide.

- [ ] **Step 2: Create the page**

Create `frontend/src/app/reels/page.tsx`:

```tsx
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { ShareToStoryToggle } from '@/components/ShareToStoryToggle';
import { useAuth } from '@/context/AuthContext';
import {
    aiApi,
    connectionsApi,
    mediaApi,
    postsApi,
    uploadVideoToCloudinary,
    type VideoUploadHandle,
} from '@/lib/apiClient';
import {
    REEL_ACCEPT,
    REEL_LIMITS,
    isNineBySixteen,
    readVideoFileInfo,
    reelFileProblem,
} from '@/lib/reels';
import {
    formatBytes,
    formatDuration,
    type SocialConnection,
    type VideoMedia,
} from '@/lib/types';

interface ReelDraft {
    connectionId: string;
    caption: string;
    topic: string;
    video: VideoMedia | null;
    facebook: boolean;
    instagram: boolean;
    shareToStory: boolean;
}

export default function ReelsPage() {
    const router = useRouter();
    const { user } = useAuth();
    const draftKey = user?.id ? `meta-bru:reel-draft:${user.id}` : null;
    const [connections, setConnections] = useState<SocialConnection[]>([]);
    const [connectionId, setConnectionId] = useState('');
    const [caption, setCaption] = useState('');
    const [topic, setTopic] = useState('');
    const [video, setVideo] = useState<VideoMedia | null>(null);
    const [facebook, setFacebook] = useState(true);
    const [instagram, setInstagram] = useState(false);
    const [shareToStory, setShareToStory] = useState(false);
    const [loading, setLoading] = useState(true);
    const [uploadProgress, setUploadProgress] = useState<number | null>(null);
    const [previewFailedFor, setPreviewFailedFor] = useState('');
    const [drafting, setDrafting] = useState(false);
    const [submitting, setSubmitting] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [hydratedDraftKey, setHydratedDraftKey] = useState<string | null>(null);
    const connectionIdRef = useRef('');
    const connectionsRef = useRef<SocialConnection[]>([]);
    const draftClearedRef = useRef(false);
    const uploadRef = useRef<VideoUploadHandle | null>(null);
    const uploading = uploadProgress !== null;
    const submitDisabled = Boolean(submitting) || uploading;
    // Facebook Reels stop at 90 seconds; Instagram takes up to 15 minutes.
    const facebookAllowed =
        !video || video.duration <= REEL_LIMITS.maxFacebookSeconds;
    const publishFacebook = facebook && facebookAllowed;

    useEffect(() => {
        if (!draftKey || hydratedDraftKey === draftKey) return;

        // If the signed-in user changed, clear the previous user's form first.
        if (hydratedDraftKey !== null && hydratedDraftKey !== draftKey) {
            setConnectionId('');
            connectionIdRef.current = '';
            setCaption('');
            setTopic('');
            setVideo(null);
            setFacebook(true);
            setInstagram(false);
            setShareToStory(false);
        }

        try {
            const raw = window.localStorage.getItem(draftKey);
            if (raw) {
                const draft = JSON.parse(raw) as Partial<ReelDraft>;

                if (typeof draft.connectionId === 'string') {
                    setConnectionId(draft.connectionId);
                    connectionIdRef.current = draft.connectionId;
                }
                if (typeof draft.caption === 'string') {
                    setCaption(draft.caption.slice(0, 2200));
                }
                if (typeof draft.topic === 'string') {
                    setTopic(draft.topic);
                }
                if (
                    draft.video &&
                    typeof draft.video.url === 'string' &&
                    typeof draft.video.publicId === 'string'
                ) {
                    setVideo(draft.video);
                }
                if (typeof draft.facebook === 'boolean') {
                    setFacebook(draft.facebook);
                }
                if (typeof draft.instagram === 'boolean') {
                    setInstagram(draft.instagram);
                }
                if (typeof draft.shareToStory === 'boolean') {
                    setShareToStory(draft.shareToStory);
                }
            }
        } catch {
            // Ignore malformed drafts and start with a clean form.
        }

        // Connections may already be loaded if the draft hydrated late. If the
        // saved Page is gone or disconnected, fall back to the first usable one.
        if (connectionsRef.current.length > 0) {
            const restored = connectionsRef.current.some(
                (connection) =>
                    connection._id === connectionIdRef.current &&
                    connection.tokenStatus === 'active'
            );
            if (!restored) {
                const first = connectionsRef.current.find(
                    (connection) =>
                        connection.isActive && connection.tokenStatus === 'active'
                );
                if (first) {
                    selectConnection(first);
                } else {
                    setConnectionId('');
                    connectionIdRef.current = '';
                }
            }
        }

        draftClearedRef.current = false;
        setHydratedDraftKey(draftKey);
    }, [draftKey, hydratedDraftKey]);

    useEffect(() => {
        const load = async () => {
            try {
                const data: any = await connectionsApi.list();
                const list: SocialConnection[] = data.connections || [];
                connectionsRef.current = list;
                setConnections(list);
                const restored = list.find(
                    (connection) =>
                        connection._id === connectionIdRef.current &&
                        connection.tokenStatus === 'active'
                );
                if (!restored) {
                    const first = list.find(
                        (connection) =>
                            connection.isActive && connection.tokenStatus === 'active'
                    );
                    if (first) selectConnection(first);
                }
            } catch (err: any) {
                setError(typeof err === 'string' ? err : 'Could not load connections');
            } finally {
                setLoading(false);
            }
        };
        void load();
    }, []);

    // Stop an in-flight upload when the user leaves the page.
    useEffect(() => () => uploadRef.current?.abort(), []);

    useEffect(() => {
        if (!draftKey || hydratedDraftKey !== draftKey || draftClearedRef.current) return;

        const draft: ReelDraft = {
            connectionId,
            caption,
            topic,
            video,
            facebook,
            instagram,
            shareToStory,
        };

        try {
            window.localStorage.setItem(draftKey, JSON.stringify(draft));
        } catch {
            // Ignore storage failures (private mode, quota, etc.).
        }
    }, [
        draftKey,
        hydratedDraftKey,
        connectionId,
        caption,
        topic,
        video,
        facebook,
        instagram,
        shareToStory,
    ]);

    const selectedConnection = useMemo(
        () => connections.find((connection) => connection._id === connectionId),
        [connections, connectionId]
    );

    const activeConnections = useMemo(
        () => connections.filter((connection) => connection.tokenStatus === 'active'),
        [connections]
    );

    function selectConnection(connection: SocialConnection) {
        setConnectionId(connection._id);
        connectionIdRef.current = connection._id;
        setFacebook(connection.publishToFacebook);
        setInstagram(connection.publishToInstagram && Boolean(connection.instagram));
    }

    const handleFile = async (file: File | undefined) => {
        if (!file) return;
        setError('');
        setNotice('');

        const problem = reelFileProblem(file, await readVideoFileInfo(file));
        if (problem) {
            setError(problem);
            return;
        }

        setUploadProgress(0);
        try {
            const { upload } = await mediaApi.videoSignature();
            const handle = uploadVideoToCloudinary(file, upload, setUploadProgress);
            uploadRef.current = handle;
            const { publicId } = await handle.promise;
            uploadRef.current = null;
            setUploadProgress(1);

            const data = await mediaApi.registerVideo(publicId);
            setVideo(data.media);
            setPreviewFailedFor('');
        } catch (err: any) {
            if (err === 'Upload cancelled.') {
                setNotice('Upload cancelled.');
            } else {
                setError(typeof err === 'string' ? err : 'Upload failed');
            }
        } finally {
            uploadRef.current = null;
            setUploadProgress(null);
        }
    };

    const draftCaption = async () => {
        setDrafting(true);
        setError('');
        try {
            const data: any = await aiApi.caption({
                ...(topic ? { topic } : {}),
                platform:
                    publishFacebook && instagram
                        ? 'both'
                        : instagram
                          ? 'instagram'
                          : 'facebook',
            });
            setCaption(data.caption || '');
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'AI caption failed');
        } finally {
            setDrafting(false);
        }
    };

    const submit = async (action: 'draft' | 'queue' | 'now') => {
        setError('');
        setNotice('');

        if (!connectionId) {
            setError('Choose a connection first.');
            return;
        }
        if (selectedConnection?.tokenStatus !== 'active') {
            setError(
                selectedConnection?.tokenStatus === 'disconnected'
                    ? 'This Page is disconnected. Reconnect it under Connections.'
                    : 'Reconnect this Page before publishing.'
            );
            return;
        }
        if (!publishFacebook && !instagram) {
            setError(
                facebookAllowed
                    ? 'Select Facebook, Instagram, or both.'
                    : 'This reel is over 90 seconds, so only Instagram can publish it. Turn on Instagram.'
            );
            return;
        }
        if (!caption.trim()) {
            setError('Write a caption or generate one with AI.');
            return;
        }
        if (!video) {
            setError('Upload a reel video first.');
            return;
        }
        if (instagram && !selectedConnection?.instagram) {
            setError('This Page has no linked Instagram Business account.');
            return;
        }

        setSubmitting(action);
        try {
            const data: any = await postsApi.create({
                connectionId,
                caption: caption.trim(),
                mediaType: 'reel',
                mediaPublicId: video.publicId,
                platforms: { facebook: publishFacebook, instagram },
                shareToStory,
                action,
            });

            if (action === 'now' && data.post?.status === 'failed') {
                setError(data.post.lastError || 'Publishing failed. Check Activity.');
                setSubmitting('');
                return;
            }

            draftClearedRef.current = true;
            if (draftKey) {
                window.localStorage.removeItem(draftKey);
            }

            const partiallyPublished = action === 'now' && data.post?.status === 'partial';
            setNotice(
                action === 'now'
                    ? partiallyPublished
                        ? 'Partially published. Opening the failed tab so you can retry the failed platform...'
                        : 'Reel published. Opening activity...'
                    : action === 'queue'
                      ? 'Reel added to the queue.'
                      : 'Draft saved.'
            );
            setTimeout(() => {
                router.push(
                    action === 'now'
                        ? partiallyPublished
                            ? '/queue?tab=failed'
                            : '/activity'
                        : action === 'draft'
                          ? '/queue?tab=draft'
                          : '/queue'
                );
            }, 900);
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not create reel');
            setSubmitting('');
        }
    };

    const previewSrc =
        video && previewFailedFor === video.publicId ? video.originalUrl : video?.url;

    return (
        <AppShell
            title="Reels"
            subtitle="Upload a vertical video, then queue it or post it now. Reels use each Page's daily posting times."
            actions={
                <button
                    onClick={() => submit('queue')}
                    disabled={submitDisabled}
                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
                >
                    {submitting === 'queue' ? 'Adding...' : 'Add to queue'}
                </button>
            }
        >
            {notice ? (
                <div className="mb-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                    {notice}
                </div>
            ) : null}
            {error ? (
                <div className="mb-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                    {error}
                </div>
            ) : null}

            {loading ? (
                <div className="flex justify-center py-24">
                    <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-indigo-500" />
                </div>
            ) : activeConnections.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-white/10 bg-slate-900/30 p-12 text-center">
                    <div className="text-xl font-bold text-white">No active Pages</div>
                    <p className="text-sm text-slate-400 mt-2">
                        Reconnect a Page under Connections to create and publish a reel.
                    </p>
                    <Link
                        href="/connections"
                        className="inline-flex mt-6 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl text-sm font-bold"
                    >
                        Go to connections
                    </Link>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-6 items-start">
                    <div className="space-y-6">
                        <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-6 sm:p-8 shadow-xl">
                            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                                Publishing as
                            </label>
                            <select
                                value={connectionId}
                                onChange={(event) => {
                                    const connection = connections.find(
                                        (item) => item._id === event.target.value
                                    );
                                    if (connection) selectConnection(connection);
                                }}
                                className="mt-2 w-full bg-slate-950/80 border border-white/10 rounded-xl px-4 py-3.5 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                            >
                                <option value="">Select a Page</option>
                                {activeConnections.map((connection) => (
                                    <option key={connection._id} value={connection._id}>
                                        {connection.pageName}
                                        {connection.instagram
                                            ? ` + @${connection.instagram.username || 'instagram'}`
                                            : ''}
                                    </option>
                                ))}
                            </select>

                            {selectedConnection && !selectedConnection.isActive ? (
                                <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                                    This Page is paused. Scheduled reels wait until you
                                    reactivate it under Connections.
                                </div>
                            ) : null}

                            <div className="flex gap-3 mt-4">
                                <button
                                    type="button"
                                    disabled={!facebookAllowed}
                                    onClick={() => setFacebook((value) => !value)}
                                    title={
                                        facebookAllowed
                                            ? undefined
                                            : 'Facebook Reels can be at most 90 seconds long.'
                                    }
                                    className={`px-4 py-2.5 rounded-xl text-xs font-bold border transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                                        publishFacebook
                                            ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                                            : 'bg-slate-950/50 text-slate-500 border-white/5'
                                    }`}
                                >
                                    Facebook
                                </button>
                                <button
                                    type="button"
                                    disabled={!selectedConnection?.instagram}
                                    onClick={() => setInstagram((value) => !value)}
                                    className={`px-4 py-2.5 rounded-xl text-xs font-bold border transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                                        instagram
                                            ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                                            : 'bg-slate-950/50 text-slate-500 border-white/5'
                                    }`}
                                >
                                    Instagram
                                </button>
                            </div>

                            {!facebookAllowed ? (
                                <p className="mt-3 text-[11px] text-amber-300">
                                    This reel is over 90 seconds. Facebook Reels stop at
                                    90 seconds, so it can only go to Instagram.
                                </p>
                            ) : null}

                            <ShareToStoryToggle
                                checked={shareToStory}
                                onChange={setShareToStory}
                                detail={`Shares the first ${REEL_LIMITS.storySeconds} seconds as a 9:16 Story once the reel publishes.`}
                            />
                        </section>

                        <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-6 sm:p-8 shadow-xl">
                            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                                Video
                            </label>

                            {uploading ? (
                                <div className="mt-3 rounded-2xl border border-indigo-500/20 bg-indigo-500/5 px-4 py-5">
                                    <div className="flex items-center justify-between gap-3 text-xs font-bold text-white">
                                        <span>
                                            {(uploadProgress ?? 0) < 1
                                                ? `Uploading to Cloudinary... ${Math.round(
                                                      (uploadProgress ?? 0) * 100
                                                  )}%`
                                                : 'Checking the video...'}
                                        </span>
                                        {(uploadProgress ?? 0) < 1 ? (
                                            <button
                                                type="button"
                                                onClick={() => uploadRef.current?.abort()}
                                                className="text-rose-400 hover:text-rose-300"
                                            >
                                                Cancel
                                            </button>
                                        ) : null}
                                    </div>
                                    <div className="mt-3 h-2 rounded-full bg-slate-950 overflow-hidden border border-white/5">
                                        <div
                                            className="h-full rounded-full bg-indigo-500 transition-all"
                                            style={{
                                                width: `${Math.round((uploadProgress ?? 0) * 100)}%`,
                                            }}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <label className="mt-3 block cursor-pointer rounded-2xl border border-dashed border-white/10 bg-slate-950/40 px-4 py-6 text-center hover:border-indigo-500/40 transition-all">
                                    <input
                                        type="file"
                                        accept={REEL_ACCEPT}
                                        className="hidden"
                                        onChange={(event) => {
                                            const file = event.target.files?.[0];
                                            // Allow picking the same file again after an error.
                                            event.target.value = '';
                                            void handleFile(file);
                                        }}
                                    />
                                    <div className="text-sm font-bold text-white">
                                        {video ? 'Replace video' : 'Upload video'}
                                    </div>
                                    <div className="text-xs text-slate-500 mt-1">
                                        MP4 or MOV · 3 seconds to 15 minutes · max 100 MB
                                    </div>
                                    <div className="text-[11px] text-slate-500 mt-2">
                                        Uploads straight to your Cloudinary account. Facebook
                                        takes reels up to 90 seconds.
                                    </div>
                                </label>
                            )}

                            {video ? (
                                <div className="mt-4 flex items-center gap-4 rounded-2xl border border-white/5 bg-slate-950/40 p-3">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={video.coverUrl}
                                        alt="Reel cover"
                                        className="w-12 h-20 rounded-lg object-cover border border-white/5 bg-slate-800"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs font-bold text-white truncate">
                                            {formatDuration(video.duration)} · {video.width} ×{' '}
                                            {video.height} · {video.format.toUpperCase()} ·{' '}
                                            {formatBytes(video.bytes)}
                                        </div>
                                        <div className="text-[11px] text-slate-500 truncate">
                                            {video.publicId}
                                        </div>
                                        <div className="text-[11px] text-slate-500 mt-1">
                                            {isNineBySixteen(video.width, video.height)
                                                ? 'Vertical 9:16, ready for Reels.'
                                                : 'Not 9:16, so it will be padded to 9:16 with a blurred background.'}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setVideo(null)}
                                        className="text-xs font-bold text-rose-400 px-3 py-2 rounded-lg hover:bg-rose-500/10"
                                    >
                                        Remove
                                    </button>
                                </div>
                            ) : null}
                        </section>

                        <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-6 sm:p-8 shadow-xl">
                            <div className="flex items-center justify-between gap-3">
                                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                                    Caption
                                </label>
                                <span className="text-xs text-slate-500">
                                    {caption.length}/2200
                                </span>
                            </div>
                            <textarea
                                value={caption}
                                onChange={(event) => setCaption(event.target.value.slice(0, 2200))}
                                rows={6}
                                placeholder="Write your reel caption..."
                                className="mt-2 w-full bg-slate-950/80 border border-white/10 rounded-2xl px-4 py-3.5 text-white leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-y"
                            />

                            <div className="mt-4 flex flex-col sm:flex-row gap-3">
                                <input
                                    value={topic}
                                    onChange={(event) => setTopic(event.target.value)}
                                    placeholder="What is the reel about? (for AI)"
                                    className="flex-1 bg-slate-950/80 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                />
                                <button
                                    onClick={draftCaption}
                                    disabled={drafting}
                                    className="bg-purple-600 hover:bg-purple-500 disabled:opacity-60 text-white px-5 py-3 rounded-xl text-xs font-bold transition-all"
                                >
                                    {drafting ? 'Drafting...' : 'AI draft caption'}
                                </button>
                            </div>
                            <p className="text-xs text-slate-500 mt-2">
                                AI uses your topic and the brand profile from{' '}
                                <Link href="/settings" className="text-indigo-400">
                                    Profile
                                </Link>
                                . It does not watch the video.
                            </p>
                        </section>

                        <div className="flex flex-col sm:flex-row gap-3">
                            <button
                                onClick={() => submit('draft')}
                                disabled={submitDisabled}
                                className="flex-1 bg-white/5 hover:bg-white/10 disabled:opacity-60 text-white border border-white/10 px-5 py-3.5 rounded-2xl text-sm font-bold transition-all"
                            >
                                {submitting === 'draft' ? 'Saving...' : 'Save draft'}
                            </button>
                            <button
                                onClick={() => submit('queue')}
                                disabled={submitDisabled}
                                className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white px-5 py-3.5 rounded-2xl text-sm font-bold transition-all"
                            >
                                {submitting === 'queue' ? 'Adding...' : 'Add to queue'}
                            </button>
                            <button
                                onClick={() => submit('now')}
                                disabled={submitDisabled}
                                className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white px-5 py-3.5 rounded-2xl text-sm font-bold transition-all"
                            >
                                {submitting === 'now'
                                    ? 'Publishing reel… this can take a few minutes'
                                    : 'Post now'}
                            </button>
                        </div>
                    </div>

                    <aside className="rounded-3xl border border-white/5 bg-slate-900/40 p-6 shadow-xl lg:sticky lg:top-8">
                        <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4">
                            Preview
                        </div>
                        <div className="mx-auto max-w-[280px] rounded-[28px] overflow-hidden border border-white/10 bg-slate-950">
                            <div className="relative aspect-[9/16] bg-slate-900/40">
                                {video && previewSrc ? (
                                    <video
                                        key={previewSrc}
                                        src={previewSrc}
                                        poster={video.coverUrl}
                                        controls
                                        playsInline
                                        muted
                                        loop
                                        onError={() => setPreviewFailedFor(video.publicId)}
                                        className="w-full h-full object-contain bg-black"
                                    />
                                ) : (
                                    <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-600">
                                        9:16 video preview
                                    </div>
                                )}
                            </div>
                            <div className="px-4 py-4">
                                <div className="text-sm font-bold text-white">
                                    {selectedConnection?.pageName || 'Your Page'}
                                </div>
                                <div className="text-[10px] uppercase tracking-widest text-slate-500">
                                    {publishFacebook && instagram
                                        ? 'Facebook + Instagram Reels'
                                        : instagram
                                          ? 'Instagram Reels'
                                          : 'Facebook Reels'}
                                </div>
                                <div className="mt-3 text-sm text-slate-300 whitespace-pre-wrap leading-relaxed line-clamp-6">
                                    {caption || (
                                        <span className="text-slate-600">
                                            Your caption will appear here.
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                        {video && previewFailedFor === video.publicId ? (
                            <p className="mt-3 text-[11px] text-slate-500 text-center">
                                Cloudinary is still preparing the 9:16 version. Showing
                                the original upload.
                            </p>
                        ) : null}
                    </aside>
                </div>
            )}
        </AppShell>
    );
}
```

- [ ] **Step 3: Check types and lint**

Run: `cd frontend && npx tsc --noEmit -p .`
Expected: no errors.

Run: `cd frontend && npx eslint src/app/reels`
Expected: 0 errors. Warnings matching the Composer's (`no-explicit-any`, `exhaustive-deps`, `set-state-in-effect`) are acceptable.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/reels/page.tsx
git commit -m "feat: add the Reels page with direct Cloudinary upload"
```

---

### Task 5: Story share modal

**Files:**
- Create: `frontend/src/components/StoryShareModal.tsx`

- [ ] **Step 1: Create the modal**

Create `frontend/src/components/StoryShareModal.tsx`:

```tsx
'use client';

import React from 'react';
import { Modal } from '@/components/Modal';
import {
    isReel,
    publishedPlatforms,
    storyTarget,
    type Platform,
    type Post,
} from '@/lib/types';

interface StoryShareModalProps {
    post: Post | null;
    selected: Platform[];
    onToggle: (platform: Platform) => void;
    onClose: () => void;
    onConfirm: () => void;
}

const PLATFORM_LABELS: Record<Platform, string> = {
    facebook: 'Facebook Story',
    instagram: 'Instagram Story',
};

export function StoryShareModal({
    post,
    selected,
    onToggle,
    onClose,
    onConfirm,
}: StoryShareModalProps) {
    const platforms = post ? publishedPlatforms(post) : [];

    return (
        <Modal
            isOpen={post !== null}
            onClose={onClose}
            onConfirm={onConfirm}
            title="Share to Story"
            message={
                post && isReel(post)
                    ? 'The reel is shared as a 9:16 video Story using its first 60 seconds.'
                    : 'The image is shared as a 9:16 Story with padding that matches its edges.'
            }
            confirmText="Share to Story"
            type="info"
        >
            <div className="space-y-2">
                {platforms.map((platform) => {
                    const story = post ? storyTarget(post, platform) : undefined;
                    const shared = story?.status === 'published';

                    return (
                        <div
                            key={platform}
                            className="rounded-2xl border border-white/5 bg-slate-950/40 px-4 py-3"
                        >
                            <label
                                className={`flex items-center gap-3 ${
                                    shared ? 'cursor-not-allowed' : 'cursor-pointer'
                                }`}
                            >
                                <input
                                    type="checkbox"
                                    checked={shared || selected.includes(platform)}
                                    disabled={shared}
                                    onChange={() => onToggle(platform)}
                                    className="h-4 w-4 accent-indigo-500"
                                />
                                <span className="flex-1 text-sm font-semibold text-white">
                                    {PLATFORM_LABELS[platform]}
                                </span>
                                <span
                                    className={`text-[10px] font-bold uppercase tracking-widest ${
                                        shared
                                            ? 'text-emerald-300'
                                            : story?.status === 'failed'
                                              ? 'text-rose-300'
                                              : 'text-slate-500'
                                    }`}
                                >
                                    {shared
                                        ? 'Shared'
                                        : story?.status === 'failed'
                                          ? 'Failed'
                                          : 'Not shared'}
                                </span>
                            </label>
                            {story?.status === 'failed' && story.error ? (
                                <p className="mt-2 text-[11px] text-rose-300/80">
                                    {story.error}
                                </p>
                            ) : null}
                        </div>
                    );
                })}
            </div>
        </Modal>
    );
}
```

- [ ] **Step 2: Check types and lint**

Run: `cd frontend && npx tsc --noEmit -p .`
Expected: no errors.

Run: `cd frontend && npx eslint src/components/StoryShareModal.tsx`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/StoryShareModal.tsx
git commit -m "feat: add the Story share modal"
```

---

### Task 6: Queue — reels, Story sharing, and delete confirmation

**Files:**
- Modify: `frontend/src/app/queue/page.tsx` (full replacement)

- [ ] **Step 1: Replace the page**

Replace the whole of `frontend/src/app/queue/page.tsx` with:

```tsx
'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { StatusBadge } from '@/components/Dashboards';
import { Modal } from '@/components/Modal';
import { StoryShareModal } from '@/components/StoryShareModal';
import { postsApi } from '@/lib/apiClient';
import {
    connectionName,
    formatDate,
    formatDuration,
    formatElapsed,
    formatIstDateTime,
    isReel,
    latestPublishedAt,
    postThumbnailUrl,
    publishedPlatforms,
    unsharedStoryPlatforms,
    type Platform,
    type Post,
    type TargetStatus,
    type TokenStatus,
} from '@/lib/types';

const TABS = [
    { key: 'queued', label: 'Queue' },
    { key: 'draft', label: 'Drafts' },
    { key: 'failed', label: 'Failed' },
    { key: 'published', label: 'Published' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const KINDS = [
    { key: 'all', label: 'All' },
    { key: 'image', label: 'Posts' },
    { key: 'reel', label: 'Reels' },
] as const;

type KindKey = (typeof KINDS)[number]['key'];

function matchesTab(post: Post, tab: TabKey): boolean {
    if (tab === 'failed') return post.status === 'failed' || post.status === 'partial';
    if (tab === 'published') return post.status === 'published' || post.status === 'partial';
    return post.status === tab;
}

function matchesKind(post: Post, kind: KindKey): boolean {
    if (kind === 'all') return true;
    return kind === 'reel' ? isReel(post) : !isReel(post);
}

function destinationStatus(post: Post): TokenStatus | null {
    if (!post.connectionId || typeof post.connectionId === 'string') {
        return null;
    }
    return post.connectionId.tokenStatus;
}

function targetChipClass(status: TargetStatus): string {
    if (status === 'published') {
        return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20';
    }
    if (status === 'failed') {
        return 'bg-rose-500/10 text-rose-300 border-rose-500/20';
    }
    return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
}

export default function QueuePage() {
    const [posts, setPosts] = useState<Post[]>([]);
    const [tab, setTab] = useState<TabKey>('queued');
    const [kind, setKind] = useState<KindKey>('all');
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState('');
    const [sharingId, setSharingId] = useState('');
    const [editingId, setEditingId] = useState('');
    const [editCaption, setEditCaption] = useState('');
    const [deleteTarget, setDeleteTarget] = useState<Post | null>(null);
    const [storyPost, setStoryPost] = useState<Post | null>(null);
    const [storySelection, setStorySelection] = useState<Platform[]>([]);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const load = async (showSpinner = false) => {
        if (showSpinner) setLoading(true);
        try {
            const data: any = await postsApi.list({ limit: '200' });
            setPosts(data.posts || []);
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not load posts');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const requestedTab = params.get('tab');
        if (TABS.some((item) => item.key === requestedTab)) {
            setTab(requestedTab as TabKey);
        }
        const requestedKind = params.get('kind');
        if (KINDS.some((item) => item.key === requestedKind)) {
            setKind(requestedKind as KindKey);
        }

        void load(true);
        const interval = setInterval(() => void load(false), 30_000);
        return () => clearInterval(interval);
    }, []);

    const publishNow = async (post: Post) => {
        setBusyId(post._id);
        setError('');
        setNotice('');
        try {
            const data: any = await postsApi.publishNow(post._id);
            if (
                data.post?.status === 'failed' ||
                data.post?.status === 'partial'
            ) {
                setError(data.post.lastError || 'Publishing failed');
            } else {
                setNotice(isReel(post) ? 'Reel published.' : 'Post published.');
            }
            await load();
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not publish post');
        } finally {
            setBusyId('');
        }
    };

    const retry = async (post: Post) => {
        setBusyId(post._id);
        setError('');
        setNotice('');
        try {
            const data: any = await postsApi.retry(post._id);
            if (
                data.post?.status === 'published' &&
                !data.post?.lastError
            ) {
                setNotice('Retry completed.');
            } else {
                setError(
                    data.post?.lastError ||
                        'Retry did not publish every platform. Check Activity.'
                );
            }
            await load();
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not retry post');
        } finally {
            setBusyId('');
        }
    };

    const remove = async (post: Post) => {
        setBusyId(post._id);
        setError('');
        setNotice('');
        try {
            const data = await postsApi.remove(post._id);
            setPosts((current) => current.filter((item) => item._id !== post._id));
            setNotice(
                data.mediaDeleted
                    ? `Post deleted. Its ${isReel(post) ? 'video' : 'image'} was also removed from Cloudinary.`
                    : 'Post deleted.'
            );
            if (data.mediaError) {
                setError(`Could not remove its Cloudinary file: ${data.mediaError}`);
            }
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not delete post');
        } finally {
            setBusyId('');
        }
    };

    const openStoryShare = (post: Post) => {
        setStorySelection(unsharedStoryPlatforms(post));
        setStoryPost(post);
    };

    const toggleStoryPlatform = (platform: Platform) => {
        setStorySelection((current) =>
            current.includes(platform)
                ? current.filter((item) => item !== platform)
                : [...current, platform]
        );
    };

    const shareStory = async (post: Post, platforms: Platform[]) => {
        if (platforms.length === 0) return;
        setBusyId(post._id);
        setSharingId(post._id);
        setError('');
        setNotice('');
        try {
            const data = await postsApi.shareStory(post._id, platforms);
            // The response is not populated; keep the Page details we have.
            setPosts((current) =>
                current.map((item) =>
                    item._id === post._id
                        ? { ...data.post, connectionId: item.connectionId }
                        : item
                )
            );
            const failed = (data.post.storyTargets ?? []).filter(
                (target) =>
                    platforms.includes(target.platform) && target.status === 'failed'
            );
            if (failed.length > 0) {
                setError(
                    failed
                        .map((target) => `${target.platform} Story: ${target.error}`)
                        .join(' | ')
                );
            } else {
                setNotice('Shared to Story.');
            }
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not share to Story');
        } finally {
            setBusyId('');
            setSharingId('');
        }
    };

    const startEdit = (post: Post) => {
        setEditingId(post._id);
        setEditCaption(post.caption);
    };

    const saveEdit = async (post: Post) => {
        if (!editCaption.trim()) return;
        setBusyId(post._id);
        setError('');
        setNotice('');
        try {
            const data: any = await postsApi.update(post._id, {
                caption: editCaption.trim(),
            });
            setPosts((current) =>
                current.map((item) => (item._id === post._id ? data.post : item))
            );
            setEditingId('');
            setNotice('Caption updated.');
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not update post');
        } finally {
            setBusyId('');
        }
    };

    const kindPosts = posts.filter((post) => matchesKind(post, kind));
    const visible = kindPosts.filter((post) => matchesTab(post, tab));

    return (
        <AppShell
            title="Queue"
            subtitle="Posts and reels publish at each Page's daily times, in the order you added them."
            actions={
                <>
                    <Link
                        href="/reels"
                        className="bg-white/5 hover:bg-white/10 text-white border border-white/10 px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
                    >
                        New reel
                    </Link>
                    <Link
                        href="/composer"
                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
                    >
                        New post
                    </Link>
                </>
            }
        >
            {notice ? (
                <div className="mb-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                    {notice}
                </div>
            ) : null}
            {error ? (
                <div className="mb-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                    {error}
                </div>
            ) : null}

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-7">
                <div className="flex gap-2 overflow-x-auto">
                    {TABS.map((item) => (
                        <button
                            key={item.key}
                            onClick={() => setTab(item.key)}
                            className={`whitespace-nowrap px-4 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                                tab === item.key
                                    ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/20'
                                    : 'bg-slate-900/40 text-slate-400 border-white/5 hover:text-white'
                            }`}
                        >
                            {item.label}
                            <span className="ml-2 text-slate-500">
                                {kindPosts.filter((post) => matchesTab(post, item.key)).length}
                            </span>
                        </button>
                    ))}
                </div>

                <div className="flex gap-1 rounded-xl border border-white/5 bg-slate-900/40 p-1 self-start">
                    {KINDS.map((item) => (
                        <button
                            key={item.key}
                            onClick={() => setKind(item.key)}
                            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                                kind === item.key
                                    ? 'bg-white/10 text-white'
                                    : 'text-slate-500 hover:text-white'
                            }`}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-24">
                    <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-indigo-500" />
                </div>
            ) : visible.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-white/10 bg-slate-900/30 p-12 text-center">
                    <div className="text-lg font-bold text-white">
                        Nothing in {TABS.find((item) => item.key === tab)?.label.toLowerCase()}
                    </div>
                    <p className="text-sm text-slate-400 mt-2">
                        Posts from the Composer and reels from the Reels page show up here.
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    {visible.map((post) => {
                        const status = destinationStatus(post);
                        const publishBlocked = status !== 'active';
                        const thumbnail = postThumbnailUrl(post);
                        const canShareStory =
                            (post.status === 'published' || post.status === 'partial') &&
                            publishedPlatforms(post).length > 0;
                        const storyLeft = unsharedStoryPlatforms(post).length;

                        return (
                            <article
                                key={post._id}
                                className="rounded-3xl border border-white/5 bg-slate-900/40 p-5 sm:p-6 shadow-xl"
                            >
                                <div className="flex flex-col sm:flex-row gap-5">
                                    <div className="relative w-full sm:w-28 h-40 sm:h-28 rounded-2xl overflow-hidden bg-slate-800 shrink-0 border border-white/5">
                                        {thumbnail ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                src={thumbnail}
                                                alt=""
                                                className="w-full h-full object-cover"
                                            />
                                        ) : null}
                                        {isReel(post) ? (
                                            <span className="absolute bottom-1.5 left-1.5 rounded-md bg-slate-950/80 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur">
                                                ▶ {formatDuration(post.mediaDuration ?? 0)}
                                            </span>
                                        ) : null}
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-2 mb-2">
                                            <StatusBadge status={post.status} />
                                            {isReel(post) ? (
                                                <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/20">
                                                    Reel
                                                </span>
                                            ) : null}
                                            <span className="text-xs text-slate-500">
                                                {connectionName(post)}
                                            </span>
                                            {status === 'disconnected' ||
                                            status === 'needs_reauth' ? (
                                                <Link
                                                    href="/connections"
                                                    className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border ${
                                                        status === 'disconnected'
                                                            ? 'bg-slate-500/10 text-slate-300 border-slate-500/20'
                                                            : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                                                    }`}
                                                >
                                                    {status === 'disconnected'
                                                        ? 'Page disconnected'
                                                        : 'Reconnect needed'}
                                                </Link>
                                            ) : null}
                                            <span className="text-xs text-slate-600">·</span>
                                            <span className="text-xs text-slate-500">
                                                {post.status === 'published' ||
                                                post.status === 'partial' ? (
                                                    latestPublishedAt(post) ? (
                                                        <>
                                                            Published{' '}
                                                            {formatIstDateTime(
                                                                latestPublishedAt(post)
                                                            )}
                                                            {` · ${formatElapsed(
                                                                latestPublishedAt(post)
                                                            )}`}
                                                        </>
                                                    ) : (
                                                        'Publish time unavailable'
                                                    )
                                                ) : (
                                                    formatDate(post.createdAt)
                                                )}
                                            </span>
                                            {post.attempts > 0 ? (
                                                <span className="text-xs text-slate-600">
                                                    attempts: {post.attempts}
                                                </span>
                                            ) : null}
                                        </div>

                                        {editingId === post._id ? (
                                            <div className="mt-2">
                                                <textarea
                                                    value={editCaption}
                                                    onChange={(event) =>
                                                        setEditCaption(
                                                            event.target.value.slice(0, 2200)
                                                        )
                                                    }
                                                    rows={5}
                                                    className="w-full bg-slate-950/80 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                                />
                                                <div className="flex gap-3 mt-2">
                                                    <button
                                                        onClick={() => saveEdit(post)}
                                                        disabled={busyId === post._id}
                                                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-xs font-bold"
                                                    >
                                                        Save
                                                    </button>
                                                    <button
                                                        onClick={() => setEditingId('')}
                                                        className="text-slate-400 px-4 py-2 rounded-lg text-xs font-bold hover:text-white"
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-sm text-slate-300 whitespace-pre-wrap line-clamp-3">
                                                {post.caption}
                                            </p>
                                        )}

                                        <div className="flex flex-wrap gap-2 mt-3">
                                            {post.targets.map((target) => (
                                                <span
                                                    key={target.platform}
                                                    className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border ${targetChipClass(target.status)}`}
                                                >
                                                    {target.platform}: {target.status}
                                                </span>
                                            ))}
                                            {(post.storyTargets ?? []).map((target) => (
                                                <span
                                                    key={`story-${target.platform}`}
                                                    title={target.error || undefined}
                                                    className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border ${targetChipClass(target.status)}`}
                                                >
                                                    {target.platform} story: {target.status}
                                                </span>
                                            ))}
                                        </div>

                                        {post.lastError ? (
                                            <div className="mt-3 text-xs text-rose-400">
                                                {post.lastError}
                                            </div>
                                        ) : null}
                                    </div>

                                    <div className="flex sm:flex-col flex-wrap gap-2 sm:w-36 shrink-0">
                                        {(post.status === 'queued' ||
                                            post.status === 'draft' ||
                                            post.status === 'failed') && (
                                            <button
                                                onClick={() => publishNow(post)}
                                                disabled={busyId === post._id || publishBlocked}
                                                title={
                                                    publishBlocked
                                                        ? 'Reconnect this Page before publishing.'
                                                        : undefined
                                                }
                                                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all"
                                            >
                                                {busyId === post._id && !sharingId
                                                    ? 'Working...'
                                                    : 'Post now'}
                                            </button>
                                        )}
                                        {(post.status === 'failed' ||
                                            post.status === 'partial') && (
                                            <button
                                                onClick={() => retry(post)}
                                                disabled={busyId === post._id || publishBlocked}
                                                title={
                                                    publishBlocked
                                                        ? 'Reconnect this Page before retrying.'
                                                        : undefined
                                                }
                                                className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 px-4 py-2.5 rounded-xl text-xs font-bold transition-all"
                                            >
                                                Retry failed
                                            </button>
                                        )}
                                        {canShareStory && (
                                            <button
                                                onClick={() => openStoryShare(post)}
                                                disabled={
                                                    busyId === post._id ||
                                                    publishBlocked ||
                                                    storyLeft === 0
                                                }
                                                title={
                                                    publishBlocked
                                                        ? 'Reconnect this Page before sharing.'
                                                        : storyLeft === 0
                                                          ? 'Already shared to Story on every published platform.'
                                                          : undefined
                                                }
                                                className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 border border-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 rounded-xl text-xs font-bold transition-all"
                                            >
                                                {sharingId === post._id
                                                    ? 'Sharing...'
                                                    : storyLeft === 0
                                                      ? 'Shared to Story'
                                                      : 'Share to Story'}
                                            </button>
                                        )}
                                        {post.status !== 'publishing' &&
                                            post.status !== 'published' &&
                                            post.status !== 'partial' && (
                                                <>
                                                    <button
                                                        onClick={() => startEdit(post)}
                                                        className="bg-white/5 hover:bg-white/10 text-white border border-white/10 px-4 py-2.5 rounded-xl text-xs font-bold transition-all"
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        onClick={() => setDeleteTarget(post)}
                                                        disabled={busyId === post._id}
                                                        className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/10 px-4 py-2.5 rounded-xl text-xs font-bold transition-all"
                                                    >
                                                        Delete
                                                    </button>
                                                </>
                                            )}
                                    </div>
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}

            <Modal
                isOpen={deleteTarget !== null}
                onClose={() => setDeleteTarget(null)}
                onConfirm={() => {
                    if (deleteTarget) void remove(deleteTarget);
                }}
                title={deleteTarget && isReel(deleteTarget) ? 'Delete this reel?' : 'Delete this post?'}
                message={`This removes it from Meta-Bru. Its ${
                    deleteTarget && isReel(deleteTarget) ? 'video' : 'image'
                } is also deleted from your Cloudinary account when no other post uses it. This cannot be undone.`}
                confirmText="Delete"
                type="danger"
            />

            <StoryShareModal
                post={storyPost}
                selected={storySelection}
                onToggle={toggleStoryPlatform}
                onClose={() => setStoryPost(null)}
                onConfirm={() => {
                    if (storyPost) void shareStory(storyPost, storySelection);
                }}
            />
        </AppShell>
    );
}
```

- [ ] **Step 2: Check types and lint**

Run: `cd frontend && npx tsc --noEmit -p .`
Expected: no errors.

Run: `cd frontend && npx eslint src/app/queue`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/queue/page.tsx
git commit -m "feat: show reels, share to Story, and confirm deletes in Queue"
```

---

### Task 7: Reels in Storage

**Files:**
- Modify: `frontend/src/components/StorageAssetCard.tsx`, `frontend/src/app/storage/page.tsx`

- [ ] **Step 1: Video-aware asset card**

In `frontend/src/components/StorageAssetCard.tsx`:

1. Add `formatDuration,` to the `@/lib/types` import after `formatBytes,`.

2. Add after `const duplicate = asset.duplicateCount > 1;`:

```ts
    const isVideo = asset.resourceType === 'video';
```

3. Replace `title="Open full image"` with:

```tsx
                    title={isVideo ? 'Open video' : 'Open full image'}
```

4. Replace the `<img>` `onError` handler with one that skips videos (a video URL cannot be an image fallback):

```tsx
                        onError={(event) => {
                            const image = event.currentTarget;
                            if (
                                !isVideo &&
                                asset.secureUrl &&
                                image.src !== asset.secureUrl
                            ) {
                                image.src = asset.secureUrl;
                            }
                        }}
```

5. Replace the checkbox `aria-label` expression with:

```tsx
                        aria-label={
                            asset.canDelete
                                ? selected
                                    ? 'Deselect file'
                                    : 'Select file'
                                : 'This file cannot be deleted'
                        }
```

6. Inside `<div className="absolute top-3 right-3 flex flex-col items-end gap-1.5">`, add as its first child:

```tsx
                    {isVideo ? (
                        <span className="rounded-full border border-fuchsia-500/25 bg-slate-950/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-fuchsia-300 backdrop-blur">
                            ▶ Reel · {formatDuration(asset.duration)}
                        </span>
                    ) : null}
```

7. Replace the format line block:

```tsx
                            {asset.format
                                ? asset.format.toUpperCase()
                                : 'Image'}{' '}
                            · {asset.width}×{asset.height} ·{' '}
                            {formatBytes(asset.bytes)}
```

with:

```tsx
                            {asset.format
                                ? asset.format.toUpperCase()
                                : isVideo
                                  ? 'Video'
                                  : 'Image'}{' '}
                            · {asset.width}×{asset.height} ·{' '}
                            {isVideo ? `${formatDuration(asset.duration)} · ` : ''}
                            {formatBytes(asset.bytes)}
```

- [ ] **Step 2: Type filter and wording on the Storage page**

In `frontend/src/app/storage/page.tsx`:

1. Add after `type NoticeKind = …;`:

```ts
type StorageKind = 'all' | 'image' | 'video';

const KINDS: Array<{ key: StorageKind; label: string }> = [
    { key: 'all', label: 'All types' },
    { key: 'image', label: 'Images' },
    { key: 'video', label: 'Reels' },
];

function files(count: number): string {
    return count === 1 ? 'file' : 'files';
}
```

2. Add state after `const [filter, setFilter] = useState<StorageFilter>('all');`:

```ts
    const [kind, setKind] = useState<StorageKind>('all');
```

3. In `filteredAssets`, add after `let list = assets;`:

```ts
        if (kind !== 'all') {
            list = list.filter((asset) => asset.resourceType === kind);
        }
```

and change its dependency list to `[assets, filter, kind, search, sort]`.

4. Add after `changeFilter`:

```ts
    const changeKind = (next: StorageKind) => {
        setKind(next);
        setVisibleCount(PAGE_SIZE);
    };
```

5. Add after `unusedDeletableCount`:

```ts
    const videoCount = assets.filter((asset) => asset.resourceType === 'video').length;
    const imageCount = assets.length - videoCount;
```

6. In `selectUnused`, replace the notice expression with:

```ts
            ids.length > 0
                ? `Selected ${ids.length} unused ${files(ids.length)}.`
                : 'No deletable unused files were found.'
```

7. In `confirmDelete`, replace the three `parts.push(…)` messages and the fallback:

```ts
            if (deleted.length > 0) {
                parts.push(
                    `Deleted ${deleted.length} ${files(deleted.length)} and freed ${formatBytes(freedBytes)}.`
                );
            }

            if (blocked.length > 0) {
                parts.push(
                    `${blocked.length} ${files(blocked.length)} ${
                        blocked.length === 1 ? 'is' : 'are'
                    } still used by unfinished posts and ${
                        blocked.length === 1 ? 'was' : 'were'
                    } not deleted.`
                );
            }

            if (skipped.length > 0) {
                parts.push(
                    `${skipped.length} ${files(skipped.length)} ${
                        skipped.length === 1 ? 'was' : 'were'
                    } skipped.`
                );
            }

            if (parts.length === 0) {
                parts.push('No files were deleted.');
            }
```

and its catch fallback `'Could not delete the selected images. Try again.'` with `'Could not delete the selected files. Try again.'`.

8. Replace the whole `deleteMessage` declaration with:

```ts
    const deleteMessage = `Permanently delete ${selected.size} ${files(
        selected.size
    )} (${formatBytes(selectedBytes)}) from Cloudinary? This cannot be undone.${
        publishedSelected.length > 0
            ? ` ${publishedSelected.length} selected ${files(publishedSelected.length)} ${
                  publishedSelected.length === 1 ? 'is' : 'are'
              } used by published posts; those previews will stop loading.`
            : ''
    }${
        lockedSelected.length > 0
            ? ` ${lockedSelected.length} selected ${files(lockedSelected.length)} ${
                  lockedSelected.length === 1 ? 'is' : 'are'
              } locked by unfinished posts and will be skipped.`
            : ''
    } Deleting a file can also break an unsaved Composer or Reels draft that still references it.`;
```

9. Change the `AppShell` subtitle to:

```tsx
            subtitle="Manage the images and reels Meta-Bru uploaded to your own Cloudinary account."
```

10. Replace the "Meta-Bru uploads" card `hint` with:

```tsx
                                hint={`${imageCount} image${
                                    imageCount === 1 ? '' : 's'
                                } · ${videoCount} reel${videoCount === 1 ? '' : 's'}`}
```

11. Change `label="Unused images"` to `label="Unused files"` and `label="Locked images"` to `label="Locked files"`.

12. Replace the four "How this works" `<li>` texts with:

```tsx
                                    <li>
                                        Only images and reels in your own
                                        meta-bru/your-user-id/ folder are
                                        listed. Another user cannot access
                                        your Cloudinary account through
                                        Meta-Bru.
                                    </li>
                                    <li>
                                        Files used by draft, queued,
                                        publishing, failed, or partial posts
                                        are locked.
                                    </li>
                                    <li>
                                        Published files can be deleted, but
                                        their previews in Activity will stop
                                        loading.
                                    </li>
                                    <li>
                                        Deleting a draft or queued post in
                                        Queue also removes its file when no
                                        other post uses it.
                                    </li>
```

13. Change `aria-label="Search images"` to `aria-label="Search files"` and `aria-label="Sort images"` to `aria-label="Sort files"`.

14. Inside `<div className="flex flex-wrap items-center gap-2">` (the one that maps `FILTERS`), add before `{FILTERS.map(…)}`:

```tsx
                                <div className="flex gap-1 rounded-xl border border-white/5 bg-slate-950/40 p-1">
                                    {KINDS.map((item) => (
                                        <button
                                            key={item.key}
                                            onClick={() => changeKind(item.key)}
                                            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                                                kind === item.key
                                                    ? 'bg-white/10 text-white'
                                                    : 'text-slate-500 hover:text-white'
                                            }`}
                                        >
                                            {item.label}
                                        </button>
                                    ))}
                                </div>
```

15. Replace the count text expression:

```tsx
                                        : `${filteredAssets.length} image${
                                              filteredAssets.length === 1
                                                  ? ''
                                                  : 's'
                                          }`}
```

with:

```tsx
                                        : `${filteredAssets.length} ${files(
                                              filteredAssets.length
                                          )}`}
```

16. Replace the empty-state paragraph `Images you upload or generate in the Composer will appear here.` with:

```tsx
                                Images from the Composer and videos from the
                                Reels page will appear here.
```

17. Change `No images match this view` to `No files match this view`, and in its "Clear filters" `onClick` add `changeKind('all');` before `changeFilter('all');`.

18. Change the Modal `title="Delete selected images?"` to `title="Delete selected files?"`.

- [ ] **Step 3: Check types and lint**

Run: `cd frontend && npx tsc --noEmit -p .`
Expected: no errors.

Run: `cd frontend && npx eslint src/app/storage src/components/StorageAssetCard.tsx`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/StorageAssetCard.tsx frontend/src/app/storage/page.tsx
git commit -m "feat: list and filter reel videos in Storage"
```

---

### Task 8: Reel covers in Activity and the Overview

**Files:**
- Modify: `frontend/src/app/activity/page.tsx`, `frontend/src/components/Dashboards.tsx`

- [ ] **Step 1: Use the thumbnail helper**

In `frontend/src/app/activity/page.tsx`, change the types import to:

```ts
import {
    connectionName,
    formatDate,
    postThumbnailUrl,
    type Post,
} from '@/lib/types';
```

and replace `src={post.mediaUrl}` with `src={postThumbnailUrl(post)}`.

In `frontend/src/components/Dashboards.tsx`, add `postThumbnailUrl,` to the `@/lib/types` import after `formatDate,`, and in `RecentPostRow` replace `src={post.mediaUrl}` with `src={postThumbnailUrl(post)}`.

- [ ] **Step 2: Check types and lint**

Run: `cd frontend && npx tsc --noEmit -p .`
Expected: no errors.

Run: `cd frontend && npx eslint src`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/activity/page.tsx frontend/src/components/Dashboards.tsx
git commit -m "feat: show reel covers in Activity and the Overview"
```

---

### Task 9: Build and run the app

- [ ] **Step 1: Production build**

Run: `cd frontend && ./node_modules/.bin/next build`
Expected: build succeeds and lists `/reels` among the routes.

Run: `cd backend && npm test && npm run build`
Expected: all tests pass; `tsc` exits 0.

- [ ] **Step 2: Run both apps**

Start the backend (`cd backend && npm run dev`) and frontend (`cd frontend && npm run dev`) and sign in with a user that has Cloudinary credentials and a connected Page. Check:

1. The sidebar and mobile grid show **Reels**.
2. On `/reels`, picking a 2-second clip or a `.webm` file is refused in the browser with the matching message.
3. A valid MP4 shows upload progress, then the cover, duration, size, and a 9:16 note. A clip over 90 seconds disables Facebook with the explanation.
4. Save draft, reload: the reel, caption, platforms, and Story toggle come back.
5. Add to queue: Queue shows the cover with the duration chip and a **Reel** badge; the **Reels** filter shows it, **Posts** hides it.
6. Delete it from Queue: the confirmation names the video; afterwards the notice says it was removed from Cloudinary and Storage → **Reels** no longer lists it.
7. Storage → **Reels** lists uploaded videos with the Reel chip and duration; deleting an unused one works.
8. With a real Page: Post now on a short reel publishes to the selected platforms; on a published post, **Share to Story** opens the modal, sharing updates the Story chips, and the button reads **Shared to Story** once every platform is done.

Step 8 needs the user's own Meta Page and Cloudinary account. If they are not available here, report it as not verified rather than skipping it silently.
