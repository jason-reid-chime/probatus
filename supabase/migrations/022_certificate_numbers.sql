-- ============================================================
-- Human-readable certificate numbers
--
-- Each tenant numbers its certificates 10001, 10002, ... A number is assigned
-- the moment a calibration becomes approved (single approve, bulk approve or
-- any other path) and never changes or gets reused: approved records can no
-- longer be rejected/reopened, and a deleted record's number stays retired.
-- ============================================================

alter table calibration_records add column if not exists certificate_number bigint;

create unique index if not exists calibration_records_tenant_cert_number_idx
  on calibration_records (tenant_id, certificate_number)
  where certificate_number is not null;

create table if not exists certificate_counters (
  tenant_id   uuid primary key references tenants(id) on delete cascade,
  last_number bigint not null
);
-- Only the trigger below (security definer) touches it.
alter table certificate_counters enable row level security;
revoke all on certificate_counters from anon, authenticated;

create or replace function next_certificate_number(p_tenant uuid) returns bigint
language sql
security definer
set search_path = public
as $$
  insert into certificate_counters as c (tenant_id, last_number)
  values (p_tenant, 10001)
  on conflict (tenant_id) do update set last_number = c.last_number + 1
  returning last_number
$$;
revoke all on function next_certificate_number(uuid) from public;
do $$ begin
  revoke all on function next_certificate_number(uuid) from anon, authenticated;
exception when undefined_object then null;
end $$;

create or replace function assign_certificate_number() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and new.certificate_number is null then
    new.certificate_number := next_certificate_number(new.tenant_id);
  end if;
  return new;
end;
$$;

drop trigger if exists assign_certificate_number on calibration_records;
create trigger assign_certificate_number
  before insert or update of status on calibration_records
  for each row execute function assign_certificate_number();

-- Backfill: number already-approved records in approval order, per tenant.
do $$
declare
  r record;
begin
  for r in
    select id, tenant_id from calibration_records
    where status = 'approved' and certificate_number is null
    order by tenant_id, approved_at nulls first, performed_at, id
  loop
    update calibration_records
       set certificate_number = next_certificate_number(r.tenant_id)
     where id = r.id;
  end loop;
end $$;
