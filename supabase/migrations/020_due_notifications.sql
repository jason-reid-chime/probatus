-- ============================================================
-- Migration 020: Automated due / overdue email alerts
--
-- The API runs a job (hourly) that emails a digest of instruments coming due
-- or gone overdue. notification_settings holds each tenant's preferences;
-- notifications_sent records every alert so the same one is never sent twice
-- (the unique key doubles as a claim when several API instances run the job).
-- ============================================================

create table notification_settings (
  tenant_id            uuid primary key references tenants(id),
  enabled              boolean not null default false,
  lead_days            int[]   not null default '{30,7}',   -- alert this many days before due
  notify_overdue       boolean not null default true,       -- one more alert once overdue
  internal_recipients  text[]  not null default '{}',       -- staff emails: digest of all assets
  notify_customers     boolean not null default false,      -- customer contact email: their assets only
  updated_at           timestamptz not null default now()
);

create table notifications_sent (
  id          bigserial primary key,
  tenant_id   uuid not null references tenants(id),
  asset_id    uuid not null references assets(id) on delete cascade,
  due_date    date not null,
  kind        text not null,               -- 'due_30', 'due_7', ..., 'overdue'
  recipient   text not null,
  status      text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  attempts    int  not null default 1,
  error       text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  unique (asset_id, due_date, kind, recipient)
);

create index on notifications_sent (tenant_id, created_at desc);

alter table notification_settings enable row level security;
alter table notifications_sent    enable row level security;

create policy "admin_all" on notification_settings
  for all using (
    tenant_id = current_tenant_id()
    and (select role from profiles where id = auth.uid()) in ('supervisor', 'admin')
  );

create policy "staff_read" on notifications_sent
  for select using (
    tenant_id = current_tenant_id()
    and (select role from profiles where id = auth.uid()) in ('supervisor', 'admin')
  );

create trigger audit_capture after insert or update or delete on notification_settings
  for each row execute function audit_capture('tenant_id', '');  -- no id column: record_id = tenant
