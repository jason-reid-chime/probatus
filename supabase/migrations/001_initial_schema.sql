-- ============================================================
-- Probatus — Initial Schema
-- Multi-tenant calibration management platform
-- ============================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ============================================================
-- TENANTS
-- ============================================================
create table tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- USERS (extends Supabase auth.users)
-- ============================================================
create type user_role as enum ('technician', 'supervisor', 'admin');

create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  tenant_id   uuid not null references tenants(id),
  full_name   text not null,
  role        user_role not null default 'technician',
  signature   text,           -- base64 encoded signature image
  created_at  timestamptz not null default now()
);

-- ============================================================
-- CUSTOMERS (companies whose equipment gets calibrated)
-- ============================================================
create table customers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  name        text not null,
  address     text,
  contact     text,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- MASTER STANDARDS (test equipment used by techs)
-- ============================================================
create table master_standards (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  name            text not null,          -- e.g. "Fluke 743B"
  serial_number   text not null,
  model           text,
  manufacturer    text,
  certificate_ref text,                   -- traceability cert number
  calibrated_at   date not null,
  due_at          date not null,
  notes           text,
  created_at      timestamptz not null default now()
);

-- ============================================================
-- ASSETS (instruments under calibration management)
-- ============================================================
create type instrument_type as enum (
  'pressure',
  'temperature',
  'ph_conductivity',
  'level_4_20ma',
  'other'
);

create table assets (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  customer_id       uuid references customers(id),
  tag_id            text not null,         -- scanned QR / barcode value
  serial_number     text,
  manufacturer      text,
  model             text,
  instrument_type   instrument_type not null,
  range_min         numeric,
  range_max         numeric,
  range_unit        text,
  calibration_interval_days  int not null default 365,
  last_calibrated_at         date,
  next_due_at                date,
  location          text,
  notes             text,
  created_at        timestamptz not null default now(),
  unique (tenant_id, tag_id)
);

-- ============================================================
-- CALIBRATION RECORDS
-- ============================================================
create type calibration_status as enum (
  'in_progress',
  'pending_approval',
  'approved',
  'rejected'
);

create table calibration_records (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  asset_id            uuid not null references assets(id),
  technician_id       uuid not null references profiles(id),
  supervisor_id       uuid references profiles(id),
  status              calibration_status not null default 'in_progress',
  performed_at        timestamptz not null default now(),
  approved_at         timestamptz,
  sales_number        text,
  flag_number         text,
  tech_signature      text,               -- base64 encoded
  supervisor_signature text,
  certificate_url     text,               -- Supabase Storage path
  notes               text,
  -- Sync support
  local_id            text,               -- client-generated ID for offline outbox
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ============================================================
-- CALIBRATION MEASUREMENTS
-- Flexible key-value rows per reading point
-- ============================================================
create table calibration_measurements (
  id              uuid primary key default gen_random_uuid(),
  record_id       uuid not null references calibration_records(id) on delete cascade,
  point_label     text not null,          -- e.g. "0%", "25%", "As Found", "As Left"
  standard_value  numeric,
  measured_value  numeric,
  unit            text,
  pass            boolean,
  error_pct       numeric,
  notes           text
);

-- ============================================================
-- CALIBRATION STANDARDS USED (join: record <-> standard)
-- ============================================================
create table calibration_standards_used (
  record_id    uuid not null references calibration_records(id) on delete cascade,
  standard_id  uuid not null references master_standards(id),
  primary key (record_id, standard_id)
);

-- ============================================================
-- AUDIT LOG
-- ============================================================
create table audit_log (
  id          bigserial primary key,
  tenant_id   uuid not null references tenants(id),
  user_id     uuid references auth.users(id),
  table_name  text not null,
  record_id   uuid not null,
  action      text not null,             -- INSERT, UPDATE, DELETE
  old_data    jsonb,
  new_data    jsonb,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- All tables scoped to tenant_id matching the user's profile
-- ============================================================

alter table tenants              enable row level security;
alter table profiles             enable row level security;
alter table customers            enable row level security;
alter table master_standards     enable row level security;
alter table assets               enable row level security;
alter table calibration_records  enable row level security;
alter table calibration_measurements enable row level security;
alter table calibration_standards_used enable row level security;
alter table audit_log            enable row level security;

-- Helper: get the tenant_id for the current authenticated user
create or replace function current_tenant_id()
returns uuid
language sql stable
as $$
  select tenant_id from profiles where id = auth.uid()
$$;

-- Policy generator macro (tenant isolation)
create policy "tenant_isolation" on tenants
  for all using (id = current_tenant_id());

create policy "tenant_isolation" on profiles
  for all using (tenant_id = current_tenant_id());

create policy "tenant_isolation" on customers
  for all using (tenant_id = current_tenant_id());

create policy "tenant_isolation" on master_standards
  for all using (tenant_id = current_tenant_id());

create policy "tenant_isolation" on assets
  for all using (tenant_id = current_tenant_id());

create policy "tenant_isolation" on calibration_records
  for all using (tenant_id = current_tenant_id());

create policy "tenant_isolation" on audit_log
  for all using (tenant_id = current_tenant_id());

-- Measurements and standards_used access via parent record
create policy "via_record" on calibration_measurements
  for all using (
    record_id in (
      select id from calibration_records where tenant_id = current_tenant_id()
    )
  );

create policy "via_record" on calibration_standards_used
  for all using (
    record_id in (
      select id from calibration_records where tenant_id = current_tenant_id()
    )
  );

-- ============================================================
-- INDEXES
-- ============================================================
create index on assets (tenant_id, tag_id);
create index on assets (tenant_id, next_due_at);
create index on calibration_records (tenant_id, status);
create index on calibration_records (asset_id);
create index on master_standards (tenant_id, due_at);
create index on audit_log (tenant_id, record_id);
