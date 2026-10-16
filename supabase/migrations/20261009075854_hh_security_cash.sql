-- Review candidate only. Cash custody never calls N3. Requires deposit controls.
begin;
create table public.hotel_security_policies(
 tenant_id uuid primary key, amount_cents bigint not null default 5000 check(amount_cents between 1 and 9007199254740991),
 required boolean not null default true, terms text not null default 'Cash held separately from room payment. Returned after room and key inspection; disclosed deductions require evidence and acknowledgment or a recorded dispute.',
 version uuid not null default gen_random_uuid(), updated_by text not null, updated_at timestamptz not null default clock_timestamp(),check(length(terms) between 1 and 1500)
);
create table public.hotel_security_series(tenant_id uuid not null,period text not null,next_value integer not null check(next_value between 1 and 99999),primary key(tenant_id,period));
create table public.hotel_security_holdings(
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null,reservation_id uuid not null,room_stay_id uuid not null,
 receipt_number text not null, original_cents bigint not null check(original_cents between 0 and 9007199254740991),payer text not null,recipient text not null,storage text not null,
 room_number text not null,booking_reference text not null,terms text not null,waived boolean not null default false,
 inspection_clear boolean not null default false,open_case boolean not null default false,version uuid not null default gen_random_uuid(),
 created_at timestamptz not null default clock_timestamp(),created_by text not null,
 unique(tenant_id,id),unique(tenant_id,receipt_number),unique(tenant_id,reservation_id,room_stay_id),
 foreign key(tenant_id,reservation_id) references public.hotel_reservations(tenant_id,id) on delete restrict,
 foreign key(room_stay_id) references public.hotel_reservation_rooms(id) on delete restrict
);
create table public.hotel_security_returns(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,holding_id uuid not null,cents bigint not null check(cents between 1 and 9007199254740991),recipient text not null,
 state text not null check(state in('reserved','confirmed','released')),reserved_by text not null,created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,holding_id) references public.hotel_security_holdings(tenant_id,id) on delete restrict
);
create unique index hotel_security_one_pending_return on public.hotel_security_returns(tenant_id,holding_id) where state='reserved';
create table public.hotel_security_events(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,holding_id uuid,actor text not null,event text not null,
 delta_held bigint not null default 0,delta_due bigint not null default 0,detail jsonb not null,state_after jsonb not null,
 created_at timestamptz not null default clock_timestamp(),foreign key(tenant_id,holding_id) references public.hotel_security_holdings(tenant_id,id) on delete restrict
);
create index hotel_security_events_scope on public.hotel_security_events(tenant_id,holding_id,created_at,id);
create table public.hotel_security_commands(tenant_id uuid not null,key uuid not null,reservation_id uuid,actor text not null,body jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(tenant_id,key));
create table public.hotel_security_exceptions(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,holding_id uuid,kind text not null,actor text not null,detail jsonb not null,created_at timestamptz not null default clock_timestamp(),foreign key(tenant_id,holding_id) references public.hotel_security_holdings(tenant_id,id));
create table public.hotel_security_statements(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,version uuid not null default gen_random_uuid(),snapshot jsonb not null,counts jsonb not null,counted_cents bigint not null,variance_cents bigint not null,actor text not null,single_person boolean not null,note text not null,storage text not null,created_at timestamptz not null default clock_timestamp(),unique(tenant_id,id));
create table public.hotel_security_statement_signatures(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,statement_id uuid not null,actor text not null,role text not null,acknowledgment text not null,created_at timestamptz not null default clock_timestamp(),unique(tenant_id,statement_id),foreign key(tenant_id,statement_id) references public.hotel_security_statements(tenant_id,id));

