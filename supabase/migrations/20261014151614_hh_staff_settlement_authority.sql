-- Candidate only. Depends on the reviewed settlement and source-billing schemas.
-- No operational apply or financial-contract activation is authorized by this file.
-- Existing Owner helper/settings/report/payer/adjustment boundaries are unchanged.
BEGIN;
CREATE FUNCTION public.hotelhub_settlement_operator(p_tenant_id uuid,p_actor text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE v_role text;
BEGIN
 IF p_tenant_id IS NULL OR nullif(btrim(p_actor),'') IS NULL THEN
  RAISE EXCEPTION 'settlement_forbidden';
 END IF;
 SELECT role::text INTO v_role FROM public.hotel_user_roles
 WHERE tenant_id=p_tenant_id AND n3_user_key=p_actor AND is_active
   AND role IN ('owner','front_desk') FOR SHARE;
 IF v_role IS NULL THEN RAISE EXCEPTION 'settlement_forbidden'; END IF;
 RETURN v_role;
END $f$;
REVOKE ALL ON FUNCTION public.hotelhub_settlement_operator(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

-- Retained hotelhub_settlement_freeze body; ordinary actor guard widened only.
CREATE OR REPLACE FUNCTION public.hotelhub_settlement_freeze(p_tenant_id uuid,p_reservation_id uuid,p_actor text,p_snapshot jsonb,p_client_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE i public.hotel_settlement_intents; r public.hotel_reservations; f public.hotel_folios; BEGIN
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
 IF (p_snapshot->>'totalCents')::bigint IS DISTINCT FROM (SELECT sum(total_cents) FROM public.hotel_folio_lines WHERE tenant_id=p_tenant_id AND folio_id=f.id) THEN RAISE EXCEPTION 'settlement_snapshot_changed'; END IF;
 IF p_snapshot->'sourceVersions' IS DISTINCT FROM public.hotelhub_settlement_sources(p_tenant_id,p_reservation_id) OR p_snapshot->>'currency' IS DISTINCT FROM r.currency OR p_snapshot->>'digest' !~ '^[a-f0-9]{64}$' OR (p_snapshot->>'totalCents')::bigint NOT BETWEEN 1 AND 1000000000 THEN RAISE EXCEPTION 'settlement_snapshot_changed'; END IF;
 INSERT INTO public.hotel_settlement_intents(tenant_id,reservation_id,client_request_id,snapshot,digest,actor_n3_user_key) VALUES(p_tenant_id,p_reservation_id,p_client_request_id,p_snapshot,p_snapshot->>'digest',p_actor) RETURNING * INTO i;
 INSERT INTO public.hotel_settlement_events(tenant_id,reservation_id,intent_id,event,actor_n3_user_key) VALUES(p_tenant_id,p_reservation_id,i.id,'frozen',p_actor);
 RETURN public.hotelhub_settlement_read_intent(p_tenant_id,p_reservation_id,i.id);
END $f$;

-- Retained hotelhub_settlement_claim body; ordinary actor guard widened only.
CREATE OR REPLACE FUNCTION public.hotelhub_settlement_claim(p_tenant_id uuid,p_reservation_id uuid,p_actor text,p_intent_id uuid,p_revision text,p_step text,p_receipt_id uuid,p_payload_digest text,p_dispatch_facts jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE i public.hotel_settlement_intents; a public.hotel_settlement_attempts; current_bill jsonb; bill_checked timestamptz; BEGIN
 PERFORM public.hotelhub_settlement_operator(p_tenant_id,p_actor);
 PERFORM 1 FROM public.hotel_reservations WHERE tenant_id=p_tenant_id AND id=p_reservation_id FOR UPDATE;
 SELECT * INTO i FROM public.hotel_settlement_intents WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id AND id=p_intent_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
 IF i.source_leg_kind='source_room' AND p_step<>'bill' THEN RAISE EXCEPTION 'source_billing_guest_action_required'; END IF;
 IF EXISTS(SELECT 1 FROM public.hotel_settlement_attempts WHERE intent_id=p_intent_id AND kind=p_step AND receipt_id IS NOT DISTINCT FROM p_receipt_id) THEN RETURN NULL; END IF;
 IF jsonb_typeof(p_dispatch_facts) IS DISTINCT FROM 'object' OR p_dispatch_facts->>'kind' IS DISTINCT FROM p_step OR p_dispatch_facts->>'snapshotDigest' IS DISTINCT FROM i.digest OR octet_length(p_dispatch_facts::text)>2000000 OR p_dispatch_facts::text ~* '"(n3token|authorization|password|secret|rawjournal|access_token|refresh_token|cookie|session)"[[:space:]]*:' THEN RAISE EXCEPTION 'settlement_invalid_dispatch_facts'; END IF;
 IF encode(sha256(convert_to(public.hotelhub_settlement_payload_json(p_dispatch_facts->'payload'),'UTF8')),'hex') IS DISTINCT FROM p_payload_digest THEN RAISE EXCEPTION 'settlement_invalid_dispatch_facts'; END IF;
 IF (p_step IN ('bill','balance_receipt') AND jsonb_typeof(p_dispatch_facts->'payload') IS DISTINCT FROM 'object') OR (p_step IN ('deposit_allocation','balance_allocation') AND (jsonb_typeof(p_dispatch_facts->'payload') IS DISTINCT FROM 'array' OR jsonb_array_length(p_dispatch_facts->'payload')=0 OR p_dispatch_facts->'receipt'->>'receiptId' IS DISTINCT FROM p_receipt_id::text OR p_dispatch_facts->'receipt'->>'reservationId' IS DISTINCT FROM p_reservation_id::text OR jsonb_typeof(p_dispatch_facts->'before') IS DISTINCT FROM 'object')) THEN RAISE EXCEPTION 'settlement_invalid_dispatch_facts'; END IF;
 IF i.revision::text<>p_revision THEN RAISE EXCEPTION 'settlement_stale_revision'; END IF;
 IF i.state IN ('needs_review','closed','closing','abandoned') THEN RAISE EXCEPTION 'settlement_invalid_state'; END IF;
 IF EXISTS(SELECT 1 FROM public.hotel_settlement_attempts prior WHERE prior.intent_id=i.id AND NOT EXISTS(SELECT 1 FROM public.hotel_settlement_evidence e WHERE e.intent_id=i.id AND ((prior.kind='bill' AND e.proof->>'kind'='bill') OR (prior.kind='balance_receipt' AND e.proof->>'kind'='balance_receipt') OR (prior.kind IN ('deposit_allocation','balance_allocation') AND e.proof->>'kind'='allocation' AND e.proof->'receipt'->>'receiptId'=prior.receipt_id::text)))) THEN RAISE EXCEPTION 'settlement_invalid_state'; END IF;
 IF (p_step='bill' AND i.state<>'frozen') OR (p_step IN ('deposit_allocation','balance_receipt') AND i.state NOT IN ('bill_verified','awaiting_payment','allocating')) OR (p_step='balance_allocation' AND i.state<>'balance_dispatched') THEN RAISE EXCEPTION 'settlement_invalid_state'; END IF;
 IF p_step='balance_receipt' THEN
  SELECT e.proof->'bill',(e.proof->>'checkedAt')::timestamptz INTO current_bill,bill_checked FROM public.hotel_settlement_evidence e WHERE e.intent_id=i.id AND e.proof->'bill' IS NOT NULL ORDER BY (e.proof->>'checkedAt')::timestamptz DESC,e.created_at DESC,e.id DESC LIMIT 1;
  IF current_bill IS NULL OR bill_checked<clock_timestamp()-interval '60 seconds' OR bill_checked>clock_timestamp()+interval '5 seconds' OR coalesce(current_bill->>'outstandingCents','') !~ '^[1-9][0-9]{0,9}$' OR current_bill->>'outstandingCents' IS DISTINCT FROM p_dispatch_facts->'input'->>'amountCents' THEN RAISE EXCEPTION 'settlement_invalid_state'; END IF;
 END IF;
 IF p_step='deposit_allocation' AND NOT public.hotelhub_settlement_receipts_owned(p_tenant_id,p_reservation_id,i.snapshot->'receipts') THEN RAISE EXCEPTION 'settlement_scope_mismatch'; END IF;
 IF p_step='deposit_allocation' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(i.snapshot->'receipts') r WHERE r->>'receiptId'=p_receipt_id::text AND r->>'reservationId'=p_reservation_id::text) THEN RAISE EXCEPTION 'settlement_scope_mismatch'; END IF;
 IF p_step='balance_allocation' AND NOT EXISTS(SELECT 1 FROM public.hotel_settlement_evidence e WHERE e.tenant_id=p_tenant_id AND e.reservation_id=p_reservation_id AND e.intent_id=i.id AND e.proof->>'kind'='balance_receipt' AND e.proof->'receipt'->>'receiptId'=p_receipt_id::text) THEN RAISE EXCEPTION 'settlement_scope_mismatch'; END IF;
 IF (i.snapshot->'sourceVersions') IS DISTINCT FROM public.hotelhub_settlement_sources(p_tenant_id,p_reservation_id) THEN RAISE EXCEPTION 'settlement_snapshot_changed'; END IF;
 UPDATE public.hotel_settlement_intents SET revision=revision+1,state=CASE p_step WHEN 'bill' THEN 'bill_dispatched' WHEN 'balance_receipt' THEN 'balance_dispatched' ELSE 'allocating' END WHERE id=i.id RETURNING * INTO i;
 INSERT INTO public.hotel_settlement_attempts(tenant_id,reservation_id,intent_id,kind,receipt_id,claimed_revision,payload_digest,dispatch_facts,actor_n3_user_key) VALUES(p_tenant_id,p_reservation_id,i.id,p_step,p_receipt_id,i.revision,p_payload_digest,p_dispatch_facts,p_actor) RETURNING * INTO a;
 INSERT INTO public.hotel_settlement_events(tenant_id,reservation_id,intent_id,event,actor_n3_user_key,detail) VALUES(p_tenant_id,p_reservation_id,i.id,'dispatch_claimed',p_actor,jsonb_build_object('attemptId',a.id,'kind',p_step));
 RETURN jsonb_strip_nulls(jsonb_build_object('attemptId',a.id,'intentId',i.id,'kind',a.kind,'receiptId',a.receipt_id,'expectedRevision',i.revision::text,'payloadDigest',a.payload_digest));
END $f$;

-- Retained hotelhub_settlement_outcome body; ordinary actor guard widened only.
CREATE OR REPLACE FUNCTION public.hotelhub_settlement_outcome(p_tenant_id uuid,p_reservation_id uuid,p_actor text,p_intent_id uuid,p_revision text,p_attempt_id uuid,p_payload_digest text,p_outcome jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE i public.hotel_settlement_intents; a public.hotel_settlement_attempts; BEGIN
 PERFORM public.hotelhub_settlement_operator(p_tenant_id,p_actor);
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
 RETURN public.hotelhub_settlement_read_intent(p_tenant_id,p_reservation_id,i.id);
END $f$;

-- Retained hotelhub_settlement_prove body; ordinary actor guard widened only.
CREATE OR REPLACE FUNCTION public.hotelhub_settlement_prove(p_tenant_id uuid,p_reservation_id uuid,p_actor text,p_intent_id uuid,p_revision text,p_proof jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE i public.hotel_settlement_intents; b jsonb; r jsonb; payment jsonb; attempt public.hotel_settlement_attempts; proof_at timestamptz; next_state text; matched_total bigint:=0; receipt_count integer:=0; balance_count integer:=0; BEGIN
 PERFORM public.hotelhub_settlement_operator(p_tenant_id,p_actor);
 PERFORM 1 FROM public.hotel_reservations WHERE tenant_id=p_tenant_id AND id=p_reservation_id FOR UPDATE;
 SELECT * INTO i FROM public.hotel_settlement_intents WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id AND id=p_intent_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
 IF jsonb_typeof(p_proof) IS DISTINCT FROM 'object' OR coalesce(p_proof->>'kind','') NOT IN ('bill','balance_receipt','allocation','settlement') OR p_proof->>'tenantId' IS DISTINCT FROM p_tenant_id::text OR p_proof->>'reservationId' IS DISTINCT FROM p_reservation_id::text OR p_proof->>'intentId' IS DISTINCT FROM i.id::text OR p_proof->>'snapshotDigest' IS DISTINCT FROM i.digest OR coalesce(p_proof->>'digest','') !~ '^[a-f0-9]{64}$' OR p_proof::text ~* '"(n3token|authorization|password|secret|rawjournal|access_token|refresh_token|cookie|session)"[[:space:]]*:' THEN RAISE EXCEPTION 'settlement_untrusted_proof'; END IF;
 IF encode(sha256(convert_to(public.hotelhub_settlement_payload_json(p_proof-'digest'),'UTF8')),'hex') IS DISTINCT FROM p_proof->>'digest' THEN RAISE EXCEPTION 'settlement_untrusted_proof'; END IF;
 IF EXISTS(SELECT 1 FROM public.hotel_settlement_evidence WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id AND intent_id=i.id AND proof_digest=p_proof->>'digest') THEN RETURN public.hotelhub_settlement_read_intent(p_tenant_id,p_reservation_id,i.id); END IF;
 IF i.revision::text IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'settlement_stale_revision'; END IF;
 IF (i.state IN ('frozen','closed','closing','abandoned') OR (i.state='settled' AND p_proof->>'kind'<>'settlement')) OR NOT EXISTS(SELECT 1 FROM public.hotel_settlement_attempts WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id AND intent_id=i.id AND kind='bill') THEN RAISE EXCEPTION 'settlement_invalid_state'; END IF;
 BEGIN proof_at:=(p_proof->>'checkedAt')::timestamptz; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'settlement_untrusted_proof'; END;
 IF proof_at IS NULL OR proof_at<clock_timestamp()-interval '60 seconds' OR proof_at>clock_timestamp()+interval '5 seconds' THEN RAISE EXCEPTION 'settlement_expired_proof'; END IF;
 b:=p_proof->'bill';
 IF jsonb_typeof(b) IS DISTINCT FROM 'object' OR coalesce(b->>'id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' OR b->>'id'='00000000-0000-0000-0000-000000000000' OR b->>'targetId' IS DISTINCT FROM b->>'id' OR b->>'targetType' IS DISTINCT FROM 'INV' OR b->>'intentId' IS DISTINCT FROM i.id::text OR b->>'totalCents' IS DISTINCT FROM i.snapshot->>'totalCents' OR coalesce(b->>'outstandingCents','') !~ '^(0|[1-9][0-9]{0,9})$' OR b->>'documentDate' IS DISTINCT FROM i.snapshot->>'billDate' OR coalesce(b->>'code','')='' OR jsonb_typeof(b->'fingerprints') IS DISTINCT FROM 'array' OR jsonb_array_length(b->'fingerprints')<>2 THEN RAISE EXCEPTION 'settlement_untrusted_proof'; END IF;
 IF (b->>'outstandingCents')::bigint>(b->>'totalCents')::bigint OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(b->'fingerprints') x WHERE x !~ '^[a-f0-9]{64}$') THEN RAISE EXCEPTION 'settlement_untrusted_proof'; END IF;
 IF EXISTS(SELECT 1 FROM public.hotel_settlement_evidence WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id AND intent_id=i.id AND proof->'bill'->>'id' IS DISTINCT FROM b->>'id') THEN RAISE EXCEPTION 'settlement_untrusted_proof'; END IF;
 IF p_proof->>'kind' IN ('allocation','settlement') THEN
  IF p_proof->>'kind'='allocation' THEN
   PERFORM public.hotelhub_settlement_allocation_proof(i,b,p_proof->'receipt');
   next_state:='allocating';
  ELSE
   IF b->>'outstandingCents' IS DISTINCT FROM '0' OR jsonb_typeof(p_proof->'receipts') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'settlement_untrusted_proof'; END IF;
   FOR r IN SELECT value FROM jsonb_array_elements(p_proof->'receipts') LOOP
    PERFORM public.hotelhub_settlement_allocation_proof(i,b,r);
    IF r->>'remainderCents' IS DISTINCT FROM '0' OR r->>'refundCents' IS DISTINCT FROM '0' THEN RAISE EXCEPTION 'settlement_untrusted_proof'; END IF;
    matched_total:=matched_total+(r->>'allocatedToBillCents')::bigint; receipt_count:=receipt_count+1;
    IF r->>'purpose'='settlement' THEN balance_count:=balance_count+1; END IF;
   END LOOP;
   IF matched_total<>(i.snapshot->>'totalCents')::bigint OR balance_count>1 OR receipt_count<>(SELECT count(DISTINCT x->>'receiptId') FROM jsonb_array_elements(p_proof->'receipts') x) OR EXISTS(SELECT 1 FROM jsonb_array_elements(i.snapshot->'receipts') x WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_proof->'receipts') y WHERE y->>'receiptId'=x->>'receiptId')) OR EXISTS(SELECT 1 FROM public.hotel_settlement_attempts a WHERE a.intent_id=i.id AND a.kind IN ('deposit_allocation','balance_allocation') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_proof->'receipts') y WHERE y->>'receiptId'=a.receipt_id::text)) THEN RAISE EXCEPTION 'settlement_untrusted_proof'; END IF;
   IF EXISTS(SELECT 1 FROM public.hotel_settlement_attempts a WHERE a.intent_id=i.id AND a.kind='balance_receipt' AND (balance_count<>1 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_proof->'receipts') y JOIN public.hotel_settlement_evidence e ON e.intent_id=i.id AND e.proof->>'kind'='balance_receipt' AND e.proof->'receipt'->>'receiptId'=y->>'receiptId' WHERE y->>'purpose'='settlement' AND (a.outcome->>'documentId' IS NULL OR a.outcome->>'documentId'=y->>'receiptId')))) THEN RAISE EXCEPTION 'settlement_untrusted_proof'; END IF;
   next_state:='settled';
  END IF;
 ELSIF p_proof->>'kind'='balance_receipt' THEN
  r:=p_proof->'receipt';
  SELECT * INTO attempt FROM public.hotel_settlement_attempts WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id AND intent_id=i.id AND kind='balance_receipt';
  IF NOT FOUND THEN RAISE EXCEPTION 'settlement_untrusted_proof'; END IF;
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR coalesce(r->>'receiptId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' OR r->>'receiptId'='00000000-0000-0000-0000-000000000000' OR r->>'purpose' IS DISTINCT FROM 'settlement' OR r->>'reference' IS DISTINCT FROM attempt.dispatch_facts->'payload'->>'referenceNo' OR r->>'documentDate' IS DISTINCT FROM attempt.dispatch_facts->'input'->>'docDate' OR r->>'customerId' IS DISTINCT FROM i.snapshot->>'customerId' OR r->>'currency' IS DISTINCT FROM i.snapshot->>'currency' OR coalesce(r->>'code','')='' OR r->>'amountCents' IS DISTINCT FROM attempt.dispatch_facts->'input'->>'amountCents' OR r->>'amountCents' IS DISTINCT FROM b->>'outstandingCents' OR r->>'refundCents' IS DISTINCT FROM '0' OR r->>'remainderCents' IS DISTINCT FROM r->>'amountCents' OR r->'allocations' IS DISTINCT FROM '[]'::jsonb OR jsonb_typeof(r->'payments') IS DISTINCT FROM 'array' OR jsonb_array_length(r->'payments')<>1 OR jsonb_typeof(r->'fingerprints') IS DISTINCT FROM 'array' OR jsonb_array_length(r->'fingerprints')<>2 THEN RAISE EXCEPTION 'settlement_untrusted_proof'; END IF;
  payment:=r->'payments'->0;
  IF payment->>'accountId' IS DISTINCT FROM attempt.dispatch_facts->'account'->>'id' OR payment->>'accountId' IS DISTINCT FROM attempt.dispatch_facts->'input'->>'accountId' OR payment->>'accountId' IS DISTINCT FROM attempt.dispatch_facts->'payload'->>'accountId' OR payment->>'accountCode' IS DISTINCT FROM attempt.dispatch_facts->'account'->>'code' OR payment->>'amountCents' IS DISTINCT FROM r->>'amountCents' OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(r->'fingerprints') x WHERE x !~ '^[a-f0-9]{64}$') THEN RAISE EXCEPTION 'settlement_untrusted_proof'; END IF;
  IF attempt.outcome->>'documentId' IS NOT NULL AND attempt.outcome->>'documentId' IS DISTINCT FROM r->>'receiptId' THEN RAISE EXCEPTION 'settlement_untrusted_proof'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(i.snapshot->'receipts') x WHERE x->>'receiptId'=r->>'receiptId') OR EXISTS(SELECT 1 FROM public.hotel_settlement_evidence e WHERE e.intent_id=i.id AND e.proof->>'kind'='balance_receipt' AND e.proof->'receipt'->>'receiptId' IS DISTINCT FROM r->>'receiptId') THEN RAISE EXCEPTION 'settlement_scope_mismatch'; END IF;
  next_state:='balance_dispatched';
 ELSE
 next_state:=CASE WHEN EXISTS(SELECT 1 FROM public.hotel_settlement_attempts WHERE intent_id=i.id AND kind<>'bill') THEN i.state ELSE 'bill_verified' END;
 END IF;
 INSERT INTO public.hotel_settlement_evidence(tenant_id,reservation_id,intent_id,proof_digest,proof) VALUES(p_tenant_id,p_reservation_id,i.id,p_proof->>'digest',p_proof);
 UPDATE public.hotel_settlement_intents SET revision=revision+1,state=next_state WHERE id=i.id;
 INSERT INTO public.hotel_settlement_events(tenant_id,reservation_id,intent_id,event,actor_n3_user_key,detail) VALUES(p_tenant_id,p_reservation_id,i.id,(p_proof->>'kind')||'_verified',p_actor,jsonb_build_object('proofDigest',p_proof->>'digest','billId',b->>'id'));
 RETURN public.hotelhub_settlement_read_intent(p_tenant_id,p_reservation_id,i.id);
