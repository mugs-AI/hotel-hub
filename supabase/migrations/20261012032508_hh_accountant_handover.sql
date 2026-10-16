-- UNAPPLIED candidate. Requires hh_billing_settlement; no accounting mutation.
CREATE TABLE public.hotel_accountant_history_start (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), started_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.hotel_accountant_history_start(singleton) VALUES(true);
CREATE TABLE public.hotel_accountant_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,reservation_id uuid NOT NULL,intent_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('receipt_surplus','refund_review','n3_conflict','ota_receivable')),
 document_ids uuid[] NOT NULL CHECK(cardinality(document_ids) BETWEEN 1 AND 100),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewed','resolved')),
 first_seen timestamptz NOT NULL DEFAULT clock_timestamp(),row_snapshot jsonb NOT NULL,
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,reservation_id,intent_id,kind,document_ids),
 FOREIGN KEY(tenant_id,reservation_id,intent_id) REFERENCES public.hotel_settlement_intents(tenant_id,reservation_id,id)
);
CREATE TABLE public.hotel_accountant_case_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,case_id uuid NOT NULL,
 version bigint NOT NULL,request_id uuid NOT NULL,fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 event jsonb NOT NULL,actor text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),row_snapshot jsonb NOT NULL,
 UNIQUE(tenant_id,request_id),UNIQUE(tenant_id,case_id,version),
 FOREIGN KEY(tenant_id,case_id) REFERENCES public.hotel_accountant_cases(tenant_id,id)
);
CREATE INDEX accountant_events_as_at ON public.hotel_accountant_case_events(tenant_id,case_id,created_at DESC,version DESC);
CREATE TABLE public.hotel_accountant_statements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.hotel_tenants(id),
 request_id uuid NOT NULL,fingerprint text NOT NULL,actor text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 snapshot jsonb NOT NULL,snapshot_text text NOT NULL CHECK(snapshot_text=snapshot::text),
 digest text NOT NULL CHECK(digest=encode(sha256(convert_to(snapshot_text,'UTF8')),'hex')),
 UNIQUE(tenant_id,request_id)
);
ALTER TABLE public.hotel_accountant_history_start ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_accountant_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_accountant_case_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_accountant_statements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hotel_accountant_history_start,public.hotel_accountant_cases,public.hotel_accountant_case_events,public.hotel_accountant_statements FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.hotel_accountant_history_start,public.hotel_accountant_cases,public.hotel_accountant_case_events,public.hotel_accountant_statements TO service_role;
CREATE FUNCTION public.hotelhub_accountant_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'accountant_immutable'; END $$;
CREATE TRIGGER accountant_event_immutable BEFORE UPDATE OR DELETE ON public.hotel_accountant_case_events FOR EACH ROW EXECUTE FUNCTION public.hotelhub_accountant_immutable();
CREATE TRIGGER accountant_statement_immutable BEFORE UPDATE OR DELETE ON public.hotel_accountant_statements FOR EACH ROW EXECUTE FUNCTION public.hotelhub_accountant_immutable();
CREATE TRIGGER accountant_history_immutable BEFORE UPDATE OR DELETE ON public.hotel_accountant_history_start FOR EACH ROW EXECUTE FUNCTION public.hotelhub_accountant_immutable();
CREATE FUNCTION public.hotelhub_accountant_case_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
  OR NEW.reservation_id IS DISTINCT FROM OLD.reservation_id OR NEW.intent_id IS DISTINCT FROM OLD.intent_id
  OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.document_ids IS DISTINCT FROM OLD.document_ids OR NEW.first_seen IS DISTINCT FROM OLD.first_seen
 THEN RAISE EXCEPTION 'accountant_immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER accountant_case_identity BEFORE UPDATE OR DELETE ON public.hotel_accountant_cases FOR EACH ROW EXECUTE FUNCTION public.hotelhub_accountant_case_guard();
