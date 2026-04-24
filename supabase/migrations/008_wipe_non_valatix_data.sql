-- ============================================================
-- Create Valatix tenant and reassign all existing data to it.
-- Then delete all old tenants.
--
-- Run this in the Supabase SQL editor or via db push.
-- IRREVERSIBLE — back up first if needed.
-- ============================================================

do $$
declare
  valatix_id uuid;
begin
  -- Create the Valatix tenant if it doesn't already exist
  insert into tenants (name, slug)
  values ('Valatix Inc', 'valatix')
  on conflict (slug) do nothing;

  select id into valatix_id from tenants where slug = 'valatix';

  raise notice 'Valatix tenant id: %', valatix_id;

  -- Reassign all existing profiles to Valatix and promote to admin
  update profiles set tenant_id = valatix_id;

  -- Reassign all tenant-scoped data to Valatix
  update audit_log              set tenant_id = valatix_id;
  update calibration_records    set tenant_id = valatix_id;
  update calibration_templates  set tenant_id = valatix_id;
  update master_standards       set tenant_id = valatix_id;
  update assets                 set tenant_id = valatix_id;
  update customers              set tenant_id = valatix_id;

  -- Delete old tenants (leaves only Valatix)
  delete from tenants where id <> valatix_id;

  raise notice 'Done — all data now belongs to Valatix Inc.';
end $$;
