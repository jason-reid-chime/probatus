# Probatus — Beta Test Plan

**Version:** April 2026  
**App URL:** https://probatus.vercel.app  
**Backend:** https://probatus-api-production.up.railway.app

---

## Credentials

| Role | Email | Password | Notes |
|------|-------|----------|-------|
| Admin | jasonxreid@gmail.com | *(your password)* | Full access — all features |
| Customer Portal | portal@sheridanautomation.com | Demo1234! | Read-only, Probatus Inc assets only |

---

## Pre-Flight Checks

1. Open the app on your phone and on a desktop browser at the same time.
2. Sign in as admin. Confirm the dashboard loads with stat cards and a calibration list.
3. If a loading spinner never resolves, reload once. If it persists, note it as a bug.

---

## 1. Authentication

### 1.1 Admin Sign In
- Go to the app URL.
- Sign in as `jasonxreid@gmail.com`.
- **Expected:** Lands on the Dashboard.

### 1.2 Customer Portal Sign In
- Sign out of the admin account.
- Sign in as `portal@sheridanautomation.com` / `Demo1234!`
- **Expected:** Lands on the Customer Portal — different layout (top bar only, no sidebar). Company name "Probatus Inc" shown in header.
- Sign out and sign back in as admin to continue.

---

## 2. Dashboard

- **Expected:** Summary cards showing total assets, overdue count, due-soon count, and recent calibrations.
- Verify numbers look reasonable (should have 4 assets, 1 approved calibration, 1 pending, 1 in progress).
- Check that nothing is showing zero when it should have data.

---

## 3. Assets

### 3.1 View Asset List
- Navigate to **Assets** in the sidebar.
- **Expected:** At least 4 instruments:
  - `SA-PT-001` — Zurn Wilkins TG-5 (pressure) — Probatus Inc
  - `SA-TT-014` — Rosemount 644 (temperature) — Probatus Inc
  - `SA-FT-007` — Endress+Hauser Promag 50 (level) — Probatus Inc
  - `ABC-PT-003` — Honeywell STD820 (pressure) — ABC Manufacturing

### 3.2 Asset Detail
- Open **SA-PT-001**.
- **Expected:** Shows manufacturer (Zurn Wilkins), model (TG-5), serial (04250384), location (Mechanical Room B), range (0–15 PSID), calibration interval (365 days), and a calibration record with status **Approved**.

### 3.3 Create a New Asset
- Tap **+ New Asset**.
- Fill in:
  - Tag ID: `TEST-PT-099`
  - Customer: ABC Manufacturing
  - Manufacturer: Fluke
  - Model: 700G05
  - Serial: `SN-TEST-001`
  - Type: Pressure
  - Range: 0 – 200 PSI
  - Location: Test Bench
  - Interval: 365 days
- Save.
- **Expected:** Asset appears in the list. Tap it to confirm all fields saved correctly.

### 3.4 Edit an Asset
- Open `TEST-PT-099` → Edit.
- Change Location to `Main Lab`.
- Save.
- **Expected:** Location updates immediately in the detail view.

---

## 4. Calibration Workflow

This is the core feature. Walk through the full lifecycle.

### 4.1 Start a New Calibration
- Open asset `TEST-PT-099` and tap **New Calibration**.
- Fill in:
  - Sales #: `SO-TEST-01`
  - Flag #: `FLAG-TEST-01`
- Select a standard (e.g., Fluke 718 Pressure Calibrator).
- **Expected:** Opens the calibration entry form. Status shown as `In Progress`.

### 4.2 Enter Measurements
- Add measurement points. Enter values that would pass (small error %):
  - 0% → standard: 0, measured: 0
  - 25% → standard: 50, measured: 50.1
  - 50% → standard: 100, measured: 100.2
  - 75% → standard: 150, measured: 150.1
  - 100% → standard: 200, measured: 200.2
- **Expected:** Error % calculates automatically. All rows show green / PASS.
- Try entering one bad value (e.g., measured: 195 at the 100% point) to verify it turns red / FAIL.
- Correct it back to passing and continue.

### 4.3 Submit for Approval
- On the calibration detail screen, tap **Submit for Approval**.
- **Expected:** Status changes from `In Progress` to `Pending Approval` immediately — no page reload.

### 4.4 Approve a Calibration
- Open calibration record **CAL-2026-0002** (SA-TT-014, temperature) — status: Pending Approval.
- Tap **Approve Calibration**.
- **Expected:** Status changes to `Approved` instantly. Approve button disappears.

### 4.5 Continue an In-Progress Calibration
- Open **CAL-2026-0003** (SA-FT-007, in progress — only 2 of 5 points entered).
- Tap **Continue Calibration**.
- **Expected:** Returns to the calibration form with existing measurements pre-filled. Add the remaining points and save.

