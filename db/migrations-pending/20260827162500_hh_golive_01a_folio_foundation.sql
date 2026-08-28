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
-- Rollback manifest — every object this migration creates, in this exact
-- dependency-safe order:
--   1. drop trigger if exists hotel_folio_lines_room_night_immutable
--        on public.hotel_folio_lines;
--   2. drop the functions:
--        drop function if exists public.hotelhub_add_tourism_tax_evidence(
--          uuid, uuid, text, text, date, integer, text, uuid, text, text);
--        drop function if exists public.hotelhub_update_folio_line_quantity(
--          uuid, uuid, uuid, integer, integer, integer, integer, integer, uuid, text, text);
--        drop function if exists public.hotelhub_add_folio_line(
--          uuid, uuid, text, public.hotel_folio_line_type, uuid, public.hotel_tax_class,
--          text, integer, integer, integer, integer, integer, jsonb, text, uuid, text, text);
--        drop function if exists public.hotelhub_reverse_folio_line(
--          uuid, uuid, uuid, text, uuid, text, text);
--        drop function if exists public.hotelhub_claim_folio_operation(
--          uuid, text, uuid, uuid, uuid, uuid, text, text);
--        drop function if exists public.hotelhub_release_folio_operation(
--          uuid, text, uuid);
--        drop function if exists public.hotelhub_folio_room_night_immutable();
--   3. drop the seven tables, children first:
--        hotel_folio_operations, hotel_tourism_tax_evidence,
--        hotel_reservation_tax_profile, hotel_folio_lines, hotel_folios,
--        hotel_financial_settings, hotel_addon_catalogue;
--      (their indexes — hotel_folio_operations_key_uidx,
--       hotel_folio_operations_target_idx, hotel_tourism_tax_evidence_res_idx,
--       hotel_folio_lines_folio_idx, hotel_folio_lines_room_night_uidx,
--       hotel_folio_lines_reverses_uidx, hotel_folios_tenant_reservation_uidx,
--       hotel_addon_catalogue_tenant_name_uidx,
--       hotel_addon_catalogue_tenant_active_idx — drop with their tables);
--   4. drop the five enum types: hotel_guest_tax_class,
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
  reservation_id uuid not null,
  currency text not null default 'MYR' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'open' check (status in ('open','prepared')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- TENANT-SCOPED relationship: the database itself refuses a folio that
  -- points at another tenant's reservation.
  constraint hotel_folios_tenant_reservation_fkey
    foreign key (tenant_id, reservation_id)
    references public.hotel_reservations (tenant_id, id) on delete cascade,
  -- Allows other tables to reference (tenant_id, id) compositely.
  constraint hotel_folios_tenant_id_uk unique (tenant_id, id)
);

-- Exactly one folio per tenant/reservation.
create unique index if not exists hotel_folios_tenant_reservation_uidx
  on public.hotel_folios (tenant_id, reservation_id);

grant all on public.hotel_folios to service_role;
alter table public.hotel_folios enable row level security;

create table if not exists public.hotel_folio_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.hotel_tenants(id) on delete cascade,
  folio_id uuid not null,
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

  -- IMMUTABLE ROOM-NIGHT SNAPSHOT. Frozen at check-in / explicit refresh so a
  -- later room remap, N3 stock remap or rate edit can never rewrite history.
  n3_stock_id_snapshot text,
  n3_stock_code_snapshot text,
  n3_stock_name_snapshot text,
  n3_uom_id_snapshot text,
  n3_tax_code_id_snapshot text,
  agreed_rate_cents_snapshot integer,
  room_label_snapshot text,
  settings_snapshot jsonb,
  snapshot_frozen_at timestamptz,

  -- Optimistic concurrency for the quantity edit: a stale PATCH loses.
  version integer not null default 1 check (version > 0),

  actor_n3_user_key text not null,
  reason text check (reason is null or length(reason) between 3 and 240),
  reverses_line_id uuid references public.hotel_folio_lines(id) on delete restrict,
  client_request_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A reversal must always name what it reverses and why.
  constraint hotel_folio_lines_reversal_link_chk check (
    (line_type <> 'reversal') or (reverses_line_id is not null and reason is not null)
  ),
  -- A room-night line is only valid with its frozen identity evidence.
  constraint hotel_folio_lines_room_night_snapshot_chk check (
    line_type <> 'room_night'
    or (stay_date is not null
        and source_reservation_room_id is not null
        and agreed_rate_cents_snapshot is not null
        and snapshot_frozen_at is not null
        and jsonb_typeof(settings_snapshot) = 'object')
  ),
  constraint hotel_folio_lines_tenant_folio_fkey
    foreign key (tenant_id, folio_id)
    references public.hotel_folios (tenant_id, id) on delete cascade,
  constraint hotel_folio_lines_tenant_id_uk unique (tenant_id, id)
);

