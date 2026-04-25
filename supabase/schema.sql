-- ============================================================
-- Probatus — Consolidated Schema
-- Single file representing the complete current database schema.
-- Safe to run on a fresh Supabase project.
-- Does NOT include data migrations (008, 009).
-- ============================================================

-- ============================================================
-- EXTENSIONS
-- ============================================================
create extension if not exists "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================
do $$ begin
  create type user_role as enum ('technician', 'supervisor', 'admin', 'customer');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type instrument_type as enum (
    'pressure',
    'temperature',
    'ph_conductivity',
    'level_4_20ma',
    'other',
    'flow',
    'pressure_switch',
    'temperature_switch',
    'conductivity',
    'transmitter_4_20ma'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type calibration_status as enum (
    'in_progress',
    'pending_approval',
    'approved',
    'rejected'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type work_order_status as enum (
    'open',
    'in_progress',
    'completed',
    'cancelled'
  );
exception when duplicate_object then null;
end $$;

-- ============================================================
-- TENANTS
-- ============================================================
create table if not exists tenants (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  slug       text        not null unique,
  created_at timestamptz not null default now()
);

-- ============================================================
-- USERS (extends Supabase auth.users)
-- ============================================================
create table if not exists profiles (
  id          uuid      primary key references auth.users(id) on delete cascade,
  tenant_id   uuid      not null references tenants(id),
  full_name   text      not null,
  role        user_role not null default 'technician',
  roles       user_role[] not null default '{}',
  signature   text,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- CUSTOMERS (companies whose equipment gets calibrated)
-- ============================================================
create table if not exists customers (
  id         uuid        primary key default gen_random_uuid(),
  tenant_id  uuid        not null references tenants(id),
  name       text        not null,
  address    text,
  contact    text,
  created_at timestamptz not null default now()
);

-- Add FK from profiles → customers after customers table exists
alter table profiles
  add column if not exists customer_id uuid references customers(id);

-- ============================================================
-- MASTER STANDARDS (reference equipment used by techs)
-- ============================================================
create table if not exists master_standards (
  id              uuid        primary key default gen_random_uuid(),
  tenant_id       uuid        not null references tenants(id),
  name            text        not null,
  serial_number   text        not null,
  model           text,
  manufacturer    text,
  certificate_ref text,
  calibrated_at   date        not null,
  due_at          date        not null,
  notes           text,
  created_at      timestamptz not null default now()
);

-- ============================================================
-- ASSETS (instruments under calibration management)
-- ============================================================
create table if not exists assets (
  id                         uuid            primary key default gen_random_uuid(),
  tenant_id                  uuid            not null references tenants(id),
  customer_id                uuid            references customers(id),
  tag_id                     text            not null,
  serial_number              text,
  manufacturer               text,
  model                      text,
  instrument_type            instrument_type not null,
  range_min                  numeric,
  range_max                  numeric,
  range_unit                 text,
  calibration_interval_days  int             not null default 365,
  last_calibrated_at         date,
  next_due_at                date,
  location                   text,
  notes                      text,
  created_at                 timestamptz     not null default now(),
  constraint assets_tenant_tag_id_unique unique (tenant_id, tag_id)
);

-- ============================================================
-- CALIBRATION RECORDS
-- ============================================================
create table if not exists calibration_records (
  id                      uuid               primary key default gen_random_uuid(),
  tenant_id               uuid               not null references tenants(id),
  asset_id                uuid               not null references assets(id),
  technician_id           uuid               not null references profiles(id),
  supervisor_id           uuid               references profiles(id),
  status                  calibration_status not null default 'in_progress',
  performed_at            timestamptz        not null default now(),
  approved_at             timestamptz,
  sales_number            text,
  flag_number             text,
  tech_signature          text,
  supervisor_signature    text,
  certificate_url         text,
  notes                   text,
  combined_uncertainty_pct numeric,
  coverage_factor         numeric            default 2,
  local_id                text,
  created_at              timestamptz        not null default now(),
  updated_at              timestamptz        not null default now()
);

-- ============================================================
-- CALIBRATION MEASUREMENTS
-- ============================================================
create table if not exists calibration_measurements (
  id              uuid    primary key default gen_random_uuid(),
  record_id       uuid    not null references calibration_records(id) on delete cascade,
  point_label     text    not null,
  standard_value  numeric,
  measured_value  numeric,
  unit            text,
  pass            boolean,
  error_pct       numeric,
  notes           text,
  uncertainty_pct numeric,
  confidence_level text check (confidence_level in ('95', '99'))
);

-- ============================================================
-- CALIBRATION STANDARDS USED (record ↔ standard join)
-- ============================================================
create table if not exists calibration_standards_used (
  record_id   uuid not null references calibration_records(id) on delete cascade,
  standard_id uuid not null references master_standards(id),
  primary key (record_id, standard_id)
);

-- ============================================================
-- CALIBRATION TEMPLATES
-- ============================================================
create table if not exists calibration_templates (
  id              uuid        primary key default gen_random_uuid(),
  tenant_id       uuid        not null references tenants(id) on delete cascade,
  name            text        not null,
  description     text,
  instrument_type text        not null,
  tolerance_pct   numeric     not null default 1.0,
  points          jsonb       not null default '[]',
  created_by      uuid        references profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- ============================================================
-- WORK ORDERS
-- ============================================================
create table if not exists work_orders (
  id             uuid              primary key default gen_random_uuid(),
  tenant_id      uuid              not null references tenants(id),
  customer_id    uuid              references customers(id),
  title          text              not null,
  notes          text,
  scheduled_date date              not null,
  status         work_order_status not null default 'open',
  created_by     uuid              references profiles(id),
  created_at     timestamptz       not null default now(),
  updated_at     timestamptz       not null default now()
);

create table if not exists work_order_assets (
  work_order_id uuid not null references work_orders(id) on delete cascade,
  asset_id      uuid not null references assets(id) on delete cascade,
  primary key (work_order_id, asset_id)
);

-- ============================================================
-- AUDIT LOG
-- ============================================================
create table if not exists audit_log (
  id         bigserial   primary key,
  tenant_id  uuid        not null references tenants(id),
  user_id    uuid        references auth.users(id),
  table_name text        not null,
  record_id  uuid        not null,
  action     text        not null,
  old_data   jsonb,
  new_data   jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table tenants                    enable row level security;
alter table profiles                   enable row level security;
alter table customers                  enable row level security;
alter table master_standards           enable row level security;
alter table assets                     enable row level security;
alter table calibration_records        enable row level security;
alter table calibration_measurements   enable row level security;
alter table calibration_standards_used enable row level security;
alter table calibration_templates      enable row level security;
alter table work_orders                enable row level security;
alter table work_order_assets          enable row level security;
alter table audit_log                  enable row level security;

-- Helper: get the tenant_id for the current authenticated user
create or replace function current_tenant_id()
returns uuid
language sql stable
as $$
  select tenant_id from profiles where id = auth.uid()
$$;

-- Tenants
drop policy if exists "tenant_isolation" on tenants;
create policy "tenant_isolation" on tenants
  for all using (id = current_tenant_id());

-- Profiles
drop policy if exists "tenant_isolation" on profiles;
create policy "tenant_isolation" on profiles
  for all using (tenant_id = current_tenant_id());

-- Customers
drop policy if exists "tenant_isolation" on customers;
create policy "tenant_isolation" on customers
  for all using (tenant_id = current_tenant_id());

-- Master standards
drop policy if exists "tenant_isolation" on master_standards;
create policy "tenant_isolation" on master_standards
  for all using (tenant_id = current_tenant_id());

-- Assets: staff see all; customers see only their company's assets
drop policy if exists "tenant_isolation" on assets;
create policy "tenant_isolation" on assets
  for all using (
    tenant_id = current_tenant_id()
    and (
      (select role from profiles where id = auth.uid()) != 'customer'
      or
      customer_id = (select customer_id from profiles where id = auth.uid())
    )
  );

-- Calibration records: staff see all; customers see only records for their assets
drop policy if exists "tenant_isolation" on calibration_records;
create policy "tenant_isolation" on calibration_records
  for all using (
    tenant_id = current_tenant_id()
    and (
      (select role from profiles where id = auth.uid()) != 'customer'
      or
      asset_id in (
        select a.id from assets a
        join profiles p on p.id = auth.uid()
        where a.customer_id = p.customer_id
          and a.tenant_id = current_tenant_id()
      )
    )
  );

-- Measurements and standards_used: access via parent record
drop policy if exists "via_record" on calibration_measurements;
create policy "via_record" on calibration_measurements
  for all using (
    record_id in (
      select id from calibration_records where tenant_id = current_tenant_id()
    )
  );

drop policy if exists "via_record" on calibration_standards_used;
create policy "via_record" on calibration_standards_used
  for all using (
    record_id in (
      select id from calibration_records where tenant_id = current_tenant_id()
    )
  );

-- Templates
drop policy if exists "tenant_isolation" on calibration_templates;
create policy "tenant_isolation" on calibration_templates
  for all using (tenant_id = current_tenant_id());

-- Work orders
drop policy if exists "tenant_isolation" on work_orders;
create policy "tenant_isolation" on work_orders
  for all using (tenant_id = current_tenant_id());

drop policy if exists "via_work_order" on work_order_assets;
create policy "via_work_order" on work_order_assets
  for all using (
    work_order_id in (
      select id from work_orders where tenant_id = current_tenant_id()
    )
  );

-- Audit log
drop policy if exists "tenant_isolation" on audit_log;
create policy "tenant_isolation" on audit_log
  for all using (tenant_id = current_tenant_id());

-- ============================================================
-- INDEXES
-- ============================================================
create index if not exists assets_tenant_tag_id_idx          on assets (tenant_id, tag_id);
create index if not exists assets_tenant_next_due_idx        on assets (tenant_id, next_due_at);
create index if not exists assets_customer_id_idx            on assets (customer_id) where customer_id is not null;
create index if not exists calibration_records_tenant_status on calibration_records (tenant_id, status);
create index if not exists calibration_records_asset_id_idx  on calibration_records (asset_id);
create index if not exists master_standards_tenant_due_idx   on master_standards (tenant_id, due_at);
create index if not exists audit_log_tenant_record_idx       on audit_log (tenant_id, record_id);
create index if not exists audit_log_tenant_created_idx      on audit_log (tenant_id, created_at desc);
create index if not exists profiles_tenant_id_idx            on profiles (tenant_id);
create index if not exists calibration_templates_tenant_type on calibration_templates (tenant_id, instrument_type);
create index if not exists work_orders_tenant_date_idx       on work_orders (tenant_id, scheduled_date);
create index if not exists work_orders_tenant_status_idx     on work_orders (tenant_id, status);
create index if not exists work_order_assets_order_idx       on work_order_assets (work_order_id);
create index if not exists work_order_assets_asset_idx       on work_order_assets (asset_id);

-- ============================================================
-- STORAGE: Certificate PDFs
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'certificates',
  'certificates',
  true,
  10485760,
  array['application/pdf']
)
on conflict (id) do nothing;

drop policy if exists "Tenant upload certificates" on storage.objects;
create policy "Tenant upload certificates"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'certificates'
    and (storage.foldername(name))[1] = (
      select tenant_id::text from profiles where id = auth.uid()
    )
  );

drop policy if exists "Tenant read certificates" on storage.objects;
create policy "Tenant read certificates"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'certificates'
    and (storage.foldername(name))[1] = (
      select tenant_id::text from profiles where id = auth.uid()
    )
  );

drop policy if exists "Public read certificates" on storage.objects;
create policy "Public read certificates"
  on storage.objects for select
  to anon
  using (bucket_id = 'certificates');
