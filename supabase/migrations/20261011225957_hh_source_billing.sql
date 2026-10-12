-- CODE REVIEW CANDIDATE ONLY. Requires the billing candidate; no N3 activation.
-- N3-only identity: service-only RPCs verify the active scoped HotelHub role.
CREATE TABLE public.hotel_source_billing_installation (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 installed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.hotel_source_billing_installation(singleton) VALUES(true);
CREATE TABLE public.hotel_source_billing_policies (
 tenant_id uuid NOT NULL, source_id uuid NOT NULL,
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 default_collection_mode text NOT NULL CHECK(default_collection_mode IN ('guest','source')),
 allowed_collection_modes text[] NOT NULL,
 source_customer_id integer CHECK(source_customer_id>0),
 guest_customer_id integer NOT NULL CHECK(guest_customer_id>0),
 guest_document_title text NOT NULL CHECK(public.hotelhub_utf16_length(btrim(guest_document_title)) BETWEEN 1 AND 160),
 guest_item_description text NOT NULL CHECK(public.hotelhub_utf16_length(btrim(guest_item_description)) BETWEEN 1 AND 600),
 show_room_prices boolean NOT NULL,
 updated_by text, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,source_id),
 FOREIGN KEY(tenant_id,source_id) REFERENCES public.hotel_booking_sources(tenant_id,id),
 CHECK(cardinality(allowed_collection_modes) BETWEEN 1 AND 2 AND allowed_collection_modes <@ ARRAY['guest','source']::text[] AND default_collection_mode=ANY(allowed_collection_modes)),
 CHECK(NOT ('source'=ANY(allowed_collection_modes)) OR (source_customer_id IS NOT NULL AND source_customer_id<>guest_customer_id))
);
CREATE TABLE public.hotel_reservation_payers (
 tenant_id uuid NOT NULL,reservation_id uuid NOT NULL,source_id uuid NOT NULL,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 collection_mode text NOT NULL CHECK(collection_mode IN ('guest','source')),
 policy_snapshot jsonb NOT NULL CHECK(jsonb_typeof(policy_snapshot)='object'),
 confirmed_by text NOT NULL CHECK(length(btrim(confirmed_by))>0),
 confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,reservation_id),
 FOREIGN KEY(tenant_id,reservation_id) REFERENCES public.hotel_reservations(tenant_id,id),
 FOREIGN KEY(tenant_id,source_id) REFERENCES public.hotel_booking_sources(tenant_id,id)
);
CREATE INDEX hotel_reservation_payers_source ON public.hotel_reservation_payers(tenant_id,source_id);
CREATE TABLE public.hotel_source_billing_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,
 source_id uuid NOT NULL,reservation_id uuid,
 event text NOT NULL CHECK(event IN ('policy_updated','payer_confirmed')),
 actor text NOT NULL,previous jsonb,saved jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,source_id) REFERENCES public.hotel_booking_sources(tenant_id,id),
 FOREIGN KEY(tenant_id,reservation_id) REFERENCES public.hotel_reservations(tenant_id,id)
);
CREATE INDEX hotel_source_billing_audit_reservation ON public.hotel_source_billing_audit(tenant_id,reservation_id,recorded_at,id);
CREATE INDEX hotel_source_billing_audit_source ON public.hotel_source_billing_audit(tenant_id,source_id,recorded_at,id);
ALTER TABLE public.hotel_source_billing_installation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_source_billing_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_reservation_payers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_source_billing_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hotel_source_billing_installation,public.hotel_source_billing_policies,public.hotel_reservation_payers,public.hotel_source_billing_audit FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.hotel_source_billing_installation,public.hotel_source_billing_policies,public.hotel_reservation_payers,public.hotel_source_billing_audit TO service_role;

CREATE FUNCTION public.hh_source_billing_actor(p_tenant uuid,p_actor text,p_role text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_role IS NULL OR p_role NOT IN ('owner','front_desk') OR nullif(btrim(p_actor),'') IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.hotel_user_roles WHERE tenant_id=p_tenant AND n3_user_key=p_actor AND role::text=p_role AND is_active
 ) THEN RAISE EXCEPTION 'source_billing_forbidden'; END IF;
END $$;
CREATE FUNCTION public.hh_source_billing_policy_json(p public.hotel_source_billing_policies) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('sourceId',p.source_id,'version',p.version::text,
  'defaultCollectionMode',p.default_collection_mode,'allowedCollectionModes',to_jsonb(p.allowed_collection_modes),
  'sourceCustomerId',p.source_customer_id,'guestCustomerId',p.guest_customer_id,
  'guestDocumentTitle',p.guest_document_title,'guestItemDescription',p.guest_item_description,'showRoomPrices',p.show_room_prices)
