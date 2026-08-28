-- HH-GOLIVE-01A — Authoritative folio, add-on catalogue and Malaysia
-- tax/levy readiness. ADDITIVE ONLY. No existing table, column, policy,
-- function or row is altered or dropped by this migration.
--
-- NOT EXECUTED. The approved scope forbids running migrations or touching
-- live data, so this file is staged here (outside supabase/migrations/,
-- which the platform executes on write) for review and later application.
--
-- Access model: identical to every other hotel_* table. RLS is enabled with
-- NO policies (Data API locked); all access happens through the server-only
-- service-role client behind the N3 session + RBAC guards.
--
-- Rollback, in this exact order:
--   1. drop function public.hotelhub_reverse_folio_line(uuid,uuid,uuid,text,uuid,text);
--   2. drop the seven tables, children first:
--        hotel_folio_operations, hotel_tourism_tax_evidence,
--        hotel_reservation_tax_profile, hotel_folio_lines, hotel_folios,
--        hotel_financial_settings, hotel_addon_catalogue;
--   3. drop the five enum types: hotel_guest_tax_class,
--        hotel_folio_line_status, hotel_folio_line_type, hotel_tax_class,
--        hotel_addon_category.
-- RLS stays enabled with no policies on every table above; rollback never
-- relaxes access on any pre-existing object.

-- ---------------------------------------------------------------- enums

do $$ begin
  create type public.hotel_addon_category as enum (
    'minibar','breakfast','laundry','extra_bed','early_check_in',
    'late_checkout','transport','room_service','damage_lost_item','other'
  );
exception when duplicate_object then null; end $$;

