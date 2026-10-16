-- Candidate only: apply through the verified Lovable-managed backend separately.
-- Requires billing, source-billing and staff-settlement migrations in that order.
-- Original operational folio lines are never rewritten; preparation and freeze
-- commit together. No N3 write or runtime contract is activated by this SQL.
BEGIN;
CREATE TABLE public.hotel_billing_preparations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,reservation_id uuid NOT NULL,folio_id uuid NOT NULL,
 revision bigint NOT NULL CHECK(revision>0),property_date date NOT NULL,
 source_versions jsonb NOT NULL CHECK(jsonb_typeof(source_versions)='array'),
 lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array'),
 total_cents bigint NOT NULL CHECK(total_cents BETWEEN 1 AND 1000000000),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 actor text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,reservation_id,revision),
 FOREIGN KEY(tenant_id,reservation_id) REFERENCES public.hotel_reservations(tenant_id,id),
 FOREIGN KEY(tenant_id,folio_id) REFERENCES public.hotel_folios(tenant_id,id)
);
ALTER TABLE public.hotel_billing_preparations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hotel_billing_preparations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.hotel_billing_preparations TO service_role;
CREATE TRIGGER hotel_billing_preparation_immutable BEFORE UPDATE OR DELETE ON public.hotel_billing_preparations FOR EACH ROW EXECUTE FUNCTION public.hotelhub_settlement_immutable();

CREATE FUNCTION public.hotelhub_billing_derived_id(p_tenant uuid,p_res uuid,p_folio uuid,p_kind text) RETURNS uuid
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE h text; BEGIN
 IF p_kind NOT IN ('service_charge','tourism_tax','local_levy') OR p_kind IS NULL THEN RAISE EXCEPTION 'settlement_preparation_invalid'; END IF;
 h:=encode(sha256(convert_to(p_tenant::text||'|'||p_res::text||'|'||p_folio::text||'|'||p_kind,'UTF8')),'hex');
 RETURN (substr(h,1,8)||'-'||substr(h,9,4)||'-5'||substr(h,14,3)||'-8'||substr(h,18,3)||'-'||substr(h,21,12))::uuid;
END $$;

CREATE FUNCTION public.hotelhub_billing_tax_bp(p_settings public.hotel_financial_settings,p_class text,p_kind text) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE bp integer; BEGIN
 IF NOT coalesce(p_settings.service_tax_registered,false) THEN RETURN 0; END IF;
 IF p_kind IN ('tourism_tax','local_levy') OR p_class IN ('non_taxable','damage_compensation') OR (p_kind='service_charge' AND NOT coalesce(p_settings.service_charge_service_tax_applies,false)) THEN RETURN 0; END IF;
 bp:=CASE p_class WHEN 'accommodation' THEN p_settings.service_tax_accommodation_rate_bp WHEN 'service_charge' THEN p_settings.service_tax_accommodation_rate_bp WHEN 'food_and_beverage' THEN p_settings.service_tax_fnb_rate_bp WHEN 'parking' THEN p_settings.service_tax_parking_rate_bp WHEN 'other_taxable_service' THEN p_settings.service_tax_other_rate_bp END;
 IF bp IS NULL OR bp NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'settlement_preparation_invalid'; END IF;
 RETURN bp;
END $$;

