-- ============================================================
-- Pressure Gauge calibration template (BS EN 837-1)
--
-- Modelled on a CALTROLS certificate for a WIKA 0–100 psi glycerin-filled
-- gauge (½" MNPT, 6" dial), accuracy ±1% FS:
--   * 6 points at 0, 20, 40, 60, 80, 100% of range
--   * each point tested RISING then FALLING; the reference test gauge is
--     read with the UUT set to the nominal, As Found and As Left
--   * deviation = reference − instrument; max |deviation| as % of span
--     must be ≤ the accuracy class (calibration_templates.tolerance_pct)
--
-- Uses the existing 'pressure' instrument type, so no enum change.
--
-- Point JSON: {label, standard_value, unit}. unit "%" means standard_value is
--   a percentage of the asset's range, so one template fits any gauge range;
--   the frontend pressure gauge sheet converts it to a nominal (and emits a
--   rising and a falling row per point). Points with any other unit are read
--   as absolute nominals.
--
-- The sheet builds the same 6 points from the asset range without a template;
-- this template is a convenience that also sets the accuracy class.
--
-- Idempotent: safe to run more than once.
-- ============================================================

-- 1. Seeder for one tenant. Skips tenants that already have the template.
create or replace function seed_pressure_gauge_template(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into calibration_templates (tenant_id, name, description, instrument_type, tolerance_pct, points)
  select
    p_tenant,
    'Pressure Gauge (±1% FS, rising/falling)',
    'Bourdon pressure gauge per BS EN 837-1. 0, 20, 40, 60, 80, 100% of range, '
      || 'each tested rising then falling against a reference test gauge, '
      || 'As Found and As Left. Deviation = reference − instrument; max error '
      || 'as % FS must be within ±1% FS.',
    'pressure',
    1.0,
    '[
      {"label": "0%",   "standard_value": 0,   "unit": "%"},
      {"label": "20%",  "standard_value": 20,  "unit": "%"},
      {"label": "40%",  "standard_value": 40,  "unit": "%"},
      {"label": "60%",  "standard_value": 60,  "unit": "%"},
      {"label": "80%",  "standard_value": 80,  "unit": "%"},
      {"label": "100%", "standard_value": 100, "unit": "%"}
    ]'::jsonb
  where not exists (
    select 1 from calibration_templates
    where tenant_id = p_tenant
      and instrument_type = 'pressure'
      and name = 'Pressure Gauge (±1% FS, rising/falling)'
  );
end;
$$;

-- Security definer + tenant id argument: keep it off the PostgREST RPC surface.
revoke all on function seed_pressure_gauge_template(uuid) from public;
do $$ begin
  revoke all on function seed_pressure_gauge_template(uuid) from anon, authenticated;
exception when undefined_object then null;
end $$;

-- 2. Seed every existing tenant.
do $$
declare
  t record;
begin
  for t in select id from tenants loop
    perform seed_pressure_gauge_template(t.id);
  end loop;
end $$;

-- 3. Seed tenants created from now on.
create or replace function seed_pressure_gauge_template_on_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform seed_pressure_gauge_template(new.id);
  return null;
end;
$$;

drop trigger if exists seed_pressure_gauge_template on tenants;
create trigger seed_pressure_gauge_template
  after insert on tenants
  for each row execute function seed_pressure_gauge_template_on_tenant();
