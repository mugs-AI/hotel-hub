-- =====================================================================
-- HotelHub Run 5D2 — Front Desk Reservation Operations
-- =====================================================================

-- ---------------------------------------------------------------
-- 1) Tenant-scoped staff directory (safe creator/actor display)
-- ---------------------------------------------------------------
CREATE TABLE public.hotel_user_directory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.hotel_tenants(id) ON DELETE CASCADE,
  n3_user_key text NOT NULL,
  display_name text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_user_directory_key_nonempty CHECK (length(btrim(n3_user_key)) > 0),
  CONSTRAINT hotel_user_directory_display_len CHECK (display_name IS NULL OR length(display_name) <= 200),
  CONSTRAINT hotel_user_directory_email_len CHECK (email IS NULL OR length(email) <= 320),
  CONSTRAINT hotel_user_directory_unique UNIQUE (tenant_id, n3_user_key)
);
GRANT ALL ON public.hotel_user_directory TO service_role;
ALTER TABLE public.hotel_user_directory ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER hotel_user_directory_touch_updated_at
  BEFORE UPDATE ON public.hotel_user_directory
  FOR EACH ROW EXECUTE FUNCTION public.hotelhub_touch_updated_at();

-- ---------------------------------------------------------------
-- 2) Reservation operational fields
-- ---------------------------------------------------------------
ALTER TABLE public.hotel_reservations
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS checked_in_by_n3_user_key text,
  ADD COLUMN IF NOT EXISTS expected_check_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS operational_note text;

ALTER TABLE public.hotel_reservations
  ADD CONSTRAINT hotel_reservations_operational_note_len
    CHECK (operational_note IS NULL OR length(operational_note) <= 500);

-- ---------------------------------------------------------------
-- 3) Operation approval ledger
-- ---------------------------------------------------------------
CREATE TABLE public.hotel_reservation_operation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.hotel_tenants(id) ON DELETE CASCADE,
  reservation_id uuid NOT NULL,
  operation_type text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by_n3_user_key text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by_n3_user_key text,
  decided_at timestamptz,
  decision_note text,
  decision_idempotency_key text,
  applied_at timestamptz,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_reservation_operation_requests_tenant_reservation_fkey
    FOREIGN KEY (reservation_id, tenant_id)
    REFERENCES public.hotel_reservations(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT hotel_reservation_operation_requests_type_valid CHECK (
    operation_type IN ('early_check_in','late_checkout','room_change','stay_extension','rate_change')
  ),
  CONSTRAINT hotel_reservation_operation_requests_state_valid CHECK (
    state IN ('pending','approved','rejected','applied','cancelled')
  ),
  CONSTRAINT hotel_reservation_operation_requests_note_len CHECK (
    decision_note IS NULL OR length(decision_note) <= 300
  ),
  -- Decision timestamps/identities must accompany a decided state.
  CONSTRAINT hotel_reservation_operation_requests_decision_shape CHECK (
    (state = 'pending' AND decided_at IS NULL AND decided_by_n3_user_key IS NULL)
    OR (state = 'cancelled')
    OR (state IN ('approved','rejected','applied')
        AND decided_at IS NOT NULL AND decided_by_n3_user_key IS NOT NULL)
  ),
  CONSTRAINT hotel_reservation_operation_requests_applied_shape CHECK (
    (state = 'applied' AND applied_at IS NOT NULL) OR (state <> 'applied' AND applied_at IS NULL)
  ),
  CONSTRAINT hotel_reservation_operation_requests_idem_key_nonempty CHECK (
    length(btrim(idempotency_key)) > 0
  ),
  CONSTRAINT hotel_reservation_operation_requests_idem_unique UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX hotel_reservation_operation_requests_tenant_res_idx
  ON public.hotel_reservation_operation_requests (tenant_id, reservation_id, created_at DESC);
CREATE INDEX hotel_reservation_operation_requests_pending_idx
  ON public.hotel_reservation_operation_requests (tenant_id, state, created_at DESC);
-- At most one pending request per reservation + operation type.
CREATE UNIQUE INDEX hotel_reservation_operation_requests_one_pending_idx
  ON public.hotel_reservation_operation_requests (tenant_id, reservation_id, operation_type)
  WHERE state = 'pending';
GRANT ALL ON public.hotel_reservation_operation_requests TO service_role;
ALTER TABLE public.hotel_reservation_operation_requests ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER hotel_reservation_operation_requests_touch_updated_at
  BEFORE UPDATE ON public.hotel_reservation_operation_requests
  FOR EACH ROW EXECUTE FUNCTION public.hotelhub_touch_updated_at();

-- Immutable fields after creation.
CREATE OR REPLACE FUNCTION public.hotelhub_operation_request_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id
     OR NEW.reservation_id <> OLD.reservation_id
     OR NEW.operation_type <> OLD.operation_type
     OR NEW.requested_by_n3_user_key <> OLD.requested_by_n3_user_key
     OR NEW.idempotency_key <> OLD.idempotency_key
     OR NEW.requested_at <> OLD.requested_at THEN
    RAISE EXCEPTION USING ERRCODE='HH201', MESSAGE='operation_immutable_field';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER hotel_reservation_operation_requests_immutable
  BEFORE UPDATE ON public.hotel_reservation_operation_requests
  FOR EACH ROW EXECUTE FUNCTION public.hotelhub_operation_request_immutable();

-- ---------------------------------------------------------------
-- 4) Reservation event timeline (append-only)
-- ---------------------------------------------------------------
CREATE TABLE public.hotel_reservation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.hotel_tenants(id) ON DELETE CASCADE,
  reservation_id uuid NOT NULL,
  event_type text NOT NULL,
  summary text NOT NULL,
  actor_n3_user_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_reservation_events_tenant_reservation_fkey
    FOREIGN KEY (reservation_id, tenant_id)
    REFERENCES public.hotel_reservations(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT hotel_reservation_events_type_valid CHECK (
    event_type IN (
      'reservation_created','reservation_edited','guest_added','guest_updated','guest_removed',
      'room_added','room_removed','operation_requested','operation_approved','operation_rejected',
      'checked_in','room_changed','stay_extended','late_checkout_approved','rate_changed'
    )
  ),
  CONSTRAINT hotel_reservation_events_summary_len CHECK (length(summary) BETWEEN 1 AND 300)
);
CREATE INDEX hotel_reservation_events_tenant_res_idx
  ON public.hotel_reservation_events (tenant_id, reservation_id, occurred_at DESC);
