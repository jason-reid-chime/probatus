-- ============================================================
-- Measurement Uncertainty (ISO 17025)
-- ============================================================

alter table calibration_measurements
  add column if not exists uncertainty_pct  numeric,
  add column if not exists confidence_level text check (confidence_level in ('95', '99'));

-- Calibration records: store combined expanded uncertainty summary
alter table calibration_records
  add column if not exists combined_uncertainty_pct  numeric,
  add column if not exists coverage_factor            numeric default 2;
