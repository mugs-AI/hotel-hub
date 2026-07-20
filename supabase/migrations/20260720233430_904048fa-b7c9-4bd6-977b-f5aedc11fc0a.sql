
-- Milestone 1.1.1 — Reservation, Guest and Room Availability Engine
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============================================================
-- 1) hotel_booking_sequences
-- ============================================================
CREATE TABLE public.hotel_booking_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.hotel_tenants(id) ON DELETE CASCADE,
  sequence_date date NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_booking_sequences_last_number_nonneg CHECK (last_number >= 0),
  CONSTRAINT hotel_booking_sequences_tenant_date_key UNIQUE (tenant_id, sequence_date)
);
GRANT ALL ON public.hotel_booking_sequences TO service_role;
ALTER TABLE public.hotel_booking_sequences ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER hotel_booking_sequences_touch_updated_at
  BEFORE UPDATE ON public.hotel_booking_sequences
  FOR EACH ROW EXECUTE FUNCTION public.hotelhub_touch_updated_at();

-- ============================================================
-- 2) hotel_reservations
-- ============================================================
CREATE TABLE public.hotel_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.hotel_tenants(id) ON DELETE CASCADE,
  booking_reference text NOT NULL,
  booking_source text NOT NULL,
  status text NOT NULL DEFAULT 'confirmed',
  arrival_date date NOT NULL,
  departure_date date NOT NULL,
  currency text NOT NULL,
  notes text,
  created_by_n3_user_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_reservations_dates_valid CHECK (departure_date > arrival_date),
  CONSTRAINT hotel_reservations_booking_source_valid CHECK (
    booking_source IN ('walk_in','phone','whatsapp','hotel_website','agoda','booking_com')
  ),
  CONSTRAINT hotel_reservations_status_valid CHECK (
    status IN ('tentative','confirmed','checked_in','checked_out','cancelled','no_show')
  ),
  CONSTRAINT hotel_reservations_tenant_ref_key UNIQUE (tenant_id, booking_reference)
);
CREATE INDEX hotel_reservations_tenant_arrival_idx
  ON public.hotel_reservations (tenant_id, arrival_date DESC);
CREATE INDEX hotel_reservations_tenant_created_idx
  ON public.hotel_reservations (tenant_id, created_at DESC);
GRANT ALL ON public.hotel_reservations TO service_role;
ALTER TABLE public.hotel_reservations ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER hotel_reservations_touch_updated_at
  BEFORE UPDATE ON public.hotel_reservations
  FOR EACH ROW EXECUTE FUNCTION public.hotelhub_touch_updated_at();

-- ============================================================
-- 3) hotel_guests
-- ============================================================
CREATE TABLE public.hotel_guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.hotel_tenants(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  mobile text,
  email text,
  nationality text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_guests_full_name_not_blank CHECK (length(btrim(full_name)) > 0)
);
CREATE INDEX hotel_guests_tenant_name_idx
  ON public.hotel_guests (tenant_id, lower(full_name));
GRANT ALL ON public.hotel_guests TO service_role;
ALTER TABLE public.hotel_guests ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER hotel_guests_touch_updated_at
  BEFORE UPDATE ON public.hotel_guests
  FOR EACH ROW EXECUTE FUNCTION public.hotelhub_touch_updated_at();

-- ============================================================
-- 4) hotel_reservation_rooms
-- ============================================================
CREATE TABLE public.hotel_reservation_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.hotel_tenants(id) ON DELETE CASCADE,
  reservation_id uuid NOT NULL REFERENCES public.hotel_reservations(id) ON DELETE CASCADE,
  hotel_room_id uuid NOT NULL REFERENCES public.hotel_rooms(id) ON DELETE RESTRICT,
  arrival_date date NOT NULL,
  departure_date date NOT NULL,
  stay_range daterange GENERATED ALWAYS AS (daterange(arrival_date, departure_date, '[)')) STORED,
  base_rate_snapshot numeric(12,2) NOT NULL,
  agreed_rate numeric(12,2) NOT NULL,
  adults integer NOT NULL,
  children integer NOT NULL DEFAULT 0,
  allocation_status text NOT NULL DEFAULT 'reserved',
  rate_override_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_reservation_rooms_dates_valid CHECK (departure_date > arrival_date),
  CONSTRAINT hotel_reservation_rooms_base_rate_nonneg CHECK (base_rate_snapshot >= 0),
  CONSTRAINT hotel_reservation_rooms_agreed_rate_nonneg CHECK (agreed_rate >= 0),
  CONSTRAINT hotel_reservation_rooms_adults_positive CHECK (adults >= 1),
  CONSTRAINT hotel_reservation_rooms_children_nonneg CHECK (children >= 0),
  CONSTRAINT hotel_reservation_rooms_alloc_valid CHECK (
    allocation_status IN ('reserved','occupied','released')
  ),
  CONSTRAINT hotel_reservation_rooms_unique_per_reservation UNIQUE (reservation_id, hotel_room_id)
);
CREATE INDEX hotel_reservation_rooms_tenant_room_range_idx
  ON public.hotel_reservation_rooms USING gist (tenant_id, hotel_room_id, stay_range);
