-- ============================================================
-- Migration 005: Performance indexes
-- Adds indexes that will cause full-table scans at scale.
-- ============================================================

-- RLS policies and joins query profiles by tenant_id frequently
CREATE INDEX IF NOT EXISTS profiles_tenant_id_idx ON profiles (tenant_id);

-- Audit log range queries (date filtering, tenant scoping)
CREATE INDEX IF NOT EXISTS audit_log_tenant_created_idx ON audit_log (tenant_id, created_at DESC);

-- Calibration records are frequently queried by status for approval workflows
CREATE INDEX IF NOT EXISTS calibration_records_tenant_status_idx ON calibration_records (tenant_id, status);

-- Assets are queried by customer_id in RLS policies
CREATE INDEX IF NOT EXISTS assets_customer_id_idx ON assets (customer_id) WHERE customer_id IS NOT NULL;
