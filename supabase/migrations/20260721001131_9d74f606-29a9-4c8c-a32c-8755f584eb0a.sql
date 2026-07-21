-- Lock RPC EXECUTE down to service_role only. Previously PUBLIC could
-- EXECUTE (default), which the Correction A schema tests reject.
REVOKE ALL ON FUNCTION public.hotelhub_create_reservation(uuid, text, text, date, date, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hotelhub_create_reservation(uuid, text, text, date, date, text, jsonb, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.hotelhub_create_reservation(uuid, text, text, date, date, text, jsonb, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.hotelhub_create_reservation(uuid, text, text, date, date, text, jsonb, jsonb) TO service_role;