CREATE FUNCTION public.hotelhub_accountant_observation(p jsonb) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p-ARRAY['available','checkedAt','evidenceDigest','observedAmountCents','outcomeCode']<>'{}'
  OR NOT(p ?& ARRAY['available','checkedAt','evidenceDigest','observedAmountCents','outcomeCode'])
  OR jsonb_typeof(p->'available') IS DISTINCT FROM 'boolean' OR coalesce(p->>'outcomeCode','') !~ '^[a-zA-Z0-9_:-]{1,100}$'
  OR coalesce(p->>'checkedAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$'
  OR (p->>'checkedAt')::timestamptz>clock_timestamp()
 THEN RAISE EXCEPTION 'accountant_invalid_input'; END IF;
 IF (p->>'available')::boolean THEN
  IF coalesce(p->>'evidenceDigest','') !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p->'observedAmountCents') IS DISTINCT FROM 'number'
   OR (p->>'observedAmountCents')::numeric<>trunc((p->>'observedAmountCents')::numeric)
   OR (p->>'observedAmountCents')::numeric NOT BETWEEN 0 AND 1000000000 THEN RAISE EXCEPTION 'accountant_invalid_input'; END IF;
 ELSE
  IF p->'observedAmountCents' IS DISTINCT FROM 'null'::jsonb OR p->'evidenceDigest' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'accountant_invalid_input'; END IF;
 END IF;
