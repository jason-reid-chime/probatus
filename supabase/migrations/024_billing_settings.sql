-- ============================================================
-- Billing settings: the tenant's sales-tax registration number (e.g. HST
-- 123456789 RT0001), the label printed for tax on invoices, and the default
-- tax rate new invoices start with. Each invoice still stores its own
-- tax_rate, so changing the default never alters existing invoices.
-- ============================================================

create table if not exists billing_settings (
  tenant_id        uuid primary key references tenants(id) on delete cascade,
  tax_number       text,
  tax_label        text not null default 'HST',
  default_tax_rate numeric(6,3) not null default 13
                   check (default_tax_rate >= 0 and default_tax_rate <= 100),
  updated_at       timestamptz not null default now()
);

alter table billing_settings enable row level security;

-- Same audience as invoices: supervisors and admins of the tenant.
drop policy if exists "staff_all" on billing_settings;
create policy "staff_all" on billing_settings
  for all using (
    tenant_id = current_tenant_id()
    and (select role from profiles where id = auth.uid()) in ('supervisor', 'admin')
  )
  with check (
    tenant_id = current_tenant_id()
    and (select role from profiles where id = auth.uid()) in ('supervisor', 'admin')
  );

grant select, insert, update on billing_settings to authenticated;

drop trigger if exists audit_capture on billing_settings;
create trigger audit_capture after insert or update or delete on billing_settings
  for each row execute function audit_capture('tenant_id', '');
