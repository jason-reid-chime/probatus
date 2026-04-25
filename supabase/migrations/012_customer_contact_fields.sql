-- Split customers.contact (free-text) into structured fields
alter table customers
  add column if not exists email text,
  add column if not exists phone text;
