-- As-Found values for calibration measurements
alter table calibration_measurements
  add column if not exists as_found_value numeric;

-- Rejection reason for the reject workflow
alter table calibration_records
  add column if not exists rejection_reason text;
