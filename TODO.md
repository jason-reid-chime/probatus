# Probatus — Master Todo

Last updated: April 2026

---

## ✅ Completed

### Infrastructure & Auth
- [x] Supabase project (cloud) — `coqpsfvydltujdmwldfi.supabase.co`
- [x] Multi-tenant schema with Row Level Security (RLS)
- [x] Auth flow — sign-up, sign-in, sign-out
- [x] Tenant + profile auto-creation via `create_account` RPC
- [x] Role system — `technician`, `supervisor`, `admin`, `customer`
- [x] ES256 JWT verification (JWKS endpoint) in backend middleware
- [x] Supavisor compatibility (SimpleProtocol for pgx)

### Frontend — Core App
- [x] Vite + React + TypeScript + Tailwind setup
- [x] Offline-first with Dexie (IndexedDB) + outbox sync pattern
- [x] React Query for server state, Dexie for local state
- [x] AppShell with sidebar navigation (mobile + desktop)
- [x] Dashboard with summary stats
- [x] Asset registry — list, create, edit, detail view
- [x] QR code scanner for Tag ID population (Capacitor camera)
- [x] Calibration list with status badges
- [x] Calibration detail — measurements table, sync indicator
- [x] Submit for approval flow (optimistic UI)
- [x] Supervisor approve flow (updates Dexie + React Query cache immediately)
- [x] Master standards management — list, create, edit, due-date tracking
- [x] Calibration template library — create, edit, apply to calibration form
- [x] Audit package generator (date range + customer filter)
- [x] Customer portal — separate shell, read-only asset + cert view
- [x] Admin can preview customer portal at `/portal`

### Calibration Form Templates
- [x] Pressure (Analog) — 5-point As Found / As Left, error %, pass/fail
- [x] Temperature (Analog) — multi-point with reference sensor
- [x] pH / Conductivity — combined readings + buffer lot tracking
- [x] Conductivity — standalone, multi-standard-solution, lot tracking, quick-add 84/1413/12880 µS/cm
- [x] Level / 4-20 mA — 5-point mA output verification
- [x] Flow / 4-20 mA — same math as level, flow-specific labelling
- [x] Transmitter (PV + 4-20 mA) — verifies both process variable display AND loop current per point
- [x] Pressure Switch — setpoint + trip/reset on rise and fall, deadband calculation, tolerance-based pass/fail
- [x] Temperature Switch — same as pressure switch

### Backend (Go)
- [x] Go API with chi router
- [x] Auth middleware — ES256 (JWKS) + HS256 fallback
- [x] CORS middleware
- [x] Assets handler
- [x] Calibrations handler — list, detail, approve endpoint
- [x] Certificates handler — HTML-to-PDF via Gotenberg
- [x] Audit package handler
- [x] Standards handler
- [x] Templates handler
- [x] Stats handler
- [x] Email handler (Resend — template built, API key not yet configured)
- [x] `/health` endpoint

### Certificate PDF
- [x] Matches sample certificate layout (two-column header, device grid, traceability statement, standards table, As Found / As Left / Error% / Result, technician + recal date)
- [x] Pulls tenant name, customer name, customer contact from DB
- [x] Recalibration date auto-calculated (+1 year from calibration date)

### Deployment
- [x] Frontend on Vercel (auto-deploys from GitHub `main`)
- [x] Backend on Railway (Docker, auto-deploys from GitHub `main`)
- [x] Supabase public credentials hardcoded as fallbacks (safe — anon key + RLS)
- [x] `VITE_API_URL` env var set in Vercel → Railway backend
- [x] GitHub Actions CI — frontend typecheck + build, backend build + vet
- [x] GitHub Actions deploy — post-deploy health check

### Database Migrations
- [x] `001_initial_schema.sql` — full schema, RLS policies, enums
- [x] `002_customer_portal.sql` — customer role, customer_id on profiles, customer-aware RLS
- [x] `003_instrument_types.sql` — flow, pressure_switch, temperature_switch, conductivity, transmitter_4_20ma

