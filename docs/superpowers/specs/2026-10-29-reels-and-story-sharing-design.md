# Reels, Story Sharing, and Media Deletion — Design

**Date:** 2026-10-29
**Status:** Approved
**Branch:** `feat/reels-stories`

## Goal

Let a user upload a Reel to their own Cloudinary account from a new Reels page,
queue or publish it to Facebook and Instagram like an image post, and share any
published post or reel to Facebook and Instagram Stories. Storage lists and
deletes reel videos next to images, and deleting an unpublished post in Queue
removes its Cloudinary file.

## Scope

In scope:

- A new **Reels** sidebar page with its own composer.
- Direct, signed browser-to-Cloudinary video upload with a progress bar.
- Publishing reels to Facebook Page Reels and Instagram Reels.
- Reels share the existing per-Page queue and daily posting times.
- Sharing a published post or reel to Facebook Page Stories and Instagram Stories:
  - an "Also share to Story" toggle in both composers, run right after publishing;
  - a "Share to Story" button on published and partial items in Queue.
- Storage lists and deletes videos as well as images.
- Deleting a draft, queued, or failed item in Queue also deletes its Cloudinary
  file when no other post uses it.
- Tests and build verification.

Out of scope:

- Analytics for reels and Stories (existing insight ladders already tolerate
  unsupported metrics; reels may show partial data).
- AI captions that look at the video. Reel captions use the topic and brand
  profile only.
- Uploads larger than 100 MB (chunked upload).
- Brand logo frames on reels.
- Attaching the original post as a Story sticker. Meta's API cannot do this; a
  Story is a new item that reuses the same image or video.
- Detecting a Facebook reel that Meta accepts and later fails in processing,
  after the publish wait ends.

## Media Rules

| Rule | Value |
|---|---|
| Reel formats | MP4, MOV |
| Reel file size | 100 MB maximum (Cloudinary single-request limit) |
| Reel duration | 3 seconds minimum |
| Facebook Reels | 90 seconds maximum |
| Instagram Reels | 15 minutes maximum |
| Story video | Trimmed to the first 60 seconds |

Selecting Facebook for a reel longer than 90 seconds is rejected by the backend
and disabled in the Reels composer.

### Cloudinary derivatives

Each reel gets three eager, asynchronous derivatives at upload time. Meta always
receives a derivative, never the original file.

| Name | Transformation | Format | Use |
|---|---|---|---|
| Reel MP4 | `c_pad,w_1080,h_1920,b_blurred:400:15/vc_h264,ac_aac,q_auto` | mp4 | Facebook and Instagram Reels |
| Cover | `so_1,c_fill,w_540,h_960,q_auto` | jpg | Thumbnails in Queue, Activity, Analytics, Storage |
| Story MP4 | `c_pad,w_1080,h_1920,b_blurred:400:15/du_60/vc_h264,ac_aac,q_auto` | mp4 | Facebook and Instagram video Stories |

Padding to 1080×1920 satisfies Facebook's 9:16 and 540×960 minimum rules for any
input shape. Instagram's reel thumbnail uses `thumb_offset=1000` to match the
cover frame.

Image Stories use an on-the-fly image derivative,
`c_pad,w_1080,h_1920,b_auto,q_auto:good` as JPG, built from the post's
existing `mediaPublicId`. Cloudinary's blurred padding is video-only, so images
pad with a colour taken from their edges.

All transformation strings live in one module so the upload signature, delivery
URLs, and Storage thumbnails always agree.

## Data Model Changes

### Post

```ts
mediaType: 'image' | 'reel';     // was 'image' only; default 'image'
mediaDuration: number;           // seconds; 0 for images
mediaCoverUrl: string;           // reel cover JPG; '' for images
shareToStory: boolean;           // default false
storyTargets: IPostTarget[];     // same shape as targets; default []
```

For a reel, `mediaUrl` is the Reel MP4 derivative URL and `mediaJpegUrl` is
empty.

`storyTargets` never affects `status`, `lastError`, or `publishedAt`. A post
that published and whose Story failed is still `published`.

