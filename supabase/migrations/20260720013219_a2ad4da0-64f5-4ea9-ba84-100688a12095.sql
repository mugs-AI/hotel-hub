
-- First-Owner provisioning helper. Server-admin only; not reachable from
-- any HTTP route or from browser code. MUGS runs this via the SQL editor
-- against the verified n3_tenant_key + n3_user_key surfaced in the
-- unassigned-role banner and audit log.
CREATE OR REPLACE FUNCTION public.hotelhub_provision_owner(
  p_n3_tenant_key text,
  p_n3_user_key text
)
RETURNS TABLE (tenant_id uuid, n3_user_key text, role public.hotel_role, is_active boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  IF p_n3_tenant_key IS NULL OR length(trim(p_n3_tenant_key)) = 0 THEN
    RAISE EXCEPTION 'p_n3_tenant_key required';
  END IF;
  IF p_n3_user_key IS NULL OR length(trim(p_n3_user_key)) = 0 THEN
    RAISE EXCEPTION 'p_n3_user_key required';
  END IF;

  SELECT t.id INTO v_tenant_id
  FROM public.hotel_tenants t
  WHERE t.n3_tenant_key = p_n3_tenant_key;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'No hotel_tenants row for n3_tenant_key=%. The N3 user must complete a launch first so the tenant is upserted.', p_n3_tenant_key;
  END IF;

  INSERT INTO public.hotel_user_roles (tenant_id, n3_user_key, role, is_active)
  VALUES (v_tenant_id, p_n3_user_key, 'owner', true)
  ON CONFLICT (tenant_id, n3_user_key)
  DO UPDATE SET role = 'owner', is_active = true, updated_at = now();

  INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
  VALUES (
    v_tenant_id,
    p_n3_user_key,
    'role.assigned',
    jsonb_build_object(
      'role', 'owner',
      'source', 'hotelhub_provision_owner',
      'provisioned_at', now()
    )
  );

  RETURN QUERY
    SELECT r.tenant_id, r.n3_user_key, r.role, r.is_active
    FROM public.hotel_user_roles r
    WHERE r.tenant_id = v_tenant_id AND r.n3_user_key = p_n3_user_key;
END;
$$;

-- Lock down: only the service role (used by server code) or a database
-- superuser via SQL editor can invoke this.
REVOKE ALL ON FUNCTION public.hotelhub_provision_owner(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hotelhub_provision_owner(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hotelhub_provision_owner(text, text) TO service_role;

-- Unique constraint needed for ON CONFLICT above. Safe if it already exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'hotel_user_roles_tenant_user_key_uniq'
  ) THEN
    CREATE UNIQUE INDEX hotel_user_roles_tenant_user_key_uniq
      ON public.hotel_user_roles (tenant_id, n3_user_key);
  END IF;
END $$;
