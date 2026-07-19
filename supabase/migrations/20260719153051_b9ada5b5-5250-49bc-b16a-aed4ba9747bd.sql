-- HotelHub foundation schema (Milestone 1.0.1)

CREATE TYPE public.hotel_role AS ENUM ('owner', 'front_desk', 'housekeeper');

-- 1. Tenants -----------------------------------------------------------------
CREATE TABLE public.hotel_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  n3_tenant_key TEXT NOT NULL UNIQUE,
  tenant_code TEXT,
  company_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.hotel_tenants TO service_role;
ALTER TABLE public.hotel_tenants ENABLE ROW LEVEL SECURITY;
-- Deny-by-default: no policies for anon/authenticated. Only service_role bypasses RLS.

CREATE INDEX hotel_tenants_status_idx ON public.hotel_tenants (status);

-- 2. Role assignments --------------------------------------------------------
CREATE TABLE public.hotel_user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.hotel_tenants(id) ON DELETE CASCADE,
  n3_user_key TEXT NOT NULL,
  role public.hotel_role NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, n3_user_key)
);
GRANT ALL ON public.hotel_user_roles TO service_role;
ALTER TABLE public.hotel_user_roles ENABLE ROW LEVEL SECURITY;
-- Deny-by-default: browser clients cannot self-assign role or tenant.

CREATE INDEX hotel_user_roles_tenant_idx ON public.hotel_user_roles (tenant_id);
CREATE INDEX hotel_user_roles_user_idx ON public.hotel_user_roles (n3_user_key);

-- 3. Audit events ------------------------------------------------------------
CREATE TABLE public.hotel_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.hotel_tenants(id) ON DELETE SET NULL,
  n3_user_key TEXT,
  event_type TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.hotel_audit_events TO service_role;
ALTER TABLE public.hotel_audit_events ENABLE ROW LEVEL SECURITY;
-- Deny-by-default. Audit is server-only.

CREATE INDEX hotel_audit_events_tenant_idx ON public.hotel_audit_events (tenant_id, created_at DESC);
CREATE INDEX hotel_audit_events_type_idx ON public.hotel_audit_events (event_type, created_at DESC);

-- updated_at trigger ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hotelhub_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER hotel_tenants_touch
  BEFORE UPDATE ON public.hotel_tenants
  FOR EACH ROW EXECUTE FUNCTION public.hotelhub_touch_updated_at();

CREATE TRIGGER hotel_user_roles_touch
  BEFORE UPDATE ON public.hotel_user_roles
  FOR EACH ROW EXECUTE FUNCTION public.hotelhub_touch_updated_at();