END $f$;

-- Retained hotelhub_settlement_close body; ordinary actor guard widened only.
CREATE OR REPLACE FUNCTION public.hotelhub_settlement_close(p_tenant_id uuid,p_reservation_id uuid,p_actor text,p_intent_id uuid,p_revision text,p_proof_digest text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE i public.hotel_settlement_intents; res public.hotel_reservations; evidence jsonb; allocation public.hotel_reservation_rooms; handoff uuid; applied boolean; room_ids uuid[]; BEGIN
 PERFORM public.hotelhub_settlement_operator(p_tenant_id,p_actor);
 SELECT * INTO res FROM public.hotel_reservations WHERE tenant_id=p_tenant_id AND id=p_reservation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
 SELECT * INTO i FROM public.hotel_settlement_intents WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id AND id=p_intent_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
 IF i.source_leg_id IS NOT NULL THEN RAISE EXCEPTION 'source_billing_whole_stay_required'; END IF;
 IF i.state='closed' THEN
  IF NOT EXISTS(SELECT 1 FROM public.hotel_settlement_events WHERE intent_id=i.id AND event='closed' AND detail->>'proofDigest'=p_proof_digest) THEN RAISE EXCEPTION 'settlement_untrusted_proof'; END IF;
  RETURN public.hotelhub_settlement_read_intent(p_tenant_id,p_reservation_id,i.id);
 END IF;
 IF i.revision::text IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'settlement_stale_revision'; END IF;
 IF i.state<>'settled' OR res.status<>'checked_in' THEN RAISE EXCEPTION 'settlement_invalid_state'; END IF;
 SELECT proof INTO evidence FROM public.hotel_settlement_evidence WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id AND intent_id=i.id AND proof_digest=p_proof_digest AND proof->>'kind'='settlement';
 IF NOT FOUND OR evidence->>'snapshotDigest' IS DISTINCT FROM i.digest OR evidence->'bill'->>'outstandingCents' IS DISTINCT FROM '0' THEN RAISE EXCEPTION 'settlement_untrusted_proof'; END IF;
 IF (evidence->>'checkedAt')::timestamptz<clock_timestamp()-interval '60 seconds' OR (evidence->>'checkedAt')::timestamptz>clock_timestamp()+interval '5 seconds' THEN RAISE EXCEPTION 'settlement_expired_proof'; END IF;
 IF i.snapshot->'sourceVersions' IS DISTINCT FROM public.hotelhub_settlement_sources(p_tenant_id,p_reservation_id) THEN RAISE EXCEPTION 'settlement_snapshot_changed'; END IF;
 PERFORM 1 FROM public.hotel_reservation_rooms WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id ORDER BY hotel_room_id,id FOR UPDATE;
 SELECT array_agg(hotel_room_id ORDER BY hotel_room_id) INTO room_ids FROM public.hotel_reservation_rooms WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id AND allocation_status='occupied';
 IF room_ids IS NULL OR cardinality(room_ids)<>(SELECT count(DISTINCT x) FROM unnest(room_ids) x) OR EXISTS(SELECT 1 FROM public.hotel_reservation_rooms WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id AND allocation_status='reserved') THEN RAISE EXCEPTION 'settlement_room_scope_mismatch'; END IF;
 PERFORM 1 FROM public.hotel_rooms WHERE tenant_id=p_tenant_id AND id=ANY(room_ids) ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM public.hotel_rooms WHERE tenant_id=p_tenant_id AND id=ANY(room_ids))<>cardinality(room_ids) OR EXISTS(SELECT 1 FROM public.hotel_reservation_rooms rr WHERE rr.hotel_room_id=ANY(room_ids) AND rr.allocation_status='occupied' AND (rr.tenant_id<>p_tenant_id OR rr.reservation_id<>p_reservation_id)) THEN RAISE EXCEPTION 'settlement_room_scope_mismatch'; END IF;
 -- Only this private transition admits exact checked_out/released row changes.
 UPDATE public.hotel_settlement_intents SET state='closing' WHERE id=i.id;
 FOR allocation IN SELECT * FROM public.hotel_reservation_rooms WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id AND allocation_status='occupied' ORDER BY hotel_room_id,id LOOP
  UPDATE public.hotel_reservation_rooms SET allocation_status='released',updated_at=clock_timestamp() WHERE tenant_id=p_tenant_id AND id=allocation.id;
  INSERT INTO public.hotel_housekeeping_handoffs(tenant_id,hotel_room_id,reservation_id,settlement_intent_id,source,actor_n3_user_key,state) VALUES(p_tenant_id,allocation.hotel_room_id,p_reservation_id,i.id,'settlement',p_actor,'pending') RETURNING id INTO handoff;
  SELECT out_applied INTO applied FROM public.hotelhub_hk_vacate_room_v2(p_tenant_id,allocation.hotel_room_id,p_actor,'settlement',handoff);
  IF applied IS DISTINCT FROM true THEN RAISE EXCEPTION 'settlement_housekeeping_failed'; END IF;
 END LOOP;
 UPDATE public.hotel_reservations SET status='checked_out',updated_at=clock_timestamp() WHERE tenant_id=p_tenant_id AND id=p_reservation_id;
 UPDATE public.hotel_settlement_intents SET state='closed',revision=revision+1 WHERE id=i.id;
 INSERT INTO public.hotel_settlement_events(tenant_id,reservation_id,intent_id,event,actor_n3_user_key,detail) VALUES(p_tenant_id,p_reservation_id,i.id,'closed',p_actor,jsonb_build_object('proofDigest',p_proof_digest,'roomIds',to_jsonb(room_ids)));
 INSERT INTO public.hotel_audit_events(tenant_id,n3_user_key,event_type,detail) VALUES(p_tenant_id,p_actor,'reservation_checked_out',jsonb_build_object('reservationId',p_reservation_id,'settlementIntentId',i.id,'roomIds',to_jsonb(room_ids)));
 RETURN public.hotelhub_settlement_read_intent(p_tenant_id,p_reservation_id,i.id);
