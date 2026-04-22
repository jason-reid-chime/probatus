-- ============================================================
-- Calibration Templates
-- Reusable measurement point sets per instrument type
-- ============================================================

create table calibration_templates (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  name            text not null,
  description     text,
  instrument_type text not null,
  tolerance_pct   numeric not null default 1.0,
  points          jsonb not null default '[]',
  created_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

alter table calibration_templates enable row level security;

create policy "tenant_isolation" on calibration_templates
  for all using (tenant_id = current_tenant_id());

create index on calibration_templates (tenant_id, instrument_type);
