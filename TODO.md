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
- [x] Rate limiting — per-IP token bucket (100 req/min, burst 20) in Go middleware
- [x] Secure headers — X-Content-Type-Options, X-Frame-Options, HSTS, Referrer-Policy
- [x] Request body limit (2 MB global cap)
- [x] Sentry — frontend (`@sentry/react`) and backend (`sentry-go`) integrated

### Frontend — Core App
- [x] Vite + React + TypeScript + Tailwind setup
- [x] Offline-first with Dexie (IndexedDB) + outbox sync pattern
- [x] Outbox rewritten to HTTP-shape (`method`, `url`, `body`) — no longer writes directly to Supabase
- [x] `apiRequest()` client — single entry point for all Go backend calls with Bearer token
- [x] React Query for server state, Dexie for local state
- [x] AppShell with sidebar navigation (mobile + desktop)
- [x] Dashboard with summary stats
- [x] Asset registry — list, create, edit, detail view
- [x] QR code scanner for Tag ID population (Capacitor camera)
- [x] Calibration list with status badges + bulk select
- [x] Bulk approve — calls Go API, updates Dexie immediately
- [x] Bulk delete — calls Go API, removes from Dexie immediately
- [x] Calibration detail — measurements table, sync indicator, delete, reopen
- [x] Submit for approval flow (optimistic UI)
- [x] Supervisor approve flow (updates Dexie + React Query cache immediately)
- [x] Supervisor reject flow — routes through Go backend
- [x] Master standards management — list, create, edit, due-date tracking
- [x] Calibration template library — create, edit, apply to calibration form
- [x] Audit package generator (date range + customer filter)
- [x] Customer portal — separate shell, read-only asset + cert view
- [x] Admin can preview customer portal at `/portal`
- [x] Google Maps Places Autocomplete on address fields (`AddressAutocomplete` component, degrades gracefully)
- [x] Work orders — list, create, detail with asset linking
- [x] Work order technician assignment — supervisors assign techs, techs see their assigned orders
- [x] Technician-filtered work order list with info banner
- [x] Calendar view — calibrations due
- [x] Instrument drift chart in asset detail

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
- [x] Assets handler — full CRUD
- [x] Calibrations handler — list, detail, create, update, delete, approve, reject, reopen, bulk approve, bulk delete
- [x] Customers handler — full CRUD (List, Create, Update, Delete)
- [x] Certificates handler — HTML-to-PDF via Gotenberg
- [x] Audit package handler
- [x] Standards handler
- [x] Templates handler
- [x] Stats handler
- [x] Email handler (Resend)
- [x] `/health` endpoint
- [x] Structured slog logging throughout
- [x] Panic recovery + Sentry reporting middleware

### Certificate PDF
- [x] Matches sample certificate layout (two-column header, device grid, traceability statement, standards table, As Found / As Left / Error% / Result, technician + recal date)
- [x] Pulls tenant name, customer name, customer contact from DB
- [x] Recalibration date auto-calculated (+1 year from calibration date)

### Database Migrations
- [x] `001` — full schema, RLS policies, enums
- [x] `002` — customer role, customer_id on profiles, customer-aware RLS
- [x] `003` — additional instrument types
- [x] `004` — asset tag unique constraint
- [x] `005` — performance indexes
- [x] `006` — certificates storage bucket + RLS
- [x] `007` — calibration templates table
- [x] `008/009` — data cleanup / fresh start
- [x] `010` — work orders + work_order_assets
- [x] `011` — measurement uncertainty fields
- [x] `012` — customer contact fields
- [x] `013` — as_found_value + rejection_reason columns
- [x] `014` — customers updated_at
- [x] `015` — work_order_technicians junction table

### Testing
- [x] Vitest + jsdom frontend test suite (27 files, 232 tests)
- [x] Coverage baseline enforcement in CI (frontend 32.28%, backend 45.6%)
- [x] Pre-commit hook — typechecks frontend before commit, skips if no frontend changes
- [x] Backend handler tests — calibrations (full coverage incl. reject/reopen/delete/bulk), customers, assets, standards, templates, stats, middleware
- [x] CustomerForm tests — fetch mocked correctly with `vi.stubGlobal`, all 11 tests passing

### Deployment
- [x] Frontend on Vercel (auto-deploys from GitHub `main`)
- [x] Backend on Railway (Docker, auto-deploys from GitHub `main`)
- [x] SPA rewrite rule in `vercel.json`
- [x] `VITE_API_URL` env var set in Vercel → Railway backend
- [x] GitHub Actions CI — lint, typecheck, build, test, coverage enforcement
- [x] GitHub Actions deploy — post-deploy health check

---

## 🚨 Security — Fix Before Any External Users

These were identified in the staff security review. Ordered by severity.

