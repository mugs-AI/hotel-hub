-- Preserve every existing timeline event while adding the one new transition.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='public.hotel_reservation_events'::regclass AND conname='hotel_reservation_events_type_valid';
 IF definition IS NULL OR definition NOT LIKE 'CHECK (%' THEN RAISE EXCEPTION 'no_show_event_contract_changed'; END IF;
 definition:=replace(definition,'CHECK (','CHECK (event_type = ''reservation_no_show'' OR ');
 ALTER TABLE public.hotel_reservation_events DROP CONSTRAINT hotel_reservation_events_type_valid;
 EXECUTE 'ALTER TABLE public.hotel_reservation_events ADD CONSTRAINT hotel_reservation_events_type_valid '||definition;
END $$;
-- Candidate only: operational installation is a separate Lovable-controlled lane.
-- A no-show has no posted bill intent. Bind its accountant review to its own
-- immutable action, reservation and retained receipts instead of inventing one.
CREATE TABLE public.hotel_no_show_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
 reservation_id uuid NOT NULL, client_request_id uuid NOT NULL,
 expected_updated_at timestamptz NOT NULL, reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 actor_n3_user_key text NOT NULL, outcome jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,client_request_id), UNIQUE(tenant_id,reservation_id,id),
 FOREIGN KEY(tenant_id,reservation_id) REFERENCES public.hotel_reservations(tenant_id,id)
);
CREATE TABLE public.hotel_no_show_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,reservation_id uuid NOT NULL,
 action_id uuid NOT NULL,version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewed','resolved')),
 receipt_refs jsonb NOT NULL, observed_amount_cents bigint, first_seen timestamptz NOT NULL DEFAULT clock_timestamp(),
 next_action text NOT NULL DEFAULT 'Review retained deposits in N3. Refund or reallocation requires a separate authorised action.',
 UNIQUE(tenant_id,action_id), FOREIGN KEY(tenant_id,reservation_id,action_id) REFERENCES public.hotel_no_show_actions(tenant_id,reservation_id,id),
 CHECK(observed_amount_cents IS NULL OR observed_amount_cents>=0)
);
ALTER TABLE public.hotel_no_show_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_no_show_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hotel_no_show_actions,public.hotel_no_show_reviews FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.hotel_no_show_actions,public.hotel_no_show_reviews TO service_role;
CREATE FUNCTION public.hh_no_show_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'no_show_action_immutable'; END $$;
REVOKE ALL ON FUNCTION public.hh_no_show_append_only() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER hh_no_show_actions_immutable BEFORE UPDATE OR DELETE ON public.hotel_no_show_actions FOR EACH ROW EXECUTE FUNCTION public.hh_no_show_append_only();
CREATE FUNCTION public.hh_mark_reservation_no_show(p_tenant_id uuid,p_reservation_id uuid,p_actor_n3_user_key text,p_expected_updated_at timestamptz,p_client_request_id uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.hotel_reservations%ROWTYPE; saved public.hotel_no_show_actions%ROWTYPE;
 at timestamptz; local_date date; tz text; ids uuid[]; refs jsonb; result jsonb; action_id uuid:=gen_random_uuid();
BEGIN
 PERFORM 1 FROM public.hotel_user_roles WHERE tenant_id=p_tenant_id AND n3_user_key=p_actor_n3_user_key AND role IN ('owner','front_desk') AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF p_expected_updated_at IS NULL OR p_client_request_id IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid_request'; END IF;
 SELECT * INTO r FROM public.hotel_reservations WHERE tenant_id=p_tenant_id AND id=p_reservation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'reservation_not_found'; END IF;
 SELECT * INTO saved FROM public.hotel_no_show_actions WHERE tenant_id=p_tenant_id AND client_request_id=p_client_request_id;
 IF FOUND THEN
  IF saved.reservation_id<>p_reservation_id OR saved.expected_updated_at<>p_expected_updated_at OR saved.reason<>btrim(p_reason) THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN saved.outcome;
 END IF;
 SELECT timezone INTO tz FROM public.hotel_settings WHERE tenant_id=p_tenant_id FOR SHARE;
 IF NOT FOUND OR tz IS NULL THEN RAISE EXCEPTION 'no_show_unavailable'; END IF;
 at:=clock_timestamp(); local_date:=(at AT TIME ZONE tz)::date;
 IF r.status<>'confirmed' OR r.checked_in_at IS NOT NULL OR r.arrival_date>=local_date THEN RAISE EXCEPTION 'no_show_ineligible'; END IF;
 IF r.updated_at<>p_expected_updated_at THEN RAISE EXCEPTION 'reservation_changed'; END IF;
 PERFORM 1 FROM public.hotel_reservation_rooms WHERE tenant_id=p_tenant_id AND reservation_id=r.id ORDER BY hotel_room_id,id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.hotel_reservation_rooms WHERE tenant_id=p_tenant_id AND reservation_id=r.id AND allocation_status='occupied') THEN RAISE EXCEPTION 'no_show_occupied'; END IF;
 -- Stabilise existing correction decisions/claims before taking receipt refs.
 PERFORM 1 FROM public.hotel_receipt_control_requests WHERE tenant_id=p_tenant_id AND reservation_id=r.id ORDER BY id FOR SHARE;
 IF EXISTS(SELECT 1 FROM public.hotel_receipt_control_requests WHERE tenant_id=p_tenant_id AND reservation_id=r.id AND state IN ('pending','approved_awaiting_n3','applying','failed','needs_review'))
 OR EXISTS(SELECT 1 FROM public.hotel_receipt_control_executions e JOIN public.hotel_receipt_control_requests q ON q.tenant_id=e.tenant_id AND q.id=e.request_id WHERE q.tenant_id=p_tenant_id AND q.reservation_id=r.id AND e.state='claimed') THEN RAISE EXCEPTION 'receipt_correction_pending'; END IF;
 SELECT coalesce(array_agg(hotel_room_id ORDER BY hotel_room_id),ARRAY[]::uuid[]) INTO ids FROM public.hotel_reservation_rooms WHERE tenant_id=p_tenant_id AND reservation_id=r.id AND allocation_status='reserved';
 SELECT coalesce(jsonb_agg(jsonb_build_object('depositId',id,'receiptId',n3_receipt_id,'docCode',n3_doc_code,'status',status) ORDER BY id),'[]'::jsonb) INTO refs FROM public.hotel_reservation_deposits WHERE tenant_id=p_tenant_id AND reservation_id=r.id AND status<>'failed';
 UPDATE public.hotel_reservation_rooms SET allocation_status='released' WHERE tenant_id=p_tenant_id AND reservation_id=r.id AND allocation_status='reserved';
 UPDATE public.hotel_reservations SET status='no_show',updated_at=at WHERE tenant_id=p_tenant_id AND id=r.id RETURNING * INTO r;
 result:=jsonb_build_object('reservationId',r.id,'status','no_show','updatedAt',r.updated_at,'releasedRoomIds',to_jsonb(ids),'accountingReviewRequired',jsonb_array_length(refs)>0);
 INSERT INTO public.hotel_no_show_actions(id,tenant_id,reservation_id,client_request_id,expected_updated_at,reason,actor_n3_user_key,outcome) VALUES(action_id,p_tenant_id,r.id,p_client_request_id,p_expected_updated_at,btrim(p_reason),p_actor_n3_user_key,result);
 IF jsonb_array_length(refs)>0 THEN
  INSERT INTO public.hotel_no_show_reviews(tenant_id,reservation_id,action_id,receipt_refs) VALUES(p_tenant_id,r.id,action_id,refs);
 END IF;
 INSERT INTO public.hotel_reservation_events(tenant_id,reservation_id,event_type,summary,actor_n3_user_key,metadata) VALUES(p_tenant_id,r.id,'reservation_no_show','Marked no-show; reserved rooms released',p_actor_n3_user_key,jsonb_build_object('actionId',action_id,'reason',btrim(p_reason),'releasedRoomIds',ids,'accountingReviewRequired',jsonb_array_length(refs)>0));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.hh_mark_reservation_no_show(uuid,uuid,text,timestamptz,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hh_mark_reservation_no_show(uuid,uuid,text,timestamptz,uuid,text) TO service_role;
