
-- HotelHub: atomic update for a pre-check-in reservation.
-- Head fields (dates, booking source, external ref, notes) + per-room
-- editable fields (agreed_rate, adults, children, remark, override reason).
-- Rooms are matched by id; add/remove of rooms and guest edits are out of
-- scope for this MVP and MUST use the create flow instead.
--
-- Concurrency: caller passes p_expected_updated_at (from the last GET).
-- Mismatch raises 'stale_reservation'. Row is locked FOR UPDATE.
CREATE OR REPLACE FUNCTION public.hotelhub_update_reservation(
  p_tenant_id uuid,
  p_reservation_id uuid,
  p_actor_n3_user_key text,
  p_expected_updated_at timestamptz,
  p_booking_source text,
  p_arrival_date date,
  p_departure_date date,
  p_notes text,
  p_external_booking_reference text,
  p_rooms jsonb
) RETURNS TABLE(out_reservation_id uuid, out_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.hotel_reservations%ROWTYPE;
  v_source_active boolean;
  v_room jsonb;
  v_room_id uuid;
  v_agreed numeric(12,2);
  v_adults integer;
  v_children integer;
  v_reason text;
  v_remark text;
  v_base numeric(12,2);
  v_max integer;
  v_ext_ref text;
  v_changes jsonb := '{}'::jsonb;
BEGIN
  IF p_tenant_id IS NULL OR p_reservation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH101', MESSAGE='tenant_required';
  END IF;
  IF p_actor_n3_user_key IS NULL OR length(btrim(p_actor_n3_user_key))=0 THEN
    RAISE EXCEPTION USING ERRCODE='HH102', MESSAGE='creator_required';
  END IF;
  IF p_arrival_date IS NULL OR p_departure_date IS NULL OR p_departure_date <= p_arrival_date THEN
    RAISE EXCEPTION USING ERRCODE='HH103', MESSAGE='invalid_stay_dates';
  END IF;

  SELECT * INTO v_row FROM public.hotel_reservations
    WHERE id = p_reservation_id AND tenant_id = p_tenant_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='HH104', MESSAGE='not_found';
  END IF;
  IF v_row.status <> 'confirmed' THEN
    RAISE EXCEPTION USING ERRCODE='HH105', MESSAGE='reservation_not_editable';
  END IF;
  IF p_expected_updated_at IS NULL OR v_row.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION USING ERRCODE='HH106', MESSAGE='stale_reservation';
  END IF;

  -- Booking source must exist for tenant and be active.
  SELECT bs.is_active INTO v_source_active
    FROM public.hotel_booking_sources bs
    WHERE bs.tenant_id = p_tenant_id AND bs.source_code = p_booking_source;
  IF v_source_active IS NULL OR NOT v_source_active THEN
    RAISE EXCEPTION USING ERRCODE='HH107', MESSAGE='invalid_booking_source';
  END IF;

  -- No allocation may already be occupied/checked_out.
  IF EXISTS (
    SELECT 1 FROM public.hotel_reservation_rooms
    WHERE reservation_id = p_reservation_id AND allocation_status <> 'reserved'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='HH108', MESSAGE='reservation_not_editable';
  END IF;

  v_ext_ref := NULLIF(btrim(COALESCE(p_external_booking_reference,'')), '');
  IF v_ext_ref IS NOT NULL AND length(v_ext_ref) > 100 THEN
    v_ext_ref := substring(v_ext_ref for 100);
  END IF;

  -- Update head
  UPDATE public.hotel_reservations
     SET booking_source = p_booking_source,
         arrival_date = p_arrival_date,
         departure_date = p_departure_date,
         notes = NULLIF(btrim(COALESCE(p_notes,'')), ''),
         external_booking_reference = v_ext_ref
   WHERE id = p_reservation_id AND tenant_id = p_tenant_id;

  -- Per-room updates. Each room in p_rooms MUST belong to this reservation.
  IF p_rooms IS NOT NULL AND jsonb_array_length(p_rooms) > 0 THEN
    FOR v_room IN SELECT * FROM jsonb_array_elements(p_rooms) LOOP
      v_room_id := (v_room->>'id')::uuid;
      v_agreed := (v_room->>'agreed_rate')::numeric;
      v_adults := (v_room->>'adults')::integer;
      v_children := COALESCE((v_room->>'children')::integer, 0);
      v_reason := NULLIF(btrim(COALESCE(v_room->>'rate_override_reason','')),'');
      v_remark := NULLIF(btrim(COALESCE(v_room->>'remark','')),'');
      IF v_remark IS NOT NULL AND length(v_remark) > 500 THEN
        RAISE EXCEPTION USING ERRCODE='HH109', MESSAGE='room_remark_too_long';
      END IF;

      SELECT rr.base_rate_snapshot, hr.max_occupancy
        INTO v_base, v_max
        FROM public.hotel_reservation_rooms rr
        JOIN public.hotel_rooms hr ON hr.id = rr.hotel_room_id
       WHERE rr.id = v_room_id
         AND rr.reservation_id = p_reservation_id
         AND rr.tenant_id = p_tenant_id
       FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE='HH110', MESSAGE='room_not_found';
      END IF;
      IF v_adults IS NULL OR v_adults < 1 OR v_children < 0 THEN
        RAISE EXCEPTION USING ERRCODE='HH111', MESSAGE='invalid_occupancy';
      END IF;
      IF v_adults + v_children > v_max THEN
        RAISE EXCEPTION USING ERRCODE='HH112', MESSAGE='occupancy_exceeded';
      END IF;
      IF v_agreed IS NULL OR v_agreed < 0 THEN
        RAISE EXCEPTION USING ERRCODE='HH113', MESSAGE='invalid_rate';
      END IF;
      IF v_agreed <> v_base AND v_reason IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='HH114', MESSAGE='rate_override_reason_required';
      END IF;

      UPDATE public.hotel_reservation_rooms
         SET agreed_rate = v_agreed,
             adults = v_adults,
             children = v_children,
             rate_override_reason = CASE WHEN v_agreed <> v_base THEN v_reason ELSE NULL END,
             remark = v_remark,
             arrival_date = p_arrival_date,
             departure_date = p_departure_date
       WHERE id = v_room_id AND reservation_id = p_reservation_id AND tenant_id = p_tenant_id;
    END LOOP;
  ELSE
    -- Dates may still have changed; sync allocations.
    UPDATE public.hotel_reservation_rooms
       SET arrival_date = p_arrival_date, departure_date = p_departure_date
     WHERE reservation_id = p_reservation_id AND tenant_id = p_tenant_id;
  END IF;

  -- Audit — never log sensitive identity or token data.
  v_changes := jsonb_build_object(
    'reservationId', p_reservation_id,
    'arrival', p_arrival_date,
    'departure', p_departure_date,
    'source', p_booking_source,
    'roomCount', COALESCE(jsonb_array_length(p_rooms), 0)
  );
  INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
  VALUES (p_tenant_id, p_actor_n3_user_key, 'hotel.reservation.updated', v_changes);

  SELECT r.updated_at INTO out_updated_at FROM public.hotel_reservations r WHERE r.id = p_reservation_id;
  out_reservation_id := p_reservation_id;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.hotelhub_update_reservation(uuid, uuid, text, timestamptz, text, date, date, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hotelhub_update_reservation(uuid, uuid, text, timestamptz, text, date, date, text, text, jsonb) TO service_role;