- [ ] **P0 — Profile self-promotion**: `Sidebar.tsx` calls `supabase.from('profiles').update({ role })` directly — RLS does not check the caller's current role, so a technician can promote themselves to admin. Move to a Go backend endpoint with `role == "admin"` guard.
- [ ] **P0 — CORS wildcard**: If `CORS_ORIGINS` env var is unset, backend allows `*`. Add a startup check that fails with a clear error when `CORS_ORIGINS` is empty in non-dev environments.
- [ ] **P1 — Work orders bypass backend entirely**: `useWorkOrders.ts` writes `work_orders`, `work_order_assets`, and `work_order_technicians` directly to Supabase. No server-side role enforcement. Needs a Go work-orders handler.
- [ ] **P1 — `calibration_standards_used` written from frontend**: A user can link standards from other tenants. Move to backend as part of calibration create/update body.
- [ ] **P1 — HS256 JWT fallback is silent**: When the JWKS endpoint is unavailable the auth middleware silently downgrades to symmetric HS256. Add a high-severity log alert and consider gating the fallback behind an explicit env flag (`ALLOW_HS256_FALLBACK=true`).
- [ ] **P2 — Assets and standards deletions bypass backend**: `lib/api/assets.ts` and `lib/api/standards.ts` delete via Supabase client. Go handlers exist — wire them in.
- [ ] **P2 — Certificate URL updated directly in Supabase**: `CalibrationDetail.tsx` has a `// TODO` comment on this. Move the `certificate_url` update through the Go backend.
- [ ] **P2 — Storage bucket is publicly readable**: Migration 006 enables public read on the certificates bucket. Anyone with a URL can read any certificate. Switch to Supabase signed URLs (short TTL) or RLS-gated reads.
- [ ] **P3 — No Content-Security-Policy header**: `SecureHeaders` middleware is missing CSP. A stored XSS in any text field (work order title, notes) would be unmitigated. Add a strict CSP to the Go middleware and `vercel.json`.

---

## 🚨 Production Blockers (must fix before first paying customer)

### Email
- [x] **Get a Resend API key** — configured and working
- [x] **Set `RESEND_API_KEY` in Railway** — configured
- [ ] **Verify sending domain** — add DNS records in Resend dashboard for your domain
- [ ] **Test certificate email** — approve a calibration, confirm email arrives with PDF attached
- [ ] **Welcome email on signup** — send from `create_account` trigger or signup hook

### PDF Generation in Production
- [x] **Deploy Gotenberg to Railway** — running as a separate Railway service
- [ ] **Verify `GOTENBERG_URL` in Railway** — confirm env var on the API service points to the Gotenberg service URL
- [ ] **Test end-to-end** — approve a cert, click download, confirm PDF generates in production

### Mobile
- [ ] **Test on iOS Safari** — verify sign-in, calibration entry, offline mode
- [ ] **Test on Android Chrome** — verify same
- [ ] **Fix IndexedDB in Safari private mode** — Dexie throws in iOS private browsing; add graceful fallback message

---

## 🔧 Engineering Debt (address within first month)

### Architecture
- [ ] **Finish frontend → backend migration**: Remaining direct Supabase writes — work orders (all), assets delete, standards delete, certificate_url update, calibration_standards_used, profile role update. Each needs a Go handler + frontend wired to `apiRequest()`.
- [ ] **Outbox idempotency for creates**: `POST /calibrations` in the outbox can replay on retry causing duplicates. Use client-generated UUIDs as the record ID so re-POSTing is idempotent (upsert on conflict).
- [ ] **Dexie outbox TTL**: Add a `created_at` field to outbox entries and purge entries older than 30 days in `flushOutbox`. Prevents replaying mutations against a changed schema.
- [ ] **React Query cache invalidation**: Broadening to `['calibrations']` hits all calibration queries. Scope to `['calibrations', 'list', tenantId]` and use `setQueryData` for single-record updates.

### Backend
- [ ] **Go work-orders handler**: Full CRUD matching the calibrations handler pattern — needed for security (role enforcement) and to close the architecture gap.
- [ ] **Database connection pool sizing**: Verify `DATABASE_URL` uses transaction pooler (port 6543) not session pooler. Set explicit pool min/max in `pgxpool.Config` appropriate for Railway container memory.
- [ ] **Chi route ordering comment**: Add a comment in `main.go` explaining that bulk routes must be registered before `{id}` routes — this is a footgun that will bite a future developer.
- [ ] **Deploy health check with retry**: The deploy workflow sleeps 90 seconds then checks `/health` once. Replace with retry-with-backoff (e.g., `curl --retry 5 --retry-delay 20`).

