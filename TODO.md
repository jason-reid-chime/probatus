# Probatus — Todo List

## MVP Tasks

- [x] Auth flow + app shell
- [x] Asset registry (frontend)
- [x] Calibration entry forms (frontend)
- [x] Go API — middleware + all route handlers
- [x] Master standards management
- [x] Dashboard
- [x] Digital signatures + approval workflow
- [x] PDF certificate generation
- [x] Wire offline sync end-to-end
- [x] Fly.io deploy config
- [x] Supabase seed data

## Spin-Up

- [ ] Create Supabase cloud project
- [ ] Fill in `frontend/.env.local` and `backend/.env`
- [ ] Run migration: `supabase db push --db-url "..."`
- [ ] Run seed: `psql "..." < supabase/seed.sql`
- [ ] Create 3 test users in Supabase dashboard
- [ ] Wait for Docker to finish installing (downloading in background)
- [ ] `docker run -d --name gotenberg -p 3000:3000 gotenberg/gotenberg:8`
- [ ] `cd backend && go run ./cmd/api`
- [ ] `cd frontend && npm run dev`

## Production Deploy

- [ ] `fly auth login`
- [ ] `fly deploy --config fly.gotenberg.toml`
- [ ] `fly secrets set DATABASE_URL=... SUPABASE_JWT_SECRET=... GOTENBERG_URL=... CORS_ORIGINS=...`
- [ ] `fly deploy --config fly.toml`
- [ ] Deploy frontend to Netlify / Vercel
- [ ] Update Supabase Auth redirect URLs
- [ ] Add `FLY_API_TOKEN` to GitHub secrets for auto-deploy

## Go-to-Market

- [ ] Verify company websites in go-to-market.md
- [ ] Find owner/lab manager names on LinkedIn for each lead
- [ ] Send first 5 outreach emails (Southern Ontario first)
- [ ] Book demo calls

---

## Phase 2 — Game-Changing Features
Ranked by impact × effort. Top = build next.

### Tier 1 — Highest ROI (build these first)

- [x] **#1 — Automated Certificate Email Delivery**
      On approval, auto-email the PDF to the customer contact. Zero extra steps after sign-off.
      Low effort, immediately visible to customers, strongest "wow" moment in a demo.

- [x] **#2 — Calibration Template Library**
      Save instrument-specific test setups (range, tolerance, test points) as reusable templates.
      Techs open a form and just fill numbers. Cuts per-job setup to seconds. High adoption driver.

- [ ] **#3 — Push Notifications for Supervisors**
      "Sarah submitted 3 certs for approval." "7 instruments at City of London are overdue."
      Capacitor + FCM/APNs. Turns passive tool into an active ops system. Short build.

