-- Corrective migration (additive). The earlier applied migration
-- 20260824093329 is left untouched.

-- (a) Preserve every EXISTING property on owner_approval.
UPDATE public.hotel_settings
   SET exception_approval_mode = 'owner_approval'
 WHERE exception_approval_mode IS NULL;

-- (b) Only the default for FUTURE rows becomes 'direct'.
ALTER TABLE public.hotel_settings
  ALTER COLUMN exception_approval_mode SET DEFAULT 'direct';

-- ---------------------------------------------------------------------------
-- Fixed 30-day housekeeping retention. No caller-supplied day count.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hotelhub_housekeeping_history_preview_30d(
  p_tenant_id uuid
)
RETURNS TABLE (out_cutoff timestamptz, out_count integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz;
  v_count integer := 0;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'validation_failed';
  END IF;
  v_cutoff := now() - interval '30 days';
  SELECT count(*)::integer INTO v_count
    FROM public.hotel_housekeeping_events
   WHERE tenant_id = p_tenant_id
     AND created_at < v_cutoff;
  RETURN QUERY SELECT v_cutoff, v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.hotelhub_purge_housekeeping_history_30d(
  p_tenant_id uuid,
  p_actor_n3_user_key text
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
  IF p_actor_n3_user_key IS NULL OR length(btrim(p_actor_n3_user_key)) = 0 THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  v_cutoff := now() - interval '30 days';

  DELETE FROM public.hotel_housekeeping_events
   WHERE tenant_id = p_tenant_id
     AND created_at < v_cutoff;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
  VALUES (
    p_tenant_id,
    p_actor_n3_user_key,
    'hotel.housekeeping.history_purged',
    jsonb_build_object('days', 30, 'cutoff', v_cutoff, 'deleted', v_deleted)
  );

  RETURN QUERY SELECT v_deleted, v_cutoff;
END;
$$;

REVOKE ALL ON FUNCTION public.hotelhub_housekeeping_history_preview_30d(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hotelhub_purge_housekeeping_history_30d(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hotelhub_housekeeping_history_preview_30d(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.hotelhub_purge_housekeeping_history_30d(uuid, text) TO service_role;

-- The selectable-day routine is retired now that the safe fixed-window
-- replacements exist.
REVOKE ALL ON FUNCTION public.hotelhub_purge_housekeeping_history(uuid, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.hotelhub_purge_housekeeping_history(uuid, text, integer);

-- ---------------------------------------------------------------------------
-- Atomic direct execution of a reservation exception.
--
-- ONE transaction: the SAME authoritative request engine followed by the SAME
-- approve/apply engine, so every validation, concurrency, availability,
-- capacity and tenant gate already enforced there applies unchanged. Any
-- failure raises and rolls the whole thing back — no stranded pending
-- request, no partial mutation, no partial timeline or audit row.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hotelhub_direct_operation(
  p_tenant_id uuid,
  p_reservation_id uuid,
  p_actor_n3_user_key text,
  p_operation_type text,
  p_payload jsonb,
  p_idempotency_key text
)
RETURNS TABLE (out_request_id uuid, out_state text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id uuid;
  v_state text;
BEGIN
  IF p_tenant_id IS NULL OR p_reservation_id IS NULL THEN
    RAISE EXCEPTION 'reservation_not_found';
  END IF;
  IF p_actor_n3_user_key IS NULL OR length(btrim(p_actor_n3_user_key)) = 0 THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'validation_failed';
  END IF;

  SELECT r.out_request_id, r.out_state
    INTO v_request_id, v_state
    FROM public.hotelhub_request_operation(
      p_tenant_id,
      p_reservation_id,
      p_actor_n3_user_key,
      p_operation_type,
      p_payload,
      p_idempotency_key
    ) AS r;

  IF v_request_id IS NULL THEN
    RAISE EXCEPTION 'operation_request_failed';
  END IF;

  -- Replay of an already-applied direct action returns the same result and
  -- performs no further mutation.
  IF v_state <> 'pending' THEN
    RETURN QUERY SELECT v_request_id, v_state;
    RETURN;
  END IF;

  SELECT d.out_request_id, d.out_state
    INTO v_request_id, v_state
    FROM public.hotelhub_decide_operation(
      p_tenant_id,
      v_request_id,
      p_actor_n3_user_key,
      'approve',
      NULL,
      p_idempotency_key || ':direct'
    ) AS d;

  IF v_state = 'pending' THEN
    RAISE EXCEPTION 'operation_decision_failed';
  END IF;

  RETURN QUERY SELECT v_request_id, v_state;
END;
$$;

REVOKE ALL ON FUNCTION public.hotelhub_direct_operation(uuid, uuid, text, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hotelhub_direct_operation(uuid, uuid, text, text, jsonb, text)
  TO service_role;