create index if not exists hotel_folio_lines_folio_idx
  on public.hotel_folio_lines (tenant_id, folio_id, created_at);
-- One derived room-night line per reservation room per stay date.
create unique index if not exists hotel_folio_lines_room_night_uidx
  on public.hotel_folio_lines (tenant_id, folio_id, source_reservation_room_id, stay_date)
  where line_type = 'room_night';
-- A committed line can be reversed exactly once.
create unique index if not exists hotel_folio_lines_reverses_uidx
  on public.hotel_folio_lines (tenant_id, reverses_line_id)
  where reverses_line_id is not null;
--
-- NOTE: there is deliberately NO unique index on (tenant_id, client_request_id)
-- here. A bare request id is not an idempotency key — the operations ledger
-- (hotel_folio_operations) is the single authority, keyed by
-- (tenant, operation, client_request_id) and verified against target + body
-- fingerprint. A line-level request-id unique index would contradict that
-- model and would reject a legitimate different operation reusing an id.

grant all on public.hotel_folio_lines to service_role;
alter table public.hotel_folio_lines enable row level security;

-- Room-night snapshots are append-only history: once frozen, the financial
-- and identity evidence of the night can never be rewritten in place.
-- Corrections are made by reversal, never by mutation.
create or replace function public.hotelhub_folio_room_night_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.line_type = 'room_night' then
    if new.line_type is distinct from old.line_type
       or new.stay_date is distinct from old.stay_date
       or new.source_reservation_room_id is distinct from old.source_reservation_room_id
       or new.source_hotel_room_id is distinct from old.source_hotel_room_id
       or new.unit_price_cents is distinct from old.unit_price_cents
       or new.subtotal_cents is distinct from old.subtotal_cents
       or new.quantity is distinct from old.quantity
       or new.tax_class is distinct from old.tax_class
       or new.agreed_rate_cents_snapshot is distinct from old.agreed_rate_cents_snapshot
       or new.n3_stock_id_snapshot is distinct from old.n3_stock_id_snapshot
       or new.n3_stock_code_snapshot is distinct from old.n3_stock_code_snapshot
       or new.n3_stock_name_snapshot is distinct from old.n3_stock_name_snapshot
       or new.n3_uom_id_snapshot is distinct from old.n3_uom_id_snapshot
       or new.n3_tax_code_id_snapshot is distinct from old.n3_tax_code_id_snapshot
       or new.settings_snapshot is distinct from old.settings_snapshot
       or new.snapshot_frozen_at is distinct from old.snapshot_frozen_at
    then
      raise exception 'room_night_snapshot_immutable';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists hotel_folio_lines_room_night_immutable on public.hotel_folio_lines;
create trigger hotel_folio_lines_room_night_immutable
  before update on public.hotel_folio_lines
  for each row execute function public.hotelhub_folio_room_night_immutable();

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
  reservation_id uuid not null,
  -- Manual evidence that an OTA / DPSP already collected Tourism Tax.
  -- No card, bank or other secret payment data is ever stored here.
  source_label text not null check (length(btrim(source_label)) between 2 and 60),
  reference text check (reference is null or length(reference) <= 80),
  collected_on date,
  amount_cents integer not null default 0 check (amount_cents between 0 and 100000000),
  note text check (note is null or length(note) <= 240),
  actor_n3_user_key text not null,
  client_request_id uuid,
  created_at timestamptz not null default now(),
  constraint hotel_tourism_tax_evidence_tenant_res_fkey
    foreign key (tenant_id, reservation_id)
    references public.hotel_reservations (tenant_id, id) on delete cascade,
  constraint hotel_tourism_tax_evidence_tenant_id_uk unique (tenant_id, id)
);

create index if not exists hotel_tourism_tax_evidence_res_idx
  on public.hotel_tourism_tax_evidence (tenant_id, reservation_id, created_at);
