-- HotelHub P1 correction — durable vacated-room handoff for approved room changes.

CREATE TABLE public.hotel_housekeeping_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.hotel_tenants(id) ON DELETE CASCADE,
  hotel_room_id uuid NOT NULL REFERENCES public.hotel_rooms(id) ON DELETE CASCADE,
  reservation_id uuid REFERENCES public.hotel_reservations(id) ON DELETE SET NULL,
  operation_request_id uuid,
  source text NOT NULL DEFAULT 'room_change',
  actor_n3_user_key text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_hk_handoffs_state_chk CHECK (state IN ('pending','applied','cancelled'))
);

GRANT ALL ON public.hotel_housekeeping_handoffs TO service_role;

ALTER TABLE public.hotel_housekeeping_handoffs ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: this queue is server-only bookkeeping reached
-- exclusively through SECURITY DEFINER routines / the service role.

CREATE UNIQUE INDEX hotel_hk_handoffs_op_room_uniq
  ON public.hotel_housekeeping_handoffs (tenant_id, operation_request_id, hotel_room_id)
  WHERE operation_request_id IS NOT NULL;

CREATE INDEX hotel_hk_handoffs_pending_idx
  ON public.hotel_housekeeping_handoffs (tenant_id, created_at)
  WHERE state = 'pending';

CREATE OR REPLACE FUNCTION public.hotelhub_hk_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER hotel_hk_handoffs_touch
  BEFORE UPDATE ON public.hotel_housekeeping_handoffs
  FOR EACH ROW EXECUTE FUNCTION public.hotelhub_hk_touch_updated_at();

-- Record the intent BEFORE the room change is approved, so a crash between
-- approval and housekeeping bookkeeping is recoverable instead of silent.
CREATE OR REPLACE FUNCTION public.hotelhub_hk_enqueue_handoff(
  p_tenant_id uuid,
  p_hotel_room_id uuid,
  p_actor_n3_user_key text,
  p_reservation_id uuid DEFAULT NULL,
  p_operation_request_id uuid DEFAULT NULL,
  p_source text DEFAULT 'room_change'
) RETURNS TABLE (out_handoff_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
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

-- The approval did not happen: drop the recorded intent.
CREATE OR REPLACE FUNCTION public.hotelhub_hk_cancel_handoff(
  p_tenant_id uuid,
  p_handoff_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE hotel_housekeeping_handoffs
    SET state = 'cancelled', resolved_at = now()
    WHERE tenant_id = p_tenant_id AND id = p_handoff_id AND state = 'pending';
END;
$$;

-- Atomic apply: room becomes Dirty, Do Not Disturb is cleared, history is
-- written and the handoff is closed in ONE transaction. A room that was never
-- set up is set up as Dirty rather than skipped: a room a guest just left is
-- certainly not verified clean.
CREATE OR REPLACE FUNCTION public.hotelhub_hk_vacate_room_v2(
  p_tenant_id uuid,
  p_hotel_room_id uuid,
  p_actor_n3_user_key text,
  p_source text DEFAULT 'room_change',
  p_handoff_id uuid DEFAULT NULL
) RETURNS TABLE (out_previous text, out_condition text, out_applied boolean, out_created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cur text;
  v_dnd boolean;
  v_created boolean := false;
BEGIN
  PERFORM 1 FROM hotel_rooms
    WHERE tenant_id = p_tenant_id AND id = p_hotel_room_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HH104 room_not_found';
  END IF;

  SELECT condition, dnd_active INTO v_cur, v_dnd FROM hotel_room_housekeeping
    WHERE tenant_id = p_tenant_id AND hotel_room_id = p_hotel_room_id FOR UPDATE;

  IF v_cur IS NULL THEN
    INSERT INTO hotel_room_housekeeping (
      tenant_id, hotel_room_id, condition, dnd_active,
      initialized_at, initialized_by_n3_user_key,
      last_action, last_actor_n3_user_key, last_transition_at
    ) VALUES (
      p_tenant_id, p_hotel_room_id, 'dirty', false,
      now(), p_actor_n3_user_key, 'vacated', p_actor_n3_user_key, now()
    );
    v_created := true;
    v_dnd := false;
  ELSE
    UPDATE hotel_room_housekeeping SET
      condition = 'dirty', dnd_active = false, dnd_set_at = NULL,
      dnd_set_by_n3_user_key = NULL, last_action = 'vacated',
      last_actor_n3_user_key = p_actor_n3_user_key,
      last_transition_at = now(), updated_at = now()
    WHERE tenant_id = p_tenant_id AND hotel_room_id = p_hotel_room_id;
  END IF;

  INSERT INTO hotel_housekeeping_events (
    tenant_id, hotel_room_id, action, previous_condition, resulting_condition,
    dnd_before, dnd_after, actor_n3_user_key, source
  ) VALUES (
    p_tenant_id, p_hotel_room_id, 'vacated', v_cur, 'dirty',
    v_dnd, false, p_actor_n3_user_key, p_source
  );

  IF p_handoff_id IS NOT NULL THEN
    UPDATE hotel_housekeeping_handoffs
      SET state = 'applied', resolved_at = now(), last_error = NULL
      WHERE tenant_id = p_tenant_id AND id = p_handoff_id;
  END IF;

  RETURN QUERY SELECT v_cur, 'dirty'::text, true, v_created;
END;
$$;

-- Retry support: record a failed attempt without losing the pending intent.
CREATE OR REPLACE FUNCTION public.hotelhub_hk_fail_handoff(
  p_tenant_id uuid,
  p_handoff_id uuid,
  p_error text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE hotel_housekeeping_handoffs
    SET attempts = attempts + 1, last_error = left(coalesce(p_error, ''), 300)
    WHERE tenant_id = p_tenant_id AND id = p_handoff_id AND state = 'pending';
END;
$$;

CREATE OR REPLACE FUNCTION public.hotelhub_hk_list_pending_handoffs(
  p_tenant_id uuid,
  p_limit integer DEFAULT 20
) RETURNS TABLE (
  out_id uuid,
  out_hotel_room_id uuid,
  out_reservation_id uuid,
  out_actor_n3_user_key text,
  out_source text,
  out_attempts integer
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT id, hotel_room_id, reservation_id, actor_n3_user_key, source, attempts
    FROM hotel_housekeeping_handoffs
    WHERE tenant_id = p_tenant_id AND state = 'pending' AND attempts < 10
    ORDER BY created_at
    LIMIT greatest(least(coalesce(p_limit, 20), 100), 1);
$$;

REVOKE ALL ON FUNCTION public.hotelhub_hk_enqueue_handoff(uuid, uuid, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hotelhub_hk_cancel_handoff(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hotelhub_hk_vacate_room_v2(uuid, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hotelhub_hk_fail_handoff(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hotelhub_hk_list_pending_handoffs(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hotelhub_hk_enqueue_handoff(uuid, uuid, text, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hotelhub_hk_cancel_handoff(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.hotelhub_hk_vacate_room_v2(uuid, uuid, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.hotelhub_hk_fail_handoff(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hotelhub_hk_list_pending_handoffs(uuid, integer) TO service_role;