-- ============================================================
-- Migration 017: Immutable, tamper-evident activity log
--
-- Every insert/update/delete on the audited tables is written to audit_log by
-- a trigger, so changes are captured whichever path made them (Go backend or
-- direct Supabase calls from the app).
--
-- Who:   auth.uid() for direct Supabase calls; for the Go backend (which
--        connects as a service role) the app.user_id / app.tenant_id settings
--        it sets at the start of each write transaction.
-- What:  old/new row as JSON. Signature images are replaced by a short hash so
--        a change is visible without storing the image again.
-- Tamper evidence: rows are append-only (UPDATE/DELETE raise), and each row
--        stores sha256(previous row hash || row contents) per tenant, so any
--        edit or removal breaks the chain. audit_log_verify() checks it.
-- ============================================================

alter table audit_log
  add column if not exists parent_id uuid,      -- e.g. the calibration a measurement belongs to
  add column if not exists prev_hash text,
  add column if not exists hash      text;

-- History must outlive the user who made it: a FK to auth.users would block
-- deleting any user who ever changed anything.
alter table audit_log drop constraint if exists audit_log_user_id_fkey;

-- created_at must be the exact value that was hashed.
alter table audit_log alter column created_at set default clock_timestamp();

create index if not exists audit_log_tenant_created_idx on audit_log (tenant_id, id desc);
create index if not exists audit_log_parent_idx on audit_log (tenant_id, parent_id) where parent_id is not null;
create index if not exists audit_log_user_idx on audit_log (tenant_id, user_id);