-- Concurrency-safe double-booking prevention: only reserved/occupied block.
ALTER TABLE public.hotel_reservation_rooms
  ADD CONSTRAINT hotel_reservation_rooms_no_overlap EXCLUDE USING gist (
    tenant_id WITH =,
    hotel_room_id WITH =,
    stay_range WITH &&
  ) WHERE (allocation_status IN ('reserved','occupied'));
GRANT ALL ON public.hotel_reservation_rooms TO service_role;
ALTER TABLE public.hotel_reservation_rooms ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER hotel_reservation_rooms_touch_updated_at
  BEFORE UPDATE ON public.hotel_reservation_rooms
  FOR EACH ROW EXECUTE FUNCTION public.hotelhub_touch_updated_at();

-- ============================================================
-- 5) hotel_reservation_guests
-- ============================================================
CREATE TABLE public.hotel_reservation_guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.hotel_tenants(id) ON DELETE CASCADE,
  reservation_id uuid NOT NULL REFERENCES public.hotel_reservations(id) ON DELETE CASCADE,
  guest_id uuid NOT NULL REFERENCES public.hotel_guests(id) ON DELETE RESTRICT,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_reservation_guests_unique UNIQUE (reservation_id, guest_id)
);
CREATE UNIQUE INDEX hotel_reservation_guests_one_primary_idx
  ON public.hotel_reservation_guests (reservation_id) WHERE is_primary;
