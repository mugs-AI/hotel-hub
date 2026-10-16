-- REVIEW CANDIDATE ONLY; follows canonical preparation and staff authority.
-- Allocation is local configuration, never acceptance of an N3 financial write.
CREATE TABLE public.hotel_source_charge_attributions (
 tenant_id uuid NOT NULL,reservation_id uuid NOT NULL,revision bigint NOT NULL CHECK(revision>0),
 basis jsonb NOT NULL,basis_digest text NOT NULL CHECK(basis_digest ~ '^[a-f0-9]{64}$'),assignments jsonb NOT NULL,
 actor text NOT NULL,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,reservation_id),FOREIGN KEY(tenant_id,reservation_id) REFERENCES public.hotel_reservations(tenant_id,id)
);
CREATE TABLE public.hotel_source_charge_attribution_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,reservation_id uuid NOT NULL,
 revision bigint NOT NULL,previous jsonb,saved jsonb NOT NULL,actor text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,reservation_id) REFERENCES public.hotel_reservations(tenant_id,id),UNIQUE(tenant_id,reservation_id,revision)
);
ALTER TABLE public.hotel_source_charge_attributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_source_charge_attribution_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hotel_source_charge_attributions,public.hotel_source_charge_attribution_audit FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.hotel_source_charge_attributions,public.hotel_source_charge_attribution_audit TO service_role;
CREATE TRIGGER source_charge_attribution_audit_immutable BEFORE UPDATE OR DELETE ON public.hotel_source_charge_attribution_audit FOR EACH ROW EXECUTE FUNCTION public.hotelhub_settlement_immutable();
CREATE FUNCTION public.hh_source_attribution_json(a public.hotel_source_charge_attributions) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('revision',a.revision::text,'basis',a.basis,'basisDigest',a.basis_digest,'assignments',a.assignments)
$$;
CREATE FUNCTION public.hh_source_attribution_get(p_tenant uuid,p_reservation uuid,p_actor text,p_role text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.hotel_reservations;p public.hotel_reservation_payers;a public.hotel_source_charge_attributions;b public.hotel_source_billing_plans;
BEGIN
 PERFORM public.hh_source_billing_actor(p_tenant,p_actor,p_role);
 SELECT * INTO r FROM public.hotel_reservations WHERE tenant_id=p_tenant AND id=p_reservation;
 IF NOT FOUND THEN RAISE EXCEPTION 'reservation_not_found'; END IF;
 SELECT * INTO p FROM public.hotel_reservation_payers WHERE tenant_id=p_tenant AND reservation_id=p_reservation;
 IF NOT FOUND THEN RAISE EXCEPTION 'source_payer_required'; END IF;
 SELECT * INTO a FROM public.hotel_source_charge_attributions WHERE tenant_id=p_tenant AND reservation_id=p_reservation;
 SELECT * INTO b FROM public.hotel_source_billing_plans WHERE tenant_id=p_tenant AND reservation_id=p_reservation;
 RETURN jsonb_build_object('tenantId',p_tenant,'reservationId',p_reservation,'payerRevision',p.revision::text,'payer',public.hh_source_billing_payer_json(p),
 'frozen',r.status IN ('checked_out','cancelled','no_show') OR EXISTS(SELECT 1 FROM public.hotel_settlement_intents WHERE tenant_id=p_tenant AND reservation_id=p_reservation AND state<>'abandoned'),
 'record',CASE WHEN a.reservation_id IS NULL THEN NULL ELSE public.hh_source_attribution_json(a) END,
 'frozenPlan',CASE WHEN b.reservation_id IS NULL THEN NULL ELSE jsonb_build_object('payerRevision',b.payer_revision::text,'plan',b.plan) END);
END $$;
CREATE FUNCTION public.hh_source_attribution_put(p_tenant uuid,p_reservation uuid,p_actor text,p_role text,p_expected_revision text,p_basis jsonb,p_basis_digest text,p_assignments jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.hotel_reservations;f public.hotel_folios;p public.hotel_reservation_payers;a public.hotel_source_charge_attributions;previous jsonb;row jsonb;zone text;
BEGIN
 PERFORM public.hh_source_billing_actor(p_tenant,p_actor,p_role);
 IF p_role<>'owner' THEN RAISE EXCEPTION 'source_attribution_owner_required'; END IF;
 PERFORM public.hotelhub_settlement_guard(p_tenant,p_reservation,true);
 SELECT * INTO r FROM public.hotel_reservations WHERE tenant_id=p_tenant AND id=p_reservation FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'reservation_not_found'; END IF;
 IF r.status<>'checked_in' THEN RAISE EXCEPTION 'source_attribution_frozen'; END IF;
 SELECT * INTO f FROM public.hotel_folios WHERE tenant_id=p_tenant AND reservation_id=p_reservation FOR SHARE;
 IF NOT FOUND OR f.status<>'prepared' THEN RAISE EXCEPTION 'source_attribution_not_ready'; END IF;
 SELECT * INTO p FROM public.hotel_reservation_payers WHERE tenant_id=p_tenant AND reservation_id=p_reservation FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'source_payer_required'; END IF;
 SELECT timezone INTO zone FROM public.hotel_settings WHERE tenant_id=p_tenant;
 IF p_expected_revision IS NULL OR p_expected_revision !~ '^(0|[1-9][0-9]{0,18})$' OR p_expected_revision::numeric>9223372036854775807 THEN RAISE EXCEPTION 'source_attribution_changed'; END IF;
 IF jsonb_typeof(p_basis) IS DISTINCT FROM 'object' OR p_basis-ARRAY['tenantId','reservationId','folioId','payerRevision','billDate','currency','sourceVersions','rows']<>'{}'
  OR p_basis->>'tenantId' IS DISTINCT FROM p_tenant::text OR p_basis->>'reservationId' IS DISTINCT FROM p_reservation::text OR p_basis->>'folioId' IS DISTINCT FROM f.id::text
  OR p_basis->>'payerRevision' IS DISTINCT FROM p.revision::text OR p_basis->>'currency' IS DISTINCT FROM r.currency
  OR zone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone)
  OR p_basis->>'billDate' IS DISTINCT FROM (clock_timestamp() AT TIME ZONE zone)::date::text
  OR p_basis->'sourceVersions' IS DISTINCT FROM public.hotelhub_settlement_sources(p_tenant,p_reservation)
  OR p_basis_digest IS DISTINCT FROM encode(sha256(convert_to(public.hotelhub_settlement_payload_json(p_basis),'UTF8')),'hex')
 THEN RAISE EXCEPTION 'source_attribution_changed'; END IF;
 IF jsonb_typeof(p_basis->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(p_basis->'rows') NOT BETWEEN 1 AND 10000
  OR jsonb_typeof(p_assignments) IS DISTINCT FROM 'array' OR jsonb_array_length(p_assignments)<>jsonb_array_length(p_basis->'rows')
 THEN RAISE EXCEPTION 'source_charge_attribution_invalid'; END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(p_basis->'rows') LOOP
  IF jsonb_typeof(row) IS DISTINCT FROM 'object' OR row-ARRAY['lineId','kind','description','totalCents']<>'{}'
   OR jsonb_typeof(row->'lineId') IS DISTINCT FROM 'string' OR coalesce(row->>'lineId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
   OR jsonb_typeof(row->'description') IS DISTINCT FROM 'string' OR public.hotelhub_utf16_length(row->>'description') NOT BETWEEN 1 AND 160
   OR jsonb_typeof(row->'totalCents') IS DISTINCT FROM 'number' OR coalesce(row->>'totalCents','') !~ '^(0|[1-9][0-9]{0,9})$' OR (row->>'totalCents')::numeric>1000000000
   OR coalesce(row->>'kind','') NOT IN ('room_night','add_on','service_charge','tourism_tax','local_levy')
  THEN RAISE EXCEPTION 'source_charge_attribution_invalid'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.hh_source_billing_active_lines(p_tenant,f.id) l WHERE l.id=(row->>'lineId')::uuid AND l.line_type::text=row->>'kind')
   AND NOT (row->>'kind' IN ('service_charge','tourism_tax','local_levy') AND (row->>'lineId')::uuid=public.hotelhub_billing_derived_id(p_tenant,p_reservation,f.id,row->>'kind'))
  THEN RAISE EXCEPTION 'source_charge_attribution_invalid'; END IF;
 END LOOP;
 IF (SELECT count(DISTINCT x->>'lineId') FROM jsonb_array_elements(p_basis->'rows') x)<>jsonb_array_length(p_basis->'rows')
  OR EXISTS(SELECT 1 FROM public.hh_source_billing_active_lines(p_tenant,f.id) l WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_basis->'rows') x WHERE x->>'lineId'=l.id::text))
 THEN RAISE EXCEPTION 'source_charge_attribution_invalid'; END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(p_assignments) LOOP
  IF jsonb_typeof(row) IS DISTINCT FROM 'object' OR row-ARRAY['lineId','leg']<>'{}'
   OR jsonb_typeof(row->'lineId') IS DISTINCT FROM 'string' OR coalesce(row->>'leg','') NOT IN ('source_room','guest')
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_basis->'rows') x WHERE x->>'lineId'=row->>'lineId')
   OR (p.collection_mode='guest' AND row->>'leg'<>'guest')
  THEN RAISE EXCEPTION 'source_charge_attribution_invalid'; END IF;
 END LOOP;
 IF (SELECT count(DISTINCT x->>'lineId') FROM jsonb_array_elements(p_assignments) x)<>jsonb_array_length(p_assignments)
  OR (p.collection_mode='source' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_assignments) x WHERE x->>'leg'='source_room'))
 THEN RAISE EXCEPTION 'source_charge_attribution_invalid'; END IF;
 SELECT * INTO a FROM public.hotel_source_charge_attributions WHERE tenant_id=p_tenant AND reservation_id=p_reservation FOR UPDATE;
 IF coalesce(a.revision,0)::text IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'source_attribution_changed'; END IF;
 previous:=CASE WHEN a.reservation_id IS NULL THEN NULL ELSE public.hh_source_attribution_json(a) END;
 INSERT INTO public.hotel_source_charge_attributions(tenant_id,reservation_id,revision,basis,basis_digest,assignments,actor)
 VALUES(p_tenant,p_reservation,1,p_basis,p_basis_digest,p_assignments,p_actor)
 ON CONFLICT(tenant_id,reservation_id) DO UPDATE SET revision=public.hotel_source_charge_attributions.revision+1,basis=p_basis,basis_digest=p_basis_digest,assignments=p_assignments,actor=p_actor,updated_at=clock_timestamp() RETURNING * INTO a;
 INSERT INTO public.hotel_source_charge_attribution_audit(tenant_id,reservation_id,revision,previous,saved,actor) VALUES(p_tenant,p_reservation,a.revision,previous,public.hh_source_attribution_json(a),p_actor);
 RETURN public.hh_source_attribution_json(a);