END $f$;

-- Retained hotelhub_settlement_abandon body; ordinary actor guard widened only.
CREATE OR REPLACE FUNCTION public.hotelhub_settlement_abandon(p_tenant_id uuid,p_reservation_id uuid,p_actor text,p_intent_id uuid,p_revision text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE i public.hotel_settlement_intents; BEGIN
 PERFORM public.hotelhub_settlement_operator(p_tenant_id,p_actor);
 PERFORM 1 FROM public.hotel_reservations WHERE tenant_id=p_tenant_id AND id=p_reservation_id FOR UPDATE;
 SELECT * INTO i FROM public.hotel_settlement_intents WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id AND id=p_intent_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
 IF i.source_leg_id IS NOT NULL THEN RAISE EXCEPTION 'source_billing_whole_stay_required'; END IF;
 IF i.revision::text<>p_revision THEN RAISE EXCEPTION 'settlement_stale_revision'; END IF;
 IF EXISTS(SELECT 1 FROM public.hotel_settlement_attempts WHERE intent_id=i.id) THEN RAISE EXCEPTION 'settlement_dispatched'; END IF;
 IF i.state<>'frozen' THEN RAISE EXCEPTION 'settlement_invalid_state'; END IF;
 UPDATE public.hotel_settlement_intents SET state='abandoned',revision=revision+1 WHERE id=i.id;
 INSERT INTO public.hotel_settlement_events(tenant_id,reservation_id,intent_id,event,actor_n3_user_key) VALUES(p_tenant_id,p_reservation_id,i.id,'abandoned',p_actor);
 RETURN jsonb_build_object('id',i.id,'tenantId',i.tenant_id,'reservationId',i.reservation_id,'revision',(i.revision+1)::text,'state','abandoned','snapshot',i.snapshot,'dispatches','[]'::jsonb);
END $f$;

-- Retained hh_source_document_number_reserve body; ordinary actor guard widened only.
CREATE OR REPLACE FUNCTION public.hh_source_document_number_reserve(p_tenant uuid,p_reservation uuid,p_actor text,p_series text,p_operation uuid,p_document_date date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved public.hotel_source_document_numbers;n integer;period_key text;prefix text;zone text;today date;
BEGIN
 IF p_series='refund' THEN PERFORM public.hotelhub_settlement_owner(p_tenant,p_actor);
 ELSE PERFORM public.hotelhub_settlement_operator(p_tenant,p_actor); END IF;
 IF p_series IS NULL OR p_series NOT IN ('bill','receipt','refund') OR p_operation IS NULL OR p_document_date IS NULL OR p_document_date<DATE '2000-01-01' OR p_document_date>=DATE '2100-01-01' THEN RAISE EXCEPTION 'source_document_date_invalid'; END IF;
 -- Reservation parent serializes same-operation replay and cannot cross tenant.
 PERFORM 1 FROM public.hotel_reservations WHERE tenant_id=p_tenant AND id=p_reservation FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'source_document_number_scope_mismatch'; END IF;
 SELECT * INTO saved FROM public.hotel_source_document_numbers WHERE tenant_id=p_tenant AND series=p_series AND operation_id=p_operation;
 IF FOUND THEN
  IF saved.reservation_id<>p_reservation OR saved.document_date<>p_document_date THEN RAISE EXCEPTION 'source_document_number_scope_mismatch'; END IF;
 ELSE
  SELECT timezone INTO zone FROM public.hotel_settings WHERE tenant_id=p_tenant;
  IF zone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone) THEN RAISE EXCEPTION 'source_document_date_invalid'; END IF;
  today:=(clock_timestamp() AT TIME ZONE zone)::date;
  IF p_document_date<>today THEN RAISE EXCEPTION 'source_document_date_invalid'; END IF;
  period_key:=to_char(p_document_date,'YYMM');
  INSERT INTO public.hotel_source_document_counters(tenant_id,series,period,last_number) VALUES(p_tenant,p_series,period_key,1)
   ON CONFLICT(tenant_id,series,period) DO UPDATE SET last_number=public.hotel_source_document_counters.last_number+1
    WHERE public.hotel_source_document_counters.last_number<99999 RETURNING last_number INTO n;
  IF n IS NULL THEN RAISE EXCEPTION 'source_document_number_overflow'; END IF;
  prefix:=CASE p_series WHEN 'bill' THEN 'SI' WHEN 'receipt' THEN 'OR' ELSE 'RF' END;
  INSERT INTO public.hotel_source_document_numbers(tenant_id,reservation_id,series,operation_id,document_date,hh_number,actor)
   VALUES(p_tenant,p_reservation,p_series,p_operation,p_document_date,prefix||period_key||lpad(n::text,5,'0'),p_actor) RETURNING * INTO saved;
 END IF;
 RETURN jsonb_build_object('tenantId',saved.tenant_id,'reservationId',saved.reservation_id,'series',saved.series,'operationId',saved.operation_id,'documentDate',saved.document_date,'hhNumber',saved.hh_number);
END $$;

-- Retained hh_source_billing_freeze body; ordinary actor guard widened only.
CREATE OR REPLACE FUNCTION public.hh_source_billing_freeze(p_tenant_id uuid,p_reservation_id uuid,p_actor text,p_plan jsonb,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.hotel_reservations; f public.hotel_folios; p public.hotel_source_billing_plans;
 payer public.hotel_reservation_payers; leg jsonb; snap jsonb; line jsonb; all_lines jsonb:='[]'; guest_receipts jsonb:='[]';
 v_id uuid; v_kind text; number jsonb; sources jsonb; guest_count integer:=0; source_count integer:=0;
 total bigint:=0; line_count integer:=0; active_ids uuid[];
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
 SELECT coalesce(array_agg(id),ARRAY[]::uuid[]) INTO active_ids FROM public.hh_source_billing_active_lines(p_tenant_id,f.id);
 FOR leg IN SELECT value FROM jsonb_array_elements(p_plan->'legs') LOOP
  snap:=leg->'snapshot';v_kind:=leg->>'kind';
  IF jsonb_typeof(leg) IS DISTINCT FROM 'object' OR leg-ARRAY['legId','kind','customerId','collectionMode','documentTitle','itemDescription','showPrices','snapshot']<>'{}'
   OR coalesce(leg->>'legId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
   OR v_kind NOT IN ('source_room','guest') OR v_kind IS NULL OR jsonb_typeof(snap) IS DISTINCT FROM 'object'
   OR snap->>'tenantId' IS DISTINCT FROM p_tenant_id::text OR snap->>'reservationId' IS DISTINCT FROM p_reservation_id::text
   OR snap->>'folioId' IS DISTINCT FROM f.id::text OR snap->>'currency' IS DISTINCT FROM r.currency
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
 IF guest_count>1 OR source_count>1 OR (payer.collection_mode='guest' AND (guest_count<>1 OR source_count<>0))
  OR (payer.collection_mode='source' AND source_count<>1) OR total IS DISTINCT FROM (p_plan->>'totalCents')::bigint
  OR total IS DISTINCT FROM (SELECT sum(total_cents) FROM public.hotel_folio_lines WHERE tenant_id=p_tenant_id AND folio_id=f.id AND id=ANY(active_ids))
 THEN RAISE EXCEPTION 'source_billing_charge_mismatch'; END IF;
 IF NOT public.hotelhub_settlement_receipts_owned(p_tenant_id,p_reservation_id,guest_receipts)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(guest_receipts) x WHERE x->'customerId' IS DISTINCT FROM payer.policy_snapshot->'guestCustomerId' OR x->>'currency' IS DISTINCT FROM r.currency)
 THEN RAISE EXCEPTION 'settlement_scope_mismatch'; END IF;
 line_count:=jsonb_array_length(all_lines);
 IF line_count IS DISTINCT FROM (SELECT count(*) FROM public.hotel_folio_lines WHERE tenant_id=p_tenant_id AND folio_id=f.id AND id=ANY(active_ids))
  OR line_count IS DISTINCT FROM (SELECT count(DISTINCT x->>'localLineId') FROM jsonb_array_elements(all_lines) x)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(all_lines) x WHERE NOT EXISTS(
   SELECT 1 FROM public.hotel_folio_lines l WHERE l.tenant_id=p_tenant_id AND l.folio_id=f.id AND l.id=ANY(active_ids) AND l.id::text=x->>'localLineId'
    AND l.line_type::text=x->>'kind' AND l.quantity::text=x->>'qty' AND l.unit_price_cents::text=x->>'unitCents'
    AND l.subtotal_cents::text=x->>'subtotalCents' AND l.tax_cents::text=x->>'taxCents' AND l.total_cents::text=x->>'totalCents'
    AND l.description_snapshot=x->>'description' AND l.n3_stock_id_snapshot=x->>'stockId' AND l.n3_uom_id_snapshot=x->>'uomId' AND l.n3_tax_code_id_snapshot=x->>'taxCodeId'))
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

-- Retained hh_source_billing_leg_claim body; ordinary actor guard widened only.
CREATE OR REPLACE FUNCTION public.hh_source_billing_leg_claim(p_tenant_id uuid,p_reservation_id uuid,p_actor text,p_leg_id uuid,p_plan_digest text,p_intent_id uuid,p_revision text,p_step text,p_receipt_id uuid,p_payload_digest text,p_dispatch_facts jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM public.hotelhub_settlement_operator(p_tenant_id,p_actor);
 PERFORM 1 FROM public.hotel_reservations WHERE tenant_id=p_tenant_id AND id=p_reservation_id FOR UPDATE;
 PERFORM public.hh_source_billing_leg_bind(p_tenant_id,p_reservation_id,p_leg_id,p_plan_digest,p_intent_id);
 RETURN public.hotelhub_settlement_claim(p_tenant_id,p_reservation_id,p_actor,p_intent_id,p_revision,p_step,p_receipt_id,p_payload_digest,p_dispatch_facts);
END $$;

-- Retained hh_source_billing_leg_outcome body; ordinary actor guard widened only.
CREATE OR REPLACE FUNCTION public.hh_source_billing_leg_outcome(p_tenant_id uuid,p_reservation_id uuid,p_actor text,p_leg_id uuid,p_plan_digest text,p_intent_id uuid,p_revision text,p_attempt_id uuid,p_payload_digest text,p_outcome jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM public.hotelhub_settlement_operator(p_tenant_id,p_actor);
 PERFORM 1 FROM public.hotel_reservations WHERE tenant_id=p_tenant_id AND id=p_reservation_id FOR UPDATE;
 PERFORM public.hh_source_billing_leg_bind(p_tenant_id,p_reservation_id,p_leg_id,p_plan_digest,p_intent_id);
 PERFORM public.hotelhub_settlement_outcome(p_tenant_id,p_reservation_id,p_actor,p_intent_id,p_revision,p_attempt_id,p_payload_digest,p_outcome);
 RETURN public.hh_source_billing_leg_result(p_tenant_id,p_reservation_id,p_leg_id);
END $$;

-- Retained hh_source_billing_leg_prove body; ordinary actor guard widened only.
CREATE OR REPLACE FUNCTION public.hh_source_billing_leg_prove(p_tenant_id uuid,p_reservation_id uuid,p_actor text,p_leg_id uuid,p_plan_digest text,p_intent_id uuid,p_revision text,p_proof jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM public.hotelhub_settlement_operator(p_tenant_id,p_actor);
 PERFORM 1 FROM public.hotel_reservations WHERE tenant_id=p_tenant_id AND id=p_reservation_id FOR UPDATE;
 PERFORM public.hh_source_billing_leg_bind(p_tenant_id,p_reservation_id,p_leg_id,p_plan_digest,p_intent_id);
 IF (SELECT kind FROM public.hotel_source_billing_legs WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id AND leg_id=p_leg_id)='source_room' AND p_proof->>'kind'<>'bill' THEN RAISE EXCEPTION 'source_billing_guest_action_required'; END IF;
 PERFORM public.hotelhub_settlement_prove(p_tenant_id,p_reservation_id,p_actor,p_intent_id,p_revision,p_proof);
 RETURN public.hh_source_billing_leg_result(p_tenant_id,p_reservation_id,p_leg_id);
END $$;

COMMIT;
