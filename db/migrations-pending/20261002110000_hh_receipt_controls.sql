-- HotelHub receipt controls (additive). STAGED — NOT APPLIED.
-- Immutable correction/void requests, append-only Owner decisions, atomic
-- execution claims, append-only effective receipt versions and an alert
-- outbox. Existing deposit creation columns are not altered. Service-role only.
-- Every child row is bound by COMPOUND tenant-scoped foreign keys, so a row can
-- never point at another tenant's reservation, deposit or request.

-- Exact UTF-16 code-unit length (matches the browser/server JS limit):
-- astral characters (outside the BMP) count as two units.
CREATE OR REPLACE FUNCTION public.hotelhub_utf16_length(p text)
RETURNS integer LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = '' AS $$
  SELECT char_length(p) + char_length(regexp_replace(p, '[^\U00010000-\U0010FFFF]', '', 'g'))
$$;

-- Additive unique keys on the existing deposits table so compound FKs can
-- reference it. id is already the primary key, so these cannot fail on
-- existing data and change no existing column or behaviour.
ALTER TABLE public.hotel_reservation_deposits
  ADD CONSTRAINT hotel_reservation_deposits_tenant_id_uk UNIQUE (tenant_id, id),
  ADD CONSTRAINT hotel_reservation_deposits_tenant_res_id_uk UNIQUE (tenant_id, reservation_id, id);

CREATE TABLE public.hotel_receipt_control_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.hotel_tenants(id),
  reservation_id uuid NOT NULL,
  deposit_id uuid NOT NULL,
  client_request_id uuid NOT NULL,
  request_fingerprint text NOT NULL CHECK (length(request_fingerprint) BETWEEN 16 AND 128),
  kind text NOT NULL CHECK (kind IN ('correction', 'void')),
  reason text NOT NULL CHECK (reason = btrim(reason) AND public.hotelhub_utf16_length(reason) BETWEEN 1 AND 500),
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
  -- Set once by an Owner approval; a Hold never sets it. Verify requires it.
  approved_by_n3_user_key text,
  approved_at timestamptz,
  outcome_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_receipt_control_requests_client_key UNIQUE (tenant_id, client_request_id),
  CONSTRAINT hotel_receipt_control_requests_tenant_id_uk UNIQUE (tenant_id, id),
  CONSTRAINT hotel_receipt_control_requests_tenant_id_deposit_uk UNIQUE (tenant_id, id, deposit_id),
  CONSTRAINT hotel_receipt_control_requests_reservation_fk FOREIGN KEY (tenant_id, reservation_id)
    REFERENCES public.hotel_reservations (tenant_id, id),
  CONSTRAINT hotel_receipt_control_requests_deposit_fk FOREIGN KEY (tenant_id, reservation_id, deposit_id)
    REFERENCES public.hotel_reservation_deposits (tenant_id, reservation_id, id),
  CONSTRAINT hotel_receipt_control_requests_approval_pair CHECK ((approved_at IS NULL) = (approved_by_n3_user_key IS NULL)),
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
  request_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approve','reject','hold','verify','recover')),
  from_state text NOT NULL,
  to_state text NOT NULL,
  actor_n3_user_key text NOT NULL,
  requester_n3_user_key text NOT NULL,
  self_approved boolean NOT NULL,
  outcome_code text,
  note text CHECK (note IS NULL OR public.hotelhub_utf16_length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_receipt_control_decisions_request_fk FOREIGN KEY (tenant_id, request_id)
    REFERENCES public.hotel_receipt_control_requests (tenant_id, id)
);
CREATE INDEX hotel_receipt_control_decisions_request ON public.hotel_receipt_control_decisions (request_id);

CREATE TABLE public.hotel_receipt_control_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.hotel_tenants(id),
  request_id uuid NOT NULL,
  step text NOT NULL CHECK (step IN ('verify','edit','void','replace')),
  state text NOT NULL DEFAULT 'claimed' CHECK (state IN ('claimed','completed','released')),
  claimed_by_n3_user_key text NOT NULL,
  -- Request version produced by this claim; completion must still match it.
  claimed_version integer NOT NULL,
  result_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT hotel_receipt_control_executions_request_fk FOREIGN KEY (tenant_id, request_id)
    REFERENCES public.hotel_receipt_control_requests (tenant_id, id)
);
-- One in-flight claim per request; completed write steps can never be claimed twice.
CREATE UNIQUE INDEX hotel_receipt_control_executions_inflight
  ON public.hotel_receipt_control_executions (request_id) WHERE state = 'claimed';
CREATE UNIQUE INDEX hotel_receipt_control_executions_write_once
  ON public.hotel_receipt_control_executions (request_id, step) WHERE step <> 'verify' AND state = 'completed';

CREATE TABLE public.hotel_receipt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.hotel_tenants(id),
  deposit_id uuid NOT NULL,
  request_id uuid NOT NULL,
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
  CONSTRAINT hotel_receipt_versions_seq UNIQUE (tenant_id, deposit_id, version_no),
  CONSTRAINT hotel_receipt_versions_deposit_fk FOREIGN KEY (tenant_id, deposit_id)
    REFERENCES public.hotel_reservation_deposits (tenant_id, id),
  -- The version's deposit must be the request's deposit.
  CONSTRAINT hotel_receipt_versions_request_fk FOREIGN KEY (tenant_id, request_id, deposit_id)
    REFERENCES public.hotel_receipt_control_requests (tenant_id, id, deposit_id),
  CONSTRAINT hotel_receipt_versions_active_positive CHECK (state = 'voided' OR amount_cents > 0)
);

