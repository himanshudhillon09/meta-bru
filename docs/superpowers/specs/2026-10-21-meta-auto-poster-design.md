# Meta-Bru Auto-Poster — Design Spec

**Date:** 2026-10-21
**Status:** Implemented; per-user credential model; live Meta/Cloudinary/Gemini verification pending credentials
**Stack:** Next.js 16 / React 19 / Tailwind 4 · Express 5 / TypeScript / Mongoose 9 / MongoDB Atlas

## 1. Goal

A multi-user SaaS where each user connects their own Facebook Page (with its linked Instagram Business/Creator account), builds a queue of image posts, and has one post published automatically each day at a chosen local time. Each user also brings their own Meta app, Cloudinary account, and Gemini API key; there are no shared platform integration credentials.

## 2. Scope

### In scope (v1)
- Meta OAuth (Facebook Login) with per-user Page connections
- Auto-detect linked Instagram Business account per Page
- Encrypted long-lived Page token storage
- Image upload to Cloudinary (public URL required by Meta)
- Composer: caption, image, preview, target selection
- Gemini caption drafting and Imagen image generation
- Per-connection daily time + IANA timezone
- FIFO queue, one publish per connection per day
- Immediate "Post now" override
- Publish to Facebook Page and/or Instagram
- Publish history, per-platform status, errors, retry
- Token expiry/revocation handling with reconnect flow
- Admin visibility into users' connections and recent activity
- Per-user brand profile to guide AI
- Per-user Meta app, Cloudinary, and Gemini credentials under Profile
- Encrypted per-user credential storage; secrets never returned by the API

### Out of scope (v1)
Video/Reels, carousels, Stories, analytics/insights, comments/DMs, multiple posts per day, recurring templates, billing, team roles.

## 3. Architecture

Extend the existing Express monolith. No Redis or second worker.

```
Next.js (App Router)
   │  Bearer JWT
   ▼
Express API ── MongoDB Atlas (users, connections, posts)
   │
   ├── Meta Graph API v26.0 (OAuth + publish, per-user app credentials)
   ├── Cloudinary (per-user media hosting)
   ├── Gemini API (per-user caption + image key)
   └── Scheduler tick (every 60s, Mongo atomic locks)
```

The scheduler is a module with pure time functions and a single `tick()` entry point, so it can later move to a separate worker without changing the publishing logic.

The deployment supplies only the OAuth callback URL (`META_REDIRECT_URI`). Each user's Meta app ID/secret, Cloudinary credentials, and Gemini API key are stored in an AES-256-GCM encrypted JSON blob on the user record and resolved per request. There are no shared integration credential fallbacks.

## 4. Data model

### SocialConnection
One row per Facebook Page per user.

| Field | Type | Notes |
|---|---|---|
| userId | ObjectId → User | indexed |
| pageId | string | unique with userId |
| pageName | string | |
| pageAccessTokenEnc | string | AES-256-GCM |
| tokenStatus | `active` \| `needs_reauth` | |
| instagram | `{ id, username, profilePictureUrl }` \| null | linked business account |
| dailyTime | `HH:mm` | default `09:00` |
| timezone | IANA string | default from env when connecting |
| publishToFacebook | boolean | default true |
| publishToInstagram | boolean | default true if linked |
| isActive | boolean | default true |
| nextRunAt | Date | computed next slot |
| lastRunAt | Date | |
| lastError | string | |
| lockedAt | Date | scheduler claim |

### Post

| Field | Type | Notes |
|---|---|---|
| userId | ObjectId | |
| connectionId | ObjectId → SocialConnection | |
| caption | string | max 2,200 chars |
| mediaUrl | string | Cloudinary secure URL |
| mediaJpegUrl | string | Cloudinary JPEG delivery URL used for Meta |
| mediaPublicId | string | Cloudinary public ID |
| mediaType | `image` | v1 |
| platforms | `{ facebook, instagram }` | |
| status | `draft` \| `queued` \| `publishing` \| `published` \| `partial` \| `failed` | |
| targets | array | `{ platform, status, externalId, creationId, error, publishedAt }` |
| attempts | number | |
| lastError | string | |
| publishedAt | Date | |

### User additions
`brandProfile: { niche, tone, audience, keywords }`, `timezone` default, and
`credentialsEnc` — a `select: false` AES-256-GCM encrypted JSON blob containing
`{ meta: { appId, appSecret }, cloudinary: { cloudName, apiKey, apiSecret }, gemini: { apiKey } }`.
The Meta app ID and Cloudinary cloud name are non-secret identifiers; all secrets
are omitted from API responses.

