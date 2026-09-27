-- Apply only with the matching HotelHub release.
alter table public.hotel_settings
  add column if not exists payment_account_aliases jsonb not null default '{}'::jsonb;

alter table public.hotel_reservation_deposits
  add column if not exists payment_lines jsonb;

create or replace function public.hotelhub_deposit_immutable_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.idempotency_key is distinct from old.idempotency_key
     or new.n3_reference_no is distinct from old.n3_reference_no
     or new.tenant_id is distinct from old.tenant_id
     or new.reservation_id is distinct from old.reservation_id
     or new.amount is distinct from old.amount
     or new.payment_lines is distinct from old.payment_lines then
    raise exception 'deposit_immutable_fields' using errcode = 'HH200';
  end if;
  return new;
end;
$$;
