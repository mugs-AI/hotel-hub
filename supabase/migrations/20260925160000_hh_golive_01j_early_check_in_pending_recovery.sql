-- HH-GOLIVE-01J: resume a matching legacy pending early check-in in the
-- same locked request/readiness/apply transaction. This is additive and must
-- be applied only under the separately authorised HotelHub DB migration gate.
-- Existing applied migrations are unchanged. No data backfill or purge.
-- The function signature and grants stay the same; generated types are N/A.

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
  v_pending public.hotel_reservation_operation_requests%ROWTYPE;
  v_request public.hotel_reservation_operation_requests%ROWTYPE;
  v_replay public.hotel_reservation_operation_requests%ROWTYPE;
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

  -- A recovered request retains its immutable original request key. Its
  -- decision key records the new direct click. Serialize retries of that
  -- click so a transport-uncertain retry finds the committed result instead
  -- of creating a second request after the pending unique slot is released.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::text || ':' || p_idempotency_key, 0)
  );
  IF p_operation_type = 'early_check_in' THEN
    SELECT * INTO v_replay
      FROM public.hotel_reservation_operation_requests
     WHERE tenant_id = p_tenant_id
       AND decision_idempotency_key = p_idempotency_key || ':direct'
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE;
    IF FOUND THEN
      IF v_replay.reservation_id IS DISTINCT FROM p_reservation_id
         OR v_replay.operation_type IS DISTINCT FROM p_operation_type
         OR v_replay.requested_by_n3_user_key IS DISTINCT FROM p_actor_n3_user_key
         OR v_replay.payload IS DISTINCT FROM COALESCE(p_payload, '{}'::jsonb)
         OR v_replay.state IS DISTINCT FROM 'applied' THEN
        RAISE EXCEPTION USING ERRCODE = 'HH219', MESSAGE = 'idempotency_conflict';
      END IF;
      RETURN QUERY SELECT v_replay.id, v_replay.state, NULL::uuid, NULL::uuid;
      RETURN;
    END IF;
  END IF;

  -- Existing direct retries keep their idempotency key. Older approval-mode
  -- attempts may have left a pending early-check-in request with a different
  -- key. Only the same actor and identical validated payload may resume it.
  -- The nested block rolls back the failed insert before inspecting that row.
  BEGIN
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
  EXCEPTION WHEN SQLSTATE 'HH225' THEN
    IF p_operation_type <> 'early_check_in' THEN
      RAISE;
    END IF;
    SELECT * INTO v_pending
      FROM public.hotel_reservation_operation_requests
     WHERE tenant_id = p_tenant_id
       AND reservation_id = p_reservation_id
       AND operation_type = 'early_check_in'
       AND state = 'pending'
     FOR UPDATE;
    IF NOT FOUND
       OR v_pending.requested_by_n3_user_key IS DISTINCT FROM p_actor_n3_user_key
       OR v_pending.payload IS DISTINCT FROM COALESCE(p_payload, '{}'::jsonb) THEN
      RAISE EXCEPTION USING ERRCODE = 'HH225', MESSAGE = 'operation_pending';
    END IF;
    v_request_id := v_pending.id;
    v_state := v_pending.state;
  END;

  IF v_request_id IS NULL THEN
    RAISE EXCEPTION 'operation_request_failed';
  END IF;

  -- The request routine can replay a tenant-scoped idempotency key. Bind the
  -- returned row to this exact reservation, type, actor and payload before a
  -- terminal replay or apply; another reservation can never be checked in.
  SELECT * INTO v_request
    FROM public.hotel_reservation_operation_requests
   WHERE tenant_id = p_tenant_id AND id = v_request_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_request.reservation_id IS DISTINCT FROM p_reservation_id
     OR v_request.operation_type IS DISTINCT FROM p_operation_type
     OR v_request.requested_by_n3_user_key IS DISTINCT FROM p_actor_n3_user_key
     OR v_request.payload IS DISTINCT FROM COALESCE(p_payload, '{}'::jsonb) THEN
    RAISE EXCEPTION USING ERRCODE = 'HH219', MESSAGE = 'idempotency_conflict';
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
