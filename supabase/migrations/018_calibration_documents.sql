-- ============================================================
-- Migration 018: Multiple documents per calibration record
--
-- Files live in a PRIVATE storage bucket under {tenant_id}/{record_id}/...
-- and are opened through short-lived signed URLs. Customers (portal users)
-- can read documents for their own company's assets only.
-- ============================================================

create table if not exists calibration_documents (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  record_id     uuid references calibration_records(id) on delete cascade,
  asset_id      uuid references assets(id) on delete cascade,
  file_path     text not null unique,            -- object name in the 'documents' bucket
  file_name     text not null,                   -- original file name, for display
  content_type  text,
  size_bytes    bigint,
  kind          text not null default 'other'
                check (kind in ('certificate', 'datasheet', 'photo', 'report', 'other')),
  description   text,
  uploaded_by   uuid references profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  check (record_id is not null or asset_id is not null)
);

create index if not exists calibration_documents_record_idx on calibration_documents (record_id);
create index if not exists calibration_documents_asset_idx on calibration_documents (tenant_id, asset_id);

alter table calibration_documents enable row level security;

-- Staff: full access within the tenant. Customers: read-only, own assets.
create policy "staff_all" on calibration_documents
  for all
  using (
    tenant_id = current_tenant_id()
    and (select role from profiles where id = auth.uid()) <> 'customer'
  )
  with check (
    tenant_id = current_tenant_id()
    and (select role from profiles where id = auth.uid()) <> 'customer'
  );

create policy "customer_read" on calibration_documents
  for select using (
    tenant_id = current_tenant_id()
    and asset_id in (
      select a.id from assets a
      join profiles p on p.id = auth.uid()
      where p.role = 'customer' and a.customer_id = p.customer_id
    )
  );

-- Keep asset_id filled from the record so asset pages can list every document.
create or replace function calibration_documents_fill_asset() returns trigger
language plpgsql
as $$
begin
  if new.asset_id is null and new.record_id is not null then
    select asset_id into new.asset_id from calibration_records where id = new.record_id;
  end if;
  return new;
end;
$$;

drop trigger if exists calibration_documents_fill_asset on calibration_documents;
create trigger calibration_documents_fill_asset
  before insert on calibration_documents
  for each row execute function calibration_documents_fill_asset();

-- Audit trail (see 017)
drop trigger if exists audit_capture on calibration_documents;
create trigger audit_capture after insert or update or delete on calibration_documents
  for each row execute function audit_capture('record_id', '');

-- ------------------------------------------------------------
-- Private bucket
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  26214400, -- 25 MB
  array[
    'application/pdf',
    'image/png', 'image/jpeg', 'image/webp', 'image/heic',
    'text/csv', 'text/plain',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword'
  ]
)
on conflict (id) do nothing;

create policy "documents_staff_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = current_tenant_id()::text
    and (select role from profiles where id = auth.uid()) <> 'customer'
  );

create policy "documents_staff_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = current_tenant_id()::text
    and (select role from profiles where id = auth.uid()) <> 'customer'
  );

create policy "documents_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = current_tenant_id()::text
    and (
      (select role from profiles where id = auth.uid()) <> 'customer'
      or exists (
        select 1 from calibration_documents d
        join assets a on a.id = d.asset_id
        join profiles p on p.id = auth.uid()
        where d.file_path = storage.objects.name
          and a.customer_id = p.customer_id
      )
    )
  );
