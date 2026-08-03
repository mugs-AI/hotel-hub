ALTER TABLE public.hotel_reservation_guests
  ADD COLUMN IF NOT EXISTS reservation_room_id uuid
    REFERENCES public.hotel_reservation_rooms(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS hotel_reservation_guests_room_idx
  ON public.hotel_reservation_guests (tenant_id, reservation_room_id);

CREATE OR REPLACE FUNCTION public.hotelhub_assign_guest_rooms(
  p_tenant_id uuid,
  p_reservation_id uuid,
  p_actor_n3_user_key text,
  p_assignments jsonb
) RETURNS TABLE(out_updated integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res public.hotel_reservations%ROWTYPE;
  v_item jsonb;
  v_link_id uuid;
  v_room_id uuid;
  v_count integer := 0;
BEGIN
  IF p_tenant_id IS NULL OR p_reservation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH250', MESSAGE='reservation_not_found';
  END IF;
  IF p_actor_n3_user_key IS NULL OR length(btrim(p_actor_n3_user_key)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH251', MESSAGE='unauthorized';
  END IF;

  SELECT * INTO v_res FROM public.hotel_reservations
    WHERE id = p_reservation_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='HH252', MESSAGE='reservation_not_found';
  END IF;
  IF v_res.status NOT IN ('confirmed','checked_in') THEN
    RAISE EXCEPTION USING ERRCODE='HH253', MESSAGE='invalid_transition';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_assignments, '[]'::jsonb))
  LOOP
    v_link_id := (v_item->>'reservation_guest_id')::uuid;
    v_room_id := NULLIF(v_item->>'reservation_room_id','')::uuid;

    IF NOT EXISTS (
      SELECT 1 FROM public.hotel_reservation_guests g
      WHERE g.id = v_link_id AND g.tenant_id = p_tenant_id
        AND g.reservation_id = p_reservation_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE='HH254', MESSAGE='guest_not_found';
    END IF;

    IF v_room_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.hotel_reservation_rooms rr
      WHERE rr.id = v_room_id AND rr.tenant_id = p_tenant_id
        AND rr.reservation_id = p_reservation_id
        AND rr.allocation_status IN ('reserved','occupied')
    ) THEN
      RAISE EXCEPTION USING ERRCODE='HH255', MESSAGE='room_not_found';
    END IF;

    UPDATE public.hotel_reservation_guests
      SET reservation_room_id = v_room_id
      WHERE id = v_link_id AND tenant_id = p_tenant_id;
    v_count := v_count + 1;
  END LOOP;

  INSERT INTO public.hotel_reservation_events
    (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
  VALUES (p_tenant_id, p_reservation_id, 'guest_updated',
          'Guest room assignments updated', p_actor_n3_user_key,
          jsonb_build_object('assignment_count', v_count));

  INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
  VALUES (p_tenant_id, p_actor_n3_user_key, 'hotel.reservation.guests_assigned',
          jsonb_build_object('bookingReference', v_res.booking_reference,
                             'assignmentCount', v_count));

  RETURN QUERY SELECT v_count;
END;
$$;