GRANT ALL ON public.hotel_reservation_events TO service_role;
ALTER TABLE public.hotel_reservation_events ENABLE ROW LEVEL SECURITY;

-- Append-only: block UPDATE/DELETE even for the service role.
CREATE OR REPLACE FUNCTION public.hotelhub_reservation_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='HH202', MESSAGE='reservation_events_append_only';
END;
$$;
CREATE TRIGGER hotel_reservation_events_no_update
  BEFORE UPDATE OR DELETE ON public.hotel_reservation_events
  FOR EACH ROW EXECUTE FUNCTION public.hotelhub_reservation_events_append_only();

-- ---------------------------------------------------------------
-- 5) Helper: property-local timestamp for a tenant
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hotelhub_property_now(p_tenant_id uuid)
RETURNS timestamp
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (now() AT TIME ZONE COALESCE(
    (SELECT s.timezone FROM public.hotel_settings s WHERE s.tenant_id = p_tenant_id),
    'Asia/Kuala_Lumpur'));
$$;

-- ---------------------------------------------------------------
-- 6) Check-in RPC
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hotelhub_check_in_reservation(
  p_tenant_id uuid,
  p_reservation_id uuid,
  p_actor_n3_user_key text,
  p_expected_updated_at timestamptz,
  p_allow_early boolean DEFAULT false,
  p_operation_request_id uuid DEFAULT NULL
) RETURNS TABLE(out_status text, out_checked_in_at timestamptz, out_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.hotel_reservations%ROWTYPE;
  v_local timestamp;
  v_ci_time text;
  v_rooms integer;
  v_guests integer;
BEGIN
  IF p_tenant_id IS NULL OR p_reservation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH210', MESSAGE='reservation_not_found';
  END IF;
  IF p_actor_n3_user_key IS NULL OR length(btrim(p_actor_n3_user_key)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH211', MESSAGE='unauthorized';
  END IF;

  SELECT * INTO v_row FROM public.hotel_reservations
    WHERE id = p_reservation_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='HH212', MESSAGE='reservation_not_found';
  END IF;

  -- Idempotent: already checked in returns the existing state unchanged.
  IF v_row.status = 'checked_in' THEN
    RETURN QUERY SELECT v_row.status, v_row.checked_in_at, v_row.updated_at;
    RETURN;
  END IF;
  IF v_row.status <> 'confirmed' THEN
    RAISE EXCEPTION USING ERRCODE='HH213', MESSAGE='invalid_transition';
  END IF;
  IF p_expected_updated_at IS NOT NULL AND v_row.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION USING ERRCODE='HH214', MESSAGE='reservation_changed';
  END IF;

  SELECT count(*) INTO v_rooms FROM public.hotel_reservation_rooms
    WHERE tenant_id = p_tenant_id AND reservation_id = p_reservation_id
      AND allocation_status IN ('reserved','occupied');
  SELECT count(*) INTO v_guests FROM public.hotel_reservation_guests
    WHERE tenant_id = p_tenant_id AND reservation_id = p_reservation_id;
  IF v_rooms < 1 OR v_guests < 1 THEN
    RAISE EXCEPTION USING ERRCODE='HH215', MESSAGE='invalid_transition';
  END IF;

  v_local := public.hotelhub_property_now(p_tenant_id);
  SELECT s.standard_check_in_time INTO v_ci_time
    FROM public.hotel_settings s WHERE s.tenant_id = p_tenant_id;
  v_ci_time := COALESCE(v_ci_time, '15:00');

  IF v_local::date < v_row.arrival_date THEN
    IF NOT p_allow_early THEN
      RAISE EXCEPTION USING ERRCODE='HH216', MESSAGE='early_check_in_required';
    END IF;
  ELSIF v_local::date = v_row.arrival_date
        AND v_local::time < v_ci_time::time
        AND NOT p_allow_early THEN
    RAISE EXCEPTION USING ERRCODE='HH217', MESSAGE='early_check_in_required';
  END IF;

  UPDATE public.hotel_reservations
    SET status = 'checked_in',
        checked_in_at = now(),
        checked_in_by_n3_user_key = p_actor_n3_user_key
    WHERE id = p_reservation_id AND tenant_id = p_tenant_id
    RETURNING * INTO v_row;

  UPDATE public.hotel_reservation_rooms
    SET allocation_status = 'occupied'
    WHERE tenant_id = p_tenant_id AND reservation_id = p_reservation_id
      AND allocation_status = 'reserved';

  INSERT INTO public.hotel_reservation_events
    (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
  VALUES (p_tenant_id, p_reservation_id, 'checked_in',
          CASE WHEN p_allow_early THEN 'Early check-in completed' ELSE 'Checked in' END,
          p_actor_n3_user_key,
          jsonb_build_object('early', p_allow_early, 'operation_request_id', p_operation_request_id));

  INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
  VALUES (p_tenant_id, p_actor_n3_user_key, 'hotel.reservation.check_in',
          jsonb_build_object('bookingReference', v_row.booking_reference, 'early', p_allow_early));

  RETURN QUERY SELECT v_row.status, v_row.checked_in_at, v_row.updated_at;
END;
$$;

-- ---------------------------------------------------------------
-- 7) Create an operation request
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hotelhub_request_operation(
  p_tenant_id uuid,
  p_reservation_id uuid,
  p_actor_n3_user_key text,
  p_operation_type text,
  p_payload jsonb,
  p_idempotency_key text
) RETURNS TABLE(out_request_id uuid, out_state text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res public.hotel_reservations%ROWTYPE;
  v_existing public.hotel_reservation_operation_requests%ROWTYPE;
  v_id uuid;
BEGIN
  IF p_tenant_id IS NULL OR p_reservation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH220', MESSAGE='reservation_not_found';
  END IF;
  IF p_actor_n3_user_key IS NULL OR length(btrim(p_actor_n3_user_key)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH221', MESSAGE='unauthorized';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH222', MESSAGE='validation_failed';
  END IF;

  SELECT * INTO v_existing FROM public.hotel_reservation_operation_requests
    WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN QUERY SELECT v_existing.id, v_existing.state;
    RETURN;
  END IF;

  SELECT * INTO v_res FROM public.hotel_reservations
    WHERE id = p_reservation_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='HH223', MESSAGE='reservation_not_found';
  END IF;
  IF v_res.status NOT IN ('confirmed','checked_in') THEN
    RAISE EXCEPTION USING ERRCODE='HH224', MESSAGE='invalid_transition';
  END IF;

  BEGIN
    INSERT INTO public.hotel_reservation_operation_requests
      (tenant_id, reservation_id, operation_type, state, payload,
       requested_by_n3_user_key, idempotency_key)
    VALUES (p_tenant_id, p_reservation_id, p_operation_type, 'pending',
            COALESCE(p_payload, '{}'::jsonb), p_actor_n3_user_key, p_idempotency_key)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing FROM public.hotel_reservation_operation_requests
      WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN QUERY SELECT v_existing.id, v_existing.state;
      RETURN;
    END IF;
    RAISE EXCEPTION USING ERRCODE='HH225', MESSAGE='operation_pending';
  END;

  INSERT INTO public.hotel_reservation_events
    (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
  VALUES (p_tenant_id, p_reservation_id, 'operation_requested',
          'Requested ' || replace(p_operation_type, '_', ' '),
          p_actor_n3_user_key, jsonb_build_object('operation_request_id', v_id));

  INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
  VALUES (p_tenant_id, p_actor_n3_user_key, 'hotel.reservation.operation_requested',
          jsonb_build_object('bookingReference', v_res.booking_reference,
                             'operationType', p_operation_type));

  RETURN QUERY SELECT v_id, 'pending'::text;
END;
$$;

-- ---------------------------------------------------------------
-- 8) Decide (approve / reject) and atomically apply an operation
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hotelhub_decide_operation(
  p_tenant_id uuid,
  p_request_id uuid,
  p_actor_n3_user_key text,
  p_decision text,
  p_note text,
  p_idempotency_key text
) RETURNS TABLE(out_request_id uuid, out_state text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.hotel_reservation_operation_requests%ROWTYPE;
  v_res public.hotel_reservations%ROWTYPE;
  v_alloc public.hotel_reservation_rooms%ROWTYPE;
  v_target public.hotel_rooms%ROWTYPE;
  v_new_departure date;
  v_new_rate numeric(12,2);
  v_expected_out timestamptz;
  v_preserve boolean;
  v_summary text;
  v_old_label text;
  v_new_label text;
BEGIN
  IF p_actor_n3_user_key IS NULL OR length(btrim(p_actor_n3_user_key)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH230', MESSAGE='unauthorized';
  END IF;
  IF p_decision NOT IN ('approve','reject') THEN
    RAISE EXCEPTION USING ERRCODE='HH231', MESSAGE='validation_failed';
  END IF;

  SELECT * INTO v_req FROM public.hotel_reservation_operation_requests
    WHERE id = p_request_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='HH232', MESSAGE='operation_not_found';
  END IF;

  -- Idempotent replay of the same decision request id.
  IF v_req.state <> 'pending' THEN
    IF v_req.decision_idempotency_key IS NOT NULL
       AND v_req.decision_idempotency_key = p_idempotency_key THEN
      RETURN QUERY SELECT v_req.id, v_req.state;
      RETURN;
    END IF;
    RAISE EXCEPTION USING ERRCODE='HH233', MESSAGE='operation_stale';
  END IF;

  SELECT * INTO v_res FROM public.hotel_reservations
    WHERE id = v_req.reservation_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='HH234', MESSAGE='reservation_not_found';
  END IF;

  IF p_decision = 'reject' THEN
    UPDATE public.hotel_reservation_operation_requests
      SET state = 'rejected', decided_at = now(), decided_by_n3_user_key = p_actor_n3_user_key,
          decision_note = NULLIF(btrim(COALESCE(p_note,'')), ''),
          decision_idempotency_key = p_idempotency_key
      WHERE id = v_req.id;
    INSERT INTO public.hotel_reservation_events
      (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
    VALUES (p_tenant_id, v_req.reservation_id, 'operation_rejected',
            'Rejected ' || replace(v_req.operation_type, '_', ' '),
            p_actor_n3_user_key, jsonb_build_object('operation_request_id', v_req.id));
    INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
    VALUES (p_tenant_id, p_actor_n3_user_key, 'hotel.reservation.operation_rejected',
            jsonb_build_object('bookingReference', v_res.booking_reference,
                               'operationType', v_req.operation_type));
    RETURN QUERY SELECT v_req.id, 'rejected'::text;
    RETURN;
  END IF;

  -- ---------------- approve + apply ----------------
  IF v_res.status NOT IN ('confirmed','checked_in') THEN
    RAISE EXCEPTION USING ERRCODE='HH235', MESSAGE='operation_stale';
  END IF;

  IF v_req.operation_type = 'early_check_in' THEN
    IF v_res.status <> 'confirmed' THEN
      RAISE EXCEPTION USING ERRCODE='HH236', MESSAGE='operation_stale';
    END IF;
    PERFORM public.hotelhub_check_in_reservation(
      p_tenant_id, v_req.reservation_id, p_actor_n3_user_key, NULL, true, v_req.id);
    v_summary := 'Early check-in approved';

  ELSIF v_req.operation_type = 'late_checkout' THEN
    v_expected_out := (v_req.payload->>'expected_check_out_at')::timestamptz;
    IF v_expected_out IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='HH237', MESSAGE='validation_failed';
    END IF;
    UPDATE public.hotel_reservations SET expected_check_out_at = v_expected_out
      WHERE id = v_req.reservation_id AND tenant_id = p_tenant_id;
    INSERT INTO public.hotel_reservation_events
      (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
    VALUES (p_tenant_id, v_req.reservation_id, 'late_checkout_approved',
            'Late checkout approved', p_actor_n3_user_key,
            jsonb_build_object('operation_request_id', v_req.id,
                               'expected_check_out_at', v_expected_out));
    v_summary := NULL;

  ELSIF v_req.operation_type = 'room_change' THEN
    SELECT * INTO v_alloc FROM public.hotel_reservation_rooms
      WHERE id = (v_req.payload->>'reservation_room_id')::uuid
        AND tenant_id = p_tenant_id AND reservation_id = v_req.reservation_id
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE='HH238', MESSAGE='operation_stale';
    END IF;
    SELECT * INTO v_target FROM public.hotel_rooms
      WHERE id = (v_req.payload->>'to_hotel_room_id')::uuid AND tenant_id = p_tenant_id;
    IF NOT FOUND OR NOT v_target.is_active THEN
      RAISE EXCEPTION USING ERRCODE='HH239', MESSAGE='room_unavailable';
    END IF;
    IF v_target.max_occupancy < (v_alloc.adults + v_alloc.children) THEN
      RAISE EXCEPTION USING ERRCODE='HH240', MESSAGE='room_capacity_exceeded';
    END IF;
    v_preserve := COALESCE((v_req.payload->>'preserve_rate')::boolean, true);
    SELECT COALESCE(r.display_name, r.n3_stock_name, r.room_number) INTO v_old_label
      FROM public.hotel_rooms r WHERE r.id = v_alloc.hotel_room_id;
    v_new_label := COALESCE(v_target.display_name, v_target.n3_stock_name, v_target.room_number);
    BEGIN
      UPDATE public.hotel_reservation_rooms
        SET hotel_room_id = v_target.id,
            base_rate_snapshot = v_target.base_rate,
            agreed_rate = CASE WHEN v_preserve THEN v_alloc.agreed_rate ELSE v_target.base_rate END
        WHERE id = v_alloc.id;
    EXCEPTION WHEN exclusion_violation OR unique_violation THEN
      RAISE EXCEPTION USING ERRCODE='HH241', MESSAGE='room_unavailable';
    END;
    INSERT INTO public.hotel_reservation_events
      (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
    VALUES (p_tenant_id, v_req.reservation_id, 'room_changed',
            'Room changed from ' || v_old_label || ' to ' || v_new_label,
            p_actor_n3_user_key,
            jsonb_build_object('operation_request_id', v_req.id,
                               'preserve_rate', v_preserve));
    v_summary := NULL;

  ELSIF v_req.operation_type = 'stay_extension' THEN
    v_new_departure := (v_req.payload->>'new_departure_date')::date;
    IF v_new_departure IS NULL OR v_new_departure <= v_res.departure_date THEN
      RAISE EXCEPTION USING ERRCODE='HH242', MESSAGE='operation_stale';
    END IF;
    BEGIN
      UPDATE public.hotel_reservation_rooms
        SET departure_date = v_new_departure
        WHERE tenant_id = p_tenant_id AND reservation_id = v_req.reservation_id
          AND allocation_status IN ('reserved','occupied');
    EXCEPTION WHEN exclusion_violation OR unique_violation THEN
      RAISE EXCEPTION USING ERRCODE='HH243', MESSAGE='room_unavailable';
    END;
    UPDATE public.hotel_reservations SET departure_date = v_new_departure
      WHERE id = v_req.reservation_id AND tenant_id = p_tenant_id;
    INSERT INTO public.hotel_reservation_events
      (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
    VALUES (p_tenant_id, v_req.reservation_id, 'stay_extended',
            'Stay extended to ' || to_char(v_new_departure, 'DD/MM/YYYY'),
            p_actor_n3_user_key,
            jsonb_build_object('operation_request_id', v_req.id,
                               'previous_departure_date', v_res.departure_date,
                               'new_departure_date', v_new_departure));
    v_summary := NULL;

  ELSIF v_req.operation_type = 'rate_change' THEN
    SELECT * INTO v_alloc FROM public.hotel_reservation_rooms
      WHERE id = (v_req.payload->>'reservation_room_id')::uuid
        AND tenant_id = p_tenant_id AND reservation_id = v_req.reservation_id
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE='HH244', MESSAGE='operation_stale';
    END IF;
    v_new_rate := (v_req.payload->>'new_agreed_rate')::numeric(12,2);
    IF v_new_rate IS NULL OR v_new_rate < 0 THEN
      RAISE EXCEPTION USING ERRCODE='HH245', MESSAGE='validation_failed';
    END IF;
    UPDATE public.hotel_reservation_rooms
      SET agreed_rate = v_new_rate,
          rate_override_reason = NULLIF(btrim(COALESCE(v_req.payload->>'reason','')), '')
      WHERE id = v_alloc.id;
    INSERT INTO public.hotel_reservation_events
      (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
    VALUES (p_tenant_id, v_req.reservation_id, 'rate_changed',
            'Room rate changed', p_actor_n3_user_key,
            jsonb_build_object('operation_request_id', v_req.id,
                               'previous_rate', v_alloc.agreed_rate,
                               'new_rate', v_new_rate));
    v_summary := NULL;
  ELSE
    RAISE EXCEPTION USING ERRCODE='HH246', MESSAGE='validation_failed';
  END IF;

  UPDATE public.hotel_reservation_operation_requests
    SET state = 'applied', decided_at = now(), applied_at = now(),
        decided_by_n3_user_key = p_actor_n3_user_key,
        decision_note = NULLIF(btrim(COALESCE(p_note,'')), ''),
        decision_idempotency_key = p_idempotency_key
    WHERE id = v_req.id;

  INSERT INTO public.hotel_reservation_events
    (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
  VALUES (p_tenant_id, v_req.reservation_id, 'operation_approved',
          COALESCE(v_summary, 'Approved ' || replace(v_req.operation_type, '_', ' ')),
          p_actor_n3_user_key, jsonb_build_object('operation_request_id', v_req.id));

  INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
  VALUES (p_tenant_id, p_actor_n3_user_key, 'hotel.reservation.operation_applied',
          jsonb_build_object('bookingReference', v_res.booking_reference,
                             'operationType', v_req.operation_type));

  RETURN QUERY SELECT v_req.id, 'applied'::text;
END;
$$;