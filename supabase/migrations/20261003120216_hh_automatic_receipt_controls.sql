-- REVIEW CANDIDATE ONLY. Never applied by Git sync. Automatic Update stays OFF.
-- Additive generation-2 amount/contact controls; old manual requests are immutable.
CREATE TABLE public.hotel_change_control_policies (
 tenant_id uuid PRIMARY KEY REFERENCES public.hotel_tenants(id),
 deposit_approval_required boolean NOT NULL DEFAULT true,
 contact_approval_required boolean NOT NULL DEFAULT false,
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 updated_by text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.hotel_change_revisions (
 tenant_id uuid PRIMARY KEY REFERENCES public.hotel_tenants(id),
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0)
);
ALTER TABLE public.hotel_receipt_control_requests
 ADD COLUMN generation integer NOT NULL DEFAULT 1 CHECK(generation IN (1,2)),
 ADD COLUMN automation_meta jsonb,
 ADD CONSTRAINT hotel_receipt_control_generation_meta CHECK((generation=1 AND automation_meta IS NULL) OR (generation=2 AND execution_mode='direct' AND kind='correction' AND automation_meta IS NOT NULL));
ALTER TABLE public.hotel_receipt_versions ADD COLUMN verified_contact jsonb;
ALTER TABLE public.hotel_folio_bill_to ADD COLUMN effective_revision bigint NOT NULL DEFAULT 0 CHECK(effective_revision>=0);
ALTER TABLE public.hotel_receipt_control_decisions DROP CONSTRAINT hotel_receipt_control_decisions_decision_check;
ALTER TABLE public.hotel_receipt_control_decisions ADD CONSTRAINT hotel_receipt_control_decisions_decision_check CHECK(decision IN ('approve','reject','hold','verify','recover','apply'));

CREATE TABLE public.hotel_receipt_edit_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
 request_id uuid NOT NULL, claimed_version integer NOT NULL,
 payload_hash text NOT NULL CHECK(length(payload_hash) BETWEEN 16 AND 128),
 phase text NOT NULL DEFAULT 'reserved' CHECK(phase IN ('reserved','confirmed','rejected','unknown')),
 actor text NOT NULL, code text, created_at timestamptz NOT NULL DEFAULT now(), settled_at timestamptz,
 UNIQUE(tenant_id,request_id), UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,request_id) REFERENCES public.hotel_receipt_control_requests(tenant_id,id)
);
CREATE TABLE public.hotel_bill_to_change_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,
 reservation_id uuid NOT NULL, client_request_id uuid NOT NULL, original jsonb NOT NULL,
 requested jsonb NOT NULL, original_revision bigint NOT NULL, reason text NOT NULL
 CHECK(public.hotelhub_utf16_length(reason) BETWEEN 1 AND 500),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','applied','rejected','needs_review')),
 version integer NOT NULL DEFAULT 1, requested_by text NOT NULL,requested_at timestamptz NOT NULL DEFAULT now(),
 decided_by text,decided_at timestamptz,
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,client_request_id),
 FOREIGN KEY(tenant_id,reservation_id) REFERENCES public.hotel_reservations(tenant_id,id)
);
CREATE UNIQUE INDEX hotel_bill_to_one_active ON public.hotel_bill_to_change_requests(tenant_id,reservation_id) WHERE state IN ('pending','needs_review');
CREATE INDEX hotel_bill_to_queue ON public.hotel_bill_to_change_requests(tenant_id,state,requested_at DESC,id);

