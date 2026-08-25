CREATE OR REPLACE FUNCTION public.hotelhub_list_reservations(
  p_tenant_id uuid,
  p_booking_reference text DEFAULT NULL,
  p_guest_name text DEFAULT NULL,
  p_guest_mobile text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_booking_source text DEFAULT NULL,
  p_arrival_from date DEFAULT NULL,
  p_arrival_to date DEFAULT NULL,
  p_sort_key text DEFAULT 'createdAt',
  p_sort_dir text DEFAULT 'desc',
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_key text := coalesce(nullif(btrim(p_sort_key), ''), 'createdAt');
  v_dir text := lower(coalesce(nullif(btrim(p_sort_dir), ''), 'desc'));
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_ref text := nullif(btrim(coalesce(p_booking_reference, '')), '');
  v_name text := nullif(btrim(coalesce(p_guest_name, '')), '');
  v_mobile text := nullif(btrim(coalesce(p_guest_mobile, '')), '');
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_source text := nullif(btrim(coalesce(p_booking_source, '')), '');
  v_total bigint := 0;
  v_items jsonb := '[]'::jsonb;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_required';
  END IF;
  IF v_key NOT IN (
    'bookingReference','primaryGuestName','arrivalDate','departureDate',
    'roomNo','guestCount','bookingSource','status','createdAt'
  ) THEN
    RAISE EXCEPTION 'invalid_sort_key';
  END IF;
  IF v_dir NOT IN ('asc','desc') THEN
    RAISE EXCEPTION 'invalid_sort_dir';
  END IF;

  WITH base AS (
    SELECT r.id, r.booking_reference, r.booking_source, r.status,
           r.arrival_date, r.departure_date, r.created_at, r.created_by_n3_user_key
    FROM public.hotel_reservations r
    WHERE r.tenant_id = p_tenant_id
      AND (v_ref IS NULL OR r.booking_reference ILIKE '%' || replace(replace(v_ref, '%', ''), '_', '') || '%')
      AND (v_status IS NULL OR r.status = v_status)
      AND (v_source IS NULL OR r.booking_source = v_source)
      AND (p_arrival_from IS NULL OR r.arrival_date >= p_arrival_from)
      AND (p_arrival_to IS NULL OR r.arrival_date <= p_arrival_to)
      AND (
        (v_name IS NULL AND v_mobile IS NULL)
        OR EXISTS (
          SELECT 1
          FROM public.hotel_reservation_guests rg
          JOIN public.hotel_guests g
            ON g.id = rg.guest_id AND g.tenant_id = p_tenant_id
          WHERE rg.reservation_id = r.id
            AND rg.tenant_id = p_tenant_id
            AND (v_name IS NULL OR g.full_name ILIKE '%' || replace(replace(v_name, '%', ''), '_', '') || '%')
            AND (v_mobile IS NULL OR g.mobile ILIKE '%' || replace(replace(v_mobile, '%', ''), '_', '') || '%')
        )
      )
  )
  SELECT count(*) INTO v_total FROM base;

  WITH base AS (
    SELECT r.id, r.booking_reference, r.booking_source, r.status,
           r.arrival_date, r.departure_date, r.created_at, r.created_by_n3_user_key
    FROM public.hotel_reservations r
    WHERE r.tenant_id = p_tenant_id
      AND (v_ref IS NULL OR r.booking_reference ILIKE '%' || replace(replace(v_ref, '%', ''), '_', '') || '%')
      AND (v_status IS NULL OR r.status = v_status)
      AND (v_source IS NULL OR r.booking_source = v_source)
      AND (p_arrival_from IS NULL OR r.arrival_date >= p_arrival_from)
      AND (p_arrival_to IS NULL OR r.arrival_date <= p_arrival_to)
      AND (
        (v_name IS NULL AND v_mobile IS NULL)
        OR EXISTS (
          SELECT 1
          FROM public.hotel_reservation_guests rg
          JOIN public.hotel_guests g
            ON g.id = rg.guest_id AND g.tenant_id = p_tenant_id
          WHERE rg.reservation_id = r.id
            AND rg.tenant_id = p_tenant_id
            AND (v_name IS NULL OR g.full_name ILIKE '%' || replace(replace(v_name, '%', ''), '_', '') || '%')
            AND (v_mobile IS NULL OR g.mobile ILIKE '%' || replace(replace(v_mobile, '%', ''), '_', '') || '%')
        )
      )
  ),
  agg AS (
    SELECT b.*,
      (
        SELECT coalesce(g.full_name, '')
        FROM public.hotel_reservation_guests rg
        JOIN public.hotel_guests g ON g.id = rg.guest_id AND g.tenant_id = p_tenant_id
        WHERE rg.reservation_id = b.id AND rg.tenant_id = p_tenant_id AND rg.is_primary
        ORDER BY rg.created_at, rg.id
        LIMIT 1
      ) AS primary_name,
      (
        SELECT g.mobile
        FROM public.hotel_reservation_guests rg
        JOIN public.hotel_guests g ON g.id = rg.guest_id AND g.tenant_id = p_tenant_id
        WHERE rg.reservation_id = b.id AND rg.tenant_id = p_tenant_id AND rg.is_primary
        ORDER BY rg.created_at, rg.id
        LIMIT 1
      ) AS primary_mobile,
      (
        SELECT count(*)::int
        FROM public.hotel_reservation_guests rg
        WHERE rg.reservation_id = b.id AND rg.tenant_id = p_tenant_id
      ) AS guest_count,
      (
        SELECT count(*)::int
        FROM public.hotel_reservation_rooms rr
        WHERE rr.reservation_id = b.id AND rr.tenant_id = p_tenant_id
      ) AS room_count,
      coalesce((
        SELECT array_agg(lbl ORDER BY ord)
        FROM (
          SELECT coalesce(
                   nullif(btrim(coalesce(rm.display_name, '')), ''),
                   nullif(btrim(coalesce(rm.n3_stock_name, '')), ''),
                   nullif(btrim(coalesce(rm.room_number, '')), '')
                 ) AS lbl,
                 row_number() OVER (ORDER BY rr.created_at, rr.id) AS ord
          FROM public.hotel_reservation_rooms rr
          JOIN public.hotel_rooms rm ON rm.id = rr.hotel_room_id AND rm.tenant_id = p_tenant_id
          WHERE rr.reservation_id = b.id AND rr.tenant_id = p_tenant_id
        ) labels
        WHERE lbl IS NOT NULL
      ), ARRAY[]::text[]) AS room_labels,
      coalesce((
        SELECT string_agg(num, ',' ORDER BY num)
        FROM (
          SELECT lower(btrim(coalesce(rm.room_number, ''))) AS num
          FROM public.hotel_reservation_rooms rr
          JOIN public.hotel_rooms rm ON rm.id = rr.hotel_room_id AND rm.tenant_id = p_tenant_id
          WHERE rr.reservation_id = b.id AND rr.tenant_id = p_tenant_id
        ) nums
        WHERE num <> ''
      ), '') AS room_number_sort
    FROM base b
  ),
  keyed AS (
    SELECT a.*,
      CASE v_key
        WHEN 'bookingReference' THEN lower(a.booking_reference)
        WHEN 'primaryGuestName' THEN lower(coalesce(a.primary_name, ''))
        WHEN 'arrivalDate' THEN a.arrival_date::text
        WHEN 'departureDate' THEN a.departure_date::text
        WHEN 'roomNo' THEN a.room_number_sort
        WHEN 'bookingSource' THEN lower(a.booking_source)
        WHEN 'status' THEN lower(a.status)
        WHEN 'createdAt' THEN to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
        ELSE NULL
      END AS sort_text,
      CASE WHEN v_key = 'guestCount' THEN a.guest_count ELSE NULL END AS sort_num
    FROM agg a
  ),
  page AS (
    SELECT * FROM keyed
    ORDER BY
      CASE WHEN v_dir = 'asc' THEN sort_num END ASC NULLS LAST,
      CASE WHEN v_dir = 'desc' THEN sort_num END DESC NULLS LAST,
      CASE WHEN v_dir = 'asc' THEN sort_text END ASC NULLS LAST,
      CASE WHEN v_dir = 'desc' THEN sort_text END DESC NULLS LAST,
      created_at DESC,
      id DESC
    LIMIT v_limit OFFSET v_offset
  ),
  numbered AS (
    SELECT row_number() OVER () AS rn, p.* FROM page p
  )
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', n.id,
      'bookingReference', n.booking_reference,
      'primaryGuestName', n.primary_name,
      'primaryGuestMobile', n.primary_mobile,
      'bookingSource', n.booking_source,
      'status', n.status,
      'arrivalDate', n.arrival_date::text,
      'departureDate', n.departure_date::text,
      'roomCount', n.room_count,
      'roomLabels', to_jsonb(n.room_labels),
      'guestCount', n.guest_count,
      'createdAt', n.created_at,
      'createdByN3UserKey', n.created_by_n3_user_key
    ) ORDER BY n.rn
  ), '[]'::jsonb) INTO v_items FROM numbered n;

  RETURN jsonb_build_object('items', v_items, 'total', v_total);
END;
$fn$;

REVOKE ALL ON FUNCTION public.hotelhub_list_reservations(uuid, text, text, text, text, text, date, date, text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hotelhub_list_reservations(uuid, text, text, text, text, text, date, date, text, text, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hotelhub_list_reservations(uuid, text, text, text, text, text, date, date, text, text, integer, integer) TO service_role;