-- Additive staff receipt authority. Candidate only; not applied to Lovable.
-- Owner approval/settings and legacy/manual generations remain unchanged.
BEGIN;

CREATE TABLE public.hotel_receipt_applied_events (
 tenant_id uuid NOT NULL REFERENCES public.hotel_tenants(id), revision bigint NOT NULL CHECK(revision>0),
 request_id uuid NOT NULL, requester text NOT NULL, booking_reference text NOT NULL,
 doc_code text NOT NULL, currency text NOT NULL, before_cents bigint NOT NULL, after_cents bigint NOT NULL,
 PRIMARY KEY(tenant_id,revision), UNIQUE(tenant_id,request_id),
 FOREIGN KEY(tenant_id,request_id) REFERENCES public.hotel_receipt_control_requests(tenant_id,id)
);
CREATE INDEX hotel_receipt_applied_events_requester ON public.hotel_receipt_applied_events(tenant_id,requester,revision);
ALTER TABLE public.hotel_receipt_applied_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hotel_receipt_applied_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.hotel_receipt_applied_events TO service_role;
CREATE FUNCTION public.hotelhub_receipt_applied_event_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'receipt_control_immutable'; END $$;
CREATE TRIGGER hotel_receipt_applied_event_immutable BEFORE UPDATE OR DELETE ON public.hotel_receipt_applied_events
FOR EACH ROW EXECUTE FUNCTION public.hotelhub_receipt_applied_event_immutable();
REVOKE ALL ON FUNCTION public.hotelhub_receipt_applied_event_immutable() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.hotelhub_receipt_control_v2_authorize(p_tenant_id uuid,p_actor text,p_role text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.hotel_receipt_control_requests; p public.hotel_change_control_policies; v_kind text:=p_data->>'kind'; approval boolean; previous_state text;
BEGIN
 IF p_role IS NULL OR p_role NOT IN ('owner','front_desk') OR nullif(p_actor,'') IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
 SELECT * INTO v FROM public.hotel_receipt_control_requests WHERE tenant_id=p_tenant_id AND id=(p_data->>'requestId')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
 IF p_role='front_desk' AND (v.requested_by_n3_user_key IS DISTINCT FROM p_actor OR v_kind IS DISTINCT FROM 'direct_policy' OR (v.automation_meta->>'authorizedBy' IS NOT NULL AND v.automation_meta->>'authorizedBy' IS DISTINCT FROM p_actor)) THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF v.generation<>2 THEN RAISE EXCEPTION 'automation_unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM public.hotel_receipt_edit_attempts WHERE tenant_id=p_tenant_id AND request_id=v.id AND (phase<>'rejected' OR coalesce(v_kind,'')<>'reject')) THEN RAISE EXCEPTION 'claim_conflict'; END IF;
 IF v.version IS DISTINCT FROM (p_data->>'expectedVersion')::integer THEN RAISE EXCEPTION 'version_conflict'; END IF;
 SELECT * INTO p FROM public.hotel_change_control_policies WHERE tenant_id=p_tenant_id FOR UPDATE;
 IF NOT FOUND OR p.revision::text IS DISTINCT FROM p_data->>'policyRevision' THEN RAISE EXCEPTION 'version_conflict'; END IF;
 previous_state:=v.state;
 IF v_kind='reject' THEN
  IF v.state NOT IN ('pending','needs_review','approved_awaiting_n3') THEN RAISE EXCEPTION 'invalid_transition'; END IF;
  UPDATE public.hotel_receipt_control_requests SET state='rejected',version=version+1,outcome_code='rejected' WHERE id=v.id RETURNING * INTO v;
 ELSE
  approval:=((v.automation_meta->'categories'->>'deposit')::boolean AND (p.deposit_approval_required OR coalesce((v.automation_meta->'policy'->>'depositApprovalRequired')::boolean,false))) OR ((v.automation_meta->'categories'->>'contact')::boolean AND (p.contact_approval_required OR coalesce((v.automation_meta->'policy'->>'contactApprovalRequired')::boolean,false)));
  IF coalesce(v_kind,'') NOT IN ('manual_approval','direct_policy') OR (v_kind='direct_policy' AND approval) THEN RAISE EXCEPTION 'approval_required'; END IF;
  IF v.automation_meta->>'authorizedAt' IS NOT NULL AND v_kind='manual_approval' AND v.approved_at IS NULL THEN
   IF v.state NOT IN ('pending','needs_review','approved_awaiting_n3') THEN RAISE EXCEPTION 'invalid_transition'; END IF;
   INSERT INTO public.hotel_receipt_control_decisions(tenant_id,request_id,decision,from_state,to_state,actor_n3_user_key,requester_n3_user_key,self_approved,outcome_code)
   VALUES(p_tenant_id,v.id,'approve',v.state,'approved_awaiting_n3',p_actor,v.requested_by_n3_user_key,p_actor=v.requested_by_n3_user_key,'policy_tightening_approved');
   UPDATE public.hotel_receipt_control_requests SET approved_at=now(),approved_by_n3_user_key=p_actor,decided_at=now(),decided_by_n3_user_key=p_actor,state='approved_awaiting_n3',version=version+1,outcome_code='policy_tightening_approved' WHERE id=v.id RETURNING * INTO v;
   PERFORM public.hotelhub_change_revision_bump(p_tenant_id); RETURN to_jsonb(v);
  END IF;
  IF v.automation_meta->>'authorizedAt' IS NOT NULL THEN
   IF v.state='approved_awaiting_n3' THEN RETURN to_jsonb(v); END IF;
   IF v.state<>'needs_review' THEN RAISE EXCEPTION 'invalid_transition'; END IF;
   -- No attempt exists (checked above). Restore only pre-dispatch holds;
   -- immutable authorization/approval history remains exactly as recorded.
   UPDATE public.hotel_receipt_control_requests SET state='approved_awaiting_n3',version=version+1,outcome_code='pre_dispatch_retry_authorized' WHERE id=v.id RETURNING * INTO v;
   INSERT INTO public.hotel_receipt_control_decisions(tenant_id,request_id,decision,from_state,to_state,actor_n3_user_key,requester_n3_user_key,self_approved,outcome_code)
   VALUES(p_tenant_id,v.id,CASE WHEN v_kind='manual_approval' THEN 'approve' ELSE 'apply' END,previous_state,v.state,p_actor,v.requested_by_n3_user_key,v_kind='manual_approval' AND p_actor=v.requested_by_n3_user_key,v.outcome_code);
   PERFORM public.hotelhub_change_revision_bump(p_tenant_id); RETURN to_jsonb(v);
  END IF;
  IF v.state NOT IN ('pending','needs_review') THEN RAISE EXCEPTION 'invalid_transition'; END IF;
  UPDATE public.hotel_receipt_control_requests SET state='approved_awaiting_n3',version=version+1,
   approved_at=CASE WHEN v_kind='manual_approval' THEN now() ELSE NULL END,
   approved_by_n3_user_key=CASE WHEN v_kind='manual_approval' THEN p_actor ELSE NULL END,
   decided_at=now(),decided_by_n3_user_key=p_actor,
   automation_meta=automation_meta || jsonb_build_object('authorizationKind',v_kind,'authorizedBy',p_actor,'authorizedAt',now()::text),outcome_code='authorized'
  WHERE id=v.id RETURNING * INTO v;
 END IF;
 INSERT INTO public.hotel_receipt_control_decisions(tenant_id,request_id,decision,from_state,to_state,actor_n3_user_key,requester_n3_user_key,self_approved,outcome_code)
 VALUES(p_tenant_id,v.id,CASE WHEN v_kind='reject' THEN 'reject' WHEN v_kind='manual_approval' THEN 'approve' ELSE 'apply' END,previous_state,v.state,p_actor,v.requested_by_n3_user_key,v_kind='manual_approval' AND p_actor=v.requested_by_n3_user_key,v.outcome_code);
 PERFORM public.hotelhub_change_revision_bump(p_tenant_id); RETURN to_jsonb(v);
END $$;

CREATE OR REPLACE FUNCTION public.hotelhub_receipt_control_v2_reserve(p_tenant_id uuid,p_actor text,p_role text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.hotel_receipt_control_requests; p public.hotel_change_control_policies; a public.hotel_receipt_edit_attempts;
BEGIN
 IF p_role IS NULL OR p_role NOT IN ('owner','front_desk') OR nullif(p_actor,'') IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
 SELECT * INTO v FROM public.hotel_receipt_control_requests WHERE tenant_id=p_tenant_id AND id=(p_data->>'requestId')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
 IF p_role='front_desk' AND v.requested_by_n3_user_key IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF p_role='front_desk' AND (v.automation_meta->>'authorizationKind' IS DISTINCT FROM 'direct_policy' OR v.automation_meta->>'authorizedBy' IS DISTINCT FROM p_actor OR v.approved_at IS NOT NULL) THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF v.generation<>2 THEN RAISE EXCEPTION 'automation_unavailable'; END IF;
 SELECT * INTO a FROM public.hotel_receipt_edit_attempts WHERE tenant_id=p_tenant_id AND request_id=v.id;
 IF FOUND THEN RETURN jsonb_build_object('attempt',to_jsonb(a),'dispatchGranted',false); END IF;
 IF v.version IS DISTINCT FROM (p_data->>'expectedVersion')::integer THEN RAISE EXCEPTION 'version_conflict'; END IF;
 IF v.state<>'approved_awaiting_n3' OR v.automation_meta->>'authorizedAt' IS NULL THEN RAISE EXCEPTION 'not_approved'; END IF;
 SELECT * INTO p FROM public.hotel_change_control_policies WHERE tenant_id=p_tenant_id FOR UPDATE;
 IF NOT FOUND OR p.revision::text IS DISTINCT FROM p_data->>'policyRevision' THEN RAISE EXCEPTION 'version_conflict'; END IF;
 IF v.automation_meta->>'authorizationKind'='direct_policy' AND v.approved_at IS NULL AND (((v.automation_meta->'categories'->>'deposit')::boolean AND (p.deposit_approval_required OR coalesce((v.automation_meta->'policy'->>'depositApprovalRequired')::boolean,false))) OR ((v.automation_meta->'categories'->>'contact')::boolean AND (p.contact_approval_required OR coalesce((v.automation_meta->'policy'->>'contactApprovalRequired')::boolean,false)))) THEN RAISE EXCEPTION 'approval_required'; END IF;
 UPDATE public.hotel_receipt_control_requests SET state='applying',version=version+1,outcome_code='dispatch_reserved' WHERE id=v.id RETURNING * INTO v;
 INSERT INTO public.hotel_receipt_edit_attempts(tenant_id,request_id,claimed_version,payload_hash,actor) VALUES(p_tenant_id,v.id,v.version,p_data->>'payloadHash',p_actor) RETURNING * INTO a;
 PERFORM public.hotelhub_change_revision_bump(p_tenant_id);
 RETURN jsonb_build_object('attempt',to_jsonb(a),'dispatchGranted',true);
END $$;

CREATE OR REPLACE FUNCTION public.hotelhub_receipt_control_v2_hold(p_tenant_id uuid,p_actor text,p_role text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.hotel_receipt_control_requests;
BEGIN
 IF p_role IS NULL OR p_role NOT IN ('owner','front_desk') OR nullif(p_actor,'') IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
 SELECT * INTO v FROM public.hotel_receipt_control_requests WHERE tenant_id=p_tenant_id AND id=(p_data->>'requestId')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
 IF p_role='front_desk' AND v.requested_by_n3_user_key IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF v.generation<>2 OR v.version IS DISTINCT FROM (p_data->>'expectedVersion')::integer THEN RAISE EXCEPTION 'version_conflict'; END IF;
 IF EXISTS(SELECT 1 FROM public.hotel_receipt_edit_attempts WHERE tenant_id=p_tenant_id AND request_id=v.id) THEN RAISE EXCEPTION 'claim_conflict'; END IF;
 IF v.state NOT IN ('pending','approved_awaiting_n3','needs_review') THEN RAISE EXCEPTION 'invalid_transition'; END IF;
 UPDATE public.hotel_receipt_control_requests SET state='needs_review',version=version+1,outcome_code=p_data->>'code' WHERE id=v.id RETURNING * INTO v;
 PERFORM public.hotelhub_change_revision_bump(p_tenant_id); RETURN to_jsonb(v);
END $$;

CREATE OR REPLACE FUNCTION public.hotelhub_receipt_control_v2_settle(p_tenant_id uuid,p_actor text,p_role text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.hotel_receipt_control_requests; a public.hotel_receipt_edit_attempts; result jsonb:=p_data->'result'; proof jsonb:=result->'version'; n integer;
BEGIN
 IF p_role IS NULL OR p_role NOT IN ('owner','front_desk') OR nullif(p_actor,'') IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
 SELECT * INTO v FROM public.hotel_receipt_control_requests WHERE tenant_id=p_tenant_id AND id=(p_data->>'requestId')::uuid FOR UPDATE;
 IF NOT FOUND OR v.generation<>2 THEN RAISE EXCEPTION 'request_not_found'; END IF;
 IF p_role='front_desk' AND v.requested_by_n3_user_key IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'forbidden'; END IF;
 SELECT * INTO a FROM public.hotel_receipt_edit_attempts WHERE tenant_id=p_tenant_id AND request_id=v.id AND id=(p_data->>'attemptId')::uuid FOR UPDATE;
 IF NOT FOUND OR a.claimed_version IS DISTINCT FROM (p_data->>'claimedVersion')::integer THEN RAISE EXCEPTION 'claim_stale'; END IF;
 IF a.phase='confirmed' AND v.state='applied' THEN RETURN to_jsonb(v); END IF;
 IF a.phase='rejected' OR v.version IS DISTINCT FROM (p_data->>'expectedVersion')::integer OR v.state NOT IN ('applying','needs_review') THEN RAISE EXCEPTION 'claim_stale'; END IF;
 IF result->>'kind'='verified' THEN
  IF proof->>'state' IS DISTINCT FROM 'active' OR proof->>'receiptId' IS DISTINCT FROM v.original->>'receiptId' OR proof->>'docCode' IS DISTINCT FROM v.original->>'docCode' OR proof->>'documentDate' IS DISTINCT FROM v.original->>'documentDate' OR proof->>'currency' IS DISTINCT FROM v.original->>'currency' OR (proof->>'amountCents')::bigint IS DISTINCT FROM v.proposed_amount_cents OR result->'contact' IS DISTINCT FROM v.proposal->'contact' OR nullif(proof->>'fingerprint','') IS NULL OR jsonb_array_length(proof->'paymentLines')<>1 OR lower(proof->'paymentLines'->0->>'accountId') IS DISTINCT FROM lower(v.proposal->>'accountId') OR (proof->'paymentLines'->0->>'amountCents')::bigint IS DISTINCT FROM v.proposed_amount_cents OR proof->>'replacementOf' IS NOT NULL THEN RAISE EXCEPTION 'invalid_proof'; END IF;
  SELECT coalesce(max(version_no),0)+1 INTO n FROM public.hotel_receipt_versions WHERE tenant_id=p_tenant_id AND deposit_id=v.deposit_id;
  INSERT INTO public.hotel_receipt_versions(tenant_id,deposit_id,request_id,version_no,state,receipt_id,doc_code,document_date,currency,amount_cents,payment_lines,replacement_of,evidence_fingerprint,verified_by_n3_user_key,verified_contact)
  VALUES(p_tenant_id,v.deposit_id,v.id,n,'active',proof->>'receiptId',proof->>'docCode',proof->>'documentDate',proof->>'currency',(proof->>'amountCents')::bigint,proof->'paymentLines',NULL,proof->>'fingerprint',p_actor,result->'contact');
  UPDATE public.hotel_receipt_edit_attempts SET phase='confirmed',code='verified',settled_at=now() WHERE id=a.id;
  UPDATE public.hotel_receipt_control_requests SET state='applied',version=version+1,outcome_code='verified' WHERE id=v.id RETURNING * INTO v;
 ELSIF result->>'kind' IN ('unknown','rejected_no_write') THEN
  UPDATE public.hotel_receipt_edit_attempts SET phase=CASE WHEN result->>'kind'='unknown' THEN 'unknown' ELSE 'rejected' END,code=result->>'code',settled_at=now() WHERE id=a.id;
  UPDATE public.hotel_receipt_control_requests SET state='needs_review',version=version+1,outcome_code=result->>'code' WHERE id=v.id RETURNING * INTO v;
 ELSE RAISE EXCEPTION 'invalid_transition'; END IF;
 INSERT INTO public.hotel_audit_events(tenant_id,n3_user_key,event_type,detail) VALUES(p_tenant_id,p_actor,'hotel.receipt_control.result',jsonb_build_object('requestId',v.id,'attemptId',a.id,'outcome',v.outcome_code));
 PERFORM public.hotelhub_change_revision_bump(p_tenant_id);
 IF v.state='applied' THEN
  INSERT INTO public.hotel_receipt_applied_events(tenant_id,revision,request_id,requester,booking_reference,doc_code,currency,before_cents,after_cents)
  SELECT p_tenant_id,r.revision,v.id,v.requested_by_n3_user_key,b.booking_reference,v.original->>'docCode',v.original->>'currency',v.original_amount_cents,v.proposed_amount_cents
  FROM public.hotel_change_revisions r JOIN public.hotel_reservations b ON b.tenant_id=r.tenant_id AND b.id=v.reservation_id
  WHERE r.tenant_id=p_tenant_id;
 END IF;
 RETURN to_jsonb(v);
END $$;

-- One scoped, snapshot-bounded read. NULL cursor baselines without historical alerts.
CREATE FUNCTION public.hotelhub_receipt_applied_events_read(p_tenant_id uuid,p_actor text,p_role text,p_after text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE rev bigint; next_cursor bigint; events jsonb; has_more boolean;
BEGIN
 IF p_role IS NULL OR p_role NOT IN ('owner','front_desk') OR nullif(p_actor,'') IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF p_after IS NOT NULL AND (p_after !~ '^(0|[1-9][0-9]{0,18})$' OR p_after::numeric>9223372036854775807) THEN RAISE EXCEPTION 'invalid_body'; END IF;
 SELECT coalesce((SELECT revision FROM public.hotel_change_revisions WHERE tenant_id=p_tenant_id),0) INTO rev;
 IF p_after IS NULL THEN RETURN jsonb_build_object('cursor',rev::text,'events','[]'::jsonb); END IF;
 IF p_after::bigint>rev THEN RAISE EXCEPTION 'version_conflict'; END IF;
 SELECT count(*)>100 INTO has_more FROM (SELECT 1 FROM public.hotel_receipt_applied_events WHERE tenant_id=p_tenant_id AND requester=p_actor AND revision>p_after::bigint AND revision<=rev LIMIT 101) q;
 SELECT coalesce(jsonb_agg(jsonb_build_object('revision',e.revision::text,'requestId',e.request_id,'bookingReference',e.booking_reference,'docCode',e.doc_code,'currency',e.currency,'beforeCents',e.before_cents,'afterCents',e.after_cents) ORDER BY e.revision),'[]'::jsonb),max(e.revision)
 INTO events,next_cursor FROM (SELECT * FROM public.hotel_receipt_applied_events WHERE tenant_id=p_tenant_id AND requester=p_actor AND revision>p_after::bigint AND revision<=rev ORDER BY revision LIMIT 100) e;
 RETURN jsonb_build_object('cursor',(CASE WHEN has_more THEN next_cursor ELSE rev END)::text,'events',events);
END $$;
REVOKE ALL ON FUNCTION public.hotelhub_receipt_applied_events_read(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hotelhub_receipt_applied_events_read(uuid,text,text,text) TO service_role;

COMMIT;
