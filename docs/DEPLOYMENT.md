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

## 1. Meta app

Create or open the app at <https://developers.facebook.com/apps>.

1. Add **Facebook Login** (Web).
2. In **Facebook Login → Settings**, add the exact callback URL:
   `https://YOUR-BACKEND.onrender.com/api/connections/meta/callback`
3. Set the app domain to your backend host and frontend host as needed.
   The backend callback validates state, then redirects to `FRONTEND_URL`; the
   frontend finishes the connection through an authenticated API call.
4. Add the permissions used by the app:
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
   - `instagram_basic`
   - `instagram_content_publish`
5. Complete App Review / business verification for those permissions, then switch
   the app to **Live** mode.
6. Configure a Privacy Policy URL, Terms of Service URL, and Data Deletion
   instructions URL in **App Settings → Basic**. Meta requires these for a public
   app even though Meta-Bru only stores Page tokens and post records.
7. The Facebook user connecting a Page must be able to create content on that
   Page, and the Page must have an Instagram Business/Creator account linked in
   Meta Business Suite if Instagram publishing is wanted.

If the app is in Development mode, only users with a role on the Meta app can
connect. Public users need Live mode and approved permissions.

## 2. Backend on Render

### Option A: Blueprint

The repository includes `render.yaml`. Create a new Blueprint from the repo and
fill in the secret environment variables when prompted. Set `META_REDIRECT_URI`
and `CLIENT_URL` after Render assigns the service URL.

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
| `META_APP_ID` | From the Meta app |
| `META_APP_SECRET` | From the Meta app |
| `META_REDIRECT_URI` | `https://YOUR-BACKEND.onrender.com/api/connections/meta/callback` |
| `META_GRAPH_VERSION` | `v26.0` |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary dashboard |
| `CLOUDINARY_API_KEY` | Cloudinary dashboard |
| `CLOUDINARY_API_SECRET` | Cloudinary dashboard |
| `GEMINI_API_KEY` | Google AI Studio |
| `APP_DEFAULT_TIMEZONE` | e.g. `Asia/Kolkata` |
| `SCHEDULER_ENABLED` | `true` |
| `SCHEDULER_GRACE_MINUTES` | `180` |

`PORT` is provided by Render; do not set it.

After the first deploy, open the Render shell and create the first admin:

```bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='strong-password' npm run seed:admin
```

Then verify:

```bash
curl https://YOUR-BACKEND.onrender.com/api/health
```

All feature flags should be `true`:

```json
{"status":"ok","features":{"meta":true,"media":true,"ai":true,"scheduler":true}}
```

## 3. Frontend on Vercel

- Import the repository.
- **Root directory:** `frontend`
- **Framework preset:** Next.js
- Add environment variable:
  `NEXT_PUBLIC_API_URL=https://YOUR-BACKEND.onrender.com/api`
- Deploy.

After Vercel gives you the production domain:

1. Add it to the backend's `CLIENT_URL` (exact origin, no trailing slash).
2. Use the backend callback URL in Meta's Valid OAuth Redirect URIs.
3. Redeploy the backend if Render does not restart automatically.

## 4. Cloudinary

1. Create a Cloudinary account.
2. Copy the cloud name, API key, and API secret into the backend environment.
3. No unsigned upload preset is needed; uploads use signed server-side calls.

Instagram requires JPEG, a public URL, aspect ratio between 4:5 and 1.91:1, and
a file under 8 MiB. Meta-Bru stores the original and asks Cloudinary for an
optimized JPEG delivery URL for both Facebook and Instagram, so WebP and PNG
uploads are safe to publish.

## 5. Gemini

1. Create an API key in Google AI Studio.
2. Set `GEMINI_API_KEY`.
3. The defaults are `gemini-2.5-flash` for captions and
   `imagen-4.0-generate-001` for images. Override either model with
   `GEMINI_TEXT_MODEL` / `GEMINI_IMAGE_MODEL` if your project uses different
   model access.

AI image output is uploaded to Cloudinary before it is returned to the composer.

## 6. First-run checklist

- [ ] `/api/health` reports `meta`, `media`, `ai`, and `scheduler` as `true`
- [ ] Admin can log in
- [ ] Admin can approve a second user
- [ ] Facebook Page connect completes and the Page appears under Connections
- [ ] Linked Instagram account is detected
- [ ] A test image uploads to Cloudinary
- [ ] **Post now** publishes to Facebook and Instagram
- [ ] A queued post shows a future **Next slot** time
- [ ] Setting the slot a few minutes ahead publishes exactly one post, once
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

- `TOKEN_ENCRYPTION_KEY` must remain stable. Changing it makes every stored Page
  token unreadable; users must reconnect.
- Rotating `JWT_SECRET` logs every user out.
- Never commit `.env`. The repository ignores it and includes only
  `.env.example` files.
- Keep `JWT_SECRET`, `META_APP_SECRET`, Cloudinary's API secret, and the Gemini
  key server-side only.

### Backups and monitoring

- Enable Atlas backups for the database.
- Monitor Render logs for `[scheduler]`, `[meta-oauth]`, and publishing errors.
- Add an uptime check on `/api/health`; an always-on instance is required for
  daily publishing.