Existing documents need no migration: the defaults describe an image post with
no Story.

## Reel Upload

```text
browser                       backend                       Cloudinary
  │ POST /media/video-signature ─▶ sign(folder, eager, …)
  │ ◀─ { cloudName, apiKey, timestamp, signature, … }
  │ POST /v1_1/<cloud>/video/upload (XHR, progress) ───────────▶ store + queue eager
  │ ◀──────────────────────────────────────────── { public_id, … }
  │ POST /media/videos { publicId } ─▶ Admin API resource()
  │                                    validate, or delete + 400
  │ ◀─ { media: VideoMedia }
```

### `POST /media/video-signature`

- `protect` and `mediaLimiter`.
- Loads the authenticated user's Cloudinary credentials.
- Signs `timestamp`, `folder=meta-bru/<userId>`, `eager` (the three
  derivatives), `eager_async=true`, and `allowed_formats=mp4,mov` with the API
  secret.
- Returns `{ cloudName, apiKey, timestamp, signature, folder, eager,
  eagerAsync, allowedFormats }`. The API key goes only to its owner, who can
  already reveal it under Profile. The API secret never leaves the server.
- Returns `503 MEDIA_NOT_CONFIGURED` when Cloudinary is not set up.

### `POST /media/videos`

- `protect` and `mediaLimiter`. Body: `{ publicId }`.
- Rejects a `publicId` outside `meta-bru/<req.user.id>/` with
  `400 INVALID_MEDIA`.
- Reads the asset with `cloudinary.api.resource(publicId, { resource_type:
  'video' })` using the owner's credentials.
- Validates format, size, and minimum duration. On failure it deletes the asset
  and returns `400` with the reason (`UNSUPPORTED_MEDIA_TYPE`,
  `MEDIA_TOO_LARGE`, `REEL_TOO_SHORT`, `REEL_TOO_LONG` above 15 minutes).
- Returns `VideoMedia`:

```ts
{
  publicId: string;
  url: string;          // Reel MP4 derivative
  coverUrl: string;
  originalUrl: string;  // Cloudinary secure_url, for the composer preview fallback
  width: number;
  height: number;
  duration: number;     // seconds
  format: string;
  bytes: number;
}
```

The browser checks type, size, and duration with a `<video>` element before
uploading, so most invalid files never reach Cloudinary.

## Creating a Reel Post

`POST /posts` accepts `mediaType: 'reel'` and `shareToStory`.

For a reel, the client sends only `mediaPublicId`. The backend reads the asset
again and fills `mediaUrl`, `mediaCoverUrl`, and `mediaDuration` from
Cloudinary, so a client cannot submit a false duration or a foreign URL.
`mediaPublicId` is required for every reel, on both platforms. A `publicId`
outside the user's folder returns `400 INVALID_MEDIA`, and one Cloudinary no
longer has returns `400 MEDIA_NOT_FOUND`.

Validation, in addition to the current checks:

- `REEL_TOO_SHORT` under 3 seconds.
- `FACEBOOK_REEL_TOO_LONG` when Facebook is selected and the reel is over 90
  seconds.

Image posts accept `shareToStory` and are otherwise unchanged.

## Publishing Reels

`publishPost` keeps its claim, lock, per-target save, and status rules. It picks
the platform function by `mediaType`.

### Waiting for Cloudinary

Before the first Meta call, `waitForCloudinaryDerivative(url)` sends a `HEAD`
request every 5 seconds for up to 3 minutes. A `200` means ready. Anything else
keeps waiting. On timeout the target fails with "Cloudinary is still preparing
this reel. Retry in a few minutes."

### Instagram Reels

1. Without a `creationId`, create a container: `media_type=REELS`, `video_url`,
   `caption`, `share_to_feed=true`, `thumb_offset=1000`.
2. Poll `status_code` every 10 seconds for up to 5 minutes.
   - `FINISHED`: publish with `media_publish`.
   - `ERROR` or `EXPIRED`: clear `creationId` and fail with Meta's status
     message.
   - Timeout: keep `creationId` and fail with "Instagram is still processing
     this reel. Retry in a few minutes."
