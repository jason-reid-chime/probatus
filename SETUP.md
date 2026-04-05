# Probatus — Setup Guide

- [Local Dev Setup](#local-dev-setup) — run it on your machine today
- [Production Deploy](#production-deploy) — ship it to the internet

---

# Local Dev Setup

Follow these steps in order. Total time: ~10 minutes.

---

## Step 1 — Create a Supabase Project (cloud)

1. Go to https://supabase.com and sign in
2. Click **New project**
3. Name: `probatus` | Region: `Canada (Central)` | Set a DB password (save it)
4. Wait ~2 minutes for the project to provision

---

## Step 2 — Get Your API Keys

In the Supabase dashboard go to:
**Project Settings → API**

You need two values:

| Key | Where to find it | Env variable |
|-----|-----------------|--------------|
| Project URL | "Project URL" box | `VITE_SUPABASE_URL` |
| Anon key | "Project API keys → anon public" | `VITE_SUPABASE_ANON_KEY` |

Also go to **Project Settings → API → JWT Settings** and copy:

| Key | Where to find it | Env variable |
|-----|-----------------|--------------|
| JWT Secret | "JWT Secret" | `SUPABASE_JWT_SECRET` |

And go to **Project Settings → Database → Connection string → URI** and copy the full URI:

| Key | Where to find it | Env variable |
|-----|-----------------|--------------|
| DB connection string | URI mode (replace [YOUR-PASSWORD] with your DB password) | `DATABASE_URL` |

---

## Step 3 — Create Your .env Files

### Frontend — create `frontend/.env.local`

```
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
VITE_API_URL=http://localhost:8080
```

### Backend — create `backend/.env`

```
PORT=8080
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxxxxxx.supabase.co:5432/postgres
SUPABASE_JWT_SECRET=your-jwt-secret-here
GOTENBERG_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:5173
```

---

## Step 4 — Run the Database Migration

```bash
supabase db push --db-url "postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxxxxxx.supabase.co:5432/postgres"
```

---

## Step 5 — Seed the Database

```bash
psql "postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxxxxxx.supabase.co:5432/postgres" < supabase/seed.sql
```

> If psql isn't installed: `brew install postgresql`

---

## Step 6 — Create Test Users in Supabase

In the Supabase dashboard go to **Authentication → Users → Add user** (turn off "Auto Confirm Email").

Create these 3 users **with exactly these emails and passwords**:

| Email | Password | Role |
|-------|----------|------|
| jason@sheridan.ca | Probatus2026! | Admin |
| mike@sheridan.ca | Probatus2026! | Supervisor |
| sarah@sheridan.ca | Probatus2026! | Technician |

> **Important:** After creating each user, click into the user in the dashboard and **manually set the UUID** to match the seed data:
> - jason@sheridan.ca → `00000000-0000-0000-0000-000000000001`
> - mike@sheridan.ca → `00000000-0000-0000-0000-000000000002`
> - sarah@sheridan.ca → `00000000-0000-0000-0000-000000000003`
>
> (Settings → Edit → change the ID field)
>
> This links them to the profiles and sample data in the seed file.

---

## Step 7 — Start Gotenberg (PDF service) via Docker

```bash
docker run -d --name gotenberg -p 3000:3000 gotenberg/gotenberg:8
```

---

## Step 8 — Start the Go API

```bash
cd /Users/jasonreid/Projects/probatus/backend
export $(cat .env | xargs)
go run ./cmd/api
```

You should see: `Probatus API starting port=8080`

---

## Step 9 — Start the Frontend

Open a new terminal tab:

```bash
cd /Users/jasonreid/Projects/probatus/frontend
npm run dev
```

Open http://localhost:5173 in your browser.

---

## Step 10 — Log In

Use any of the test accounts:
- `jason@sheridan.ca` / `Probatus2026!` → Admin view
- `sarah@sheridan.ca` / `Probatus2026!` → Technician view (limited nav)

---

## Quick Reference — All Commands

```bash
# One-time setup
supabase db push --db-url "YOUR_DB_URL"
psql "YOUR_DB_URL" < supabase/seed.sql
docker run -d --name gotenberg -p 3000:3000 gotenberg/gotenberg:8

# Daily dev (3 terminals)
# Terminal 1 — API
cd backend && export $(cat .env | xargs) && go run ./cmd/api

# Terminal 2 — Frontend
cd frontend && npm run dev

# Terminal 3 — Gotenberg (only if container stopped)
docker start gotenberg
```

---

---

# Production Deploy

## Architecture

```
Browser / iOS / Android
        │
        ├─── Supabase (Auth, DB, Storage) — managed, no deploy needed
        │
        └─── Fly.io
               ├── probatus-api     (Go API,  256MB, yyz region)
               └── probatus-gotenberg (PDF,   512MB, yyz region)

Frontend → Netlify / Vercel (static build, free tier)
```

---

## Pre-flight Checklist

- [ ] Supabase project created and migration run (already done in local setup)
- [ ] `fly` CLI installed: `brew install flyctl`
- [ ] Logged in: `fly auth login`
- [ ] GitHub repo created and code pushed

---

## Step 1 — Deploy Gotenberg

```bash
fly launch --config fly.gotenberg.toml --no-deploy
fly deploy --config fly.gotenberg.toml
```

Note the URL it gives you, e.g. `https://probatus-gotenberg.fly.dev`

---

## Step 2 — Set API Secrets on Fly

```bash
fly secrets set \
  DATABASE_URL="postgresql://postgres:[PASSWORD]@db.xxxx.supabase.co:5432/postgres" \
  SUPABASE_JWT_SECRET="your-jwt-secret" \
  GOTENBERG_URL="https://probatus-gotenberg.fly.dev" \
  CORS_ORIGINS="https://your-frontend-domain.com" \
  --app probatus-api
```

---

## Step 3 — Deploy the API

```bash
fly launch --config fly.toml --no-deploy
fly deploy --config fly.toml
```

Test it:
```bash
curl https://probatus-api.fly.dev/health
# → {"status":"ok"}
```

---

## Step 4 — Deploy the Frontend

### Option A — Netlify (recommended, free)

```bash
cd frontend
npm run build
# Drag the dist/ folder to app.netlify.com/drop
```

Or connect the GitHub repo in Netlify dashboard:
- Build command: `npm run build`
- Publish directory: `dist`
- Add environment variables in Netlify → Site Settings → Environment Variables:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_API_URL` = `https://probatus-api.fly.dev`

### Option B — Vercel

```bash
npm i -g vercel
cd frontend && vercel --prod
```

Set the same 3 environment variables in the Vercel dashboard.

---

## Step 5 — Update Supabase Auth Redirect URLs

In Supabase Dashboard → **Authentication → URL Configuration**:

- **Site URL:** `https://your-frontend-domain.com`
- **Redirect URLs:** add `https://your-frontend-domain.com`

---

## Step 6 — Set Up GitHub Actions Auto-Deploy

1. Get your Fly API token: `fly tokens create deploy -x 999999h`
2. Add it to GitHub: repo → Settings → Secrets → `FLY_API_TOKEN`
3. Push to `main` — the API deploys automatically via `.github/workflows/deploy.yml`

---

## Estimated Monthly Cost (MVP)

| Service | Cost |
|---------|------|
| Supabase (free tier) | $0 |
| Fly.io — probatus-api (auto-stop) | ~$2–5 |
| Fly.io — probatus-gotenberg (auto-stop) | ~$3–8 |
| Netlify / Vercel frontend | $0 |
| **Total** | **~$5–13/month** |

Machines auto-stop when idle, so you only pay when the app is actively used.

---

## Custom Domain (optional)

```bash
fly certs add api.probatus.com --app probatus-api
```

Then add a CNAME record in your DNS:
```
api.probatus.com → probatus-api.fly.dev
```

---

## Running a Migration in Production

Whenever you add a new migration file to `supabase/migrations/`:

```bash
supabase db push --db-url "YOUR_PROD_DATABASE_URL"
```