### Testing
- [ ] **Handler coverage gaps**: Stats, audit, and certificates handlers have minimal or no tests. Add at minimum happy-path and error-path tests to lift the backend baseline.
- [ ] **Transaction rollback test**: `calibrations.Create` uses a transaction. Add a test for scan failure triggering rollback using `beginErr`.

### Monitoring
- [ ] **Uptime monitoring** — UptimeRobot (free): ping `/health` every 5 min, alert by email if down
- [ ] **Railway alerts** — set CPU/memory alerts in Railway dashboard

### CI/CD
- [ ] **Branch protection on `main`** — GitHub → Settings → Branches → require CI pass before merge
- [ ] **Dependabot** — enable for npm + Go dependency vulnerability scanning
- [ ] **Staging environment** — duplicate Railway service + Vercel deployment for a staging branch

---

## 🚀 Feature Backlog (ranked by impact)

### Tier 1 — Build these next (core loop + compliance)

- [ ] **Recurring calibration scheduling** — auto-generate work orders from `next_due_at` on assets. Configurable days-ahead window (e.g., 30/60/90 days). 12-month forward calendar view. Without this, Probatus is a recorder not a management system — biggest retention risk.
- [ ] **Calibration recall** — when a master standard is found out-of-tolerance, flag all calibration records that used it and mark them for re-calibration. Required for ISO 17025 / regulated environments. Blocks enterprise sales without it.
- [ ] **Calendar: add work orders + completed calibrations** — the calendar currently shows only due dates. Supervisors need to see scheduled work orders and completed cals in the same view to plan the week.
- [ ] **Navbar cleanup** — too many top-level items for field technicians. Group by role: techs see Work Orders + Calibrations; supervisors/admins see full menu. Collapsible sidebar on desktop.
- [ ] **Notifications on assignment/approval** — alert technician when assigned to a work order; alert supervisor when calibration is submitted for approval. Email via Resend + push via Capacitor (already a dep).

### Tier 2 — Competitive moat

- [ ] **Batch / multi-asset calibration** — calibrate a group of instruments in one session with shared standard equipment. Single form → multiple records. Eliminates the biggest field friction complaint.
- [ ] **Supervisor / technician analytics** — calibrations completed per week per tech, first-pass approval rate, average time per calibration. This is the data that justifies the purchase to a manager.
- [ ] **Customer due-date reminder emails** — weekly email to customer contacts: "3 instruments at Plant A due in 30 days." Drives repeat bookings. Resend + pg_cron or Railway cron.
- [ ] **Client summary report from portal** — all assets calibrated this period, pass/fail summary, aggregate compliance %. What service companies send to clients for contract renewals.
- [ ] **Digital signature capture** — replace text signatures with drawn signatures (SignaturePad component exists). Embed base64 in cert PDF. Required for ISO 17025.
- [ ] **Bulk asset import (CSV)** — drag-and-drop CSV onboarding for customers with 50+ instruments. Removes #1 onboarding friction.
- [ ] **Photo evidence attachment** — attach as-found condition photos to calibration records. Supabase Storage already wired in; mostly a UI feature.
- [ ] **QR label generator** — print calibration sticker (QR, due date, cert #) via AirPrint directly from app.
- [ ] **Adjustment tracking** — structured log of what was done to bring instrument into tolerance. Required by some regulatory frameworks.

### Tier 3 — Enterprise unlock

- [ ] **Measurement uncertainty calculations** — ISO 17025 Clause 7.6 requires uncertainty on every cert. Built-in uncertainty budgets per measurement type. (`uncertainty_pct` column already exists in DB.)
- [ ] **In-app invoice generation** — line items from instruments calibrated. Export PDF or push to QuickBooks.
- [ ] **Stripe billing + freemium tier** — self-serve subscriptions. Free: 3 assets, 5 certs/month. Paid: unlimited.
- [ ] **White-label mode** — customer logo + colours. Premium tier.
- [ ] **ISO 17025 accreditation scope guard** — hard-block out-of-scope calibrations, auto-generate scope table for SCC/A2LA submission.
- [ ] **French language support** — required for federal + Quebec contracts.
- [ ] **CMMS/ERP sync** — work orders in from SAP PM / Maximo. Results back out. Highest enterprise deal value.

---

## 📋 Legal & Compliance (before public launch)

- [ ] **Terms of Service** — add `/terms` page; must cover data ownership, liability, cancellation
- [ ] **Privacy Policy** — add `/privacy` page; required by Apple App Store, GDPR, CASL (Canada)
- [ ] **Data Processing Agreement (DPA)** — template for B2B customers who ask "where is our data stored?"
- [ ] **CASL compliance** — Canadian anti-spam law; ensure marketing emails have unsubscribe link
- [ ] **Supabase backups** — verify Point-in-Time Recovery is enabled in Supabase dashboard

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
- [ ] TestFlight beta for iPhone testing