$$;
CREATE FUNCTION public.hh_source_billing_payer_json(p public.hotel_reservation_payers) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('policy',p.policy_snapshot,'collectionMode',p.collection_mode,'confirmedBy',p.confirmed_by,'confirmedAt',p.confirmed_at)
$$;
CREATE FUNCTION public.hh_source_billing_audit_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'source_billing_audit_immutable'; END $$;
CREATE TRIGGER hotel_source_billing_audit_immutable BEFORE UPDATE OR DELETE ON public.hotel_source_billing_audit
 FOR EACH ROW EXECUTE FUNCTION public.hh_source_billing_audit_immutable();

-- Copy only the existing mapping once. This does not assert current N3 evidence
-- or classify historical reservations. No source/customer code-to-ID lookup.
CREATE FUNCTION public.hh_source_billing_seed_walkin(p_tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v text;s uuid;
BEGIN
 SELECT n3_walk_in_customer_id INTO v FROM public.hotel_settings WHERE tenant_id=p_tenant;
 IF v IS NULL OR v !~ '^[1-9][0-9]{0,9}$' THEN RETURN; END IF;
 IF v::numeric>2147483647 THEN RETURN; END IF;
 SELECT id INTO s FROM public.hotel_booking_sources WHERE tenant_id=p_tenant AND source_code='walk_in';
 IF s IS NULL THEN RETURN; END IF;
 INSERT INTO public.hotel_source_billing_policies(tenant_id,source_id,default_collection_mode,allowed_collection_modes,guest_customer_id,guest_document_title,guest_item_description,show_room_prices)
 VALUES(p_tenant,s,'guest',ARRAY['guest'],v::integer,'Sales Invoice','Accommodation',true)
 ON CONFLICT(tenant_id,source_id) DO NOTHING;
END $$;
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT tenant_id FROM public.hotel_settings LOOP PERFORM public.hh_source_billing_seed_walkin(t.tenant_id); END LOOP;
END $$;

CREATE FUNCTION public.hh_source_billing_policy_get(p_tenant uuid,p_source uuid,p_actor text,p_role text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.hotel_source_billing_policies;s public.hotel_booking_sources;
BEGIN
 PERFORM public.hh_source_billing_actor(p_tenant,p_actor,p_role);
 SELECT * INTO s FROM public.hotel_booking_sources WHERE tenant_id=p_tenant AND id=p_source;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO p FROM public.hotel_source_billing_policies WHERE tenant_id=p_tenant AND source_id=p_source;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('tenantId',p_tenant,'active',s.is_active,'policy',public.hh_source_billing_policy_json(p));
END $$;
CREATE FUNCTION public.hh_source_billing_reservation_get(p_tenant uuid,p_reservation uuid,p_actor text,p_role text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.hotel_reservations;p public.hotel_reservation_payers;s uuid;frozen boolean;
BEGIN
 PERFORM public.hh_source_billing_actor(p_tenant,p_actor,p_role);
 SELECT * INTO r FROM public.hotel_reservations WHERE tenant_id=p_tenant AND id=p_reservation;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT id INTO s FROM public.hotel_booking_sources WHERE tenant_id=p_tenant AND source_code=r.booking_source;
 SELECT * INTO p FROM public.hotel_reservation_payers WHERE tenant_id=p_tenant AND reservation_id=p_reservation;
 frozen:=r.status NOT IN ('confirmed','checked_in') OR EXISTS(SELECT 1 FROM public.hotel_settlement_intents WHERE tenant_id=p_tenant AND reservation_id=p_reservation AND state<>'abandoned');
 RETURN jsonb_build_object('tenantId',p_tenant,'reservationId',p_reservation,'sourceId',s,
  'revision',coalesce(p.revision,0)::text,'updatedAt',r.updated_at,'frozen',frozen,
  'payer',CASE WHEN p.reservation_id IS NULL THEN NULL ELSE public.hh_source_billing_payer_json(p) END);
END $$;
CREATE FUNCTION public.hh_source_billing_policy_put(p_tenant uuid,p_source uuid,p_actor text,p_role text,p_expected_version text,p_policy jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.hotel_source_billing_policies;previous jsonb;allowed text[];guest_id integer;v_source_customer integer;
BEGIN
 PERFORM public.hh_source_billing_actor(p_tenant,p_actor,p_role);
 IF p_role<>'owner' THEN RAISE EXCEPTION 'source_billing_forbidden'; END IF;
 IF p_expected_version IS NULL OR p_expected_version !~ '^(0|[1-9][0-9]{0,18})$' THEN RAISE EXCEPTION 'invalid_source_billing_policy'; END IF;
 IF p_expected_version::numeric>9223372036854775807 THEN RAISE EXCEPTION 'invalid_source_billing_policy'; END IF;
 PERFORM 1 FROM public.hotel_booking_sources WHERE tenant_id=p_tenant AND id=p_source AND is_active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'source_policy_scope_mismatch'; END IF;
 IF jsonb_typeof(p_policy) IS DISTINCT FROM 'object'
  OR p_policy-ARRAY['sourceId','version','defaultCollectionMode','allowedCollectionModes','sourceCustomerId','guestCustomerId','guestDocumentTitle','guestItemDescription','showRoomPrices']<>'{}'::jsonb
  OR p_policy->>'sourceId' IS DISTINCT FROM p_source::text OR p_policy->>'version' IS DISTINCT FROM p_expected_version
  OR jsonb_typeof(p_policy->'version') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_policy->'guestCustomerId') IS DISTINCT FROM 'number'
  OR coalesce(p_policy->>'guestCustomerId','') !~ '^[1-9][0-9]{0,9}$'
  OR jsonb_typeof(p_policy->'sourceCustomerId') NOT IN ('number','null') OR NOT (p_policy ? 'sourceCustomerId')
  OR jsonb_typeof(p_policy->'allowedCollectionModes') IS DISTINCT FROM 'array'
  OR jsonb_typeof(p_policy->'showRoomPrices') IS DISTINCT FROM 'boolean'
  OR jsonb_typeof(p_policy->'guestDocumentTitle') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_policy->'guestItemDescription') IS DISTINCT FROM 'string'
  OR public.hotelhub_utf16_length(btrim(p_policy->>'guestDocumentTitle')) NOT BETWEEN 1 AND 160
  OR public.hotelhub_utf16_length(btrim(p_policy->>'guestItemDescription')) NOT BETWEEN 1 AND 600
 THEN RAISE EXCEPTION 'invalid_source_billing_policy'; END IF;
 IF (p_policy->>'guestCustomerId')::numeric>2147483647 THEN RAISE EXCEPTION 'invalid_source_billing_policy'; END IF;
 guest_id:=(p_policy->>'guestCustomerId')::integer;
 IF p_policy->>'sourceCustomerId' IS NOT NULL THEN
  IF (p_policy->>'sourceCustomerId') !~ '^[1-9][0-9]{0,9}$' THEN RAISE EXCEPTION 'invalid_source_billing_policy'; END IF;
  IF (p_policy->>'sourceCustomerId')::numeric>2147483647 THEN RAISE EXCEPTION 'invalid_source_billing_policy'; END IF;
  v_source_customer:=(p_policy->>'sourceCustomerId')::integer;
 END IF;
 SELECT array_agg(value) INTO allowed FROM jsonb_array_elements_text(p_policy->'allowedCollectionModes');
 IF cardinality(allowed) IS NULL OR cardinality(allowed) NOT BETWEEN 1 AND 2 OR NOT (allowed <@ ARRAY['guest','source']::text[])
  OR cardinality(allowed)<>(SELECT count(DISTINCT x) FROM unnest(allowed) x)
  OR p_policy->>'defaultCollectionMode' IS NULL OR NOT (p_policy->>'defaultCollectionMode'=ANY(allowed))
  OR ('source'=ANY(allowed) AND (v_source_customer IS NULL OR v_source_customer=guest_id)) THEN RAISE EXCEPTION 'invalid_source_billing_policy'; END IF;
 SELECT * INTO p FROM public.hotel_source_billing_policies WHERE tenant_id=p_tenant AND source_id=p_source FOR UPDATE;
 IF coalesce(p.version,0)::text<>p_expected_version THEN RAISE EXCEPTION 'source_policy_version_conflict'; END IF;
 previous:=CASE WHEN p.source_id IS NULL THEN NULL ELSE public.hh_source_billing_policy_json(p) END;
 INSERT INTO public.hotel_source_billing_policies(tenant_id,source_id,default_collection_mode,allowed_collection_modes,source_customer_id,guest_customer_id,guest_document_title,guest_item_description,show_room_prices,updated_by)
 VALUES(p_tenant,p_source,p_policy->>'defaultCollectionMode',allowed,v_source_customer,guest_id,p_policy->>'guestDocumentTitle',p_policy->>'guestItemDescription',(p_policy->>'showRoomPrices')::boolean,p_actor)
 ON CONFLICT(tenant_id,source_id) DO UPDATE SET version=public.hotel_source_billing_policies.version+1,
  default_collection_mode=EXCLUDED.default_collection_mode,allowed_collection_modes=EXCLUDED.allowed_collection_modes,
  source_customer_id=EXCLUDED.source_customer_id,guest_customer_id=EXCLUDED.guest_customer_id,
  guest_document_title=EXCLUDED.guest_document_title,guest_item_description=EXCLUDED.guest_item_description,
  show_room_prices=EXCLUDED.show_room_prices,updated_by=p_actor,updated_at=clock_timestamp() RETURNING * INTO p;
 INSERT INTO public.hotel_source_billing_audit(tenant_id,source_id,event,actor,previous,saved)
 VALUES(p_tenant,p_source,'policy_updated',p_actor,previous,public.hh_source_billing_policy_json(p));
 RETURN public.hh_source_billing_policy_json(p);
END $$;
CREATE FUNCTION public.hh_source_billing_payer_confirm(p_tenant uuid,p_reservation uuid,p_actor text,p_role text,p_source uuid,p_mode text,p_expected_revision text,p_policy_version text,p_reservation_updated_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.hotel_reservations;p public.hotel_reservation_payers;policy public.hotel_source_billing_policies;previous jsonb;cutoff timestamptz;
BEGIN
 PERFORM public.hh_source_billing_actor(p_tenant,p_actor,p_role);
 PERFORM public.hotelhub_settlement_guard(p_tenant,p_reservation,true);
 SELECT * INTO r FROM public.hotel_reservations WHERE tenant_id=p_tenant AND id=p_reservation FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'reservation_not_found'; END IF;
 IF r.status NOT IN ('confirmed','checked_in') THEN RAISE EXCEPTION 'source_payer_frozen'; END IF;
 IF r.updated_at IS DISTINCT FROM p_reservation_updated_at THEN RAISE EXCEPTION 'source_payer_revision_conflict'; END IF;
 PERFORM 1 FROM public.hotel_booking_sources WHERE tenant_id=p_tenant AND id=p_source AND source_code=r.booking_source AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'source_policy_scope_mismatch'; END IF;
 SELECT * INTO policy FROM public.hotel_source_billing_policies WHERE tenant_id=p_tenant AND source_id=p_source FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'source_billing_policy_missing'; END IF;
 IF policy.version::text IS DISTINCT FROM p_policy_version THEN RAISE EXCEPTION 'source_policy_version_conflict'; END IF;
 IF p_mode IS NULL OR NOT (p_mode=ANY(policy.allowed_collection_modes)) THEN RAISE EXCEPTION 'source_collection_mode_not_allowed'; END IF;
 SELECT * INTO p FROM public.hotel_reservation_payers WHERE tenant_id=p_tenant AND reservation_id=p_reservation FOR UPDATE;
 IF coalesce(p.revision,0)::text IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'source_payer_revision_conflict'; END IF;
 SELECT installed_at INTO cutoff FROM public.hotel_source_billing_installation WHERE singleton;
 IF p_role<>'owner' AND (p.reservation_id IS NOT NULL OR r.created_at<=cutoff OR r.status<>'confirmed' OR r.created_by_n3_user_key<>p_actor) THEN RAISE EXCEPTION 'source_payer_owner_required'; END IF;
 previous:=CASE WHEN p.reservation_id IS NULL THEN NULL ELSE public.hh_source_billing_payer_json(p) END;
 INSERT INTO public.hotel_reservation_payers(tenant_id,reservation_id,source_id,collection_mode,policy_snapshot,confirmed_by)
 VALUES(p_tenant,p_reservation,p_source,p_mode,public.hh_source_billing_policy_json(policy),p_actor)
 ON CONFLICT(tenant_id,reservation_id) DO UPDATE SET revision=public.hotel_reservation_payers.revision+1,
  source_id=p_source,collection_mode=p_mode,policy_snapshot=EXCLUDED.policy_snapshot,confirmed_by=p_actor,confirmed_at=clock_timestamp()
 RETURNING * INTO p;
 UPDATE public.hotel_reservations SET updated_at=clock_timestamp() WHERE tenant_id=p_tenant AND id=p_reservation RETURNING * INTO r;
 INSERT INTO public.hotel_source_billing_audit(tenant_id,source_id,reservation_id,event,actor,previous,saved)
 VALUES(p_tenant,p_source,p_reservation,'payer_confirmed',p_actor,previous,public.hh_source_billing_payer_json(p));
 RETURN jsonb_build_object('tenantId',p_tenant,'reservationId',p_reservation,'sourceId',p_source,'revision',p.revision::text,
  'updatedAt',r.updated_at,'payer',public.hh_source_billing_payer_json(p));
END $$;

REVOKE ALL ON FUNCTION public.hh_source_billing_actor(uuid,text,text),public.hh_source_billing_policy_json(public.hotel_source_billing_policies),public.hh_source_billing_payer_json(public.hotel_reservation_payers),public.hh_source_billing_audit_immutable(),public.hh_source_billing_seed_walkin(uuid),public.hh_source_billing_policy_get(uuid,uuid,text,text),public.hh_source_billing_reservation_get(uuid,uuid,text,text),public.hh_source_billing_policy_put(uuid,uuid,text,text,text,jsonb),public.hh_source_billing_payer_confirm(uuid,uuid,text,text,uuid,text,text,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.hh_source_billing_seed_walkin(uuid),public.hh_source_billing_policy_get(uuid,uuid,text,text),public.hh_source_billing_reservation_get(uuid,uuid,text,text),public.hh_source_billing_policy_put(uuid,uuid,text,text,text,jsonb),public.hh_source_billing_payer_confirm(uuid,uuid,text,text,uuid,text,text,text,timestamptz) TO service_role;

-- Local HH identifiers only; N3 UUID/returned code remain separate accounting facts.
CREATE TABLE public.hotel_source_document_counters (
 tenant_id uuid NOT NULL REFERENCES public.hotel_tenants(id),series text NOT NULL CHECK(series IN ('bill','receipt','refund')),
 period text NOT NULL CHECK(period ~ '^[0-9]{4}$'),last_number integer NOT NULL CHECK(last_number BETWEEN 1 AND 99999),
 PRIMARY KEY(tenant_id,series,period)
);
CREATE TABLE public.hotel_source_document_numbers (
 tenant_id uuid NOT NULL,reservation_id uuid NOT NULL,series text NOT NULL CHECK(series IN ('bill','receipt','refund')),
 operation_id uuid NOT NULL,document_date date NOT NULL,hh_number text NOT NULL,
 actor text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,series,operation_id),UNIQUE(tenant_id,hh_number),
 FOREIGN KEY(tenant_id,reservation_id) REFERENCES public.hotel_reservations(tenant_id,id)
);
ALTER TABLE public.hotel_source_document_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_source_document_numbers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hotel_source_document_counters,public.hotel_source_document_numbers FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.hotel_source_document_counters,public.hotel_source_document_numbers TO service_role;
CREATE TRIGGER source_document_numbers_immutable BEFORE UPDATE OR DELETE ON public.hotel_source_document_numbers
 FOR EACH ROW EXECUTE FUNCTION public.hotelhub_settlement_immutable();
CREATE FUNCTION public.hh_source_document_number_reserve(p_tenant uuid,p_reservation uuid,p_actor text,p_series text,p_operation uuid,p_document_date date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved public.hotel_source_document_numbers;n integer;period_key text;prefix text;zone text;today date;
BEGIN
 PERFORM public.hotelhub_settlement_owner(p_tenant,p_actor);
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
REVOKE ALL ON FUNCTION public.hh_source_document_number_reserve(uuid,uuid,text,text,uuid,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.hh_source_document_number_reserve(uuid,uuid,text,text,uuid,date) TO service_role;

-- Durable partition and per-leg intent ownership. Candidate only; no operational apply.
CREATE TABLE public.hotel_source_billing_plans (
 tenant_id uuid NOT NULL,reservation_id uuid NOT NULL,
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 request_id uuid NOT NULL,payer_revision bigint NOT NULL CHECK(payer_revision>0),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),plan jsonb NOT NULL,
 actor text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,reservation_id),UNIQUE(tenant_id,reservation_id,digest),
 FOREIGN KEY(tenant_id,reservation_id) REFERENCES public.hotel_reservations(tenant_id,id),
 CHECK(jsonb_typeof(plan)='object' AND plan->>'digest'=digest)
);
CREATE TABLE public.hotel_source_billing_legs (
 tenant_id uuid NOT NULL,reservation_id uuid NOT NULL,leg_id uuid NOT NULL,
 plan_digest text NOT NULL,kind text NOT NULL CHECK(kind IN ('source_room','guest')),
 customer_id integer NOT NULL CHECK(customer_id>0),snapshot jsonb NOT NULL,
 hh_number text NOT NULL CHECK(hh_number ~ '^SI[0-9]{9}$'),
 PRIMARY KEY(tenant_id,reservation_id,leg_id),
 UNIQUE(tenant_id,reservation_id,kind),UNIQUE(tenant_id,hh_number),
 UNIQUE(tenant_id,reservation_id,leg_id,plan_digest,kind),
 FOREIGN KEY(tenant_id,reservation_id,plan_digest) REFERENCES public.hotel_source_billing_plans(tenant_id,reservation_id,digest),
 FOREIGN KEY(tenant_id,reservation_id,leg_id) REFERENCES public.hotel_settlement_intents(tenant_id,reservation_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(tenant_id,hh_number) REFERENCES public.hotel_source_document_numbers(tenant_id,hh_number)
);
ALTER TABLE public.hotel_settlement_intents ADD CONSTRAINT hotel_settlement_source_leg_fk
 FOREIGN KEY(tenant_id,reservation_id,source_leg_id,source_plan_digest,source_leg_kind)
 REFERENCES public.hotel_source_billing_legs(tenant_id,reservation_id,leg_id,plan_digest,kind) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE public.hotel_source_billing_line_membership (
 tenant_id uuid NOT NULL,reservation_id uuid NOT NULL,line_id uuid NOT NULL,
 leg_id uuid NOT NULL,line_snapshot jsonb NOT NULL,
 PRIMARY KEY(tenant_id,reservation_id,line_id),
 FOREIGN KEY(tenant_id,line_id) REFERENCES public.hotel_folio_lines(tenant_id,id),
 FOREIGN KEY(tenant_id,reservation_id,leg_id) REFERENCES public.hotel_source_billing_legs(tenant_id,reservation_id,leg_id)
);
ALTER TABLE public.hotel_source_billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_source_billing_legs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_source_billing_line_membership ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hotel_source_billing_plans,public.hotel_source_billing_legs,public.hotel_source_billing_line_membership FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.hotel_source_billing_plans,public.hotel_source_billing_legs,public.hotel_source_billing_line_membership TO service_role;
CREATE TRIGGER hotel_source_plan_immutable BEFORE UPDATE OR DELETE ON public.hotel_source_billing_plans FOR EACH ROW EXECUTE FUNCTION public.hotelhub_settlement_immutable();
CREATE TRIGGER hotel_source_leg_immutable BEFORE UPDATE OR DELETE ON public.hotel_source_billing_legs FOR EACH ROW EXECUTE FUNCTION public.hotelhub_settlement_immutable();
CREATE TRIGGER hotel_source_membership_immutable BEFORE UPDATE OR DELETE ON public.hotel_source_billing_line_membership FOR EACH ROW EXECUTE FUNCTION public.hotelhub_settlement_immutable();

CREATE FUNCTION public.hh_source_billing_leg_result(p_tenant_id uuid,p_reservation_id uuid,p_leg_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.hotelhub_settlement_read_intent(p_tenant_id,p_reservation_id,l.leg_id)
  ||jsonb_build_object('legId',l.leg_id,'legKind',l.kind,'planDigest',l.plan_digest,'hhNumber',l.hh_number)
 FROM public.hotel_source_billing_legs l WHERE l.tenant_id=p_tenant_id AND l.reservation_id=p_reservation_id AND l.leg_id=p_leg_id
$$;
CREATE FUNCTION public.hh_source_billing_read(p_tenant_id uuid,p_reservation_id uuid,p_actor text,p_role text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.hotel_source_billing_plans; BEGIN
 PERFORM public.hh_source_billing_actor(p_tenant_id,p_actor,p_role);
 SELECT * INTO p FROM public.hotel_source_billing_plans WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('tenantId',p_tenant_id,'reservationId',p_reservation_id,'revision',(p.revision::numeric+coalesce((SELECT sum(i.revision::numeric-1) FROM public.hotel_settlement_intents i WHERE i.tenant_id=p_tenant_id AND i.reservation_id=p_reservation_id AND i.source_plan_digest=p.digest),0))::text,'plan',p.plan,
  'legs',(SELECT jsonb_agg(public.hh_source_billing_leg_result(p_tenant_id,p_reservation_id,(v->>'legId')::uuid) ORDER BY n)
   FROM jsonb_array_elements(p.plan->'legs') WITH ORDINALITY AS a(v,n)));
END $$;
CREATE FUNCTION public.hh_source_billing_leg_bind(p_tenant_id uuid,p_reservation_id uuid,p_leg_id uuid,p_plan_digest text,p_intent_id uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF p_leg_id IS NULL OR p_plan_digest IS NULL OR p_intent_id IS DISTINCT FROM p_leg_id OR NOT EXISTS(
  SELECT 1 FROM public.hotel_source_billing_legs l JOIN public.hotel_settlement_intents i
   ON i.tenant_id=l.tenant_id AND i.reservation_id=l.reservation_id AND i.id=l.leg_id
  WHERE l.tenant_id=p_tenant_id AND l.reservation_id=p_reservation_id AND l.leg_id=p_leg_id AND l.plan_digest=p_plan_digest
   AND i.source_leg_id=l.leg_id AND i.source_plan_digest=l.plan_digest AND i.source_leg_kind=l.kind AND i.snapshot=l.snapshot
 ) THEN RAISE EXCEPTION 'settlement_scope_mismatch'; END IF;
END $$;
CREATE FUNCTION public.hh_source_billing_leg_read(p_tenant_id uuid,p_reservation_id uuid,p_actor text,p_role text,p_leg_id uuid,p_plan_digest text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM public.hh_source_billing_actor(p_tenant_id,p_actor,p_role);
 PERFORM public.hh_source_billing_leg_bind(p_tenant_id,p_reservation_id,p_leg_id,p_plan_digest,p_leg_id);
 RETURN public.hh_source_billing_leg_result(p_tenant_id,p_reservation_id,p_leg_id);
END $$;
-- Match snapshot activeLines: valid historical cancellation pairs remain fenced
-- in sourceVersions but are not re-billed or inserted as active membership.
CREATE FUNCTION public.hh_source_billing_active_lines(p_tenant_id uuid,p_folio_id uuid) RETURNS SETOF public.hotel_folio_lines
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rev public.hotel_folio_lines; original public.hotel_folio_lines; BEGIN
 FOR rev IN SELECT * FROM public.hotel_folio_lines WHERE tenant_id=p_tenant_id AND folio_id=p_folio_id AND line_type='reversal' LOOP
  SELECT * INTO original FROM public.hotel_folio_lines WHERE tenant_id=p_tenant_id AND folio_id=p_folio_id AND id=rev.reverses_line_id;
  IF NOT FOUND OR original.line_type IN ('room_night','reversal') OR original.status<>'reversed'
   OR (SELECT count(*) FROM public.hotel_folio_lines WHERE tenant_id=p_tenant_id AND folio_id=p_folio_id AND line_type='reversal' AND reverses_line_id=original.id)<>1
   OR rev.subtotal_cents IS DISTINCT FROM -original.subtotal_cents OR rev.tax_cents IS DISTINCT FROM -original.tax_cents OR rev.total_cents IS DISTINCT FROM -original.total_cents
   OR rev.n3_stock_id_snapshot IS DISTINCT FROM original.n3_stock_id_snapshot OR rev.n3_uom_id_snapshot IS DISTINCT FROM original.n3_uom_id_snapshot OR rev.n3_tax_code_id_snapshot IS DISTINCT FROM original.n3_tax_code_id_snapshot
  THEN RAISE EXCEPTION 'source_billing_charge_mismatch'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.hotel_folio_lines l WHERE l.tenant_id=p_tenant_id AND l.folio_id=p_folio_id AND l.status='reversed' AND l.line_type<>'reversal'
  AND NOT EXISTS(SELECT 1 FROM public.hotel_folio_lines v WHERE v.tenant_id=p_tenant_id AND v.folio_id=p_folio_id AND v.line_type='reversal' AND v.reverses_line_id=l.id))
 THEN RAISE EXCEPTION 'source_billing_charge_mismatch'; END IF;
 RETURN QUERY SELECT * FROM public.hotel_folio_lines WHERE tenant_id=p_tenant_id AND folio_id=p_folio_id AND status<>'reversed' AND line_type<>'reversal';
END $$;
CREATE FUNCTION public.hh_source_billing_freeze(p_tenant_id uuid,p_reservation_id uuid,p_actor text,p_plan jsonb,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.hotel_reservations; f public.hotel_folios; p public.hotel_source_billing_plans;
 payer public.hotel_reservation_payers; leg jsonb; snap jsonb; line jsonb; all_lines jsonb:='[]'; guest_receipts jsonb:='[]';
 v_id uuid; v_kind text; number jsonb; sources jsonb; guest_count integer:=0; source_count integer:=0;
 total bigint:=0; line_count integer:=0; active_ids uuid[];
BEGIN
 PERFORM public.hotelhub_settlement_owner(p_tenant_id,p_actor);
 SELECT * INTO r FROM public.hotel_reservations WHERE tenant_id=p_tenant_id AND id=p_reservation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
 SELECT * INTO p FROM public.hotel_source_billing_plans WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id;
 IF FOUND THEN
  IF p.request_id IS DISTINCT FROM p_request_id OR p.plan IS DISTINCT FROM p_plan THEN RAISE EXCEPTION 'settlement_conflicting_request'; END IF;
  RETURN public.hh_source_billing_read(p_tenant_id,p_reservation_id,p_actor,'owner');
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
 RETURN public.hh_source_billing_read(p_tenant_id,p_reservation_id,p_actor,'owner');
END $$;

CREATE FUNCTION public.hh_source_billing_leg_claim(p_tenant_id uuid,p_reservation_id uuid,p_actor text,p_leg_id uuid,p_plan_digest text,p_intent_id uuid,p_revision text,p_step text,p_receipt_id uuid,p_payload_digest text,p_dispatch_facts jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM public.hotelhub_settlement_owner(p_tenant_id,p_actor);
 PERFORM 1 FROM public.hotel_reservations WHERE tenant_id=p_tenant_id AND id=p_reservation_id FOR UPDATE;
 PERFORM public.hh_source_billing_leg_bind(p_tenant_id,p_reservation_id,p_leg_id,p_plan_digest,p_intent_id);
 RETURN public.hotelhub_settlement_claim(p_tenant_id,p_reservation_id,p_actor,p_intent_id,p_revision,p_step,p_receipt_id,p_payload_digest,p_dispatch_facts);
END $$;
CREATE FUNCTION public.hh_source_billing_leg_outcome(p_tenant_id uuid,p_reservation_id uuid,p_actor text,p_leg_id uuid,p_plan_digest text,p_intent_id uuid,p_revision text,p_attempt_id uuid,p_payload_digest text,p_outcome jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM public.hotelhub_settlement_owner(p_tenant_id,p_actor);
 PERFORM 1 FROM public.hotel_reservations WHERE tenant_id=p_tenant_id AND id=p_reservation_id FOR UPDATE;
 PERFORM public.hh_source_billing_leg_bind(p_tenant_id,p_reservation_id,p_leg_id,p_plan_digest,p_intent_id);
 PERFORM public.hotelhub_settlement_outcome(p_tenant_id,p_reservation_id,p_actor,p_intent_id,p_revision,p_attempt_id,p_payload_digest,p_outcome);
 RETURN public.hh_source_billing_leg_result(p_tenant_id,p_reservation_id,p_leg_id);
END $$;
CREATE FUNCTION public.hh_source_billing_leg_prove(p_tenant_id uuid,p_reservation_id uuid,p_actor text,p_leg_id uuid,p_plan_digest text,p_intent_id uuid,p_revision text,p_proof jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM public.hotelhub_settlement_owner(p_tenant_id,p_actor);
 PERFORM 1 FROM public.hotel_reservations WHERE tenant_id=p_tenant_id AND id=p_reservation_id FOR UPDATE;
 PERFORM public.hh_source_billing_leg_bind(p_tenant_id,p_reservation_id,p_leg_id,p_plan_digest,p_intent_id);
 IF (SELECT kind FROM public.hotel_source_billing_legs WHERE tenant_id=p_tenant_id AND reservation_id=p_reservation_id AND leg_id=p_leg_id)='source_room' AND p_proof->>'kind'<>'bill' THEN RAISE EXCEPTION 'source_billing_guest_action_required'; END IF;
 PERFORM public.hotelhub_settlement_prove(p_tenant_id,p_reservation_id,p_actor,p_intent_id,p_revision,p_proof);
 RETURN public.hh_source_billing_leg_result(p_tenant_id,p_reservation_id,p_leg_id);
END $$;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS sig,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('hh_source_billing_active_lines','hh_source_billing_leg_result','hh_source_billing_read','hh_source_billing_leg_bind','hh_source_billing_leg_read','hh_source_billing_freeze','hh_source_billing_leg_claim','hh_source_billing_leg_outcome','hh_source_billing_leg_prove') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',r.sig);
  IF r.proname IN ('hh_source_billing_read','hh_source_billing_leg_read','hh_source_billing_freeze','hh_source_billing_leg_claim','hh_source_billing_leg_outcome','hh_source_billing_leg_prove') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',r.sig); END IF;
 END LOOP;
END $$;