-- No bare (tenant, client_request_id) unique index: the operations ledger is
-- the single idempotency authority (see section F).

grant all on public.hotel_tourism_tax_evidence to service_role;
alter table public.hotel_tourism_tax_evidence enable row level security;

-- ------------------- F. operation-scoped idempotency (target + fingerprint)
--
-- A client request id alone is NOT a safe idempotency key: the same id could
-- be replayed against a different operation, a different folio line, or with
-- a different payload. Every mutating folio operation therefore claims a row
-- keyed by (tenant, operation, client_request_id) and stores the immutable
-- target scope plus a fingerprint of the request. A replay with the same
-- fingerprint returns the original result; a replay with a different
-- fingerprint is a conflict and is refused.

create table if not exists public.hotel_folio_operations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.hotel_tenants(id) on delete cascade,
  operation text not null check (operation in (
    'folio.add_addon','folio.adjustment','folio.reverse',
    'folio.update_quantity','folio.tourism_tax_evidence'
  )),
  reservation_id uuid not null,
  folio_id uuid,
  target_line_id uuid,
  client_request_id uuid not null,
  -- SHA-256 hex of the canonical operation input (server-computed).
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  result_line_id uuid,
  -- Non-line results (Tourism Tax evidence) resolve their original row here,
  -- so an exact replay returns the stored evidence, never a null id.
  result_evidence_id uuid,
  actor_n3_user_key text not null,
  created_at timestamptz not null default now(),
  constraint hotel_folio_operations_tenant_res_fkey
    foreign key (tenant_id, reservation_id)
    references public.hotel_reservations (tenant_id, id) on delete cascade,
  constraint hotel_folio_operations_tenant_folio_fkey
    foreign key (tenant_id, folio_id)
    references public.hotel_folios (tenant_id, id) on delete cascade,
  constraint hotel_folio_operations_tenant_target_fkey
    foreign key (tenant_id, target_line_id)
    references public.hotel_folio_lines (tenant_id, id) on delete cascade,
  constraint hotel_folio_operations_tenant_result_fkey
    foreign key (tenant_id, result_line_id)
    references public.hotel_folio_lines (tenant_id, id) on delete cascade,
  constraint hotel_folio_operations_tenant_evidence_fkey
    foreign key (tenant_id, result_evidence_id)
    references public.hotel_tourism_tax_evidence (tenant_id, id) on delete cascade
);

-- EXACTLY ONE operation-key unique index. It is both the idempotency
-- authority and the serialization point used by the race-safe claim
-- (INSERT ... ON CONFLICT DO NOTHING) below.
create unique index if not exists hotel_folio_operations_key_uidx
  on public.hotel_folio_operations (tenant_id, operation, client_request_id);

create index if not exists hotel_folio_operations_target_idx
  on public.hotel_folio_operations (tenant_id, reservation_id, created_at);

grant all on public.hotel_folio_operations to service_role;
alter table public.hotel_folio_operations enable row level security;

-- ------------------- F.1 race-safe operation claim (one transaction only)
--
-- A claim must be safe under exact concurrency. `select ... for update`
-- followed by `insert` is NOT: two transactions can both observe no row and
-- the loser then receives a raw unique-violation instead of a safe replay.
--
-- The claim below is therefore an atomic INSERT ... ON CONFLICT DO NOTHING:
--   * winner  -> the insert returns its id, kind = 'new';
--   * loser   -> the insert blocks on the unique index until the winner
--                commits or aborts, then returns no row. It re-reads the row
--                FOR UPDATE and either replays the winner's stored result or
--                reports idempotency_conflict. If the winner aborted, the row
--                is gone and the loop retries the insert.
-- No caller ever sees a raw database constraint error on the duplicate path.
--
-- Callers MUST claim only after the target scope is locked, and MUST release
-- (delete) their own fresh claim on any deterministic validation failure, so
-- an empty claim can never commit and later replay as a false success.

