-- Additive corrective migration. 20260824093329 and 20260824095539 are left
-- untouched.

-- ---------------------------------------------------------------------------
-- Tenant-scoped housekeeping readiness, evaluated INSIDE the caller's
-- transaction with the safety-relevant rows locked so readiness cannot change
-- between the check and the apply. Returns NULL when every room is usable, or
-- the stable refusal code for the first room that is not.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hotelhub_hk_readiness_blocker_locked(
  p_tenant_id uuid,
  p_room_ids uuid[]
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room_id uuid;
  v_active boolean;
  v_exists boolean;
  v_condition text;
  v_dnd boolean;
  v_pending integer;
BEGIN
  IF p_tenant_id IS NULL THEN
    RETURN 'validation_failed';
  END IF;
  IF p_room_ids IS NULL OR array_length(p_room_ids, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  FOREACH v_room_id IN ARRAY p_room_ids LOOP
    -- Lock the room record. An unreadable/absent room fails closed.
    SELECT r.is_active INTO v_active
      FROM public.hotel_rooms r
     WHERE r.tenant_id = p_tenant_id AND r.id = v_room_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RETURN 'room_not_found';
    END IF;
    IF v_active IS NOT TRUE THEN
      RETURN 'room_inactive';
    END IF;

    -- A queued vacated-room handover means the room is not usable yet.
    SELECT count(*)::integer INTO v_pending
      FROM public.hotel_housekeeping_handoffs h
     WHERE h.tenant_id = p_tenant_id
       AND h.hotel_room_id = v_room_id
       AND h.state = 'pending'
     FOR UPDATE;
    IF v_pending > 0 THEN
      RETURN 'handoff_pending';
    END IF;

    SELECT TRUE, hk.condition, hk.dnd_active
      INTO v_exists, v_condition, v_dnd
      FROM public.hotel_room_housekeeping hk
     WHERE hk.tenant_id = p_tenant_id AND hk.hotel_room_id = v_room_id
     FOR UPDATE;

    IF NOT FOUND OR v_condition IS NULL THEN
      RETURN 'housekeeping_not_initialized';
    END IF;
    IF v_condition <> 'ready' THEN
      RETURN 'room_' || v_condition;
    END IF;
    IF v_dnd IS TRUE THEN
      RETURN 'dnd_active';
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.hotelhub_hk_readiness_blocker_locked(uuid, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hotelhub_hk_readiness_blocker_locked(uuid, uuid[])
  TO service_role;

-- ---------------------------------------------------------------------------
-- Atomic DIRECT execution, corrected.
--
-- ONE transaction owns: idempotent request lookup/create, locked readiness and
-- Do Not Disturb / pending-handover checks, resolution of the room actually
-- being vacated, the durable handover correlated to the NEW request id, and
-- the existing approve/apply engine. Any failure rolls all of it back.
--
-- Replay with the same idempotency key returns the same terminal result and
-- performs no readiness mutation and creates no second handover.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hotelhub_direct_operation_v2(
  p_tenant_id uuid,
  p_reservation_id uuid,
  p_actor_n3_user_key text,
  p_operation_type text,
  p_payload jsonb,
  p_idempotency_key text
)
RETURNS TABLE (
  out_request_id uuid,
  out_state text,
  out_handoff_id uuid,
  out_old_room_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id uuid;
  v_state text;
  v_blocker text;
  v_dest uuid;
  v_rrid uuid;
  v_old_room uuid;
  v_handoff_id uuid;
  v_room_ids uuid[];
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

  -- (b) Replay of an already-decided action: return the SAME result, touch
  -- nothing, and hand back the handover already correlated to this request.
  IF v_state IS DISTINCT FROM 'pending' THEN
    SELECT h.id, h.hotel_room_id INTO v_handoff_id, v_old_room
      FROM public.hotel_housekeeping_handoffs h
     WHERE h.tenant_id = p_tenant_id
       AND h.operation_request_id = v_request_id
     ORDER BY h.created_at ASC
     LIMIT 1;
    RETURN QUERY SELECT v_request_id, v_state, v_handoff_id, v_old_room;
    RETURN;
  END IF;

  -- (c) Fresh pending action: locked readiness gates inside THIS transaction.
  IF p_operation_type = 'early_check_in' THEN
    SELECT array_agg(rr.hotel_room_id) INTO v_room_ids
      FROM public.hotel_reservation_rooms rr
     WHERE rr.tenant_id = p_tenant_id
       AND rr.reservation_id = p_reservation_id
       AND rr.allocation_status <> 'released';
    v_blocker := public.hotelhub_hk_readiness_blocker_locked(p_tenant_id, v_room_ids);
    IF v_blocker IS NOT NULL THEN
      RAISE EXCEPTION '%', v_blocker;
    END IF;

  ELSIF p_operation_type = 'room_change' THEN
    v_dest := nullif(coalesce(
      p_payload ->> 'to_hotel_room_id',
      p_payload ->> 'toHotelRoomId'
    ), '')::uuid;
    v_rrid := nullif(coalesce(
      p_payload ->> 'reservation_room_id',
      p_payload ->> 'reservationRoomId'
    ), '')::uuid;
    IF v_dest IS NULL OR v_rrid IS NULL THEN
      RAISE EXCEPTION 'validation_failed';
    END IF;

    v_blocker := public.hotelhub_hk_readiness_blocker_locked(p_tenant_id, ARRAY[v_dest]);
    IF v_blocker IS NOT NULL THEN
      -- Same destination-specific vocabulary the approval path uses.
      v_blocker := CASE v_blocker
        WHEN 'housekeeping_not_initialized' THEN 'destination_housekeeping_not_initialized'
        WHEN 'room_not_ready' THEN 'destination_room_not_ready'
        WHEN 'room_dirty' THEN 'destination_room_dirty'
        WHEN 'room_cleaning' THEN 'destination_room_cleaning'
        WHEN 'room_inspected' THEN 'destination_room_inspected'
        WHEN 'dnd_active' THEN 'destination_dnd_active'
        ELSE v_blocker
      END;
      RAISE EXCEPTION '%', v_blocker;
    END IF;

    -- (d) The room actually being vacated, resolved and locked BEFORE apply.
    SELECT rr.hotel_room_id INTO v_old_room
      FROM public.hotel_reservation_rooms rr
     WHERE rr.tenant_id = p_tenant_id
       AND rr.reservation_id = p_reservation_id
       AND rr.id = v_rrid
     FOR UPDATE;
    IF v_old_room IS NULL THEN
      RAISE EXCEPTION 'reservation_room_unresolved';
    END IF;

    SELECT e.out_handoff_id INTO v_handoff_id
      FROM public.hotelhub_hk_enqueue_handoff(
        p_tenant_id,
        v_old_room,
        p_actor_n3_user_key,
        p_reservation_id,
        v_request_id,
        'room_change'
      ) AS e;
    IF v_handoff_id IS NULL THEN
      RAISE EXCEPTION 'handoff_not_recorded';
    END IF;
  END IF;

  -- (e) The existing authoritative approve/apply engine.
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

  RETURN QUERY SELECT v_request_id, v_state, v_handoff_id, v_old_room;
END;
$$;

REVOKE ALL ON FUNCTION public.hotelhub_direct_operation_v2(uuid, uuid, text, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hotelhub_direct_operation_v2(uuid, uuid, text, text, jsonb, text)
  TO service_role;

-- The superseded single-shot routine had no in-transaction handover and is
-- retired now that the corrected replacement exists.
REVOKE ALL ON FUNCTION public.hotelhub_direct_operation(uuid, uuid, text, text, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.hotelhub_direct_operation(uuid, uuid, text, text, jsonb, text);