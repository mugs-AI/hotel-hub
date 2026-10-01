-- Prepared only. Apply with the matching approved HotelHub release.
-- Existing accounts remain shown; no N3 account or historical deposit is changed.
begin;

alter table public.hotel_settings
  add column payment_account_visibility jsonb not null default '{}'::jsonb
  constraint hotel_settings_payment_account_visibility_object
    check (jsonb_typeof(payment_account_visibility) = 'object');

-- Runs only via the trusted server service role. SECURITY INVOKER retains table RLS.
-- One UPDATE obtains the row lock and patches a single key, preserving concurrent edits.
create function public.hotelhub_set_payment_account_preferences(
  p_tenant_id uuid, p_account_id uuid, p_label text default null, p_show boolean default null
)
returns setof public.hotel_settings
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_tenant_id is null or p_account_id is null or (p_label is null and p_show is null)
     or (p_label is not null and (length(p_label) > 40 or p_label ~ '[[:cntrl:]<>]')) then
    raise exception 'invalid_payment_preferences' using errcode = '22023';
  end if;
  return query
    update public.hotel_settings
    set payment_account_aliases = case
          when p_label is null then payment_account_aliases
          -- Replace/remove only this account, including legacy UUID casing variants.
          else (select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
                from jsonb_each(payment_account_aliases) as entry
                where lower(entry.key) <> p_account_id::text)
               || case when btrim(p_label) = '' then '{}'::jsonb
                       else jsonb_build_object(p_account_id::text, btrim(p_label)) end
        end,
        payment_account_visibility = case
          when p_show is null then payment_account_visibility
          else jsonb_set(payment_account_visibility, array[p_account_id::text], to_jsonb(p_show))
        end
    where tenant_id = p_tenant_id
    returning *;
end;
$$;

revoke all on function public.hotelhub_set_payment_account_preferences(uuid, uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.hotelhub_set_payment_account_preferences(uuid, uuid, text, boolean)
  to service_role;

commit;
