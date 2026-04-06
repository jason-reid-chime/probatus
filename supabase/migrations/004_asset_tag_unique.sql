-- Enforce unique tag IDs per tenant.
-- Tag IDs are customer-facing identifiers and must be unique within a tenant.
ALTER TABLE assets
  ADD CONSTRAINT assets_tenant_tag_id_unique UNIQUE (tenant_id, tag_id);