## 5. Meta integration

### OAuth
- Start: authenticated `GET /api/connections/meta/start` loads the owning user's Meta app credentials, resolves the deployment callback URL, and returns the Facebook OAuth URL. If the user has not saved Meta credentials, it returns `503 META_NOT_CONFIGURED`.
- `state` is a short-lived signed JWT containing the user ID, a purpose marker, the requested timezone, the user's `appId`, and the resolved `redirectUri`; no DB row.
- Scopes: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management`, `instagram_basic`, `instagram_content_publish`. Override with `META_SCOPES`. `business_management` is required for Pages owned by a Meta Business Portfolio; without it `/me/accounts` can return `data: []`.
- Callback: validate the signed state, then redirect to the frontend with the one-time `code` and `state` in the URL fragment (so they are not sent to the frontend server, logs, or third-party assets).
- Completion: the authenticated frontend calls `POST /api/connections/meta/complete`. The backend verifies the state belongs to the authenticated user and that the user's current `appId` still matches the one in the state. It exchanges the code → long-lived token → `GET /me/accounts?fields=id,name,access_token,instagram_business_account{...}` using that user's app credentials, then upserts connections.
- Binding completion to the authenticated user prevents a crafted OAuth start from linking a victim's Pages to a different account.
- Page tokens are encrypted immediately and never returned by the API.
- Changing or removing a user's Meta app credentials marks all of that user's connections `needs_reauth`.

### Publishing
- Facebook: `POST /{page-id}/photos` with `url` and `caption` using the Page token. Uploads store a Cloudinary JPEG delivery URL (`mediaJpegUrl`); legacy/external posts fall back to `mediaUrl`.
- Instagram:
  1. `POST /{ig-user-id}/media` with `image_url` (JPEG) and `caption`
  2. `POST /{ig-user-id}/media_publish` with `creation_id`
  3. Poll container status if Meta reports it is not ready
- IG requires JPEG, publicly reachable, aspect ratio 4:5–1.91:1, <8 MiB. The Cloudinary JPEG URL is stored on the post at upload time, so publishing does not need Cloudinary credentials.
- Pre-check `GET /{ig-user-id}/content_publishing_limit`; current documented limit is 100 posts/24h.
- Store the container `creationId` before publishing so retries reuse it (containers live 24h).

### Errors
- Meta rate-limit and API errors are recorded on the failed target with an actionable message; the user can retry manually.
- OAuth error code 190 / invalid token: mark connection `needs_reauth`, surface reconnect CTA.
- Partial success (FB ok, IG failed): post status `partial`; failed target keeps its error.
- Ambiguous network failure: do not blindly duplicate a Facebook post; mark failed with "check page before retrying".
- Stuck `publishing` posts older than 15 minutes are marked failed on scheduler ticks.

## 6. Scheduler

- In-process interval tick every 60 seconds, single always-on instance deployment.
- Claim due connections atomically:
  `findOneAndUpdate({ nextRunAt <= now, lockedAt stale }, { lockedAt: now })`
- Advance `nextRunAt` to the next occurrence of `dailyTime` in `timezone` before publishing, then persist it. This makes a crash after Meta accepts a post safe from a second same-day publish.
- Pick oldest `queued` post for the connection and publish it.
- Grace window (`SCHEDULER_GRACE_MINUTES`, default 180): if the server was down and the slot is older than the window, skip to the next day rather than posting very late.
- Time math in Luxon; DST-safe.
- "Post now" bypasses the slot and does not change `nextRunAt`.

## 7. API surface

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/connections` | user | list own connections |
| GET | `/api/connections/meta/start` | user | OAuth URL |
| GET | `/api/connections/meta/callback` | public | validate OAuth state, redirect to frontend with code in fragment |
| POST | `/api/connections/meta/complete` | user | finish OAuth exchange and upsert Pages |
| PATCH | `/api/connections/:id` | owner | time, timezone, targets, active |
| DELETE | `/api/connections/:id` | owner | delete connection and its posts |
| POST | `/api/media/upload` | user | multipart image → Cloudinary |
| POST | `/api/ai/caption` | user, rate-limited | Gemini caption drafts |
| POST | `/api/ai/image` | user, rate-limited | Imagen → Cloudinary |
| POST | `/api/posts` | user | create draft/queued/immediate post |
| GET | `/api/posts` | user | filter by status/connection |
| PATCH | `/api/posts/:id` | owner | edit caption or requeue |
| DELETE | `/api/posts/:id` | owner | delete non-published |
| POST | `/api/posts/:id/publish-now` | owner | immediate publish |
| POST | `/api/posts/:id/retry` | owner | retry failed/partial targets |
| PATCH | `/api/auth/profile` | user | brand profile + timezone |
| GET | `/api/auth/credentials` | user | credential status (no secrets) |
| PUT/DELETE | `/api/auth/credentials/meta` | user | save/remove own Meta app credentials |
| PUT/DELETE | `/api/auth/credentials/cloudinary` | user | save/remove own Cloudinary credentials |
| PUT/DELETE | `/api/auth/credentials/gemini` | user | save/remove own Gemini key |
| GET | `/api/admin/overview` | admin | counts + recent posts |
| GET | `/api/admin/connections` | admin | all connections (no tokens) |
| GET | `/api/admin/posts` | admin | recent posts |

