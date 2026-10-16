-- REVIEW CANDIDATE ONLY: coordinated source-billing installation, no N3 writes.
-- Entry configuration is not current N3 evidence. Financial preparation must
-- still verify both customers and each leg's own debtor/control account graph.
CREATE FUNCTION public.hh_source_billing_entry_get(p_tenant uuid,p_source_code text,p_actor text,p_role text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.hotel_booking_sources;p public.hotel_source_billing_policies;
BEGIN
 PERFORM public.hh_source_billing_actor(p_tenant,p_actor,p_role);
 SELECT * INTO s FROM public.hotel_booking_sources WHERE tenant_id=p_tenant AND source_code=p_source_code AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'source_policy_scope_mismatch'; END IF;
 SELECT * INTO p FROM public.hotel_source_billing_policies WHERE tenant_id=p_tenant AND source_id=s.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'source_billing_policy_missing'; END IF;
 RETURN jsonb_build_object('tenantId',p_tenant,'sourceCode',s.source_code,'required',true,'policy',public.hh_source_billing_policy_json(p));
END $$;

CREATE FUNCTION public.hh_source_reservation_create(
 p_tenant_id uuid,p_created_by_n3_user_key text,p_booking_source text,
 p_arrival_date date,p_departure_date date,p_notes text,p_external_booking_reference text,
 p_rooms jsonb,p_guests jsonb,p_role text,p_source_id uuid,p_policy_version text,p_collection_mode text
) RETURNS TABLE(out_reservation_id uuid,out_booking_reference text,out_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.hotel_source_billing_policies;created record;stamp timestamptz;
BEGIN
 PERFORM public.hh_source_billing_actor(p_tenant_id,p_created_by_n3_user_key,p_role);
 -- Same lock order as policy writes: source, then policy. No booking exists yet.
 PERFORM 1 FROM public.hotel_booking_sources WHERE tenant_id=p_tenant_id AND id=p_source_id AND source_code=p_booking_source AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'source_policy_scope_mismatch'; END IF;
 SELECT * INTO p FROM public.hotel_source_billing_policies WHERE tenant_id=p_tenant_id AND source_id=p_source_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'source_billing_policy_missing'; END IF;
 IF p_policy_version IS DISTINCT FROM p.version::text THEN RAISE EXCEPTION 'source_policy_version_conflict'; END IF;
 IF p_collection_mode IS NULL OR NOT (p_collection_mode=ANY(p.allowed_collection_modes)) THEN RAISE EXCEPTION 'source_collection_mode_not_allowed'; END IF;
 SELECT * INTO STRICT created FROM public.hotelhub_create_reservation(p_tenant_id,p_created_by_n3_user_key,p_booking_source,p_arrival_date,p_departure_date,p_notes,p_external_booking_reference,p_rooms,p_guests);
 SELECT updated_at INTO STRICT stamp FROM public.hotel_reservations WHERE tenant_id=p_tenant_id AND id=created.out_reservation_id;
 -- Reuse the authoritative payer snapshot/audit transaction and its bounded
 -- Front Desk first-confirm rule. Any failure rolls back rooms, guests and ref.
 PERFORM public.hh_source_billing_payer_confirm(p_tenant_id,created.out_reservation_id,p_created_by_n3_user_key,p_role,p_source_id,p_collection_mode,'0',p_policy_version,stamp);
 RETURN QUERY SELECT created.out_reservation_id::uuid,created.out_booking_reference::text,created.out_status::text;
END $$;

REVOKE ALL ON FUNCTION public.hh_source_billing_entry_get(uuid,text,text,text),public.hh_source_reservation_create(uuid,text,text,date,date,text,text,jsonb,jsonb,text,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.hh_source_billing_entry_get(uuid,text,text,text),public.hh_source_reservation_create(uuid,text,text,date,date,text,text,jsonb,jsonb,text,uuid,text,text) TO service_role;
-- Prevent omission of the reviewed entry payer through the former service RPC.
-- The definer wrapper can still call it inside the same transaction.
REVOKE ALL ON FUNCTION public.hotelhub_create_reservation(uuid,text,text,date,date,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
