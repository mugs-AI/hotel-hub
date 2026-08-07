-- HotelHub Run 5D2.4 — full atomic reservation edit (head + rooms + guests +
-- assignments), post-check-in guest policy enforcement, guest-room assignment
-- v2, and request-fingerprint idempotency.

ALTER TABLE public.hotel_mutation_requests
  ADD COLUMN IF NOT EXISTS fingerprint text;

ALTER TABLE public.hotel_settings
  ALTER COLUMN post_check_in_guest_edit_policy SET DEFAULT 'locked';
ALTER TABLE public.hotel_settings
  ALTER COLUMN allow_owner_primary_guest_change_after_check_in SET DEFAULT false;

UPDATE public.hotel_settings
   SET post_check_in_guest_edit_policy = 'locked'
 WHERE post_check_in_guest_edit_policy IS NULL
    OR post_check_in_guest_edit_policy NOT IN ('locked', 'contact_only');

CREATE OR REPLACE FUNCTION public.hotelhub_update_reservation_v2(
  p_tenant_id uuid,
  p_reservation_id uuid,
  p_actor_n3_user_key text,
  p_actor_role text,
  p_client_request_id uuid,
  p_fingerprint text,
  p_expected_updated_at timestamptz,
  p_booking_source text,
  p_arrival_date date,
  p_departure_date date,
  p_notes text,
  p_external_booking_reference text,
  p_rooms jsonb,
  p_guests jsonb,
  p_correction_reason text
) RETURNS TABLE(out_reservation_id uuid, out_updated_at timestamptz, out_replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_res public.hotel_reservations%ROWTYPE;
  v_ledger public.hotel_mutation_requests%ROWTYPE;
  v_policy text;
  v_allow_primary boolean;
  v_mode text;
  v_source_active boolean;
  v_ext_ref text;
  v_reason text;
  v_room jsonb;
  v_guest jsonb;
  v_key text;
  v_rr_id uuid;
  v_hotel_room_id uuid;
  v_agreed numeric(12,2);
  v_adults integer;
  v_children integer;
  v_reason_room text;
  v_remark text;
  v_base numeric(12,2);
  v_max integer;
  v_active boolean;
  v_keymap jsonb := '{}'::jsonb;
  v_capmap jsonb := '{}'::jsonb;
  v_keep_rooms uuid[] := ARRAY[]::uuid[];
  v_keep_guests uuid[] := ARRAY[]::uuid[];
  v_seen text[] := ARRAY[]::text[];
  v_seen_uuid uuid[] := ARRAY[]::uuid[];
  v_primary_count integer := 0;
  v_guest_id uuid;
  v_link_id uuid;
  v_assigned_room uuid;
  v_identity_action text;
  v_identity_type text;
  v_identity_number text;
  v_prev_primary uuid;
  v_shared integer;
  v_new_guest_id uuid;
  v_added_rooms integer := 0;
  v_removed_rooms integer := 0;
  v_added_guests integer := 0;
  v_removed_guests integer := 0;
  v_identity_replaced integer := 0;
  v_identity_cleared integer := 0;
  v_primary_changed boolean := false;
  v_over integer;
  v_conflict integer;
BEGIN
  IF p_tenant_id IS NULL OR p_reservation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH300', MESSAGE='reservation_not_found';
  END IF;
  IF p_actor_n3_user_key IS NULL OR length(btrim(p_actor_n3_user_key)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH301', MESSAGE='unauthorized';
  END IF;
  IF p_actor_role IS NULL OR p_actor_role NOT IN ('owner','front_desk') THEN
    RAISE EXCEPTION USING ERRCODE='HH302', MESSAGE='unauthorized';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH303', MESSAGE='invalid_request';
  END IF;

  SELECT * INTO v_ledger FROM public.hotel_mutation_requests
    WHERE tenant_id = p_tenant_id AND scope = 'reservation_update'
      AND client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_ledger.reservation_id IS DISTINCT FROM p_reservation_id
       OR v_ledger.fingerprint IS DISTINCT FROM p_fingerprint THEN
      RAISE EXCEPTION USING ERRCODE='HH304', MESSAGE='idempotency_conflict';
    END IF;
    SELECT * INTO v_res FROM public.hotel_reservations
      WHERE id = p_reservation_id AND tenant_id = p_tenant_id;
    RETURN QUERY SELECT p_reservation_id, v_res.updated_at, true;
    RETURN;
  END IF;

  SELECT * INTO v_res FROM public.hotel_reservations
    WHERE id = p_reservation_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='HH305', MESSAGE='reservation_not_found';
  END IF;
  IF p_expected_updated_at IS NULL OR v_res.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION USING ERRCODE='HH306', MESSAGE='stale_reservation';
  END IF;

  SELECT s.post_check_in_guest_edit_policy,
         COALESCE(s.allow_owner_primary_guest_change_after_check_in, false)
    INTO v_policy, v_allow_primary
    FROM public.hotel_settings s WHERE s.tenant_id = p_tenant_id;
  IF v_policy IS NULL OR v_policy NOT IN ('locked','contact_only') THEN
    v_policy := 'locked';
  END IF;
  v_allow_primary := COALESCE(v_allow_primary, false);

  IF v_res.status = 'confirmed' THEN
    IF EXISTS (SELECT 1 FROM public.hotel_reservation_rooms
                WHERE reservation_id = p_reservation_id AND allocation_status <> 'reserved') THEN
      RAISE EXCEPTION USING ERRCODE='HH307', MESSAGE='reservation_not_editable';
    END IF;
    v_mode := 'full';
  ELSIF v_res.status = 'checked_in' THEN
    IF p_actor_role = 'owner' THEN
      v_mode := 'owner_correction';
    ELSIF v_policy = 'contact_only' THEN
      v_mode := 'contact';
    ELSE
      RAISE EXCEPTION USING ERRCODE='HH308', MESSAGE='guest_edit_locked';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE='HH309', MESSAGE='reservation_not_editable';
  END IF;

  v_reason := NULLIF(btrim(COALESCE(p_correction_reason,'')), '');
  IF v_mode = 'owner_correction' THEN
    IF v_reason IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='HH310', MESSAGE='correction_reason_required';
    END IF;
    IF length(v_reason) > 300 THEN
      RAISE EXCEPTION USING ERRCODE='HH311', MESSAGE='correction_reason_too_long';
    END IF;
  END IF;

  IF v_mode <> 'full' THEN
    IF p_arrival_date IS DISTINCT FROM v_res.arrival_date
       OR p_departure_date IS DISTINCT FROM v_res.departure_date
       OR p_booking_source IS DISTINCT FROM v_res.booking_source THEN
      RAISE EXCEPTION USING ERRCODE='HH312', MESSAGE='reservation_not_editable';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_rooms,'[]'::jsonb)) r
      WHERE (r->>'reservation_room_id') IS NULL
    ) THEN
      RAISE EXCEPTION USING ERRCODE='HH313', MESSAGE='reservation_not_editable';
    END IF;
    IF (SELECT count(*) FROM jsonb_array_elements(COALESCE(p_rooms,'[]'::jsonb)))
       <> (SELECT count(*) FROM public.hotel_reservation_rooms
            WHERE reservation_id = p_reservation_id AND tenant_id = p_tenant_id) THEN
      RAISE EXCEPTION USING ERRCODE='HH314', MESSAGE='reservation_not_editable';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_rooms,'[]'::jsonb)) r
      JOIN public.hotel_reservation_rooms rr
        ON rr.id = (r->>'reservation_room_id')::uuid
      WHERE rr.reservation_id = p_reservation_id
        AND ( rr.agreed_rate <> (r->>'agreed_rate')::numeric
           OR rr.adults <> (r->>'adults')::integer
           OR rr.children <> COALESCE((r->>'children')::integer,0) )
    ) THEN
      RAISE EXCEPTION USING ERRCODE='HH315', MESSAGE='reservation_not_editable';
    END IF;
  END IF;

  IF v_mode = 'full' THEN
    IF p_arrival_date IS NULL OR p_departure_date IS NULL
       OR p_departure_date <= p_arrival_date THEN
      RAISE EXCEPTION USING ERRCODE='HH316', MESSAGE='invalid_stay_dates';
    END IF;

    SELECT bs.is_active INTO v_source_active
      FROM public.hotel_booking_sources bs
     WHERE bs.tenant_id = p_tenant_id AND bs.source_code = p_booking_source;
    IF v_source_active IS NULL OR NOT v_source_active THEN
      IF p_booking_source IS DISTINCT FROM v_res.booking_source THEN
        RAISE EXCEPTION USING ERRCODE='HH317', MESSAGE='invalid_booking_source';
      END IF;
    END IF;

    IF p_rooms IS NULL OR jsonb_array_length(p_rooms) = 0 THEN
      RAISE EXCEPTION USING ERRCODE='HH318', MESSAGE='room_required';
    END IF;

    v_ext_ref := NULLIF(btrim(COALESCE(p_external_booking_reference,'')), '');
    IF v_ext_ref IS NOT NULL AND length(v_ext_ref) > 100 THEN
      RAISE EXCEPTION USING ERRCODE='HH319', MESSAGE='external_ref_too_long';
    END IF;

    UPDATE public.hotel_reservations
       SET booking_source = p_booking_source,
           arrival_date = p_arrival_date,
           departure_date = p_departure_date,
           notes = NULLIF(btrim(COALESCE(p_notes,'')), ''),
           external_booking_reference = v_ext_ref
     WHERE id = p_reservation_id AND tenant_id = p_tenant_id;

    FOR v_room IN SELECT * FROM jsonb_array_elements(p_rooms) LOOP
      v_key := v_room->>'client_key';
      IF v_key IS NULL OR length(btrim(v_key)) = 0 THEN
        RAISE EXCEPTION USING ERRCODE='HH320', MESSAGE='invalid_room';
      END IF;
      IF v_key = ANY(v_seen) THEN
        RAISE EXCEPTION USING ERRCODE='HH321', MESSAGE='duplicate_client_key';
      END IF;
      v_seen := array_append(v_seen, v_key);

      v_rr_id := NULLIF(v_room->>'reservation_room_id','')::uuid;
      v_hotel_room_id := NULLIF(v_room->>'hotel_room_id','')::uuid;
      v_agreed := (v_room->>'agreed_rate')::numeric;
      v_adults := (v_room->>'adults')::integer;
      v_children := COALESCE((v_room->>'children')::integer, 0);
      v_reason_room := NULLIF(btrim(COALESCE(v_room->>'rate_override_reason','')),'');
      v_remark := NULLIF(btrim(COALESCE(v_room->>'remark','')),'');
      IF v_remark IS NOT NULL AND length(v_remark) > 500 THEN
        RAISE EXCEPTION USING ERRCODE='HH322', MESSAGE='room_remark_too_long';
      END IF;
      IF v_hotel_room_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='HH323', MESSAGE='room_not_found';
      END IF;
      IF v_hotel_room_id = ANY(v_seen_uuid) THEN
        RAISE EXCEPTION USING ERRCODE='HH324', MESSAGE='duplicate_room';
      END IF;
      v_seen_uuid := array_append(v_seen_uuid, v_hotel_room_id);

      SELECT hr.base_rate, hr.max_occupancy, hr.is_active
        INTO v_base, v_max, v_active
        FROM public.hotel_rooms hr
       WHERE hr.id = v_hotel_room_id AND hr.tenant_id = p_tenant_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE='HH325', MESSAGE='room_not_found';
      END IF;

      IF v_adults IS NULL OR v_adults < 1 OR v_children < 0 THEN
        RAISE EXCEPTION USING ERRCODE='HH326', MESSAGE='invalid_occupancy';
      END IF;
      IF v_adults + v_children > v_max THEN
        RAISE EXCEPTION USING ERRCODE='HH327', MESSAGE='room_capacity_exceeded';
      END IF;
      IF v_agreed IS NULL OR v_agreed < 0 THEN
        RAISE EXCEPTION USING ERRCODE='HH328', MESSAGE='invalid_rate';
      END IF;

      IF v_rr_id IS NOT NULL THEN
        SELECT rr.base_rate_snapshot INTO v_base
          FROM public.hotel_reservation_rooms rr
         WHERE rr.id = v_rr_id AND rr.reservation_id = p_reservation_id
           AND rr.tenant_id = p_tenant_id AND rr.hotel_room_id = v_hotel_room_id
         FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION USING ERRCODE='HH329', MESSAGE='room_not_found';
        END IF;
        IF v_agreed <> v_base AND v_reason_room IS NULL THEN
          RAISE EXCEPTION USING ERRCODE='HH330', MESSAGE='rate_override_reason_required';
        END IF;
        UPDATE public.hotel_reservation_rooms
           SET agreed_rate = v_agreed,
               adults = v_adults,
               children = v_children,
               rate_override_reason = CASE WHEN v_agreed <> v_base THEN v_reason_room ELSE NULL END,
               remark = v_remark,
               arrival_date = p_arrival_date,
               departure_date = p_departure_date
         WHERE id = v_rr_id;
      ELSE
        IF NOT v_active THEN
          RAISE EXCEPTION USING ERRCODE='HH331', MESSAGE='room_unavailable';
        END IF;
        IF v_agreed <> v_base AND v_reason_room IS NULL THEN
          RAISE EXCEPTION USING ERRCODE='HH332', MESSAGE='rate_override_reason_required';
        END IF;
        INSERT INTO public.hotel_reservation_rooms
          (tenant_id, reservation_id, hotel_room_id, arrival_date, departure_date,
           base_rate_snapshot, agreed_rate, adults, children, allocation_status,
           rate_override_reason, remark)
        VALUES (p_tenant_id, p_reservation_id, v_hotel_room_id, p_arrival_date, p_departure_date,
                v_base, v_agreed, v_adults, v_children, 'reserved',
                CASE WHEN v_agreed <> v_base THEN v_reason_room ELSE NULL END, v_remark)
        RETURNING id INTO v_rr_id;
        v_added_rooms := v_added_rooms + 1;
      END IF;

      v_keep_rooms := array_append(v_keep_rooms, v_rr_id);
      v_keymap := v_keymap || jsonb_build_object(v_key, v_rr_id::text);
      v_capmap := v_capmap || jsonb_build_object(v_rr_id::text, v_max);
    END LOOP;

    SELECT count(*) INTO v_removed_rooms FROM public.hotel_reservation_rooms
      WHERE reservation_id = p_reservation_id AND tenant_id = p_tenant_id
        AND NOT (id = ANY(v_keep_rooms));
    UPDATE public.hotel_reservation_guests SET reservation_room_id = NULL
      WHERE reservation_id = p_reservation_id AND tenant_id = p_tenant_id
        AND reservation_room_id IS NOT NULL
        AND NOT (reservation_room_id = ANY(v_keep_rooms));
    DELETE FROM public.hotel_reservation_rooms
      WHERE reservation_id = p_reservation_id AND tenant_id = p_tenant_id
        AND NOT (id = ANY(v_keep_rooms));

    SELECT count(*) INTO v_conflict
      FROM public.hotel_reservation_rooms mine
      JOIN public.hotel_reservation_rooms other
        ON other.tenant_id = mine.tenant_id
       AND other.hotel_room_id = mine.hotel_room_id
       AND other.reservation_id <> mine.reservation_id
       AND other.allocation_status IN ('reserved','occupied')
       AND other.stay_range && mine.stay_range
     WHERE mine.reservation_id = p_reservation_id AND mine.tenant_id = p_tenant_id
       AND mine.allocation_status IN ('reserved','occupied');
    IF v_conflict > 0 THEN
      RAISE EXCEPTION USING ERRCODE='HH333', MESSAGE='room_unavailable';
    END IF;
  ELSE
    FOR v_room IN SELECT * FROM jsonb_array_elements(COALESCE(p_rooms,'[]'::jsonb)) LOOP
      v_key := v_room->>'client_key';
      v_rr_id := NULLIF(v_room->>'reservation_room_id','')::uuid;
      SELECT hr.max_occupancy INTO v_max
        FROM public.hotel_reservation_rooms rr
        JOIN public.hotel_rooms hr ON hr.id = rr.hotel_room_id
       WHERE rr.id = v_rr_id AND rr.reservation_id = p_reservation_id
         AND rr.tenant_id = p_tenant_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE='HH334', MESSAGE='room_not_found';
      END IF;
      v_keymap := v_keymap || jsonb_build_object(v_key, v_rr_id::text);
      v_capmap := v_capmap || jsonb_build_object(v_rr_id::text, v_max);
      v_keep_rooms := array_append(v_keep_rooms, v_rr_id);
    END LOOP;
  END IF;

  IF p_guests IS NULL OR jsonb_array_length(p_guests) = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH340', MESSAGE='guest_required';
  END IF;

  SELECT g.id INTO v_prev_primary FROM public.hotel_reservation_guests g
    WHERE g.reservation_id = p_reservation_id AND g.tenant_id = p_tenant_id AND g.is_primary;

  v_seen := ARRAY[]::text[];
  v_seen_uuid := ARRAY[]::uuid[];

  UPDATE public.hotel_reservation_guests SET is_primary = false
    WHERE reservation_id = p_reservation_id AND tenant_id = p_tenant_id;

  FOR v_guest IN SELECT * FROM jsonb_array_elements(p_guests) LOOP
    v_key := v_guest->>'client_key';
    IF v_key IS NULL OR length(btrim(v_key)) = 0 THEN
      RAISE EXCEPTION USING ERRCODE='HH341', MESSAGE='invalid_guest';
    END IF;
    IF v_key = ANY(v_seen) THEN
      RAISE EXCEPTION USING ERRCODE='HH342', MESSAGE='duplicate_client_key';
    END IF;
    v_seen := array_append(v_seen, v_key);

    v_link_id := NULLIF(v_guest->>'reservation_guest_id','')::uuid;
    IF v_link_id IS NOT NULL THEN
      IF v_link_id = ANY(v_seen_uuid) THEN
        RAISE EXCEPTION USING ERRCODE='HH343', MESSAGE='duplicate_guest';
      END IF;
      v_seen_uuid := array_append(v_seen_uuid, v_link_id);
    END IF;

    IF length(btrim(COALESCE(v_guest->>'full_name',''))) = 0 THEN
      RAISE EXCEPTION USING ERRCODE='HH344', MESSAGE='invalid_guest';
    END IF;

    v_assigned_room := NULL;
    IF (v_guest->>'assigned_room_client_key') IS NOT NULL
       AND length(btrim(v_guest->>'assigned_room_client_key')) > 0 THEN
      IF NOT (v_keymap ? (v_guest->>'assigned_room_client_key')) THEN
        RAISE EXCEPTION USING ERRCODE='HH345', MESSAGE='guest_assignment_required';
      END IF;
      v_assigned_room := (v_keymap->>(v_guest->>'assigned_room_client_key'))::uuid;
    END IF;
    IF v_assigned_room IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='HH346', MESSAGE='guest_assignment_required';
    END IF;

    v_identity_action := COALESCE(v_guest->>'identity_action', 'keep');
    IF v_identity_action NOT IN ('keep','clear','replace') THEN
      RAISE EXCEPTION USING ERRCODE='HH347', MESSAGE='invalid_identity_action';
    END IF;
    v_identity_type := NULLIF(btrim(COALESCE(v_guest->>'identity_type','')),'');
    v_identity_number := NULLIF(btrim(COALESCE(v_guest->>'identity_number','')),'');
    IF v_identity_action = 'replace' THEN
      IF v_identity_type IS NULL OR v_identity_number IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='HH348', MESSAGE='identity_pair_required';
      END IF;
      IF v_identity_type NOT IN ('mykad','mypr','passport','other') THEN
        RAISE EXCEPTION USING ERRCODE='HH349', MESSAGE='invalid_identity_type';
      END IF;
    END IF;

    IF v_link_id IS NOT NULL THEN
      SELECT g.guest_id INTO v_guest_id FROM public.hotel_reservation_guests g
        WHERE g.id = v_link_id AND g.reservation_id = p_reservation_id
          AND g.tenant_id = p_tenant_id
        FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE='HH350', MESSAGE='guest_not_found';
      END IF;

      SELECT count(*) INTO v_shared FROM public.hotel_reservation_guests
        WHERE guest_id = v_guest_id AND tenant_id = p_tenant_id;
      IF v_shared > 1 THEN
        INSERT INTO public.hotel_guests
          (tenant_id, full_name, mobile, email, nationality, notes, identity_type,
           identity_number, nationality_code, address_line_1, address_line_2,
           address_line_3, city, postcode, country_code, state_code, state_province)
        SELECT tenant_id, full_name, mobile, email, nationality, notes, identity_type,
               identity_number, nationality_code, address_line_1, address_line_2,
               address_line_3, city, postcode, country_code, state_code, state_province
          FROM public.hotel_guests WHERE id = v_guest_id
        RETURNING id INTO v_new_guest_id;
        UPDATE public.hotel_reservation_guests SET guest_id = v_new_guest_id
          WHERE id = v_link_id;
        v_guest_id := v_new_guest_id;
      END IF;

      IF v_mode = 'contact' THEN
        UPDATE public.hotel_guests SET
          mobile = NULLIF(btrim(COALESCE(v_guest->>'mobile','')),''),
          email = NULLIF(btrim(COALESCE(v_guest->>'email','')),''),
          notes = NULLIF(btrim(COALESCE(v_guest->>'notes','')),''),
          address_line_1 = NULLIF(btrim(COALESCE(v_guest->>'address_line_1','')),''),
          address_line_2 = NULLIF(btrim(COALESCE(v_guest->>'address_line_2','')),''),
          address_line_3 = NULLIF(btrim(COALESCE(v_guest->>'address_line_3','')),''),
          city = NULLIF(btrim(COALESCE(v_guest->>'city','')),''),
          postcode = NULLIF(btrim(COALESCE(v_guest->>'postcode','')),''),
          country_code = NULLIF(btrim(COALESCE(v_guest->>'country_code','')),''),
          state_code = NULLIF(btrim(COALESCE(v_guest->>'state_code','')),''),
          state_province = NULLIF(btrim(COALESCE(v_guest->>'state_province','')),'')
        WHERE id = v_guest_id AND tenant_id = p_tenant_id;
      ELSE
        UPDATE public.hotel_guests SET
          full_name = btrim(v_guest->>'full_name'),
          mobile = NULLIF(btrim(COALESCE(v_guest->>'mobile','')),''),
          email = NULLIF(btrim(COALESCE(v_guest->>'email','')),''),
          notes = NULLIF(btrim(COALESCE(v_guest->>'notes','')),''),
          nationality_code = NULLIF(btrim(COALESCE(v_guest->>'nationality_code','')),''),
          address_line_1 = NULLIF(btrim(COALESCE(v_guest->>'address_line_1','')),''),
          address_line_2 = NULLIF(btrim(COALESCE(v_guest->>'address_line_2','')),''),
          address_line_3 = NULLIF(btrim(COALESCE(v_guest->>'address_line_3','')),''),
          city = NULLIF(btrim(COALESCE(v_guest->>'city','')),''),
          postcode = NULLIF(btrim(COALESCE(v_guest->>'postcode','')),''),
          country_code = NULLIF(btrim(COALESCE(v_guest->>'country_code','')),''),
          state_code = NULLIF(btrim(COALESCE(v_guest->>'state_code','')),''),
          state_province = NULLIF(btrim(COALESCE(v_guest->>'state_province','')),'')
        WHERE id = v_guest_id AND tenant_id = p_tenant_id;

        IF v_identity_action = 'clear' THEN
          UPDATE public.hotel_guests SET identity_type = NULL, identity_number = NULL
            WHERE id = v_guest_id AND tenant_id = p_tenant_id;
          v_identity_cleared := v_identity_cleared + 1;
        ELSIF v_identity_action = 'replace' THEN
          UPDATE public.hotel_guests
             SET identity_type = v_identity_type, identity_number = v_identity_number
           WHERE id = v_guest_id AND tenant_id = p_tenant_id;
          v_identity_replaced := v_identity_replaced + 1;
        END IF;
      END IF;
    ELSE
      IF v_mode = 'contact' THEN
        RAISE EXCEPTION USING ERRCODE='HH351', MESSAGE='guest_edit_locked';
      END IF;
      IF v_identity_action = 'clear' THEN
        RAISE EXCEPTION USING ERRCODE='HH352', MESSAGE='invalid_identity_action';
      END IF;
      INSERT INTO public.hotel_guests
        (tenant_id, full_name, mobile, email, notes, identity_type, identity_number,
         nationality_code, address_line_1, address_line_2, address_line_3, city,
         postcode, country_code, state_code, state_province)
      VALUES (
        p_tenant_id,
        btrim(v_guest->>'full_name'),
        NULLIF(btrim(COALESCE(v_guest->>'mobile','')),''),
        NULLIF(btrim(COALESCE(v_guest->>'email','')),''),
        NULLIF(btrim(COALESCE(v_guest->>'notes','')),''),
        CASE WHEN v_identity_action = 'replace' THEN v_identity_type ELSE NULL END,
        CASE WHEN v_identity_action = 'replace' THEN v_identity_number ELSE NULL END,
        NULLIF(btrim(COALESCE(v_guest->>'nationality_code','')),''),
        NULLIF(btrim(COALESCE(v_guest->>'address_line_1','')),''),
        NULLIF(btrim(COALESCE(v_guest->>'address_line_2','')),''),
        NULLIF(btrim(COALESCE(v_guest->>'address_line_3','')),''),
        NULLIF(btrim(COALESCE(v_guest->>'city','')),''),
        NULLIF(btrim(COALESCE(v_guest->>'postcode','')),''),
        NULLIF(btrim(COALESCE(v_guest->>'country_code','')),''),
        NULLIF(btrim(COALESCE(v_guest->>'state_code','')),''),
        NULLIF(btrim(COALESCE(v_guest->>'state_province','')),'')
      ) RETURNING id INTO v_guest_id;

      INSERT INTO public.hotel_reservation_guests
        (tenant_id, reservation_id, guest_id, is_primary, reservation_room_id)
      VALUES (p_tenant_id, p_reservation_id, v_guest_id, false, NULL)
      RETURNING id INTO v_link_id;
      v_added_guests := v_added_guests + 1;
    END IF;

    IF v_mode = 'contact' THEN
      IF EXISTS (SELECT 1 FROM public.hotel_reservation_guests
                  WHERE id = v_link_id AND reservation_room_id IS DISTINCT FROM v_assigned_room) THEN
        RAISE EXCEPTION USING ERRCODE='HH353', MESSAGE='guest_edit_locked';
      END IF;
    ELSE
      UPDATE public.hotel_reservation_guests
         SET reservation_room_id = v_assigned_room
       WHERE id = v_link_id AND tenant_id = p_tenant_id;
    END IF;

    IF COALESCE((v_guest->>'is_primary')::boolean, false) THEN
      v_primary_count := v_primary_count + 1;
      IF v_link_id IS DISTINCT FROM v_prev_primary THEN
        IF v_mode = 'contact' THEN
          RAISE EXCEPTION USING ERRCODE='HH354', MESSAGE='guest_edit_locked';
        END IF;
        IF v_mode = 'owner_correction' AND NOT v_allow_primary THEN
          RAISE EXCEPTION USING ERRCODE='HH355', MESSAGE='primary_guest_change_not_allowed';
        END IF;
        v_primary_changed := true;
      END IF;
      UPDATE public.hotel_reservation_guests SET is_primary = true
        WHERE id = v_link_id AND tenant_id = p_tenant_id;
    END IF;

    v_keep_guests := array_append(v_keep_guests, v_link_id);
  END LOOP;

  IF v_primary_count = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH356', MESSAGE='primary_guest_required';
  END IF;
  IF v_primary_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE='HH357', MESSAGE='multiple_primary_guests';
  END IF;

  SELECT count(*) INTO v_removed_guests FROM public.hotel_reservation_guests
    WHERE reservation_id = p_reservation_id AND tenant_id = p_tenant_id
      AND NOT (id = ANY(v_keep_guests));
  IF v_removed_guests > 0 AND v_mode = 'contact' THEN
    RAISE EXCEPTION USING ERRCODE='HH358', MESSAGE='guest_edit_locked';
  END IF;
  DELETE FROM public.hotel_reservation_guests
    WHERE reservation_id = p_reservation_id AND tenant_id = p_tenant_id
      AND NOT (id = ANY(v_keep_guests));

  SELECT count(*) INTO v_over FROM (
    SELECT g.reservation_room_id AS rid, count(*) AS n
      FROM public.hotel_reservation_guests g
     WHERE g.reservation_id = p_reservation_id AND g.tenant_id = p_tenant_id
       AND g.reservation_room_id IS NOT NULL
     GROUP BY g.reservation_room_id
  ) t
  JOIN public.hotel_reservation_rooms rr ON rr.id = t.rid
  JOIN public.hotel_rooms hr ON hr.id = rr.hotel_room_id
  WHERE t.n > hr.max_occupancy;
  IF v_over > 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH359', MESSAGE='room_capacity_exceeded';
  END IF;

  UPDATE public.hotel_reservations SET updated_at = now()
    WHERE id = p_reservation_id AND tenant_id = p_tenant_id
    RETURNING updated_at INTO out_updated_at;

  INSERT INTO public.hotel_reservation_events
    (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
  VALUES (p_tenant_id, p_reservation_id, 'reservation_updated',
          CASE WHEN v_mode = 'full' THEN 'Reservation details updated'
               WHEN v_mode = 'contact' THEN 'Guest contact details updated'
               ELSE 'Owner guest correction applied' END,
          p_actor_n3_user_key,
          jsonb_build_object(
            'mode', v_mode,
            'afterCheckIn', (v_mode <> 'full'),
            'roomsAdded', v_added_rooms,
            'roomsRemoved', v_removed_rooms,
            'guestsAdded', v_added_guests,
            'guestsRemoved', v_removed_guests,
            'identityReplaced', v_identity_replaced,
            'identityCleared', v_identity_cleared,
            'primaryGuestChanged', v_primary_changed,
            'correctionReason', v_reason
          ));

  INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
  VALUES (p_tenant_id, p_actor_n3_user_key,
          CASE WHEN v_mode = 'full' THEN 'hotel.reservation.updated'
               ELSE 'hotel.reservation.guest_correction' END,
          jsonb_build_object(
            'bookingReference', v_res.booking_reference,
            'mode', v_mode,
            'roomsAdded', v_added_rooms,
            'roomsRemoved', v_removed_rooms,
            'guestsAdded', v_added_guests,
            'guestsRemoved', v_removed_guests,
            'identityReplaced', v_identity_replaced,
            'identityCleared', v_identity_cleared,
            'primaryGuestChanged', v_primary_changed));

  INSERT INTO public.hotel_mutation_requests
    (tenant_id, client_request_id, scope, reservation_id, fingerprint, result)
  VALUES (p_tenant_id, p_client_request_id, 'reservation_update', p_reservation_id,
          p_fingerprint, jsonb_build_object('updatedAt', out_updated_at));

  out_reservation_id := p_reservation_id;
  out_replayed := false;
  RETURN NEXT;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION USING ERRCODE='HH360', MESSAGE='room_unavailable';
END;
$fn$;

REVOKE ALL ON FUNCTION public.hotelhub_update_reservation_v2(
  uuid,uuid,text,text,uuid,text,timestamptz,text,date,date,text,text,jsonb,jsonb,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hotelhub_update_reservation_v2(
  uuid,uuid,text,text,uuid,text,timestamptz,text,date,date,text,text,jsonb,jsonb,text)
  TO service_role;

DROP FUNCTION IF EXISTS public.hotelhub_update_reservation(
  uuid, uuid, text, timestamptz, text, date, date, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.hotelhub_assign_guest_rooms_v2(
  p_tenant_id uuid,
  p_reservation_id uuid,
  p_actor_n3_user_key text,
  p_actor_role text,
  p_client_request_id uuid,
  p_expected_updated_at timestamptz,
  p_assignments jsonb,
  p_correction_reason text
) RETURNS TABLE(out_updated integer, out_updated_at timestamptz, out_replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_res public.hotel_reservations%ROWTYPE;
  v_ledger public.hotel_mutation_requests%ROWTYPE;
  v_policy text;
  v_item jsonb;
  v_link_id uuid;
  v_room_id uuid;
  v_count integer := 0;
  v_reason text;
  v_over integer;
  v_seen uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_tenant_id IS NULL OR p_reservation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH370', MESSAGE='reservation_not_found';
  END IF;
  IF p_actor_n3_user_key IS NULL OR length(btrim(p_actor_n3_user_key)) = 0
     OR p_actor_role IS NULL OR p_actor_role NOT IN ('owner','front_desk') THEN
    RAISE EXCEPTION USING ERRCODE='HH371', MESSAGE='unauthorized';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH372', MESSAGE='invalid_request';
  END IF;

  SELECT * INTO v_ledger FROM public.hotel_mutation_requests
    WHERE tenant_id = p_tenant_id AND scope = 'guest_assignments'
      AND client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_ledger.reservation_id IS DISTINCT FROM p_reservation_id THEN
      RAISE EXCEPTION USING ERRCODE='HH373', MESSAGE='idempotency_conflict';
    END IF;
    SELECT * INTO v_res FROM public.hotel_reservations
      WHERE id = p_reservation_id AND tenant_id = p_tenant_id;
    RETURN QUERY SELECT 0, v_res.updated_at, true;
    RETURN;
  END IF;

  SELECT * INTO v_res FROM public.hotel_reservations
    WHERE id = p_reservation_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='HH374', MESSAGE='reservation_not_found';
  END IF;
  IF p_expected_updated_at IS NULL OR v_res.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION USING ERRCODE='HH375', MESSAGE='stale_reservation';
  END IF;
  IF v_res.status NOT IN ('confirmed','checked_in') THEN
    RAISE EXCEPTION USING ERRCODE='HH376', MESSAGE='reservation_not_editable';
  END IF;

  SELECT s.post_check_in_guest_edit_policy INTO v_policy
    FROM public.hotel_settings s WHERE s.tenant_id = p_tenant_id;
  IF v_policy IS NULL OR v_policy NOT IN ('locked','contact_only') THEN
    v_policy := 'locked';
  END IF;

  v_reason := NULLIF(btrim(COALESCE(p_correction_reason,'')), '');
  IF v_res.status = 'checked_in' THEN
    IF p_actor_role <> 'owner' THEN
      RAISE EXCEPTION USING ERRCODE='HH377', MESSAGE='guest_edit_locked';
    END IF;
    IF v_reason IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='HH378', MESSAGE='correction_reason_required';
    END IF;
    IF length(v_reason) > 300 THEN
      RAISE EXCEPTION USING ERRCODE='HH379', MESSAGE='correction_reason_too_long';
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_assignments, '[]'::jsonb))
  LOOP
    v_link_id := NULLIF(v_item->>'reservation_guest_id','')::uuid;
    v_room_id := NULLIF(v_item->>'reservation_room_id','')::uuid;
    IF v_link_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='HH380', MESSAGE='guest_not_found';
    END IF;
    IF v_link_id = ANY(v_seen) THEN
      RAISE EXCEPTION USING ERRCODE='HH381', MESSAGE='duplicate_guest';
    END IF;
    v_seen := array_append(v_seen, v_link_id);

    IF NOT EXISTS (
      SELECT 1 FROM public.hotel_reservation_guests g
      WHERE g.id = v_link_id AND g.tenant_id = p_tenant_id
        AND g.reservation_id = p_reservation_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE='HH382', MESSAGE='guest_not_found';
    END IF;
    IF v_room_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.hotel_reservation_rooms rr
      WHERE rr.id = v_room_id AND rr.tenant_id = p_tenant_id
        AND rr.reservation_id = p_reservation_id
        AND rr.allocation_status IN ('reserved','occupied')
    ) THEN
      RAISE EXCEPTION USING ERRCODE='HH383', MESSAGE='room_not_found';
    END IF;

    UPDATE public.hotel_reservation_guests
      SET reservation_room_id = v_room_id
      WHERE id = v_link_id AND tenant_id = p_tenant_id;
    v_count := v_count + 1;
  END LOOP;

  SELECT count(*) INTO v_over FROM (
    SELECT g.reservation_room_id AS rid, count(*) AS n
      FROM public.hotel_reservation_guests g
     WHERE g.reservation_id = p_reservation_id AND g.tenant_id = p_tenant_id
       AND g.reservation_room_id IS NOT NULL
     GROUP BY g.reservation_room_id
  ) t
  JOIN public.hotel_reservation_rooms rr ON rr.id = t.rid
  JOIN public.hotel_rooms hr ON hr.id = rr.hotel_room_id
  WHERE t.n > hr.max_occupancy;
  IF v_over > 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH384', MESSAGE='room_capacity_exceeded';
  END IF;

  UPDATE public.hotel_reservations SET updated_at = now()
    WHERE id = p_reservation_id AND tenant_id = p_tenant_id
    RETURNING updated_at INTO out_updated_at;

  INSERT INTO public.hotel_reservation_events
    (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
  VALUES (p_tenant_id, p_reservation_id, 'guest_updated',
          'Guest room assignments updated', p_actor_n3_user_key,
          jsonb_build_object('assignmentCount', v_count,
                             'afterCheckIn', (v_res.status = 'checked_in'),
                             'correctionReason', v_reason));

  INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
  VALUES (p_tenant_id, p_actor_n3_user_key, 'hotel.reservation.guests_assigned',
          jsonb_build_object('bookingReference', v_res.booking_reference,
                             'assignmentCount', v_count));

  INSERT INTO public.hotel_mutation_requests
    (tenant_id, client_request_id, scope, reservation_id, result)
  VALUES (p_tenant_id, p_client_request_id, 'guest_assignments', p_reservation_id,
          jsonb_build_object('updated', v_count));

  out_updated := v_count;
  out_replayed := false;
  RETURN NEXT;
END;
$fn$;

REVOKE ALL ON FUNCTION public.hotelhub_assign_guest_rooms_v2(
  uuid,uuid,text,text,uuid,timestamptz,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hotelhub_assign_guest_rooms_v2(
  uuid,uuid,text,text,uuid,timestamptz,jsonb,text) TO service_role;

DROP FUNCTION IF EXISTS public.hotelhub_assign_guest_rooms(uuid, uuid, text, jsonb);