CREATE FUNCTION public.hotelhub_billing_component_amount(p_tenant uuid,p_res uuid,p_folio uuid,p_date date,p_kind text) RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg public.hotel_financial_settings; base bigint; nights bigint; classification text; credits bigint; BEGIN
 SELECT * INTO cfg FROM public.hotel_financial_settings WHERE tenant_id=p_tenant;
 IF p_kind='service_charge' THEN
  IF NOT coalesce(cfg.service_charge_enabled,false) THEN RETURN 0; END IF;
  IF cfg.service_charge_percent_bp IS NULL OR cfg.service_charge_percent_bp NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'settlement_preparation_invalid'; END IF;
  SELECT coalesce(sum(subtotal_cents),0) INTO base FROM public.hh_source_billing_active_lines(p_tenant,p_folio) WHERE tax_class::text IN ('accommodation','food_and_beverage','parking','other_taxable_service');
  RETURN round(greatest(base,0)::numeric*cfg.service_charge_percent_bp/10000)::bigint;
 END IF;
 SELECT count(*) INTO nights FROM public.hh_source_billing_active_lines(p_tenant,p_folio) WHERE line_type='room_night';
 IF p_kind='local_levy' THEN
  IF NOT coalesce(cfg.local_levy_enabled,false) OR (cfg.local_levy_effective_from IS NOT NULL AND p_date<cfg.local_levy_effective_from) OR (cfg.local_levy_effective_to IS NOT NULL AND p_date>cfg.local_levy_effective_to) THEN RETURN 0; END IF;
  IF cfg.local_levy_cents_per_room_night IS NULL OR cfg.local_levy_cents_per_room_night<=0 THEN RAISE EXCEPTION 'settlement_preparation_invalid'; END IF;
  RETURN nights*cfg.local_levy_cents_per_room_night;
 END IF;
 IF p_kind='tourism_tax' THEN
  IF NOT coalesce(cfg.tourism_tax_enabled,false) OR (cfg.tourism_tax_effective_from IS NOT NULL AND p_date<cfg.tourism_tax_effective_from) OR (cfg.tourism_tax_effective_to IS NOT NULL AND p_date>cfg.tourism_tax_effective_to) THEN RETURN 0; END IF;
  SELECT guest_tax_class::text INTO classification FROM public.hotel_reservation_tax_profile WHERE tenant_id=p_tenant AND reservation_id=p_res;
  IF classification IN ('malaysian_citizen','malaysian_pr','other_exemption') THEN RETURN 0; END IF;
  IF classification IS DISTINCT FROM 'foreign_tourist' OR cfg.tourism_tax_cents_per_room_night IS NULL OR cfg.tourism_tax_cents_per_room_night<=0 THEN RAISE EXCEPTION 'settlement_preparation_invalid'; END IF;
  SELECT coalesce(sum(amount_cents),0) INTO credits FROM public.hotel_tourism_tax_evidence WHERE tenant_id=p_tenant AND reservation_id=p_res;
  RETURN greatest(nights*cfg.tourism_tax_cents_per_room_night-credits,0);
 END IF;
 RAISE EXCEPTION 'settlement_preparation_invalid';
END $$;

