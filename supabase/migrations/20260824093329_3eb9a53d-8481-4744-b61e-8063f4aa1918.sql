ALTER TABLE public.hotel_settings
  ADD COLUMN IF NOT EXISTS exception_approval_mode text NOT NULL DEFAULT 'owner_approval';

ALTER TABLE public.hotel_settings
  DROP CONSTRAINT IF EXISTS hotel_settings_exception_approval_mode_check;

ALTER TABLE public.hotel_settings
  ADD CONSTRAINT hotel_settings_exception_approval_mode_check
  CHECK (exception_approval_mode IN ('owner_approval', 'direct'));

CREATE OR REPLACE FUNCTION public.hotelhub_purge_housekeeping_history(
  p_tenant_id uuid,
  p_actor_n3_user_key text,
  p_days integer DEFAULT 30
)
RETURNS TABLE (out_deleted integer, out_cutoff timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz;
  v_deleted integer := 0;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'validation_failed';
  END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 3650 THEN
    RAISE EXCEPTION 'validation_failed';
  END IF;

  v_cutoff := now() - make_interval(days => p_days);

  DELETE FROM public.hotel_housekeeping_events
   WHERE tenant_id = p_tenant_id
     AND created_at < v_cutoff;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
  VALUES (
    p_tenant_id,
    p_actor_n3_user_key,
    'hotel.housekeeping.history_purged',
    jsonb_build_object('days', p_days, 'cutoff', v_cutoff, 'deleted', v_deleted)
  );

  RETURN QUERY SELECT v_deleted, v_cutoff;
END;
$$;

REVOKE ALL ON FUNCTION public.hotelhub_purge_housekeeping_history(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hotelhub_purge_housekeeping_history(uuid, text, integer) TO service_role;