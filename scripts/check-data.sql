-- Data-integrity checks. Read-only: runs in a READ ONLY transaction and rolls back.
-- Each row: what was checked, how many rows are bad, and up to 5 example ids.
-- A count of 0 means that check is clean.
--
--   psql "$DATABASE_URL" -f scripts/check-data.sql

begin read only;

select check_name, bad_rows, examples from (

  -- Tenant isolation: anything pointing across tenants is a data leak waiting to happen.
  select 1 as n, 'calibration tenant != its asset tenant' as check_name, count(*) as bad_rows, (array_agg(r.id))[1:5] as examples
  from calibration_records r join assets a on a.id = r.asset_id
  where r.tenant_id <> a.tenant_id
  union all
  select 2, 'calibration tenant != technician tenant', count(*), (array_agg(r.id))[1:5]
  from calibration_records r join profiles p on p.id = r.technician_id
  where r.tenant_id <> p.tenant_id
  union all
  select 3, 'standard used belongs to another tenant', count(*), (array_agg(su.record_id))[1:5]
  from calibration_standards_used su
  join calibration_records r on r.id = su.record_id
  join master_standards s on s.id = su.standard_id
  where r.tenant_id <> s.tenant_id
  union all
  select 4, 'asset customer belongs to another tenant', count(*), (array_agg(a.id))[1:5]
  from assets a join customers c on c.id = a.customer_id
  where a.tenant_id <> c.tenant_id

  -- Calibration records in states that shouldn't exist.
  union all
  select 5, 'submitted/approved calibration with no measurements', count(*), (array_agg(r.id))[1:5]
  from calibration_records r
  where r.status in ('pending_approval', 'approved')
    and not exists (select 1 from calibration_measurements m where m.record_id = r.id)
  union all
  select 6, 'submitted/approved calibration with a blank reading', count(distinct r.id), (array_agg(distinct r.id))[1:5]
  from calibration_records r join calibration_measurements m on m.record_id = r.id
  where r.status in ('pending_approval', 'approved')
    and (m.measured_value is null or m.pass is null)
  union all
  select 7, 'approved without approved_at / supervisor', count(*), (array_agg(r.id))[1:5]
  from calibration_records r
  where r.status = 'approved' and (r.approved_at is null or r.supervisor_id is null)
  union all
  select 8, 'calibration performed in the future', count(*), (array_agg(r.id))[1:5]
  from calibration_records r
  where r.performed_at > now() + interval '1 day'
  union all
  select 9, 'duplicate local_id within a tenant', count(*), (array_agg(r.id))[1:5]
  from calibration_records r
  where r.local_id is not null and r.local_id <> ''
    and exists (select 1 from calibration_records o
                where o.tenant_id = r.tenant_id and o.local_id = r.local_id and o.id <> r.id)
  union all
  select 10, 'measurement pass=true but error_pct looks huge (>100%)', count(*), (array_agg(m.record_id))[1:5]
  from calibration_measurements m
  where m.pass and abs(m.error_pct) > 100

  -- Standards.
  union all
  select 11, 'master standard due before it was calibrated', count(*), (array_agg(s.id))[1:5]
  from master_standards s
  where s.due_at < s.calibrated_at
  union all
  select 12, 'calibration used a standard that was already overdue', count(*), (array_agg(r.id))[1:5]
  from calibration_records r
  join calibration_standards_used su on su.record_id = r.id
  join master_standards s on s.id = su.standard_id
  where r.performed_at::date > s.due_at

  -- Assets.
  union all
  select 13, 'asset range_min >= range_max', count(*), (array_agg(a.id))[1:5]
  from assets a
  where a.range_min is not null and a.range_max is not null and a.range_min >= a.range_max
  union all
  select 14, 'asset next_due_at before last_calibrated_at', count(*), (array_agg(a.id))[1:5]
  from assets a
  where a.next_due_at < a.last_calibrated_at
  union all
  select 15, 'asset last_calibrated_at != latest approved calibration', count(*), (array_agg(a.id))[1:5]
  from assets a
  join lateral (select max(r.performed_at)::date as d from calibration_records r
                where r.asset_id = a.id and r.status = 'approved') latest on true
  where latest.d is not null and a.last_calibrated_at is distinct from latest.d
  union all
  select 16, 'asset non-positive calibration interval', count(*), (array_agg(a.id))[1:5]
  from assets a
  where a.calibration_interval_days <= 0

  -- Audit log tamper-evidence chain (migration 017).
  union all
  select 17, 'tenants whose audit chain is broken', count(*), (array_agg(t.id))[1:5]
  from tenants t, lateral audit_log_verify(t.id) v
  where v.first_broken_id is not null

) checks
order by n;

-- Overview: how many records sit in each status per tenant.
select t.name as tenant, r.status, count(*)
from calibration_records r join tenants t on t.id = r.tenant_id
group by 1, 2 order by 1, 2;

rollback;
