-- Tenant-scoped mutation identity ledger (idempotency for reservation writes).
CREATE TABLE IF NOT EXISTS public.hotel_mutation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.hotel_tenants(id),
  client_request_id uuid NOT NULL,
  scope text NOT NULL,
  reservation_id uuid,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, scope, client_request_id)
);

GRANT ALL ON public.hotel_mutation_requests TO service_role;
ALTER TABLE public.hotel_mutation_requests ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.hotelhub_check_in_reservation(
  p_tenant_id uuid,
  p_reservation_id uuid,
  p_actor_n3_user_key text,
  p_expected_updated_at timestamptz,
  p_allow_early boolean DEFAULT false,
  p_operation_request_id uuid DEFAULT NULL,
  p_client_request_id uuid DEFAULT NULL
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
  v_primary integer;
  v_unassigned integer;
  v_overcap integer;
  v_ledger public.hotel_mutation_requests%ROWTYPE;
BEGIN
  IF p_tenant_id IS NULL OR p_reservation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH210', MESSAGE='reservation_not_found';
  END IF;
  IF p_actor_n3_user_key IS NULL OR length(btrim(p_actor_n3_user_key)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH211', MESSAGE='unauthorized';
  END IF;

  IF p_client_request_id IS NOT NULL THEN
    SELECT * INTO v_ledger FROM public.hotel_mutation_requests
      WHERE tenant_id = p_tenant_id AND scope = 'check_in'
        AND client_request_id = p_client_request_id;
    IF FOUND THEN
      IF v_ledger.reservation_id IS DISTINCT FROM p_reservation_id THEN
        RAISE EXCEPTION USING ERRCODE='HH219', MESSAGE='idempotency_conflict';
      END IF;
      SELECT * INTO v_row FROM public.hotel_reservations
        WHERE id = p_reservation_id AND tenant_id = p_tenant_id;
      RETURN QUERY SELECT v_row.status, v_row.checked_in_at, v_row.updated_at;
      RETURN;
    END IF;
  END IF;

  SELECT * INTO v_row FROM public.hotel_reservations
    WHERE id = p_reservation_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='HH212', MESSAGE='reservation_not_found';
  END IF;

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

  SELECT count(*) INTO v_primary FROM public.hotel_reservation_guests
    WHERE tenant_id = p_tenant_id AND reservation_id = p_reservation_id AND is_primary;
  IF v_primary <> 1 THEN
    RAISE EXCEPTION USING ERRCODE='HH21A', MESSAGE='primary_guest_required';
  END IF;

  -- Every guest must be assigned to a live room of THIS reservation.
  SELECT count(*) INTO v_unassigned
    FROM public.hotel_reservation_guests g
    WHERE g.tenant_id = p_tenant_id AND g.reservation_id = p_reservation_id
      AND NOT EXISTS (
        SELECT 1 FROM public.hotel_reservation_rooms r
         WHERE r.id = g.reservation_room_id
           AND r.tenant_id = p_tenant_id
           AND r.reservation_id = p_reservation_id
           AND r.allocation_status IN ('reserved','occupied')
      );
  IF v_unassigned > 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH21B', MESSAGE='guest_assignment_required';
  END IF;

  -- Declared occupancy and assigned headcount must both fit the real room.
  SELECT count(*) INTO v_overcap
    FROM public.hotel_reservation_rooms r
    JOIN public.hotel_rooms hr
      ON hr.id = r.hotel_room_id AND hr.tenant_id = p_tenant_id
    WHERE r.tenant_id = p_tenant_id AND r.reservation_id = p_reservation_id
      AND r.allocation_status IN ('reserved','occupied')
      AND (
        (r.adults + COALESCE(r.children,0)) > hr.max_occupancy
        OR (
          SELECT count(*) FROM public.hotel_reservation_guests g
           WHERE g.tenant_id = p_tenant_id AND g.reservation_room_id = r.id
        ) > hr.max_occupancy
      );
  IF v_overcap > 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH21C', MESSAGE='room_capacity_exceeded';
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

  IF p_client_request_id IS NOT NULL THEN
    INSERT INTO public.hotel_mutation_requests
      (tenant_id, client_request_id, scope, reservation_id, result)
    VALUES (p_tenant_id, p_client_request_id, 'check_in', p_reservation_id,
            jsonb_build_object('status', v_row.status));
  END IF;

  RETURN QUERY SELECT v_row.status, v_row.checked_in_at, v_row.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.hotelhub_check_in_reservation(uuid,uuid,text,timestamptz,boolean,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hotelhub_check_in_reservation(uuid,uuid,text,timestamptz,boolean,uuid,uuid) TO service_role;