CREATE FUNCTION public.hotelhub_billing_preparation_save(p_tenant uuid,p_res uuid,p_actor text,p_folio uuid,p_date date,p_sources jsonb,p_lines jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg public.hotel_financial_settings; raw public.hotel_folio_lines; prep public.hotel_billing_preparations;
 tax_bases jsonb:='{}'; tax_totals jsonb:='{}';
 x jsonb; normal jsonb; canonical jsonb:='[]'; total bigint:=0; bp integer; expected bigint; raw_count integer; base_count integer:=0;
 seen uuid[]:=ARRAY[]::uuid[]; derived_seen text[]:=ARRAY[]::text[]; lid uuid; k text; cls text; captured_stock text; captured_unit text; captured_tax text; mapping jsonb; h text; rev bigint; tz text;
BEGIN
 PERFORM public.hotelhub_settlement_operator(p_tenant,p_actor);
 PERFORM 1 FROM public.hotel_reservations WHERE tenant_id=p_tenant AND id=p_res AND status='checked_in' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'settlement_invalid_state'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.hotel_folios WHERE tenant_id=p_tenant AND reservation_id=p_res AND id=p_folio AND status='prepared') THEN RAISE EXCEPTION 'settlement_scope_mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.hotel_settlement_intents WHERE tenant_id=p_tenant AND reservation_id=p_res AND state<>'abandoned') THEN RAISE EXCEPTION 'settlement_locked'; END IF;
 IF p_sources IS DISTINCT FROM public.hotelhub_settlement_sources(p_tenant,p_res) THEN RAISE EXCEPTION 'settlement_snapshot_changed'; END IF;
 SELECT timezone INTO tz FROM public.hotel_settings WHERE tenant_id=p_tenant;
 IF tz IS NULL OR p_date IS DISTINCT FROM (clock_timestamp() AT TIME ZONE tz)::date THEN RAISE EXCEPTION 'settlement_snapshot_changed'; END IF;
 IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 1000 OR octet_length(p_lines::text)>2000000 OR p_lines::text ~* '"(n3token|authorization|password|secret|rawjournal|access_token|refresh_token|cookie|session)"[[:space:]]*:' THEN RAISE EXCEPTION 'settlement_preparation_invalid'; END IF;
 SELECT * INTO cfg FROM public.hotel_financial_settings WHERE tenant_id=p_tenant;
 SELECT count(*) INTO raw_count FROM public.hh_source_billing_active_lines(p_tenant,p_folio);
 FOR x IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  normal:=x-'mappingEvidence';
  IF jsonb_typeof(x) IS DISTINCT FROM 'object' OR jsonb_typeof(x->'mappingEvidence') IS DISTINCT FROM 'object' OR normal-ARRAY['localLineId','kind','stockId','uomId','taxCodeId','qty','unitCents','subtotalCents','taxCents','totalCents','description']<>'{}'
   OR jsonb_typeof(x->'localLineId') IS DISTINCT FROM 'string' OR jsonb_typeof(x->'kind') IS DISTINCT FROM 'string' OR jsonb_typeof(x->'description') IS DISTINCT FROM 'string'
   OR EXISTS(SELECT 1 FROM unnest(ARRAY['stockId','uomId','taxCodeId','qty','unitCents','subtotalCents','taxCents','totalCents']) f WHERE jsonb_typeof(x->f) IS DISTINCT FROM 'number')
   OR coalesce(x->>'localLineId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
   OR coalesce(x->>'description','')='' OR public.hotelhub_utf16_length(x->>'description')>160
   OR coalesce(x->>'stockId','') !~ '^[1-9][0-9]{0,9}$' OR (x->>'stockId')::numeric>2147483647
   OR coalesce(x->>'uomId','') !~ '^[1-9][0-9]{0,9}$' OR (x->>'uomId')::numeric>2147483647
   OR coalesce(x->>'taxCodeId','') !~ '^[1-9][0-9]{0,9}$' OR (x->>'taxCodeId')::numeric>2147483647
   OR coalesce(x->>'qty','') !~ '^[1-9][0-9]{0,3}$' OR (x->>'qty')::numeric>9999
   OR EXISTS(SELECT 1 FROM unnest(ARRAY['unitCents','subtotalCents','taxCents','totalCents']) f WHERE coalesce(x->>f,'') !~ '^(0|[1-9][0-9]{0,9})$' OR (x->>f)::numeric>1000000000)
   OR (x->>'unitCents')::numeric*(x->>'qty')::numeric IS DISTINCT FROM (x->>'subtotalCents')::numeric
   OR (x->>'subtotalCents')::numeric+(x->>'taxCents')::numeric IS DISTINCT FROM (x->>'totalCents')::numeric
  THEN RAISE EXCEPTION 'settlement_preparation_invalid'; END IF;
  lid:=(x->>'localLineId')::uuid;k:=x->>'kind';
  IF lid=ANY(seen) THEN RAISE EXCEPTION 'settlement_preparation_invalid'; END IF; seen:=array_append(seen,lid);
  SELECT * INTO raw FROM public.hh_source_billing_active_lines(p_tenant,p_folio) WHERE id=lid;
  IF FOUND THEN
   base_count:=base_count+1;
   IF raw.line_type::text IS DISTINCT FROM k OR raw.quantity::text IS DISTINCT FROM x->>'qty' OR raw.unit_price_cents::text IS DISTINCT FROM x->>'unitCents' OR raw.subtotal_cents::text IS DISTINCT FROM x->>'subtotalCents' OR raw.description_snapshot IS DISTINCT FROM x->>'description' THEN RAISE EXCEPTION 'settlement_preparation_invalid'; END IF;
   captured_stock:=coalesce(raw.n3_stock_id_snapshot,raw.tax_snapshot->>'n3StockId');
   captured_unit:=coalesce(raw.n3_uom_id_snapshot,raw.tax_snapshot->>'n3UomId');
   captured_tax:=coalesce(raw.n3_tax_code_id_snapshot,raw.tax_snapshot->>'n3TaxCodeId');
   IF captured_stock IS DISTINCT FROM x->>'stockId' OR (captured_unit IS NULL AND k<>'room_night') OR (captured_unit IS NOT NULL AND captured_unit IS DISTINCT FROM x->>'uomId')
    OR (raw.n3_stock_id_snapshot IS NOT NULL AND raw.tax_snapshot->>'n3StockId' IS NOT NULL AND raw.n3_stock_id_snapshot IS DISTINCT FROM raw.tax_snapshot->>'n3StockId')
    OR (raw.n3_uom_id_snapshot IS NOT NULL AND raw.tax_snapshot->>'n3UomId' IS NOT NULL AND raw.n3_uom_id_snapshot IS DISTINCT FROM raw.tax_snapshot->>'n3UomId')
   THEN RAISE EXCEPTION 'settlement_preparation_invalid'; END IF;
   cls:=coalesce(raw.tax_class::text,CASE WHEN k='room_night' THEN 'accommodation' ELSE raw.tax_snapshot->>'taxClass' END);
   bp:=public.hotelhub_billing_tax_bp(cfg,cls,k);
   IF coalesce(cfg.service_tax_registered,false) AND cls IN ('accommodation','food_and_beverage','parking','other_taxable_service','service_charge') THEN
    captured_tax:=CASE cls WHEN 'accommodation' THEN cfg.n3_tax_code_accommodation_id WHEN 'service_charge' THEN cfg.n3_tax_code_accommodation_id WHEN 'food_and_beverage' THEN cfg.n3_tax_code_fnb_id WHEN 'parking' THEN cfg.n3_tax_code_parking_id WHEN 'other_taxable_service' THEN cfg.n3_tax_code_other_id END;
   ELSE captured_tax:=cfg.n3_tax_code_exempt_id;
   END IF;
   IF captured_tax IS NULL OR captured_tax IS DISTINCT FROM x->>'taxCodeId' THEN RAISE EXCEPTION 'settlement_preparation_invalid'; END IF;
  ELSE
   IF k NOT IN ('service_charge','tourism_tax','local_levy') OR k IS NULL OR k=ANY(derived_seen) OR lid IS DISTINCT FROM public.hotelhub_billing_derived_id(p_tenant,p_res,p_folio,k) THEN RAISE EXCEPTION 'settlement_preparation_invalid'; END IF;
   derived_seen:=array_append(derived_seen,k);
   expected:=public.hotelhub_billing_component_amount(p_tenant,p_res,p_folio,p_date,k);
   mapping:=cfg.posting_mappings->k;
   IF expected<=0 OR expected IS DISTINCT FROM (x->>'subtotalCents')::bigint OR mapping->'enabled' IS DISTINCT FROM 'true'::jsonb OR mapping->'stock'->>'id' IS DISTINCT FROM x->>'stockId' OR mapping->'uom'->>'id' IS DISTINCT FROM x->>'uomId' OR mapping->'taxCode'->>'id' IS DISTINCT FROM x->>'taxCodeId' THEN RAISE EXCEPTION 'settlement_preparation_invalid'; END IF;
   cls:=CASE WHEN k='service_charge' THEN 'service_charge' ELSE 'non_taxable' END;
   bp:=public.hotelhub_billing_tax_bp(cfg,cls,k);
  END IF;
  IF cls IS NULL OR cls NOT IN ('accommodation','food_and_beverage','parking','other_taxable_service','service_charge','non_taxable','damage_compensation') THEN RAISE EXCEPTION 'settlement_preparation_invalid'; END IF;
  tax_bases:=jsonb_set(tax_bases,ARRAY[cls],to_jsonb(coalesce((tax_bases->>cls)::bigint,0)+(x->>'subtotalCents')::bigint));
  tax_totals:=jsonb_set(tax_totals,ARRAY[cls],to_jsonb(coalesce((tax_totals->>cls)::bigint,0)+(x->>'taxCents')::bigint));
  IF round((x->>'subtotalCents')::numeric*bp/10000)::bigint IS DISTINCT FROM (x->>'taxCents')::bigint THEN RAISE EXCEPTION 'settlement_preparation_invalid'; END IF;
  canonical:=canonical||jsonb_build_array(normal);total:=total+(x->>'totalCents')::bigint;
 END LOOP;
 FOR cls IN SELECT jsonb_object_keys(tax_bases) LOOP
  bp:=public.hotelhub_billing_tax_bp(cfg,cls,CASE WHEN cls='service_charge' THEN 'service_charge' ELSE 'add_on' END);
  IF round((tax_bases->>cls)::numeric*bp/10000)::bigint IS DISTINCT FROM (tax_totals->>cls)::bigint THEN RAISE EXCEPTION 'settlement_preparation_invalid'; END IF;
 END LOOP;
 IF base_count<>raw_count OR total NOT BETWEEN 1 AND 1000000000 THEN RAISE EXCEPTION 'settlement_preparation_invalid'; END IF;
 -- Nonzero document rounding has no accepted N3 contract yet. Even a freshly
 -- hashed snapshot must not bypass the calculator's configured payable total.
 IF cfg.rounding_mode IS NULL OR cfg.rounding_mode NOT IN ('none','nearest_5_cents','nearest_10_cents')
  OR (cfg.rounding_mode='nearest_5_cents' AND total%5<>0)
  OR (cfg.rounding_mode='nearest_10_cents' AND total%10<>0)
 THEN RAISE EXCEPTION 'settlement_preparation_invalid'; END IF;
 FOREACH k IN ARRAY ARRAY['service_charge','tourism_tax','local_levy'] LOOP
  IF public.hotelhub_billing_component_amount(p_tenant,p_res,p_folio,p_date,k)>0 AND NOT k=ANY(derived_seen) THEN RAISE EXCEPTION 'settlement_preparation_invalid'; END IF;
 END LOOP;
 SELECT jsonb_agg(value ORDER BY value->>'localLineId') INTO canonical FROM jsonb_array_elements(canonical);
 h:=encode(sha256(convert_to(public.hotelhub_settlement_payload_json(jsonb_build_object('sourceVersions',p_sources,'lines',canonical,'billDate',p_date,'totalCents',total)),'UTF8')),'hex');
 SELECT * INTO prep FROM public.hotel_billing_preparations WHERE tenant_id=p_tenant AND reservation_id=p_res ORDER BY revision DESC LIMIT 1;
 IF FOUND AND prep.digest=h THEN RETURN jsonb_build_object('lines',prep.lines,'totalCents',prep.total_cents); END IF;
 rev:=coalesce(prep.revision,0)+1;
 INSERT INTO public.hotel_billing_preparations(tenant_id,reservation_id,folio_id,revision,property_date,source_versions,lines,total_cents,digest,actor) VALUES(p_tenant,p_res,p_folio,rev,p_date,p_sources,canonical,total,h,p_actor) RETURNING * INTO prep;
 INSERT INTO public.hotel_audit_events(tenant_id,n3_user_key,event_type,detail) VALUES(p_tenant,p_actor,'hotel.billing.prepared',jsonb_build_object('preparationId',prep.id,'digest',h,'totalCents',total));
 RETURN jsonb_build_object('lines',canonical,'totalCents',total);
END $$;

-- Derived canonical IDs are deliberately not operational hotel_folio_lines IDs.
-- Every insert must instead belong to the current immutable preparation.
DO $$ DECLARE c record; n integer:=0; BEGIN
 FOR c IN SELECT conname FROM pg_catalog.pg_constraint WHERE conrelid='public.hotel_source_billing_line_membership'::regclass AND confrelid='public.hotel_folio_lines'::regclass AND contype='f' LOOP
  EXECUTE format('ALTER TABLE public.hotel_source_billing_line_membership DROP CONSTRAINT %I',c.conname);n:=n+1;
 END LOOP;
 IF n<>1 THEN RAISE EXCEPTION 'source_billing_membership_dependency_mismatch'; END IF;
END $$;
CREATE FUNCTION public.hotelhub_billing_membership_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.hotel_billing_preparations; BEGIN
 SELECT * INTO p FROM public.hotel_billing_preparations WHERE tenant_id=NEW.tenant_id AND reservation_id=NEW.reservation_id ORDER BY revision DESC LIMIT 1;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.lines) x WHERE x->>'localLineId'=NEW.line_id::text AND x=NEW.line_snapshot-'mappingEvidence') THEN RAISE EXCEPTION 'source_billing_charge_mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hotel_source_membership_prepared BEFORE INSERT ON public.hotel_source_billing_line_membership FOR EACH ROW EXECUTE FUNCTION public.hotelhub_billing_membership_guard();