-- Tax/charge classification, deliberately separate from the merchandising
-- category: it decides which mapped N3 tax treatment applies.
do $$ begin
  create type public.hotel_tax_class as enum (
    'accommodation','food_and_beverage','parking','other_taxable_service',
    'non_taxable','service_charge','damage_compensation'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.hotel_folio_line_type as enum (
    'room_night','add_on','service_charge','service_tax','tourism_tax',
    'local_levy','discount','manual_adjustment','reversal'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.hotel_folio_line_status as enum ('draft','committed','reversed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.hotel_guest_tax_class as enum (
    'malaysian_citizen','malaysian_pr','foreign_tourist','other_exemption','unknown'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------- A. add-on catalogue

create table if not exists public.hotel_addon_catalogue (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.hotel_tenants(id) on delete cascade,
  category public.hotel_addon_category not null,
  tax_class public.hotel_tax_class not null,
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  description text check (description is null or length(description) <= 240),
  is_active boolean not null default true,
  default_unit_price_cents integer not null default 0
    check (default_unit_price_cents >= 0 and default_unit_price_cents <= 1000000000),
  -- Immutable N3 identifiers. Authorization/mapping always uses these ids.
  n3_stock_id text,
  n3_uom_id text,
  n3_tax_code_id text,
  -- Non-authoritative display snapshots (never used for decisions).
  n3_stock_code_snapshot text,
  n3_stock_name_snapshot text,
  n3_uom_snapshot text,
  n3_tax_code_snapshot text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists hotel_addon_catalogue_tenant_name_uidx
  on public.hotel_addon_catalogue (tenant_id, lower(btrim(display_name)));
create index if not exists hotel_addon_catalogue_tenant_active_idx
  on public.hotel_addon_catalogue (tenant_id, is_active, sort_order);

grant all on public.hotel_addon_catalogue to service_role;
alter table public.hotel_addon_catalogue enable row level security;

-- ------------------------------------------- B. property financial settings

create table if not exists public.hotel_financial_settings (
  tenant_id uuid primary key references public.hotel_tenants(id) on delete cascade,

  -- Whether THIS property is a registered Service Tax person. Room count
  -- alone never decides this — it is an explicit Owner setting.
  service_tax_registered boolean not null default false,

  -- Rates are stored in basis points and are NULL until the Owner configures
  -- them or a mapped N3 tax code supplies them. Never defaulted/guessed.
  service_tax_accommodation_rate_bp integer
    check (service_tax_accommodation_rate_bp is null
           or (service_tax_accommodation_rate_bp between 0 and 10000)),
  service_tax_fnb_rate_bp integer
    check (service_tax_fnb_rate_bp is null or (service_tax_fnb_rate_bp between 0 and 10000)),
  service_tax_parking_rate_bp integer
    check (service_tax_parking_rate_bp is null or (service_tax_parking_rate_bp between 0 and 10000)),
  service_tax_other_rate_bp integer
    check (service_tax_other_rate_bp is null or (service_tax_other_rate_bp between 0 and 10000)),

  n3_tax_code_accommodation_id text,
  n3_tax_code_accommodation_snapshot text,
  n3_tax_code_fnb_id text,
  n3_tax_code_fnb_snapshot text,
  n3_tax_code_parking_id text,
  n3_tax_code_parking_snapshot text,
  n3_tax_code_other_id text,
  n3_tax_code_other_snapshot text,
  n3_tax_code_exempt_id text,
  n3_tax_code_exempt_snapshot text,

  -- Commercial service charge. NOT a government tax.
  service_charge_enabled boolean not null default false,
  service_charge_percent_bp integer not null default 0
    check (service_charge_percent_bp between 0 and 10000),
  service_charge_service_tax_applies boolean not null default false,

  -- Tourism Tax — tenant configurable and effective dated.
  tourism_tax_enabled boolean not null default false,
  tourism_tax_cents_per_room_night integer not null default 0
    check (tourism_tax_cents_per_room_night between 0 and 100000),
  tourism_tax_effective_from date,
  tourism_tax_effective_to date,

  -- Generic state/local hotel levy (e.g. Perak Local Service Charge,
  -- Melaka Heritage Tax). No jurisdiction value is hard-coded.
  local_levy_enabled boolean not null default false,
  local_levy_label text check (local_levy_label is null or length(local_levy_label) <= 60),
  local_levy_cents_per_room_night integer not null default 0
    check (local_levy_cents_per_room_night between 0 and 100000),
  local_levy_effective_from date,
  local_levy_effective_to date,

  -- Rounding readiness. Nothing is posted to N3 in this slice.
  rounding_mode text not null default 'none'
    check (rounding_mode in ('none','nearest_5_cents','nearest_10_cents')),
  n3_rounding_account_id text,
  n3_rounding_account_snapshot text,

  updated_by_n3_user_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant all on public.hotel_financial_settings to service_role;
alter table public.hotel_financial_settings enable row level security;

-- ----------------------------------------------- C. authoritative folio

create table if not exists public.hotel_folios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.hotel_tenants(id) on delete cascade,
  reservation_id uuid not null references public.hotel_reservations(id) on delete cascade,
  currency text not null default 'MYR' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'open' check (status in ('open','prepared')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Exactly one folio per tenant/reservation.
create unique index if not exists hotel_folios_tenant_reservation_uidx
  on public.hotel_folios (tenant_id, reservation_id);

grant all on public.hotel_folios to service_role;
alter table public.hotel_folios enable row level security;

create table if not exists public.hotel_folio_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.hotel_tenants(id) on delete cascade,
  folio_id uuid not null references public.hotel_folios(id) on delete cascade,
  line_type public.hotel_folio_line_type not null,
  status public.hotel_folio_line_status not null default 'draft',

  source_reservation_room_id uuid references public.hotel_reservation_rooms(id) on delete set null,
  source_hotel_room_id uuid references public.hotel_rooms(id) on delete set null,
  stay_date date,
  catalogue_id uuid references public.hotel_addon_catalogue(id) on delete restrict,
  tax_class public.hotel_tax_class,

  description_snapshot text not null check (length(description_snapshot) between 1 and 160),
  quantity integer not null default 1 check (quantity > 0 and quantity <= 9999),
  unit_price_cents integer not null default 0,
  subtotal_cents integer not null default 0,
  tax_cents integer not null default 0,
  total_cents integer not null default 0,

  -- Frozen snapshot of the tax/levy configuration used for this line.
  tax_snapshot jsonb not null default '{}'::jsonb,

  actor_n3_user_key text not null,
  reason text check (reason is null or length(reason) between 3 and 240),
  reverses_line_id uuid references public.hotel_folio_lines(id) on delete restrict,
  client_request_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A reversal must always name what it reverses and why.
  constraint hotel_folio_lines_reversal_link_chk check (
    (line_type <> 'reversal') or (reverses_line_id is not null and reason is not null)
  )
);

create index if not exists hotel_folio_lines_folio_idx
  on public.hotel_folio_lines (tenant_id, folio_id, created_at);
create unique index if not exists hotel_folio_lines_request_uidx
  on public.hotel_folio_lines (tenant_id, client_request_id)
  where client_request_id is not null;
-- One derived room-night line per reservation room per stay date.
create unique index if not exists hotel_folio_lines_room_night_uidx
  on public.hotel_folio_lines (tenant_id, folio_id, source_reservation_room_id, stay_date)
  where line_type = 'room_night';
-- A committed line can be reversed exactly once.
create unique index if not exists hotel_folio_lines_reverses_uidx
  on public.hotel_folio_lines (tenant_id, reverses_line_id)
  where reverses_line_id is not null;

grant all on public.hotel_folio_lines to service_role;
alter table public.hotel_folio_lines enable row level security;

-- ------------------------------- reservation tax profile + TTx evidence

create table if not exists public.hotel_reservation_tax_profile (
  tenant_id uuid not null references public.hotel_tenants(id) on delete cascade,
  reservation_id uuid not null references public.hotel_reservations(id) on delete cascade,
  -- Classification only. Raw identity-document numbers are NEVER stored here.
  guest_tax_class public.hotel_guest_tax_class not null default 'unknown',
  evidence_note text check (evidence_note is null or length(evidence_note) <= 240),
  updated_by_n3_user_key text,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, reservation_id)
);

grant all on public.hotel_reservation_tax_profile to service_role;
alter table public.hotel_reservation_tax_profile enable row level security;

create table if not exists public.hotel_tourism_tax_evidence (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.hotel_tenants(id) on delete cascade,
  reservation_id uuid not null references public.hotel_reservations(id) on delete cascade,
  -- Manual evidence that an OTA / DPSP already collected Tourism Tax.
  -- No card, bank or other secret payment data is ever stored here.
  source_label text not null check (length(btrim(source_label)) between 2 and 60),
  reference text check (reference is null or length(reference) <= 80),
  collected_on date,
  amount_cents integer not null default 0 check (amount_cents between 0 and 100000000),
  note text check (note is null or length(note) <= 240),
  actor_n3_user_key text not null,
  client_request_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists hotel_tourism_tax_evidence_res_idx
  on public.hotel_tourism_tax_evidence (tenant_id, reservation_id, created_at);
create unique index if not exists hotel_tourism_tax_evidence_request_uidx
  on public.hotel_tourism_tax_evidence (tenant_id, client_request_id)
  where client_request_id is not null;

grant all on public.hotel_tourism_tax_evidence to service_role;
alter table public.hotel_tourism_tax_evidence enable row level security;
