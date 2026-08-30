-- HH-GOLIVE-01A UAT correction — future-posting accounting mappings storage.
--
-- STATUS: STAGED ONLY. This file lives under db/migrations-pending and has NOT
-- been applied. It must not be moved into supabase/migrations or executed as
-- part of this milestone.
--
-- Scope: add one nullable JSONB column that stores the tenant's future-posting
-- mapping snapshots (N3 stock / unit of measure / tax code / resolved account,
-- plus per-component verification state). Additive and idempotent: no data is
-- rewritten, no column is dropped, no type is altered, no row is deleted.
--
-- Fail-closed behaviour before this migration is applied: the column is absent,
-- the application reads unmapped defaults, and future-posting readiness stays
-- blocked. That is the intended state for this preparation milestone.
--
-- Access model (unchanged by this migration):
--   * hotel_financial_settings already has RLS enabled with no browser-facing
--     policies. All reads and writes go through server-side code using the
--     service role. This migration deliberately adds NO policy for anon or
--     authenticated, so the browser still cannot reach the table directly.
--
-- Immutability contract:
--   * Changing a mapping here NEVER rewrites an already-prepared folio line.
--     Folio lines keep their own snapshot columns; this column only feeds the
--     preparation of NEW lines.
--
-- ROLLBACK INVENTORY (dependency-safe order, one object created):
--   1. ALTER TABLE public.hotel_financial_settings
--        DROP COLUMN IF EXISTS posting_mappings;
--   No functions, triggers, types, indexes, tables, policies or grants are
--   created by this migration, so nothing else needs reversing.

BEGIN;

ALTER TABLE public.hotel_financial_settings
  ADD COLUMN IF NOT EXISTS posting_mappings JSONB;

COMMENT ON COLUMN public.hotel_financial_settings.posting_mappings IS
  'HH-GOLIVE-01A: tenant-scoped future-posting mapping snapshots (service '
  'charge, tourism tax, local levy, discount, positive/negative adjustment). '
  'Preparation only - nothing is posted to N3 in this milestone. Snapshots are '
  'immutable with respect to already-prepared folio lines: editing this value '
  'must never rewrite an existing folio line snapshot.';

-- Tenant scope is inherited from the existing hotel_financial_settings.tenant_id
-- foreign key and its RLS configuration; both are intentionally left untouched.

-- Service-role-only execution/access is preserved: no GRANT is added here, so
-- anon and authenticated gain no new privilege on this column.

COMMIT;
