
ALTER TABLE public.hotel_reservation_rooms
  ADD COLUMN IF NOT EXISTS remark text;

ALTER TABLE public.hotel_reservation_rooms
  DROP CONSTRAINT IF EXISTS hotel_reservation_rooms_remark_len;
ALTER TABLE public.hotel_reservation_rooms
  ADD CONSTRAINT hotel_reservation_rooms_remark_len
  CHECK (remark IS NULL OR length(remark) <= 500);

CREATE OR REPLACE FUNCTION public.hotelhub_create_reservation(
  p_tenant_id uuid,
  p_created_by_n3_user_key text,
  p_booking_source text,
  p_arrival_date date,
  p_departure_date date,
  p_notes text,
  p_external_booking_reference text,
  p_rooms jsonb,
  p_guests jsonb
) RETURNS TABLE(out_reservation_id uuid, out_booking_reference text, out_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_currency text;
  v_timezone text;
  v_walk_in text;
  v_source_active boolean;
  v_room_count integer;
  v_guest_count integer;
  v_primary_count integer;
  v_room jsonb;
  v_guest jsonb;
  v_room_id uuid;
  v_room_rate numeric(12,2);
  v_room_max integer;
  v_room_active boolean;
  v_agreed numeric(12,2);
  v_adults integer;
  v_children integer;
  v_reason text;
  v_remark text;
  v_reservation_id uuid;
  v_booking_ref text;
  v_seq_date date;
  v_next_num integer;
  v_new_guest_id uuid;
  v_new_room_alloc_id uuid;
  v_dup_room boolean;
  v_room_ids uuid[] := ARRAY[]::uuid[];
  v_ext_ref text;
  v_identity_type text;
  v_identity_number text;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH001', MESSAGE='tenant_required';
  END IF;
  IF p_created_by_n3_user_key IS NULL OR length(btrim(p_created_by_n3_user_key)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH002', MESSAGE='creator_required';
  END IF;
  IF p_arrival_date IS NULL OR p_departure_date IS NULL OR p_departure_date <= p_arrival_date THEN
    RAISE EXCEPTION USING ERRCODE='HH004', MESSAGE='invalid_stay_dates';
  END IF;

  SELECT bs.is_active INTO v_source_active
    FROM public.hotel_booking_sources bs
    WHERE bs.tenant_id = p_tenant_id AND bs.source_code = p_booking_source;
  IF v_source_active IS NULL OR NOT v_source_active THEN
    RAISE EXCEPTION USING ERRCODE='HH003', MESSAGE='invalid_booking_source';
  END IF;

  SELECT hs.currency, hs.timezone, hs.n3_walk_in_customer_id
    INTO v_currency, v_timezone, v_walk_in
    FROM public.hotel_settings AS hs
    WHERE hs.tenant_id = p_tenant_id;
  IF v_currency IS NULL OR v_walk_in IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH005', MESSAGE='setup_incomplete';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.hotel_rooms AS hr
    WHERE hr.tenant_id = p_tenant_id AND hr.is_active
  ) THEN
    RAISE EXCEPTION USING ERRCODE='HH005', MESSAGE='setup_incomplete';
  END IF;

  v_room_count := COALESCE(jsonb_array_length(p_rooms), 0);
  v_guest_count := COALESCE(jsonb_array_length(p_guests), 0);
  IF v_room_count = 0 THEN RAISE EXCEPTION USING ERRCODE='HH006', MESSAGE='room_required'; END IF;
  IF v_guest_count = 0 THEN RAISE EXCEPTION USING ERRCODE='HH007', MESSAGE='guest_required'; END IF;

  SELECT EXISTS (
    SELECT (elem->>'hotel_room_id')::uuid
    FROM jsonb_array_elements(p_rooms) AS elem
    GROUP BY (elem->>'hotel_room_id')::uuid
    HAVING count(*) > 1
  ) INTO v_dup_room;
  IF v_dup_room THEN RAISE EXCEPTION USING ERRCODE='HH008', MESSAGE='duplicate_room'; END IF;

  SELECT count(*) INTO v_primary_count
    FROM jsonb_array_elements(p_guests) AS elem
    WHERE COALESCE((elem->>'is_primary')::boolean, false) = true;
  IF v_primary_count = 0 THEN RAISE EXCEPTION USING ERRCODE='HH009', MESSAGE='primary_guest_required'; END IF;
  IF v_primary_count > 1 THEN RAISE EXCEPTION USING ERRCODE='HH010', MESSAGE='multiple_primary_guests'; END IF;

  v_seq_date := (now() AT TIME ZONE v_timezone)::date;
  INSERT INTO public.hotel_booking_sequences AS bs (tenant_id, sequence_date, last_number)
  VALUES (p_tenant_id, v_seq_date, 1)
  ON CONFLICT (tenant_id, sequence_date)
  DO UPDATE SET last_number = bs.last_number + 1, updated_at = now()
  RETURNING bs.last_number INTO v_next_num;
  v_booking_ref := 'BK' || to_char(v_seq_date, 'YYMMDD') || lpad(v_next_num::text, 3, '0');

  v_ext_ref := NULLIF(btrim(COALESCE(p_external_booking_reference, '')), '');
  IF v_ext_ref IS NOT NULL AND length(v_ext_ref) > 100 THEN
    v_ext_ref := substring(v_ext_ref for 100);
  END IF;

  INSERT INTO public.hotel_reservations (
    tenant_id, booking_reference, booking_source, status,
    arrival_date, departure_date, currency, notes,
    external_booking_reference, created_by_n3_user_key
  ) VALUES (
    p_tenant_id, v_booking_ref, p_booking_source, 'confirmed',
    p_arrival_date, p_departure_date, v_currency,
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    v_ext_ref, p_created_by_n3_user_key
  ) RETURNING id INTO v_reservation_id;

  FOR v_guest IN SELECT * FROM jsonb_array_elements(p_guests) LOOP
    IF length(btrim(COALESCE(v_guest->>'full_name', ''))) = 0 THEN
      RAISE EXCEPTION USING ERRCODE='HH011', MESSAGE='guest_full_name_required';
    END IF;

    v_identity_type   := NULLIF(btrim(COALESCE(v_guest->>'identity_type','')), '');
    v_identity_number := NULLIF(btrim(COALESCE(v_guest->>'identity_number','')), '');
    IF (v_identity_type IS NULL) <> (v_identity_number IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE='HH019', MESSAGE='identity_pair_required';
    END IF;
    IF v_identity_type IS NOT NULL AND v_identity_type NOT IN ('mykad','mypr','passport','other') THEN
      RAISE EXCEPTION USING ERRCODE='HH020', MESSAGE='invalid_identity_type';
    END IF;
    IF v_identity_type IN ('mykad','mypr') THEN
      v_identity_number := regexp_replace(v_identity_number, '[\s-]', '', 'g');
      IF v_identity_number !~ '^[0-9]{12}$' THEN
        RAISE EXCEPTION USING ERRCODE='HH021', MESSAGE='invalid_identity_number';
      END IF;
    ELSIF v_identity_type IN ('passport','other') THEN
      IF length(v_identity_number) > 50 OR length(v_identity_number) = 0 THEN
        RAISE EXCEPTION USING ERRCODE='HH021', MESSAGE='invalid_identity_number';
      END IF;
    END IF;

    INSERT INTO public.hotel_guests (
      tenant_id, full_name, mobile, email, nationality, notes,
      identity_type, identity_number, nationality_code,
      address_line_1, address_line_2, address_line_3, city, postcode,
      country_code, state_code, state_province
    ) VALUES (
      p_tenant_id,
      btrim(v_guest->>'full_name'),
      NULLIF(btrim(COALESCE(v_guest->>'mobile','')), ''),
      NULLIF(btrim(COALESCE(v_guest->>'email','')), ''),
      NULLIF(btrim(COALESCE(v_guest->>'nationality','')), ''),
      NULLIF(btrim(COALESCE(v_guest->>'notes','')), ''),
      v_identity_type, v_identity_number,
      NULLIF(btrim(COALESCE(v_guest->>'nationality_code','')), ''),
      NULLIF(btrim(COALESCE(v_guest->>'address_line_1','')), ''),
      NULLIF(btrim(COALESCE(v_guest->>'address_line_2','')), ''),
      NULLIF(btrim(COALESCE(v_guest->>'address_line_3','')), ''),
      NULLIF(btrim(COALESCE(v_guest->>'city','')), ''),
      NULLIF(btrim(COALESCE(v_guest->>'postcode','')), ''),
      NULLIF(btrim(COALESCE(v_guest->>'country_code','')), ''),
      NULLIF(btrim(COALESCE(v_guest->>'state_code','')), ''),
      NULLIF(btrim(COALESCE(v_guest->>'state_province','')), '')
    ) RETURNING id INTO v_new_guest_id;

    INSERT INTO public.hotel_reservation_guests (tenant_id, reservation_id, guest_id, is_primary)
    VALUES (p_tenant_id, v_reservation_id, v_new_guest_id,
            COALESCE((v_guest->>'is_primary')::boolean, false));
  END LOOP;

  FOR v_room IN SELECT * FROM jsonb_array_elements(p_rooms) LOOP
    v_room_id  := (v_room->>'hotel_room_id')::uuid;
    v_adults   := COALESCE((v_room->>'adults')::integer, 1);
    v_children := COALESCE((v_room->>'children')::integer, 0);
    v_agreed   := COALESCE((v_room->>'agreed_rate')::numeric, -1);
    v_reason   := NULLIF(btrim(COALESCE(v_room->>'rate_override_reason','')), '');
    v_remark   := NULLIF(btrim(COALESCE(v_room->>'remark','')), '');
    IF v_remark IS NOT NULL AND length(v_remark) > 500 THEN
      RAISE EXCEPTION USING ERRCODE='HH022', MESSAGE='room_remark_too_long';
    END IF;

    SELECT hr.base_rate, hr.max_occupancy, hr.is_active
      INTO v_room_rate, v_room_max, v_room_active
      FROM public.hotel_rooms AS hr
      WHERE hr.id = v_room_id AND hr.tenant_id = p_tenant_id;
    IF v_room_rate IS NULL THEN RAISE EXCEPTION USING ERRCODE='HH012', MESSAGE='room_not_found'; END IF;
    IF NOT v_room_active THEN RAISE EXCEPTION USING ERRCODE='HH013', MESSAGE='room_inactive'; END IF;
    IF v_adults < 1 THEN RAISE EXCEPTION USING ERRCODE='HH014', MESSAGE='invalid_occupancy'; END IF;
    IF (v_adults + v_children) > v_room_max THEN RAISE EXCEPTION USING ERRCODE='HH015', MESSAGE='occupancy_exceeded'; END IF;
    IF v_agreed < 0 THEN RAISE EXCEPTION USING ERRCODE='HH016', MESSAGE='invalid_rate'; END IF;
    IF v_agreed <> v_room_rate AND v_reason IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='HH017', MESSAGE='rate_override_reason_required';
    END IF;

    BEGIN
      INSERT INTO public.hotel_reservation_rooms (
        tenant_id, reservation_id, hotel_room_id,
        arrival_date, departure_date,
        base_rate_snapshot, agreed_rate,
        adults, children, allocation_status, rate_override_reason, remark
      ) VALUES (
        p_tenant_id, v_reservation_id, v_room_id,
        p_arrival_date, p_departure_date,
        v_room_rate, v_agreed,
        v_adults, v_children, 'reserved', v_reason, v_remark
      ) RETURNING id INTO v_new_room_alloc_id;
    EXCEPTION WHEN exclusion_violation THEN
      RAISE EXCEPTION USING ERRCODE='HH018', MESSAGE='room_not_available';
    END;

    v_room_ids := array_append(v_room_ids, v_room_id);

    IF v_agreed <> v_room_rate THEN
      INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
      VALUES (p_tenant_id, p_created_by_n3_user_key,
        'hotel.reservation.rate_overridden',
        jsonb_build_object(
          'reservationId', v_reservation_id,
          'bookingReference', v_booking_ref,
          'hotelRoomId', v_room_id,
          'baseRate', v_room_rate,
          'agreedRate', v_agreed
        ));
    END IF;
  END LOOP;

  INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
  VALUES (p_tenant_id, p_created_by_n3_user_key,
    'hotel.reservation.created',
    jsonb_build_object(
      'reservationId', v_reservation_id,
      'bookingReference', v_booking_ref,
      'bookingSource', p_booking_source,
      'arrivalDate', p_arrival_date,
      'departureDate', p_departure_date,
      'roomIds', to_jsonb(v_room_ids),
      'roomCount', v_room_count,
      'guestCount', v_guest_count,
      'hasExternalReference', v_ext_ref IS NOT NULL
    ));

  RETURN QUERY
    SELECT v_reservation_id AS out_reservation_id,
           v_booking_ref    AS out_booking_reference,
           'confirmed'::text AS out_status;
END;
$fn$;
