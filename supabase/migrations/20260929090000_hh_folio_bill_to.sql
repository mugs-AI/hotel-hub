-- Guest-facing bill-to details are a reservation snapshot, separate from identity
-- and N3 customer records. This table contains no accounting postings.
create table if not exists public.hotel_folio_bill_to (
  tenant_id uuid not null,
  reservation_id uuid not null,
  name text not null default '',
  company text not null default '',
  address text not null default '',
  phone text not null default '',
  email text not null default '',
  updated_at timestamptz not null default now(),
  primary key (tenant_id, reservation_id),
  foreign key (tenant_id, reservation_id)
    references public.hotel_reservations (tenant_id, id) on delete cascade,
  constraint hotel_folio_bill_to_lengths check (
    length(name) <= 160 and length(company) <= 200 and
    length(address) <= 600 and length(phone) <= 60 and length(email) <= 254
  )
);
alter table public.hotel_folio_bill_to enable row level security;
revoke all on public.hotel_folio_bill_to from anon, authenticated;
grant select, insert, update on public.hotel_folio_bill_to to service_role;
