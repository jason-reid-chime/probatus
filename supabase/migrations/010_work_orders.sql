-- ============================================================
-- Work Orders
-- ============================================================

create type work_order_status as enum ('open', 'in_progress', 'completed', 'cancelled');

create table work_orders (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  customer_id     uuid references customers(id),
  title           text not null,
  notes           text,
  scheduled_date  date not null,
  status          work_order_status not null default 'open',
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table work_order_assets (
  work_order_id  uuid not null references work_orders(id) on delete cascade,
  asset_id       uuid not null references assets(id) on delete cascade,
  primary key (work_order_id, asset_id)
);

alter table work_orders      enable row level security;
alter table work_order_assets enable row level security;

create policy "tenant_isolation" on work_orders
  for all using (tenant_id = current_tenant_id());

create policy "via_work_order" on work_order_assets
  for all using (
    work_order_id in (
      select id from work_orders where tenant_id = current_tenant_id()
    )
  );

create index on work_orders (tenant_id, scheduled_date);
create index on work_orders (tenant_id, status);
create index on work_order_assets (work_order_id);
create index on work_order_assets (asset_id);
