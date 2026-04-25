-- Add updated_at to customers table for tracking last-modified time
alter table customers
  add column if not exists updated_at timestamptz not null default now();
