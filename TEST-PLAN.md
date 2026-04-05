# Probatus — Test Plan

**Environment:** Local dev (`npm run dev` + `go run ./cmd/api`)  
**Test account:** reidjay44@gmail.com  
**Base URL:** http://localhost:5173

---

## 1. Authentication

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1.1 | Sign in | Enter email + password, click Sign in | Redirected to Dashboard |
| 1.2 | Invalid credentials | Enter wrong password | Error message shown, no redirect |
| 1.3 | Sign up — new account | Click Sign up, fill name/company/email/password | Account created, confirmation shown |
| 1.4 | Sign out | Click Sign out in sidebar | Redirected to /login |
| 1.5 | Protected route | Visit `/assets` while logged out | Redirected to /login |

---

## 2. Dashboard

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 2.1 | Stats load | Sign in, view dashboard | Asset count, calibration counts, overdue count visible |
| 2.2 | Overdue badge | View dashboard | SHD-PRES-003 (or similar) shows as overdue |
| 2.3 | Due soon | View dashboard | Assets due within 30 days highlighted |

---

## 3. Asset Registry

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 3.1 | List assets | Click Assets in sidebar | All seeded assets visible (SHD-PRES-001, SHD-TEMP-001, etc.) |
| 3.2 | Create asset | Click + New Asset, fill form, submit | Asset appears in list |
| 3.3 | View asset detail | Click any asset | Tag ID, serial, customer, calibration history shown |
| 3.4 | Edit asset | Open asset → Edit | Changes saved and reflected |
| 3.5 | Delete asset | Open asset → Delete | Asset removed from list |
| 3.6 | Customer filter | Filter by customer | Only that customer's assets shown |

---

## 4. Calibration Records

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 4.1 | List calibrations | Click Calibrations | All records listed with status badges |
| 4.2 | Create calibration | Open asset → New Calibration, add measurements, submit | Record created with status `in_progress` |
| 4.3 | Add measurement rows | During calibration entry, add multiple test points | Each row saves point label, standard value, measured value, unit, pass/fail |
| 4.4 | Submit for approval | Complete calibration, click Submit for Approval | Status changes to `pending_approval` |
| 4.5 | Approve calibration (supervisor/admin) | Open pending record, click Approve | Status changes to `approved`, approved_at timestamp set |
| 4.6 | Technician cannot approve | Log in as technician role | Approve button not visible |
| 4.7 | View calibration detail | Click any record | Measurements table, standards used, signatures shown |

---

## 5. PDF Certificate Generation

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 5.1 | Generate certificate | Open approved calibration → Generate Certificate | PDF downloads (requires Gotenberg running) |
| 5.2 | Certificate content | Open downloaded PDF | Shows instrument details, measurements table, pass/fail, signatures |
| 5.3 | Pending record | Try generating cert on pending record | Button not available or returns error |

> **Note:** Gotenberg must be running (`docker run -d --name gotenberg -p 3000:3000 gotenberg/gotenberg:8`). Skip 5.x until Docker is installed.

---

## 6. Master Standards

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 6.1 | List standards | Click Standards (supervisor/admin only) | All 4 Fluke standards visible |
| 6.2 | Expiry badge | View standards list | Fluke 87V (due 2026-03-01) shows as expired/due soon |
| 6.3 | Create standard | Click + New Standard, fill form | Standard appears in list |
| 6.4 | Edit standard | Open standard → Edit | Changes saved |
| 6.5 | Technician access | Log in as technician | Standards not in sidebar |

---

## 7. Calibration Templates

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 7.1 | List templates | Click Templates | Template list loads |
| 7.2 | Create template | Click + New Template, add test points (label, standard value, tolerance) | Template saved |
| 7.3 | Use template | New calibration → select template | Test points pre-populated |
| 7.4 | Edit template | Open template → Edit | Changes saved |
| 7.5 | Delete template | Delete template | Removed from list |

---

## 8. Audit Package Generator

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 8.1 | Access (admin/supervisor) | Click Audit Package in sidebar | Page loads with date range form |
| 8.2 | Technician blocked | Log in as technician, visit /audit | Redirected to / |
| 8.3 | Generate — all customers | Set date range, leave customer blank, click Generate | PDF downloads (requires Gotenberg) |
| 8.4 | Generate — single customer | Select City of London, click Generate | PDF scoped to that customer only |
| 8.5 | Date validation | Set end date before start date | Validation error shown |
| 8.6 | PDF content | Open downloaded PDF | Executive summary, standards traceability, calibration records, asset register all present |

> **Note:** Requires Gotenberg running. Skip until Docker installed.

---

## 9. Role-Based Access Control

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 9.1 | Admin sees all nav items | Sign in as admin | Dashboard, Assets, Calibrations, Standards, Templates, Audit Package all visible |
| 9.2 | Technician nav | Sign in as technician role | Standards, Templates, Audit Package not in sidebar |
| 9.3 | Supervisor nav | Sign in as supervisor role | All items visible except restricted admin features |
| 9.4 | Tenant isolation | Create second tenant/account | Cannot see first tenant's assets or records |

---

## 10. Offline Sync

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 10.1 | Read while offline | Load app, go offline (DevTools → Network → Offline), navigate | Cached data still visible via Dexie |
| 10.2 | Create while offline | Go offline, create a calibration record | Record saved to IndexedDB outbox |
| 10.3 | Sync on reconnect | Go back online | Outbox flushes, record appears in Supabase |

---

## 11. Customer Portal

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 11.1 | Portal login | Create user with `customer` role in DB, sign in | Redirected to /portal |
| 11.2 | Portal dashboard | View portal | Only that customer's assets and certificates visible |
| 11.3 | No write access | Attempt to create/edit via portal | No create buttons exposed |

---

## Known Limitations (Local Dev)

- PDF generation (certificates + audit package) requires Docker + Gotenberg
- Email delivery on cert approval requires a Resend API key
- Offline sync requires the service worker to be registered (works in production build; may not in `npm run dev`)
