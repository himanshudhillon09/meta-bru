# Deployment

## Topology

```
Vercel (Next.js frontend)
        │  HTTPS + Bearer JWT
        ▼
Render (Express API, always-on Starter instance)
        ├── MongoDB Atlas
        ├── Meta Graph API v26.0
        ├── Cloudinary
        └── Gemini API
```

The daily scheduler runs inside the API process. It is a single-instance design:
do not run multiple API instances unless you move the scheduler to its own
worker. Render's free plan sleeps after inactivity, which stops the scheduler —
use the **Starter** plan or higher.

## 0. MongoDB Atlas

1. Create a cluster and a database user with read/write access.
2. Under **Network Access**, allow the Render service to connect. Render's
   outbound addresses vary unless you use a static egress IP, so either add
   Render's egress ranges or allow `0.0.0.0/0` for an initial setup and tighten
   it later.
3. Copy the SRV connection string into `MONGODB_URI`; set `DB_NAME=meta-bru`.

## 1. Per-user Meta apps

Meta-Bru does not store a shared Meta app ID or secret. Each user creates or
uses their own Meta app and enters its credentials under **Profile**. Send users
these steps:

1. Create an app at <https://developers.facebook.com/apps>.
2. Add **Facebook Login** (Web).
3. In **Facebook Login → Settings**, add the exact callback URL shown on the
   user's Profile page. It is:
   `https://YOUR-BACKEND.onrender.com/api/connections/meta/callback`
   unless `META_REDIRECT_URI` overrides it.
4. Add the permissions used by the app:
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
   - `business_management`
   - `instagram_basic`
   - `instagram_content_publish`

   `business_management` is required for Pages owned by a Meta Business
   Portfolio. Without it, `GET /me/accounts` can return an empty list even when
   `pages_show_list` is granted. When Meta asks which business to share, select
   the portfolio that owns the Page.
5. Complete App Review / business verification for those permissions on their
   app, then switch it to **Live** mode.
6. Configure a Privacy Policy URL, Terms of Service URL, and Data Deletion
   instructions URL in **App Settings → Basic**. Meta requires these for a public
   app even though Meta-Bru only stores Page tokens and post records.
7. The Facebook user connecting a Page must be able to create content on that
   Page, and the Page must have an Instagram Business/Creator account linked in
   Meta Business Suite if Instagram publishing is wanted.
8. Save the app ID and secret under **Profile → Integration credentials**, then
   connect the Page under **Connections**.

The deployment only supplies `META_REDIRECT_URI`; every user's app must
whitelist that same URL. The backend validates the signed OAuth state, then
redirects to `FRONTEND_URL`; the frontend finishes the connection through an
authenticated API call.

If a user's app is in Development mode, only users with a role on that app can
connect. Public users need Live mode and approved permissions on that user's
app. App Review is therefore the responsibility of each user who brings an app.

Changing or removing a user's Meta app credentials marks all of that user's
existing connections **Reconnect needed**. The Page tokens were issued by the
previous app and cannot be assumed to work with the new one. If you are
upgrading from a deployment that used shared environment credentials, every
existing Page connection must be reconnected after the user saves their own Meta
app credentials. Publishing without a per-user Meta app is blocked.

## 2. Backend on Render

### Option A: Blueprint

The repository includes `render.yaml`. Create a new Blueprint from the repo and
fill in the deployment-level environment variables when prompted. Set
`META_REDIRECT_URI` and `CLIENT_URL` after Render assigns the service URL.
Do not add shared Meta, Cloudinary, or Gemini credentials to Render; users enter
those under **Profile**.

### Option B: Manual web service

- **Root directory:** `backend`
- **Build command:** `npm ci && npm run build`
- **Start command:** `npm start`
- **Health check path:** `/api/health`
- **Instance type:** Starter or higher (always-on)
- **Node version:** 22

Environment variables:

| Key | Value |
| --- | --- |
| `MONGODB_URI` | Atlas connection string |
| `DB_NAME` | `meta-bru` (or your database name) |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -hex 32` (keep this stable) |
| `CLIENT_URL` | `https://your-frontend.vercel.app` (comma-separated if needed) |
| `FRONTEND_URL` | `https://your-frontend.vercel.app` (OAuth callback redirect target) |
| `META_REDIRECT_URI` | `https://YOUR-BACKEND.onrender.com/api/connections/meta/callback` |
| `META_GRAPH_VERSION` | `v26.0` |
| `GEMINI_TEXT_MODEL` | `gemini-2.5-flash` (optional) |
| `GEMINI_IMAGE_MODEL` | `imagen-4.0-generate-001` (optional) |
| `APP_DEFAULT_TIMEZONE` | e.g. `Asia/Kolkata` |
| `SCHEDULER_ENABLED` | `true` |
| `SCHEDULER_GRACE_MINUTES` | `180` |

`PORT` is provided by Render; do not set it. Per-user Meta, Cloudinary, and
Gemini credentials are not environment variables; they are encrypted in MongoDB
and managed from **Profile**.

After the first deploy, open the Render shell and create the first admin:

```bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='strong-password' npm run seed:admin
```

Then verify:

```bash
curl https://YOUR-BACKEND.onrender.com/api/health
```

The health response should report the scheduler and per-user credential mode:

```json
{"status":"ok","features":{"scheduler":true,"perUserCredentials":true}}
```