CREATE FUNCTION public.hotelhub_change_revision_bump(p_tenant uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 INSERT INTO public.hotel_change_revisions(tenant_id,revision) VALUES(p_tenant,1)
 ON CONFLICT(tenant_id) DO UPDATE SET revision=public.hotel_change_revisions.revision+1
$$;
CREATE FUNCTION public.hotelhub_change_policy_set(p_tenant_id uuid,p_actor text,p_role text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.hotel_change_control_policies;
BEGIN
 IF p_role IS DISTINCT FROM 'owner' OR nullif(p_actor,'') IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF jsonb_typeof(p_data->'depositApprovalRequired') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_data->'contactApprovalRequired') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'invalid_policy'; END IF;
 INSERT INTO public.hotel_change_control_policies(tenant_id) VALUES(p_tenant_id) ON CONFLICT DO NOTHING;
 SELECT * INTO p FROM public.hotel_change_control_policies WHERE tenant_id=p_tenant_id FOR UPDATE;
 IF p.revision::text IS DISTINCT FROM p_data->>'expectedRevision' THEN RAISE EXCEPTION 'version_conflict'; END IF;
 UPDATE public.hotel_change_control_policies SET deposit_approval_required=(p_data->>'depositApprovalRequired')::boolean,
 contact_approval_required=(p_data->>'contactApprovalRequired')::boolean,revision=revision+1,updated_by=p_actor,updated_at=now()
 WHERE tenant_id=p_tenant_id RETURNING * INTO p;
 INSERT INTO public.hotel_audit_events(tenant_id,n3_user_key,event_type,detail) VALUES(p_tenant_id,p_actor,'hotel.change_policy.updated',jsonb_build_object('revision',p.revision::text));
 PERFORM public.hotelhub_change_revision_bump(p_tenant_id);
 RETURN jsonb_build_object('revision',p.revision::text,'depositApprovalRequired',p.deposit_approval_required,'contactApprovalRequired',p.contact_approval_required);
END $$;

-- Preserve the existing immutable guard and add metadata immutability separately.
CREATE FUNCTION public.hotelhub_receipt_v2_metadata_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.generation<>OLD.generation THEN RAISE EXCEPTION 'receipt_control_immutable'; END IF;
 IF OLD.generation=2 THEN
  IF (NEW.automation_meta-'authorizationKind'-'authorizedBy'-'authorizedAt') IS DISTINCT FROM (OLD.automation_meta-'authorizationKind'-'authorizedBy'-'authorizedAt')
   OR (OLD.automation_meta->>'authorizedAt' IS NOT NULL AND NEW.automation_meta IS DISTINCT FROM OLD.automation_meta)
   THEN RAISE EXCEPTION 'receipt_control_immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hotel_receipt_v2_metadata_guard BEFORE UPDATE ON public.hotel_receipt_control_requests FOR EACH ROW EXECUTE FUNCTION public.hotelhub_receipt_v2_metadata_guard();
-- Add a generation fence to the actual installed legacy function bodies.
-- Applied baseline SQL remains byte-identical; this additive migration changes runtime only.
DO $$ DECLARE f record; definition text; modified text; BEGIN
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('hotelhub_receipt_control_decide','hotelhub_receipt_control_claim','hotelhub_receipt_control_complete','hotelhub_receipt_control_verify_atomic','hotelhub_receipt_control_recover') LOOP
  definition:=pg_get_functiondef(f.oid);
  modified:=regexp_replace(definition,E'BEGIN\\s*',E'BEGIN\n IF EXISTS (SELECT 1 FROM public.hotel_receipt_control_requests WHERE tenant_id=p_tenant_id AND id=p_request_id AND generation<>1) THEN RAISE EXCEPTION ''automation_unavailable''; END IF;\n');
  IF modified=definition THEN RAISE EXCEPTION 'legacy_fence_install_failed'; END IF;
  EXECUTE modified;
 END LOOP;
END $$;

CREATE FUNCTION public.hotelhub_receipt_control_v2_create(p_tenant_id uuid,p_actor text,p_role text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.hotel_change_control_policies; v public.hotel_receipt_control_requests; meta jsonb; cat jsonb;
BEGIN
 IF p_role NOT IN ('owner','front_desk') OR p_role IS NULL OR nullif(p_actor,'') IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
 SELECT * INTO v FROM public.hotel_receipt_control_requests WHERE tenant_id=p_tenant_id AND client_request_id=(p_data->>'clientRequestId')::uuid;
 IF FOUND THEN
  IF v.generation<>2 OR v.request_fingerprint IS DISTINCT FROM p_data->>'fingerprint' OR v.requested_by_n3_user_key IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'receipt_control_key_conflict'; END IF;
  RETURN to_jsonb(v);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.hotel_reservation_deposits WHERE tenant_id=p_tenant_id AND id=(p_data->>'depositId')::uuid AND reservation_id=(p_data->>'reservationId')::uuid AND status='posted') THEN RAISE EXCEPTION 'deposit_not_found'; END IF;
 IF p_data->'proposal'->>'kind' IS DISTINCT FROM 'correction' THEN RAISE EXCEPTION 'automation_unavailable'; END IF;
 INSERT INTO public.hotel_change_control_policies(tenant_id) VALUES(p_tenant_id) ON CONFLICT DO NOTHING;
 SELECT * INTO p FROM public.hotel_change_control_policies WHERE tenant_id=p_tenant_id FOR UPDATE;
 IF p.revision::text IS DISTINCT FROM p_data->>'policyRevision' THEN RAISE EXCEPTION 'version_conflict'; END IF;
 cat:=jsonb_build_object('deposit',(p_data->'original'->'amountCents') IS DISTINCT FROM (p_data->'proposal'->'amountCents') OR lower(p_data->'original'->'paymentLines'->0->>'accountId') IS DISTINCT FROM lower(p_data->'proposal'->>'accountId'),'contact',(p_data->'original'->'contact') IS DISTINCT FROM (p_data->'proposal'->'contact'));
 IF cat='{"deposit":false,"contact":false}'::jsonb THEN RAISE EXCEPTION 'no_change'; END IF;
 meta:=jsonb_build_object('generation',2,'policy',jsonb_build_object('revision',p.revision::text,'depositApprovalRequired',p.deposit_approval_required,'contactApprovalRequired',p.contact_approval_required),'categories',cat,'authorizationKind',NULL,'authorizedBy',NULL,'authorizedAt',NULL);
 INSERT INTO public.hotel_receipt_control_requests(tenant_id,reservation_id,deposit_id,client_request_id,request_fingerprint,kind,reason,original,proposal,comparison,original_amount_cents,proposed_amount_cents,requested_by_n3_user_key,execution_mode,generation,automation_meta)
 VALUES(p_tenant_id,(p_data->>'reservationId')::uuid,(p_data->>'depositId')::uuid,(p_data->>'clientRequestId')::uuid,p_data->>'fingerprint','correction',p_data->>'reason',p_data->'original',p_data->'proposal',p_data->'comparison',(p_data->'original'->>'amountCents')::bigint,(p_data->'proposal'->>'amountCents')::bigint,p_actor,'direct',2,meta) RETURNING * INTO v;
 INSERT INTO public.hotel_audit_events(tenant_id,n3_user_key,event_type,detail) VALUES(p_tenant_id,p_actor,'hotel.receipt_control.requested',jsonb_build_object('requestId',v.id,'generation',2));
 PERFORM public.hotelhub_change_revision_bump(p_tenant_id); RETURN to_jsonb(v);
END $$;

CREATE FUNCTION public.hotelhub_receipt_control_v2_authorize(p_tenant_id uuid,p_actor text,p_role text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.hotel_receipt_control_requests; p public.hotel_change_control_policies; v_kind text:=p_data->>'kind'; approval boolean; previous_state text;
BEGIN
 IF p_role IS DISTINCT FROM 'owner' OR nullif(p_actor,'') IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
 SELECT * INTO v FROM public.hotel_receipt_control_requests WHERE tenant_id=p_tenant_id AND id=(p_data->>'requestId')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
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

CREATE FUNCTION public.hotelhub_receipt_control_v2_reserve(p_tenant_id uuid,p_actor text,p_role text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.hotel_receipt_control_requests; p public.hotel_change_control_policies; a public.hotel_receipt_edit_attempts;
BEGIN
 IF p_role IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'forbidden'; END IF;
 SELECT * INTO v FROM public.hotel_receipt_control_requests WHERE tenant_id=p_tenant_id AND id=(p_data->>'requestId')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
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

CREATE FUNCTION public.hotelhub_receipt_control_v2_hold(p_tenant_id uuid,p_actor text,p_role text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.hotel_receipt_control_requests;
BEGIN
 IF p_role IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'forbidden'; END IF;
 SELECT * INTO v FROM public.hotel_receipt_control_requests WHERE tenant_id=p_tenant_id AND id=(p_data->>'requestId')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
 IF v.generation<>2 OR v.version IS DISTINCT FROM (p_data->>'expectedVersion')::integer THEN RAISE EXCEPTION 'version_conflict'; END IF;
 IF EXISTS(SELECT 1 FROM public.hotel_receipt_edit_attempts WHERE tenant_id=p_tenant_id AND request_id=v.id) THEN RAISE EXCEPTION 'claim_conflict'; END IF;
 IF v.state NOT IN ('pending','approved_awaiting_n3','needs_review') THEN RAISE EXCEPTION 'invalid_transition'; END IF;
 UPDATE public.hotel_receipt_control_requests SET state='needs_review',version=version+1,outcome_code=p_data->>'code' WHERE id=v.id RETURNING * INTO v;
 PERFORM public.hotelhub_change_revision_bump(p_tenant_id); RETURN to_jsonb(v);
END $$;

CREATE FUNCTION public.hotelhub_receipt_control_v2_settle(p_tenant_id uuid,p_actor text,p_role text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.hotel_receipt_control_requests; a public.hotel_receipt_edit_attempts; result jsonb:=p_data->'result'; proof jsonb:=result->'version'; n integer;
BEGIN
 IF p_role IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'forbidden'; END IF;
 SELECT * INTO v FROM public.hotel_receipt_control_requests WHERE tenant_id=p_tenant_id AND id=(p_data->>'requestId')::uuid FOR UPDATE;
 IF NOT FOUND OR v.generation<>2 THEN RAISE EXCEPTION 'request_not_found'; END IF;
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
 PERFORM public.hotelhub_change_revision_bump(p_tenant_id); RETURN to_jsonb(v);
END $$;

-- Service-role only; browser identities remain N3/server sessions, not Supabase Auth.
DO $$ DECLARE n text; f record; BEGIN
 FOREACH n IN ARRAY ARRAY['hotel_change_control_policies','hotel_change_revisions','hotel_receipt_edit_attempts','hotel_bill_to_change_requests'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',n);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON TABLE public.%I TO service_role',n);
 END LOOP;
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('hotelhub_change_revision_bump','hotelhub_change_policy_set','hotelhub_receipt_v2_metadata_guard','hotelhub_receipt_control_v2_create','hotelhub_receipt_control_v2_authorize','hotelhub_receipt_control_v2_reserve','hotelhub_receipt_control_v2_hold','hotelhub_receipt_control_v2_settle') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END LOOP;
END $$;

CREATE FUNCTION public.hotelhub_bill_to_current(p_tenant uuid,p_res uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.hotel_folio_bill_to; g public.hotel_guests;
BEGIN
 SELECT * INTO b FROM public.hotel_folio_bill_to WHERE tenant_id=p_tenant AND reservation_id=p_res;
 IF FOUND THEN RETURN jsonb_build_object('name',b.name,'company',b.company,'address',b.address,'phone',b.phone,'email',b.email); END IF;
 SELECT guest.* INTO g FROM public.hotel_guests guest JOIN public.hotel_reservation_guests rg ON rg.tenant_id=guest.tenant_id AND rg.guest_id=guest.id WHERE rg.tenant_id=p_tenant AND rg.reservation_id=p_res ORDER BY rg.is_primary DESC,rg.guest_id LIMIT 1;
 RETURN jsonb_build_object('name',coalesce(g.full_name,''),'company','','address',concat_ws(E'\n',nullif(g.address_line_1,''),nullif(g.address_line_2,''),nullif(g.address_line_3,''),nullif(concat_ws(' ',nullif(g.postcode,''),nullif(g.city,'')),''),coalesce(nullif(g.state_province,''),nullif(g.state_code,'')),nullif(g.country_code,'')),'phone',coalesce(g.mobile,''),'email',coalesce(g.email,''));
END $$;
CREATE FUNCTION public.hotelhub_bill_to_validate(p jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text; maximum integer;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 FOR k,maximum IN SELECT * FROM (VALUES('name',160),('company',200),('address',600),('phone',60),('email',254)) AS bounds(key,maximum) LOOP
  IF jsonb_typeof(p->k) IS DISTINCT FROM 'string' OR public.hotelhub_utf16_length(p->>k)>maximum OR p->>k IS DISTINCT FROM btrim(p->>k) THEN RETURN false; END IF;
 END LOOP;
 RETURN (p->>'name'<>'' OR p->>'company'<>'') AND (p->>'email'='' OR p->>'email' ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');
END $$;
CREATE FUNCTION public.hotelhub_bill_to_write(p_tenant uuid,p_res uuid,p_bill jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 INSERT INTO public.hotel_folio_bill_to(tenant_id,reservation_id,name,company,address,phone,email,effective_revision)
 VALUES(p_tenant,p_res,p_bill->>'name',p_bill->>'company',p_bill->>'address',p_bill->>'phone',p_bill->>'email',1)
 ON CONFLICT(tenant_id,reservation_id) DO UPDATE SET name=excluded.name,company=excluded.company,address=excluded.address,phone=excluded.phone,email=excluded.email,effective_revision=public.hotel_folio_bill_to.effective_revision+1,updated_at=now()
$$;
CREATE FUNCTION public.hotelhub_bill_to_change_save(p_tenant_id uuid,p_actor text,p_role text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.hotel_bill_to_change_requests; p public.hotel_change_control_policies; res public.hotel_reservations;
 current_bill jsonb; current_revision bigint; requested jsonb:=p_data->'billTo'; reason text:=btrim(coalesce(p_data->>'reason','')); v_res_id uuid:=(p_data->>'reservationId')::uuid;
BEGIN
 IF p_role NOT IN ('owner','front_desk') OR p_role IS NULL OR nullif(p_actor,'') IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
 SELECT * INTO res FROM public.hotel_reservations WHERE tenant_id=p_tenant_id AND hotel_reservations.id=v_res_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
 IF res.status NOT IN ('confirmed','checked_in') THEN RAISE EXCEPTION 'bill_to_locked'; END IF;
 IF NOT public.hotelhub_bill_to_validate(requested) THEN RAISE EXCEPTION 'invalid_bill_to'; END IF;
 current_bill:=public.hotelhub_bill_to_current(p_tenant_id,v_res_id);
 SELECT coalesce((SELECT effective_revision FROM public.hotel_folio_bill_to WHERE tenant_id=p_tenant_id AND reservation_id=v_res_id),0) INTO current_revision;
 SELECT * INTO v FROM public.hotel_bill_to_change_requests WHERE tenant_id=p_tenant_id AND client_request_id=(p_data->>'clientRequestId')::uuid;
 IF FOUND THEN
  IF v.reservation_id<>v_res_id OR v.requested IS DISTINCT FROM requested OR v.original IS DISTINCT FROM p_data->'original' OR v.requested_by<>p_actor THEN RAISE EXCEPTION 'receipt_control_key_conflict'; END IF;
  RETURN jsonb_build_object('outcome',CASE WHEN v.state='applied' THEN 'applied' ELSE 'pending' END,'billTo',current_bill,'effectiveRevision',current_revision::text,'pending',CASE WHEN v.state='pending' THEN to_jsonb(v) ELSE NULL END);
 END IF;
 IF current_revision::text IS DISTINCT FROM p_data->>'expectedRevision' OR current_bill IS DISTINCT FROM p_data->'original' THEN RAISE EXCEPTION 'bill_to_changed'; END IF;
 IF current_bill=requested THEN RETURN jsonb_build_object('outcome','no_change','billTo',current_bill,'effectiveRevision',current_revision::text,'pending',NULL); END IF;
 IF EXISTS(SELECT 1 FROM public.hotel_bill_to_change_requests WHERE tenant_id=p_tenant_id AND reservation_id=v_res_id AND state IN ('pending','needs_review')) THEN RAISE EXCEPTION 'receipt_control_active_exists'; END IF;
 INSERT INTO public.hotel_change_control_policies(tenant_id) VALUES(p_tenant_id) ON CONFLICT DO NOTHING;
 SELECT * INTO p FROM public.hotel_change_control_policies WHERE tenant_id=p_tenant_id FOR UPDATE;
 IF p.contact_approval_required AND public.hotelhub_utf16_length(reason) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid_reason'; END IF;
 INSERT INTO public.hotel_bill_to_change_requests(tenant_id,reservation_id,client_request_id,original,requested,original_revision,reason,state,requested_by,decided_by,decided_at)
 VALUES(p_tenant_id,v_res_id,(p_data->>'clientRequestId')::uuid,current_bill,requested,current_revision,CASE WHEN reason='' THEN 'Billing contact update' ELSE reason END,CASE WHEN p.contact_approval_required THEN 'pending' ELSE 'applied' END,p_actor,CASE WHEN p.contact_approval_required THEN NULL ELSE p_actor END,CASE WHEN p.contact_approval_required THEN NULL ELSE now() END) RETURNING * INTO v;
 IF NOT p.contact_approval_required THEN PERFORM public.hotelhub_bill_to_write(p_tenant_id,v_res_id,requested); current_revision:=current_revision+1;current_bill:=requested; END IF;
 INSERT INTO public.hotel_audit_events(tenant_id,n3_user_key,event_type,detail) VALUES(p_tenant_id,p_actor,'hotel.folio.bill_to_change',jsonb_build_object('requestId',v.id,'outcome',v.state,'reservationId',v_res_id));
 PERFORM public.hotelhub_change_revision_bump(p_tenant_id);
 RETURN jsonb_build_object('outcome',CASE WHEN p.contact_approval_required THEN 'pending' ELSE 'applied' END,'billTo',current_bill,'effectiveRevision',current_revision::text,'pending',CASE WHEN p.contact_approval_required THEN to_jsonb(v) ELSE NULL END);
END $$;
CREATE FUNCTION public.hotelhub_bill_to_change_decide(p_tenant_id uuid,p_actor text,p_role text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.hotel_bill_to_change_requests; res public.hotel_reservations; current_revision bigint;
BEGIN
 IF p_role IS DISTINCT FROM 'owner' OR nullif(p_actor,'') IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
 -- Lock reservation before proposal, matching Save and existing reservation mutations.
 SELECT * INTO v FROM public.hotel_bill_to_change_requests WHERE tenant_id=p_tenant_id AND id=(p_data->>'requestId')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
 SELECT * INTO res FROM public.hotel_reservations WHERE tenant_id=p_tenant_id AND id=v.reservation_id FOR UPDATE;
 SELECT * INTO v FROM public.hotel_bill_to_change_requests WHERE tenant_id=p_tenant_id AND id=v.id FOR UPDATE;
 IF v.version IS DISTINCT FROM (p_data->>'expectedVersion')::integer THEN RAISE EXCEPTION 'version_conflict'; END IF;
 IF v.state NOT IN ('pending','needs_review') OR coalesce(p_data->>'decision','') NOT IN ('approve','reject') THEN RAISE EXCEPTION 'invalid_transition'; END IF;
 IF p_data->>'decision'='approve' THEN
  IF res.status NOT IN ('confirmed','checked_in') THEN RAISE EXCEPTION 'bill_to_locked'; END IF;
  SELECT coalesce((SELECT effective_revision FROM public.hotel_folio_bill_to WHERE tenant_id=p_tenant_id AND reservation_id=v.reservation_id),0) INTO current_revision;
  IF current_revision<>v.original_revision OR public.hotelhub_bill_to_current(p_tenant_id,v.reservation_id) IS DISTINCT FROM v.original THEN RAISE EXCEPTION 'bill_to_changed'; END IF;
  PERFORM public.hotelhub_bill_to_write(p_tenant_id,v.reservation_id,v.requested);
 END IF;
 UPDATE public.hotel_bill_to_change_requests SET state=CASE WHEN p_data->>'decision'='approve' THEN 'applied' ELSE 'rejected' END,version=version+1,decided_by=p_actor,decided_at=now() WHERE id=v.id RETURNING * INTO v;
 INSERT INTO public.hotel_audit_events(tenant_id,n3_user_key,event_type,detail) VALUES(p_tenant_id,p_actor,'hotel.folio.bill_to_decided',jsonb_build_object('requestId',v.id,'outcome',v.state));
 PERFORM public.hotelhub_change_revision_bump(p_tenant_id); RETURN to_jsonb(v);
END $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('hotelhub_bill_to_current','hotelhub_bill_to_validate','hotelhub_bill_to_write','hotelhub_bill_to_change_save','hotelhub_bill_to_change_decide') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END LOOP;
END $$;

CREATE FUNCTION public.hotelhub_change_intent_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE allowed text[];
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'receipt_control_immutable'; END IF;
 IF TG_TABLE_NAME='hotel_receipt_edit_attempts' THEN
  allowed:=ARRAY['phase','code','settled_at'];
  IF OLD.phase IN ('confirmed','rejected') AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN RAISE EXCEPTION 'receipt_control_immutable'; END IF;
  IF NEW.phase NOT IN ('confirmed','rejected','unknown') AND NEW.phase<>OLD.phase THEN RAISE EXCEPTION 'receipt_control_immutable'; END IF;
 ELSE allowed:=ARRAY['state','version','decided_by','decided_at']; END IF;
 IF (to_jsonb(NEW)-allowed) IS DISTINCT FROM (to_jsonb(OLD)-allowed) THEN RAISE EXCEPTION 'receipt_control_immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hotel_receipt_attempt_guard BEFORE UPDATE OR DELETE ON public.hotel_receipt_edit_attempts FOR EACH ROW EXECUTE FUNCTION public.hotelhub_change_intent_guard();
CREATE TRIGGER hotel_bill_to_intent_guard BEFORE UPDATE OR DELETE ON public.hotel_bill_to_change_requests FOR EACH ROW EXECUTE FUNCTION public.hotelhub_change_intent_guard();
REVOKE ALL ON FUNCTION public.hotelhub_change_intent_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hotelhub_change_intent_guard() TO service_role;

-- Lossless decimal revisions: PostgREST bigint JSON numbers are unsafe in JS.
CREATE FUNCTION public.hotelhub_change_revision_read(p_tenant uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT revision::text FROM public.hotel_change_revisions WHERE tenant_id=p_tenant),'0')
$$;
CREATE FUNCTION public.hotelhub_change_policy_read(p_tenant uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('revision',coalesce(p.revision::text,'0'),'depositApprovalRequired',coalesce(p.deposit_approval_required,true),'contactApprovalRequired',coalesce(p.contact_approval_required,false)) FROM (SELECT 1) seed LEFT JOIN public.hotel_change_control_policies p ON p.tenant_id=p_tenant
$$;
CREATE FUNCTION public.hotelhub_bill_to_read(p_tenant uuid,p_res uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('billTo',public.hotelhub_bill_to_current(p_tenant,p_res),'effectiveRevision',coalesce((SELECT effective_revision::text FROM public.hotel_folio_bill_to WHERE tenant_id=p_tenant AND reservation_id=p_res),'0'))
$$;
REVOKE ALL ON FUNCTION public.hotelhub_change_revision_read(uuid),public.hotelhub_change_policy_read(uuid),public.hotelhub_bill_to_read(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hotelhub_change_revision_read(uuid),public.hotelhub_change_policy_read(uuid),public.hotelhub_bill_to_read(uuid,uuid) TO service_role;

-- Dormant Owner proof ledger. Exact test packages are server-owned, never browser payloads.
CREATE TABLE public.hotel_receipt_update_proof_permits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.hotel_tenants(id), owner_key text NOT NULL,
 receipt_id uuid NOT NULL, package_hash text NOT NULL CHECK(package_hash ~ '^[a-f0-9]{64}$'),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz NOT NULL, binding jsonb NOT NULL,
 phase text NOT NULL DEFAULT 'prepared' CHECK(phase IN ('prepared','reserved','unknown','verified')),
 report jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,receipt_id,package_hash)
);
CREATE UNIQUE INDEX hotel_receipt_proof_active ON public.hotel_receipt_update_proof_permits(receipt_id) WHERE phase <> 'verified';
ALTER TABLE public.hotel_receipt_update_proof_permits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hotel_receipt_update_proof_permits FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.hotel_receipt_update_proof_permits TO service_role;
CREATE FUNCTION public.hotelhub_receipt_proof_prepare(p_tenant_id uuid,p_actor text,p_role text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.hotel_receipt_update_proof_permits; deadline timestamptz;
BEGIN
 IF p_role IS DISTINCT FROM 'owner' OR coalesce(p_actor,'')='' THEN RAISE EXCEPTION 'forbidden'; END IF;
 deadline:=to_timestamp((p_data->>'expiresAt')::double precision/1000);
 IF deadline IS NULL OR deadline<=clock_timestamp() THEN RAISE EXCEPTION 'proof_expired'; END IF;
 IF EXISTS(SELECT 1 FROM public.hotel_reservation_deposits WHERE lower(n3_receipt_id::text)=lower(p_data->>'receiptId')) THEN RAISE EXCEPTION 'proof_hotel_receipt'; END IF;
 INSERT INTO public.hotel_receipt_update_proof_permits(tenant_id,owner_key,receipt_id,package_hash,payload_hash,expires_at,binding)
 VALUES(p_tenant_id,p_actor,(p_data->>'receiptId')::uuid,p_data->>'packageHash',p_data->>'payloadHash',deadline,p_data)
 ON CONFLICT(tenant_id,receipt_id,package_hash) DO NOTHING RETURNING * INTO v;
 IF v.id IS NULL THEN SELECT * INTO v FROM public.hotel_receipt_update_proof_permits WHERE tenant_id=p_tenant_id AND receipt_id=(p_data->>'receiptId')::uuid AND package_hash=p_data->>'packageHash'; END IF;
 IF v.owner_key IS DISTINCT FROM p_actor OR v.payload_hash IS DISTINCT FROM p_data->>'payloadHash' THEN RAISE EXCEPTION 'proof_conflict'; END IF;
 RETURN to_jsonb(v);
END $$;
CREATE FUNCTION public.hotelhub_receipt_proof_claim(p_tenant_id uuid,p_actor text,p_role text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.hotel_receipt_update_proof_permits;
BEGIN
 IF p_role IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'forbidden'; END IF;
 SELECT * INTO v FROM public.hotel_receipt_update_proof_permits WHERE id=(p_data->>'id')::uuid AND tenant_id=p_tenant_id AND owner_key=p_actor FOR UPDATE;
 IF v.id IS NULL OR v.payload_hash IS DISTINCT FROM p_data->>'payloadHash' THEN RAISE EXCEPTION 'proof_conflict'; END IF;
 IF v.phase<>'prepared' THEN RETURN jsonb_build_object('dispatchGranted',false); END IF;
 IF v.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'proof_expired'; END IF;
 IF EXISTS(SELECT 1 FROM public.hotel_reservation_deposits WHERE lower(n3_receipt_id::text)=v.receipt_id::text) THEN RAISE EXCEPTION 'proof_hotel_receipt'; END IF;
 UPDATE public.hotel_receipt_update_proof_permits SET phase='reserved' WHERE id=v.id;
 RETURN jsonb_build_object('dispatchGranted',true);
END $$;
CREATE FUNCTION public.hotelhub_receipt_proof_finish(p_tenant_id uuid,p_actor text,p_role text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.hotel_receipt_update_proof_permits;
BEGIN
 IF p_role IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'forbidden'; END IF;
 SELECT * INTO v FROM public.hotel_receipt_update_proof_permits WHERE id=(p_data->>'id')::uuid AND tenant_id=p_tenant_id AND owner_key=p_actor FOR UPDATE;
 IF v.id IS NULL OR v.phase='prepared' OR coalesce(p_data->>'phase','') NOT IN ('unknown','verified') THEN RAISE EXCEPTION 'proof_conflict'; END IF;
 IF v.phase='verified' THEN RETURN to_jsonb(v); END IF;
 UPDATE public.hotel_receipt_update_proof_permits SET phase=p_data->>'phase',report=p_data->'report' WHERE id=v.id RETURNING * INTO v;
 RETURN to_jsonb(v);
END $$;
CREATE FUNCTION public.hotelhub_receipt_proof_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['phase','report']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['phase','report']) OR OLD.phase='verified' OR NEW.phase='prepared' THEN RAISE EXCEPTION 'receipt_control_immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hotel_receipt_proof_guard BEFORE UPDATE OR DELETE ON public.hotel_receipt_update_proof_permits FOR EACH ROW EXECUTE FUNCTION public.hotelhub_receipt_proof_guard();
REVOKE ALL ON FUNCTION public.hotelhub_receipt_proof_prepare(uuid,text,text,jsonb),public.hotelhub_receipt_proof_claim(uuid,text,text,jsonb),public.hotelhub_receipt_proof_finish(uuid,text,text,jsonb),public.hotelhub_receipt_proof_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hotelhub_receipt_proof_prepare(uuid,text,text,jsonb),public.hotelhub_receipt_proof_claim(uuid,text,text,jsonb),public.hotelhub_receipt_proof_finish(uuid,text,text,jsonb),public.hotelhub_receipt_proof_guard() TO service_role;
