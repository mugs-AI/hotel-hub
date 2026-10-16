-- Prepared review candidate only. No N3 financial operations or custody records.
begin;
create table public.hotel_deposit_module_policies (
  tenant_id uuid primary key,
  room_advance_enabled boolean not null default true,
  security_deposit_enabled boolean not null default false,
  -- Installation marker: a future reviewed custody migration sets this. The
  -- Owner settings RPC cannot change it and no environment toggle enables it.
  security_module_ready boolean not null default false,
  version uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by text not null
);
create table public.hotel_deposit_module_policy_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.hotel_deposit_module_policies(tenant_id),
  actor text not null,
  previous_policy jsonb not null,
  current_policy jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index hotel_deposit_module_policy_events_tenant_time
  on public.hotel_deposit_module_policy_events(tenant_id,created_at,id);
alter table public.hotel_deposit_module_policies enable row level security;
alter table public.hotel_deposit_module_policy_events enable row level security;
revoke all on public.hotel_deposit_module_policies,public.hotel_deposit_module_policy_events from public,anon,authenticated;
grant select,insert,update on public.hotel_deposit_module_policies to service_role;
grant select,insert on public.hotel_deposit_module_policy_events to service_role;

create function public.hh_update_deposit_module_policy(
  p_tenant uuid,p_actor text,p_expected_version text,p_advance boolean,p_security boolean
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  saved public.hotel_deposit_module_policies%rowtype;
  previous jsonb;
  inserted integer;
begin
  if p_tenant is null or p_actor is null or btrim(p_actor)='' or length(p_actor)>500
    or p_expected_version is null or p_advance is null or p_security is null then
    raise exception 'invalid_deposit_module_policy';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hh_deposit_module_policy:'||p_tenant::text,0));
  insert into public.hotel_deposit_module_policies(tenant_id,updated_by)
    values(p_tenant,p_actor) on conflict(tenant_id) do nothing;
  get diagnostics inserted=row_count;
  select * into strict saved from public.hotel_deposit_module_policies where tenant_id=p_tenant for update;
  if (inserted=1 and p_expected_version<>'0') or
     (inserted=0 and saved.version::text<>p_expected_version) then
    raise exception 'deposit_module_policy_conflict';
  end if;
  if p_security and not saved.security_module_ready then
    raise exception 'security_deposit_unavailable';
  end if;
  previous := case when inserted=1 then jsonb_build_object('room_advance_enabled',true,'security_deposit_enabled',false,'version','0') else to_jsonb(saved) end;
  update public.hotel_deposit_module_policies set room_advance_enabled=p_advance,
    security_deposit_enabled=p_security,version=gen_random_uuid(),updated_at=clock_timestamp(),updated_by=p_actor
    where tenant_id=p_tenant returning * into saved;
  insert into public.hotel_deposit_module_policy_events(tenant_id,actor,previous_policy,current_policy)
    values(p_tenant,p_actor,previous,to_jsonb(saved));
  return to_jsonb(saved);
end;
$$;
revoke all on function public.hh_update_deposit_module_policy(uuid,text,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.hh_update_deposit_module_policy(uuid,text,text,boolean,boolean) to service_role;

create function public.hh_guard_room_advance_collection()
returns trigger language plpgsql security invoker set search_path='' as $$
declare enabled boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hh_deposit_module_policy:'||new.tenant_id::text,0));
  select room_advance_enabled into enabled from public.hotel_deposit_module_policies where tenant_id=new.tenant_id;
  if enabled is false then raise exception 'room_advance_disabled'; end if;
  return new;
end;
$$;
revoke all on function public.hh_guard_room_advance_collection() from public,anon,authenticated;
grant execute on function public.hh_guard_room_advance_collection() to service_role;
-- Existing ledger updates and all GET recovery are intentionally unaffected.
create trigger hh_guard_room_advance_collection before insert on public.hotel_reservation_deposits
  for each row execute function public.hh_guard_room_advance_collection();
commit;
