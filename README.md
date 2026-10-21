# Meta-Bru

Multi-user SaaS for publishing one image post per day to each user's Facebook
Page and linked Instagram Business account.

## What it does

- Facebook Login / Meta OAuth to connect Pages
- Auto-detects the Instagram Business account linked to each Page
- Encrypted Page token storage (AES-256-GCM)
- Cloudinary image hosting (Instagram requires a public image URL)
- Per-connection daily time and IANA timezone
- FIFO queue with one automatic publish per connection per day
- Immediate **Post now** and **Retry failed** actions
- Gemini caption drafting and Imagen image generation, guided by a brand profile
- Facebook + Instagram publishing, per-platform status and errors
- Admin user approval and a read-only activity overview

Image posts only in v1. Video, Reels, carousels, Stories, analytics, and billing
are intentionally out of scope.

## Structure

```
backend/    Express 5 + TypeScript + Mongoose + in-process scheduler
frontend/   Next.js 16 App Router + React 19 + Tailwind 4
docs/       Design spec and deployment guide
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

### Tests

```bash
cd backend
npm test
```

## Environment

See `backend/.env.example` and `frontend/.env.example`.

Required for the full product:

- MongoDB Atlas connection string
- `JWT_SECRET` and `TOKEN_ENCRYPTION_KEY` (generate each with `openssl rand -hex 32`)
- Meta app ID, app secret, and OAuth redirect URI
- Cloudinary cloud name, API key, and API secret
- Gemini API key

Without Meta, Cloudinary, or Gemini credentials, the corresponding endpoints
return `503` with a clear message; the rest of the app still works. The health
endpoint reports which integrations are configured:

```bash
curl http://localhost:5001/api/health
```

## Deployment

The scheduler must run on an always-on instance. Free tiers that sleep will not
publish reliably. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the production
walkthrough (Render backend + Vercel frontend + Meta/Cloudinary/Gemini setup).