END $$;
CREATE FUNCTION public.hotelhub_accountant_case_open(p_tenant uuid,p_actor text,p_key jsonb,p_observation jsonb,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.hotel_accountant_cases;e public.hotel_accountant_case_events;i public.hotel_settlement_intents;r public.hotel_reservations;
 ids uuid[];k jsonb;fp text;at timestamptz:=clock_timestamp();v_status text;v_row jsonb;refs jsonb;
BEGIN
 PERFORM public.hotelhub_settlement_owner(p_tenant,p_actor);
 PERFORM public.hotelhub_accountant_observation(p_observation);
 IF p_request IS NULL OR jsonb_typeof(p_key) IS DISTINCT FROM 'object' OR p_key-ARRAY['reservationId','intentId','kind','documentIds']<>'{}'
  OR NOT(p_key ?& ARRAY['reservationId','intentId','kind','documentIds']) OR jsonb_typeof(p_key->'documentIds') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_key->'documentIds') NOT BETWEEN 1 AND 100 OR p_key->>'kind' NOT IN ('receipt_surplus','refund_review','n3_conflict','ota_receivable')
 THEN RAISE EXCEPTION 'accountant_invalid_input'; END IF;
 SELECT array_agg(x ORDER BY x) INTO ids FROM (SELECT (value#>>'{}')::uuid AS x FROM jsonb_array_elements(p_key->'documentIds')) a;
 IF cardinality(ids)<>(SELECT count(DISTINCT x) FROM unnest(ids) x) OR array_position(ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'accountant_invalid_input'; END IF;
 k:=jsonb_build_object('reservationId',(p_key->>'reservationId')::uuid,'intentId',(p_key->>'intentId')::uuid,'kind',p_key->>'kind','documentIds',ids);
 fp:=encode(sha256(convert_to(jsonb_build_object('key',k,'observation',p_observation)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('hh_accountant_request:'||p_tenant::text||':'||p_request::text,0));
 -- Parent lock serializes every mutation and request replay for this stay.
 SELECT * INTO r FROM public.hotel_reservations WHERE tenant_id=p_tenant AND id=(k->>'reservationId')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'accountant_scope_mismatch'; END IF;
 at:=clock_timestamp();
 SELECT * INTO e FROM public.hotel_accountant_case_events WHERE tenant_id=p_tenant AND request_id=p_request;
 IF FOUND THEN IF e.fingerprint<>fp THEN RAISE EXCEPTION 'accountant_idempotency_conflict'; END IF; RETURN e.row_snapshot; END IF;
 SELECT * INTO i FROM public.hotel_settlement_intents WHERE tenant_id=p_tenant AND reservation_id=r.id AND id=(k->>'intentId')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'accountant_scope_mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ids) d WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(i.snapshot->'receipts','[]')) x WHERE x->>'receiptId'=d::text)
  AND NOT EXISTS(SELECT 1 FROM public.hotel_settlement_attempts a WHERE a.tenant_id=p_tenant AND a.reservation_id=r.id AND a.intent_id=i.id AND a.outcome->>'kind'='confirmed' AND a.outcome->>'documentId'=d::text))
 THEN RAISE EXCEPTION 'accountant_scope_mismatch'; END IF;
 SELECT * INTO c FROM public.hotel_accountant_cases WHERE tenant_id=p_tenant AND reservation_id=r.id AND intent_id=i.id AND kind=k->>'kind' AND document_ids=ids FOR UPDATE;
 IF NOT FOUND THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',d,'code',coalesce((SELECT CASE WHEN b.proof->'bill'->>'id'=d::text THEN b.proof->'bill'->>'code' ELSE b.proof->'receipt'->>'code' END FROM public.hotel_settlement_evidence b WHERE b.tenant_id=p_tenant AND b.reservation_id=r.id AND b.intent_id=i.id AND (b.proof->'bill'->>'id'=d::text OR b.proof->'receipt'->>'receiptId'=d::text) ORDER BY b.created_at DESC LIMIT 1),''),
   'date',coalesce((SELECT x->>'receiptDate' FROM jsonb_array_elements(coalesce(i.snapshot->'receipts','[]')) x WHERE x->>'receiptId'=d::text),i.snapshot->>'billDate')) ORDER BY d),'[]') INTO refs FROM unnest(ids) d;
  v_status:='open';
  INSERT INTO public.hotel_accountant_cases(tenant_id,reservation_id,intent_id,kind,document_ids,first_seen,row_snapshot) VALUES(p_tenant,r.id,i.id,k->>'kind',ids,at,'{}') RETURNING * INTO c;
  v_row:=jsonb_build_object('caseId',c.id,'version','1','key',k,'bookingReference',r.booking_reference,'stayFrom',r.arrival_date,'stayTo',r.departure_date,'documentReferences',refs,'currency',i.snapshot->>'currency',
   'firstSeen',at,'lastChecked',p_observation->>'checkedAt','status','open','observation',p_observation,'nextAction','Review the same saved documents in N3, then Check N3 result','notes','[]'::jsonb);
 ELSE
  v_status:=c.status;
  IF c.status='resolved' AND (p_observation->'available'='false' OR p_observation->'evidenceDigest' IS DISTINCT FROM c.row_snapshot->'observation'->'evidenceDigest' OR p_observation->'observedAmountCents' IS DISTINCT FROM c.row_snapshot->'observation'->'observedAmountCents') THEN v_status:='open'; END IF;
  c.version:=c.version+1;
  v_row:=c.row_snapshot||jsonb_build_object('version',c.version::text,'status',v_status,'observation',p_observation,'lastChecked',p_observation->>'checkedAt');
 END IF;
 UPDATE public.hotel_accountant_cases SET version=c.version,status=v_status,row_snapshot=v_row WHERE id=c.id;
 INSERT INTO public.hotel_accountant_case_events(tenant_id,case_id,version,request_id,fingerprint,event,actor,created_at,row_snapshot) VALUES(p_tenant,c.id,c.version,p_request,fp,jsonb_build_object('kind','observe','observation',p_observation),p_actor,at,v_row);
 RETURN v_row;
END $$;
CREATE FUNCTION public.hotelhub_accountant_case_event(p_tenant uuid,p_actor text,p_case uuid,p_version text,p_event jsonb,p_request uuid,p_resolution jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.hotel_accountant_cases;e public.hotel_accountant_case_events;r public.hotel_reservations;i public.hotel_settlement_intents;
 fp text;v_row jsonb;v_status text;at timestamptz:=clock_timestamp();o jsonb;kind text;all_ids uuid[];
BEGIN
 PERFORM public.hotelhub_settlement_owner(p_tenant,p_actor);
 IF p_request IS NULL OR p_version IS NULL OR p_version !~ '^[1-9]\d{0,18}$' OR p_version::numeric>9223372036854775807
  OR jsonb_typeof(p_event) IS DISTINCT FROM 'object' OR p_event-ARRAY['kind','reason','observation','proofDigest']<>'{}'
  OR NOT(p_event ?& ARRAY['kind','reason','observation','proofDigest']) OR coalesce(p_event->>'reason','') !~ '\S' OR length(p_event->>'reason')>1000
  OR coalesce(p_event->>'kind','') NOT IN ('note','review','resolve','reopen','observe') THEN RAISE EXCEPTION 'accountant_invalid_input'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('hh_accountant_request:'||p_tenant::text||':'||p_request::text,0));
 SELECT * INTO c FROM public.hotel_accountant_cases WHERE tenant_id=p_tenant AND id=p_case;
 IF NOT FOUND THEN RAISE EXCEPTION 'accountant_scope_mismatch'; END IF;
 PERFORM 1 FROM public.hotel_reservations WHERE tenant_id=p_tenant AND id=c.reservation_id FOR UPDATE;
 at:=clock_timestamp();
 fp:=encode(sha256(convert_to(jsonb_build_object('caseId',p_case,'version',p_version,'event',p_event,'resolution',p_resolution)::text,'UTF8')),'hex');
 SELECT * INTO e FROM public.hotel_accountant_case_events WHERE tenant_id=p_tenant AND request_id=p_request;
 IF FOUND THEN IF e.fingerprint<>fp THEN RAISE EXCEPTION 'accountant_idempotency_conflict'; END IF; RETURN e.row_snapshot; END IF;
 SELECT * INTO c FROM public.hotel_accountant_cases WHERE tenant_id=p_tenant AND id=p_case FOR UPDATE;
 IF c.version::text<>p_version THEN RAISE EXCEPTION 'accountant_stale_version'; END IF;
 kind:=p_event->>'kind';o:=p_event->'observation';v_status:=c.status;
 IF kind IN ('observe','resolve') THEN PERFORM public.hotelhub_accountant_observation(o);
 ELSE IF o IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'accountant_invalid_input'; END IF; END IF;
 IF kind='resolve' THEN
  -- Only the server opaque proof converter supplies this packet. No browser/RPC
  -- access is granted, and a proofDigest string alone cannot resolve a case.
  IF p_resolution IS NULL OR c.kind NOT IN ('receipt_surplus','n3_conflict') OR p_resolution->>'provenance' IS DISTINCT FROM 'external_n3_matching'
   OR p_resolution->>'tenantId' IS DISTINCT FROM p_tenant::text OR p_resolution->>'reservationId' IS DISTINCT FROM c.reservation_id::text
   OR p_resolution->>'intentId' IS DISTINCT FROM c.intent_id::text OR p_resolution->>'digest' IS DISTINCT FROM p_event->>'proofDigest'
   OR coalesce(p_event->>'proofDigest','') !~ '^[a-f0-9]{64}$' OR p_resolution->>'billOutstandingCents' IS DISTINCT FROM '0'
   OR o->>'observedAmountCents' IS DISTINCT FROM '0' OR o->>'available' IS DISTINCT FROM 'true' OR o->>'evidenceDigest' IS DISTINCT FROM p_resolution->>'observationDigest' OR coalesce(p_resolution->>'observationDigest','') !~ '^[a-f0-9]{64}$'
   OR coalesce(p_resolution->>'checkedAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$'
   OR (p_resolution->>'checkedAt')::timestamptz>at OR (p_resolution->>'checkedAt')::timestamptz<at-interval '60 seconds'
  THEN RAISE EXCEPTION 'accountant_resolution_unverified'; END IF;
  SELECT * INTO i FROM public.hotel_settlement_intents WHERE tenant_id=p_tenant AND reservation_id=c.reservation_id AND id=c.intent_id;
  IF i.revision::text IS DISTINCT FROM p_resolution->>'intentRevision' OR i.digest IS DISTINCT FROM p_resolution->>'snapshotDigest' THEN RAISE EXCEPTION 'accountant_resolution_unverified'; END IF;
  SELECT array_agg(x) INTO all_ids FROM (SELECT (p_resolution->>'billId')::uuid AS x UNION SELECT (value->>'receiptId')::uuid FROM jsonb_array_elements(p_resolution->'receiptObservations')) a;
  IF NOT c.document_ids<@all_ids OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_resolution->'receiptObservations') x WHERE x->>'remainderCents' IS DISTINCT FROM '0' OR x->>'refundCents' IS DISTINCT FROM '0') THEN RAISE EXCEPTION 'accountant_resolution_unverified'; END IF;
  v_status:='resolved';
 ELSE
  IF p_resolution IS NOT NULL OR p_event->'proofDigest' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'accountant_invalid_input'; END IF;
  IF kind='review' AND c.status<>'resolved' THEN v_status:='reviewed'; END IF;
  IF kind='reopen' OR (kind='observe' AND c.status='resolved' AND (o->'available'='false' OR o->'evidenceDigest' IS DISTINCT FROM c.row_snapshot->'observation'->'evidenceDigest' OR o->'observedAmountCents' IS DISTINCT FROM c.row_snapshot->'observation'->'observedAmountCents')) THEN v_status:='open'; END IF;
 END IF;
 v_row:=c.row_snapshot||jsonb_build_object('version',(c.version+1)::text,'status',v_status);
 IF kind IN ('observe','resolve') THEN v_row:=v_row||jsonb_build_object('observation',o,'lastChecked',o->>'checkedAt'); END IF;
 IF kind='note' THEN v_row:=v_row||jsonb_build_object('notes',(c.row_snapshot->'notes')||jsonb_build_array(btrim(p_event->>'reason'))); END IF;
 UPDATE public.hotel_accountant_cases SET version=version+1,status=v_status,row_snapshot=v_row WHERE id=c.id;
 INSERT INTO public.hotel_accountant_case_events(tenant_id,case_id,version,request_id,fingerprint,event,actor,created_at,row_snapshot) VALUES(p_tenant,c.id,c.version+1,p_request,fp,p_event,p_actor,at,v_row);
 RETURN v_row;