- [ ] **#4 — QR Label Generator**
      Print calibration stickers (QR code, due date, cert #) direct from app via AirPrint.
      Eliminates the separate label printer workflow every shop currently has. Pure delight feature.

- [ ] **#5 — Instrument Health Scoring + Drift Trending**
      Plot error % across calibration history per instrument. Flag "degrading" trend before failure.
      No new data needed — it's all already in calibration_measurements. Just analytics + chart UI.

### Tier 2 — Strong Competitive Moat (build after first customers)

- [x] **#6 — Customer Portal**
      Let City of London log in and self-serve their own certificates and due dates.
      Biggest retention driver — customers will never leave a tool their clients depend on.
      Medium effort (new tenant type + read-only UI).

- [ ] **#7 — Batch Jobs / Job Cards**
      Group all instruments at a site into one Job. Real-time field progress for supervisors.
      Combined job summary report alongside individual certs. Matches how shops actually plan work.

- [ ] **#8 — Photo / Video Evidence Attachment**
      Attach photos of as-found conditions to calibration records.
      Supabase Storage already wired in — this is mostly a UI feature. Huge for warranty claims.

- [ ] **#9 — Accreditation Scope Guard**
      Track ISO/IEC 17025 accreditation scope. Hard-block out-of-scope calibrations.
      Auto-generate scope table for SCC/A2LA submission. Turns compliance from pain into pride.

- [ ] **#10 — Offline Smart Pre-loading**
      Before a tech leaves the office, auto-sync today's job site instruments to local storage.
      Anticipatory offline — no manual step. Dexie + job schedule makes this achievable cleanly.

### Tier 3 — Enterprise Unlock (build when you have 5+ customers)

- [ ] **#11 — White-Label Mode**
      Customers brand the app and portal with their own logo + colours.
      Premium tier pricing. Makes Probatus invisible to their clients. Near-zero marginal cost.

- [ ] **#12 — Regulatory Export Packages**
      One-tap audit bundles for TSSA, Health Canada GMP, EPA.
      Unlocks regulated industries. Justifies subscription renewal every single year.

- [ ] **#13 — NFC Tag Support**
      Replace QR stickers with NFC tap-to-open in harsh industrial environments.
      Native Capacitor NFC API. Pairs with QR Label Generator (#4).

- [ ] **#14 — AI Anomaly Detection**
      Flag suspicious readings before cert submission. Catches fat-finger errors and real failures.
      Train on your own historical data over time. Competitive moat that widens with usage.

- [ ] **#15 — CMMS / ERP Bi-directional Sync**
      Work orders in from SAP PM / Maximo. Calibration results back out.
      Highest enterprise deal value ($500–2000/month). One reference customer opens every door.
      High effort — save for when you have budget to build it right.

---

## Phase 3 — Next 10 Features

- [ ] **One-Click Audit Package Generator** ← building now

---

## Phase 3 — Next 10 Features

- [ ] **#16 — Measurement Uncertainty Calculations**
      ISO 17025 Clause 7.6 requires uncertainty on every cert. Built-in uncertainty budgets per
      measurement type — enter your reference specs, system calculates and prints the statement.
      The compliance gap nobody has solved in a mobile product. Biggest enterprise closer.

- [ ] **#17 — Recurring Calibration Scheduling**
      Auto-generate future work orders from each instrument's calibration interval.
      12-month forward calendar. Assign techs in advance. Turns reactive into proactive ops.

- [ ] **#18 — Self-Serve Customer Instrument Submission**
      Customers submit their own instrument list through the portal — "here's what we need
      calibrated." Calibration company accepts, assets + work order auto-created. Removes the
      back-and-forth email that precedes every job.

- [ ] **#19 — Digital Job Report / Field Visit Summary**
      Job-level PDF (separate from individual certs): all instruments touched, hours, findings,
      recommendations. What the tech hands to the site supervisor before leaving. Currently
      every shop makes this manually in Word.

- [ ] **#20 — Adjustment Tracking**
      Structured log of what was done to bring an instrument into tolerance: "adjusted span pot
      +0.2 mA", "replaced sensing element", "zeroed at reference." Searchable per instrument.
      Required for some regulatory frameworks. Currently buried in notes fields everywhere.

- [ ] **#21 — Time Tracking Per Calibration**
      Tech taps Start / End per job. Time logged against the calibration record. Enables billing
      by time, productivity benchmarking across techs, and accurate future job quoting.

- [ ] **#22 — In-App Invoice Generation**
      After job completion, generate a draft invoice: line items from instruments calibrated,
      cert fees, and logged hours. Export as PDF or push to QuickBooks/FreshBooks. Keeps the
      workflow inside Probatus instead of context-switching to accounting software.

- [ ] **#23 — ISO 17025 Audit Simulation / Gap Analysis**
      Answer questions about your lab processes. System generates a mock audit report against
      ISO/IEC 17025:2017 clauses — green/amber/red per clause, with actionable fixes per gap.
      Positions Probatus as a compliance partner. Premium add-on or lead-gen free tool.

- [ ] **#24 — Stripe Billing + Freemium Tier**
      Automated subscription billing. Free tier: 3 assets, 1 tech, 5 certs/month. Paid unlocks
      everything. Removes the sales call from the bottom of the funnel — small shops self-serve.
      Freemium → paid is the most capital-efficient growth model for a solo founder.

- [ ] **#25 — French Language Support**
      French required for federal government + Quebec municipal contracts. Also unlocks European
      market long-term. react-i18n + translated certificate templates. Not glamorous — but it's
      a contract-winning requirement with zero competition in this space.