### Demo / Testing
- [x] `supabase/demo_seed.sql` — tenant "Apex Calibration Services", 2 customers, 3 Fluke standards, 4 assets, 3 calibration records (approved/pending/in-progress), customer portal user
- [x] `TEST-PLAN.md` — detailed beta test instructions with credentials and expected results

---

## 🚨 Production Blockers (must fix before first paying customer)

### Email — Highest Priority
- [ ] **Get a Resend API key** — sign up at resend.com (free tier: 3,000 emails/month)
- [ ] **Set `RESEND_API_KEY` in Railway** — backend → Variables → add key
- [ ] **Verify sending domain** — add DNS records in Resend dashboard for your domain
- [ ] **Test certificate email** — approve a calibration, confirm email arrives with PDF attached
- [ ] **Welcome email on signup** — send from `create_account` trigger or signup hook

### PDF Generation in Production
- [ ] **Deploy Gotenberg to Railway** — add a second service: Docker image `gotenberg/gotenberg:8`, no Dockerfile needed
- [ ] **Set `GOTENBERG_URL` in Railway** — point backend to the Gotenberg Railway service URL
- [ ] **Test end-to-end** — approve a cert, click download, confirm PDF generates in production (not just local)

### CORS & Security
- [ ] **Lock CORS to production domain** — currently probably set to `*` or broad; set `CORS_ORIGINS` env var in Railway to `https://probatus.vercel.app` (or your custom domain)
- [ ] **Add security headers to Vercel** — create `frontend/vercel.json` `headers` block: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`
- [ ] **Rate limiting on API** — add a simple in-memory rate limiter to the Go middleware (e.g., 100 req/min per IP)

### iPhone / Mobile
- [ ] **Fix Safari cache on iPhone** — user: Settings → Safari → Clear History and Website Data, then retry
- [ ] **Test on iOS Safari** — verify sign-in, calibration entry, offline mode
- [ ] **Test on Android Chrome** — verify same
- [ ] **Fix IndexedDB in Safari private mode** — Dexie throws in iOS private browsing; add graceful fallback message

---

## 🔧 Production Readiness (do within first month)

### Monitoring & Observability
- [ ] **Sentry — frontend** — `npm install @sentry/react`, add DSN to Vercel env vars; catches JS errors from real users
- [ ] **Sentry — backend** — `go get github.com/getsentry/sentry-go`, wrap handlers; catches panics and API errors
- [ ] **Uptime monitoring** — UptimeRobot (free): ping `/health` every 5 min, alert by email if down
- [ ] **Railway alerts** — set CPU/memory alerts in Railway dashboard

### CI/CD Hardening
- [ ] **Branch protection on `main`** — GitHub → Settings → Branches → require CI pass before merge
- [ ] **Dependabot** — enable in GitHub → Security → Dependabot alerts for npm + Go dependency vulnerabilities
- [ ] **`npm audit`** — run now, fix any high severity issues

### Database
- [ ] **Supabase backups** — verify Point-in-Time Recovery is enabled in Supabase dashboard (Pro plan feature; free plan has daily snapshots)
- [ ] **Migration automation** — add a migration runner to the Railway startup command so `003_instrument_types.sql` etc. run automatically on deploy
- [ ] **Connection pool sizing** — verify `DATABASE_URL` uses transaction pooler (port 6543), not session pooler, for Railway's container restarts

### Environments
- [ ] **Staging environment** — duplicate the Railway service + Vercel deployment for a staging branch; prevents shipping broken changes to real customers
- [ ] **Separate Supabase project for staging** — don't test against the prod database

---

## 📋 Legal & Compliance (before public launch)

- [ ] **Terms of Service** — add `/terms` page; must cover data ownership, liability, cancellation
- [ ] **Privacy Policy** — add `/privacy` page; required by Apple App Store, GDPR, CASL (Canada)
- [ ] **Data Processing Agreement (DPA)** — template for B2B customers who ask "where is our data stored?"
- [ ] **CASL compliance** — Canadian anti-spam law; ensure marketing emails have unsubscribe link
- [ ] **Cookie consent** — only needed if you add analytics (GA, etc.); Supabase auth cookies are exempt

---

## 🚀 Feature Backlog (ranked by impact)

### Tier 1 — Build these next

- [ ] **Customer due-date reminder emails** — weekly email to customer contacts: "3 instruments at Plant A due in 30 days." Drives repeat bookings. Use Resend + a cron job (Railway cron or Supabase pg_cron).
- [ ] **Supervisor approval dashboard** — dedicated page showing all `pending_approval` records across all techs, filterable by date/customer. Essential as team grows.
- [ ] **Site visit / job grouping** — group multiple calibrations into one "Job" (customer + date). Single job summary report. Needed for invoicing.
- [ ] **Digital signature capture** — replace text signatures with drawn signatures using the existing `SignaturePad` component. Embed base64 image in PDF cert. Required for ISO 17025.
- [ ] **Bulk asset import (CSV)** — drag-and-drop CSV: tag_id, serial, manufacturer, model, type, customer, range. Removes the #1 onboarding friction for new customers with 50+ instruments.

### Tier 2 — Competitive moat

- [ ] **Push notifications** — Capacitor + FCM/APNs: "SA submitted 3 certs for approval." Turns passive tool into active ops system.
- [ ] **QR label generator** — print calibration sticker (QR, due date, cert #) via AirPrint directly from app. Eliminates separate label printer workflow.
- [ ] **Instrument drift trending** — plot error % per instrument across calibration history. Flag degrading trends. No new data needed — already in `calibration_measurements`.
- [ ] **Photo evidence attachment** — attach photos of as-found conditions to calibration records. Supabase Storage already wired in; mostly a UI feature.
- [ ] **Adjustment tracking** — structured log of what was done to bring instrument into tolerance ("adjusted span +0.2 mA"). Required by some regulatory frameworks.

### Tier 3 — Enterprise unlock

- [ ] **Measurement uncertainty calculations** — ISO 17025 Clause 7.6 requires uncertainty on every cert. Built-in uncertainty budgets per measurement type.
- [ ] **Recurring calibration scheduling** — auto-generate work orders from calibration intervals. 12-month forward calendar. Turns reactive into proactive ops.
- [ ] **In-app invoice generation** — line items from instruments calibrated + time logged. Export as PDF or push to QuickBooks.
- [ ] **Stripe billing + freemium tier** — self-serve subscriptions. Free: 3 assets, 5 certs/month. Paid: unlimited.
- [ ] **White-label mode** — customer logo + colours. Premium tier pricing.
- [ ] **ISO 17025 accreditation scope guard** — hard-block out-of-scope calibrations, auto-generate scope table for SCC/A2LA submission.
- [ ] **French language support** — required for federal + Quebec contracts. react-i18n + translated cert templates.
- [ ] **CMMS/ERP sync** — work orders in from SAP PM / Maximo. Results back out. Highest enterprise deal value.

---

## 💰 Go-to-Market

- [ ] Send first 5 outreach emails (Southern Ontario calibration labs first)
- [ ] Book demo call with first beta customer (electrician starting calibration company)
- [ ] Run demo seed, walk through full workflow on call
- [ ] Get feedback, identify top 3 friction points
- [ ] Set up Stripe, start charging $79/month after 3-month beta

---

## 📱 Native App (Capacitor)

The app is already Capacitor-ready (`capacitor.config.ts`). When ready to ship native:

- [ ] `npx cap add ios` + `npx cap add android`
- [ ] Configure bundle ID (`com.sheridan.probatus` → change to your company)
- [ ] Apple Developer account ($99/year) + Google Play ($25 one-time)
- [ ] App Store screenshots + description
- [ ] TestFlight beta for iPhone testing (bypasses Safari cache issues entirely)
