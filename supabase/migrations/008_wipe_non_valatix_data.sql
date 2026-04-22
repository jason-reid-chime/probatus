-- ============================================================
-- Wipe all tenant data that does NOT belong to Valatix.
--
-- Run this in the Supabase SQL editor.
-- REVIEW before executing — this is irreversible.
--
-- How it works:
--   1. Find the Valatix tenant ID.
--   2. Delete all rows in tenant-scoped tables where tenant_id != valatix_id.
--   3. Delete the non-Valatix tenant rows themselves.
-- ============================================================

do $$
declare
  valatix_id uuid;
begin
  -- Resolve Valatix tenant (adjust the name if it differs in your DB)
  select id into valatix_id
  from tenants
  where lower(name) like '%valatix%'
  limit 1;

  if valatix_id is null then
    raise exception 'Valatix tenant not found — aborting wipe.';
  end if;

  raise notice 'Keeping tenant: % (%)', 'Valatix', valatix_id;

  -- Delete child records before parents (FK order)
  delete from audit_log                  where tenant_id <> valatix_id;
  delete from calibration_standards_used
    where record_id in (
      select id from calibration_records where tenant_id <> valatix_id
    );
  delete from calibration_measurements
    where record_id in (
      select id from calibration_records where tenant_id <> valatix_id
    );
  delete from calibration_records        where tenant_id <> valatix_id;
  delete from calibration_templates      where tenant_id <> valatix_id;
  delete from master_standards           where tenant_id <> valatix_id;
  delete from assets                     where tenant_id <> valatix_id;
  delete from customers                  where tenant_id <> valatix_id;
  delete from profiles                   where tenant_id <> valatix_id;
  delete from tenants                    where id <> valatix_id;

  raise notice 'Wipe complete. Only Valatix data remains.';
end $$;
