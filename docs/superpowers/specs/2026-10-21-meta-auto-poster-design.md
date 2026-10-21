# Meta-Bru Auto-Poster — Design Spec

**Date:** 2026-10-21
**Status:** Approved scope; implementation in progress
**Stack:** Next.js 16 / React 19 / Tailwind 4 · Express 5 / TypeScript / Mongoose 9 / MongoDB Atlas

## 1. Goal

A multi-user SaaS where each user connects their own Facebook Page (with its linked Instagram Business/Creator account), builds a queue of image posts, and has one post published automatically each day at a chosen local time.

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
   ├── Meta Graph API v26.0 (OAuth + publish)
   ├── Cloudinary (media hosting)
   ├── Gemini API (caption + image)
   └── Scheduler tick (every 60s, Mongo atomic locks)
```

The scheduler is a module with pure time functions and a single `tick()` entry point, so it can later move to a separate worker without changing the publishing logic.

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
| timezone | IANA string | default from env |
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
| mediaPublicId | string | for JPEG derivation |
| mediaType | `image` | v1 |
| platforms | `{ facebook, instagram }` | |
| status | `draft` \| `queued` \| `publishing` \| `published` \| `partial` \| `failed` | |
| targets | array | `{ platform, status, externalId, creationId, error, publishedAt }` |
| attempts | number | |
| lastError | string | |
| publishedAt | Date | |

### User additions
`brandProfile: { niche, tone, audience, keywords }` and `timezone` default.

## 5. Meta integration

### OAuth
- Start: authenticated `GET /api/connections/meta/start` returns the Facebook OAuth URL.
- `state` is a short-lived signed JWT containing `userId` and a nonce; no DB row.
- Scopes: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`. Override with `META_SCOPES`.
- Callback: verify state → exchange code → exchange short-lived token for long-lived → `GET /me/accounts?fields=id,name,access_token,instagram_business_account{...}` → upsert connections.
- Page tokens are encrypted immediately and never returned by the API.

### Publishing
- Facebook: `POST /{page-id}/photos` with `url` and `caption` using the Page token.
- Instagram:
  1. `POST /{ig-user-id}/media` with `image_url` (JPEG) and `caption`
  2. `POST /{ig-user-id}/media_publish` with `creation_id`
  3. Poll container status if Meta reports it is not ready
- IG requires JPEG, publicly reachable, aspect ratio 4:5–1.91:1, <8 MiB. Cloudinary derives a JPEG URL on publish.
- Pre-check `GET /{ig-user-id}/content_publishing_limit`; current documented limit is 100 posts/24h.
- Store the container `creationId` before publishing so retries reuse it (containers live 24h).

### Errors
- HTTP 429 / Meta rate limits: exponential backoff, max 3 attempts.
- OAuth error code 190 / invalid token: mark connection `needs_reauth`, surface reconnect CTA.
- Partial success (FB ok, IG failed): post status `partial`; failed target keeps its error.
- Ambiguous network failure: do not blindly duplicate a Facebook post; mark failed with "check page before retrying".
- Stuck `publishing` posts older than 15 minutes are marked failed on startup.

## 6. Scheduler

- `node-cron` tick every 60 seconds, single instance deployment.
- Claim due connections atomically:
  `findOneAndUpdate({ nextRunAt <= now, lockedAt stale }, { lockedAt: now })`
- Pick oldest `queued` post for the connection. If none, advance `nextRunAt` and unlock.
- Publish, update post/targets, set `nextRunAt` to the next occurrence of `dailyTime` in `timezone`.
- Grace window (`SCHEDULER_GRACE_MINUTES`, default 180): if the server was down and the slot is older than the window, skip to the next day rather than posting very late.
- Time math in Luxon; DST-safe.
- "Post now" bypasses the slot and does not change `nextRunAt`.

## 7. API surface

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/connections` | user | list own connections |
| GET | `/api/connections/meta/start` | user | OAuth URL |
| GET | `/api/connections/meta/callback` | public | OAuth callback, redirects to frontend |
| PATCH | `/api/connections/:id` | owner | time, timezone, targets, active |
| DELETE | `/api/connections/:id` | owner | revoke/delete connection |
| POST | `/api/media/upload` | user | multipart image → Cloudinary |
| POST | `/api/ai/caption` | user, rate-limited | Gemini caption drafts |
| POST | `/api/ai/image` | user, rate-limited | Imagen → Cloudinary |
| POST | `/api/posts` | user | create draft/queued/immediate post |
| GET | `/api/posts` | user | filter by status/connection |
| PATCH | `/api/posts/:id` | owner | edit caption/connection |
| DELETE | `/api/posts/:id` | owner | delete non-published |
| POST | `/api/posts/:id/publish-now` | owner | immediate publish |
| POST | `/api/posts/:id/retry` | owner | requeue failed post |
| PATCH | `/api/auth/profile` | user | brand profile + timezone |
| GET | `/api/admin/overview` | admin | counts + recent posts |
| GET | `/api/admin/connections` | admin | all connections (no tokens) |
| GET | `/api/admin/posts` | admin | recent posts |

## 8. Frontend

Shared `AppShell` with sidebar: Overview, Composer, Queue, Activity, Connections, Settings; admin also sees Users.

- **Overview:** counts (connections, queued, published), next scheduled slot, quick actions.
- **Connections:** connect button, Page cards, IG badge, time/timezone/targets editor, active toggle, disconnect, reconnect when needed.
- **Composer:** connection picker, caption (2,200 limit), image upload, AI draft/image buttons, live preview, platform toggles, Add to Queue / Post Now.
- **Queue:** FIFO list with status, edit caption, post now, delete.
- **Activity:** published/partial/failed history with per-platform errors.
- **Settings:** brand profile fields + timezone.
- **Admin:** existing user approval + social overview table.

Auth guard extends to all private routes. Login/register redirect behavior unchanged.

## 9. Security & operations

- Meta tokens encrypted with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`, 32-byte hex); never exposed to clients.
- All user resources scoped by `req.user.id`; admins read-only.
- Zod validation on request bodies; limits on caption length, image type/size (10 MB).
- CORS restricted to configured client origins; Helmet headers.
- Rate limits: auth endpoints and AI endpoints (per user).
- Cloudinary API secret and Gemini key server-side only.
- Required Meta production assets: privacy policy, terms, data-deletion callback URL.
- AI image output is uploaded to Cloudinary before it is usable.
- Deploy to an always-on instance (Render Starter/Railway/Fly). Free tiers that sleep cannot run the scheduler.
- Env vars: Mongo, JWT, token encryption, client URL, Meta app, Cloudinary, Gemini, Graph version, scheduler settings.

## 10. Testing

- Unit: timezone next-slot calculation incl. DST; token encryption/decryption; IG JPEG URL derivation; caption validation.
- Unit with mocked Graph API: FB photo payload, IG container → publish, partial failure, token error → `needs_reauth`, rate-limit handling.
- Scheduler: due/not-due, empty queue, atomic lock, grace-window skip.
- API integration: ownership isolation (user A cannot read/publish user B's post); admin access.
- Manual live test using a Meta test Page and linked IG account.
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

The following must be supplied before live publishing works:
`META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`, `CLOUDINARY_*`, `GEMINI_API_KEY`.
Everything else can be built and tested locally without them.
