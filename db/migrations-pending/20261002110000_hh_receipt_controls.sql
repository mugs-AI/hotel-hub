-- HotelHub receipt controls (additive). STAGED — NOT APPLIED.
-- Immutable correction/void requests, append-only Owner decisions, atomic
-- execution claims, append-only effective receipt versions and an alert
-- outbox. Existing deposit creation columns are not altered. Service-role only.

CREATE TABLE public.hotel_receipt_control_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.hotel_tenants(id),
  reservation_id uuid NOT NULL REFERENCES public.hotel_reservations(id),
  deposit_id uuid NOT NULL REFERENCES public.hotel_reservation_deposits(id),
  client_request_id uuid NOT NULL,
  request_fingerprint text NOT NULL CHECK (length(request_fingerprint) BETWEEN 16 AND 128),
  kind text NOT NULL CHECK (kind IN ('correction', 'void')),
  reason text NOT NULL CHECK (reason = btrim(reason) AND length(reason) BETWEEN 1 AND 500),
  original jsonb NOT NULL,
  proposal jsonb NOT NULL,
  comparison jsonb NOT NULL,
  original_amount_cents bigint NOT NULL CHECK (original_amount_cents > 0 AND original_amount_cents <= 100000000),
  proposed_amount_cents bigint CHECK (proposed_amount_cents IS NULL OR (proposed_amount_cents > 0 AND proposed_amount_cents <= 100000000)),
  execution_mode text NOT NULL DEFAULT 'manual' CHECK (execution_mode IN ('manual', 'direct', 'void_replace')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','rejected','approved_awaiting_n3','applying','applied','failed','needs_review')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  requested_by_n3_user_key text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by_n3_user_key text,
  decided_at timestamptz,
  outcome_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_receipt_control_requests_client_key UNIQUE (tenant_id, client_request_id),
  CONSTRAINT hotel_receipt_control_requests_kind_amount CHECK ((kind = 'void') = (proposed_amount_cents IS NULL))
);
CREATE UNIQUE INDEX hotel_receipt_control_one_active
  ON public.hotel_receipt_control_requests (tenant_id, deposit_id)
  WHERE state IN ('pending','approved_awaiting_n3','applying','failed','needs_review');
CREATE INDEX hotel_receipt_control_requests_queue
  ON public.hotel_receipt_control_requests (tenant_id, state, requested_at DESC);
CREATE INDEX hotel_receipt_control_requests_reservation
  ON public.hotel_receipt_control_requests (tenant_id, reservation_id);

CREATE TABLE public.hotel_receipt_control_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.hotel_tenants(id),
  request_id uuid NOT NULL REFERENCES public.hotel_receipt_control_requests(id),
  decision text NOT NULL CHECK (decision IN ('approve','reject','hold','verify')),
  from_state text NOT NULL,
  to_state text NOT NULL,
  actor_n3_user_key text NOT NULL,
  requester_n3_user_key text NOT NULL,
  self_approved boolean NOT NULL,
  outcome_code text,
  note text CHECK (note IS NULL OR length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hotel_receipt_control_decisions_request ON public.hotel_receipt_control_decisions (request_id);

CREATE TABLE public.hotel_receipt_control_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.hotel_tenants(id),
  request_id uuid NOT NULL REFERENCES public.hotel_receipt_control_requests(id),
  step text NOT NULL CHECK (step IN ('verify','edit','void','replace')),
  state text NOT NULL DEFAULT 'claimed' CHECK (state IN ('claimed','completed','released')),
  claimed_by_n3_user_key text NOT NULL,
  result_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
-- One in-flight claim per request; completed write steps can never be claimed twice.
CREATE UNIQUE INDEX hotel_receipt_control_executions_inflight
  ON public.hotel_receipt_control_executions (request_id) WHERE state = 'claimed';
CREATE UNIQUE INDEX hotel_receipt_control_executions_write_once
  ON public.hotel_receipt_control_executions (request_id, step) WHERE step <> 'verify' AND state = 'completed';

CREATE TABLE public.hotel_receipt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.hotel_tenants(id),
  deposit_id uuid NOT NULL REFERENCES public.hotel_reservation_deposits(id),
  request_id uuid NOT NULL REFERENCES public.hotel_receipt_control_requests(id),
  version_no integer NOT NULL CHECK (version_no >= 1),
  state text NOT NULL CHECK (state IN ('active','voided')),
  receipt_id text NOT NULL,
  doc_code text NOT NULL,
  document_date text NOT NULL,
  currency text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0 AND amount_cents <= 100000000),
  payment_lines jsonb NOT NULL,
  replacement_of text,
  evidence_fingerprint text NOT NULL,
  verified_by_n3_user_key text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_receipt_versions_seq UNIQUE (tenant_id, deposit_id, version_no)
);

