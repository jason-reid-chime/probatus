-- Add recall fields to calibration_records
ALTER TABLE calibration_records
  ADD COLUMN IF NOT EXISTS recalled_at timestamptz,
  ADD COLUMN IF NOT EXISTS recall_reason text;

-- Index for querying recalled records
CREATE INDEX IF NOT EXISTS idx_calibration_records_recalled_at
  ON calibration_records (tenant_id, recalled_at)
  WHERE recalled_at IS NOT NULL;