END $$;

-- Internal freeze validator: amount/account preparation remains independently
-- authoritative in the existing canonical freeze; allocation cannot reprice it.
CREATE FUNCTION public.hh_source_attribution_assert_plan(p_tenant uuid,p_reservation uuid,p_plan jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.hotel_source_charge_attributions;p public.hotel_reservation_payers;leg jsonb;line jsonb;expected text;seen text[]:=ARRAY[]::text[];zone text;
BEGIN
 SELECT * INTO p FROM public.hotel_reservation_payers WHERE tenant_id=p_tenant AND reservation_id=p_reservation;
 IF NOT FOUND THEN RAISE EXCEPTION 'source_payer_required'; END IF;
 SELECT * INTO a FROM public.hotel_source_charge_attributions WHERE tenant_id=p_tenant AND reservation_id=p_reservation;
 SELECT timezone INTO zone FROM public.hotel_settings WHERE tenant_id=p_tenant;
 IF a.reservation_id IS NOT NULL AND (a.basis->>'payerRevision' IS DISTINCT FROM p.revision::text OR a.basis->'sourceVersions' IS DISTINCT FROM public.hotelhub_settlement_sources(p_tenant,p_reservation)
  OR a.basis->>'billDate' IS DISTINCT FROM (clock_timestamp() AT TIME ZONE zone)::date::text) THEN RAISE EXCEPTION 'source_attribution_changed'; END IF;
 FOR leg IN SELECT value FROM jsonb_array_elements(p_plan->'legs') LOOP
  IF a.reservation_id IS NOT NULL AND (leg->'snapshot'->>'folioId' IS DISTINCT FROM a.basis->>'folioId' OR leg->'snapshot'->>'billDate' IS DISTINCT FROM a.basis->>'billDate') THEN RAISE EXCEPTION 'source_attribution_changed'; END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(leg->'snapshot'->'lines') LOOP
   IF line->>'localLineId'=ANY(seen) THEN RAISE EXCEPTION 'source_charge_attribution_invalid'; END IF;
   seen:=array_append(seen,line->>'localLineId');
   IF a.reservation_id IS NULL THEN
    expected:=CASE WHEN p.collection_mode='guest' THEN 'guest' WHEN line->>'kind'='room_night' THEN 'source_room' WHEN line->>'kind'='add_on' THEN 'guest' ELSE NULL END;
    IF expected IS NULL THEN RAISE EXCEPTION 'source_charge_attribution_required'; END IF;
   ELSE
    SELECT x->>'leg' INTO expected FROM jsonb_array_elements(a.assignments) x WHERE x->>'lineId'=line->>'localLineId';
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.basis->'rows') x WHERE x->>'lineId'=line->>'localLineId' AND x->>'kind'=line->>'kind' AND x->'totalCents'=line->'totalCents') THEN RAISE EXCEPTION 'source_attribution_changed'; END IF;
   END IF;
   IF expected IS DISTINCT FROM leg->>'kind' THEN RAISE EXCEPTION 'source_charge_attribution_invalid'; END IF;
  END LOOP;
 END LOOP;
 IF a.reservation_id IS NOT NULL AND cardinality(seen)<>jsonb_array_length(a.assignments) THEN RAISE EXCEPTION 'source_charge_attribution_invalid'; END IF;
