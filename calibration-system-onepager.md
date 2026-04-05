# Digital Calibration Management System
### Product One-Pager — v0.1

---

## The Problem

Calibration technicians in the field rely on paper certificates, manual calculations, and Access databases that don't travel with them. Records get lost. Errors go undetected until audit. Compliance depends on a filing cabinet.

There's no system that works offline in a dead zone, validates against live equipment standards, and outputs a traceable certificate in seconds.

---

## What We're Building

A **multi-tenant, offline-first calibration management platform** for industrial calibration companies and their customers. Technicians record calibration data in the field — with or without a signal — and the system handles pass/fail logic, traceability, digital signatures, and certificate generation automatically.

Built for tablets and phones in the field. Built for dashboards on the desk. One codebase, every device.

---

## Key Features

### 1. Asset Registry
A centralized database of every instrument under calibration management. Each asset carries its Tag ID, serial number, make/model, measurement range, and calibration interval. The system auto-calculates next due dates and tracks status across the full fleet.

### 2. Smart Calibration Entry
Data entry templates adapt to the instrument type:

| Instrument | Template |
|------------|----------|
| Pressure | Multi-point check — Standards vs As Found vs As Left |
| Temperature | Reference °C vs Measured °C |
| pH / Conductivity | Readings + Buffer Lot Numbers + Expiry Dates |
| Level / 4-20mA | 5-point check (0/25/50/75/100%) Input vs Output |

Pass/fail status and error percentage calculate instantly on entry — no manual math, no end-of-day surprises.

### 3. Offline-First Sync (P0)
The app works in full dead zones. All data is written to local storage first (Dexie.js / IndexedDB), queued in an outbox, and synced to the server when connectivity returns. One technician owns one calibration job — no concurrent edit conflicts. Sync is silent and automatic.

### 4. QR / Barcode Scanning
Technicians scan the sticker on any physical instrument to instantly pull up its asset record and open the calibration form. Eliminates search, eliminates typos, speeds up multi-instrument jobs.

### 5. Master Standards Management
Every calibration references the test equipment used (e.g. Fluke 743B, Fluke 700P06). The system tracks each master tool's calibration status. **A calibration cannot be saved if the tool used is past its own expiry date.** Hard gate — no exceptions.

### 6. Compliance & Traceability
- **Audit trail:** Every field change is logged — user, timestamp, old value, new value
- **Immutable records:** Once approved, a record cannot be edited — only annotated
- **Digital signatures:** Technician signs on completion, Supervisor signs on approval
- **NRC / NIST traceability statement** included on every certificate (ISO/IEC 17025)

### 7. PDF Certificate Generation
One-tap generation of a formal calibration certificate matching company format. Outputs in under 3 seconds. Includes all instrument data, calibration results table, test equipment used, technician signature, and recalibration date. Stored automatically against the record.

### 8. Dashboard
Status at a glance for supervisors and admins:
- Instruments overdue for calibration
- Instruments due within 90 days
- Pass / fail rates by department or customer
- Master tools approaching expiry

### 9. Role-Based Access

| Role | Permissions |
|------|------------|
| **Technician** | View assets, perform and edit own calibrations |
| **Supervisor** | Approve records, manage master tools, edit asset details |
| **Admin / Auditor** | Read-only access to all data, reports, and audit trail |

### 10. Multi-Tenant Architecture
Each company is an isolated tenant. Data is separated at the database level via Row Level Security — one tenant cannot see another's data. Customers (e.g. City of London) belong to a tenant (e.g. Sheridan Automation), not the platform.

---

## User Stories

**As a Technician,**
> I want to scan a QR code on an instrument and have the calibration form open automatically, so I can start recording without searching or typing.

**As a Technician,**
> I want to record calibration readings in an area with no cell signal and have them sync automatically when I'm back online, so I never lose work or delay a job because of connectivity.

**As a Technician,**
> I want the app to tell me immediately if a reading passes or fails tolerance, so I know on the spot whether an adjustment is needed.

**As a Technician,**
> I want to be blocked from saving a calibration if my test equipment is past its calibration date, so I never unknowingly produce a non-traceable certificate.

**As a Supervisor,**
> I want to review and digitally approve a calibration record from my tablet, so I can sign off in the field without printing anything.

**As a Supervisor,**
> I want a dashboard that shows me every overdue instrument and everything coming due in the next 90 days, so I can schedule jobs proactively.

**As a Supervisor,**
> I want the system to automatically generate a formatted PDF certificate the moment I approve a record, so it's ready to send to the customer without any manual work.

**As an Admin / Auditor,**
> I want a complete, tamper-proof audit trail of every change made to every record, so I can demonstrate compliance during an external audit.

**As a Customer (City of London),**
> I want to receive a formal calibration certificate with full traceability information, so I can verify my instruments meet regulatory requirements.

---

## Technical Foundation

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript + Capacitor (web, iOS, Android) |
| Backend | Go |
| Database | PostgreSQL via Supabase |
| Auth | Supabase Auth |
| File Storage | Supabase Storage |
| Offline | Dexie.js + Outbox Pattern |
| PDF Generation | Gotenberg |
| Hosting | Supabase (free tier) + Fly.io (free tier) |
| Estimated MVP cost | $0 – $25/mo |

---

## Out of Scope for v1

- Data migration from MS Access
- Multi-tech concurrent calibration (same job, multiple techs)
- ERP / job management system integration (Sales #, Flag # are manual fields)
- Native offline conflict resolution for concurrent edits

---

## Future Goals

- **CRDT-based collaborative sync** — Google Docs-style real-time merging for multi-tech assignments using Yjs + Hocuspocus. Divergent measurements preserved and surfaced to supervisor rather than overwritten. Zero conflict dialogs in normal operation.
- **ERP integration** — Auto-populate Sales # and Flag # from existing job management systems
- **Customer portal** — Tenant customers access and download their own certificates
- **Analytics** — Failure trends, instrument health scoring, predictive maintenance flags