CREATE TABLE public.hotel_receipt_alert_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.hotel_tenants(id),
  request_id uuid NOT NULL,
  event text NOT NULL CHECK (event IN ('pending','decision','execution_failure')),
  request_version integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_receipt_alert_outbox_once UNIQUE (tenant_id, request_id, event, request_version),
  CONSTRAINT hotel_receipt_alert_outbox_request_fk FOREIGN KEY (tenant_id, request_id)
    REFERENCES public.hotel_receipt_control_requests (tenant_id, id)
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
     OR NEW.requested_by_n3_user_key <> OLD.requested_by_n3_user_key OR NEW.requested_at <> OLD.requested_at
     OR NEW.execution_mode <> OLD.execution_mode
     OR (OLD.approved_at IS NOT NULL AND (NEW.approved_at IS DISTINCT FROM OLD.approved_at
         OR NEW.approved_by_n3_user_key IS DISTINCT FROM OLD.approved_by_n3_user_key)) THEN
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
END $$;

-- Atomic execution claim. Returns NULL when another claim is in flight or the state is not claimable.
-- Only an APPROVED request can be claimed: pending -> Hold -> Needs review has no approval and can never verify.
CREATE OR REPLACE FUNCTION public.hotelhub_receipt_control_claim(
  p_tenant_id uuid, p_request_id uuid, p_expected_version integer, p_step text, p_actor text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.hotel_receipt_control_requests; v_id uuid;
BEGIN
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
END $$;

-- Complete a claim. A verified outcome appends the effective receipt version in the same transaction.
CREATE OR REPLACE FUNCTION public.hotelhub_receipt_control_complete(
  p_tenant_id uuid, p_request_id uuid, p_execution_id uuid, p_to_state text, p_outcome_code text,
  p_actor text, p_version jsonb)
RETURNS SETOF public.hotel_receipt_control_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.hotel_receipt_control_requests; v_from text; v_no integer; v_exec public.hotel_receipt_control_executions;
BEGIN
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
END $$;

-- Manual Verify in ONE transaction: claim + complete (+ effective version) commit
-- together or not at all. A crash or RPC failure can no longer leave a request
-- Applying with a claim held forever. The N3 GET readback happens before this
-- call; no N3 write or retry exists here.
CREATE OR REPLACE FUNCTION public.hotelhub_receipt_control_verify_atomic(
  p_tenant_id uuid, p_request_id uuid, p_expected_version integer, p_actor text,
  p_to_state text, p_outcome_code text, p_version jsonb)
RETURNS SETOF public.hotel_receipt_control_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_exec uuid;
BEGIN
  v_exec := public.hotelhub_receipt_control_claim(p_tenant_id, p_request_id, p_expected_version, 'verify', p_actor);
  IF v_exec IS NULL THEN RAISE EXCEPTION 'claim_conflict'; END IF;
  RETURN QUERY SELECT * FROM public.hotelhub_receipt_control_complete(
    p_tenant_id, p_request_id, v_exec, p_to_state, p_outcome_code, p_actor, p_version);
END $$;

-- Owner recovery of an interrupted verification (legacy split claim/complete or
-- any crashed worker). Read-only toward N3. Only a claim older than the stale
-- window is released; the request version is bumped so the old worker's
-- complete() fails (its claim is no longer 'claimed' and the version moved).
-- Applying returns to approved_awaiting_n3 (approval kept) so the Owner can
-- Verify again against fresh N3 readback. Terminal states are never touched.
CREATE OR REPLACE FUNCTION public.hotelhub_receipt_control_recover(
  p_tenant_id uuid, p_request_id uuid, p_expected_version integer, p_actor text,
  p_stale_seconds integer)
RETURNS SETOF public.hotel_receipt_control_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.hotel_receipt_control_requests; v_exec public.hotel_receipt_control_executions; v_from text;
BEGIN
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
END $$;

REVOKE ALL ON FUNCTION public.hotelhub_receipt_control_create(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,jsonb,bigint,bigint,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hotelhub_receipt_control_decide(uuid,uuid,integer,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hotelhub_receipt_control_claim(uuid,uuid,integer,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hotelhub_receipt_control_complete(uuid,uuid,uuid,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hotelhub_receipt_control_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hotelhub_utf16_length(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hotelhub_utf16_length(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hotelhub_receipt_control_create(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,jsonb,bigint,bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hotelhub_receipt_control_decide(uuid,uuid,integer,text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hotelhub_receipt_control_claim(uuid,uuid,integer,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hotelhub_receipt_control_complete(uuid,uuid,uuid,text,text,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.hotelhub_receipt_control_verify_atomic(uuid,uuid,integer,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hotelhub_receipt_control_recover(uuid,uuid,integer,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hotelhub_receipt_control_verify_atomic(uuid,uuid,integer,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.hotelhub_receipt_control_recover(uuid,uuid,integer,text,integer) TO service_role;

-- Rollback (manual, reviewed): DROP FUNCTION the four hotelhub_receipt_control_* functions and the guard,
-- then DROP TABLE hotel_receipt_alert_outbox, hotel_receipt_versions, hotel_receipt_control_executions,
-- hotel_receipt_control_decisions, hotel_receipt_control_requests, DROP FUNCTION hotelhub_utf16_length,
-- and ALTER TABLE hotel_reservation_deposits DROP CONSTRAINT the two additive *_uk keys.
-- No existing column, row or policy is modified.
