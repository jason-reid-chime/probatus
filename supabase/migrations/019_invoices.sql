-- ============================================================
-- Migration 019: Invoicing
--
-- Invoices bill a customer for calibration work, usually generated from a
-- completed work order (one line per instrument). Numbers are sequential per
-- tenant. Lines may point at the asset and calibration they bill for, which
-- is what cost-per-instrument analytics reads.
-- ============================================================

create type invoice_status as enum ('draft', 'sent', 'paid', 'void');

create table invoices (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  number         int  not null,
  customer_id    uuid references customers(id),
  work_order_id  uuid references work_orders(id) on delete set null,
  status         invoice_status not null default 'draft',
  issue_date     date not null default current_date,
  due_date       date,
  currency       text not null default 'CAD',
  tax_rate       numeric(6,3) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  notes          text,
  sent_at        timestamptz,
  paid_at        timestamptz,
  created_by     uuid references profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, number)
);

create table invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references invoices(id) on delete cascade,
  position     int  not null default 0,
  description  text not null,
  quantity     numeric(12,3) not null default 1 check (quantity >= 0),
  unit_price   numeric(12,2) not null default 0,
  asset_id     uuid references assets(id) on delete set null,
  record_id    uuid references calibration_records(id) on delete set null
);

create index on invoices (tenant_id, status);
create index on invoices (tenant_id, customer_id);
create index on invoices (work_order_id);
create index on invoice_lines (invoice_id);
create index on invoice_lines (asset_id);

alter table invoices      enable row level security;
alter table invoice_lines enable row level security;

-- Billing is staff-only; customers never see invoices through RLS.
create policy "staff_all" on invoices
  for all using (
    tenant_id = current_tenant_id()
    and (select role from profiles where id = auth.uid()) in ('supervisor', 'admin')
  );

create policy "via_invoice" on invoice_lines
  for all using (
    invoice_id in (
      select id from invoices
      where tenant_id = current_tenant_id()
        and (select role from profiles where id = auth.uid()) in ('supervisor', 'admin')
    )
  );

-- Audit trail (see 017)
create trigger audit_capture after insert or update or delete on invoices
  for each row execute function audit_capture('customer_id', '');
create trigger audit_capture after insert or update or delete on invoice_lines
  for each row execute function audit_capture('invoice_id', 'invoices');
