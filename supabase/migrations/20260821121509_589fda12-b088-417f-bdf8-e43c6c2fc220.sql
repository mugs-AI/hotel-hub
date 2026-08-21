-- HotelHub WP1 — Housekeeping & Room Turnaround (additive only).

-- 1. Housekeeping workflow mode on the EXISTING settings mechanism.
ALTER TABLE public.hotel_settings
  ADD COLUMN IF NOT EXISTS housekeeping_mode text NOT NULL DEFAULT 'simple';

ALTER TABLE public.hotel_settings
  DROP CONSTRAINT IF EXISTS hotel_settings_housekeeping_mode_valid;
ALTER TABLE public.hotel_settings
  ADD CONSTRAINT hotel_settings_housekeeping_mode_valid
  CHECK (housekeeping_mode IN ('simple', 'dedicated'));

-- 2. Authoritative per-tenant/per-room housekeeping condition.
CREATE TABLE IF NOT EXISTS public.hotel_room_housekeeping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.hotel_tenants(id) ON DELETE CASCADE,
  hotel_room_id uuid NOT NULL,
  condition text NOT NULL,
  dnd_active boolean NOT NULL DEFAULT false,
  dnd_set_at timestamptz,
  dnd_set_by_n3_user_key text,
  initialized_at timestamptz NOT NULL DEFAULT now(),
  initialized_by_n3_user_key text NOT NULL,
  last_action text,
  last_actor_n3_user_key text,
  last_transition_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_room_housekeeping_condition_valid
    CHECK (condition IN ('dirty', 'cleaning', 'inspected', 'ready')),
  CONSTRAINT hotel_room_housekeeping_note_len
    CHECK (note IS NULL OR length(note) <= 300),
  CONSTRAINT hotel_room_housekeeping_tenant_room_uk UNIQUE (tenant_id, hotel_room_id),
  CONSTRAINT hotel_room_housekeeping_tenant_room_fkey
    FOREIGN KEY (tenant_id, hotel_room_id)
    REFERENCES public.hotel_rooms(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS hotel_room_housekeeping_tenant_idx
  ON public.hotel_room_housekeeping (tenant_id, condition);

GRANT ALL ON public.hotel_room_housekeeping TO service_role;
ALTER TABLE public.hotel_room_housekeeping ENABLE ROW LEVEL SECURITY;

-- 3. Immutable housekeeping history.
CREATE TABLE IF NOT EXISTS public.hotel_housekeeping_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.hotel_tenants(id) ON DELETE CASCADE,
  hotel_room_id uuid NOT NULL,
  action text NOT NULL,
  previous_condition text,
  resulting_condition text,
  dnd_before boolean,
  dnd_after boolean,
  actor_n3_user_key text NOT NULL,
  source text NOT NULL DEFAULT 'app',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_housekeeping_events_action_valid CHECK (action IN (
    'initialize', 'start_cleaning', 'finish_cleaning', 'mark_ready',
    'mark_dirty', 'revert_to_cleaning', 'set_dnd', 'clear_dnd', 'vacated'
  )),
  CONSTRAINT hotel_housekeeping_events_prev_valid
    CHECK (previous_condition IS NULL OR previous_condition IN ('dirty','cleaning','inspected','ready')),
  CONSTRAINT hotel_housekeeping_events_result_valid
    CHECK (resulting_condition IS NULL OR resulting_condition IN ('dirty','cleaning','inspected','ready')),
  CONSTRAINT hotel_housekeeping_events_note_len CHECK (note IS NULL OR length(note) <= 300),
  CONSTRAINT hotel_housekeeping_events_tenant_room_fkey
    FOREIGN KEY (tenant_id, hotel_room_id)
    REFERENCES public.hotel_rooms(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS hotel_housekeeping_events_room_idx
  ON public.hotel_housekeeping_events (tenant_id, hotel_room_id, created_at DESC);

GRANT ALL ON public.hotel_housekeeping_events TO service_role;
ALTER TABLE public.hotel_housekeeping_events ENABLE ROW LEVEL SECURITY;

-- 4. WP1-only atomic routines (new names; nothing deployed is replaced).

CREATE OR REPLACE FUNCTION public.hotelhub_hk_initialize_room(
  p_tenant_id uuid,
  p_hotel_room_id uuid,
  p_actor_n3_user_key text,
  p_condition text,
  p_source text DEFAULT 'owner_bootstrap'
) RETURNS TABLE (out_condition text, out_dnd boolean, out_created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_room uuid; v_existing text;
BEGIN
  IF p_condition NOT IN ('ready', 'dirty') THEN
    RAISE EXCEPTION 'HH100 invalid_condition';
  END IF;
  SELECT id INTO v_room FROM hotel_rooms
    WHERE id = p_hotel_room_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF v_room IS NULL THEN RAISE EXCEPTION 'HH101 room_not_found'; END IF;

  SELECT condition INTO v_existing FROM hotel_room_housekeeping
    WHERE tenant_id = p_tenant_id AND hotel_room_id = p_hotel_room_id FOR UPDATE;
  IF v_existing IS NOT NULL THEN
    -- Already initialized: idempotent no-op, never a silent re-assertion.
    RETURN QUERY SELECT v_existing, h.dnd_active, false
      FROM hotel_room_housekeeping h
      WHERE h.tenant_id = p_tenant_id AND h.hotel_room_id = p_hotel_room_id;
    RETURN;
  END IF;

  INSERT INTO hotel_room_housekeeping (
    tenant_id, hotel_room_id, condition, initialized_by_n3_user_key,
    last_action, last_actor_n3_user_key, last_transition_at
  ) VALUES (
    p_tenant_id, p_hotel_room_id, p_condition, p_actor_n3_user_key,
    'initialize', p_actor_n3_user_key, now()
  );

  INSERT INTO hotel_housekeeping_events (
    tenant_id, hotel_room_id, action, previous_condition, resulting_condition,
    dnd_before, dnd_after, actor_n3_user_key, source
  ) VALUES (
    p_tenant_id, p_hotel_room_id, 'initialize', NULL, p_condition,
    false, false, p_actor_n3_user_key, p_source
  );

  RETURN QUERY SELECT p_condition, false, true;
END;
$$;

CREATE OR REPLACE FUNCTION public.hotelhub_hk_transition(
  p_tenant_id uuid,
  p_hotel_room_id uuid,
  p_actor_n3_user_key text,
  p_action text,
  p_note text DEFAULT NULL,
  p_source text DEFAULT 'app'
) RETURNS TABLE (out_previous text, out_condition text, out_dnd boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cur text; v_dnd boolean; v_next text;
BEGIN
  SELECT condition, dnd_active INTO v_cur, v_dnd FROM hotel_room_housekeeping
    WHERE tenant_id = p_tenant_id AND hotel_room_id = p_hotel_room_id FOR UPDATE;
  IF v_cur IS NULL THEN RAISE EXCEPTION 'HH102 housekeeping_not_initialized'; END IF;

  IF v_dnd AND p_action IN ('start_cleaning', 'finish_cleaning', 'mark_ready', 'revert_to_cleaning') THEN
    RAISE EXCEPTION 'HH103 dnd_active';
  END IF;

  v_next := CASE
    WHEN p_action = 'mark_dirty' AND v_cur IN ('ready', 'cleaning') THEN 'dirty'
    WHEN p_action = 'start_cleaning' AND v_cur = 'dirty' THEN 'cleaning'
    WHEN p_action = 'finish_cleaning' AND v_cur = 'cleaning' THEN 'inspected'
    WHEN p_action = 'mark_ready' AND v_cur = 'inspected' THEN 'ready'
    WHEN p_action = 'revert_to_cleaning' AND v_cur = 'inspected' THEN 'cleaning'
    ELSE NULL
  END;
  IF v_next IS NULL THEN RAISE EXCEPTION 'HH104 illegal_transition'; END IF;

  UPDATE hotel_room_housekeeping SET
    condition = v_next, last_action = p_action,
    last_actor_n3_user_key = p_actor_n3_user_key,
    last_transition_at = now(), note = p_note, updated_at = now()
  WHERE tenant_id = p_tenant_id AND hotel_room_id = p_hotel_room_id;

  INSERT INTO hotel_housekeeping_events (
    tenant_id, hotel_room_id, action, previous_condition, resulting_condition,
    dnd_before, dnd_after, actor_n3_user_key, source, note
  ) VALUES (
    p_tenant_id, p_hotel_room_id, p_action, v_cur, v_next,
    v_dnd, v_dnd, p_actor_n3_user_key, p_source, p_note
  );

  RETURN QUERY SELECT v_cur, v_next, v_dnd;
END;
$$;

CREATE OR REPLACE FUNCTION public.hotelhub_hk_set_dnd(
  p_tenant_id uuid,
  p_hotel_room_id uuid,
  p_actor_n3_user_key text,
  p_active boolean,
  p_source text DEFAULT 'app'
) RETURNS TABLE (out_condition text, out_dnd boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cur text; v_dnd boolean; v_occupied boolean;
BEGIN
  SELECT condition, dnd_active INTO v_cur, v_dnd FROM hotel_room_housekeeping
    WHERE tenant_id = p_tenant_id AND hotel_room_id = p_hotel_room_id FOR UPDATE;
  IF v_cur IS NULL THEN RAISE EXCEPTION 'HH102 housekeeping_not_initialized'; END IF;

  IF p_active THEN
    SELECT EXISTS (
      SELECT 1 FROM hotel_reservation_rooms rr
      JOIN hotel_reservations r ON r.id = rr.reservation_id AND r.tenant_id = rr.tenant_id
      WHERE rr.tenant_id = p_tenant_id AND rr.hotel_room_id = p_hotel_room_id
        AND r.status = 'checked_in' AND rr.allocation_status IN ('reserved', 'occupied')
    ) INTO v_occupied;
    IF NOT v_occupied THEN RAISE EXCEPTION 'HH105 room_not_occupied'; END IF;
    IF v_cur = 'cleaning' THEN RAISE EXCEPTION 'HH106 cleaning_in_progress'; END IF;
  END IF;

  IF v_dnd = p_active THEN
    RETURN QUERY SELECT v_cur, v_dnd;
    RETURN;
  END IF;

  UPDATE hotel_room_housekeeping SET
    dnd_active = p_active,
    dnd_set_at = CASE WHEN p_active THEN now() ELSE NULL END,
    dnd_set_by_n3_user_key = CASE WHEN p_active THEN p_actor_n3_user_key ELSE NULL END,
    updated_at = now()
  WHERE tenant_id = p_tenant_id AND hotel_room_id = p_hotel_room_id;

  INSERT INTO hotel_housekeeping_events (
    tenant_id, hotel_room_id, action, previous_condition, resulting_condition,
    dnd_before, dnd_after, actor_n3_user_key, source
  ) VALUES (
    p_tenant_id, p_hotel_room_id, CASE WHEN p_active THEN 'set_dnd' ELSE 'clear_dnd' END,
    v_cur, v_cur, v_dnd, p_active, p_actor_n3_user_key, p_source
  );

  RETURN QUERY SELECT v_cur, p_active;
END;
$$;

-- Vacated-room handoff: clear DND and make the room dirty. Called by the
-- room-change-away path now, and by a FUTURE final checkout. Does not touch
-- reservations, allocation or money.
CREATE OR REPLACE FUNCTION public.hotelhub_hk_vacate_room(
  p_tenant_id uuid,
  p_hotel_room_id uuid,
  p_actor_n3_user_key text,
  p_source text DEFAULT 'room_change'
) RETURNS TABLE (out_previous text, out_condition text, out_applied boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cur text; v_dnd boolean;
BEGIN
  SELECT condition, dnd_active INTO v_cur, v_dnd FROM hotel_room_housekeeping
    WHERE tenant_id = p_tenant_id AND hotel_room_id = p_hotel_room_id FOR UPDATE;
  IF v_cur IS NULL THEN
    -- Uninitialized rooms stay uninitialized: never fabricate a condition.
    RETURN QUERY SELECT NULL::text, NULL::text, false;
    RETURN;
  END IF;

  UPDATE hotel_room_housekeeping SET
    condition = 'dirty', dnd_active = false, dnd_set_at = NULL,
    dnd_set_by_n3_user_key = NULL, last_action = 'vacated',
    last_actor_n3_user_key = p_actor_n3_user_key,
    last_transition_at = now(), updated_at = now()
  WHERE tenant_id = p_tenant_id AND hotel_room_id = p_hotel_room_id;

  INSERT INTO hotel_housekeeping_events (
    tenant_id, hotel_room_id, action, previous_condition, resulting_condition,
    dnd_before, dnd_after, actor_n3_user_key, source
  ) VALUES (
    p_tenant_id, p_hotel_room_id, 'vacated', v_cur, 'dirty',
    v_dnd, false, p_actor_n3_user_key, p_source
  );

  RETURN QUERY SELECT v_cur, 'dirty'::text, true;
END;
$$;

REVOKE ALL ON FUNCTION public.hotelhub_hk_initialize_room(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hotelhub_hk_transition(uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hotelhub_hk_set_dnd(uuid, uuid, text, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hotelhub_hk_vacate_room(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hotelhub_hk_initialize_room(uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hotelhub_hk_transition(uuid, uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hotelhub_hk_set_dnd(uuid, uuid, text, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hotelhub_hk_vacate_room(uuid, uuid, text, text) TO service_role;