END $$;
ALTER FUNCTION public.hh_source_billing_freeze(uuid,uuid,text,jsonb,uuid) RENAME TO hh_source_billing_freeze_before_attribution;
CREATE FUNCTION public.hh_source_billing_freeze(p_tenant_id uuid,p_reservation_id uuid,p_actor text,p_plan jsonb,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.hotelhub_settlement_operator(p_tenant_id,p_actor);
 PERFORM 1 FROM public.hotel_reservations WHERE tenant_id=p_tenant_id AND id=p_reservation_id FOR UPDATE;
 -- The existing routine alone owns exact replay/conflict semantics.
 IF NOT EXISTS(SELECT 1 FROM public.hotel_source_billing_plans WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id) THEN PERFORM public.hh_source_attribution_assert_plan(p_tenant_id,p_reservation_id,p_plan); END IF;
 RETURN public.hh_source_billing_freeze_before_attribution(p_tenant_id,p_reservation_id,p_actor,p_plan,p_request_id);
END $$;
ALTER FUNCTION public.hotelhub_settlement_freeze(uuid,uuid,text,jsonb,uuid) RENAME TO hotelhub_settlement_freeze_before_attribution;
CREATE FUNCTION public.hotelhub_settlement_freeze(p_tenant_id uuid,p_reservation_id uuid,p_actor text,p_snapshot jsonb,p_client_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.hotelhub_settlement_operator(p_tenant_id,p_actor);
 PERFORM 1 FROM public.hotel_reservations WHERE tenant_id=p_tenant_id AND id=p_reservation_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.hotel_reservation_payers WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id) THEN RAISE EXCEPTION 'source_billing_leg_required'; END IF;
 RETURN public.hotelhub_settlement_freeze_before_attribution(p_tenant_id,p_reservation_id,p_actor,p_snapshot,p_client_request_id);
END $$;
REVOKE ALL ON FUNCTION public.hh_source_attribution_json(public.hotel_source_charge_attributions),public.hh_source_attribution_get(uuid,uuid,text,text),public.hh_source_attribution_put(uuid,uuid,text,text,text,jsonb,text,jsonb),public.hh_source_attribution_assert_plan(uuid,uuid,jsonb),public.hh_source_billing_freeze_before_attribution(uuid,uuid,text,jsonb,uuid),public.hotelhub_settlement_freeze_before_attribution(uuid,uuid,text,jsonb,uuid),public.hh_source_billing_freeze(uuid,uuid,text,jsonb,uuid),public.hotelhub_settlement_freeze(uuid,uuid,text,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.hh_source_attribution_get(uuid,uuid,text,text),public.hh_source_attribution_put(uuid,uuid,text,text,text,jsonb,text,jsonb),public.hh_source_billing_freeze(uuid,uuid,text,jsonb,uuid),public.hotelhub_settlement_freeze(uuid,uuid,text,jsonb,uuid) TO service_role;