create function public.hh_security_immutable() returns trigger language plpgsql security invoker set search_path='' as $$begin raise exception 'security_immutable';end;$$;
do $$declare t text;begin
 foreach t in array array['hotel_security_policies','hotel_security_series','hotel_security_holdings','hotel_security_returns','hotel_security_events','hotel_security_commands','hotel_security_exceptions','hotel_security_statements','hotel_security_statement_signatures'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select,insert on public.%I to service_role',t);
 if t in('hotel_security_policies','hotel_security_series','hotel_security_holdings','hotel_security_returns') then execute format('grant update on public.%I to service_role',t);
 else execute format('create trigger hh_security_immutable before update or delete on public.%I for each row execute function public.hh_security_immutable()',t);end if;
 end loop;
end;$$;

create function public.hh_security_holding(p_tenant uuid,p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object('id',h.id,'roomStayId',h.room_stay_id,'reservationId',h.reservation_id,'receiptNumber',h.receipt_number,'originalCents',h.original_cents,'payer',h.payer,'recipient',h.recipient,'storage',h.storage,'roomNumber',h.room_number,'bookingReference',h.booking_reference,'terms',h.terms,'waived',h.waived,'inspectionClear',h.inspection_clear,'openCase',h.open_case,'version',h.version,'createdAt',h.created_at,'collectedAt',(select min(created_at) from public.hotel_security_events where tenant_id=p_tenant and holding_id=h.id and event='collect'),'createdBy',h.created_by,'collectedBy',(select actor from public.hotel_security_events where tenant_id=p_tenant and holding_id=h.id and event='collect' order by created_at,id limit 1),'heldCents',coalesce(b.held,0),'returnableCents',coalesce(b.due,0),'pendingDispositionCents',coalesce(b.held-b.due,0),'pendingReturn',(select jsonb_build_object('id',r.id,'cents',r.cents,'recipient',r.recipient,'reservedBy',r.reserved_by) from public.hotel_security_returns r where r.tenant_id=p_tenant and r.holding_id=h.id and r.state='reserved'))
from public.hotel_security_holdings h left join lateral(select sum(delta_held) held,sum(delta_due) due from public.hotel_security_events where tenant_id=p_tenant and holding_id=h.id)b on true where h.tenant_id=p_tenant and h.id=p_id;
$$;
create function public.hh_security_read(p_tenant uuid,p_reservation uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;begin
 if not exists(select 1 from public.hotel_reservations where tenant_id=p_tenant and id=p_reservation) then raise exception 'reservation_not_found';end if;
 select jsonb_build_object('available',true,'enabled',coalesce((select security_deposit_enabled from public.hotel_deposit_module_policies where tenant_id=p_tenant),false),'policy',coalesce((select jsonb_build_object('amountCents',amount_cents,'required',required,'terms',terms,'version',version) from public.hotel_security_policies where tenant_id=p_tenant),jsonb_build_object('amountCents',5000,'required',true,'terms','Cash held separately from room payment. Returned after room and key inspection; disclosed deductions require evidence and acknowledgment or a recorded dispute.','version','0')),'holdings',coalesce((select jsonb_agg(public.hh_security_holding(p_tenant,h.id) order by h.created_at,h.id) from public.hotel_security_holdings h where h.tenant_id=p_tenant and h.reservation_id=p_reservation),'[]'::jsonb)) into result;return result;
end;$$;

create function public.hh_security_command(p_tenant uuid,p_reservation uuid,p_actor text,p_role text,p_key uuid,p_body jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a text:=p_body->>'action';h public.hotel_security_holdings;prev public.hotel_security_commands;rr public.hotel_reservation_rooms;res public.hotel_reservations;pol public.hotel_security_policies;op public.hotel_security_returns;result jsonb;held bigint;due bigint;dh bigint:=0;dd bigint:=0;n bigint;per text;seq integer;reason text:=btrim(coalesce(p_body->>'reason',''));evidence text:=btrim(coalesce(p_body->>'evidence',''));ack text:=btrim(coalesce(p_body->>'acknowledgment',''));ev text;event_at timestamptz;
begin
 if p_tenant is null or p_key is null or p_actor is null or btrim(p_actor)='' or p_role is null or p_role not in('owner','front_desk','housekeeper') then raise exception 'forbidden';end if;
 if a is null or jsonb_typeof(p_body)<>'object' then raise exception 'security_invalid_request';end if;
 if exists(select 1 from jsonb_object_keys(p_body) k where k<>all(case a
 when 'collect' then array['action','roomStayId','payer','recipient','storage','method','policyVersion']
 when 'waive' then array['action','roomStayId','reason']
 when 'inspect' then array['action','holdingId','version','clear','evidence']
 when 'reserve_return' then array['action','holdingId','version','recipient']
 when 'confirm_return' then array['action','holdingId','version','operationId','recipient','acknowledgment','reason']
 when 'release_return' then array['action','holdingId','version','operationId','reason']
 when 'deduct' then array['action','holdingId','version','cents','reason','evidence','acknowledgment','disputed']
 when 'restore_due' then array['action','holdingId','version','cents','reason','evidence','acknowledgment']
 when 'adjust' then array['action','holdingId','version','cents','actualCountCents','reason','evidence']
 when 'transfer' then array['action','holdingId','version','cents','reason','evidence','accountantReference','acknowledgment']
 when 'storage' then array['action','holdingId','version','storage','reason','evidence']
 when 'authorize_recipient' then array['action','holdingId','version','recipient','reason','evidence']
 when 'inspection_waiver' then array['action','holdingId','version','reason','evidence']
 when 'open_case' then array['action','holdingId','version','kind','reason','evidence']
 when 'resolve_case' then array['action','holdingId','version','reason','evidence']
 when 'bank_return_record' then array['action','holdingId','version','reason','evidence','acknowledgment','accountantReference','cashDispositionEvidence']
 else array['action'] end)) then raise exception 'security_invalid_request';end if;
 if p_role='housekeeper' and a<>'inspect' then raise exception 'forbidden';end if;
 if a not in('collect','inspect','reserve_return','confirm_return') and p_role<>'owner' then raise exception 'forbidden';end if;
 -- Same lock as module disable: the durable collection authorization boundary.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hh_deposit_module_policy:'||p_tenant::text,0));
 select * into prev from public.hotel_security_commands where tenant_id=p_tenant and key=p_key;
 if found then
  if prev.reservation_id is distinct from p_reservation or prev.body<>p_body or prev.actor<>p_actor then raise exception 'security_key_conflict';end if;
  if p_role='housekeeper' then return jsonb_build_object('inspectionRecorded',true);end if;
  return prev.result;
 end if;
 select * into res from public.hotel_reservations where tenant_id=p_tenant and id=p_reservation;
 if not found then raise exception 'reservation_not_found';end if;
 select * into pol from public.hotel_security_policies where tenant_id=p_tenant;
 if not found then pol.amount_cents:=5000;pol.required:=true;pol.terms:='Cash held separately from room payment. Returned after room and key inspection; disclosed deductions require evidence and acknowledgment or a recorded dispute.';end if;
 if a in('collect','waive') then
  if res.status not in('confirmed','checked_in') then raise exception 'security_collection_ineligible';end if;
  select * into rr from public.hotel_reservation_rooms where id=(p_body->>'roomStayId')::uuid and tenant_id=p_tenant and reservation_id=p_reservation and allocation_status in('reserved','occupied');
  if not found then raise exception 'security_room_not_found';end if;
  select * into h from public.hotel_security_holdings where tenant_id=p_tenant and reservation_id=p_reservation and room_stay_id=rr.id;
  if found and not(h.waived and a='collect') then raise exception 'security_holding_exists';end if;
  if a='collect' then
   if not coalesce((select security_deposit_enabled and security_module_ready from public.hotel_deposit_module_policies where tenant_id=p_tenant),false) then raise exception 'security_collection_disabled';end if;
   if p_body->>'policyVersion' is distinct from coalesce(pol.version::text,'0') then raise exception 'security_policy_changed';end if;
   if p_body->>'method' is distinct from 'cash' then raise exception 'security_cash_only';end if;
   if length(btrim(coalesce(p_body->>'payer','')))=0 or length(btrim(coalesce(p_body->>'recipient','')))=0 or length(btrim(coalesce(p_body->>'storage','')))=0 then raise exception 'security_invalid_request';end if;
   dh:=pol.amount_cents;dd:=dh;
  elsif reason='' then raise exception 'security_reason_required';end if;
  if h.id is not null then
   -- Waiver is immutable history; its later first collection keeps the one receipt identity.
   update public.hotel_security_holdings set waived=false,original_cents=dh,payer=p_body->>'payer',recipient=p_body->>'recipient',storage=p_body->>'storage',terms=pol.terms,version=gen_random_uuid() where id=h.id returning * into h;
  else
   per:=to_char(clock_timestamp() at time zone 'Asia/Kuala_Lumpur','YYMM');
   insert into public.hotel_security_series(tenant_id,period,next_value) values(p_tenant,per,1) on conflict(tenant_id,period) do update set next_value=public.hotel_security_series.next_value+1 returning next_value into seq;
   insert into public.hotel_security_holdings(tenant_id,reservation_id,room_stay_id,receipt_number,original_cents,payer,recipient,storage,room_number,booking_reference,terms,waived,created_by)
   values(p_tenant,p_reservation,rr.id,'SD'||per||lpad(seq::text,5,'0'),dh,coalesce(p_body->>'payer','Owner waiver'),coalesce(p_body->>'recipient',''),coalesce(p_body->>'storage',''),(select room_number from public.hotel_rooms where tenant_id=p_tenant and id=rr.hotel_room_id),res.booking_reference,pol.terms,a='waive',p_actor) returning * into h;
  end if;ev:=a;
 else
  select * into h from public.hotel_security_holdings where tenant_id=p_tenant and reservation_id=p_reservation and id=(p_body->>'holdingId')::uuid for update;
  if not found then raise exception 'security_holding_not_found';end if;
  if h.version::text is distinct from p_body->>'version' then raise exception 'security_version_conflict';end if;
  select coalesce(sum(delta_held),0),coalesce(sum(delta_due),0) into held,due from public.hotel_security_events where tenant_id=p_tenant and holding_id=h.id;
  select * into op from public.hotel_security_returns where tenant_id=p_tenant and holding_id=h.id and state='reserved';
  if op.id is not null and a not in('confirm_return','release_return') then raise exception 'security_return_pending';end if;
  if a='inspect' then
   if evidence='' or jsonb_typeof(p_body->'clear') is distinct from 'boolean' then raise exception 'security_inspection_required';end if;
   update public.hotel_security_holdings set inspection_clear=(p_body->>'clear')::boolean where id=h.id;
  elsif a='reserve_return' then
   if not h.inspection_clear then raise exception 'security_inspection_required';end if;
   if due<=0 then raise exception 'security_nothing_to_return';end if;
   if p_body->>'recipient' is distinct from h.recipient then raise exception 'security_recipient_mismatch';end if;
   insert into public.hotel_security_returns(tenant_id,holding_id,cents,recipient,state,reserved_by) values(p_tenant,h.id,due,h.recipient,'reserved',p_actor);
  elsif a in('confirm_return','release_return') then
   if op.id is null or op.id::text is distinct from p_body->>'operationId' then raise exception 'security_return_not_pending';end if;
   if a='release_return' then
    if reason='' then raise exception 'security_reason_required';end if;
    update public.hotel_security_returns set state='released' where id=op.id;
   else
    if p_body->>'recipient' is distinct from op.recipient then raise exception 'security_recipient_mismatch';end if;
    if ack='' then raise exception 'security_acknowledgment_required';end if;
    if (p_actor<>op.reserved_by or not h.inspection_clear) and (p_role<>'owner' or reason='') then raise exception 'security_owner_reconciliation_required';end if;
    dh:=-op.cents;dd:=dh;
    update public.hotel_security_returns set state='confirmed' where id=op.id;
   end if;
  elsif a in('deduct','restore_due','adjust','transfer') then
   if reason='' or evidence='' then raise exception 'security_reason_required';end if;
   n:=(p_body->>'cents')::bigint;
   if n is null or abs(n::numeric)>9007199254740991 then raise exception 'security_invalid_amount';end if;
   if a='deduct' then
    if n<=0 or n>due or (ack='' and coalesce((p_body->>'disputed')::boolean,false)=false) then raise exception 'security_invalid_deduction';end if;
    dd:=-n;
    if coalesce((p_body->>'disputed')::boolean,false) then update public.hotel_security_holdings set open_case=true where id=h.id;end if;
   elsif a='restore_due' then
    if n<=0 or n>held-due or ack='' then raise exception 'security_invalid_amount';end if;
    dd:=n; -- Guest-favorable reversal preserves physical cash and original deduction history.
   elsif a='transfer' then
    if n<=0 or n>held-due or (h.open_case and ack='') or btrim(coalesce(p_body->>'accountantReference',''))='' then raise exception 'security_transfer_unproven';end if;
    dh:=-n;
   else
    if n=0 or (p_body->>'actualCountCents')::bigint is distinct from held+n then raise exception 'security_invalid_amount';end if;
    dh:=n;dd:=n;
   end if;
  elsif a='storage' then
   if reason='' or evidence='' or btrim(coalesce(p_body->>'storage',''))='' then raise exception 'security_reason_required';end if;
   update public.hotel_security_holdings set storage=p_body->>'storage' where id=h.id;
  elsif a='authorize_recipient' then
   if reason='' or evidence='' or btrim(coalesce(p_body->>'recipient',''))='' then raise exception 'security_reason_required';end if;
   update public.hotel_security_holdings set recipient=p_body->>'recipient' where id=h.id;
  elsif a='inspection_waiver' then
   if reason='' or evidence='' then raise exception 'security_reason_required';end if;
   update public.hotel_security_holdings set inspection_clear=true where id=h.id;
  elsif a in('open_case','resolve_case') then
   if reason='' or evidence='' then raise exception 'security_reason_required';end if;
   if a='resolve_case' and held>0 then raise exception 'security_case_unresolved';end if;
   update public.hotel_security_holdings set open_case=a='open_case' where id=h.id;
  elsif a='bank_return_record' then
   -- Records an accountant's already performed exception, never executes a bank refund.
   if not h.open_case or reason='' or evidence='' or btrim(coalesce(p_body->>'cashDispositionEvidence',''))='' or ack='' or due<=0 or btrim(coalesce(p_body->>'accountantReference',''))='' then raise exception 'security_bank_evidence_required';end if;
   dh:=-due;dd:=-due;
  else raise exception 'security_invalid_request';end if;
  if held+dh<0 or due+dd<0 or due+dd>held+dh or held::numeric+dh>9007199254740991 then raise exception 'security_invalid_amount';end if;
  update public.hotel_security_holdings set version=gen_random_uuid() where id=h.id returning * into h;ev:=a;
 end if;
 if a in('waive','deduct','restore_due','adjust','release_return','open_case','resolve_case','bank_return_record','authorize_recipient','inspection_waiver') then
 insert into public.hotel_security_exceptions(tenant_id,holding_id,kind,actor,detail) values(p_tenant,h.id,coalesce(p_body->>'kind',a),p_actor,p_body);
 end if;
 if coalesce((select sum(delta_held) from public.hotel_security_events where tenant_id=p_tenant),0)::numeric+dh>9007199254740991 then raise exception 'security_invalid_amount';end if;
 event_at:=greatest(clock_timestamp(),coalesce((select max(created_at)+interval '1 microsecond' from public.hotel_security_events where tenant_id=p_tenant),clock_timestamp()));
 -- A command's money and snapshot share one as-at boundary; neither can appear alone.
 -- Event inserted before projection read; history never rewritten.
 insert into public.hotel_security_events(tenant_id,holding_id,actor,event,delta_held,delta_due,detail,state_after,created_at) values(p_tenant,h.id,p_actor,ev,dh,dd,p_body,'{}',event_at);
 result:=public.hh_security_holding(p_tenant,h.id);
 -- No UPDATE of event: replace transient empty snapshot with correct state in the initial INSERT path below.
 -- Stored history metadata is obtained from a separate immutable snapshot event.
 insert into public.hotel_security_events(tenant_id,holding_id,actor,event,detail,state_after,created_at) values(p_tenant,h.id,p_actor,'snapshot',jsonb_build_object('action',ev),result,event_at);
 insert into public.hotel_security_commands(tenant_id,key,reservation_id,actor,body,result) values(p_tenant,p_key,p_reservation,p_actor,p_body,result);
 if p_role='housekeeper' then return jsonb_build_object('inspectionRecorded',true);end if;
 return result;
end;$$;

create function public.hh_security_report(p_tenant uuid,p_from timestamptz,p_as_at timestamptz) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r jsonb;begin
 if p_from is null or p_as_at is null or p_from>p_as_at then raise exception 'security_invalid_report';end if;
 select jsonb_build_object('from',p_from,'asAt',p_as_at,
 'openingCents',coalesce(sum(delta_held) filter(where created_at<p_from),0),
 'collectionsCents',coalesce(sum(delta_held) filter(where event='collect' and created_at>=p_from),0),
 'returnsCents',-coalesce(sum(delta_held) filter(where event in('confirm_return','bank_return_record') and created_at>=p_from),0),
 'transfersCents',-coalesce(sum(delta_held) filter(where event='transfer' and created_at>=p_from),0),
 'adjustmentsCents',coalesce(sum(delta_held) filter(where event='adjust' and created_at>=p_from),0),
 'closingCents',coalesce(sum(delta_held),0),
 'holdings',coalesce((select jsonb_agg(x.state_after order by x.created_at,x.id) from(select distinct on(holding_id) state_after,created_at,id from public.hotel_security_events where tenant_id=p_tenant and created_at<=p_as_at and event='snapshot' order by holding_id,created_at desc,id desc)x),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(jsonb_build_object('id',id,'holdingId',holding_id,'event',event,'deltaHeld',delta_held,'deltaDue',delta_due,'actor',actor,'at',created_at,'detail',detail) order by created_at,id) from public.hotel_security_events where tenant_id=p_tenant and created_at>=p_from and created_at<=p_as_at and event<>'snapshot'),'[]'::jsonb)) into r from public.hotel_security_events where tenant_id=p_tenant and created_at<=p_as_at;return r;
end;$$;

-- Count only current custody; archived receipts remain in the full immutable snapshot.
create function public.hh_security_count_scope(p_snapshot jsonb) returns jsonb language sql immutable security invoker set search_path='' as $$
select coalesce(jsonb_agg(h),'[]'::jsonb) from jsonb_array_elements(p_snapshot->'holdings') h
where (h->>'heldCents')::bigint>0 or h->'pendingReturn'<>'null'::jsonb or (h->>'openCase')::boolean;
$$;
create function public.hh_security_envelope_variances(p_counts jsonb,p_snapshot jsonb) returns jsonb language sql immutable security invoker set search_path='' as $$
select coalesce(jsonb_agg(jsonb_build_object('holdingId',c->>'holdingId','expectedCents',(h->>'heldCents')::bigint,'countedCents',(c->>'cents')::bigint,'varianceCents',(c->>'cents')::bigint-(h->>'heldCents')::bigint)),'[]'::jsonb)
from jsonb_array_elements(p_counts)c join jsonb_array_elements(p_snapshot->'holdings')h on h->>'id'=c->>'holdingId'
where (c->>'cents')::bigint<>(h->>'heldCents')::bigint;
$$;

create function public.hh_security_statement(p_tenant uuid,p_actor text,p_role text,p_key uuid,p_body jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare prev public.hotel_security_commands;s public.hotel_security_statements;report jsonb;result jsonb;counts jsonb:=p_body->'counts';counted bigint;expected bigint;current_scope jsonb;variances jsonb;sg public.hotel_security_statement_signatures;begin
 if p_role is null or p_role not in('owner','front_desk') or btrim(coalesce(p_actor,''))='' or p_key is null then raise exception 'forbidden';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hh_deposit_module_policy:'||p_tenant::text,0));
 select * into prev from public.hotel_security_commands where tenant_id=p_tenant and key=p_key;
 if found then if prev.actor<>p_actor or prev.body<>p_body or prev.reservation_id is not null then raise exception 'security_key_conflict';end if;return prev.result;end if;
 if p_body->>'action'='count' then
  if jsonb_typeof(counts) is distinct from 'array' or jsonb_typeof(p_body->'singlePerson') is distinct from 'boolean' or btrim(coalesce(p_body->>'storage',''))='' then raise exception 'security_invalid_count';end if;
  report:=public.hh_security_report(p_tenant,(p_body->>'from')::timestamptz,clock_timestamp());
  current_scope:=public.hh_security_count_scope(report);
  -- Validate the exact current set under the same lock as all custody changes.
  if jsonb_array_length(counts)<>jsonb_array_length(current_scope) or
   exists(select 1 from jsonb_array_elements(counts)c where not exists(select 1 from jsonb_array_elements(current_scope)h where h->>'id'=c->>'holdingId') or jsonb_typeof(c->'cents') is distinct from 'number' or (c->>'cents')::numeric<0 or (c->>'cents')::numeric>9007199254740991 or trunc((c->>'cents')::numeric)<>(c->>'cents')::numeric) or
   (select count(distinct c->>'holdingId') from jsonb_array_elements(counts)c)<>jsonb_array_length(counts) then raise exception 'security_invalid_count';end if;
  select coalesce(sum((c->>'cents')::bigint),0) into counted from jsonb_array_elements(counts)c;expected:=(report->>'closingCents')::bigint;
  insert into public.hotel_security_statements(tenant_id,snapshot,counts,counted_cents,variance_cents,actor,single_person,note,storage) values(p_tenant,report,counts,counted,counted-expected,p_actor,(p_body->>'singlePerson')::boolean,coalesce(p_body->>'note',''),p_body->>'storage') returning * into s;
  variances:=public.hh_security_envelope_variances(counts,report);
  insert into public.hotel_security_exceptions(tenant_id,holding_id,kind,actor,detail) select p_tenant,(v->>'holdingId')::uuid,'shift_envelope_variance',p_actor,v||jsonb_build_object('statementId',s.id) from jsonb_array_elements(variances)v;
  if counted<>expected then insert into public.hotel_security_exceptions(tenant_id,kind,actor,detail) values(p_tenant,'shift_variance',p_actor,jsonb_build_object('statementId',s.id,'varianceCents',counted-expected));end if;
 elsif p_body->>'action'='sign' then
  select * into s from public.hotel_security_statements where tenant_id=p_tenant and id=(p_body->>'statementId')::uuid;
  if not found then raise exception 'security_statement_not_found';end if;
  if s.version::text is distinct from p_body->>'version' then raise exception 'security_version_conflict';end if;
  if exists(select 1 from public.hotel_security_statement_signatures where tenant_id=p_tenant and statement_id=s.id) then raise exception 'security_statement_signed';end if;
  if (s.single_person and p_role<>'owner') or (not s.single_person and p_actor=s.actor) then raise exception 'security_second_signer_required';end if;
  if btrim(coalesce(p_body->>'acknowledgment',''))='' then raise exception 'security_acknowledgment_required';end if;
  insert into public.hotel_security_statement_signatures(tenant_id,statement_id,actor,role,acknowledgment) values(p_tenant,s.id,p_actor,p_role,p_body->>'acknowledgment') returning * into sg;
 else raise exception 'security_invalid_request';end if;
 result:=jsonb_build_object('id',s.id,'version',s.version,'snapshot',s.snapshot,'counts',s.counts,'envelopeVariances',public.hh_security_envelope_variances(s.counts,s.snapshot),'countedCents',s.counted_cents,'varianceCents',s.variance_cents,'firstSigner',s.actor,'secondSigner',sg.actor,'singlePerson',s.single_person,'note',s.note,'storage',s.storage,'status',case when sg.id is null then case when s.single_person then 'awaiting_owner_review' else 'awaiting_second_signer' end when s.variance_cents<>0 or jsonb_array_length(public.hh_security_envelope_variances(s.counts,s.snapshot))>0 then 'variance_needs_review' else 'signed' end);
 insert into public.hotel_security_commands(tenant_id,key,actor,body,result) values(p_tenant,p_key,p_actor,p_body,result);return result;
end;$$;

create function public.hh_security_stay_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare required boolean;begin
 if new.status is not distinct from old.status then return new;end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hh_deposit_module_policy:'||new.tenant_id::text,0));
 if new.status='checked_in' and old.status='confirmed' then
  select security_deposit_enabled into required from public.hotel_deposit_module_policies where tenant_id=new.tenant_id;
  if required is true and coalesce((select p.required from public.hotel_security_policies p where tenant_id=new.tenant_id),true) and exists(select 1 from public.hotel_reservation_rooms rr where rr.tenant_id=new.tenant_id and rr.reservation_id=new.id and rr.allocation_status in('reserved','occupied') and not exists(select 1 from public.hotel_security_holdings h where h.tenant_id=new.tenant_id and h.reservation_id=new.id and h.room_stay_id=rr.id and (h.waived or (public.hh_security_holding(new.tenant_id,h.id)->>'heldCents')::bigint>0))) then raise exception 'security_collection_required';end if;
 elsif new.status='checked_out' then
  if exists(select 1 from public.hotel_security_holdings h where h.tenant_id=new.tenant_id and h.reservation_id=new.id and ((public.hh_security_holding(new.tenant_id,h.id)->'pendingReturn')<>'null'::jsonb or ((public.hh_security_holding(new.tenant_id,h.id)->>'heldCents')::bigint>0 and not h.open_case))) then raise exception 'security_return_required';end if;
 end if;return new;
end;$$;
create trigger hh_security_stay_guard before update of status on public.hotel_reservations for each row execute function public.hh_security_stay_guard();
create function public.hh_security_room_move() returns trigger language plpgsql security invoker set search_path='' as $$
declare h public.hotel_security_holdings;event_at timestamptz;begin
 if new.tenant_id is distinct from old.tenant_id or new.reservation_id is distinct from old.reservation_id then
  if exists(select 1 from public.hotel_security_holdings where room_stay_id=old.id) then raise exception 'security_room_scope_immutable';end if;
 end if;
 if new.hotel_room_id is not distinct from old.hotel_room_id then return new;end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hh_deposit_module_policy:'||new.tenant_id::text,0));
 event_at:=greatest(clock_timestamp(),coalesce((select max(created_at)+interval '1 microsecond' from public.hotel_security_events where tenant_id=new.tenant_id),clock_timestamp()));
 for h in select * from public.hotel_security_holdings where tenant_id=new.tenant_id and room_stay_id=new.id loop
 update public.hotel_security_holdings set inspection_clear=false,room_number=(select room_number from public.hotel_rooms where tenant_id=new.tenant_id and id=new.hotel_room_id),version=gen_random_uuid() where id=h.id;
 insert into public.hotel_security_events(tenant_id,holding_id,actor,event,detail,state_after,created_at) values(new.tenant_id,h.id,'system:room_move','room_move',jsonb_build_object('fromRoomId',old.hotel_room_id,'toRoomId',new.hotel_room_id),'{}',event_at);
 insert into public.hotel_security_events(tenant_id,holding_id,actor,event,detail,state_after,created_at) values(new.tenant_id,h.id,'system:room_move','snapshot','{}',public.hh_security_holding(new.tenant_id,h.id),event_at);
 end loop;return new;
end;$$;
create trigger hh_security_room_move after update on public.hotel_reservation_rooms for each row execute function public.hh_security_room_move();
create function public.hh_security_overview(p_tenant uuid,p_from timestamptz,p_as_at timestamptz) returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object('policy',coalesce((select jsonb_build_object('amountCents',amount_cents,'required',required,'terms',terms,'version',version) from public.hotel_security_policies where tenant_id=p_tenant),jsonb_build_object('amountCents',5000,'required',true,'terms','Cash held separately from room payment. Returned after room and key inspection; disclosed deductions require evidence and acknowledgment or a recorded dispute.','version','0')),'report',public.hh_security_report(p_tenant,p_from,p_as_at),'statements',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'version',s.version,'snapshot',s.snapshot,'counts',s.counts,'envelopeVariances',public.hh_security_envelope_variances(s.counts,s.snapshot),'countedCents',s.counted_cents,'varianceCents',s.variance_cents,'firstSigner',s.actor,'secondSigner',sg.actor,'singlePerson',s.single_person,'note',s.note,'storage',s.storage,'status',case when sg.id is null then case when s.single_person then 'awaiting_owner_review' else 'awaiting_second_signer' end when s.variance_cents<>0 or jsonb_array_length(public.hh_security_envelope_variances(s.counts,s.snapshot))>0 then 'variance_needs_review' else 'signed' end) order by s.created_at desc) from (select * from public.hotel_security_statements where tenant_id=p_tenant and created_at<=p_as_at order by created_at desc limit 50)s left join public.hotel_security_statement_signatures sg on sg.tenant_id=p_tenant and sg.statement_id=s.id and sg.created_at<=p_as_at),'[]'::jsonb));
$$;
create function public.hh_security_inspection_read(p_tenant uuid,p_reservation uuid) returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object('holdings',coalesce(jsonb_agg(jsonb_build_object('id',h.id,'version',h.version,'roomNumber',h.room_number,'hotelRoomId',rr.hotel_room_id,'inspectionClear',h.inspection_clear)),'[]'::jsonb)) from public.hotel_security_holdings h join public.hotel_reservation_rooms rr on rr.tenant_id=h.tenant_id and rr.reservation_id=h.reservation_id and rr.id=h.room_stay_id where h.tenant_id=p_tenant and h.reservation_id=p_reservation;
$$;
create function public.hh_security_installed() returns boolean language sql stable security invoker set search_path='' as $$select true;$$;
-- Policy CAS remains independent from enabling collections.
create function public.hh_security_policy(p_tenant uuid,p_actor text,p_expected text,p_amount bigint,p_required boolean,p_terms text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.hotel_security_policies;inserted integer;begin
 if btrim(coalesce(p_actor,''))='' or p_amount is null or p_amount<1 or p_amount>9007199254740991 or p_required is null or length(btrim(coalesce(p_terms,''))) not between 1 and 1500 then raise exception 'security_invalid_policy';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hh_deposit_module_policy:'||p_tenant::text,0));
 insert into public.hotel_security_policies(tenant_id,updated_by) values(p_tenant,p_actor) on conflict do nothing;get diagnostics inserted=row_count;
 select * into p from public.hotel_security_policies where tenant_id=p_tenant for update;
 if (inserted=1 and p_expected is distinct from '0') or (inserted=0 and p.version::text is distinct from p_expected) then raise exception 'security_version_conflict';end if;
 insert into public.hotel_security_events(tenant_id,actor,event,detail,state_after) values(p_tenant,p_actor,'policy',jsonb_build_object('previous',to_jsonb(p),'amountCents',p_amount,'required',p_required,'terms',p_terms),'{}');
 update public.hotel_security_policies set amount_cents=p_amount,required=p_required,terms=p_terms,version=gen_random_uuid(),updated_by=p_actor,updated_at=clock_timestamp() where tenant_id=p_tenant returning * into p;
 return jsonb_build_object('amountCents',p.amount_cents,'required',p.required,'terms',p.terms,'version',p.version);
end;$$;
-- Readiness installed without changing either collection toggle. Defaults cover future policy rows.
alter table public.hotel_deposit_module_policies alter column security_module_ready set default true;
update public.hotel_deposit_module_policies set security_module_ready=true;
-- All new routines, including helpers, are service-only; no SECURITY DEFINER.
do $$declare r record;begin for r in select oid::regprocedure sig from pg_proc where pronamespace='public'::regnamespace and proname like 'hh_security_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',r.sig);
 execute format('grant execute on function %s to service_role',r.sig);end loop;end;$$;
commit;
