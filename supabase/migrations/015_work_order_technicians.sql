-- Technician assignment for work orders
-- A work order can have multiple assigned technicians

create table work_order_technicians (
  work_order_id  uuid not null references work_orders(id) on delete cascade,
  technician_id  uuid not null references profiles(id) on delete cascade,
  primary key (work_order_id, technician_id)
);

alter table work_order_technicians enable row level security;

create policy "tenant_isolation" on work_order_technicians
  for all using (
    work_order_id in (
      select id from work_orders where tenant_id = current_tenant_id()
    )
  );

create index on work_order_technicians (work_order_id);
create index on work_order_technicians (technician_id);