Meta, Cloudinary, and Gemini are configured per user, so they are not
deployment-wide feature flags. A user who has not added credentials will see a
clear `503` response from the related endpoints until they do.

## 3. Frontend on Vercel

- Import the repository.
- **Root directory:** `frontend`
- **Framework preset:** Next.js
- Add environment variable:
  `NEXT_PUBLIC_API_URL=https://YOUR-BACKEND.onrender.com/api`
- Deploy.

After Vercel gives you the production domain:

1. Add it to the backend's `CLIENT_URL` (exact origin, no trailing slash).
2. Tell each user to add the backend callback URL to their own Meta app's
   Valid OAuth Redirect URIs.
3. Redeploy the backend if Render does not restart automatically.

## 4. Cloudinary (per user)

Each user creates their own Cloudinary account and enters its cloud name, API
key, and API secret under **Profile → Integration credentials**. There are no
shared Cloudinary environment variables. No unsigned upload preset is needed;
uploads use signed server-side calls with that user's credentials. Assets are
stored under `meta-bru/<userId>`.

Instagram requires JPEG, a public URL, aspect ratio between 4:5 and 1.91:1, and
a file under 8 MiB. Meta-Bru stores the original and asks Cloudinary for an
optimized JPEG delivery URL for both Facebook and Instagram, so WebP and PNG
uploads are safe to publish. The JPEG delivery URL is stored on the post, so
publishing does not need Cloudinary credentials at publish time.

## 5. Gemini (per user)

Each user creates an API key in Google AI Studio and enters it under **Profile →
Integration credentials**. There is no shared `GEMINI_API_KEY` environment
variable. The deployment-level defaults are `gemini-2.5-flash` for captions and
`imagen-4.0-generate-001` for images. Override either model with
`GEMINI_TEXT_MODEL` / `GEMINI_IMAGE_MODEL` if the deployment uses different
model access.

AI image output is uploaded to the owning user's Cloudinary account before it is
returned to the composer. Caption and image calls use the owning user's Gemini
key.

## 6. First-run checklist

- [ ] `/api/health` reports `scheduler` and `perUserCredentials` as `true`
- [ ] Admin can log in
- [ ] Admin can approve a second user
- [ ] The user saves their own Meta app ID/secret under Profile and the shown
      callback URL is whitelisted in that Meta app
- [ ] The user saves their own Cloudinary and Gemini credentials
- [ ] Facebook Page connect completes and the Page appears under Connections
- [ ] Linked Instagram account is detected
- [ ] A test image uploads to the user's Cloudinary account
- [ ] **Post now** publishes to Facebook and Instagram
- [ ] A queued post shows a future **Next slot** time
- [ ] Setting the slot a few minutes ahead publishes exactly one post, once
- [ ] Changing the Meta app credentials marks existing connections
      **Reconnect needed**
- [ ] Revoking a Page token shows **Reconnect needed** and the reconnect flow works

## 7. Operations

### Scheduler behavior

- The scheduler checks every 60 seconds.
- A connection is claimed atomically with `lockedAt`, so two overlapping ticks
  cannot publish the same connection at the same time.
- The next slot is advanced and saved before Meta is called, so a crash after a
  successful publish cannot cause a second post on the same day.
- If no post is queued, the connection's next slot moves to the next day.
- If the process was down past a slot, a slot older than
  `SCHEDULER_GRACE_MINUTES` is skipped rather than published late.
- Posts stuck in `publishing` for more than 15 minutes are marked failed on
  scheduler ticks. They are **not** retried automatically because the original
  request may have succeeded; check the Page before pressing Retry.
- Instagram containers expire after 24 hours. Meta-Bru keeps the stored
  container ID on retry; if Meta returns `9007`, it checks the container status
  and either marks an already-published container as published or creates a
  fresh container for an expired/errored one. Editing a caption clears the
  stored container so the new caption is used.

### Limits

- Instagram currently allows 100 API-published posts per 24 hours per account.
- The app rate-limits AI requests per user in memory. If you scale to multiple
  API instances, replace this with a shared store.
- Deactivating a user pauses all of their connections. Reactivating the user
  restores access, but the user must turn each connection back on under
  Connections.
- Facebook Page tokens can be revoked by the user or by Meta. The app marks the
  connection `needs_reauth` and the Connections page shows a Reconnect button.

### Secrets

- `TOKEN_ENCRYPTION_KEY` must remain stable. It encrypts Page tokens and each
  user's Meta app secret, Cloudinary API key/secret, and Gemini key. Changing it
  makes all stored secrets unreadable; users must re-enter credentials and
  reconnect Pages.
- Rotating `JWT_SECRET` logs every user out.
- Never commit `.env`. The repository ignores it and includes only
  `.env.example` files.
- Keep `JWT_SECRET`, `TOKEN_ENCRYPTION_KEY`, and the deployment-level model
  settings server-side only.
- Per-user secrets are encrypted at rest, excluded from normal user queries, and
  never returned by the API. Admin views do not expose them.
- Database backups contain encrypted credential blobs. Protect the encryption key
  and the backup separately.
- The Meta App ID and Cloudinary cloud name are non-secret identifiers; they may
  be shown back to the owning user.

### Backups and monitoring

- Enable Atlas backups for the database.
- Monitor Render logs for `[scheduler]`, `[meta-oauth]`, and publishing errors.
- Add an uptime check on `/api/health`; an always-on instance is required for
  daily publishing.