create or replace function public.hotelhub_claim_folio_operation(
  p_tenant_id uuid,
  p_operation text,
  p_reservation_id uuid,
  p_folio_id uuid,
  p_target_line_id uuid,
  p_client_request_id uuid,
  p_request_fingerprint text,
  p_actor_n3_user_key text
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_claim public.hotel_folio_operations%rowtype;
  v_new_id uuid;
  v_attempt integer := 0;
begin
  loop
    v_attempt := v_attempt + 1;

    insert into public.hotel_folio_operations (
      tenant_id, operation, reservation_id, folio_id, target_line_id,
      client_request_id, request_fingerprint, actor_n3_user_key
    ) values (
      p_tenant_id, p_operation, p_reservation_id, p_folio_id, p_target_line_id,
      p_client_request_id, p_request_fingerprint, p_actor_n3_user_key
    )
    on conflict (tenant_id, operation, client_request_id) do nothing
    returning id into v_new_id;

    if v_new_id is not null then
      return jsonb_build_object(
        'ok', true, 'replay', false, 'claimed', true,
        'lineId', null, 'evidenceId', null
      );
    end if;

    select * into v_claim
    from public.hotel_folio_operations
    where tenant_id = p_tenant_id
      and operation = p_operation
      and client_request_id = p_client_request_id
    for update;

    if found then
      if v_claim.request_fingerprint is distinct from p_request_fingerprint
         or v_claim.reservation_id is distinct from p_reservation_id
         or v_claim.folio_id is distinct from p_folio_id
         or v_claim.target_line_id is distinct from p_target_line_id then
        return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
      end if;
      return jsonb_build_object(
        'ok', true, 'replay', true, 'claimed', false,
        'lineId', v_claim.result_line_id, 'evidenceId', v_claim.result_evidence_id
      );
    end if;

    -- The conflicting writer aborted: its row never became visible. Retry.
    if v_attempt >= 3 then
      return jsonb_build_object('ok', false, 'code', 'operation_claim_failed');
    end if;
  end loop;
end;
$$;

-- Release a claim this transaction just created, used on every deterministic
-- validation failure discovered after the claim.
create or replace function public.hotelhub_release_folio_operation(
  p_tenant_id uuid,
  p_operation text,
  p_client_request_id uuid
) returns void
language sql
set search_path = public
as $$
  delete from public.hotel_folio_operations
   where tenant_id = p_tenant_id
     and operation = p_operation
     and client_request_id = p_client_request_id;
$$;

-- ------------------------------- G. atomic, same-folio reversal (one txn)
--
-- Reversal must never be two independent statements: a crash between the
-- insert and the status update would leave a folio that is silently double
-- counted. This function proves the full immutable scope
-- (tenant + reservation + that reservation's folio + line) under a row lock,
-- claims the operation AFTER that lock (so a concurrent exact retry replays
-- the original reversal instead of seeing already_reversed), writes the
-- mirrored reversal, marks the original reversed, and records the result —
-- all inside the caller's single transaction.

create or replace function public.hotelhub_reverse_folio_line(
  p_tenant_id uuid,
  p_reservation_id uuid,
  p_line_id uuid,
  p_reason text,
  p_client_request_id uuid,
  p_actor_n3_user_key text,
  p_request_fingerprint text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folio_id uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_claim jsonb;
  v_line public.hotel_folio_lines%rowtype;
  v_reversal public.hotel_folio_lines%rowtype;
  v_code text;
begin
  if length(v_reason) < 3 or length(v_reason) > 240 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;

  -- Authoritative folio for THIS reservation, locked for the transaction.
  select f.id into v_folio_id
  from public.hotel_folios f
  where f.tenant_id = p_tenant_id and f.reservation_id = p_reservation_id
  for update;

  if v_folio_id is null then
    return jsonb_build_object('ok', false, 'code', 'folio_not_found');
  end if;

  -- Full immutable scope proof: tenant + folio + line, locked. A concurrent
  -- exact retry blocks HERE until the first writer commits.
  select * into v_line
  from public.hotel_folio_lines
  where tenant_id = p_tenant_id and folio_id = v_folio_id and id = p_line_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'line_not_found');
  end if;

  -- Re-check / take the operation claim AFTER serialization, and BEFORE any
  -- already_reversed decision.
  v_claim := public.hotelhub_claim_folio_operation(
    p_tenant_id, 'folio.reverse', p_reservation_id, v_folio_id, p_line_id,
    p_client_request_id, p_request_fingerprint, p_actor_n3_user_key
  );
  if (v_claim->>'ok')::boolean is not true then
    return v_claim;
  end if;
  if (v_claim->>'replay')::boolean then
    return jsonb_build_object('ok', true, 'replay', true,
                              'lineId', v_claim->>'lineId');
  end if;

  v_code := null;
  if v_line.line_type = 'room_night' then
    v_code := 'room_night_not_reversible';
  elsif v_line.line_type = 'reversal' then
    v_code := 'line_not_reversible';
  elsif v_line.status = 'reversed' then
    v_code := 'already_reversed';
  elsif exists (
    select 1 from public.hotel_folio_lines
    where tenant_id = p_tenant_id and reverses_line_id = p_line_id
  ) then
    v_code := 'already_reversed';
  end if;

  if v_code is not null then
    -- Never leave a committed empty claim that could later replay as success.
    perform public.hotelhub_release_folio_operation(
      p_tenant_id, 'folio.reverse', p_client_request_id
    );
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;

  insert into public.hotel_folio_lines (
    tenant_id, folio_id, line_type, status, tax_class, description_snapshot,
    quantity, unit_price_cents, subtotal_cents, tax_snapshot, reason,
    reverses_line_id, actor_n3_user_key, client_request_id
  ) values (
    p_tenant_id, v_folio_id, 'reversal', 'committed', v_line.tax_class,
    left('Reversal — ' || v_line.description_snapshot, 160),
    1, -v_line.subtotal_cents, -v_line.subtotal_cents,
    jsonb_build_object('source', 'reversal', 'reversesLineId', v_line.id),
    v_reason, v_line.id, p_actor_n3_user_key, p_client_request_id
  ) returning * into v_reversal;

  update public.hotel_folio_lines
     set status = 'reversed', updated_at = now()
   where tenant_id = p_tenant_id and folio_id = v_folio_id and id = v_line.id;

  update public.hotel_folio_operations
     set result_line_id = v_reversal.id
   where tenant_id = p_tenant_id
     and operation = 'folio.reverse'
     and client_request_id = p_client_request_id;

  return jsonb_build_object('ok', true, 'replay', false, 'lineId', v_reversal.id);
end;
$$;

revoke all on function public.hotelhub_reverse_folio_line(
  uuid, uuid, uuid, text, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.hotelhub_reverse_folio_line(
  uuid, uuid, uuid, text, uuid, text, text
) to service_role;

-- ------------- H. atomic add-on / adjustment / quantity / evidence writes
--
-- Every financial mutation below is ONE call inside ONE transaction: the
-- scope lock, the race-safe operation claim and the write cannot be
-- interleaved. Two concurrent identical requests cannot both insert a line —
-- the loser serializes on the operations unique index and replays the stored
-- result. Deterministic validation failures release their own claim, so no
-- empty claim can ever commit.
--
-- Money is computed by the audited pure TypeScript rules and passed in; the
-- database re-proves the arithmetic so a bad caller cannot write a folio line
-- whose parts do not add up.

create or replace function public.hotelhub_add_folio_line(
  p_tenant_id uuid,
  p_reservation_id uuid,
  p_operation text,
  p_line_type public.hotel_folio_line_type,
  p_catalogue_id uuid,
  p_tax_class public.hotel_tax_class,
  p_description text,
  p_quantity integer,
  p_unit_price_cents integer,
  p_subtotal_cents integer,
  p_tax_cents integer,
  p_total_cents integer,
  p_tax_snapshot jsonb,
  p_reason text,
  p_client_request_id uuid,
  p_actor_n3_user_key text,
  p_request_fingerprint text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folio_id uuid;
  v_claim jsonb;
  v_line public.hotel_folio_lines%rowtype;
begin
  -- All deterministic validation happens BEFORE any claim is taken.
  if p_operation not in ('folio.add_addon', 'folio.adjustment') then
    return jsonb_build_object('ok', false, 'code', 'operation_not_supported');
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 9999 then
    return jsonb_build_object('ok', false, 'code', 'quantity_invalid');
  end if;
  if p_subtotal_cents is distinct from (p_quantity * p_unit_price_cents)
     or p_total_cents is distinct from (p_subtotal_cents + coalesce(p_tax_cents, 0)) then
    return jsonb_build_object('ok', false, 'code', 'amount_mismatch');
  end if;

  select f.id into v_folio_id
  from public.hotel_folios f
  where f.tenant_id = p_tenant_id and f.reservation_id = p_reservation_id
  for update;

  if v_folio_id is null then
    return jsonb_build_object('ok', false, 'code', 'folio_not_found');
  end if;

  if p_catalogue_id is not null and not exists (
    select 1 from public.hotel_addon_catalogue c
    where c.tenant_id = p_tenant_id and c.id = p_catalogue_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'catalogue_item_not_found');
  end if;

  v_claim := public.hotelhub_claim_folio_operation(
    p_tenant_id, p_operation, p_reservation_id, v_folio_id, null,
    p_client_request_id, p_request_fingerprint, p_actor_n3_user_key
  );
  if (v_claim->>'ok')::boolean is not true then
    return v_claim;
  end if;
  if (v_claim->>'replay')::boolean then
    return jsonb_build_object('ok', true, 'replay', true,
                              'lineId', v_claim->>'lineId');
  end if;

  insert into public.hotel_folio_lines (
    tenant_id, folio_id, line_type, status, catalogue_id, tax_class,
    description_snapshot, quantity, unit_price_cents, subtotal_cents,
    tax_cents, total_cents, tax_snapshot, reason, actor_n3_user_key,
    client_request_id
  ) values (
    p_tenant_id, v_folio_id, p_line_type, 'draft', p_catalogue_id, p_tax_class,
    left(p_description, 160), p_quantity, p_unit_price_cents, p_subtotal_cents,
    coalesce(p_tax_cents, 0), p_total_cents, coalesce(p_tax_snapshot, '{}'::jsonb),
    p_reason, p_actor_n3_user_key, p_client_request_id
  ) returning * into v_line;

  update public.hotel_folio_operations
     set result_line_id = v_line.id
   where tenant_id = p_tenant_id
     and operation = p_operation
     and client_request_id = p_client_request_id;

  return jsonb_build_object('ok', true, 'replay', false, 'lineId', v_line.id);
end;
$$;

-- Quantity edit ordering, in this exact order:
--   folio lock -> line lock (serialization) -> claim re-check -> state and
--   version decisions -> update. An exact successful retry therefore replays
--   the original result even though the row version has advanced, and every
--   invalid/conflicting attempt releases its claim and writes nothing.
create or replace function public.hotelhub_update_folio_line_quantity(
  p_tenant_id uuid,
  p_reservation_id uuid,
  p_line_id uuid,
  p_expected_version integer,
  p_quantity integer,
  p_subtotal_cents integer,
  p_tax_cents integer,
  p_total_cents integer,
  p_client_request_id uuid,
  p_actor_n3_user_key text,
  p_request_fingerprint text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folio_id uuid;
  v_claim jsonb;
  v_line public.hotel_folio_lines%rowtype;
  v_code text;
begin
  if p_quantity is null or p_quantity < 1 or p_quantity > 9999 then
    return jsonb_build_object('ok', false, 'code', 'quantity_invalid');
  end if;

  select f.id into v_folio_id
  from public.hotel_folios f
  where f.tenant_id = p_tenant_id and f.reservation_id = p_reservation_id
  for update;

  if v_folio_id is null then
    return jsonb_build_object('ok', false, 'code', 'folio_not_found');
  end if;

  select * into v_line
  from public.hotel_folio_lines
  where tenant_id = p_tenant_id and folio_id = v_folio_id and id = p_line_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'line_not_found');
  end if;

  v_claim := public.hotelhub_claim_folio_operation(
    p_tenant_id, 'folio.update_quantity', p_reservation_id, v_folio_id, p_line_id,
    p_client_request_id, p_request_fingerprint, p_actor_n3_user_key
  );
  if (v_claim->>'ok')::boolean is not true then
    return v_claim;
  end if;
  if (v_claim->>'replay')::boolean then
    -- Exact retry: the original write already happened. Report it as such
    -- even though v_line.version has advanced past p_expected_version.
    return jsonb_build_object('ok', true, 'replay', true,
                              'lineId', coalesce(v_claim->>'lineId', p_line_id::text),
                              'version', v_line.version);
  end if;

  v_code := null;
  if v_line.line_type = 'room_night' then
    v_code := 'room_night_not_editable';
  elsif v_line.status <> 'draft' then
    v_code := 'line_not_editable';
  elsif v_line.version is distinct from p_expected_version then
    v_code := 'version_conflict';
  elsif p_subtotal_cents is distinct from (p_quantity * v_line.unit_price_cents)
     or p_total_cents is distinct from (p_subtotal_cents + coalesce(p_tax_cents, 0)) then
    v_code := 'amount_mismatch';
  end if;

  if v_code is not null then
    perform public.hotelhub_release_folio_operation(
      p_tenant_id, 'folio.update_quantity', p_client_request_id
    );
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;

  update public.hotel_folio_lines
     set quantity = p_quantity,
         subtotal_cents = p_subtotal_cents,
         tax_cents = coalesce(p_tax_cents, 0),
         total_cents = p_total_cents,
         version = v_line.version + 1,
         updated_at = now()
   where tenant_id = p_tenant_id and folio_id = v_folio_id and id = p_line_id;

  update public.hotel_folio_operations
     set result_line_id = p_line_id
   where tenant_id = p_tenant_id
     and operation = 'folio.update_quantity'
     and client_request_id = p_client_request_id;

  return jsonb_build_object('ok', true, 'replay', false, 'lineId', p_line_id,
                            'version', v_line.version + 1);
end;
$$;

create or replace function public.hotelhub_add_tourism_tax_evidence(
  p_tenant_id uuid,
  p_reservation_id uuid,
  p_source_label text,
  p_reference text,
  p_collected_on date,
  p_amount_cents integer,
  p_note text,
  p_client_request_id uuid,
  p_actor_n3_user_key text,
  p_request_fingerprint text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim jsonb;
  v_id uuid;
begin
  if p_amount_cents is null or p_amount_cents < 0 or p_amount_cents > 100000000 then
    return jsonb_build_object('ok', false, 'code', 'amount_invalid');
  end if;
  if not exists (
    select 1 from public.hotel_reservations r
    where r.tenant_id = p_tenant_id and r.id = p_reservation_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'reservation_not_found');
  end if;

  v_claim := public.hotelhub_claim_folio_operation(
    p_tenant_id, 'folio.tourism_tax_evidence', p_reservation_id, null, null,
    p_client_request_id, p_request_fingerprint, p_actor_n3_user_key
  );
  if (v_claim->>'ok')::boolean is not true then
    return v_claim;
  end if;
  if (v_claim->>'replay')::boolean then
    -- Resolve the ORIGINAL stored evidence row, never a null id.
    return jsonb_build_object('ok', true, 'replay', true,
                              'evidenceId', v_claim->>'evidenceId');
  end if;

  insert into public.hotel_tourism_tax_evidence (
    tenant_id, reservation_id, source_label, reference, collected_on,
    amount_cents, note, actor_n3_user_key, client_request_id
  ) values (
    p_tenant_id, p_reservation_id, btrim(p_source_label), p_reference, p_collected_on,
    p_amount_cents, p_note, p_actor_n3_user_key, p_client_request_id
  ) returning id into v_id;

  update public.hotel_folio_operations
     set result_evidence_id = v_id
   where tenant_id = p_tenant_id
     and operation = 'folio.tourism_tax_evidence'
     and client_request_id = p_client_request_id;

  return jsonb_build_object('ok', true, 'replay', false, 'evidenceId', v_id);
end;
$$;

revoke all on function public.hotelhub_claim_folio_operation(
  uuid, text, uuid, uuid, uuid, uuid, text, text
) from public, anon, authenticated;
revoke all on function public.hotelhub_release_folio_operation(
  uuid, text, uuid
) from public, anon, authenticated;
revoke all on function public.hotelhub_add_folio_line(
  uuid, uuid, text, public.hotel_folio_line_type, uuid, public.hotel_tax_class,
  text, integer, integer, integer, integer, integer, jsonb, text, uuid, text, text
) from public, anon, authenticated;
revoke all on function public.hotelhub_update_folio_line_quantity(
  uuid, uuid, uuid, integer, integer, integer, integer, integer, uuid, text, text
) from public, anon, authenticated;
revoke all on function public.hotelhub_add_tourism_tax_evidence(
  uuid, uuid, text, text, date, integer, text, uuid, text, text
) from public, anon, authenticated;

grant execute on function public.hotelhub_add_folio_line(
  uuid, uuid, text, public.hotel_folio_line_type, uuid, public.hotel_tax_class,
  text, integer, integer, integer, integer, integer, jsonb, text, uuid, text, text
) to service_role;
grant execute on function public.hotelhub_update_folio_line_quantity(
  uuid, uuid, uuid, integer, integer, integer, integer, integer, uuid, text, text
) to service_role;
grant execute on function public.hotelhub_add_tourism_tax_evidence(
  uuid, uuid, text, text, date, integer, text, uuid, text, text
) to service_role;