3. With a `creationId` on retry: `PUBLISHED` marks the target published,
   `FINISHED` publishes, `IN_PROGRESS` keeps polling, and `ERROR`/`EXPIRED`
   recreates the container.

The existing Instagram quota check runs first.

### Facebook Reels

`target.creationId` holds the Facebook `video_id`, so a retry continues instead
of posting a duplicate.

1. Without a `creationId`: `POST /{page-id}/video_reels upload_phase=start`
   and save `video_id`.
2. `POST` to the returned `upload_url` on `rupload.facebook.com` with
   `Authorization: OAuth <token>` and `file_url: <Reel MP4 URL>`.
3. `POST /{page-id}/video_reels upload_phase=finish, video_id,
   video_state=PUBLISHED, description=<caption>`.
4. Poll `GET /{video_id}?fields=status` every 10 seconds for up to 2 minutes.
   - Any phase `error`: clear `creationId` and fail with Meta's message.
   - `publishing_phase.status=complete`, or the wait ends without an error:
     mark published with `externalId = video_id`.
5. With a `creationId` on retry, read the status first: a completed publish is
   marked published, a completed upload goes to step 3, and an error or
   expired video starts again at step 1.

A failure after step 3 keeps the existing "Check the Page before retrying"
warning for ambiguous Facebook failures.

### Timing

A reel can hold the Page lock for several minutes. Every publish run, including
its automatic Stories, gets one 12-minute deadline. Each wait stops at its own
limit or the deadline, whichever comes first. A step that runs out of time fails
with a "retry in a few minutes" message, and a Story that runs out of time can
be shared again from Queue. The run therefore always ends inside the 15-minute
`STALE_LOCK_MS`.

"Post now" waits for the result. On the Reels page its button reads "Publishing
reel… this can take a few minutes".

## Story Sharing

A new `storyService.publishStories(post, connection, accessToken, platforms)`
shares to each platform and writes `storyTargets`. A Story is attempted only on
platforms whose post target is `published`, and skipped where the Story target
is already `published`.

| | Image post | Reel |
|---|---|---|
| Instagram | Container `media_type=STORIES`, `image_url=<story JPG>`; poll up to 1 minute; `media_publish` | Container `media_type=STORIES`, `video_url=<Story MP4>`; poll up to 5 minutes; `media_publish` |
| Facebook | `POST /{page-id}/photos url=<story JPG> published=false`, then `POST /{page-id}/photo_stories photo_id` | `video_stories` start, rupload with `file_url=<Story MP4>`, finish |

Reel Stories wait for the Story MP4 derivative the same way reels wait for the
Reel MP4. Facebook Stories need no status poll: `finish` and `photo_stories`
return the Story's `post_id` directly.

An image post without a `mediaPublicId` (legacy or external media) cannot be
shared: its Story targets fail with "Stories need an image uploaded through
Meta-Bru."

Each platform succeeds or fails on its own. A Meta token error marks the
connection `needs_reauth`, as publishing does.

### Automatic share

When `shareToStory` is true, `publishPost` calls `publishStories` after its
targets finish, for the platforms that are now published. It runs inside the
same claim and Page lock. A retry that publishes a remaining platform also
shares that platform's Story.

### On-demand share

`POST /posts/:id/story`, body `{ platforms: ('facebook' | 'instagram')[] }`.

- Allowed for `published` and `partial` posts only.
- Claims the Page lock with `claimConnectionForPublish`, so it cannot race the
  scheduler or a second click.
- Returns `400 NOTHING_TO_SHARE` when no requested platform has a published post
  target without a published Story.
- Returns the updated post. Failed Story targets can be shared again.

### Permissions

The current scopes (`pages_manage_posts`, `pages_read_engagement`,
`pages_show_list`, `instagram_content_publish`) cover Reels and Stories. No Page
needs reconnecting.

## Storage

