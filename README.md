# Meta-Bru

Multi-user SaaS for publishing one image post per day to each user's Facebook
Page and linked Instagram Business account.

## What it does

- Facebook Login / Meta OAuth to connect Pages
- Auto-detects the Instagram Business account linked to each Page
- Per-user Meta app, Cloudinary, and Gemini credentials entered under Profile
- Encrypted credential and Page token storage (AES-256-GCM)
- Cloudinary image hosting (Instagram requires a public image URL)
- Every upload and AI image is resized to 1080px wide within Instagram's
  4:5–1.91:1 feed range before it reaches Cloudinary, so posts are never
  zoomed or letterboxed by Meta
- Crop editor in the Composer: pick a shape (original, tall 4:5, square, or
  wide), then zoom and drag uploads and AI images into place before they are
  framed
- Optional brand logo under Profile: new post images get a frame that matches
  the photo, with the logo centred in the bottom border
- Reels: MP4 or MOV videos upload straight from the browser to the user's own
  Cloudinary account, then publish to Facebook Reels (3–90 seconds) and
  Instagram Reels (up to 15 minutes) from the same queue as image posts
- Story sharing: share any published post or reel to Facebook and Instagram
  Stories, automatically after publishing or on demand from Queue
- Deleting an unpublished post also removes its Cloudinary file when no other
  post uses it
- Per-connection daily time and IANA timezone
- FIFO queue with one automatic publish per connection per day
- Immediate **Post now** and **Retry failed** actions
- Gemini caption drafting and Imagen image generation, guided by a brand profile
- Facebook + Instagram publishing, per-platform status and errors
- Editable profile email and self-service password changes with other-session
  sign-out
- Admin user approval, per-user password resets, and a read-only activity
  overview

Carousels, long videos over 100 MB, Reel and Story analytics, and billing are
intentionally out of scope.

## Structure

```
backend/    Express 5 + TypeScript + Mongoose + in-process scheduler
frontend/   Next.js 16 App Router + React 19 + Tailwind 4
docs/       Deployment guide
```

## Local development

### Backend

```bash
cd backend
cp .env.example .env
# Fill in the values in .env
npm install
npm run dev
```

The API runs on `http://localhost:5001`.

### Frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

The frontend runs on `http://localhost:3000` (or the next free port). If it
starts on a different port, update `CLIENT_URL` and `FRONTEND_URL` in the backend
`.env` to match.

### First admin

New registrations are inactive until an admin approves them. On a fresh
database, create the first admin from the backend directory:

```bash
ADMIN_EMAIL=you@example.com \
ADMIN_PASSWORD='choose-a-strong-password' \
npm run seed:admin
```

Running the command again with `RESET_ADMIN_PASSWORD=true` resets the password.

## Environment

See `backend/.env.example` and `frontend/.env.example`.

Deployment-level variables:

- MongoDB Atlas connection string
- `JWT_SECRET` and `TOKEN_ENCRYPTION_KEY` (generate each with `openssl rand -hex 32`)
- `META_REDIRECT_URI` — the public backend OAuth callback URL
- `CLIENT_URL` and `FRONTEND_URL`
- Optional model overrides: `META_GRAPH_VERSION`, `GEMINI_TEXT_MODEL`,
  `GEMINI_IMAGE_MODEL`, scheduler settings

Each user adds the following under **Profile** after signing in:

- Their own Meta App ID and App Secret
- Their own Cloudinary cloud name, API key, and API secret
- Their own Gemini API key

The Meta App Secret, Cloudinary API secret/key, and Gemini key are encrypted at
rest with `TOKEN_ENCRYPTION_KEY`. They are never included in normal credential
status responses. A user can reveal them from **Profile** only after re-entering
their current password. The Meta App ID and Cloudinary cloud name are non-secret
identifiers and are shown back to the user. Every user's Meta app must whitelist
the deployment's `META_REDIRECT_URI` as a Valid OAuth Redirect URI.

Until a user adds a credential set, the related endpoints return `503` with a
clear message; the rest of the app still works. The health endpoint reports the
scheduler and per-user credential mode:

```bash
curl http://localhost:5001/api/health
```

### Per-user setup

1. Sign in and open **Profile → Integration credentials**.
2. Save the Meta App ID and App Secret from the user's own Meta app. Add the
   displayed OAuth callback URL to that app's Facebook Login settings. Add the
   listed permissions to the app, including `business_management` for Pages
   owned by a Meta Business Portfolio; without it Meta returns an empty Page
   list even when `pages_show_list` is granted.
3. Save the Cloudinary cloud name, API key, and API secret. Uploads go under
   `meta-bru/<userId>` in that Cloudinary account.
4. Save a Gemini API key for caption and image generation.
5. Optionally upload a logo under **Profile → Post branding**. A PNG with a
   transparent background works best. Without a logo, images are only resized.
6. Open **Connections** and connect a Facebook Page through Meta OAuth.

Changing or removing the Meta app credentials marks that user's existing Page
connections as **Reconnect needed**. Changing Cloudinary or Gemini credentials
does not affect already-published media or existing Page tokens.

If you are upgrading from a deployment that used shared Meta/Cloudinary/Gemini
environment credentials, every existing Page connection must be reconnected
after the user adds their own Meta app credentials. Publishing without a
per-user Meta app is blocked rather than falling back to a shared app.

## Account security

- Name and email are editable under **Profile**. Changing the sign-in email
  requires the current password.
- A user can change their own password under **Profile**. Every other session is
  signed out, while the current session receives a fresh token and stays active.
- An admin can reset any other user's password from **User Management**. The
  temporary password is shown once, all of that user's sessions are signed out,
  and the user must choose a new password at next login. Admins cannot reset
  their own password through that action; they use **Profile**.
- Existing passwords are stored only as bcrypt hashes and cannot be viewed.
- Use the eye icons under **Profile → Integration credentials** to reveal saved
  secrets. The first reveal requires the current password; use **Lock revealed
  secrets** to hide them again for the rest of the page session.

## Deployment

The scheduler must run on an always-on instance. Free tiers that sleep will not
publish reliably. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the production
walkthrough (Render backend + Vercel frontend + per-user Meta/Cloudinary/Gemini
setup).
