-- Create public storage bucket for certificate PDFs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'certificates',
  'certificates',
  true,
  10485760, -- 10 MB
  array['application/pdf']
)
on conflict (id) do nothing;

-- Allow authenticated users to upload to their tenant folder.
create policy "Tenant upload certificates"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'certificates'
    and (storage.foldername(name))[1] = (
      select tenant_id::text from profiles where id = auth.uid()
    )
  );

-- Allow authenticated users to read certificates in their tenant folder.
create policy "Tenant read certificates"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'certificates'
    and (storage.foldername(name))[1] = (
      select tenant_id::text from profiles where id = auth.uid()
    )
  );

-- Allow public reads (needed for getPublicUrl to work without auth headers).
create policy "Public read certificates"
  on storage.objects for select
  to anon
  using (bucket_id = 'certificates');
