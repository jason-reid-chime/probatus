# Probatus — Session Context
*Paste this at the start of a new Claude session to resume where we left off.*

---

## Who I am
Jason Reid — calibration technician at Sheridan Automation (London + Mississauga, Ontario). I perform field calibrations and my name/signature appears on our certificates. I'm building Probatus to replace our paper + MS Access workflow and potentially sell it as a SaaS to other calibration companies.

## What we're building
**Probatus** — a multi-tenant, offline-first digital calibration management SaaS platform. Named after the Latin word for "tested and proven." I have a strong interest in ancient Greek and Roman themes.

## Files
All in `/Users/jasonreid/Projects/Probatus/`:
- `calibration-system-onepager.md` — full product one-pager with features and user stories
- `Calibration Certificate.pdf` — real Sheridan Automation certificate (the PDF output target)
- `Digital Calibration Management System.docx` — original spec

## Confirmed tech stack
| Layer | Choice |
|-------|--------|
| Frontend | React + TypeScript + Capacitor (web + iOS + Android) |
| Backend | Go |
| Database | PostgreSQL via Supabase |
| Auth | Supabase Auth (email/password) |
| File storage | Supabase Storage |
| Offline sync | Dexie.js + Outbox Pattern |
| PDF generation | Gotenberg (<3 seconds target) |
| Hosting | Supabase free tier + Fly.io (~$0–25/mo) |

## Key decisions made
- **Multi-tenant:** shared Postgres DB + Row Level Security per tenant
- **Offline sync (P0):** one cert = one tech for MVP, no concurrent conflicts, outbox pattern
- **QR/barcode scanning:** must-have for v1
- **PDF format:** must match Sheridan Automation certificate exactly (ISO/IEC 17025)
- **No data migration** from Access in v1
- **Sales # and Flag #** are optional free-text fields for now
- **Device type:** TBD — Capacitor covers all scenarios

## Out of scope for v1
- MS Access data migration
- Multi-tech concurrent calibration on same job
- ERP integration
- CRDT conflict resolution

## Future goal (explicitly noted — do not lose this)
Google Docs-like conflict resolution using **Yjs + Hocuspocus** for multi-tech assignments. Divergent measurements preserved and surfaced to supervisor as a review task. Requires a small Node.js Hocuspocus sidecar. Zero conflict dialogs in normal operation.

## Where we left off
Finished the one-pager. Ready to start building. Next step is scaffolding the project.
