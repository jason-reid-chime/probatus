-- ============================================================
-- Wipe all data rows for Valatix, leaving tenant + profiles
-- intact so existing accounts can still log in.
-- IRREVERSIBLE.
-- ============================================================

do $$
declare
  valatix_id uuid;
begin
  select id into valatix_id from tenants where slug = 'valatix';

  if valatix_id is null then
    raise exception 'Valatix tenant not found';
  end if;

  delete from audit_log                where tenant_id = valatix_id;
  delete from calibration_standards_used
    where record_id in (
      select id from calibration_records where tenant_id = valatix_id
    );
  delete from calibration_measurements
    where record_id in (
      select id from calibration_records where tenant_id = valatix_id
    );
  delete from calibration_records      where tenant_id = valatix_id;
  delete from calibration_templates    where tenant_id = valatix_id;
  delete from master_standards         where tenant_id = valatix_id;
  delete from assets                   where tenant_id = valatix_id;
  update profiles set customer_id = null where tenant_id = valatix_id;
  delete from customers                where tenant_id = valatix_id;

  raise notice 'Valatix data wiped. Tenant and profiles preserved.';
end $$;
