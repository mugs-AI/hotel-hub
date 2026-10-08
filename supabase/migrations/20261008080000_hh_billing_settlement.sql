-- Candidate: additive settlement ledger. NOT applied to Lovable Cloud.
-- Requires observed live schema; excludes unapplied automatic receipt-control SQL.
CREATE TABLE public.hotel_settlement_intents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,reservation_id uuid NOT NULL,
 client_request_id uuid NOT NULL,snapshot jsonb NOT NULL,digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),state text NOT NULL DEFAULT 'frozen' CHECK(state IN ('frozen','bill_dispatched','bill_verified','allocating','awaiting_payment','balance_dispatched','settled','closing','closed','needs_review','abandoned')),
 actor_n3_user_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,reservation_id,id),UNIQUE(tenant_id,reservation_id,client_request_id),
 FOREIGN KEY(tenant_id,reservation_id) REFERENCES public.hotel_reservations(tenant_id,id),
 CHECK(snapshot->>'tenantId'=tenant_id::text AND snapshot->>'reservationId'=reservation_id::text AND snapshot->>'digest'=digest)
);
CREATE UNIQUE INDEX hotel_settlement_active ON public.hotel_settlement_intents(tenant_id,reservation_id) WHERE state<>'abandoned';
CREATE TABLE public.hotel_settlement_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,reservation_id uuid NOT NULL,intent_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('bill','deposit_allocation','balance_receipt','balance_allocation')),receipt_id uuid,
 claimed_revision bigint NOT NULL,payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 actor_n3_user_key text NOT NULL,outcome jsonb,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,reservation_id,intent_id) REFERENCES public.hotel_settlement_intents(tenant_id,reservation_id,id),
 CHECK((kind IN ('bill','balance_receipt') AND receipt_id IS NULL) OR (kind IN ('deposit_allocation','balance_allocation') AND receipt_id IS NOT NULL))
);
CREATE UNIQUE INDEX hotel_settlement_one_dispatch ON public.hotel_settlement_attempts(intent_id,kind,coalesce(receipt_id,'00000000-0000-0000-0000-000000000000'::uuid));
CREATE TABLE public.hotel_settlement_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,reservation_id uuid NOT NULL,intent_id uuid NOT NULL,
 proof_digest text NOT NULL CHECK(proof_digest ~ '^[a-f0-9]{64}$'),proof jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,reservation_id,intent_id,proof_digest),
 FOREIGN KEY(tenant_id,reservation_id,intent_id) REFERENCES public.hotel_settlement_intents(tenant_id,reservation_id,id)
);
CREATE TABLE public.hotel_settlement_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,reservation_id uuid NOT NULL,intent_id uuid NOT NULL,
 event text NOT NULL,actor_n3_user_key text NOT NULL,detail jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,reservation_id,intent_id) REFERENCES public.hotel_settlement_intents(tenant_id,reservation_id,id)
);
ALTER TABLE public.hotel_settlement_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_settlement_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_settlement_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_settlement_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hotel_settlement_intents,public.hotel_settlement_attempts,public.hotel_settlement_evidence,public.hotel_settlement_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.hotel_settlement_intents,public.hotel_settlement_attempts,public.hotel_settlement_evidence,public.hotel_settlement_events TO service_role;
CREATE FUNCTION public.hotelhub_settlement_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $f$ BEGIN RAISE EXCEPTION 'settlement_immutable'; END $f$;
CREATE TRIGGER settlement_events_immutable BEFORE UPDATE OR DELETE ON public.hotel_settlement_events FOR EACH ROW EXECUTE FUNCTION public.hotelhub_settlement_immutable();
CREATE TRIGGER settlement_evidence_immutable BEFORE UPDATE OR DELETE ON public.hotel_settlement_evidence FOR EACH ROW EXECUTE FUNCTION public.hotelhub_settlement_immutable();
CREATE FUNCTION public.hotelhub_settlement_intent_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $f$
BEGIN IF TG_OP='DELETE' OR NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.reservation_id IS DISTINCT FROM OLD.reservation_id OR NEW.client_request_id IS DISTINCT FROM OLD.client_request_id OR NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.digest IS DISTINCT FROM OLD.digest OR NEW.actor_n3_user_key IS DISTINCT FROM OLD.actor_n3_user_key OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'settlement_immutable'; END IF; RETURN NEW; END $f$;
CREATE TRIGGER settlement_intent_immutable BEFORE UPDATE OR DELETE ON public.hotel_settlement_intents FOR EACH ROW EXECUTE FUNCTION public.hotelhub_settlement_intent_guard();
CREATE FUNCTION public.hotelhub_settlement_attempt_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $f$
BEGIN IF TG_OP='DELETE' OR (to_jsonb(NEW)-'outcome') IS DISTINCT FROM (to_jsonb(OLD)-'outcome') OR OLD.outcome IS NOT NULL THEN RAISE EXCEPTION 'settlement_immutable'; END IF; RETURN NEW; END $f$;
CREATE TRIGGER settlement_attempt_immutable BEFORE UPDATE OR DELETE ON public.hotel_settlement_attempts FOR EACH ROW EXECUTE FUNCTION public.hotelhub_settlement_attempt_guard();
CREATE FUNCTION public.hotelhub_settlement_owner(p_tenant_id uuid,p_actor text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN IF NOT EXISTS(SELECT 1 FROM public.hotel_user_roles WHERE tenant_id=p_tenant_id AND n3_user_key=p_actor AND role='owner' AND is_active) THEN RAISE EXCEPTION 'settlement_forbidden'; END IF; END $f$;
CREATE FUNCTION public.hotelhub_settlement_sources(p_tenant_id uuid,p_reservation_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $f$
SELECT coalesce(jsonb_agg(jsonb_build_object('table',tab,'id',id,'version',ver) ORDER BY tab,id),'[]'::jsonb) FROM (
SELECT 'hotel_reservations'::text AS tab, r.id AS id, md5(to_jsonb(r)::text) AS ver FROM public.hotel_reservations r WHERE r.tenant_id=p_tenant_id AND r.id=p_reservation_id
UNION ALL
SELECT 'hotel_reservation_rooms'::text AS tab, r.id AS id, md5(to_jsonb(r)::text) AS ver FROM public.hotel_reservation_rooms r WHERE r.tenant_id=p_tenant_id AND r.reservation_id=p_reservation_id
UNION ALL
SELECT 'hotel_reservation_guests'::text AS tab, r.id AS id, md5(to_jsonb(r)::text) AS ver FROM public.hotel_reservation_guests r WHERE r.tenant_id=p_tenant_id AND r.reservation_id=p_reservation_id
UNION ALL
SELECT 'hotel_folios'::text AS tab, r.id AS id, md5(to_jsonb(r)::text) AS ver FROM public.hotel_folios r WHERE r.tenant_id=p_tenant_id AND r.reservation_id=p_reservation_id
UNION ALL
SELECT 'hotel_reservation_tax_profile'::text AS tab, r.reservation_id AS id, md5(to_jsonb(r)::text) AS ver FROM public.hotel_reservation_tax_profile r WHERE r.tenant_id=p_tenant_id AND r.reservation_id=p_reservation_id
UNION ALL
SELECT 'hotel_tourism_tax_evidence'::text AS tab, r.id AS id, md5(to_jsonb(r)::text) AS ver FROM public.hotel_tourism_tax_evidence r WHERE r.tenant_id=p_tenant_id AND r.reservation_id=p_reservation_id
UNION ALL
SELECT 'hotel_reservation_deposits'::text AS tab, r.id AS id, md5(to_jsonb(r)::text) AS ver FROM public.hotel_reservation_deposits r WHERE r.tenant_id=p_tenant_id AND r.reservation_id=p_reservation_id
UNION ALL
SELECT 'hotel_folio_bill_to'::text AS tab, r.reservation_id AS id, md5(to_jsonb(r)::text) AS ver FROM public.hotel_folio_bill_to r WHERE r.tenant_id=p_tenant_id AND r.reservation_id=p_reservation_id
UNION ALL
SELECT 'hotel_folio_lines',r.id,md5(to_jsonb(r)::text) FROM public.hotel_folio_lines r JOIN public.hotel_folios f ON f.tenant_id=r.tenant_id AND f.id=r.folio_id WHERE r.tenant_id=p_tenant_id AND f.reservation_id=p_reservation_id
UNION ALL
SELECT 'hotel_guests',r.id,md5(to_jsonb(r)::text) FROM public.hotel_guests r WHERE r.tenant_id=p_tenant_id AND EXISTS(SELECT 1 FROM public.hotel_reservation_guests g WHERE g.tenant_id=r.tenant_id AND g.guest_id=r.id AND g.reservation_id=p_reservation_id)
UNION ALL
SELECT 'hotel_receipt_versions',r.id,md5(to_jsonb(r)::text) FROM public.hotel_receipt_versions r JOIN public.hotel_reservation_deposits d ON d.tenant_id=r.tenant_id AND d.id=r.deposit_id WHERE r.tenant_id=p_tenant_id AND d.reservation_id=p_reservation_id
UNION ALL
SELECT 'hotel_settings',r.tenant_id,md5(to_jsonb(r)::text) FROM public.hotel_settings r WHERE r.tenant_id=p_tenant_id
UNION ALL
SELECT 'hotel_financial_settings',r.tenant_id,md5(to_jsonb(r)::text) FROM public.hotel_financial_settings r WHERE r.tenant_id=p_tenant_id
) s; $f$;

CREATE FUNCTION public.hotelhub_settlement_guard(p_tenant_id uuid,p_reservation_id uuid,p_wait boolean DEFAULT true) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF p_reservation_id IS NULL THEN RETURN; END IF;
 IF p_wait THEN PERFORM 1 FROM public.hotel_reservations WHERE tenant_id=p_tenant_id AND id=p_reservation_id FOR UPDATE;
 ELSE BEGIN PERFORM 1 FROM public.hotel_reservations WHERE tenant_id=p_tenant_id AND id=p_reservation_id FOR UPDATE NOWAIT; EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'settlement_busy'; END; END IF;
 IF EXISTS(SELECT 1 FROM public.hotel_settlement_intents WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id AND state<>'abandoned') THEN RAISE EXCEPTION 'settlement_locked'; END IF;
END $f$;
CREATE FUNCTION public.hotelhub_settlement_read(p_tenant_id uuid,p_reservation_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $f$
SELECT jsonb_build_object('id',i.id,'tenantId',i.tenant_id,'reservationId',i.reservation_id,'revision',i.revision::text,'state',i.state,'snapshot',i.snapshot,'dispatches',coalesce((SELECT jsonb_agg(jsonb_build_object('claim',jsonb_strip_nulls(jsonb_build_object('attemptId',a.id,'intentId',a.intent_id,'kind',a.kind,'receiptId',a.receipt_id,'expectedRevision',a.claimed_revision::text,'payloadDigest',a.payload_digest)),'outcome',a.outcome) ORDER BY a.created_at,a.id) FROM public.hotel_settlement_attempts a WHERE a.tenant_id=i.tenant_id AND a.reservation_id=i.reservation_id AND a.intent_id=i.id),'[]'::jsonb)) FROM public.hotel_settlement_intents i WHERE i.tenant_id=p_tenant_id AND i.reservation_id=p_reservation_id AND i.state<>'abandoned'; $f$;
CREATE FUNCTION public.hotelhub_settlement_freeze(p_tenant_id uuid,p_reservation_id uuid,p_actor text,p_snapshot jsonb,p_client_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE i public.hotel_settlement_intents; r public.hotel_reservations; f public.hotel_folios; BEGIN
 PERFORM public.hotelhub_settlement_owner(p_tenant_id,p_actor);
 SELECT * INTO r FROM public.hotel_reservations WHERE tenant_id=p_tenant_id AND id=p_reservation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
 SELECT * INTO i FROM public.hotel_settlement_intents WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id AND client_request_id=p_client_request_id;
 IF FOUND THEN IF i.digest IS DISTINCT FROM p_snapshot->>'digest' OR i.snapshot IS DISTINCT FROM p_snapshot THEN RAISE EXCEPTION 'settlement_conflicting_request'; END IF; IF i.state='abandoned' THEN RAISE EXCEPTION 'settlement_invalid_state'; END IF; RETURN public.hotelhub_settlement_read(p_tenant_id,p_reservation_id); END IF;
 IF EXISTS(SELECT 1 FROM public.hotel_settlement_intents WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id AND state<>'abandoned') THEN RAISE EXCEPTION 'settlement_locked'; END IF;
 IF r.status<>'checked_in' THEN RAISE EXCEPTION 'settlement_invalid_state'; END IF;
 IF EXISTS(SELECT 1 FROM public.hotel_reservation_deposits WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id AND status IN ('submitting','unknown')) OR EXISTS(SELECT 1 FROM public.hotel_receipt_control_requests q WHERE q.tenant_id=p_tenant_id AND q.reservation_id=p_reservation_id AND (q.state NOT IN ('applied','rejected') OR EXISTS(SELECT 1 FROM public.hotel_receipt_control_executions e WHERE e.tenant_id=q.tenant_id AND e.request_id=q.id AND e.state='claimed'))) THEN RAISE EXCEPTION 'settlement_pending_financial_operation'; END IF;
 SELECT * INTO f FROM public.hotel_folios WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id;
 IF NOT FOUND OR f.status<>'prepared' THEN RAISE EXCEPTION 'settlement_invalid_state'; END IF;
 IF p_snapshot->>'tenantId' IS DISTINCT FROM p_tenant_id::text OR p_snapshot->>'reservationId' IS DISTINCT FROM p_reservation_id::text OR p_snapshot->>'folioId' IS DISTINCT FROM f.id::text THEN RAISE EXCEPTION 'settlement_scope_mismatch'; END IF;
 IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' OR jsonb_typeof(p_snapshot->'sourceVersions') IS DISTINCT FROM 'array' OR jsonb_typeof(p_snapshot->'receipts') IS DISTINCT FROM 'array' OR coalesce(p_snapshot->>'totalCents','') !~ '^[1-9][0-9]{0,9}$' THEN RAISE EXCEPTION 'settlement_snapshot_changed'; END IF;
 IF (p_snapshot->>'totalCents')::bigint IS DISTINCT FROM (SELECT sum(total_cents) FROM public.hotel_folio_lines WHERE tenant_id=p_tenant_id AND folio_id=f.id) THEN RAISE EXCEPTION 'settlement_snapshot_changed'; END IF;
 IF p_snapshot->'sourceVersions' IS DISTINCT FROM public.hotelhub_settlement_sources(p_tenant_id,p_reservation_id) OR p_snapshot->>'currency' IS DISTINCT FROM r.currency OR p_snapshot->>'digest' !~ '^[a-f0-9]{64}$' OR (p_snapshot->>'totalCents')::bigint NOT BETWEEN 1 AND 1000000000 THEN RAISE EXCEPTION 'settlement_snapshot_changed'; END IF;
 INSERT INTO public.hotel_settlement_intents(tenant_id,reservation_id,client_request_id,snapshot,digest,actor_n3_user_key) VALUES(p_tenant_id,p_reservation_id,p_client_request_id,p_snapshot,p_snapshot->>'digest',p_actor) RETURNING * INTO i;
 INSERT INTO public.hotel_settlement_events(tenant_id,reservation_id,intent_id,event,actor_n3_user_key) VALUES(p_tenant_id,p_reservation_id,i.id,'frozen',p_actor);
 RETURN public.hotelhub_settlement_read(p_tenant_id,p_reservation_id);
END $f$;
CREATE FUNCTION public.hotelhub_settlement_claim(p_tenant_id uuid,p_reservation_id uuid,p_actor text,p_intent_id uuid,p_revision text,p_step text,p_receipt_id uuid,p_payload_digest text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE i public.hotel_settlement_intents; a public.hotel_settlement_attempts; BEGIN
 PERFORM public.hotelhub_settlement_owner(p_tenant_id,p_actor);
 PERFORM 1 FROM public.hotel_reservations WHERE tenant_id=p_tenant_id AND id=p_reservation_id FOR UPDATE;
 SELECT * INTO i FROM public.hotel_settlement_intents WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id AND id=p_intent_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
 IF EXISTS(SELECT 1 FROM public.hotel_settlement_attempts WHERE intent_id=p_intent_id AND kind=p_step AND receipt_id IS NOT DISTINCT FROM p_receipt_id) THEN RETURN NULL; END IF;
 IF i.revision::text<>p_revision THEN RAISE EXCEPTION 'settlement_stale_revision'; END IF;
 IF i.state IN ('needs_review','closed','closing','abandoned') THEN RAISE EXCEPTION 'settlement_invalid_state'; END IF;
 IF (p_step='bill' AND i.state<>'frozen') OR (p_step IN ('deposit_allocation','balance_receipt') AND i.state NOT IN ('bill_verified','awaiting_payment','allocating')) OR (p_step='balance_allocation' AND i.state<>'balance_dispatched') THEN RAISE EXCEPTION 'settlement_invalid_state'; END IF;
 IF p_step='deposit_allocation' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(i.snapshot->'receipts') r WHERE r->>'receiptId'=p_receipt_id::text AND r->>'reservationId'=p_reservation_id::text) THEN RAISE EXCEPTION 'settlement_scope_mismatch'; END IF;
 IF (i.snapshot->'sourceVersions') IS DISTINCT FROM public.hotelhub_settlement_sources(p_tenant_id,p_reservation_id) THEN RAISE EXCEPTION 'settlement_snapshot_changed'; END IF;
 UPDATE public.hotel_settlement_intents SET revision=revision+1,state=CASE p_step WHEN 'bill' THEN 'bill_dispatched' WHEN 'balance_receipt' THEN 'balance_dispatched' ELSE 'allocating' END WHERE id=i.id RETURNING * INTO i;
 INSERT INTO public.hotel_settlement_attempts(tenant_id,reservation_id,intent_id,kind,receipt_id,claimed_revision,payload_digest,actor_n3_user_key) VALUES(p_tenant_id,p_reservation_id,i.id,p_step,p_receipt_id,i.revision,p_payload_digest,p_actor) RETURNING * INTO a;
 INSERT INTO public.hotel_settlement_events(tenant_id,reservation_id,intent_id,event,actor_n3_user_key,detail) VALUES(p_tenant_id,p_reservation_id,i.id,'dispatch_claimed',p_actor,jsonb_build_object('attemptId',a.id,'kind',p_step));
 RETURN jsonb_strip_nulls(jsonb_build_object('attemptId',a.id,'intentId',i.id,'kind',a.kind,'receiptId',a.receipt_id,'expectedRevision',i.revision::text,'payloadDigest',a.payload_digest));
END $f$;
CREATE FUNCTION public.hotelhub_settlement_outcome(p_tenant_id uuid,p_reservation_id uuid,p_actor text,p_intent_id uuid,p_revision text,p_attempt_id uuid,p_payload_digest text,p_outcome jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE i public.hotel_settlement_intents; a public.hotel_settlement_attempts; BEGIN
 PERFORM public.hotelhub_settlement_owner(p_tenant_id,p_actor);
 PERFORM 1 FROM public.hotel_reservations WHERE tenant_id=p_tenant_id AND id=p_reservation_id FOR UPDATE;
 SELECT * INTO i FROM public.hotel_settlement_intents WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id AND id=p_intent_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
 IF i.revision::text<>p_revision THEN RAISE EXCEPTION 'settlement_stale_revision'; END IF;
 SELECT * INTO a FROM public.hotel_settlement_attempts WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id AND intent_id=i.id AND id=p_attempt_id;
 IF NOT FOUND OR a.claimed_revision::text<>p_revision OR a.payload_digest<>p_payload_digest OR a.outcome IS NOT NULL THEN RAISE EXCEPTION 'settlement_stale_revision'; END IF;
 IF p_outcome->>'kind' NOT IN ('confirmed','rejected','unknown') OR p_outcome->>'code' !~ '^[a-z0-9_]{1,100}$' THEN RAISE EXCEPTION 'settlement_invalid_state'; END IF;
 UPDATE public.hotel_settlement_attempts SET outcome=p_outcome WHERE id=a.id;
 UPDATE public.hotel_settlement_intents SET revision=revision+1,state=CASE WHEN p_outcome->>'kind'='confirmed' THEN state ELSE 'needs_review' END WHERE id=i.id;
 INSERT INTO public.hotel_settlement_events(tenant_id,reservation_id,intent_id,event,actor_n3_user_key,detail) VALUES(p_tenant_id,p_reservation_id,i.id,'dispatch_outcome',p_actor,jsonb_build_object('attemptId',a.id,'kind',p_outcome->>'kind','code',p_outcome->>'code'));
 RETURN public.hotelhub_settlement_read(p_tenant_id,p_reservation_id);
END $f$;
-- Proof recording deliberately fails closed until Task5/7 adds the typed proof contract.
CREATE FUNCTION public.hotelhub_settlement_prove(p_tenant_id uuid,p_reservation_id uuid,p_actor text,p_intent_id uuid,p_revision text,p_proof jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$ BEGIN RAISE EXCEPTION 'settlement_untrusted_proof'; END $f$;
CREATE FUNCTION public.hotelhub_settlement_abandon(p_tenant_id uuid,p_reservation_id uuid,p_actor text,p_intent_id uuid,p_revision text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE i public.hotel_settlement_intents; BEGIN
 PERFORM public.hotelhub_settlement_owner(p_tenant_id,p_actor);
 PERFORM 1 FROM public.hotel_reservations WHERE tenant_id=p_tenant_id AND id=p_reservation_id FOR UPDATE;
 SELECT * INTO i FROM public.hotel_settlement_intents WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id AND id=p_intent_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
 IF i.revision::text<>p_revision THEN RAISE EXCEPTION 'settlement_stale_revision'; END IF;
 IF EXISTS(SELECT 1 FROM public.hotel_settlement_attempts WHERE intent_id=i.id) THEN RAISE EXCEPTION 'settlement_dispatched'; END IF;
 IF i.state<>'frozen' THEN RAISE EXCEPTION 'settlement_invalid_state'; END IF;
 UPDATE public.hotel_settlement_intents SET state='abandoned',revision=revision+1 WHERE id=i.id;
 INSERT INTO public.hotel_settlement_events(tenant_id,reservation_id,intent_id,event,actor_n3_user_key) VALUES(p_tenant_id,p_reservation_id,i.id,'abandoned',p_actor);
 RETURN jsonb_build_object('id',i.id,'tenantId',i.tenant_id,'reservationId',i.reservation_id,'revision',(i.revision+1)::text,'state','abandoned','snapshot',i.snapshot,'dispatches','[]'::jsonb);
END $f$;
CREATE FUNCTION public.hotelhub_settlement_row_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE n jsonb; o jsonb; rowdata jsonb; tenant uuid; parent uuid; rec record; BEGIN
 IF TG_OP<>'DELETE' THEN n:=to_jsonb(NEW); END IF;
 IF TG_OP<>'INSERT' THEN o:=to_jsonb(OLD); END IF;
 rowdata:=coalesce(n,o); tenant:=(rowdata->>'tenant_id')::uuid;
 IF TG_OP='UPDATE' AND (n->'tenant_id' IS DISTINCT FROM o->'tenant_id' OR n->'id' IS DISTINCT FROM o->'id' OR n->'reservation_id' IS DISTINCT FROM o->'reservation_id' OR n->'folio_id' IS DISTINCT FROM o->'folio_id' OR n->'deposit_id' IS DISTINCT FROM o->'deposit_id' OR n->'request_id' IS DISTINCT FROM o->'request_id' OR n->'guest_id' IS DISTINCT FROM o->'guest_id') THEN RAISE EXCEPTION 'settlement_scope_mismatch'; END IF;
 IF TG_TABLE_NAME='hotel_guests' THEN
  FOR rec IN SELECT DISTINCT reservation_id FROM public.hotel_reservation_guests WHERE tenant_id=tenant AND guest_id=(rowdata->>'id')::uuid ORDER BY reservation_id LOOP
   PERFORM public.hotelhub_settlement_guard(tenant,rec.reservation_id,false);
  END LOOP;
 ELSE
  IF TG_TABLE_NAME='hotel_reservations' THEN parent:=(rowdata->>'id')::uuid;
  ELSIF TG_TABLE_NAME='hotel_folio_lines' THEN SELECT reservation_id INTO parent FROM public.hotel_folios WHERE tenant_id=tenant AND id=(rowdata->>'folio_id')::uuid;
  ELSIF TG_TABLE_NAME='hotel_receipt_versions' THEN SELECT reservation_id INTO parent FROM public.hotel_reservation_deposits WHERE tenant_id=tenant AND id=(rowdata->>'deposit_id')::uuid;
  ELSIF TG_TABLE_NAME='hotel_receipt_control_executions' THEN SELECT reservation_id INTO parent FROM public.hotel_receipt_control_requests WHERE tenant_id=tenant AND id=(rowdata->>'request_id')::uuid;
  ELSE parent:=(rowdata->>'reservation_id')::uuid; END IF;
  -- Direct child UPDATE/DELETE already owns a row lock: NOWAIT prevents inversion
  -- against a parent-first freeze/close. INSERT can safely wait on the parent.
  PERFORM public.hotelhub_settlement_guard(tenant,parent,TG_OP='INSERT');
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $f$;
DO $f$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['hotel_reservations','hotel_reservation_rooms','hotel_reservation_guests','hotel_guests','hotel_folios','hotel_folio_lines','hotel_reservation_tax_profile','hotel_tourism_tax_evidence','hotel_reservation_deposits','hotel_receipt_control_requests','hotel_receipt_control_executions','hotel_receipt_versions','hotel_folio_bill_to'] LOOP EXECUTE format('CREATE TRIGGER aa_settlement_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.hotelhub_settlement_row_guard()',t); END LOOP; END $f$;

-- Forward replacement; existing observed body retained after parent guard.
CREATE OR REPLACE FUNCTION public.hotelhub_add_folio_line(p_tenant_id uuid, p_reservation_id uuid, p_operation text, p_line_type hotel_folio_line_type, p_catalogue_id uuid, p_tax_class hotel_tax_class, p_description text, p_quantity integer, p_unit_price_cents integer, p_subtotal_cents integer, p_tax_cents integer, p_total_cents integer, p_tax_snapshot jsonb, p_reason text, p_client_request_id uuid, p_actor_n3_user_key text, p_request_fingerprint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_folio_id uuid;
  v_claim jsonb;
  v_line public.hotel_folio_lines%rowtype;
begin
  PERFORM public.hotelhub_settlement_guard(p_tenant_id,p_reservation_id,true);
  -- All deterministic validation happens BEFORE any claim is taken.
  if p_operation not in ('folio.add_addon', 'folio.adjustment') then
    return jsonb_build_object('ok', false, 'code', 'operation_not_supported');
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 9999 then
    return jsonb_build_object('ok', false, 'code', 'quantity_invalid');
  end if;
  if p_subtotal_cents is distinct from (p_quantity * p_unit_price_cents)
     or p_total_cents is distinct from (p_subtotal_cents + coalesce(p_tax_cents, 0)) then
    return jsonb_build_object('ok', false, 'code', 'amount_mismatch');
  end if;

  select f.id into v_folio_id
  from public.hotel_folios f
  where f.tenant_id = p_tenant_id and f.reservation_id = p_reservation_id
  for update;

  if v_folio_id is null then
    return jsonb_build_object('ok', false, 'code', 'folio_not_found');
  end if;

  if p_catalogue_id is not null and not exists (
    select 1 from public.hotel_addon_catalogue c
    where c.tenant_id = p_tenant_id and c.id = p_catalogue_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'catalogue_item_not_found');
  end if;

  v_claim := public.hotelhub_claim_folio_operation(
    p_tenant_id, p_operation, p_reservation_id, v_folio_id, null,
    p_client_request_id, p_request_fingerprint, p_actor_n3_user_key
  );
  if (v_claim->>'ok')::boolean is not true then
    return v_claim;
  end if;
  if (v_claim->>'replay')::boolean then
    return jsonb_build_object('ok', true, 'replay', true,
                              'lineId', v_claim->>'lineId');
  end if;

  insert into public.hotel_folio_lines (
    tenant_id, folio_id, line_type, status, catalogue_id, tax_class,
    description_snapshot, quantity, unit_price_cents, subtotal_cents,
    tax_cents, total_cents, tax_snapshot, reason, actor_n3_user_key,
    client_request_id
  ) values (
    p_tenant_id, v_folio_id, p_line_type, 'draft', p_catalogue_id, p_tax_class,
    left(p_description, 160), p_quantity, p_unit_price_cents, p_subtotal_cents,
    coalesce(p_tax_cents, 0), p_total_cents, coalesce(p_tax_snapshot, '{}'::jsonb),
    p_reason, p_actor_n3_user_key, p_client_request_id
  ) returning * into v_line;

  update public.hotel_folio_operations
     set result_line_id = v_line.id
   where tenant_id = p_tenant_id
     and operation = p_operation
     and client_request_id = p_client_request_id;

  return jsonb_build_object('ok', true, 'replay', false, 'lineId', v_line.id);
end;
$function$
;

-- Forward replacement; existing observed body retained after parent guard.
CREATE OR REPLACE FUNCTION public.hotelhub_add_tourism_tax_evidence(p_tenant_id uuid, p_reservation_id uuid, p_source_label text, p_reference text, p_collected_on date, p_amount_cents integer, p_note text, p_client_request_id uuid, p_actor_n3_user_key text, p_request_fingerprint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_claim jsonb;
  v_id uuid;
begin
  PERFORM public.hotelhub_settlement_guard(p_tenant_id,p_reservation_id,true);
  if p_amount_cents is null or p_amount_cents < 0 or p_amount_cents > 100000000 then
    return jsonb_build_object('ok', false, 'code', 'amount_invalid');
  end if;
  if not exists (
    select 1 from public.hotel_reservations r
    where r.tenant_id = p_tenant_id and r.id = p_reservation_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'reservation_not_found');
  end if;

  v_claim := public.hotelhub_claim_folio_operation(
    p_tenant_id, 'folio.tourism_tax_evidence', p_reservation_id, null, null,
    p_client_request_id, p_request_fingerprint, p_actor_n3_user_key
  );
  if (v_claim->>'ok')::boolean is not true then
    return v_claim;
  end if;
  if (v_claim->>'replay')::boolean then
    -- Resolve the ORIGINAL stored evidence row, never a null id.
    return jsonb_build_object('ok', true, 'replay', true,
                              'evidenceId', v_claim->>'evidenceId');
  end if;

  insert into public.hotel_tourism_tax_evidence (
    tenant_id, reservation_id, source_label, reference, collected_on,
    amount_cents, note, actor_n3_user_key, client_request_id
  ) values (
    p_tenant_id, p_reservation_id, btrim(p_source_label), p_reference, p_collected_on,
    p_amount_cents, p_note, p_actor_n3_user_key, p_client_request_id
  ) returning id into v_id;

  update public.hotel_folio_operations
     set result_evidence_id = v_id
   where tenant_id = p_tenant_id
     and operation = 'folio.tourism_tax_evidence'
     and client_request_id = p_client_request_id;

  return jsonb_build_object('ok', true, 'replay', false, 'evidenceId', v_id);
end;
$function$
;

-- Forward replacement; existing observed body retained after parent guard.
CREATE OR REPLACE FUNCTION public.hotelhub_assign_guest_rooms_v2(p_tenant_id uuid, p_reservation_id uuid, p_actor_n3_user_key text, p_actor_role text, p_client_request_id uuid, p_expected_updated_at timestamp with time zone, p_assignments jsonb, p_correction_reason text)
 RETURNS TABLE(out_updated integer, out_updated_at timestamp with time zone, out_replayed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  PERFORM public.hotelhub_settlement_guard(p_tenant_id,p_reservation_id,true);
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
$function$
;

-- Forward replacement; existing observed body retained after parent guard.
CREATE OR REPLACE FUNCTION public.hotelhub_check_in_reservation(p_tenant_id uuid, p_reservation_id uuid, p_actor_n3_user_key text, p_expected_updated_at timestamp with time zone, p_allow_early boolean DEFAULT false, p_operation_request_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(out_status text, out_checked_in_at timestamp with time zone, out_updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.hotel_reservations%ROWTYPE;
  v_local timestamp;
  v_ci_time text;
  v_rooms integer;
  v_guests integer;
BEGIN
  PERFORM public.hotelhub_settlement_guard(p_tenant_id,p_reservation_id,true);
  IF p_tenant_id IS NULL OR p_reservation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH210', MESSAGE='reservation_not_found';
  END IF;
  IF p_actor_n3_user_key IS NULL OR length(btrim(p_actor_n3_user_key)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH211', MESSAGE='unauthorized';
  END IF;

  SELECT * INTO v_row FROM public.hotel_reservations
    WHERE id = p_reservation_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='HH212', MESSAGE='reservation_not_found';
  END IF;

  -- Idempotent: already checked in returns the existing state unchanged.
  IF v_row.status = 'checked_in' THEN
    RETURN QUERY SELECT v_row.status, v_row.checked_in_at, v_row.updated_at;
    RETURN;
  END IF;
  IF v_row.status <> 'confirmed' THEN
    RAISE EXCEPTION USING ERRCODE='HH213', MESSAGE='invalid_transition';
  END IF;
  IF p_expected_updated_at IS NOT NULL AND v_row.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION USING ERRCODE='HH214', MESSAGE='reservation_changed';
  END IF;

  SELECT count(*) INTO v_rooms FROM public.hotel_reservation_rooms
    WHERE tenant_id = p_tenant_id AND reservation_id = p_reservation_id
      AND allocation_status IN ('reserved','occupied');
  SELECT count(*) INTO v_guests FROM public.hotel_reservation_guests
    WHERE tenant_id = p_tenant_id AND reservation_id = p_reservation_id;
  IF v_rooms < 1 OR v_guests < 1 THEN
    RAISE EXCEPTION USING ERRCODE='HH215', MESSAGE='invalid_transition';
  END IF;

  v_local := public.hotelhub_property_now(p_tenant_id);
  SELECT s.standard_check_in_time INTO v_ci_time
    FROM public.hotel_settings s WHERE s.tenant_id = p_tenant_id;
  v_ci_time := COALESCE(v_ci_time, '15:00');

  IF v_local::date < v_row.arrival_date THEN
    IF NOT p_allow_early THEN
      RAISE EXCEPTION USING ERRCODE='HH216', MESSAGE='early_check_in_required';
    END IF;
  ELSIF v_local::date = v_row.arrival_date
        AND v_local::time < v_ci_time::time
        AND NOT p_allow_early THEN
    RAISE EXCEPTION USING ERRCODE='HH217', MESSAGE='early_check_in_required';
  END IF;

  UPDATE public.hotel_reservations
    SET status = 'checked_in',
        checked_in_at = now(),
        checked_in_by_n3_user_key = p_actor_n3_user_key
    WHERE id = p_reservation_id AND tenant_id = p_tenant_id
    RETURNING * INTO v_row;

  UPDATE public.hotel_reservation_rooms
    SET allocation_status = 'occupied'
    WHERE tenant_id = p_tenant_id AND reservation_id = p_reservation_id
      AND allocation_status = 'reserved';

  INSERT INTO public.hotel_reservation_events
    (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
  VALUES (p_tenant_id, p_reservation_id, 'checked_in',
          CASE WHEN p_allow_early THEN 'Early check-in completed' ELSE 'Checked in' END,
          p_actor_n3_user_key,
          jsonb_build_object('early', p_allow_early, 'operation_request_id', p_operation_request_id));

  INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
  VALUES (p_tenant_id, p_actor_n3_user_key, 'hotel.reservation.check_in',
          jsonb_build_object('bookingReference', v_row.booking_reference, 'early', p_allow_early));

  RETURN QUERY SELECT v_row.status, v_row.checked_in_at, v_row.updated_at;
END;
$function$
;

-- Forward replacement; existing observed body retained after parent guard.
CREATE OR REPLACE FUNCTION public.hotelhub_check_in_reservation(p_tenant_id uuid, p_reservation_id uuid, p_actor_n3_user_key text, p_expected_updated_at timestamp with time zone, p_allow_early boolean DEFAULT false, p_operation_request_id uuid DEFAULT NULL::uuid, p_client_request_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(out_status text, out_checked_in_at timestamp with time zone, out_updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.hotel_reservations%ROWTYPE;
  v_local timestamp;
  v_ci_time text;
  v_rooms integer;
  v_guests integer;
  v_primary integer;
  v_unassigned integer;
  v_overcap integer;
  v_ledger public.hotel_mutation_requests%ROWTYPE;
BEGIN
  PERFORM public.hotelhub_settlement_guard(p_tenant_id,p_reservation_id,true);
  IF p_tenant_id IS NULL OR p_reservation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH210', MESSAGE='reservation_not_found';
  END IF;
  IF p_actor_n3_user_key IS NULL OR length(btrim(p_actor_n3_user_key)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH211', MESSAGE='unauthorized';
  END IF;

  IF p_client_request_id IS NOT NULL THEN
    SELECT * INTO v_ledger FROM public.hotel_mutation_requests
      WHERE tenant_id = p_tenant_id AND scope = 'check_in'
        AND client_request_id = p_client_request_id;
    IF FOUND THEN
      IF v_ledger.reservation_id IS DISTINCT FROM p_reservation_id THEN
        RAISE EXCEPTION USING ERRCODE='HH219', MESSAGE='idempotency_conflict';
      END IF;
      SELECT * INTO v_row FROM public.hotel_reservations
        WHERE id = p_reservation_id AND tenant_id = p_tenant_id;
      RETURN QUERY SELECT v_row.status, v_row.checked_in_at, v_row.updated_at;
      RETURN;
    END IF;
  END IF;

  SELECT * INTO v_row FROM public.hotel_reservations
    WHERE id = p_reservation_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='HH212', MESSAGE='reservation_not_found';
  END IF;

  IF v_row.status = 'checked_in' THEN
    RETURN QUERY SELECT v_row.status, v_row.checked_in_at, v_row.updated_at;
    RETURN;
  END IF;
  IF v_row.status <> 'confirmed' THEN
    RAISE EXCEPTION USING ERRCODE='HH213', MESSAGE='invalid_transition';
  END IF;
  IF p_expected_updated_at IS NOT NULL AND v_row.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION USING ERRCODE='HH214', MESSAGE='reservation_changed';
  END IF;

  SELECT count(*) INTO v_rooms FROM public.hotel_reservation_rooms
    WHERE tenant_id = p_tenant_id AND reservation_id = p_reservation_id
      AND allocation_status IN ('reserved','occupied');
  SELECT count(*) INTO v_guests FROM public.hotel_reservation_guests
    WHERE tenant_id = p_tenant_id AND reservation_id = p_reservation_id;
  IF v_rooms < 1 OR v_guests < 1 THEN
    RAISE EXCEPTION USING ERRCODE='HH215', MESSAGE='invalid_transition';
  END IF;

  SELECT count(*) INTO v_primary FROM public.hotel_reservation_guests
    WHERE tenant_id = p_tenant_id AND reservation_id = p_reservation_id AND is_primary;
  IF v_primary <> 1 THEN
    RAISE EXCEPTION USING ERRCODE='HH21A', MESSAGE='primary_guest_required';
  END IF;

  -- Every guest must be assigned to a live room of THIS reservation.
  SELECT count(*) INTO v_unassigned
    FROM public.hotel_reservation_guests g
    WHERE g.tenant_id = p_tenant_id AND g.reservation_id = p_reservation_id
      AND NOT EXISTS (
        SELECT 1 FROM public.hotel_reservation_rooms r
         WHERE r.id = g.reservation_room_id
           AND r.tenant_id = p_tenant_id
           AND r.reservation_id = p_reservation_id
           AND r.allocation_status IN ('reserved','occupied')
      );
  IF v_unassigned > 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH21B', MESSAGE='guest_assignment_required';
  END IF;

  -- Declared occupancy and assigned headcount must both fit the real room.
  SELECT count(*) INTO v_overcap
    FROM public.hotel_reservation_rooms r
    JOIN public.hotel_rooms hr
      ON hr.id = r.hotel_room_id AND hr.tenant_id = p_tenant_id
    WHERE r.tenant_id = p_tenant_id AND r.reservation_id = p_reservation_id
      AND r.allocation_status IN ('reserved','occupied')
      AND (
        (r.adults + COALESCE(r.children,0)) > hr.max_occupancy
        OR (
          SELECT count(*) FROM public.hotel_reservation_guests g
           WHERE g.tenant_id = p_tenant_id AND g.reservation_room_id = r.id
        ) > hr.max_occupancy
      );
  IF v_overcap > 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH21C', MESSAGE='room_capacity_exceeded';
  END IF;

  v_local := public.hotelhub_property_now(p_tenant_id);
  SELECT s.standard_check_in_time INTO v_ci_time
    FROM public.hotel_settings s WHERE s.tenant_id = p_tenant_id;
  v_ci_time := COALESCE(v_ci_time, '15:00');

  IF v_local::date < v_row.arrival_date THEN
    IF NOT p_allow_early THEN
      RAISE EXCEPTION USING ERRCODE='HH216', MESSAGE='early_check_in_required';
    END IF;
  ELSIF v_local::date = v_row.arrival_date
        AND v_local::time < v_ci_time::time
        AND NOT p_allow_early THEN
    RAISE EXCEPTION USING ERRCODE='HH217', MESSAGE='early_check_in_required';
  END IF;

  UPDATE public.hotel_reservations
    SET status = 'checked_in',
        checked_in_at = now(),
        checked_in_by_n3_user_key = p_actor_n3_user_key
    WHERE id = p_reservation_id AND tenant_id = p_tenant_id
    RETURNING * INTO v_row;

  UPDATE public.hotel_reservation_rooms
    SET allocation_status = 'occupied'
    WHERE tenant_id = p_tenant_id AND reservation_id = p_reservation_id
      AND allocation_status = 'reserved';

  INSERT INTO public.hotel_reservation_events
    (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
  VALUES (p_tenant_id, p_reservation_id, 'checked_in',
          CASE WHEN p_allow_early THEN 'Early check-in completed' ELSE 'Checked in' END,
          p_actor_n3_user_key,
          jsonb_build_object('early', p_allow_early, 'operation_request_id', p_operation_request_id));

  INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
  VALUES (p_tenant_id, p_actor_n3_user_key, 'hotel.reservation.check_in',
          jsonb_build_object('bookingReference', v_row.booking_reference, 'early', p_allow_early));

  IF p_client_request_id IS NOT NULL THEN
    INSERT INTO public.hotel_mutation_requests
      (tenant_id, client_request_id, scope, reservation_id, result)
    VALUES (p_tenant_id, p_client_request_id, 'check_in', p_reservation_id,
            jsonb_build_object('status', v_row.status));
  END IF;

  RETURN QUERY SELECT v_row.status, v_row.checked_in_at, v_row.updated_at;
END;
$function$
;

-- Forward replacement; existing observed body retained after parent guard.
CREATE OR REPLACE FUNCTION public.hotelhub_claim_folio_operation(p_tenant_id uuid, p_operation text, p_reservation_id uuid, p_folio_id uuid, p_target_line_id uuid, p_client_request_id uuid, p_request_fingerprint text, p_actor_n3_user_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_claim public.hotel_folio_operations%rowtype;
  v_new_id uuid;
  v_attempt integer := 0;
begin
  PERFORM public.hotelhub_settlement_guard(p_tenant_id,p_reservation_id,true);
  loop
    v_attempt := v_attempt + 1;

    insert into public.hotel_folio_operations (
      tenant_id, operation, reservation_id, folio_id, target_line_id,
      client_request_id, request_fingerprint, actor_n3_user_key
    ) values (
      p_tenant_id, p_operation, p_reservation_id, p_folio_id, p_target_line_id,
      p_client_request_id, p_request_fingerprint, p_actor_n3_user_key
    )
    on conflict (tenant_id, operation, client_request_id) do nothing
    returning id into v_new_id;

    if v_new_id is not null then
      return jsonb_build_object(
        'ok', true, 'replay', false, 'claimed', true,
        'lineId', null, 'evidenceId', null
      );
    end if;

    select * into v_claim
    from public.hotel_folio_operations
    where tenant_id = p_tenant_id
      and operation = p_operation
      and client_request_id = p_client_request_id
    for update;

    if found then
      if v_claim.request_fingerprint is distinct from p_request_fingerprint
         or v_claim.reservation_id is distinct from p_reservation_id
         or v_claim.folio_id is distinct from p_folio_id
         or v_claim.target_line_id is distinct from p_target_line_id then
        return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
      end if;
      return jsonb_build_object(
        'ok', true, 'replay', true, 'claimed', false,
        'lineId', v_claim.result_line_id, 'evidenceId', v_claim.result_evidence_id
      );
    end if;

    -- The conflicting writer aborted: its row never became visible. Retry.
    if v_attempt >= 3 then
      return jsonb_build_object('ok', false, 'code', 'operation_claim_failed');
    end if;
  end loop;
end;
$function$
;

-- Forward replacement; existing observed body retained after parent guard.
CREATE OR REPLACE FUNCTION public.hotelhub_decide_operation(p_tenant_id uuid, p_request_id uuid, p_actor_n3_user_key text, p_decision text, p_note text, p_idempotency_key text)
 RETURNS TABLE(out_request_id uuid, out_state text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_req public.hotel_reservation_operation_requests%ROWTYPE;
  v_res public.hotel_reservations%ROWTYPE;
  v_alloc public.hotel_reservation_rooms%ROWTYPE;
  v_target public.hotel_rooms%ROWTYPE;
  v_new_departure date;
  v_new_rate numeric(12,2);
  v_expected_out timestamptz;
  v_preserve boolean;
  v_summary text;
  v_old_label text;
  v_new_label text;
BEGIN
  PERFORM public.hotelhub_settlement_guard(p_tenant_id,(SELECT reservation_id FROM public.hotel_reservation_operation_requests WHERE tenant_id=p_tenant_id AND id=p_request_id),true);
  IF p_actor_n3_user_key IS NULL OR length(btrim(p_actor_n3_user_key)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH230', MESSAGE='unauthorized';
  END IF;
  IF p_decision NOT IN ('approve','reject') THEN
    RAISE EXCEPTION USING ERRCODE='HH231', MESSAGE='validation_failed';
  END IF;

  SELECT * INTO v_req FROM public.hotel_reservation_operation_requests
    WHERE id = p_request_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='HH232', MESSAGE='operation_not_found';
  END IF;

  -- Idempotent replay of the same decision request id.
  IF v_req.state <> 'pending' THEN
    IF v_req.decision_idempotency_key IS NOT NULL
       AND v_req.decision_idempotency_key = p_idempotency_key THEN
      RETURN QUERY SELECT v_req.id, v_req.state;
      RETURN;
    END IF;
    RAISE EXCEPTION USING ERRCODE='HH233', MESSAGE='operation_stale';
  END IF;

  SELECT * INTO v_res FROM public.hotel_reservations
    WHERE id = v_req.reservation_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='HH234', MESSAGE='reservation_not_found';
  END IF;

  IF p_decision = 'reject' THEN
    UPDATE public.hotel_reservation_operation_requests
      SET state = 'rejected', decided_at = now(), decided_by_n3_user_key = p_actor_n3_user_key,
          decision_note = NULLIF(btrim(COALESCE(p_note,'')), ''),
          decision_idempotency_key = p_idempotency_key
      WHERE id = v_req.id;
    INSERT INTO public.hotel_reservation_events
      (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
    VALUES (p_tenant_id, v_req.reservation_id, 'operation_rejected',
            'Rejected ' || replace(v_req.operation_type, '_', ' '),
            p_actor_n3_user_key, jsonb_build_object('operation_request_id', v_req.id));
    INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
    VALUES (p_tenant_id, p_actor_n3_user_key, 'hotel.reservation.operation_rejected',
            jsonb_build_object('bookingReference', v_res.booking_reference,
                               'operationType', v_req.operation_type));
    RETURN QUERY SELECT v_req.id, 'rejected'::text;
    RETURN;
  END IF;

  -- ---------------- approve + apply ----------------
  IF v_res.status NOT IN ('confirmed','checked_in') THEN
    RAISE EXCEPTION USING ERRCODE='HH235', MESSAGE='operation_stale';
  END IF;

  IF v_req.operation_type = 'early_check_in' THEN
    IF v_res.status <> 'confirmed' THEN
      RAISE EXCEPTION USING ERRCODE='HH236', MESSAGE='operation_stale';
    END IF;
    PERFORM public.hotelhub_check_in_reservation(
      p_tenant_id, v_req.reservation_id, p_actor_n3_user_key, NULL, true, v_req.id);
    v_summary := 'Early check-in approved';

  ELSIF v_req.operation_type = 'late_checkout' THEN
    v_expected_out := (v_req.payload->>'expected_check_out_at')::timestamptz;
    IF v_expected_out IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='HH237', MESSAGE='validation_failed';
    END IF;
    UPDATE public.hotel_reservations SET expected_check_out_at = v_expected_out
      WHERE id = v_req.reservation_id AND tenant_id = p_tenant_id;
    INSERT INTO public.hotel_reservation_events
      (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
    VALUES (p_tenant_id, v_req.reservation_id, 'late_checkout_approved',
            'Late checkout approved', p_actor_n3_user_key,
            jsonb_build_object('operation_request_id', v_req.id,
                               'expected_check_out_at', v_expected_out));
    v_summary := NULL;

  ELSIF v_req.operation_type = 'room_change' THEN
    SELECT * INTO v_alloc FROM public.hotel_reservation_rooms
      WHERE id = (v_req.payload->>'reservation_room_id')::uuid
        AND tenant_id = p_tenant_id AND reservation_id = v_req.reservation_id
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE='HH238', MESSAGE='operation_stale';
    END IF;
    SELECT * INTO v_target FROM public.hotel_rooms
      WHERE id = (v_req.payload->>'to_hotel_room_id')::uuid AND tenant_id = p_tenant_id;
    IF NOT FOUND OR NOT v_target.is_active THEN
      RAISE EXCEPTION USING ERRCODE='HH239', MESSAGE='room_unavailable';
    END IF;
    IF v_target.max_occupancy < (v_alloc.adults + v_alloc.children) THEN
      RAISE EXCEPTION USING ERRCODE='HH240', MESSAGE='room_capacity_exceeded';
    END IF;
    v_preserve := COALESCE((v_req.payload->>'preserve_rate')::boolean, true);
    SELECT COALESCE(r.display_name, r.n3_stock_name, r.room_number) INTO v_old_label
      FROM public.hotel_rooms r WHERE r.id = v_alloc.hotel_room_id;
    v_new_label := COALESCE(v_target.display_name, v_target.n3_stock_name, v_target.room_number);
    BEGIN
      UPDATE public.hotel_reservation_rooms
        SET hotel_room_id = v_target.id,
            base_rate_snapshot = v_target.base_rate,
            agreed_rate = CASE WHEN v_preserve THEN v_alloc.agreed_rate ELSE v_target.base_rate END
        WHERE id = v_alloc.id;
    EXCEPTION WHEN exclusion_violation OR unique_violation THEN
      RAISE EXCEPTION USING ERRCODE='HH241', MESSAGE='room_unavailable';
    END;
    INSERT INTO public.hotel_reservation_events
      (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
    VALUES (p_tenant_id, v_req.reservation_id, 'room_changed',
            'Room changed from ' || v_old_label || ' to ' || v_new_label,
            p_actor_n3_user_key,
            jsonb_build_object('operation_request_id', v_req.id,
                               'preserve_rate', v_preserve));
    v_summary := NULL;

  ELSIF v_req.operation_type = 'stay_extension' THEN
    v_new_departure := (v_req.payload->>'new_departure_date')::date;
    IF v_new_departure IS NULL OR v_new_departure <= v_res.departure_date THEN
      RAISE EXCEPTION USING ERRCODE='HH242', MESSAGE='operation_stale';
    END IF;
    BEGIN
      UPDATE public.hotel_reservation_rooms
        SET departure_date = v_new_departure
        WHERE tenant_id = p_tenant_id AND reservation_id = v_req.reservation_id
          AND allocation_status IN ('reserved','occupied');
    EXCEPTION WHEN exclusion_violation OR unique_violation THEN
      RAISE EXCEPTION USING ERRCODE='HH243', MESSAGE='room_unavailable';
    END;
    UPDATE public.hotel_reservations SET departure_date = v_new_departure
      WHERE id = v_req.reservation_id AND tenant_id = p_tenant_id;
    INSERT INTO public.hotel_reservation_events
      (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
    VALUES (p_tenant_id, v_req.reservation_id, 'stay_extended',
            'Stay extended to ' || to_char(v_new_departure, 'DD/MM/YYYY'),
            p_actor_n3_user_key,
            jsonb_build_object('operation_request_id', v_req.id,
                               'previous_departure_date', v_res.departure_date,
                               'new_departure_date', v_new_departure));
    v_summary := NULL;

  ELSIF v_req.operation_type = 'rate_change' THEN
    SELECT * INTO v_alloc FROM public.hotel_reservation_rooms
      WHERE id = (v_req.payload->>'reservation_room_id')::uuid
        AND tenant_id = p_tenant_id AND reservation_id = v_req.reservation_id
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE='HH244', MESSAGE='operation_stale';
    END IF;
    v_new_rate := (v_req.payload->>'new_agreed_rate')::numeric(12,2);
    IF v_new_rate IS NULL OR v_new_rate < 0 THEN
      RAISE EXCEPTION USING ERRCODE='HH245', MESSAGE='validation_failed';
    END IF;
    UPDATE public.hotel_reservation_rooms
      SET agreed_rate = v_new_rate,
          rate_override_reason = NULLIF(btrim(COALESCE(v_req.payload->>'reason','')), '')
      WHERE id = v_alloc.id;
    INSERT INTO public.hotel_reservation_events
      (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
    VALUES (p_tenant_id, v_req.reservation_id, 'rate_changed',
            'Room rate changed', p_actor_n3_user_key,
            jsonb_build_object('operation_request_id', v_req.id,
                               'previous_rate', v_alloc.agreed_rate,
                               'new_rate', v_new_rate));
    v_summary := NULL;
  ELSE
    RAISE EXCEPTION USING ERRCODE='HH246', MESSAGE='validation_failed';
  END IF;

  UPDATE public.hotel_reservation_operation_requests
    SET state = 'applied', decided_at = now(), applied_at = now(),
        decided_by_n3_user_key = p_actor_n3_user_key,
        decision_note = NULLIF(btrim(COALESCE(p_note,'')), ''),
        decision_idempotency_key = p_idempotency_key
    WHERE id = v_req.id;

  INSERT INTO public.hotel_reservation_events
    (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
  VALUES (p_tenant_id, v_req.reservation_id, 'operation_approved',
          COALESCE(v_summary, 'Approved ' || replace(v_req.operation_type, '_', ' ')),
          p_actor_n3_user_key, jsonb_build_object('operation_request_id', v_req.id));

  INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
  VALUES (p_tenant_id, p_actor_n3_user_key, 'hotel.reservation.operation_applied',
          jsonb_build_object('bookingReference', v_res.booking_reference,
                             'operationType', v_req.operation_type));

  RETURN QUERY SELECT v_req.id, 'applied'::text;
END;
$function$
;

-- Forward replacement; existing observed body retained after parent guard.
CREATE OR REPLACE FUNCTION public.hotelhub_direct_operation_v2(p_tenant_id uuid, p_reservation_id uuid, p_actor_n3_user_key text, p_operation_type text, p_payload jsonb, p_idempotency_key text)
 RETURNS TABLE(out_request_id uuid, out_state text, out_handoff_id uuid, out_old_room_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_request_id uuid;
  v_state text;
  v_blocker text;
  v_dest uuid;
  v_rrid uuid;
  v_old_room uuid;
  v_handoff_id uuid;
  v_room_ids uuid[];
BEGIN
  PERFORM public.hotelhub_settlement_guard(p_tenant_id,p_reservation_id,true);
  IF p_tenant_id IS NULL OR p_reservation_id IS NULL THEN
    RAISE EXCEPTION 'reservation_not_found';
  END IF;
  IF p_actor_n3_user_key IS NULL OR length(btrim(p_actor_n3_user_key)) = 0 THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'validation_failed';
  END IF;

  SELECT r.out_request_id, r.out_state
    INTO v_request_id, v_state
    FROM public.hotelhub_request_operation(
      p_tenant_id,
      p_reservation_id,
      p_actor_n3_user_key,
      p_operation_type,
      p_payload,
      p_idempotency_key
    ) AS r;

  IF v_request_id IS NULL THEN
    RAISE EXCEPTION 'operation_request_failed';
  END IF;

  -- (b) Replay of an already-decided action: return the SAME result, touch
  -- nothing, and hand back the handover already correlated to this request.
  IF v_state IS DISTINCT FROM 'pending' THEN
    SELECT h.id, h.hotel_room_id INTO v_handoff_id, v_old_room
      FROM public.hotel_housekeeping_handoffs h
     WHERE h.tenant_id = p_tenant_id
       AND h.operation_request_id = v_request_id
     ORDER BY h.created_at ASC
     LIMIT 1;
    RETURN QUERY SELECT v_request_id, v_state, v_handoff_id, v_old_room;
    RETURN;
  END IF;

  -- (c) Fresh pending action: locked readiness gates inside THIS transaction.
  IF p_operation_type = 'early_check_in' THEN
    SELECT array_agg(rr.hotel_room_id) INTO v_room_ids
      FROM public.hotel_reservation_rooms rr
     WHERE rr.tenant_id = p_tenant_id
       AND rr.reservation_id = p_reservation_id
       AND rr.allocation_status <> 'released';
    v_blocker := public.hotelhub_hk_readiness_blocker_locked(p_tenant_id, v_room_ids);
    IF v_blocker IS NOT NULL THEN
      RAISE EXCEPTION '%', v_blocker;
    END IF;

  ELSIF p_operation_type = 'room_change' THEN
    v_dest := nullif(coalesce(
      p_payload ->> 'to_hotel_room_id',
      p_payload ->> 'toHotelRoomId'
    ), '')::uuid;
    v_rrid := nullif(coalesce(
      p_payload ->> 'reservation_room_id',
      p_payload ->> 'reservationRoomId'
    ), '')::uuid;
    IF v_dest IS NULL OR v_rrid IS NULL THEN
      RAISE EXCEPTION 'validation_failed';
    END IF;

    v_blocker := public.hotelhub_hk_readiness_blocker_locked(p_tenant_id, ARRAY[v_dest]);
    IF v_blocker IS NOT NULL THEN
      -- Same destination-specific vocabulary the approval path uses.
      v_blocker := CASE v_blocker
        WHEN 'housekeeping_not_initialized' THEN 'destination_housekeeping_not_initialized'
        WHEN 'room_not_ready' THEN 'destination_room_not_ready'
        WHEN 'room_dirty' THEN 'destination_room_dirty'
        WHEN 'room_cleaning' THEN 'destination_room_cleaning'
        WHEN 'room_inspected' THEN 'destination_room_inspected'
        WHEN 'dnd_active' THEN 'destination_dnd_active'
        ELSE v_blocker
      END;
      RAISE EXCEPTION '%', v_blocker;
    END IF;

    -- (d) The room actually being vacated, resolved and locked BEFORE apply.
    SELECT rr.hotel_room_id INTO v_old_room
      FROM public.hotel_reservation_rooms rr
     WHERE rr.tenant_id = p_tenant_id
       AND rr.reservation_id = p_reservation_id
       AND rr.id = v_rrid
     FOR UPDATE;
    IF v_old_room IS NULL THEN
      RAISE EXCEPTION 'reservation_room_unresolved';
    END IF;

    SELECT e.out_handoff_id INTO v_handoff_id
      FROM public.hotelhub_hk_enqueue_handoff(
        p_tenant_id,
        v_old_room,
        p_actor_n3_user_key,
        p_reservation_id,
        v_request_id,
        'room_change'
      ) AS e;
    IF v_handoff_id IS NULL THEN
      RAISE EXCEPTION 'handoff_not_recorded';
    END IF;
  END IF;

  -- (e) The existing authoritative approve/apply engine.
  SELECT d.out_request_id, d.out_state
    INTO v_request_id, v_state
    FROM public.hotelhub_decide_operation(
      p_tenant_id,
      v_request_id,
      p_actor_n3_user_key,
      'approve',
      NULL,
      p_idempotency_key || ':direct'
    ) AS d;

  IF v_state = 'pending' THEN
    RAISE EXCEPTION 'operation_decision_failed';
  END IF;

  RETURN QUERY SELECT v_request_id, v_state, v_handoff_id, v_old_room;
END;
$function$
;

-- Forward replacement; existing observed body retained after parent guard.
CREATE OR REPLACE FUNCTION public.hotelhub_receipt_control_claim(p_tenant_id uuid, p_request_id uuid, p_expected_version integer, p_step text, p_actor text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v public.hotel_receipt_control_requests; v_id uuid;
BEGIN
  PERFORM public.hotelhub_settlement_guard(p_tenant_id,(SELECT reservation_id FROM public.hotel_receipt_control_requests WHERE tenant_id=p_tenant_id AND id=p_request_id),true);
  SELECT * INTO v FROM public.hotel_receipt_control_requests
    WHERE id = p_request_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF v.approved_at IS NULL THEN RAISE EXCEPTION 'not_approved'; END IF;
  IF p_step NOT IN ('verify','edit','void','replace') THEN RAISE EXCEPTION 'invalid_transition'; END IF;
  IF p_step <> 'verify' AND v.execution_mode = 'manual' THEN RAISE EXCEPTION 'automation_unavailable'; END IF;
  IF v.version <> p_expected_version OR v.state NOT IN ('approved_awaiting_n3','needs_review') THEN RETURN NULL; END IF;
  INSERT INTO public.hotel_receipt_control_executions (tenant_id, request_id, step, claimed_by_n3_user_key, claimed_version)
    VALUES (p_tenant_id, v.id, p_step, p_actor, v.version + 1) ON CONFLICT DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  IF v.state = 'approved_awaiting_n3' THEN
    UPDATE public.hotel_receipt_control_requests SET state = 'applying', version = version + 1 WHERE id = v.id;
  ELSE
    UPDATE public.hotel_receipt_control_requests SET version = version + 1 WHERE id = v.id;
  END IF;
  RETURN v_id;
END $function$
;

-- Forward replacement; existing observed body retained after parent guard.
CREATE OR REPLACE FUNCTION public.hotelhub_receipt_control_complete(p_tenant_id uuid, p_request_id uuid, p_execution_id uuid, p_to_state text, p_outcome_code text, p_actor text, p_version jsonb)
 RETURNS SETOF hotel_receipt_control_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v public.hotel_receipt_control_requests; v_from text; v_no integer; v_exec public.hotel_receipt_control_executions;
BEGIN
  PERFORM public.hotelhub_settlement_guard(p_tenant_id,(SELECT reservation_id FROM public.hotel_receipt_control_requests WHERE tenant_id=p_tenant_id AND id=p_request_id),true);
  SELECT * INTO v FROM public.hotel_receipt_control_requests
    WHERE id = p_request_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  -- Fence: the claim must still be the in-flight claim for THIS request version of an approved request.
  SELECT * INTO v_exec FROM public.hotel_receipt_control_executions
    WHERE id = p_execution_id AND request_id = v.id AND tenant_id = p_tenant_id AND state = 'claimed' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim_not_found'; END IF;
  IF v.approved_at IS NULL OR v.state NOT IN ('applying','needs_review') OR v.version <> v_exec.claimed_version THEN
    RAISE EXCEPTION 'claim_stale';
  END IF;
  v_from := v.state;
  -- applied needs version evidence. A failed/needs_review outcome may still carry
  -- CONFIRMED void evidence (void step succeeded, replacement did not) so the
  -- original is excluded even though the overall request failed.
  IF p_to_state NOT IN ('applied','needs_review','failed')
     OR (p_to_state = 'applied' AND p_version IS NULL)
     OR (p_to_state <> 'applied' AND p_version IS NOT NULL AND p_version->>'state' IS DISTINCT FROM 'voided') THEN
    RAISE EXCEPTION 'invalid_transition';
  END IF;
  UPDATE public.hotel_receipt_control_executions SET state = 'completed', result_code = p_outcome_code, completed_at = now()
    WHERE id = v_exec.id;
  IF p_version IS NOT NULL THEN
    SELECT coalesce(max(version_no), 0) + 1 INTO v_no FROM public.hotel_receipt_versions
      WHERE tenant_id = p_tenant_id AND deposit_id = v.deposit_id;
    INSERT INTO public.hotel_receipt_versions (tenant_id, deposit_id, request_id, version_no, state, receipt_id,
      doc_code, document_date, currency, amount_cents, payment_lines, replacement_of, evidence_fingerprint,
      verified_by_n3_user_key)
    VALUES (p_tenant_id, v.deposit_id, v.id, v_no, p_version->>'state', p_version->>'receiptId',
      p_version->>'docCode', p_version->>'documentDate', p_version->>'currency',
      (p_version->>'amountCents')::bigint, p_version->'paymentLines', p_version->>'replacementOf',
      p_version->>'fingerprint', p_actor);
  END IF;
  UPDATE public.hotel_receipt_control_requests SET state = p_to_state, version = version + 1, outcome_code = p_outcome_code
    WHERE id = v.id RETURNING * INTO v;
  INSERT INTO public.hotel_receipt_control_decisions (tenant_id, request_id, decision, from_state, to_state,
    actor_n3_user_key, requester_n3_user_key, self_approved, outcome_code)
  VALUES (p_tenant_id, v.id, 'verify', v_from, p_to_state, p_actor, v.requested_by_n3_user_key,
    p_actor = v.requested_by_n3_user_key, p_outcome_code);
  IF p_to_state IN ('needs_review','failed') THEN
    INSERT INTO public.hotel_receipt_alert_outbox (tenant_id, request_id, event, request_version)
      VALUES (p_tenant_id, v.id, 'execution_failure', v.version) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEXT v;
END $function$
;

-- Forward replacement; existing observed body retained after parent guard.
CREATE OR REPLACE FUNCTION public.hotelhub_receipt_control_create(p_tenant_id uuid, p_reservation_id uuid, p_deposit_id uuid, p_client_request_id uuid, p_fingerprint text, p_kind text, p_reason text, p_original jsonb, p_proposal jsonb, p_comparison jsonb, p_original_cents bigint, p_proposed_cents bigint, p_actor text)
 RETURNS SETOF hotel_receipt_control_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v public.hotel_receipt_control_requests;
BEGIN
  PERFORM public.hotelhub_settlement_guard(p_tenant_id,p_reservation_id,true);
  -- RPC boundary validation mirrors the server contract (UTF-16 units).
  IF p_reason IS NULL OR p_reason <> btrim(p_reason)
     OR public.hotelhub_utf16_length(p_reason) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_reason';
  END IF;
  IF p_kind NOT IN ('correction','void') THEN RAISE EXCEPTION 'invalid_request'; END IF;
  SELECT * INTO v FROM public.hotel_receipt_control_requests
    WHERE tenant_id = p_tenant_id AND client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v.request_fingerprint <> p_fingerprint OR v.deposit_id <> p_deposit_id THEN
      RAISE EXCEPTION 'receipt_control_key_conflict';
    END IF;
    RETURN NEXT v; RETURN;
  END IF;
  PERFORM 1 FROM public.hotel_reservation_deposits d
    WHERE d.id = p_deposit_id AND d.tenant_id = p_tenant_id AND d.reservation_id = p_reservation_id AND d.status = 'posted';
  IF NOT FOUND THEN RAISE EXCEPTION 'deposit_not_found'; END IF;
  BEGIN
    INSERT INTO public.hotel_receipt_control_requests (tenant_id, reservation_id, deposit_id, client_request_id,
      request_fingerprint, kind, reason, original, proposal, comparison, original_amount_cents,
      proposed_amount_cents, requested_by_n3_user_key)
    VALUES (p_tenant_id, p_reservation_id, p_deposit_id, p_client_request_id, p_fingerprint, p_kind,
      p_reason, p_original, p_proposal, p_comparison, p_original_cents, p_proposed_cents, p_actor)
    RETURNING * INTO v;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v FROM public.hotel_receipt_control_requests
      WHERE tenant_id = p_tenant_id AND client_request_id = p_client_request_id;
    IF FOUND AND v.request_fingerprint = p_fingerprint THEN RETURN NEXT v; RETURN; END IF;
    IF FOUND THEN RAISE EXCEPTION 'receipt_control_key_conflict'; END IF;
    RAISE EXCEPTION 'receipt_control_active_exists';
  END;
  INSERT INTO public.hotel_receipt_alert_outbox (tenant_id, request_id, event, request_version)
    VALUES (p_tenant_id, v.id, 'pending', v.version) ON CONFLICT DO NOTHING;
  RETURN NEXT v;
END $function$
;

-- Forward replacement; existing observed body retained after parent guard.
CREATE OR REPLACE FUNCTION public.hotelhub_receipt_control_decide(p_tenant_id uuid, p_request_id uuid, p_expected_version integer, p_decision text, p_to_state text, p_actor text, p_outcome_code text, p_note text)
 RETURNS SETOF hotel_receipt_control_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v public.hotel_receipt_control_requests; v_from text;
BEGIN
  PERFORM public.hotelhub_settlement_guard(p_tenant_id,(SELECT reservation_id FROM public.hotel_receipt_control_requests WHERE tenant_id=p_tenant_id AND id=p_request_id),true);
  SELECT * INTO v FROM public.hotel_receipt_control_requests
    WHERE id = p_request_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF v.version <> p_expected_version THEN RAISE EXCEPTION 'version_conflict'; END IF;
  -- A verification claim in flight (e.g. on a previously approved Needs review
  -- request, whose state stays needs_review while claimed) fences ALL decisions:
  -- reject cannot reach a terminal state and free the active index while the
  -- claimed worker may still complete. Completion is additionally fenced to the
  -- claim's version and to applying/needs_review, so it can never resurrect a
  -- terminal request.
  IF EXISTS (SELECT 1 FROM public.hotel_receipt_control_executions
             WHERE request_id = v.id AND tenant_id = p_tenant_id AND state = 'claimed') THEN
    RAISE EXCEPTION 'claim_conflict';
  END IF;
  v_from := v.state;
  IF NOT (
    (p_decision = 'approve' AND v_from = 'pending' AND p_to_state = 'approved_awaiting_n3') OR
    (p_decision = 'hold' AND v_from IN ('pending','approved_awaiting_n3') AND p_to_state = 'needs_review') OR
    (p_decision = 'reject' AND v_from IN ('pending','needs_review') AND p_to_state = 'rejected')
  ) THEN RAISE EXCEPTION 'invalid_transition'; END IF;
  UPDATE public.hotel_receipt_control_requests SET state = p_to_state, version = version + 1,
    decided_by_n3_user_key = CASE WHEN p_decision = 'hold' THEN decided_by_n3_user_key ELSE p_actor END,
    decided_at = CASE WHEN p_decision = 'hold' THEN decided_at ELSE now() END,
    approved_by_n3_user_key = CASE WHEN p_decision = 'approve' THEN p_actor ELSE approved_by_n3_user_key END,
    approved_at = CASE WHEN p_decision = 'approve' THEN now() ELSE approved_at END,
    outcome_code = p_outcome_code
    WHERE id = v.id RETURNING * INTO v;
  INSERT INTO public.hotel_receipt_control_decisions (tenant_id, request_id, decision, from_state, to_state,
    actor_n3_user_key, requester_n3_user_key, self_approved, outcome_code, note)
  VALUES (p_tenant_id, v.id, p_decision, v_from, p_to_state, p_actor, v.requested_by_n3_user_key,
    p_actor = v.requested_by_n3_user_key, p_outcome_code, p_note);
  INSERT INTO public.hotel_receipt_alert_outbox (tenant_id, request_id, event, request_version)
    VALUES (p_tenant_id, v.id, 'decision', v.version) ON CONFLICT DO NOTHING;
  RETURN NEXT v;
END $function$
;

-- Forward replacement; existing observed body retained after parent guard.
CREATE OR REPLACE FUNCTION public.hotelhub_receipt_control_recover(p_tenant_id uuid, p_request_id uuid, p_expected_version integer, p_actor text, p_stale_seconds integer)
 RETURNS SETOF hotel_receipt_control_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v public.hotel_receipt_control_requests; v_exec public.hotel_receipt_control_executions; v_from text;
BEGIN
  PERFORM public.hotelhub_settlement_guard(p_tenant_id,(SELECT reservation_id FROM public.hotel_receipt_control_requests WHERE tenant_id=p_tenant_id AND id=p_request_id),true);
  IF p_stale_seconds IS NULL OR p_stale_seconds < 60 THEN RAISE EXCEPTION 'invalid_transition'; END IF;
  SELECT * INTO v FROM public.hotel_receipt_control_requests
    WHERE id = p_request_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF v.version <> p_expected_version THEN RAISE EXCEPTION 'version_conflict'; END IF;
  IF v.state NOT IN ('applying','needs_review') OR v.approved_at IS NULL THEN
    RAISE EXCEPTION 'invalid_transition';
  END IF;
  SELECT * INTO v_exec FROM public.hotel_receipt_control_executions
    WHERE request_id = v.id AND tenant_id = p_tenant_id AND state = 'claimed' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim_not_found'; END IF;
  IF v_exec.created_at > now() - make_interval(secs => p_stale_seconds) THEN
    RAISE EXCEPTION 'claim_conflict';
  END IF;
  UPDATE public.hotel_receipt_control_executions
    SET state = 'released', result_code = 'recovered', completed_at = now() WHERE id = v_exec.id;
  v_from := v.state;
  UPDATE public.hotel_receipt_control_requests
    SET state = CASE WHEN v.state = 'applying' THEN 'approved_awaiting_n3' ELSE v.state END,
        version = version + 1, outcome_code = 'verification_interrupted'
    WHERE id = v.id RETURNING * INTO v;
  INSERT INTO public.hotel_receipt_control_decisions (tenant_id, request_id, decision, from_state, to_state,
    actor_n3_user_key, requester_n3_user_key, self_approved, outcome_code)
  VALUES (p_tenant_id, v.id, 'recover', v_from, v.state, p_actor, v.requested_by_n3_user_key,
    p_actor = v.requested_by_n3_user_key, 'verification_interrupted');
  RETURN NEXT v;
END $function$
;

-- Forward replacement; existing observed body retained after parent guard.
CREATE OR REPLACE FUNCTION public.hotelhub_receipt_control_verify_atomic(p_tenant_id uuid, p_request_id uuid, p_expected_version integer, p_actor text, p_to_state text, p_outcome_code text, p_version jsonb)
 RETURNS SETOF hotel_receipt_control_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_exec uuid;
BEGIN
  PERFORM public.hotelhub_settlement_guard(p_tenant_id,(SELECT reservation_id FROM public.hotel_receipt_control_requests WHERE tenant_id=p_tenant_id AND id=p_request_id),true);
  v_exec := public.hotelhub_receipt_control_claim(p_tenant_id, p_request_id, p_expected_version, 'verify', p_actor);
  IF v_exec IS NULL THEN RAISE EXCEPTION 'claim_conflict'; END IF;
  RETURN QUERY SELECT * FROM public.hotelhub_receipt_control_complete(
    p_tenant_id, p_request_id, v_exec, p_to_state, p_outcome_code, p_actor, p_version);
END $function$
;

-- Forward replacement; existing observed body retained after parent guard.
CREATE OR REPLACE FUNCTION public.hotelhub_request_operation(p_tenant_id uuid, p_reservation_id uuid, p_actor_n3_user_key text, p_operation_type text, p_payload jsonb, p_idempotency_key text)
 RETURNS TABLE(out_request_id uuid, out_state text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_res public.hotel_reservations%ROWTYPE;
  v_existing public.hotel_reservation_operation_requests%ROWTYPE;
  v_id uuid;
BEGIN
  PERFORM public.hotelhub_settlement_guard(p_tenant_id,p_reservation_id,true);
  IF p_tenant_id IS NULL OR p_reservation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH220', MESSAGE='reservation_not_found';
  END IF;
  IF p_actor_n3_user_key IS NULL OR length(btrim(p_actor_n3_user_key)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH221', MESSAGE='unauthorized';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH222', MESSAGE='validation_failed';
  END IF;

  SELECT * INTO v_existing FROM public.hotel_reservation_operation_requests
    WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN QUERY SELECT v_existing.id, v_existing.state;
    RETURN;
  END IF;

  SELECT * INTO v_res FROM public.hotel_reservations
    WHERE id = p_reservation_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='HH223', MESSAGE='reservation_not_found';
  END IF;
  IF v_res.status NOT IN ('confirmed','checked_in') THEN
    RAISE EXCEPTION USING ERRCODE='HH224', MESSAGE='invalid_transition';
  END IF;

  BEGIN
    INSERT INTO public.hotel_reservation_operation_requests
      (tenant_id, reservation_id, operation_type, state, payload,
       requested_by_n3_user_key, idempotency_key)
    VALUES (p_tenant_id, p_reservation_id, p_operation_type, 'pending',
            COALESCE(p_payload, '{}'::jsonb), p_actor_n3_user_key, p_idempotency_key)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing FROM public.hotel_reservation_operation_requests
      WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN QUERY SELECT v_existing.id, v_existing.state;
      RETURN;
    END IF;
    RAISE EXCEPTION USING ERRCODE='HH225', MESSAGE='operation_pending';
  END;

  INSERT INTO public.hotel_reservation_events
    (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
  VALUES (p_tenant_id, p_reservation_id, 'operation_requested',
          'Requested ' || replace(p_operation_type, '_', ' '),
          p_actor_n3_user_key, jsonb_build_object('operation_request_id', v_id));

  INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
  VALUES (p_tenant_id, p_actor_n3_user_key, 'hotel.reservation.operation_requested',
          jsonb_build_object('bookingReference', v_res.booking_reference,
                             'operationType', p_operation_type));

  RETURN QUERY SELECT v_id, 'pending'::text;
END;
$function$
;

-- Forward replacement; existing observed body retained after parent guard.
CREATE OR REPLACE FUNCTION public.hotelhub_reverse_folio_line(p_tenant_id uuid, p_reservation_id uuid, p_line_id uuid, p_reason text, p_client_request_id uuid, p_actor_n3_user_key text, p_request_fingerprint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_folio_id uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_claim jsonb;
  v_line public.hotel_folio_lines%rowtype;
  v_reversal public.hotel_folio_lines%rowtype;
  v_code text;
begin
  PERFORM public.hotelhub_settlement_guard(p_tenant_id,p_reservation_id,true);
  if length(v_reason) < 3 or length(v_reason) > 240 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;

  -- Authoritative folio for THIS reservation, locked for the transaction.
  select f.id into v_folio_id
  from public.hotel_folios f
  where f.tenant_id = p_tenant_id and f.reservation_id = p_reservation_id
  for update;

  if v_folio_id is null then
    return jsonb_build_object('ok', false, 'code', 'folio_not_found');
  end if;

  -- Full immutable scope proof: tenant + folio + line, locked. A concurrent
  -- exact retry blocks HERE until the first writer commits.
  select * into v_line
  from public.hotel_folio_lines
  where tenant_id = p_tenant_id and folio_id = v_folio_id and id = p_line_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'line_not_found');
  end if;

  -- Re-check / take the operation claim AFTER serialization, and BEFORE any
  -- already_reversed decision.
  v_claim := public.hotelhub_claim_folio_operation(
    p_tenant_id, 'folio.reverse', p_reservation_id, v_folio_id, p_line_id,
    p_client_request_id, p_request_fingerprint, p_actor_n3_user_key
  );
  if (v_claim->>'ok')::boolean is not true then
    return v_claim;
  end if;
  if (v_claim->>'replay')::boolean then
    return jsonb_build_object('ok', true, 'replay', true,
                              'lineId', v_claim->>'lineId');
  end if;

  v_code := null;
  if v_line.line_type = 'room_night' then
    v_code := 'room_night_not_reversible';
  elsif v_line.line_type = 'reversal' then
    v_code := 'line_not_reversible';
  elsif v_line.status = 'reversed' then
    v_code := 'already_reversed';
  elsif exists (
    select 1 from public.hotel_folio_lines
    where tenant_id = p_tenant_id and reverses_line_id = p_line_id
  ) then
    v_code := 'already_reversed';
  end if;

  if v_code is not null then
    -- Never leave a committed empty claim that could later replay as success.
    perform public.hotelhub_release_folio_operation(
      p_tenant_id, 'folio.reverse', p_client_request_id
    );
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;

  insert into public.hotel_folio_lines (
    tenant_id, folio_id, line_type, status, tax_class, description_snapshot,
    quantity, unit_price_cents, subtotal_cents, tax_snapshot, reason,
    reverses_line_id, actor_n3_user_key, client_request_id
  ) values (
    p_tenant_id, v_folio_id, 'reversal', 'committed', v_line.tax_class,
    left('Reversal — ' || v_line.description_snapshot, 160),
    1, -v_line.subtotal_cents, -v_line.subtotal_cents,
    jsonb_build_object('source', 'reversal', 'reversesLineId', v_line.id),
    v_reason, v_line.id, p_actor_n3_user_key, p_client_request_id
  ) returning * into v_reversal;

  update public.hotel_folio_lines
     set status = 'reversed', updated_at = now()
   where tenant_id = p_tenant_id and folio_id = v_folio_id and id = v_line.id;

  update public.hotel_folio_operations
     set result_line_id = v_reversal.id
   where tenant_id = p_tenant_id
     and operation = 'folio.reverse'
     and client_request_id = p_client_request_id;

  return jsonb_build_object('ok', true, 'replay', false, 'lineId', v_reversal.id);
end;
$function$
;

-- Forward replacement; existing observed body retained after parent guard.
CREATE OR REPLACE FUNCTION public.hotelhub_update_folio_line_quantity(p_tenant_id uuid, p_reservation_id uuid, p_line_id uuid, p_expected_version integer, p_quantity integer, p_subtotal_cents integer, p_tax_cents integer, p_total_cents integer, p_client_request_id uuid, p_actor_n3_user_key text, p_request_fingerprint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_folio_id uuid;
  v_claim jsonb;
  v_line public.hotel_folio_lines%rowtype;
  v_code text;
begin
  PERFORM public.hotelhub_settlement_guard(p_tenant_id,p_reservation_id,true);
  if p_quantity is null or p_quantity < 1 or p_quantity > 9999 then
    return jsonb_build_object('ok', false, 'code', 'quantity_invalid');
  end if;

  select f.id into v_folio_id
  from public.hotel_folios f
  where f.tenant_id = p_tenant_id and f.reservation_id = p_reservation_id
  for update;

  if v_folio_id is null then
    return jsonb_build_object('ok', false, 'code', 'folio_not_found');
  end if;

  select * into v_line
  from public.hotel_folio_lines
  where tenant_id = p_tenant_id and folio_id = v_folio_id and id = p_line_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'line_not_found');
  end if;

  v_claim := public.hotelhub_claim_folio_operation(
    p_tenant_id, 'folio.update_quantity', p_reservation_id, v_folio_id, p_line_id,
    p_client_request_id, p_request_fingerprint, p_actor_n3_user_key
  );
  if (v_claim->>'ok')::boolean is not true then
    return v_claim;
  end if;
  if (v_claim->>'replay')::boolean then
    -- Exact retry: the original write already happened. Report it as such
    -- even though v_line.version has advanced past p_expected_version.
    return jsonb_build_object('ok', true, 'replay', true,
                              'lineId', coalesce(v_claim->>'lineId', p_line_id::text),
                              'version', v_line.version);
  end if;

  v_code := null;
  if v_line.line_type = 'room_night' then
    v_code := 'room_night_not_editable';
  elsif v_line.status <> 'draft' then
    v_code := 'line_not_editable';
  elsif v_line.version is distinct from p_expected_version then
    v_code := 'version_conflict';
  elsif p_subtotal_cents is distinct from (p_quantity * v_line.unit_price_cents)
     or p_total_cents is distinct from (p_subtotal_cents + coalesce(p_tax_cents, 0)) then
    v_code := 'amount_mismatch';
  end if;

  if v_code is not null then
    perform public.hotelhub_release_folio_operation(
      p_tenant_id, 'folio.update_quantity', p_client_request_id
    );
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;

  update public.hotel_folio_lines
     set quantity = p_quantity,
         subtotal_cents = p_subtotal_cents,
         tax_cents = coalesce(p_tax_cents, 0),
         total_cents = p_total_cents,
         version = v_line.version + 1,
         updated_at = now()
   where tenant_id = p_tenant_id and folio_id = v_folio_id and id = p_line_id;

  update public.hotel_folio_operations
     set result_line_id = p_line_id
   where tenant_id = p_tenant_id
     and operation = 'folio.update_quantity'
     and client_request_id = p_client_request_id;

  return jsonb_build_object('ok', true, 'replay', false, 'lineId', p_line_id,
                            'version', v_line.version + 1);
end;
$function$
;

-- Forward replacement; existing observed body retained after parent guard.
CREATE OR REPLACE FUNCTION public.hotelhub_update_reservation(p_tenant_id uuid, p_reservation_id uuid, p_actor_n3_user_key text, p_expected_updated_at timestamp with time zone, p_booking_source text, p_arrival_date date, p_departure_date date, p_notes text, p_external_booking_reference text, p_rooms jsonb)
 RETURNS TABLE(out_reservation_id uuid, out_updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.hotel_reservations%ROWTYPE;
  v_source_active boolean;
  v_room jsonb;
  v_room_id uuid;
  v_agreed numeric(12,2);
  v_adults integer;
  v_children integer;
  v_reason text;
  v_remark text;
  v_base numeric(12,2);
  v_max integer;
  v_ext_ref text;
  v_changes jsonb := '{}'::jsonb;
BEGIN
  PERFORM public.hotelhub_settlement_guard(p_tenant_id,p_reservation_id,true);
  IF p_tenant_id IS NULL OR p_reservation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH101', MESSAGE='tenant_required';
  END IF;
  IF p_actor_n3_user_key IS NULL OR length(btrim(p_actor_n3_user_key))=0 THEN
    RAISE EXCEPTION USING ERRCODE='HH102', MESSAGE='creator_required';
  END IF;
  IF p_arrival_date IS NULL OR p_departure_date IS NULL OR p_departure_date <= p_arrival_date THEN
    RAISE EXCEPTION USING ERRCODE='HH103', MESSAGE='invalid_stay_dates';
  END IF;

  SELECT * INTO v_row FROM public.hotel_reservations
    WHERE id = p_reservation_id AND tenant_id = p_tenant_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='HH104', MESSAGE='not_found';
  END IF;
  IF v_row.status <> 'confirmed' THEN
    RAISE EXCEPTION USING ERRCODE='HH105', MESSAGE='reservation_not_editable';
  END IF;
  IF p_expected_updated_at IS NULL OR v_row.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION USING ERRCODE='HH106', MESSAGE='stale_reservation';
  END IF;

  SELECT bs.is_active INTO v_source_active
    FROM public.hotel_booking_sources bs
    WHERE bs.tenant_id = p_tenant_id AND bs.source_code = p_booking_source;
  IF v_source_active IS NULL OR NOT v_source_active THEN
    RAISE EXCEPTION USING ERRCODE='HH107', MESSAGE='invalid_booking_source';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.hotel_reservation_rooms
    WHERE reservation_id = p_reservation_id AND allocation_status <> 'reserved'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='HH108', MESSAGE='reservation_not_editable';
  END IF;

  v_ext_ref := NULLIF(btrim(COALESCE(p_external_booking_reference,'')), '');
  IF v_ext_ref IS NOT NULL AND length(v_ext_ref) > 100 THEN
    v_ext_ref := substring(v_ext_ref for 100);
  END IF;

  UPDATE public.hotel_reservations
     SET booking_source = p_booking_source,
         arrival_date = p_arrival_date,
         departure_date = p_departure_date,
         notes = NULLIF(btrim(COALESCE(p_notes,'')), ''),
         external_booking_reference = v_ext_ref
   WHERE id = p_reservation_id AND tenant_id = p_tenant_id;

  IF p_rooms IS NOT NULL AND jsonb_array_length(p_rooms) > 0 THEN
    FOR v_room IN SELECT * FROM jsonb_array_elements(p_rooms) LOOP
      v_room_id := (v_room->>'id')::uuid;
      v_agreed := (v_room->>'agreed_rate')::numeric;
      v_adults := (v_room->>'adults')::integer;
      v_children := COALESCE((v_room->>'children')::integer, 0);
      v_reason := NULLIF(btrim(COALESCE(v_room->>'rate_override_reason','')),'');
      v_remark := NULLIF(btrim(COALESCE(v_room->>'remark','')),'');
      IF v_remark IS NOT NULL AND length(v_remark) > 500 THEN
        RAISE EXCEPTION USING ERRCODE='HH109', MESSAGE='room_remark_too_long';
      END IF;

      SELECT rr.base_rate_snapshot, hr.max_occupancy
        INTO v_base, v_max
        FROM public.hotel_reservation_rooms rr
        JOIN public.hotel_rooms hr ON hr.id = rr.hotel_room_id
       WHERE rr.id = v_room_id
         AND rr.reservation_id = p_reservation_id
         AND rr.tenant_id = p_tenant_id
       FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE='HH110', MESSAGE='room_not_found';
      END IF;
      IF v_adults IS NULL OR v_adults < 1 OR v_children < 0 THEN
        RAISE EXCEPTION USING ERRCODE='HH111', MESSAGE='invalid_occupancy';
      END IF;
      IF v_adults + v_children > v_max THEN
        RAISE EXCEPTION USING ERRCODE='HH112', MESSAGE='occupancy_exceeded';
      END IF;
      IF v_agreed IS NULL OR v_agreed < 0 THEN
        RAISE EXCEPTION USING ERRCODE='HH113', MESSAGE='invalid_rate';
      END IF;
      IF v_agreed <> v_base AND v_reason IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='HH114', MESSAGE='rate_override_reason_required';
      END IF;

      UPDATE public.hotel_reservation_rooms
         SET agreed_rate = v_agreed,
             adults = v_adults,
             children = v_children,
             rate_override_reason = CASE WHEN v_agreed <> v_base THEN v_reason ELSE NULL END,
             remark = v_remark,
             arrival_date = p_arrival_date,
             departure_date = p_departure_date
       WHERE id = v_room_id AND reservation_id = p_reservation_id AND tenant_id = p_tenant_id;
    END LOOP;
  ELSE
    UPDATE public.hotel_reservation_rooms
       SET arrival_date = p_arrival_date, departure_date = p_departure_date
     WHERE reservation_id = p_reservation_id AND tenant_id = p_tenant_id;
  END IF;

  v_changes := jsonb_build_object(
    'reservationId', p_reservation_id,
    'arrival', p_arrival_date,
    'departure', p_departure_date,
    'source', p_booking_source,
    'roomCount', COALESCE(jsonb_array_length(p_rooms), 0)
  );
  INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
  VALUES (p_tenant_id, p_actor_n3_user_key, 'hotel.reservation.updated', v_changes);

  SELECT r.updated_at INTO out_updated_at FROM public.hotel_reservations r WHERE r.id = p_reservation_id;
  out_reservation_id := p_reservation_id;
  RETURN NEXT;
END;
$function$
;

-- Forward replacement; existing observed body retained after parent guard.
CREATE OR REPLACE FUNCTION public.hotelhub_update_reservation_v2(p_tenant_id uuid, p_reservation_id uuid, p_actor_n3_user_key text, p_actor_role text, p_client_request_id uuid, p_fingerprint text, p_expected_updated_at timestamp with time zone, p_booking_source text, p_arrival_date date, p_departure_date date, p_notes text, p_external_booking_reference text, p_rooms jsonb, p_guests jsonb, p_correction_reason text)
 RETURNS TABLE(out_reservation_id uuid, out_updated_at timestamp with time zone, out_replayed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  PERFORM public.hotelhub_settlement_guard(p_tenant_id,p_reservation_id,true);
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
  VALUES (p_tenant_id, p_reservation_id, 'reservation_edited',
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
$function$
;

DO $f$ DECLARE r record; BEGIN FOR r IN SELECT p.oid::regprocedure AS sig,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'hotelhub_settlement_%' LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',r.sig);
 IF r.proname IN ('hotelhub_settlement_read','hotelhub_settlement_sources','hotelhub_settlement_freeze','hotelhub_settlement_claim','hotelhub_settlement_outcome','hotelhub_settlement_prove','hotelhub_settlement_abandon') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',r.sig); END IF;
 END LOOP; END $f$;
