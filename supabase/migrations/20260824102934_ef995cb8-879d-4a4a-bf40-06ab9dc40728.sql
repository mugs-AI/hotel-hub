-- Additive runtime repair. 20260824093329, 20260824095539 and 20260824101612
-- are left untouched.
--
-- PostgreSQL rejects FOR UPDATE together with an aggregate (SQLSTATE 0A000),
-- so the pending-handover probe in hotelhub_hk_readiness_blocker_locked could
-- never run. It is replaced with a row-level lock over the matching handover
-- rows, using FOUND semantics.
--
-- The "no matching handover row yet" race is closed by locking the same
-- tenant+room hotel_rooms row in BOTH routines: readiness already takes that
-- lock, and hotelhub_hk_enqueue_handoff now takes it before it checks or
-- inserts, so a concurrent enqueue serialises behind readiness/apply.

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
  v_handoff_id uuid;
BEGIN
  IF p_tenant_id IS NULL THEN
    RETURN 'validation_failed';
  END IF;
  IF p_room_ids IS NULL OR array_length(p_room_ids, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  FOREACH v_room_id IN ARRAY p_room_ids LOOP
    CONTINUE WHEN v_room_id IS NULL;

    -- Lock the room record. An unreadable/absent room fails closed. This lock
    -- is also what a concurrent hotelhub_hk_enqueue_handoff must wait on.
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
    -- Row-level lock, never an aggregate: FOR UPDATE with count() is illegal.
    SELECT h.id INTO v_handoff_id
      FROM public.hotel_housekeeping_handoffs h
     WHERE h.tenant_id = p_tenant_id
       AND h.hotel_room_id = v_room_id
       AND h.state = 'pending'
     ORDER BY h.created_at ASC
     LIMIT 1
     FOR UPDATE;
    IF FOUND AND v_handoff_id IS NOT NULL THEN
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
-- Same signature, same idempotency semantics, same privileges. The only change
-- is the tenant+room row lock taken first, which serialises this insert
-- against a readiness/apply transaction that holds the same room lock.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hotelhub_hk_enqueue_handoff(
  p_tenant_id uuid,
  p_hotel_room_id uuid,
  p_actor_n3_user_key text,
  p_reservation_id uuid DEFAULT NULL::uuid,
  p_operation_request_id uuid DEFAULT NULL::uuid,
  p_source text DEFAULT 'room_change'::text
)
RETURNS TABLE(out_handoff_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_room uuid;
BEGIN
  -- Serialise against readiness/apply on the SAME tenant+room row.
  SELECT r.id INTO v_room
    FROM public.hotel_rooms r
   WHERE r.tenant_id = p_tenant_id AND r.id = p_hotel_room_id
   FOR UPDATE;
  IF v_room IS NULL THEN
    RETURN QUERY SELECT NULL::uuid;
    RETURN;
  END IF;

  IF p_operation_request_id IS NOT NULL THEN
    SELECT id INTO v_id FROM hotel_housekeeping_handoffs
      WHERE tenant_id = p_tenant_id
        AND operation_request_id = p_operation_request_id
        AND hotel_room_id = p_hotel_room_id
      FOR UPDATE;
    IF v_id IS NOT NULL THEN
      UPDATE hotel_housekeeping_handoffs
        SET state = 'pending', resolved_at = NULL
        WHERE id = v_id AND state = 'cancelled';
      RETURN QUERY SELECT v_id;
      RETURN;
    END IF;
  END IF;

  INSERT INTO hotel_housekeeping_handoffs (
    tenant_id, hotel_room_id, reservation_id, operation_request_id, source,
    actor_n3_user_key, state
  ) VALUES (
    p_tenant_id, p_hotel_room_id, p_reservation_id, p_operation_request_id,
    p_source, p_actor_n3_user_key, 'pending'
  ) RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.hotelhub_hk_enqueue_handoff(uuid, uuid, text, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hotelhub_hk_enqueue_handoff(uuid, uuid, text, uuid, uuid, text)
  TO service_role;