END $$;
CREATE FUNCTION public.hotelhub_accountant_cases_read(p_tenant uuid,p_actor text,p_as_at date,p_status text,p_offset integer,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE at timestamptz:=clock_timestamp();cutoff timestamptz;started timestamptz;rows jsonb;total integer;
BEGIN
 PERFORM public.hotelhub_settlement_owner(p_tenant,p_actor);
 IF p_as_at IS NULL OR p_as_at>(at AT TIME ZONE 'Asia/Kuala_Lumpur')::date OR p_status IS NULL OR p_status NOT IN ('open','all') OR p_offset IS NULL OR p_offset<0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'accountant_invalid_input'; END IF;
 cutoff:=((p_as_at+1)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur');
 SELECT started_at INTO started FROM public.hotel_accountant_history_start WHERE singleton;
 IF least(cutoff,at)<started THEN RETURN jsonb_build_object('rows','[]'::jsonb,'asAt',p_as_at,'generatedAt',at,'complete',false,'nextOffset',NULL); END IF;
 SELECT coalesce(jsonb_agg(row_snapshot ORDER BY first_seen,id),'[]'::jsonb) INTO rows FROM (
  SELECT c.id,c.first_seen,e.row_snapshot FROM public.hotel_accountant_cases c CROSS JOIN LATERAL (
   SELECT row_snapshot FROM public.hotel_accountant_case_events e WHERE e.tenant_id=p_tenant AND e.case_id=c.id AND e.created_at<cutoff AND e.created_at<=at ORDER BY e.created_at DESC,e.version DESC LIMIT 1
  ) e WHERE c.tenant_id=p_tenant AND (p_status='all' OR e.row_snapshot->>'status'<>'resolved')
 ) a;
 total:=jsonb_array_length(rows);
 RETURN jsonb_build_object('rows',coalesce((SELECT jsonb_agg(value ORDER BY ordinality) FROM jsonb_array_elements(rows) WITH ORDINALITY WHERE ordinality>p_offset AND ordinality<=p_offset+p_limit),'[]'::jsonb),
  'asAt',p_as_at,'generatedAt',at,'complete',p_offset=0 AND total<=p_limit,'nextOffset',CASE WHEN total>p_offset+p_limit THEN p_offset+p_limit ELSE NULL END);
END $$;
CREATE FUNCTION public.hotelhub_accountant_statement(p_tenant uuid,p_actor text,p_as_at date,p_status text,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.hotel_accountant_statements;page jsonb;fp text;
BEGIN
 PERFORM public.hotelhub_settlement_owner(p_tenant,p_actor);
 IF p_request IS NULL THEN RAISE EXCEPTION 'accountant_invalid_input'; END IF;
 fp:=encode(sha256(convert_to(jsonb_build_object('asAt',p_as_at,'status',p_status)::text,'UTF8')),'hex');
 -- One INSERT/SELECT capture; retries return saved bytes instead of a new read.
 SELECT * INTO s FROM public.hotel_accountant_statements WHERE tenant_id=p_tenant AND request_id=p_request;
 IF FOUND THEN IF s.fingerprint<>fp THEN RAISE EXCEPTION 'accountant_idempotency_conflict'; END IF;
 ELSE
  page:=public.hotelhub_accountant_cases_read(p_tenant,p_actor,p_as_at,p_status,0,1000);
  IF page->>'complete' IS DISTINCT FROM 'true' OR octet_length(page::text)>2000000 THEN RAISE EXCEPTION 'accountant_history_unavailable'; END IF;
  INSERT INTO public.hotel_accountant_statements(tenant_id,request_id,fingerprint,actor,snapshot,snapshot_text,digest) VALUES(p_tenant,p_request,fp,p_actor,page,page::text,encode(sha256(convert_to(page::text,'UTF8')),'hex')) ON CONFLICT(tenant_id,request_id) DO NOTHING RETURNING * INTO s;
  IF NOT FOUND THEN SELECT * INTO s FROM public.hotel_accountant_statements WHERE tenant_id=p_tenant AND request_id=p_request; END IF;
  IF s.fingerprint<>fp THEN RAISE EXCEPTION 'accountant_idempotency_conflict'; END IF;
 END IF;
 RETURN jsonb_build_object('statementId',s.id,'digest',s.digest,'pageText',s.snapshot_text);
END $$;
CREATE FUNCTION public.hotelhub_accountant_case_event_replay(p_tenant uuid,p_actor text,p_case uuid,p_version text,p_event jsonb,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.hotel_accountant_case_events;BEGIN
 PERFORM public.hotelhub_settlement_owner(p_tenant,p_actor);
 IF p_request IS NULL OR p_version IS NULL OR p_version !~ '^[1-9]\d{0,18}$' OR p_version::numeric>=9223372036854775807 THEN RAISE EXCEPTION 'accountant_invalid_input'; END IF;
 SELECT * INTO e FROM public.hotel_accountant_case_events WHERE tenant_id=p_tenant AND request_id=p_request;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF e.case_id IS DISTINCT FROM p_case OR e.version<>p_version::bigint+1 OR e.event IS DISTINCT FROM p_event THEN RAISE EXCEPTION 'accountant_idempotency_conflict'; END IF;
 RETURN e.row_snapshot;
END $$;
CREATE FUNCTION public.hotelhub_accountant_case_read(p_tenant uuid,p_actor text,p_case uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.hotel_accountant_cases;BEGIN
 PERFORM public.hotelhub_settlement_owner(p_tenant,p_actor);
 SELECT * INTO c FROM public.hotel_accountant_cases WHERE tenant_id=p_tenant AND id=p_case;
 IF NOT FOUND THEN RAISE EXCEPTION 'accountant_scope_mismatch'; END IF;
 RETURN c.row_snapshot;
END $$;
CREATE FUNCTION public.hotelhub_accountant_statement_read(p_tenant uuid,p_actor text,p_statement uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.hotel_accountant_statements;BEGIN
 PERFORM public.hotelhub_settlement_owner(p_tenant,p_actor);
 SELECT * INTO s FROM public.hotel_accountant_statements WHERE tenant_id=p_tenant AND id=p_statement;
 IF NOT FOUND THEN RAISE EXCEPTION 'accountant_scope_mismatch'; END IF;
 RETURN jsonb_build_object('statementId',s.id,'digest',s.digest,'pageText',s.snapshot_text);
END $$;
DO $$ DECLARE r record;BEGIN
 FOR r IN SELECT p.oid::regprocedure AS sig,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'hotelhub_accountant_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',r.sig);
  IF r.proname IN ('hotelhub_accountant_case_open','hotelhub_accountant_case_read','hotelhub_accountant_case_event_replay','hotelhub_accountant_case_event','hotelhub_accountant_cases_read','hotelhub_accountant_statement','hotelhub_accountant_statement_read') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',r.sig); END IF;
 END LOOP;
END $$;