## 8. Frontend

Shared `AppShell` with sidebar: Overview, Composer, Queue, Activity, Connections, Profile; admin also sees Users.

- **Overview:** counts (connections, queued, published), next scheduled slot, quick actions.
- **Connections:** connect button, Page cards, IG badge, time/timezone/targets editor, active toggle, disconnect, reconnect when needed.
- **Composer:** connection picker, caption (2,200 limit), image upload, AI draft/image buttons, live preview, platform toggles, Add to Queue / Post Now.
- **Queue:** FIFO list with status, edit caption, post now, delete.
- **Activity:** published/partial/failed history with per-platform errors.
- **Profile:** account + brand profile fields, timezone, and per-user Meta app, Cloudinary, and Gemini credentials. Shows the OAuth callback URL, required scopes, and reconnect warnings; secrets are write-only.
- **Admin:** existing user approval + social overview table.

Auth guard extends to all private routes. Login/register redirect behavior unchanged.

## 9. Security & operations

- Meta Page tokens and per-user integration credentials encrypted with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`, 32-byte hex); never exposed to clients.
- Credential status returns only `configured` flags, the non-secret Meta app ID and Cloudinary cloud name, the deployment callback URL, and scopes. It never returns app secrets, Cloudinary API key/secret, or the Gemini key.
- All user resources scoped by `req.user.id`; admins can manage user access but cannot edit social data or read credentials.
- Zod validation on request bodies; limits on caption length, image type/size (10 MB).
- CORS restricted to configured client origins; Helmet headers.
- Rate limits: auth endpoints, AI endpoints, and media uploads (per user/IP).
- Cloudinary and Gemini calls resolve the owning user's credentials; there are no shared fallbacks.
- Required Meta production assets: privacy policy, terms, data-deletion callback URL for each user's Meta app.
- AI image output is uploaded to the owning user's Cloudinary account before it is usable.
- Deploy to an always-on instance (Render Starter/Railway/Fly). Free tiers that sleep cannot run the scheduler.
- Deployment env vars: Mongo, JWT, token encryption, client URL, `META_REDIRECT_URI`, Graph version, model names, scheduler settings. Per-user Meta/Cloudinary/Gemini credentials live encrypted in MongoDB.

## 10. Testing

- Implemented unit coverage: timezone next-slot calculation incl. DST; token encryption/decryption; per-user credential store round-trip/validation; Cloudinary JPEG URL generation.
- Recommended next coverage: mocked Graph API for FB payload, IG container → publish, partial failure, token error → `needs_reauth`; scheduler due/empty/lock/grace cases; API ownership isolation and admin access; credential API secret-preservation and reconnect invalidation.
- Manual live test using a Meta test Page and linked IG account, with each user's own Meta app/Cloudinary/Gemini credentials.
- CI never posts to live Meta APIs.

## 11. Implementation phases

1. Foundation: env/config, encryption, models, validation, error handling.
2. Connections: Meta OAuth, page sync, connection CRUD.
3. Media + AI: Cloudinary upload, Gemini caption/image.
4. Posts: composer API, queue, publish-now, Facebook/Instagram publishers, history.
5. Scheduler: daily slots, locking, retries, recovery.
6. Frontend: AppShell, connections, composer, queue, activity, settings, admin.
7. Hardening: rate limits, CORS/Helmet, tests, deployment docs.

## 12. Open items (external credentials)

The deployment must supply `META_REDIRECT_URI`; each user must supply their own
Meta app ID/secret, Cloudinary cloud name/API key/API secret, and Gemini API key
under Profile before their live publishing works. Each user's Meta app must
whitelist the deployment callback URL and be approved for the required
permissions. Everything else can be built and tested locally without them.
