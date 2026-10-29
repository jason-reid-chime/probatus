-- ============================================================
-- Backflow Test Kit instrument type + calibration template
--
-- Modelled on a CalTec certificate for a Zurn TG-5 (procedure CP.13):
--   * Differential pressure gauge, unit PSID, 12-month cycle
--   * Tested DESCENDING: 14, 12, 10, 8, 6, 4, 2, 0 PSID
--   * Spec ±0.2 PSID absolute (min/max = nominal ∓ 0.2; 0 PSID is 0/0)
--   * The UUT is set to each nominal point and the reference standard
--     ("Actual Pressure") is read, As Found and As Left.
--
-- Point JSON: {label, standard_value, unit, tolerance_abs}.
--   tolerance_abs is an absolute ± band in the point's unit. It lives in
--   the existing points jsonb, so no column change is needed; the
--   frontend backflow sheet reads it (falling back to 0.2 when absent).
--   calibration_templates.tolerance_pct is not used by this sheet.
--
-- Idempotent: safe to run more than once.
-- ============================================================

-- 1. Instrument type. (Not used elsewhere in this migration, so it is safe
--    inside the migration transaction on PG12+.)
alter type instrument_type add value if not exists 'backflow_test_kit';

-- 2. Seeder for one tenant. Skips tenants that already have the template.
create or replace function seed_backflow_test_kit_template(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into calibration_templates (tenant_id, name, description, instrument_type, tolerance_pct, points)
  select
    p_tenant,
    'Backflow Test Kit (±0.2 PSID)',
    'Differential backflow test kit (e.g. Zurn TG-5). Descending 14 → 0 PSID, '
      || '±0.2 PSID absolute per point (0 PSID must read 0). Set the UUT to each '
      || 'nominal and record the reference standard As Found / As Left. '
      || '12-month cycle. Procedure CP.13.',
    'backflow_test_kit',
    1.0,
    '[
      {"label": "14.0 PSID", "standard_value": 14.0, "unit": "PSID", "tolerance_abs": 0.2},
      {"label": "12.0 PSID", "standard_value": 12.0, "unit": "PSID", "tolerance_abs": 0.2},
      {"label": "10.0 PSID", "standard_value": 10.0, "unit": "PSID", "tolerance_abs": 0.2},
      {"label": "8.0 PSID",  "standard_value": 8.0,  "unit": "PSID", "tolerance_abs": 0.2},
      {"label": "6.0 PSID",  "standard_value": 6.0,  "unit": "PSID", "tolerance_abs": 0.2},
      {"label": "4.0 PSID",  "standard_value": 4.0,  "unit": "PSID", "tolerance_abs": 0.2},
      {"label": "2.0 PSID",  "standard_value": 2.0,  "unit": "PSID", "tolerance_abs": 0.2},
      {"label": "0 PSID",    "standard_value": 0,    "unit": "PSID", "tolerance_abs": 0}
    ]'::jsonb
  where not exists (
    select 1 from calibration_templates
    where tenant_id = p_tenant
      and instrument_type = 'backflow_test_kit'
      and name = 'Backflow Test Kit (±0.2 PSID)'
  );
end;
$$;

-- Security definer + tenant id argument: keep it off the PostgREST RPC surface.
revoke all on function seed_backflow_test_kit_template(uuid) from public;
do $$ begin
  revoke all on function seed_backflow_test_kit_template(uuid) from anon, authenticated;
exception when undefined_object then null;
end $$;

-- 3. Seed every existing tenant.
do $$
declare
  t record;
begin
  for t in select id from tenants loop
    perform seed_backflow_test_kit_template(t.id);
  end loop;
end $$;

-- 4. Seed tenants created from now on.
create or replace function seed_backflow_test_kit_template_on_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform seed_backflow_test_kit_template(new.id);
  return null;
end;
$$;

drop trigger if exists seed_backflow_test_kit_template on tenants;
create trigger seed_backflow_test_kit_template
  after insert on tenants
  for each row execute function seed_backflow_test_kit_template_on_tenant();
