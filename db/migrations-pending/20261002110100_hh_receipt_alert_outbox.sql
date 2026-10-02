-- HotelHub receipt alert delivery (additive). STAGED — NOT APPLIED.
-- Adds delivery bookkeeping to the outbox. No provider, channel or recipient
-- is configured: transport stays disabled until the Owner selects one.

ALTER TABLE public.hotel_receipt_alert_outbox
  ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 10),
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN claimed_at timestamptz,
  ADD COLUMN sent_at timestamptz,
  ADD COLUMN last_error_code text CHECK (last_error_code IS NULL OR length(last_error_code) <= 64);

CREATE INDEX hotel_receipt_alert_outbox_due
  ON public.hotel_receipt_alert_outbox (tenant_id, status, next_attempt_at);

-- Claim due alerts once (SKIP LOCKED); stale 'sending' claims older than 10 minutes become claimable again.
CREATE OR REPLACE FUNCTION public.hotelhub_receipt_alert_claim(p_tenant_id uuid, p_limit integer)
RETURNS SETOF public.hotel_receipt_alert_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN QUERY
  UPDATE public.hotel_receipt_alert_outbox o
     SET status = 'sending', claimed_at = now(), attempts = o.attempts + 1
   WHERE o.id IN (
     SELECT id FROM public.hotel_receipt_alert_outbox
      WHERE tenant_id = p_tenant_id
        AND attempts < 10
        AND ((status IN ('pending','failed') AND next_attempt_at <= now())
             OR (status = 'sending' AND claimed_at < now() - interval '10 minutes'))
      ORDER BY created_at
      LIMIT greatest(1, least(p_limit, 50))
      FOR UPDATE SKIP LOCKED)
  RETURNING o.*;
END $$;

-- Record a delivery outcome with bounded exponential backoff.
CREATE OR REPLACE FUNCTION public.hotelhub_receipt_alert_settle(
  p_tenant_id uuid, p_alert_id uuid, p_status text, p_error_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_status NOT IN ('sent','failed','disabled') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  UPDATE public.hotel_receipt_alert_outbox
     SET status = p_status,
         sent_at = CASE WHEN p_status = 'sent' THEN now() ELSE sent_at END,
         last_error_code = p_error_code,
         next_attempt_at = CASE WHEN p_status = 'failed'
           THEN now() + least(interval '6 hours', interval '1 minute' * power(2, attempts)) ELSE next_attempt_at END
   WHERE id = p_alert_id AND tenant_id = p_tenant_id AND status = 'sending';
  IF NOT FOUND THEN RAISE EXCEPTION 'alert_not_claimed'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.hotelhub_receipt_alert_claim(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hotelhub_receipt_alert_settle(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hotelhub_receipt_alert_claim(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.hotelhub_receipt_alert_settle(uuid, uuid, text, text) TO service_role;

-- Rollback (manual, reviewed): DROP the two functions, DROP INDEX hotel_receipt_alert_outbox_due,
-- then DROP the five added columns.