GRANT ALL ON public.hotel_reservation_guests TO service_role;
ALTER TABLE public.hotel_reservation_guests ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 6) Atomic reservation creation (SECURITY DEFINER)
-- ============================================================
CREATE OR REPLACE FUNCTION public.hotelhub_create_reservation(
  p_tenant_id uuid,
  p_created_by_n3_user_key text,
  p_booking_source text,
  p_arrival_date date,
  p_departure_date date,
  p_notes text,
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
  v_reservation_id uuid;
  v_booking_ref text;
  v_seq_date date;
  v_next_num integer;
  v_new_guest_id uuid;
  v_new_room_alloc_id uuid;
  v_dup_room boolean;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH001', MESSAGE='tenant_required';
  END IF;
  IF p_created_by_n3_user_key IS NULL OR length(btrim(p_created_by_n3_user_key)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH002', MESSAGE='creator_required';
  END IF;
  IF p_booking_source NOT IN ('walk_in','phone','whatsapp','hotel_website','agoda','booking_com') THEN
    RAISE EXCEPTION USING ERRCODE='HH003', MESSAGE='invalid_booking_source';
  END IF;
  IF p_arrival_date IS NULL OR p_departure_date IS NULL OR p_departure_date <= p_arrival_date THEN
    RAISE EXCEPTION USING ERRCODE='HH004', MESSAGE='invalid_stay_dates';
  END IF;

  -- Setup readiness.
  SELECT hs.currency, hs.timezone, hs.n3_walk_in_customer_id
    INTO v_currency, v_timezone, v_walk_in
    FROM public.hotel_settings AS hs
    WHERE hs.tenant_id = p_tenant_id;
  IF v_currency IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH005', MESSAGE='setup_incomplete';
  END IF;
  IF v_walk_in IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH005', MESSAGE='setup_incomplete';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.hotel_rooms AS hr
    WHERE hr.tenant_id = p_tenant_id AND hr.is_active
  ) THEN
    RAISE EXCEPTION USING ERRCODE='HH005', MESSAGE='setup_incomplete';
  END IF;

  -- Room / guest presence.
  v_room_count := COALESCE(jsonb_array_length(p_rooms), 0);
  v_guest_count := COALESCE(jsonb_array_length(p_guests), 0);
  IF v_room_count = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH006', MESSAGE='room_required';
  END IF;
  IF v_guest_count = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH007', MESSAGE='guest_required';
  END IF;

  -- Duplicate room_id inside the payload.
  SELECT EXISTS (
    SELECT (elem->>'hotel_room_id')::uuid
    FROM jsonb_array_elements(p_rooms) AS elem
    GROUP BY (elem->>'hotel_room_id')::uuid
    HAVING count(*) > 1
  ) INTO v_dup_room;
  IF v_dup_room THEN
    RAISE EXCEPTION USING ERRCODE='HH008', MESSAGE='duplicate_room';
  END IF;

  -- Primary guest count.
  SELECT count(*) INTO v_primary_count
  FROM jsonb_array_elements(p_guests) AS elem
  WHERE COALESCE((elem->>'is_primary')::boolean, false) = true;
  IF v_primary_count = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH009', MESSAGE='primary_guest_required';
  END IF;
  IF v_primary_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE='HH010', MESSAGE='multiple_primary_guests';
  END IF;

  -- Generate booking reference (tenant + hotel date scoped).
  v_seq_date := (now() AT TIME ZONE v_timezone)::date;
  INSERT INTO public.hotel_booking_sequences AS bs (tenant_id, sequence_date, last_number)
  VALUES (p_tenant_id, v_seq_date, 1)
  ON CONFLICT (tenant_id, sequence_date)
  DO UPDATE SET last_number = bs.last_number + 1, updated_at = now()
  RETURNING bs.last_number INTO v_next_num;
  v_booking_ref := 'BK'
    || to_char(v_seq_date, 'YYMMDD')
    || lpad(v_next_num::text, 3, '0');

  -- Insert reservation header.
  INSERT INTO public.hotel_reservations (
    tenant_id, booking_reference, booking_source, status,
    arrival_date, departure_date, currency, notes, created_by_n3_user_key
  )
  VALUES (
    p_tenant_id, v_booking_ref, p_booking_source, 'confirmed',
    p_arrival_date, p_departure_date, v_currency,
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    p_created_by_n3_user_key
  )
  RETURNING id INTO v_reservation_id;

  -- Guests + guest links.
  FOR v_guest IN SELECT * FROM jsonb_array_elements(p_guests) LOOP
    IF length(btrim(COALESCE(v_guest->>'full_name', ''))) = 0 THEN
      RAISE EXCEPTION USING ERRCODE='HH011', MESSAGE='guest_full_name_required';
    END IF;
    INSERT INTO public.hotel_guests (
      tenant_id, full_name, mobile, email, nationality, notes
    ) VALUES (
      p_tenant_id,
      btrim(v_guest->>'full_name'),
      NULLIF(btrim(COALESCE(v_guest->>'mobile','')), ''),
      NULLIF(btrim(COALESCE(v_guest->>'email','')), ''),
      NULLIF(btrim(COALESCE(v_guest->>'nationality','')), ''),
      NULLIF(btrim(COALESCE(v_guest->>'notes','')), '')
    ) RETURNING id INTO v_new_guest_id;

    INSERT INTO public.hotel_reservation_guests (
      tenant_id, reservation_id, guest_id, is_primary
    ) VALUES (
      p_tenant_id, v_reservation_id, v_new_guest_id,
      COALESCE((v_guest->>'is_primary')::boolean, false)
    );
  END LOOP;

  -- Room allocations.
  FOR v_room IN SELECT * FROM jsonb_array_elements(p_rooms) LOOP
    v_room_id := (v_room->>'hotel_room_id')::uuid;
    v_adults := COALESCE((v_room->>'adults')::integer, 1);
    v_children := COALESCE((v_room->>'children')::integer, 0);
    v_agreed := COALESCE((v_room->>'agreed_rate')::numeric, -1);
    v_reason := NULLIF(btrim(COALESCE(v_room->>'rate_override_reason','')), '');

    SELECT hr.base_rate, hr.max_occupancy, hr.is_active
      INTO v_room_rate, v_room_max, v_room_active
      FROM public.hotel_rooms AS hr
      WHERE hr.id = v_room_id AND hr.tenant_id = p_tenant_id;
    IF v_room_rate IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='HH012', MESSAGE='room_not_found';
    END IF;
    IF NOT v_room_active THEN
      RAISE EXCEPTION USING ERRCODE='HH013', MESSAGE='room_inactive';
    END IF;
    IF v_adults < 1 THEN
      RAISE EXCEPTION USING ERRCODE='HH014', MESSAGE='invalid_occupancy';
    END IF;
    IF (v_adults + v_children) > v_room_max THEN
      RAISE EXCEPTION USING ERRCODE='HH015', MESSAGE='occupancy_exceeded';
    END IF;
    IF v_agreed < 0 THEN
      RAISE EXCEPTION USING ERRCODE='HH016', MESSAGE='invalid_rate';
    END IF;
    IF v_agreed <> v_room_rate AND v_reason IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='HH017', MESSAGE='rate_override_reason_required';
    END IF;

    BEGIN
      INSERT INTO public.hotel_reservation_rooms (
        tenant_id, reservation_id, hotel_room_id,
        arrival_date, departure_date,
        base_rate_snapshot, agreed_rate,
        adults, children, allocation_status, rate_override_reason
      ) VALUES (
        p_tenant_id, v_reservation_id, v_room_id,
        p_arrival_date, p_departure_date,
        v_room_rate, v_agreed,
        v_adults, v_children, 'reserved', v_reason
      ) RETURNING id INTO v_new_room_alloc_id;
    EXCEPTION
      WHEN exclusion_violation THEN
        RAISE EXCEPTION USING ERRCODE='HH018', MESSAGE='room_not_available';
    END;
  END LOOP;

  RETURN QUERY
    SELECT v_reservation_id AS out_reservation_id,
           v_booking_ref    AS out_booking_reference,
           'confirmed'::text AS out_status;
END;
$fn$;

REVOKE ALL ON FUNCTION public.hotelhub_create_reservation(
  uuid, text, text, date, date, text, jsonb, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hotelhub_create_reservation(
  uuid, text, text, date, date, text, jsonb, jsonb
) TO service_role;
