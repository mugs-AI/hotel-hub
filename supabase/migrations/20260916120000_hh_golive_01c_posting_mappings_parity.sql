-- HH-GOLIVE-01C — posting-mappings schema and generated-type parity.
--
-- ADDITIVE AND IDEMPOTENT. The production schema already contains this
-- nullable column, while the canonical migration ledger and generated types
-- did not record it. Applying this migration later through the separately
-- authorised database gate records the schema contract without rewriting any
-- existing row or posting-mapping value.
--
-- Access remains unchanged: hotel_financial_settings already has RLS enabled
-- with no anon/authenticated policies and is accessed only by the server-side
-- service-role client behind the N3 session and HotelHub RBAC checks.
--
-- Rollback consideration: do not drop the column after it contains tenant
-- mappings. A rollback must first preserve/export those values and confirm
-- that no deployed code depends on them. This correction therefore supplies
-- no destructive automatic down migration.

begin;

alter table public.hotel_financial_settings
  add column if not exists posting_mappings jsonb;

comment on column public.hotel_financial_settings.posting_mappings is
  'HotelHub tenant-scoped future-posting mapping snapshots. Preparation only; '
  'editing this value never rewrites an existing folio-line snapshot.';

commit;