-- ------------------------------------------------------------
-- Canonical row hash. Shared by the trigger and the verifier so both compute
-- the same value; timestamps are rendered in UTC so the session TimeZone
-- can't change the result.
-- ------------------------------------------------------------
create or replace function audit_row_hash(
  p_prev_hash text, p_tenant_id uuid, p_user_id uuid, p_table_name text,
  p_record_id uuid, p_parent_id uuid, p_action text, p_old jsonb, p_new jsonb,
  p_created_at timestamptz
) returns text
language sql immutable
as $$
  select encode(sha256(convert_to(concat_ws('|',
    coalesce(p_prev_hash, ''),
    p_tenant_id::text,
    coalesce(p_user_id::text, ''),
    p_table_name,
    p_record_id::text,
    coalesce(p_parent_id::text, ''),
    p_action,
    coalesce(p_old::text, ''),
    coalesce(p_new::text, ''),
    to_char(p_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
  ), 'UTF8')), 'hex')
$$;

-- Replace bulky signature images with a short fingerprint.
create or replace function audit_redact(p_row jsonb) returns jsonb
language plpgsql immutable
as $$
declare
  k text;
begin
  if p_row is null then return null; end if;
  foreach k in array array['signature', 'tech_signature', 'supervisor_signature'] loop
    if p_row ? k and p_row->>k is not null and p_row->>k <> '' then
      p_row := jsonb_set(p_row, array[k],
        to_jsonb('sha256:' || left(encode(sha256(convert_to(p_row->>k, 'UTF8')), 'hex'), 16)));
    end if;
  end loop;
  return p_row;
end;
$$;

-- ------------------------------------------------------------
-- Trigger function.
--   TG_ARGV[0] (optional): column holding the parent id (stored as parent_id)
--   TG_ARGV[1] (optional): parent table to read tenant_id from, for child
--                          tables that have no tenant_id column
-- ------------------------------------------------------------
create or replace function audit_capture() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old       jsonb;
  v_new       jsonb;
  v_row       jsonb;
  v_tenant    uuid;
  v_actor     uuid;
  v_record    uuid;
  v_parent    uuid;
  v_prev      text;
  v_created   timestamptz := clock_timestamp();
  v_parent_col text := nullif(TG_ARGV[0], '');
  v_parent_tbl text := nullif(TG_ARGV[1], '');
begin
  if TG_OP <> 'INSERT' then v_old := audit_redact(to_jsonb(OLD)); end if;
  if TG_OP <> 'DELETE' then v_new := audit_redact(to_jsonb(NEW)); end if;

  -- Ignore updates that change nothing but the timestamp.
  if TG_OP = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return null;
  end if;

  v_row := coalesce(v_new, v_old);
  if v_parent_col is not null then
    v_parent := (v_row->>v_parent_col)::uuid;
  end if;
  v_record := coalesce((v_row->>'id')::uuid, v_parent);

  v_tenant := (v_row->>'tenant_id')::uuid;
  if v_tenant is null and v_parent_tbl is not null and v_parent is not null then
    execute format('select tenant_id from %I where id = $1', v_parent_tbl)
      into v_tenant using v_parent;
  end if;
  v_tenant := coalesce(v_tenant,
                       nullif(current_setting('app.tenant_id', true), '')::uuid,
                       current_tenant_id());
  -- A child row deleted by cascade after its parent is gone: the parent's own
  -- DELETE entry already records the removal.
  if v_tenant is null or v_record is null then
    return null;
  end if;

  v_actor := coalesce(auth.uid(), nullif(current_setting('app.user_id', true), '')::uuid);

  -- Serialise writers per tenant so the chain stays linear.
  perform pg_advisory_xact_lock(hashtextextended('audit_log:' || v_tenant::text, 0));
  select hash into v_prev from audit_log where tenant_id = v_tenant order by id desc limit 1;

  insert into audit_log (tenant_id, user_id, table_name, record_id, parent_id, action,
                         old_data, new_data, created_at, prev_hash, hash)
  values (v_tenant, v_actor, TG_TABLE_NAME, v_record, v_parent, TG_OP,
          v_old, v_new, v_created, v_prev,
          audit_row_hash(v_prev, v_tenant, v_actor, TG_TABLE_NAME, v_record, v_parent,
                         TG_OP, v_old, v_new, v_created));
  return null;
end;
$$;

-- ------------------------------------------------------------
-- Append-only: block edits and deletes for everyone, including service roles.
-- ------------------------------------------------------------
create or replace function audit_log_immutable() returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

drop trigger if exists audit_log_no_update on audit_log;
create trigger audit_log_no_update
  before update or delete on audit_log
  for each row execute function audit_log_immutable();

drop trigger if exists audit_log_no_truncate on audit_log;
create trigger audit_log_no_truncate
  before truncate on audit_log
  for each statement execute function audit_log_immutable();

-- App users may read their tenant's log (staff only) but never write it; rows
-- only arrive through the security-definer trigger above.
drop policy if exists "tenant_isolation" on audit_log;
create policy "staff_read" on audit_log
  for select using (
    tenant_id = current_tenant_id()
    and (select role from profiles where id = auth.uid()) <> 'customer'
  );
revoke insert, update, delete, truncate on audit_log from anon, authenticated;

-- ------------------------------------------------------------
-- Chain verification. Returns how many rows were checked and the id of the
-- first row whose hash doesn't match (null when the chain is intact).
-- ------------------------------------------------------------
create or replace function audit_log_verify(p_tenant_id uuid)
returns table (checked bigint, first_broken_id bigint)
language plpgsql
stable
as $$
declare
  r        record;
  v_prev   text := null;
  v_count  bigint := 0;
begin
  for r in
    select * from audit_log where tenant_id = p_tenant_id and hash is not null order by id
  loop
    v_count := v_count + 1;
    if r.prev_hash is distinct from v_prev
       or r.hash <> audit_row_hash(r.prev_hash, r.tenant_id, r.user_id, r.table_name,
                                   r.record_id, r.parent_id, r.action, r.old_data,
                                   r.new_data, r.created_at) then
      checked := v_count;
      first_broken_id := r.id;
      return next;
      return;
    end if;
    v_prev := r.hash;
  end loop;
  checked := v_count;
  first_broken_id := null;
  return next;
end;
$$;

-- ------------------------------------------------------------
-- Attach to the audited tables.
-- ------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('assets',                     'customer_id', ''),
      ('calibration_records',        'asset_id',    ''),
      ('calibration_measurements',   'record_id',   'calibration_records'),
      ('calibration_standards_used', 'record_id',   'calibration_records'),
      ('master_standards',           '',            ''),
      ('customers',                  '',            ''),
      ('work_orders',                'customer_id', ''),
      ('work_order_assets',          'work_order_id', 'work_orders'),
      ('work_order_technicians',     'work_order_id', 'work_orders'),
      ('profiles',                   '',            '')
    ) as v(tbl, parent_col, parent_tbl)
  loop
    if to_regclass(t.tbl) is not null then
      execute format('drop trigger if exists audit_capture on %I', t.tbl);
      execute format(
        'create trigger audit_capture after insert or update or delete on %I
           for each row execute function audit_capture(%L, %L)',
        t.tbl, t.parent_col, t.parent_tbl);
    end if;
  end loop;
end $$;
