-- hotel_settings: one row per tenant
CREATE TABLE public.hotel_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.hotel_tenants(id) ON DELETE CASCADE,
  currency text NOT NULL DEFAULT 'MYR',
  timezone text NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  standard_check_in_time text NOT NULL DEFAULT '14:00',
  standard_check_out_time text NOT NULL DEFAULT '12:00',
  n3_walk_in_customer_id text,
  n3_walk_in_customer_code text,
  n3_walk_in_customer_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.hotel_settings TO service_role;
-- No grants to anon/authenticated: deny-by-default, only service role reaches this table.

ALTER TABLE public.hotel_settings ENABLE ROW LEVEL SECURITY;
-- No policies added intentionally — access is limited to service_role (bypasses RLS).

CREATE TRIGGER hotel_settings_touch_updated_at
  BEFORE UPDATE ON public.hotel_settings
  FOR EACH ROW EXECUTE FUNCTION public.hotelhub_touch_updated_at();

-- hotel_rooms: tenant-scoped room master mapped to N3 stock codes.
CREATE TABLE public.hotel_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.hotel_tenants(id) ON DELETE CASCADE,
  n3_stock_id text NOT NULL,
  n3_stock_code text NOT NULL,
  n3_stock_name text,
  room_number text NOT NULL,
  display_name text,
  room_type text NOT NULL DEFAULT 'standard',
  floor text,
  max_occupancy integer NOT NULL DEFAULT 2,
  base_rate numeric(12,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_rooms_max_occupancy_positive CHECK (max_occupancy >= 1),
  CONSTRAINT hotel_rooms_base_rate_nonnegative CHECK (base_rate >= 0),
  CONSTRAINT hotel_rooms_number_matches_stock CHECK (room_number = n3_stock_code)
);

-- One room per stock code per tenant. Cross-tenant duplicates ARE allowed.
CREATE UNIQUE INDEX hotel_rooms_tenant_stock_code_key
  ON public.hotel_rooms (tenant_id, n3_stock_code);

GRANT ALL ON public.hotel_rooms TO service_role;
ALTER TABLE public.hotel_rooms ENABLE ROW LEVEL SECURITY;
-- Deny-by-default: no policies. Only server-side service role reads/writes.

CREATE TRIGGER hotel_rooms_touch_updated_at
  BEFORE UPDATE ON public.hotel_rooms
  FOR EACH ROW EXECUTE FUNCTION public.hotelhub_touch_updated_at();

-- New audit event types are logged as free-form strings; no enum to update.