- The Search API expression becomes `(public_id:<folder>/* OR
  asset_folder=<folder>) AND (resource_type:image OR resource_type:video) AND
  type:upload`. The asset-folder fallback already returns every type. The prefix
  fallback runs once for `image` and once for `video`.
- `StorageAsset` gains `resourceType: 'image' | 'video'` and `duration`.
- A video thumbnail is the Cover derivative URL.
- Deletion is unchanged: `delete_resources_by_asset_ids` accepts asset IDs of
  any type and also removes derivatives. Lock rules are unchanged because they
  match on `mediaPublicId`.
- The page gains an **All / Images / Reels** filter. Video cards show the cover,
  a play badge, and the duration. Generic copy says "files" instead of
  "images".

## Queue Deletion Cleanup

`DELETE /posts/:id` keeps its status rules. After the post is deleted:

1. If `mediaPublicId` is inside the user's folder and no other post of that
   user references it, delete it with `cloudinary.api.delete_resources([id], {
   resource_type: image | video, type: 'upload' })`.
2. Respond `{ success, message, mediaDeleted, mediaError }`.

A Cloudinary failure never undoes the post deletion. Missing Cloudinary
credentials skip the cleanup with `mediaDeleted: false`.

Queue asks for confirmation before deleting and says the Cloudinary file is
removed too when nothing else uses it.

## Frontend

### Navigation

Add **Reels** after Composer, with a film icon, to the sidebar and mobile grid.

### Reels page (`/reels`)

- Page picker and Facebook/Instagram toggles, like the Composer.
- Video picker: MP4 or MOV, checked in the browser for size and duration, then
  uploaded with a progress bar.
- Facebook toggle disabled with an explanation when the reel is over 90
  seconds.
- Caption with the AI draft button (topic and brand profile only).
- "Also share to Story" toggle, noting Stories use the first 60 seconds.
- 9:16 preview: `<video>` with the cover as poster, falling back to the
  original while the derivative is still processing.
- Save draft, Add to queue, and Post now.
- The draft is saved to `localStorage` under its own key, as the Composer does.

### Composer

Add the "Also share to Story" toggle.

### Queue

- **All / Posts / Reels** chips next to the status tabs.
- A Reel badge and the cover as the thumbnail.
- A **Share to Story** button on published and partial items. It opens a
  modal to choose among published platforms and shows each Story's status and
  error.
- Story status chips on each card.
- A confirmation modal before Delete.

### Thumbnails elsewhere

A `postThumbnailUrl(post)` helper returns the cover for reels and `mediaUrl` for
images. Activity, Dashboard, and the post tracker use it. The analytics backend
returns the cover as `mediaUrl` for reels.

## Error Handling

- Cloudinary not configured: signature and video endpoints return `503` with a
  message that points to Profile, and the Reels page shows that message.
- Upload interrupted or rejected by Cloudinary: the page shows Cloudinary's
  error and keeps the caption and settings.
- A Story failure is shown on its chip in Queue and never turns a published post
  into a failed one.
- Every Meta error keeps the current mapping, including token errors marking the
  Page `needs_reauth`.

## Limits

- Facebook allows 30 API-published reels per Page in a rolling 24 hours.
- Instagram allows 100 API-published items per account in 24 hours. Stories
  count toward that limit and run the same quota check.

## Testing

Backend unit tests (`node --test`):

- Signature: signed fields, user folder, and secret not returned.
- Video validation: folder ownership, format, size, duration, and deleting
  rejected uploads.
- Reel post creation: server-filled media fields, Facebook 90-second rule.
- Instagram reel publishing: create, poll, publish, timeout keeps
  `creationId`, retry continues.
- Facebook reel publishing: start, rupload headers, finish, error clears
  `creationId`, retry continues.
- Stories: image and reel paths on both platforms, only published platforms,
  skips already-shared ones, failures leave post status unchanged.
- Storage: video listing, thumbnails, type field.
- Queue deletion cleanup: deletes unshared media, keeps shared media, survives
  Cloudinary errors.

Verification: backend `npm test` and `npm run build`; frontend `npm run lint`
and `npm run build`.