CREATE TABLE public.hotel_receipt_alert_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.hotel_tenants(id),
  request_id uuid NOT NULL REFERENCES public.hotel_receipt_control_requests(id),
  event text NOT NULL CHECK (event IN ('pending','decision','execution_failure')),
  request_version integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_receipt_alert_outbox_once UNIQUE (tenant_id, request_id, event, request_version)
);

-- Service-role only. No browser role can read or write these tables.
REVOKE ALL ON public.hotel_receipt_control_requests, public.hotel_receipt_control_decisions,
  public.hotel_receipt_control_executions, public.hotel_receipt_versions,
  public.hotel_receipt_alert_outbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.hotel_receipt_control_requests, public.hotel_receipt_control_decisions,
  public.hotel_receipt_control_executions, public.hotel_receipt_versions,
  public.hotel_receipt_alert_outbox TO service_role;
ALTER TABLE public.hotel_receipt_control_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_receipt_control_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_receipt_control_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_receipt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_receipt_alert_outbox ENABLE ROW LEVEL SECURITY;

-- Immutability: original evidence/proposal/reason/identity never change; decisions and versions are append-only.
CREATE OR REPLACE FUNCTION public.hotelhub_receipt_control_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'receipt_control_immutable'; END IF;
  IF TG_TABLE_NAME <> 'hotel_receipt_control_requests' THEN RAISE EXCEPTION 'receipt_control_immutable'; END IF;
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.deposit_id <> OLD.deposit_id OR NEW.reservation_id <> OLD.reservation_id
     OR NEW.client_request_id <> OLD.client_request_id OR NEW.request_fingerprint <> OLD.request_fingerprint
     OR NEW.kind <> OLD.kind OR NEW.reason <> OLD.reason OR NEW.original <> OLD.original OR NEW.proposal <> OLD.proposal
     OR NEW.comparison <> OLD.comparison OR NEW.original_amount_cents <> OLD.original_amount_cents
     OR NEW.proposed_amount_cents IS DISTINCT FROM OLD.proposed_amount_cents
     OR NEW.requested_by_n3_user_key <> OLD.requested_by_n3_user_key OR NEW.requested_at <> OLD.requested_at THEN
    RAISE EXCEPTION 'receipt_control_immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER hotel_receipt_control_requests_guard BEFORE UPDATE OR DELETE ON public.hotel_receipt_control_requests
  FOR EACH ROW EXECUTE FUNCTION public.hotelhub_receipt_control_guard();
CREATE TRIGGER hotel_receipt_control_decisions_guard BEFORE UPDATE OR DELETE ON public.hotel_receipt_control_decisions
  FOR EACH ROW EXECUTE FUNCTION public.hotelhub_receipt_control_guard();
CREATE TRIGGER hotel_receipt_versions_guard BEFORE UPDATE OR DELETE ON public.hotel_receipt_versions
  FOR EACH ROW EXECUTE FUNCTION public.hotelhub_receipt_control_guard();

-- Create (idempotent on tenant + client_request_id) and queue the pending alert in one transaction.
CREATE OR REPLACE FUNCTION public.hotelhub_receipt_control_create(
  p_tenant_id uuid, p_reservation_id uuid, p_deposit_id uuid, p_client_request_id uuid,
  p_fingerprint text, p_kind text, p_reason text, p_original jsonb, p_proposal jsonb,
  p_comparison jsonb, p_original_cents bigint, p_proposed_cents bigint, p_actor text)
RETURNS SETOF public.hotel_receipt_control_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.hotel_receipt_control_requests;
BEGIN
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
END $$;

-- Row-locked compare-and-set decision. Records requester and approver separately.
CREATE OR REPLACE FUNCTION public.hotelhub_receipt_control_decide(
  p_tenant_id uuid, p_request_id uuid, p_expected_version integer, p_decision text,
  p_to_state text, p_actor text, p_outcome_code text, p_note text)
