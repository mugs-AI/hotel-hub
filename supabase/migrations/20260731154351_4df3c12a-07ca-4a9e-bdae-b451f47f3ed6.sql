CREATE TABLE public.hotel_reservation_deposits (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.hotel_tenants(id),
  reservation_id uuid NOT NULL,
  amount numeric(12,2) NOT NULL,
  currency_code text NOT NULL,
  idempotency_key text NOT NULL,
  n3_reference_no text NOT NULL,
  status text NOT NULL DEFAULT 'submitting',
  n3_receipt_id text,
  n3_doc_code text,
  n3_customer_id text,
  n3_customer_code text,
  n3_customer_name text,
  n3_account_id text,
  n3_account_code text,
  n3_account_name text,
  description text,
  created_by_n3_user_key text NOT NULL,
  last_error_code text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT hotel_reservation_deposits_reservation_fkey
    FOREIGN KEY (tenant_id, reservation_id)
    REFERENCES public.hotel_reservations(tenant_id, id),
  CONSTRAINT hotel_reservation_deposits_amount_positive CHECK (amount > 0),
  CONSTRAINT hotel_reservation_deposits_amount_scale CHECK (amount = round(amount, 2)),
  CONSTRAINT hotel_reservation_deposits_status_check
    CHECK (status IN ('submitting','posted','failed','unknown')),
  CONSTRAINT hotel_reservation_deposits_reference_len CHECK (char_length(n3_reference_no) <= 30),
  CONSTRAINT hotel_reservation_deposits_error_len CHECK (last_error_code IS NULL OR char_length(last_error_code) <= 64)
);

CREATE UNIQUE INDEX hotel_reservation_deposits_tenant_idem_uidx
  ON public.hotel_reservation_deposits (tenant_id, idempotency_key);
CREATE UNIQUE INDEX hotel_reservation_deposits_tenant_reference_uidx
  ON public.hotel_reservation_deposits (tenant_id, n3_reference_no);
CREATE UNIQUE INDEX hotel_reservation_deposits_tenant_receipt_uidx
  ON public.hotel_reservation_deposits (tenant_id, n3_receipt_id) WHERE n3_receipt_id IS NOT NULL;
CREATE UNIQUE INDEX hotel_reservation_deposits_tenant_doccode_uidx
  ON public.hotel_reservation_deposits (tenant_id, n3_doc_code) WHERE n3_doc_code IS NOT NULL;
CREATE INDEX hotel_reservation_deposits_tenant_reservation_idx
  ON public.hotel_reservation_deposits (tenant_id, reservation_id, created_at DESC);

GRANT ALL ON public.hotel_reservation_deposits TO service_role;

ALTER TABLE public.hotel_reservation_deposits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.hotelhub_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER hotel_reservation_deposits_touch_updated_at
BEFORE UPDATE ON public.hotel_reservation_deposits
FOR EACH ROW EXECUTE FUNCTION public.hotelhub_touch_updated_at();

CREATE OR REPLACE FUNCTION public.hotelhub_deposit_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.n3_reference_no IS DISTINCT FROM OLD.n3_reference_no
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.reservation_id IS DISTINCT FROM OLD.reservation_id
     OR NEW.amount IS DISTINCT FROM OLD.amount THEN
    RAISE EXCEPTION 'deposit_immutable_fields' USING ERRCODE = 'HH200';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER hotel_reservation_deposits_immutable
BEFORE UPDATE ON public.hotel_reservation_deposits
FOR EACH ROW EXECUTE FUNCTION public.hotelhub_deposit_immutable_fields();