### 4.6 Download a Certificate PDF
- Open **CAL-2026-0001** (SA-PT-001, Approved).
- Tap **Download Certificate (PDF)**.
- **Expected:** A PDF downloads within a few seconds. Open it and verify:
  - Header shows **Apex Calibration Services** (your company)
  - Customer info shows **Probatus Inc**
  - Device info: Tag SA-PT-001, Zurn Wilkins TG-5, serial 04250384, range 0–15 PSID
  - Calibration results table with all 5 points and Pass/Fail for each
  - Standards table showing the Fluke 718 with its cert reference
  - Technician name and calibration date at the bottom
  - Recalibration date (1 year after calibration date)
- Note any missing or incorrect fields.

> **Note:** Certificate generation requires the Railway backend to be running. If it fails, the backend may be cold-starting — wait 30 seconds and try again.

---

## 5. Master Standards

- Navigate to **Standards** in the sidebar.
- **Expected:** 3 Fluke calibrators listed:
  - Fluke 718 Pressure Calibrator (cert: FLAG-6801)
  - Fluke 724 Temperature Calibrator (cert: FLAG-6802)
  - Fluke 789 ProcessMeter (cert: FLAG-6803)
  - All should show as current (green), not expired.
- Tap **+ New Standard** and fill in a test entry. Save and verify it appears.
- Edit it, change the calibration date, and save.
- Delete it and verify it's removed.

---

## 6. Templates

- Navigate to **Templates** in the sidebar.
- Tap **+ New Template**.
- Give it a name (e.g., "Pressure 5-Point") and add test points:
  - 0%, 25%, 50%, 75%, 100% with tolerance % for each.
- Save.
- Go to an asset → New Calibration → select your template.
- **Expected:** The measurement rows are pre-populated with the point labels and standard values from the template.

---

## 7. Customer Portal

### 7.1 Customer View (Portal Login)
- Sign out of admin.
- Sign in as `portal@sheridanautomation.com` / `Demo1234!`
- **Expected:** Portal dashboard loads with Probatus Inc assets only (3 assets: SA-PT-001, SA-TT-014, SA-FT-007). The ABC Manufacturing asset should NOT be visible.
- Check the summary cards (Total, Overdue, Due Within 90 Days, All Current).

### 7.2 Asset Detail in Portal
- Tap any asset in the portal list.
- **Expected:** Shows asset info and calibration history. No edit buttons, no "New Calibration" button — read-only view.
- Approved records should show a way to view or download their certificate.

### 7.3 Admin Portal Preview
- Sign out and sign back in as admin.
- Navigate to `/portal` in the address bar.
- **Expected:** Portal view loads for admin (showing all assets). This lets you see what the customer sees.

---

## 8. Audit Package

- Navigate to **Audit** in the sidebar.
- Set a date range covering the past 30 days.
- Leave customer blank (all customers) and click **Generate Audit Package**.
- **Expected:** A file downloads (ZIP or PDF) containing certificates for approved calibrations in that range.
- Try again with a specific customer selected (Probatus Inc) — should include only that customer's records.
- Try an empty date range or a range with no approved calibrations — should show a helpful message rather than crash.

> **Note:** Requires Railway backend to be running.

---

## 9. Offline Mode

- On your phone, open the app and navigate to the Assets and Calibrations lists so data is cached.
- Turn on **Airplane Mode**.
- Navigate around — asset list and calibration details should still load.
- Open an in-progress calibration and enter a measurement. Save it.
- **Expected:** Saves locally. A "Saved locally · Syncing…" indicator appears on the calibration detail screen.
- Turn Airplane Mode off.
- **Expected:** Indicator disappears. Data syncs to the server (verify by checking the record on a different device or browser).

---

## 10. Mobile Usability

Do a general pass on your phone:

- [ ] All buttons are easy to tap — nothing too small or too close together
- [ ] Text doesn't overflow or get cut off on narrow screens
- [ ] Forms are easy to fill in with the on-screen keyboard (inputs don't get hidden behind the keyboard)
- [ ] The sidebar opens and closes smoothly
- [ ] Most screens load within 2 seconds
- [ ] The app works in both portrait and landscape orientation

---

## Bug Reporting

For each issue found, note:

1. **Feature** — which screen or action?
2. **Steps to reproduce** — what exactly did you do?
3. **Expected** — what should have happened?
4. **Actual** — what happened instead?
5. **Screenshot** — if possible

Send to: reidjay44@gmail.com

---

## Known Limitations (Beta)

- PDF certificate generation and audit packages require the backend server (Railway) — it may take 20–30 seconds to wake up if it's been idle.
- Email delivery of certificates is not yet active.
- QR code scanning requires camera permission to be granted on the device.
- Offline sync works best on mobile Chrome. Safari has IndexedDB restrictions in private browsing mode.