RETURNS SETOF public.hotel_receipt_control_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.hotel_receipt_control_requests; v_from text;
BEGIN
  SELECT * INTO v FROM public.hotel_receipt_control_requests
    WHERE id = p_request_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF v.version <> p_expected_version THEN RAISE EXCEPTION 'version_conflict'; END IF;
  v_from := v.state;
  IF NOT (
    (p_decision = 'approve' AND v_from = 'pending' AND p_to_state = 'approved_awaiting_n3') OR
    (p_decision = 'hold' AND v_from IN ('pending','approved_awaiting_n3') AND p_to_state = 'needs_review') OR
    (p_decision = 'reject' AND v_from IN ('pending','needs_review') AND p_to_state = 'rejected')
  ) THEN RAISE EXCEPTION 'invalid_transition'; END IF;
  UPDATE public.hotel_receipt_control_requests SET state = p_to_state, version = version + 1,
    decided_by_n3_user_key = CASE WHEN p_decision = 'hold' THEN decided_by_n3_user_key ELSE p_actor END,
    decided_at = CASE WHEN p_decision = 'hold' THEN decided_at ELSE now() END,
    outcome_code = p_outcome_code
    WHERE id = v.id RETURNING * INTO v;
  INSERT INTO public.hotel_receipt_control_decisions (tenant_id, request_id, decision, from_state, to_state,
    actor_n3_user_key, requester_n3_user_key, self_approved, outcome_code, note)
  VALUES (p_tenant_id, v.id, p_decision, v_from, p_to_state, p_actor, v.requested_by_n3_user_key,
    p_actor = v.requested_by_n3_user_key, p_outcome_code, p_note);
  INSERT INTO public.hotel_receipt_alert_outbox (tenant_id, request_id, event, request_version)
    VALUES (p_tenant_id, v.id, 'decision', v.version) ON CONFLICT DO NOTHING;
  RETURN NEXT v;
END $$;

-- Atomic execution claim. Returns NULL when another claim is in flight or the state is not claimable.
CREATE OR REPLACE FUNCTION public.hotelhub_receipt_control_claim(
  p_tenant_id uuid, p_request_id uuid, p_expected_version integer, p_step text, p_actor text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.hotel_receipt_control_requests; v_id uuid;
BEGIN
  SELECT * INTO v FROM public.hotel_receipt_control_requests
    WHERE id = p_request_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF v.version <> p_expected_version OR v.state NOT IN ('approved_awaiting_n3','needs_review') THEN RETURN NULL; END IF;
  INSERT INTO public.hotel_receipt_control_executions (tenant_id, request_id, step, claimed_by_n3_user_key)
    VALUES (p_tenant_id, v.id, p_step, p_actor) ON CONFLICT DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  IF v.state = 'approved_awaiting_n3' THEN
    UPDATE public.hotel_receipt_control_requests SET state = 'applying', version = version + 1 WHERE id = v.id;
  ELSE
    UPDATE public.hotel_receipt_control_requests SET version = version + 1 WHERE id = v.id;
  END IF;
  RETURN v_id;
END $$;

-- Complete a claim. A verified outcome appends the effective receipt version in the same transaction.
CREATE OR REPLACE FUNCTION public.hotelhub_receipt_control_complete(
  p_tenant_id uuid, p_request_id uuid, p_execution_id uuid, p_to_state text, p_outcome_code text,
  p_actor text, p_version jsonb)
RETURNS SETOF public.hotel_receipt_control_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.hotel_receipt_control_requests; v_from text; v_no integer;
BEGIN
  SELECT * INTO v FROM public.hotel_receipt_control_requests
    WHERE id = p_request_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  UPDATE public.hotel_receipt_control_executions SET state = 'completed', result_code = p_outcome_code, completed_at = now()
    WHERE id = p_execution_id AND request_id = v.id AND tenant_id = p_tenant_id AND state = 'claimed';
  IF NOT FOUND THEN RAISE EXCEPTION 'claim_not_found'; END IF;
  v_from := v.state;
  IF p_to_state NOT IN ('applied','needs_review','failed') OR (p_to_state = 'applied') <> (p_version IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid_transition';
  END IF;
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
END $$;

REVOKE ALL ON FUNCTION public.hotelhub_receipt_control_create(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,jsonb,bigint,bigint,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hotelhub_receipt_control_decide(uuid,uuid,integer,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hotelhub_receipt_control_claim(uuid,uuid,integer,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hotelhub_receipt_control_complete(uuid,uuid,uuid,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hotelhub_receipt_control_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hotelhub_receipt_control_create(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,jsonb,bigint,bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hotelhub_receipt_control_decide(uuid,uuid,integer,text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hotelhub_receipt_control_claim(uuid,uuid,integer,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hotelhub_receipt_control_complete(uuid,uuid,uuid,text,text,text,jsonb) TO service_role;

-- Rollback (manual, reviewed): DROP FUNCTION the four hotelhub_receipt_control_* functions and the guard,
-- then DROP TABLE hotel_receipt_alert_outbox, hotel_receipt_versions, hotel_receipt_control_executions,
-- hotel_receipt_control_decisions, hotel_receipt_control_requests. No existing table is modified.
