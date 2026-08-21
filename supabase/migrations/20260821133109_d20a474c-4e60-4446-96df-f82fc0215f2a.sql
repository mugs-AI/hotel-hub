-- Lock down leftover internal routines: server-only, never callable from the
-- public Data API. HotelHub's identity is N3-only, so anon/authenticated must
-- never be able to invoke reservation or operation logic directly.
REVOKE ALL ON FUNCTION public.hotelhub_check_in_reservation(uuid, uuid, text, timestamptz, boolean, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hotelhub_decide_operation(uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hotelhub_request_operation(uuid, uuid, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hotelhub_property_now(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hotelhub_seed_booking_sources() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hotelhub_check_in_reservation(uuid, uuid, text, timestamptz, boolean, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.hotelhub_decide_operation(uuid, uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hotelhub_request_operation(uuid, uuid, text, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hotelhub_property_now(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.hotelhub_seed_booking_sources() TO service_role;