CREATE OR REPLACE FUNCTION public.hotelhub_settlement_freeze(p_tenant_id uuid,p_reservation_id uuid,p_actor text,p_snapshot jsonb,p_client_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE i public.hotel_settlement_intents; r public.hotel_reservations; f public.hotel_folios; prep jsonb; BEGIN
 PERFORM public.hotelhub_settlement_operator(p_tenant_id,p_actor);
 SELECT * INTO r FROM public.hotel_reservations WHERE tenant_id=p_tenant_id AND id=p_reservation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
 SELECT * INTO i FROM public.hotel_settlement_intents WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id AND client_request_id=p_client_request_id;
 IF FOUND THEN IF i.digest IS DISTINCT FROM p_snapshot->>'digest' OR i.snapshot IS DISTINCT FROM p_snapshot THEN RAISE EXCEPTION 'settlement_conflicting_request'; END IF; IF i.state='abandoned' THEN RAISE EXCEPTION 'settlement_invalid_state'; END IF; RETURN public.hotelhub_settlement_read_intent(p_tenant_id,p_reservation_id,i.id); END IF;
 IF EXISTS(SELECT 1 FROM public.hotel_settlement_intents WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id AND state<>'abandoned') THEN RAISE EXCEPTION 'settlement_locked'; END IF;
 IF r.status<>'checked_in' THEN RAISE EXCEPTION 'settlement_invalid_state'; END IF;
 IF EXISTS(SELECT 1 FROM public.hotel_reservation_deposits WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id AND status IN ('submitting','unknown')) OR EXISTS(SELECT 1 FROM public.hotel_receipt_control_requests q WHERE q.tenant_id=p_tenant_id AND q.reservation_id=p_reservation_id AND (q.state NOT IN ('applied','rejected') OR EXISTS(SELECT 1 FROM public.hotel_receipt_control_executions e WHERE e.tenant_id=q.tenant_id AND e.request_id=q.id AND e.state='claimed'))) THEN RAISE EXCEPTION 'settlement_pending_financial_operation'; END IF;
 SELECT * INTO f FROM public.hotel_folios WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id;
 IF NOT FOUND OR f.status<>'prepared' THEN RAISE EXCEPTION 'settlement_invalid_state'; END IF;
 IF p_snapshot->>'tenantId' IS DISTINCT FROM p_tenant_id::text OR p_snapshot->>'reservationId' IS DISTINCT FROM p_reservation_id::text OR p_snapshot->>'folioId' IS DISTINCT FROM f.id::text THEN RAISE EXCEPTION 'settlement_scope_mismatch'; END IF;
 IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' OR jsonb_typeof(p_snapshot->'sourceVersions') IS DISTINCT FROM 'array' OR jsonb_typeof(p_snapshot->'receipts') IS DISTINCT FROM 'array' OR coalesce(p_snapshot->>'totalCents','') !~ '^[1-9][0-9]{0,9}$' THEN RAISE EXCEPTION 'settlement_snapshot_changed'; END IF;
 IF NOT public.hotelhub_settlement_receipts_owned(p_tenant_id,p_reservation_id,p_snapshot->'receipts') THEN RAISE EXCEPTION 'settlement_scope_mismatch'; END IF;
 IF p_snapshot->>'digest' IS DISTINCT FROM encode(sha256(convert_to(public.hotelhub_settlement_payload_json(p_snapshot-'digest'),'UTF8')),'hex') THEN RAISE EXCEPTION 'settlement_snapshot_changed'; END IF;
 prep:=public.hotelhub_billing_preparation_save(p_tenant_id,p_reservation_id,p_actor,f.id,(p_snapshot->>'billDate')::date,p_snapshot->'sourceVersions',p_snapshot->'lines');
 IF (p_snapshot->>'totalCents')::bigint IS DISTINCT FROM (prep->>'totalCents')::bigint THEN RAISE EXCEPTION 'settlement_preparation_invalid'; END IF;
 IF p_snapshot->'sourceVersions' IS DISTINCT FROM public.hotelhub_settlement_sources(p_tenant_id,p_reservation_id) OR p_snapshot->>'currency' IS DISTINCT FROM r.currency OR p_snapshot->>'digest' !~ '^[a-f0-9]{64}$' OR (p_snapshot->>'totalCents')::bigint NOT BETWEEN 1 AND 1000000000 THEN RAISE EXCEPTION 'settlement_snapshot_changed'; END IF;
 INSERT INTO public.hotel_settlement_intents(tenant_id,reservation_id,client_request_id,snapshot,digest,actor_n3_user_key) VALUES(p_tenant_id,p_reservation_id,p_client_request_id,p_snapshot,p_snapshot->>'digest',p_actor) RETURNING * INTO i;
 INSERT INTO public.hotel_settlement_events(tenant_id,reservation_id,intent_id,event,actor_n3_user_key) VALUES(p_tenant_id,p_reservation_id,i.id,'frozen',p_actor);
 RETURN public.hotelhub_settlement_read_intent(p_tenant_id,p_reservation_id,i.id);
END $f$;

CREATE OR REPLACE FUNCTION public.hh_source_billing_freeze(p_tenant_id uuid,p_reservation_id uuid,p_actor text,p_plan jsonb,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.hotel_reservations; f public.hotel_folios; p public.hotel_source_billing_plans;
 payer public.hotel_reservation_payers; leg jsonb; snap jsonb; line jsonb; all_lines jsonb:='[]'; guest_receipts jsonb:='[]';
 v_id uuid; v_kind text; number jsonb; sources jsonb; prep jsonb; expected_lines jsonb; guest_count integer:=0; source_count integer:=0;
 total bigint:=0; line_count integer:=0;
BEGIN
 PERFORM public.hotelhub_settlement_operator(p_tenant_id,p_actor);
 SELECT * INTO r FROM public.hotel_reservations WHERE tenant_id=p_tenant_id AND id=p_reservation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
 SELECT * INTO p FROM public.hotel_source_billing_plans WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id;
 IF FOUND THEN
  IF p.request_id IS DISTINCT FROM p_request_id OR p.plan IS DISTINCT FROM p_plan THEN RAISE EXCEPTION 'settlement_conflicting_request'; END IF;
  RETURN public.hh_source_billing_read(p_tenant_id,p_reservation_id,p_actor,public.hotelhub_settlement_operator(p_tenant_id,p_actor));
 END IF;
 IF EXISTS(SELECT 1 FROM public.hotel_settlement_intents WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id AND state<>'abandoned') THEN RAISE EXCEPTION 'settlement_locked'; END IF;
 IF r.status<>'checked_in' THEN RAISE EXCEPTION 'settlement_invalid_state'; END IF;
 SELECT * INTO f FROM public.hotel_folios WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id;
 IF NOT FOUND OR f.status<>'prepared' THEN RAISE EXCEPTION 'settlement_invalid_state'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_plan) IS DISTINCT FROM 'object' OR p_plan-ARRAY['version','scope','payer','legs','totalCents','digest']<>'{}'
  OR p_plan->'version' IS DISTINCT FROM '1'::jsonb OR p_plan->'scope' IS DISTINCT FROM jsonb_build_object('tenantId',p_tenant_id,'reservationId',p_reservation_id)
  OR jsonb_typeof(p_plan->'legs') IS DISTINCT FROM 'array' OR jsonb_array_length(p_plan->'legs') NOT BETWEEN 1 AND 2
  OR coalesce(p_plan->>'totalCents','') !~ '^[1-9][0-9]{0,9}$' OR (p_plan->>'totalCents')::numeric>1000000000
  OR p_plan::text ~* '"(n3token|authorization|password|secret|rawjournal|access_token|refresh_token|cookie|session)"[[:space:]]*:'
  OR p_plan->>'digest' IS DISTINCT FROM encode(sha256(convert_to(public.hotelhub_settlement_payload_json(p_plan-'digest'),'UTF8')),'hex')
 THEN RAISE EXCEPTION 'source_billing_invalid_plan'; END IF;
 SELECT * INTO payer FROM public.hotel_reservation_payers WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id;
 IF NOT FOUND OR p_plan->'payer' IS DISTINCT FROM public.hh_source_billing_payer_json(payer) THEN RAISE EXCEPTION 'source_billing_payer_changed'; END IF;
 IF EXISTS(SELECT 1 FROM public.hotel_reservation_deposits WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id AND status IN ('submitting','unknown'))
  OR EXISTS(SELECT 1 FROM public.hotel_receipt_control_requests q WHERE q.tenant_id=p_tenant_id AND q.reservation_id=p_reservation_id AND (q.state NOT IN ('applied','rejected') OR EXISTS(SELECT 1 FROM public.hotel_receipt_control_executions e WHERE e.tenant_id=q.tenant_id AND e.request_id=q.id AND e.state='claimed')))
 THEN RAISE EXCEPTION 'settlement_pending_financial_operation'; END IF;
 sources:=public.hotelhub_settlement_sources(p_tenant_id,p_reservation_id);

 FOR leg IN SELECT value FROM jsonb_array_elements(p_plan->'legs') LOOP
  snap:=leg->'snapshot';v_kind:=leg->>'kind';
  IF jsonb_typeof(leg) IS DISTINCT FROM 'object' OR leg-ARRAY['legId','kind','customerId','collectionMode','documentTitle','itemDescription','showPrices','snapshot']<>'{}'
   OR coalesce(leg->>'legId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
   OR v_kind NOT IN ('source_room','guest') OR v_kind IS NULL OR jsonb_typeof(snap) IS DISTINCT FROM 'object'
   OR snap->>'tenantId' IS DISTINCT FROM p_tenant_id::text OR snap->>'reservationId' IS DISTINCT FROM p_reservation_id::text
   OR snap->>'folioId' IS DISTINCT FROM f.id::text OR snap->>'currency' IS DISTINCT FROM r.currency
   OR snap->>'billDate' IS DISTINCT FROM p_plan->'legs'->0->'snapshot'->>'billDate'
   OR snap->'customerId' IS DISTINCT FROM leg->'customerId' OR snap->'sourceVersions' IS DISTINCT FROM sources
   OR snap->>'digest' IS DISTINCT FROM encode(sha256(convert_to(public.hotelhub_settlement_payload_json(snap-'digest'),'UTF8')),'hex')
   OR jsonb_typeof(snap->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(snap->'lines')=0
   OR coalesce(snap->>'totalCents','') !~ '^[1-9][0-9]{0,9}$' OR (snap->>'totalCents')::numeric>1000000000
   OR jsonb_typeof(snap->'receipts') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'source_billing_invalid_plan'; END IF;
  IF v_kind='source_room' THEN
   source_count:=source_count+1;
   IF payer.collection_mode<>'source' OR leg->'customerId' IS DISTINCT FROM payer.policy_snapshot->'sourceCustomerId' OR leg->>'collectionMode' IS DISTINCT FROM 'source'
    OR leg->'documentTitle' IS DISTINCT FROM payer.policy_snapshot->'guestDocumentTitle' OR leg->'itemDescription' IS DISTINCT FROM payer.policy_snapshot->'guestItemDescription'
    OR leg->'showPrices' IS DISTINCT FROM payer.policy_snapshot->'showRoomPrices' OR snap->'receipts'<>'[]'
   THEN RAISE EXCEPTION 'settlement_scope_mismatch'; END IF;
  ELSE
   guest_count:=guest_count+1;guest_receipts:=snap->'receipts';
   IF leg->'customerId' IS DISTINCT FROM payer.policy_snapshot->'guestCustomerId' OR leg->>'collectionMode' IS DISTINCT FROM 'guest'
    OR leg->>'documentTitle' IS DISTINCT FROM 'Sales Invoice' OR leg->>'itemDescription' IS DISTINCT FROM '' OR leg->'showPrices' IS DISTINCT FROM 'true'::jsonb
   THEN RAISE EXCEPTION 'settlement_scope_mismatch'; END IF;
  END IF;
  IF (snap->>'totalCents')::bigint IS DISTINCT FROM (SELECT sum((x->>'totalCents')::bigint) FROM jsonb_array_elements(snap->'lines') x) THEN RAISE EXCEPTION 'source_billing_charge_mismatch'; END IF;
  total:=total+(snap->>'totalCents')::bigint;all_lines:=all_lines||(snap->'lines');
 END LOOP;
 prep:=public.hotelhub_billing_preparation_save(p_tenant_id,p_reservation_id,p_actor,f.id,((p_plan->'legs'->0)->'snapshot'->>'billDate')::date,sources,all_lines);expected_lines:=prep->'lines';
 IF guest_count>1 OR source_count>1 OR (payer.collection_mode='guest' AND (guest_count<>1 OR source_count<>0))
  OR (payer.collection_mode='source' AND source_count<>1) OR total IS DISTINCT FROM (p_plan->>'totalCents')::bigint
  OR total IS DISTINCT FROM (prep->>'totalCents')::bigint
 THEN RAISE EXCEPTION 'source_billing_charge_mismatch'; END IF;
 IF NOT public.hotelhub_settlement_receipts_owned(p_tenant_id,p_reservation_id,guest_receipts)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(guest_receipts) x WHERE x->'customerId' IS DISTINCT FROM payer.policy_snapshot->'guestCustomerId' OR x->>'currency' IS DISTINCT FROM r.currency)
 THEN RAISE EXCEPTION 'settlement_scope_mismatch'; END IF;
 line_count:=jsonb_array_length(all_lines);
 IF line_count IS DISTINCT FROM jsonb_array_length(expected_lines)
  OR line_count IS DISTINCT FROM (SELECT count(DISTINCT x->>'localLineId') FROM jsonb_array_elements(all_lines) x)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(all_lines) x WHERE NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(expected_lines) e WHERE e=x-'mappingEvidence'))
 THEN RAISE EXCEPTION 'source_billing_charge_mismatch'; END IF;
 INSERT INTO public.hotel_source_billing_plans(tenant_id,reservation_id,digest,request_id,payer_revision,plan,actor)
 VALUES(p_tenant_id,p_reservation_id,p_plan->>'digest',p_request_id,payer.revision,p_plan,p_actor);
 FOR leg IN SELECT value FROM jsonb_array_elements(p_plan->'legs') LOOP
  snap:=leg->'snapshot';v_id:=(leg->>'legId')::uuid;
  number:=public.hh_source_document_number_reserve(p_tenant_id,p_reservation_id,p_actor,'bill',v_id,(snap->>'billDate')::date);
  INSERT INTO public.hotel_settlement_intents(id,tenant_id,reservation_id,client_request_id,source_leg_id,source_plan_digest,source_leg_kind,snapshot,digest,actor_n3_user_key)
  VALUES(v_id,p_tenant_id,p_reservation_id,v_id,v_id,p_plan->>'digest',leg->>'kind',snap,snap->>'digest',p_actor);
  INSERT INTO public.hotel_source_billing_legs(tenant_id,reservation_id,leg_id,plan_digest,kind,customer_id,snapshot,hh_number)
  VALUES(p_tenant_id,p_reservation_id,v_id,p_plan->>'digest',leg->>'kind',(leg->>'customerId')::integer,snap,number->>'hhNumber');
  INSERT INTO public.hotel_source_billing_line_membership(tenant_id,reservation_id,line_id,leg_id,line_snapshot)
  SELECT p_tenant_id,p_reservation_id,(x->>'localLineId')::uuid,v_id,x FROM jsonb_array_elements(snap->'lines') x;
  INSERT INTO public.hotel_settlement_events(tenant_id,reservation_id,intent_id,event,actor_n3_user_key,detail)
  VALUES(p_tenant_id,p_reservation_id,v_id,'frozen',p_actor,jsonb_build_object('legId',v_id,'planDigest',p_plan->>'digest','hhNumber',number->>'hhNumber'));
 END LOOP;
 RETURN public.hh_source_billing_read(p_tenant_id,p_reservation_id,p_actor,public.hotelhub_settlement_operator(p_tenant_id,p_actor));
END $$;

REVOKE ALL ON FUNCTION public.hotelhub_billing_derived_id(uuid,uuid,uuid,text),public.hotelhub_billing_tax_bp(public.hotel_financial_settings,text,text),public.hotelhub_billing_component_amount(uuid,uuid,uuid,date,text),public.hotelhub_billing_preparation_save(uuid,uuid,text,uuid,date,jsonb,jsonb),public.hotelhub_billing_membership_guard() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.hotelhub_settlement_freeze(uuid,uuid,text,jsonb,uuid),public.hh_source_billing_freeze(uuid,uuid,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hotelhub_settlement_freeze(uuid,uuid,text,jsonb,uuid),public.hh_source_billing_freeze(uuid,uuid,text,jsonb,uuid) TO service_role;
COMMIT;
