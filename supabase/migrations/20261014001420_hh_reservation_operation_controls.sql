-- Additive candidate only. Install once in one transaction through Lovable.
-- Settings projection in the protected hotel store remains unchanged.
ALTER TABLE public.hotel_settings
  ADD COLUMN rate_change_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN operation_controls_revision bigint NOT NULL DEFAULT 0 CHECK (operation_controls_revision >= 0);

CREATE FUNCTION public.hh_operation_controls_read(p_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.hotel_settings%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.hotel_settings WHERE tenant_id=p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'operation_controls_unavailable'; END IF;
  RETURN jsonb_build_object('tenantId',p_tenant_id,'rateChangeEnabled',s.rate_change_enabled,'revision',s.operation_controls_revision::text,'available',true);
END $$;

CREATE FUNCTION public.hh_operation_controls_update(p_tenant_id uuid,p_actor_n3_user_key text,p_expected_revision text,p_rate_change_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.hotel_settings%ROWTYPE;
BEGIN
  IF p_actor_n3_user_key IS NULL OR NOT EXISTS(SELECT 1 FROM public.hotel_user_roles WHERE tenant_id=p_tenant_id AND n3_user_key=p_actor_n3_user_key AND role='owner' AND is_active) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_rate_change_enabled IS NULL OR p_expected_revision IS NULL OR p_expected_revision !~ '^(0|[1-9][0-9]{0,18})$' OR p_expected_revision::numeric > 9223372036854775807 THEN RAISE EXCEPTION 'invalid_request'; END IF;
  SELECT * INTO s FROM public.hotel_settings WHERE tenant_id=p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'operation_controls_unavailable'; END IF;
  IF s.operation_controls_revision::text <> p_expected_revision THEN RAISE EXCEPTION 'operation_controls_stale'; END IF;
  IF s.rate_change_enabled IS DISTINCT FROM p_rate_change_enabled THEN
    UPDATE public.hotel_settings SET rate_change_enabled=p_rate_change_enabled,operation_controls_revision=operation_controls_revision+1 WHERE tenant_id=p_tenant_id;
    INSERT INTO public.hotel_audit_events(tenant_id,n3_user_key,event_type,detail) VALUES(p_tenant_id,p_actor_n3_user_key,'hotel.settings.rate_change_enabled_updated',jsonb_build_object('enabled',p_rate_change_enabled,'revision',(s.operation_controls_revision+1)::text));
  END IF;
  RETURN public.hh_operation_controls_read(p_tenant_id);
END $$;
REVOKE ALL ON FUNCTION public.hh_operation_controls_read(uuid),public.hh_operation_controls_update(uuid,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hh_operation_controls_read(uuid),public.hh_operation_controls_update(uuid,text,text,boolean) TO service_role;

-- All new rate requests and approval/direct application paths share this
-- transactional fence. The policy row lock also serialises Owner disabling.
CREATE FUNCTION public.hh_guard_rate_change_enabled()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE enabled boolean;
BEGIN
  IF NEW.operation_type='rate_change' AND (TG_OP='INSERT' OR (NEW.state IN ('approved','applied') AND NEW.state IS DISTINCT FROM OLD.state)) THEN
    SELECT rate_change_enabled INTO enabled FROM public.hotel_settings WHERE tenant_id=NEW.tenant_id FOR SHARE;
    IF enabled IS DISTINCT FROM true THEN RAISE EXCEPTION USING ERRCODE='HH21E',MESSAGE='rate_change_disabled'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.hh_guard_rate_change_enabled() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER hh_rate_change_enabled BEFORE INSERT OR UPDATE ON public.hotel_reservation_operation_requests FOR EACH ROW EXECUTE FUNCTION public.hh_guard_rate_change_enabled();

-- Preserve the two inspected implementations and their existing permissions,
-- idempotency, room/guest checks and events; add the limit after property time.
-- Works before or after the billing fence renames implementations. Unexpected
-- shapes fail the entire migration instead of overwriting unfamiliar code.
DO $$
DECLARE f record; definition text; anchor text := 'v_local := public.hotelhub_property_now(p_tenant_id);'; patched integer := 0;
BEGIN
  FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('hotelhub_check_in_reservation','hotelhub_check_in_reservation_before_settlement') AND p.pronargs IN (6,7)
  LOOP
    definition := pg_get_functiondef(f.oid);
    IF strpos(definition,anchor)=0 THEN CONTINUE; END IF;
    IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor) <> 1 OR strpos(definition,'stay_dates_expired')>0 THEN RAISE EXCEPTION 'check_in_contract_changed'; END IF;
    definition := replace(definition,anchor,anchor || E'\n  IF (clock_timestamp() AT TIME ZONE COALESCE((SELECT timezone FROM public.hotel_settings WHERE tenant_id=p_tenant_id),''Asia/Kuala_Lumpur''))::date >= v_row.departure_date THEN\n    RAISE EXCEPTION USING ERRCODE=''HH21D'', MESSAGE=''stay_dates_expired'';\n  END IF;');
    EXECUTE definition;
    patched := patched+1;
  END LOOP;
  IF patched <> 2 THEN RAISE EXCEPTION 'check_in_contract_changed'; END IF;
END $$;
