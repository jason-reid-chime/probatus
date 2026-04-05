-- ============================================================
-- Migration 002: Customer Portal
-- Adds 'customer' role support so customers can log in and
-- view calibration history for their own equipment.
-- ============================================================

-- Add customer role to the enum
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'customer';

-- Link customer-role users to a specific customer company
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id);

-- ============================================================
-- RLS: Restrict calibration_records for customer users
-- Staff see all records in their tenant.
-- Customers see only records for assets linked to their company.
-- ============================================================
DROP POLICY IF EXISTS "tenant_isolation" ON calibration_records;
CREATE POLICY "tenant_isolation" ON calibration_records
  FOR ALL USING (
    tenant_id = current_tenant_id()
    AND (
      -- Non-customer roles see all records in their tenant
      NOT EXISTS (
        SELECT 1 FROM profiles
        WHERE id = auth.uid()
          AND roles @> ARRAY['customer']::user_role[]
      )
      OR
      -- Customer role: only records for their company's assets
      asset_id IN (
        SELECT a.id FROM assets a
        JOIN profiles p ON p.id = auth.uid()
        WHERE a.customer_id = p.customer_id
          AND a.tenant_id = current_tenant_id()
      )
    )
  );

-- ============================================================
-- RLS: Restrict assets for customer users
-- ============================================================
DROP POLICY IF EXISTS "tenant_isolation" ON assets;
CREATE POLICY "tenant_isolation" ON assets
  FOR ALL USING (
    tenant_id = current_tenant_id()
    AND (
      NOT EXISTS (
        SELECT 1 FROM profiles
        WHERE id = auth.uid()
          AND roles @> ARRAY['customer']::user_role[]
      )
      OR
      customer_id = (SELECT customer_id FROM profiles WHERE id = auth.uid())
    )
  );
