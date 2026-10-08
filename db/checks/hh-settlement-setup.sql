-- TEST ONLY: reconstructed read-only schema, PostgreSQL17.6; no tenant data.

-- Use the disposable test runner, never Lovable Cloud.

DO $$ BEGIN IF current_setting('hotelhub.disposable_test',true) IS DISTINCT FROM 'enabled' THEN RAISE EXCEPTION 'disposable_test_required'; END IF; END $$;

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE ROLE service_role BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.hotelhub_utf16_length(p text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
 SET search_path TO ''
AS $function$
  SELECT char_length(p) + char_length(regexp_replace(p, '[^\U00010000-\U0010FFFF]', '', 'g'))
$function$
;

CREATE TYPE public."hotel_addon_category" AS ENUM ('minibar','breakfast','laundry','extra_bed','early_check_in','late_checkout','transport','room_service','damage_lost_item','other');

CREATE TYPE public."hotel_folio_line_status" AS ENUM ('draft','committed','reversed');

CREATE TYPE public."hotel_folio_line_type" AS ENUM ('room_night','add_on','service_charge','service_tax','tourism_tax','local_levy','discount','manual_adjustment','reversal');

CREATE TYPE public."hotel_guest_tax_class" AS ENUM ('malaysian_citizen','malaysian_pr','foreign_tourist','other_exemption','unknown');

CREATE TYPE public."hotel_role" AS ENUM ('owner','front_desk','housekeeper');

CREATE TYPE public."hotel_tax_class" AS ENUM ('accommodation','food_and_beverage','parking','other_taxable_service','non_taxable','service_charge','damage_compensation');

CREATE TABLE public."hotel_addon_catalogue" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"category" hotel_addon_category NOT NULL,
"tax_class" hotel_tax_class NOT NULL,
"display_name" text NOT NULL,
"description" text,
"is_active" boolean DEFAULT true NOT NULL,
"default_unit_price_cents" integer DEFAULT 0 NOT NULL,
"n3_stock_id" text,
"n3_uom_id" text,
"n3_tax_code_id" text,
"n3_stock_code_snapshot" text,
"n3_stock_name_snapshot" text,
"n3_uom_snapshot" text,
"n3_tax_code_snapshot" text,
"sort_order" integer DEFAULT 0 NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."hotel_audit_events" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid,
"n3_user_key" text,
"event_type" text NOT NULL,
"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
"ip" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."hotel_booking_sequences" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"sequence_date" date NOT NULL,
"last_number" integer DEFAULT 0 NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."hotel_booking_sources" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"source_code" text NOT NULL,
"display_name" text NOT NULL,
"is_active" boolean DEFAULT true NOT NULL,
"sort_order" integer DEFAULT 0 NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."hotel_financial_settings" (
"tenant_id" uuid NOT NULL,
"service_tax_registered" boolean DEFAULT false NOT NULL,
"service_tax_accommodation_rate_bp" integer,
"service_tax_fnb_rate_bp" integer,
"service_tax_parking_rate_bp" integer,
"service_tax_other_rate_bp" integer,
"n3_tax_code_accommodation_id" text,
"n3_tax_code_accommodation_snapshot" text,
"n3_tax_code_fnb_id" text,
"n3_tax_code_fnb_snapshot" text,
"n3_tax_code_parking_id" text,
"n3_tax_code_parking_snapshot" text,
"n3_tax_code_other_id" text,
"n3_tax_code_other_snapshot" text,
"n3_tax_code_exempt_id" text,
"n3_tax_code_exempt_snapshot" text,
"service_charge_enabled" boolean DEFAULT false NOT NULL,
"service_charge_percent_bp" integer DEFAULT 0 NOT NULL,
"service_charge_service_tax_applies" boolean DEFAULT false NOT NULL,
"tourism_tax_enabled" boolean DEFAULT false NOT NULL,
"tourism_tax_cents_per_room_night" integer DEFAULT 0 NOT NULL,
"tourism_tax_effective_from" date,
"tourism_tax_effective_to" date,
"local_levy_enabled" boolean DEFAULT false NOT NULL,
"local_levy_label" text,
"local_levy_cents_per_room_night" integer DEFAULT 0 NOT NULL,
"local_levy_effective_from" date,
"local_levy_effective_to" date,
"rounding_mode" text DEFAULT 'none'::text NOT NULL,
"n3_rounding_account_id" text,
"n3_rounding_account_snapshot" text,
"updated_by_n3_user_key" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
"posting_mappings" jsonb
);

CREATE TABLE public."hotel_folio_bill_to" (
"tenant_id" uuid NOT NULL,
"reservation_id" uuid NOT NULL,
"name" text DEFAULT ''::text NOT NULL,
"company" text DEFAULT ''::text NOT NULL,
"address" text DEFAULT ''::text NOT NULL,
"phone" text DEFAULT ''::text NOT NULL,
"email" text DEFAULT ''::text NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."hotel_folio_lines" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"folio_id" uuid NOT NULL,
"line_type" hotel_folio_line_type NOT NULL,
"status" hotel_folio_line_status DEFAULT 'draft'::hotel_folio_line_status NOT NULL,
"source_reservation_room_id" uuid,
"source_hotel_room_id" uuid,
"stay_date" date,
"catalogue_id" uuid,
"tax_class" hotel_tax_class,
"description_snapshot" text NOT NULL,
"quantity" integer DEFAULT 1 NOT NULL,
"unit_price_cents" integer DEFAULT 0 NOT NULL,
"subtotal_cents" integer DEFAULT 0 NOT NULL,
"tax_cents" integer DEFAULT 0 NOT NULL,
"total_cents" integer DEFAULT 0 NOT NULL,
"tax_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
"n3_stock_id_snapshot" text,
"n3_stock_code_snapshot" text,
"n3_stock_name_snapshot" text,
"n3_uom_id_snapshot" text,
"n3_tax_code_id_snapshot" text,
"agreed_rate_cents_snapshot" integer,
"room_label_snapshot" text,
"settings_snapshot" jsonb,
"snapshot_frozen_at" timestamp with time zone,
"version" integer DEFAULT 1 NOT NULL,
"actor_n3_user_key" text NOT NULL,
"reason" text,
"reverses_line_id" uuid,
"client_request_id" uuid,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."hotel_folio_operations" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"operation" text NOT NULL,
"reservation_id" uuid NOT NULL,
"folio_id" uuid,
"target_line_id" uuid,
"client_request_id" uuid NOT NULL,
"request_fingerprint" text NOT NULL,
"result_line_id" uuid,
"result_evidence_id" uuid,
"actor_n3_user_key" text NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."hotel_folios" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"reservation_id" uuid NOT NULL,
"currency" text DEFAULT 'MYR'::text NOT NULL,
"status" text DEFAULT 'open'::text NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."hotel_guests" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"full_name" text NOT NULL,
"mobile" text,
"email" text,
"nationality" text,
"notes" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
"identity_type" text,
"identity_number" text,
"nationality_code" text,
"address_line_1" text,
"address_line_2" text,
"address_line_3" text,
"city" text,
"postcode" text,
"country_code" text,
"state_code" text,
"state_province" text
);

CREATE TABLE public."hotel_housekeeping_events" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"hotel_room_id" uuid NOT NULL,
"action" text NOT NULL,
"previous_condition" text,
"resulting_condition" text,
"dnd_before" boolean,
"dnd_after" boolean,
"actor_n3_user_key" text NOT NULL,
"source" text DEFAULT 'app'::text NOT NULL,
"note" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."hotel_housekeeping_handoffs" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"hotel_room_id" uuid NOT NULL,
"reservation_id" uuid,
"operation_request_id" uuid,
"source" text DEFAULT 'room_change'::text NOT NULL,
"actor_n3_user_key" text NOT NULL,
"state" text DEFAULT 'pending'::text NOT NULL,
"attempts" integer DEFAULT 0 NOT NULL,
"last_error" text,
"resolved_at" timestamp with time zone,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."hotel_mutation_requests" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"client_request_id" uuid NOT NULL,
"scope" text NOT NULL,
"reservation_id" uuid,
"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"fingerprint" text
);

CREATE TABLE public."hotel_receipt_alert_outbox" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"request_id" uuid NOT NULL,
"event" text NOT NULL,
"request_version" integer NOT NULL,
"status" text DEFAULT 'pending'::text NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"attempts" integer DEFAULT 0 NOT NULL,
"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
"claimed_at" timestamp with time zone,
"claim_token" uuid,
"sent_at" timestamp with time zone,
"last_error_code" text
);

CREATE TABLE public."hotel_receipt_control_decisions" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"request_id" uuid NOT NULL,
"decision" text NOT NULL,
"from_state" text NOT NULL,
"to_state" text NOT NULL,
"actor_n3_user_key" text NOT NULL,
"requester_n3_user_key" text NOT NULL,
"self_approved" boolean NOT NULL,
"outcome_code" text,
"note" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."hotel_receipt_control_executions" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"request_id" uuid NOT NULL,
"step" text NOT NULL,
"state" text DEFAULT 'claimed'::text NOT NULL,
"claimed_by_n3_user_key" text NOT NULL,
"claimed_version" integer NOT NULL,
"result_code" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"completed_at" timestamp with time zone
);

CREATE TABLE public."hotel_receipt_control_requests" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"reservation_id" uuid NOT NULL,
"deposit_id" uuid NOT NULL,
"client_request_id" uuid NOT NULL,
"request_fingerprint" text NOT NULL,
"kind" text NOT NULL,
"reason" text NOT NULL,
"original" jsonb NOT NULL,
"proposal" jsonb NOT NULL,
"comparison" jsonb NOT NULL,
"original_amount_cents" bigint NOT NULL,
"proposed_amount_cents" bigint,
"execution_mode" text DEFAULT 'manual'::text NOT NULL,
"state" text DEFAULT 'pending'::text NOT NULL,
"version" integer DEFAULT 1 NOT NULL,
"requested_by_n3_user_key" text NOT NULL,
"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
"decided_by_n3_user_key" text,
"decided_at" timestamp with time zone,
"approved_by_n3_user_key" text,
"approved_at" timestamp with time zone,
"outcome_code" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."hotel_receipt_versions" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"deposit_id" uuid NOT NULL,
"request_id" uuid NOT NULL,
"version_no" integer NOT NULL,
"state" text NOT NULL,
"receipt_id" text NOT NULL,
"doc_code" text NOT NULL,
"document_date" text NOT NULL,
"currency" text NOT NULL,
"amount_cents" bigint NOT NULL,
"payment_lines" jsonb NOT NULL,
"replacement_of" text,
"evidence_fingerprint" text NOT NULL,
"verified_by_n3_user_key" text NOT NULL,
"verified_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."hotel_reservation_deposits" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"reservation_id" uuid NOT NULL,
"amount" numeric(12,2) NOT NULL,
"currency_code" text NOT NULL,
"idempotency_key" text NOT NULL,
"n3_reference_no" text NOT NULL,
"status" text DEFAULT 'submitting'::text NOT NULL,
"n3_receipt_id" text,
"n3_doc_code" text,
"n3_customer_id" text,
"n3_customer_code" text,
"n3_customer_name" text,
"n3_account_id" text,
"n3_account_code" text,
"n3_account_name" text,
"description" text,
"created_by_n3_user_key" text NOT NULL,
"last_error_code" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
"payment_lines" jsonb
);

CREATE TABLE public."hotel_reservation_events" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"reservation_id" uuid NOT NULL,
"event_type" text NOT NULL,
"summary" text NOT NULL,
"actor_n3_user_key" text,
"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."hotel_reservation_guests" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"reservation_id" uuid NOT NULL,
"guest_id" uuid NOT NULL,
"is_primary" boolean DEFAULT false NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"reservation_room_id" uuid
);

CREATE TABLE public."hotel_reservation_operation_requests" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"reservation_id" uuid NOT NULL,
"operation_type" text NOT NULL,
"state" text DEFAULT 'pending'::text NOT NULL,
"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
"requested_by_n3_user_key" text NOT NULL,
"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
"decided_by_n3_user_key" text,
"decided_at" timestamp with time zone,
"decision_note" text,
"decision_idempotency_key" text,
"applied_at" timestamp with time zone,
"idempotency_key" text NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."hotel_reservation_rooms" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"reservation_id" uuid NOT NULL,
"hotel_room_id" uuid NOT NULL,
"arrival_date" date NOT NULL,
"departure_date" date NOT NULL,
"stay_range" daterange GENERATED ALWAYS AS (daterange(arrival_date, departure_date, '[)'::text)) STORED,
"base_rate_snapshot" numeric(12,2) NOT NULL,
"agreed_rate" numeric(12,2) NOT NULL,
"adults" integer NOT NULL,
"children" integer DEFAULT 0 NOT NULL,
"allocation_status" text DEFAULT 'reserved'::text NOT NULL,
"rate_override_reason" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
"remark" text
);

CREATE TABLE public."hotel_reservation_tax_profile" (
"tenant_id" uuid NOT NULL,
"reservation_id" uuid NOT NULL,
"guest_tax_class" hotel_guest_tax_class DEFAULT 'unknown'::hotel_guest_tax_class NOT NULL,
"evidence_note" text,
"updated_by_n3_user_key" text,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."hotel_reservations" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"booking_reference" text NOT NULL,
"booking_source" text NOT NULL,
"status" text DEFAULT 'confirmed'::text NOT NULL,
"arrival_date" date NOT NULL,
"departure_date" date NOT NULL,
"currency" text NOT NULL,
"notes" text,
"created_by_n3_user_key" text NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
"external_booking_reference" text,
"checked_in_at" timestamp with time zone,
"checked_in_by_n3_user_key" text,
"expected_check_out_at" timestamp with time zone,
"operational_note" text
);

CREATE TABLE public."hotel_room_housekeeping" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"hotel_room_id" uuid NOT NULL,
"condition" text NOT NULL,
"dnd_active" boolean DEFAULT false NOT NULL,
"dnd_set_at" timestamp with time zone,
"dnd_set_by_n3_user_key" text,
"initialized_at" timestamp with time zone DEFAULT now() NOT NULL,
"initialized_by_n3_user_key" text NOT NULL,
"last_action" text,
"last_actor_n3_user_key" text,
"last_transition_at" timestamp with time zone,
"note" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."hotel_rooms" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"n3_stock_id" text NOT NULL,
"n3_stock_code" text NOT NULL,
"n3_stock_name" text,
"room_number" text NOT NULL,
"display_name" text,
"room_type" text DEFAULT 'standard'::text NOT NULL,
"floor" text,
"max_occupancy" integer DEFAULT 2 NOT NULL,
"base_rate" numeric(12,2) DEFAULT 0 NOT NULL,
"is_active" boolean DEFAULT true NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."hotel_settings" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"currency" text DEFAULT 'MYR'::text NOT NULL,
"timezone" text DEFAULT 'Asia/Kuala_Lumpur'::text NOT NULL,
"standard_check_in_time" text DEFAULT '14:00'::text NOT NULL,
"standard_check_out_time" text DEFAULT '12:00'::text NOT NULL,
"n3_walk_in_customer_id" text,
"n3_walk_in_customer_code" text,
"n3_walk_in_customer_name" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
"post_check_in_guest_edit_policy" text DEFAULT 'locked'::text NOT NULL,
"allow_owner_primary_guest_change_after_check_in" boolean DEFAULT false NOT NULL,
"housekeeping_mode" text DEFAULT 'simple'::text NOT NULL,
"exception_approval_mode" text DEFAULT 'direct'::text NOT NULL,
"display_size" smallint DEFAULT 7 NOT NULL,
"payment_account_aliases" jsonb DEFAULT '{}'::jsonb NOT NULL,
"folio_body_pt" numeric(3,1) DEFAULT 8.5 NOT NULL,
"folio_note_pt" numeric(3,1) DEFAULT 5.0 NOT NULL,
"folio_contact_address" text DEFAULT ''::text NOT NULL,
"folio_contact_phone" text DEFAULT ''::text NOT NULL,
"folio_contact_email" text DEFAULT ''::text NOT NULL,
"payment_account_visibility" jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE public."hotel_tenants" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"n3_tenant_key" text NOT NULL,
"tenant_code" text,
"company_name" text,
"status" text DEFAULT 'active'::text NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."hotel_tourism_tax_evidence" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"reservation_id" uuid NOT NULL,
"source_label" text NOT NULL,
"reference" text,
"collected_on" date,
"amount_cents" integer DEFAULT 0 NOT NULL,
"note" text,
"actor_n3_user_key" text NOT NULL,
"client_request_id" uuid,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."hotel_user_directory" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"n3_user_key" text NOT NULL,
"display_name" text,
"email" text,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."hotel_user_roles" (
"id" uuid DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"n3_user_key" text NOT NULL,
"role" hotel_role NOT NULL,
"is_active" boolean DEFAULT true NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public."hotel_addon_catalogue" ADD CONSTRAINT "hotel_addon_catalogue_default_unit_price_cents_check" CHECK (((default_unit_price_cents >= 0) AND (default_unit_price_cents <= 1000000000)));

ALTER TABLE public."hotel_addon_catalogue" ADD CONSTRAINT "hotel_addon_catalogue_description_check" CHECK (((description IS NULL) OR (length(description) <= 240)));

ALTER TABLE public."hotel_addon_catalogue" ADD CONSTRAINT "hotel_addon_catalogue_display_name_check" CHECK (((length(btrim(display_name)) >= 1) AND (length(btrim(display_name)) <= 80)));

ALTER TABLE public."hotel_addon_catalogue" ADD CONSTRAINT "hotel_addon_catalogue_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_audit_events" ADD CONSTRAINT "hotel_audit_events_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_booking_sequences" ADD CONSTRAINT "hotel_booking_sequences_last_number_nonneg" CHECK ((last_number >= 0));

ALTER TABLE public."hotel_booking_sequences" ADD CONSTRAINT "hotel_booking_sequences_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_booking_sequences" ADD CONSTRAINT "hotel_booking_sequences_tenant_date_key" UNIQUE (tenant_id, sequence_date);

ALTER TABLE public."hotel_booking_sources" ADD CONSTRAINT "hotel_booking_sources_code_format" CHECK ((source_code ~ '^[a-z][a-z0-9_]{0,47}$'::text));

ALTER TABLE public."hotel_booking_sources" ADD CONSTRAINT "hotel_booking_sources_display_name_max" CHECK ((length(display_name) <= 80));

ALTER TABLE public."hotel_booking_sources" ADD CONSTRAINT "hotel_booking_sources_display_name_not_blank" CHECK ((length(btrim(display_name)) > 0));

ALTER TABLE public."hotel_booking_sources" ADD CONSTRAINT "hotel_booking_sources_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_booking_sources" ADD CONSTRAINT "hotel_booking_sources_tenant_code_key" UNIQUE (tenant_id, source_code);

ALTER TABLE public."hotel_booking_sources" ADD CONSTRAINT "hotel_booking_sources_tenant_id_uk" UNIQUE (tenant_id, id);

ALTER TABLE public."hotel_financial_settings" ADD CONSTRAINT "hotel_financial_settings_local_levy_cents_per_room_night_check" CHECK (((local_levy_cents_per_room_night >= 0) AND (local_levy_cents_per_room_night <= 100000)));

ALTER TABLE public."hotel_financial_settings" ADD CONSTRAINT "hotel_financial_settings_local_levy_label_check" CHECK (((local_levy_label IS NULL) OR (length(local_levy_label) <= 60)));

ALTER TABLE public."hotel_financial_settings" ADD CONSTRAINT "hotel_financial_settings_pkey" PRIMARY KEY (tenant_id);

ALTER TABLE public."hotel_financial_settings" ADD CONSTRAINT "hotel_financial_settings_rounding_mode_check" CHECK ((rounding_mode = ANY (ARRAY['none'::text, 'nearest_5_cents'::text, 'nearest_10_cents'::text])));

ALTER TABLE public."hotel_financial_settings" ADD CONSTRAINT "hotel_financial_settings_service_charge_percent_bp_check" CHECK (((service_charge_percent_bp >= 0) AND (service_charge_percent_bp <= 10000)));

ALTER TABLE public."hotel_financial_settings" ADD CONSTRAINT "hotel_financial_settings_service_tax_accommodation_rate_b_check" CHECK (((service_tax_accommodation_rate_bp IS NULL) OR ((service_tax_accommodation_rate_bp >= 0) AND (service_tax_accommodation_rate_bp <= 10000))));

ALTER TABLE public."hotel_financial_settings" ADD CONSTRAINT "hotel_financial_settings_service_tax_fnb_rate_bp_check" CHECK (((service_tax_fnb_rate_bp IS NULL) OR ((service_tax_fnb_rate_bp >= 0) AND (service_tax_fnb_rate_bp <= 10000))));

ALTER TABLE public."hotel_financial_settings" ADD CONSTRAINT "hotel_financial_settings_service_tax_other_rate_bp_check" CHECK (((service_tax_other_rate_bp IS NULL) OR ((service_tax_other_rate_bp >= 0) AND (service_tax_other_rate_bp <= 10000))));

ALTER TABLE public."hotel_financial_settings" ADD CONSTRAINT "hotel_financial_settings_service_tax_parking_rate_bp_check" CHECK (((service_tax_parking_rate_bp IS NULL) OR ((service_tax_parking_rate_bp >= 0) AND (service_tax_parking_rate_bp <= 10000))));

ALTER TABLE public."hotel_financial_settings" ADD CONSTRAINT "hotel_financial_settings_tourism_tax_cents_per_room_night_check" CHECK (((tourism_tax_cents_per_room_night >= 0) AND (tourism_tax_cents_per_room_night <= 100000)));

ALTER TABLE public."hotel_folio_bill_to" ADD CONSTRAINT "hotel_folio_bill_to_lengths" CHECK (((length(name) <= 160) AND (length(company) <= 200) AND (length(address) <= 600) AND (length(phone) <= 60) AND (length(email) <= 254)));

ALTER TABLE public."hotel_folio_bill_to" ADD CONSTRAINT "hotel_folio_bill_to_pkey" PRIMARY KEY (tenant_id, reservation_id);

ALTER TABLE public."hotel_folio_lines" ADD CONSTRAINT "hotel_folio_lines_description_snapshot_check" CHECK (((length(description_snapshot) >= 1) AND (length(description_snapshot) <= 160)));

ALTER TABLE public."hotel_folio_lines" ADD CONSTRAINT "hotel_folio_lines_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_folio_lines" ADD CONSTRAINT "hotel_folio_lines_quantity_check" CHECK (((quantity > 0) AND (quantity <= 9999)));

ALTER TABLE public."hotel_folio_lines" ADD CONSTRAINT "hotel_folio_lines_reason_check" CHECK (((reason IS NULL) OR ((length(reason) >= 3) AND (length(reason) <= 240))));

ALTER TABLE public."hotel_folio_lines" ADD CONSTRAINT "hotel_folio_lines_reversal_link_chk" CHECK (((line_type <> 'reversal'::hotel_folio_line_type) OR ((reverses_line_id IS NOT NULL) AND (reason IS NOT NULL))));

ALTER TABLE public."hotel_folio_lines" ADD CONSTRAINT "hotel_folio_lines_room_night_snapshot_chk" CHECK (((line_type <> 'room_night'::hotel_folio_line_type) OR ((stay_date IS NOT NULL) AND (source_reservation_room_id IS NOT NULL) AND (agreed_rate_cents_snapshot IS NOT NULL) AND (snapshot_frozen_at IS NOT NULL) AND (jsonb_typeof(settings_snapshot) = 'object'::text))));

ALTER TABLE public."hotel_folio_lines" ADD CONSTRAINT "hotel_folio_lines_tenant_id_uk" UNIQUE (tenant_id, id);

ALTER TABLE public."hotel_folio_lines" ADD CONSTRAINT "hotel_folio_lines_version_check" CHECK ((version > 0));

ALTER TABLE public."hotel_folio_operations" ADD CONSTRAINT "hotel_folio_operations_operation_check" CHECK ((operation = ANY (ARRAY['folio.add_addon'::text, 'folio.adjustment'::text, 'folio.reverse'::text, 'folio.update_quantity'::text, 'folio.tourism_tax_evidence'::text])));

ALTER TABLE public."hotel_folio_operations" ADD CONSTRAINT "hotel_folio_operations_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_folio_operations" ADD CONSTRAINT "hotel_folio_operations_request_fingerprint_check" CHECK ((request_fingerprint ~ '^[0-9a-f]{64}$'::text));

ALTER TABLE public."hotel_folios" ADD CONSTRAINT "hotel_folios_currency_check" CHECK ((currency ~ '^[A-Z]{3}$'::text));

ALTER TABLE public."hotel_folios" ADD CONSTRAINT "hotel_folios_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_folios" ADD CONSTRAINT "hotel_folios_status_check" CHECK ((status = ANY (ARRAY['open'::text, 'prepared'::text])));

ALTER TABLE public."hotel_folios" ADD CONSTRAINT "hotel_folios_tenant_id_uk" UNIQUE (tenant_id, id);

ALTER TABLE public."hotel_guests" ADD CONSTRAINT "hotel_guests_country_code_format" CHECK (((country_code IS NULL) OR (country_code ~ '^[A-Z]{3}$'::text)));

ALTER TABLE public."hotel_guests" ADD CONSTRAINT "hotel_guests_full_name_not_blank" CHECK ((length(btrim(full_name)) > 0));

ALTER TABLE public."hotel_guests" ADD CONSTRAINT "hotel_guests_identity_pair" CHECK (((identity_type IS NULL) = (identity_number IS NULL)));

ALTER TABLE public."hotel_guests" ADD CONSTRAINT "hotel_guests_identity_type_valid" CHECK (((identity_type IS NULL) OR (identity_type = ANY (ARRAY['mykad'::text, 'mypr'::text, 'passport'::text, 'other'::text]))));

ALTER TABLE public."hotel_guests" ADD CONSTRAINT "hotel_guests_mykad_format" CHECK (((identity_type IS NULL) OR (identity_type <> ALL (ARRAY['mykad'::text, 'mypr'::text])) OR (identity_number ~ '^[0-9]{12}$'::text)));

ALTER TABLE public."hotel_guests" ADD CONSTRAINT "hotel_guests_nationality_code_format" CHECK (((nationality_code IS NULL) OR (nationality_code ~ '^[A-Z]{3}$'::text)));

ALTER TABLE public."hotel_guests" ADD CONSTRAINT "hotel_guests_passport_length" CHECK (((identity_type IS NULL) OR (identity_type <> ALL (ARRAY['passport'::text, 'other'::text])) OR ((length(identity_number) >= 1) AND (length(identity_number) <= 50))));

ALTER TABLE public."hotel_guests" ADD CONSTRAINT "hotel_guests_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_guests" ADD CONSTRAINT "hotel_guests_state_code_format" CHECK (((state_code IS NULL) OR (state_code ~ '^[0-9]{2}$'::text)));

ALTER TABLE public."hotel_guests" ADD CONSTRAINT "hotel_guests_tenant_id_uk" UNIQUE (tenant_id, id);

ALTER TABLE public."hotel_housekeeping_events" ADD CONSTRAINT "hotel_housekeeping_events_action_valid" CHECK ((action = ANY (ARRAY['initialize'::text, 'start_cleaning'::text, 'finish_cleaning'::text, 'mark_ready'::text, 'mark_dirty'::text, 'revert_to_cleaning'::text, 'set_dnd'::text, 'clear_dnd'::text, 'vacated'::text])));

ALTER TABLE public."hotel_housekeeping_events" ADD CONSTRAINT "hotel_housekeeping_events_note_len" CHECK (((note IS NULL) OR (length(note) <= 300)));

ALTER TABLE public."hotel_housekeeping_events" ADD CONSTRAINT "hotel_housekeeping_events_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_housekeeping_events" ADD CONSTRAINT "hotel_housekeeping_events_prev_valid" CHECK (((previous_condition IS NULL) OR (previous_condition = ANY (ARRAY['dirty'::text, 'cleaning'::text, 'inspected'::text, 'ready'::text]))));

ALTER TABLE public."hotel_housekeeping_events" ADD CONSTRAINT "hotel_housekeeping_events_result_valid" CHECK (((resulting_condition IS NULL) OR (resulting_condition = ANY (ARRAY['dirty'::text, 'cleaning'::text, 'inspected'::text, 'ready'::text]))));

ALTER TABLE public."hotel_housekeeping_handoffs" ADD CONSTRAINT "hotel_hk_handoffs_state_chk" CHECK ((state = ANY (ARRAY['pending'::text, 'applied'::text, 'cancelled'::text])));

ALTER TABLE public."hotel_housekeeping_handoffs" ADD CONSTRAINT "hotel_housekeeping_handoffs_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_mutation_requests" ADD CONSTRAINT "hotel_mutation_requests_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_mutation_requests" ADD CONSTRAINT "hotel_mutation_requests_tenant_id_scope_client_request_id_key" UNIQUE (tenant_id, scope, client_request_id);

ALTER TABLE public."hotel_receipt_alert_outbox" ADD CONSTRAINT "hotel_receipt_alert_outbox_attempts_check" CHECK (((attempts >= 0) AND (attempts <= 10)));

ALTER TABLE public."hotel_receipt_alert_outbox" ADD CONSTRAINT "hotel_receipt_alert_outbox_event_check" CHECK ((event = ANY (ARRAY['pending'::text, 'decision'::text, 'execution_failure'::text])));

ALTER TABLE public."hotel_receipt_alert_outbox" ADD CONSTRAINT "hotel_receipt_alert_outbox_last_error_code_check" CHECK (((last_error_code IS NULL) OR (length(last_error_code) <= 64)));

ALTER TABLE public."hotel_receipt_alert_outbox" ADD CONSTRAINT "hotel_receipt_alert_outbox_once" UNIQUE (tenant_id, request_id, event, request_version);

ALTER TABLE public."hotel_receipt_alert_outbox" ADD CONSTRAINT "hotel_receipt_alert_outbox_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_receipt_alert_outbox" ADD CONSTRAINT "hotel_receipt_alert_outbox_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'disabled'::text])));

ALTER TABLE public."hotel_receipt_control_decisions" ADD CONSTRAINT "hotel_receipt_control_decisions_decision_check" CHECK ((decision = ANY (ARRAY['approve'::text, 'reject'::text, 'hold'::text, 'verify'::text, 'recover'::text])));

ALTER TABLE public."hotel_receipt_control_decisions" ADD CONSTRAINT "hotel_receipt_control_decisions_note_check" CHECK (((note IS NULL) OR (hotelhub_utf16_length(note) <= 500)));

ALTER TABLE public."hotel_receipt_control_decisions" ADD CONSTRAINT "hotel_receipt_control_decisions_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_receipt_control_executions" ADD CONSTRAINT "hotel_receipt_control_executions_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_receipt_control_executions" ADD CONSTRAINT "hotel_receipt_control_executions_state_check" CHECK ((state = ANY (ARRAY['claimed'::text, 'completed'::text, 'released'::text])));

ALTER TABLE public."hotel_receipt_control_executions" ADD CONSTRAINT "hotel_receipt_control_executions_step_check" CHECK ((step = ANY (ARRAY['verify'::text, 'edit'::text, 'void'::text, 'replace'::text])));

ALTER TABLE public."hotel_receipt_control_requests" ADD CONSTRAINT "hotel_receipt_control_requests_approval_pair" CHECK (((approved_at IS NULL) = (approved_by_n3_user_key IS NULL)));

ALTER TABLE public."hotel_receipt_control_requests" ADD CONSTRAINT "hotel_receipt_control_requests_client_key" UNIQUE (tenant_id, client_request_id);

ALTER TABLE public."hotel_receipt_control_requests" ADD CONSTRAINT "hotel_receipt_control_requests_execution_mode_check" CHECK ((execution_mode = ANY (ARRAY['manual'::text, 'direct'::text, 'void_replace'::text])));

ALTER TABLE public."hotel_receipt_control_requests" ADD CONSTRAINT "hotel_receipt_control_requests_kind_amount" CHECK (((kind = 'void'::text) = (proposed_amount_cents IS NULL)));

ALTER TABLE public."hotel_receipt_control_requests" ADD CONSTRAINT "hotel_receipt_control_requests_kind_check" CHECK ((kind = ANY (ARRAY['correction'::text, 'void'::text])));

ALTER TABLE public."hotel_receipt_control_requests" ADD CONSTRAINT "hotel_receipt_control_requests_original_amount_cents_check" CHECK (((original_amount_cents > 0) AND (original_amount_cents <= 100000000)));

ALTER TABLE public."hotel_receipt_control_requests" ADD CONSTRAINT "hotel_receipt_control_requests_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_receipt_control_requests" ADD CONSTRAINT "hotel_receipt_control_requests_proposed_amount_cents_check" CHECK (((proposed_amount_cents IS NULL) OR ((proposed_amount_cents > 0) AND (proposed_amount_cents <= 100000000))));

ALTER TABLE public."hotel_receipt_control_requests" ADD CONSTRAINT "hotel_receipt_control_requests_reason_check" CHECK (((reason = btrim(reason)) AND ((hotelhub_utf16_length(reason) >= 1) AND (hotelhub_utf16_length(reason) <= 500))));

ALTER TABLE public."hotel_receipt_control_requests" ADD CONSTRAINT "hotel_receipt_control_requests_request_fingerprint_check" CHECK (((length(request_fingerprint) >= 16) AND (length(request_fingerprint) <= 128)));

ALTER TABLE public."hotel_receipt_control_requests" ADD CONSTRAINT "hotel_receipt_control_requests_state_check" CHECK ((state = ANY (ARRAY['pending'::text, 'rejected'::text, 'approved_awaiting_n3'::text, 'applying'::text, 'applied'::text, 'failed'::text, 'needs_review'::text])));

ALTER TABLE public."hotel_receipt_control_requests" ADD CONSTRAINT "hotel_receipt_control_requests_tenant_id_deposit_uk" UNIQUE (tenant_id, id, deposit_id);

ALTER TABLE public."hotel_receipt_control_requests" ADD CONSTRAINT "hotel_receipt_control_requests_tenant_id_uk" UNIQUE (tenant_id, id);

ALTER TABLE public."hotel_receipt_control_requests" ADD CONSTRAINT "hotel_receipt_control_requests_version_check" CHECK ((version >= 1));

ALTER TABLE public."hotel_receipt_versions" ADD CONSTRAINT "hotel_receipt_versions_active_positive" CHECK (((state = 'voided'::text) OR (amount_cents > 0)));

ALTER TABLE public."hotel_receipt_versions" ADD CONSTRAINT "hotel_receipt_versions_amount_cents_check" CHECK (((amount_cents >= 0) AND (amount_cents <= 100000000)));

ALTER TABLE public."hotel_receipt_versions" ADD CONSTRAINT "hotel_receipt_versions_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_receipt_versions" ADD CONSTRAINT "hotel_receipt_versions_seq" UNIQUE (tenant_id, deposit_id, version_no);

ALTER TABLE public."hotel_receipt_versions" ADD CONSTRAINT "hotel_receipt_versions_state_check" CHECK ((state = ANY (ARRAY['active'::text, 'voided'::text])));

ALTER TABLE public."hotel_receipt_versions" ADD CONSTRAINT "hotel_receipt_versions_version_no_check" CHECK ((version_no >= 1));

ALTER TABLE public."hotel_reservation_deposits" ADD CONSTRAINT "hotel_reservation_deposits_amount_positive" CHECK ((amount > (0)::numeric));

ALTER TABLE public."hotel_reservation_deposits" ADD CONSTRAINT "hotel_reservation_deposits_amount_scale" CHECK ((amount = round(amount, 2)));

ALTER TABLE public."hotel_reservation_deposits" ADD CONSTRAINT "hotel_reservation_deposits_error_len" CHECK (((last_error_code IS NULL) OR (char_length(last_error_code) <= 64)));

ALTER TABLE public."hotel_reservation_deposits" ADD CONSTRAINT "hotel_reservation_deposits_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_reservation_deposits" ADD CONSTRAINT "hotel_reservation_deposits_reference_len" CHECK ((char_length(n3_reference_no) <= 30));

ALTER TABLE public."hotel_reservation_deposits" ADD CONSTRAINT "hotel_reservation_deposits_status_check" CHECK ((status = ANY (ARRAY['submitting'::text, 'posted'::text, 'failed'::text, 'unknown'::text])));

ALTER TABLE public."hotel_reservation_deposits" ADD CONSTRAINT "hotel_reservation_deposits_tenant_id_uk" UNIQUE (tenant_id, id);

ALTER TABLE public."hotel_reservation_deposits" ADD CONSTRAINT "hotel_reservation_deposits_tenant_res_id_uk" UNIQUE (tenant_id, reservation_id, id);

ALTER TABLE public."hotel_reservation_events" ADD CONSTRAINT "hotel_reservation_events_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_reservation_events" ADD CONSTRAINT "hotel_reservation_events_summary_len" CHECK (((length(summary) >= 1) AND (length(summary) <= 300)));

ALTER TABLE public."hotel_reservation_events" ADD CONSTRAINT "hotel_reservation_events_type_valid" CHECK ((event_type = ANY (ARRAY['reservation_created'::text, 'reservation_edited'::text, 'guest_added'::text, 'guest_updated'::text, 'guest_removed'::text, 'room_added'::text, 'room_removed'::text, 'operation_requested'::text, 'operation_approved'::text, 'operation_rejected'::text, 'checked_in'::text, 'room_changed'::text, 'stay_extended'::text, 'late_checkout_approved'::text, 'rate_changed'::text])));

ALTER TABLE public."hotel_reservation_guests" ADD CONSTRAINT "hotel_reservation_guests_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_reservation_guests" ADD CONSTRAINT "hotel_reservation_guests_unique" UNIQUE (reservation_id, guest_id);

ALTER TABLE public."hotel_reservation_operation_requests" ADD CONSTRAINT "hotel_reservation_operation_requests_applied_shape" CHECK ((((state = 'applied'::text) AND (applied_at IS NOT NULL)) OR ((state <> 'applied'::text) AND (applied_at IS NULL))));

ALTER TABLE public."hotel_reservation_operation_requests" ADD CONSTRAINT "hotel_reservation_operation_requests_decision_shape" CHECK ((((state = 'pending'::text) AND (decided_at IS NULL) AND (decided_by_n3_user_key IS NULL)) OR (state = 'cancelled'::text) OR ((state = ANY (ARRAY['approved'::text, 'rejected'::text, 'applied'::text])) AND (decided_at IS NOT NULL) AND (decided_by_n3_user_key IS NOT NULL))));

ALTER TABLE public."hotel_reservation_operation_requests" ADD CONSTRAINT "hotel_reservation_operation_requests_idem_key_nonempty" CHECK ((length(btrim(idempotency_key)) > 0));

ALTER TABLE public."hotel_reservation_operation_requests" ADD CONSTRAINT "hotel_reservation_operation_requests_idem_unique" UNIQUE (tenant_id, idempotency_key);

ALTER TABLE public."hotel_reservation_operation_requests" ADD CONSTRAINT "hotel_reservation_operation_requests_note_len" CHECK (((decision_note IS NULL) OR (length(decision_note) <= 300)));

ALTER TABLE public."hotel_reservation_operation_requests" ADD CONSTRAINT "hotel_reservation_operation_requests_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_reservation_operation_requests" ADD CONSTRAINT "hotel_reservation_operation_requests_state_valid" CHECK ((state = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'applied'::text, 'cancelled'::text])));

ALTER TABLE public."hotel_reservation_operation_requests" ADD CONSTRAINT "hotel_reservation_operation_requests_type_valid" CHECK ((operation_type = ANY (ARRAY['early_check_in'::text, 'late_checkout'::text, 'room_change'::text, 'stay_extension'::text, 'rate_change'::text])));

ALTER TABLE public."hotel_reservation_rooms" ADD CONSTRAINT "hotel_reservation_rooms_adults_positive" CHECK ((adults >= 1));

ALTER TABLE public."hotel_reservation_rooms" ADD CONSTRAINT "hotel_reservation_rooms_agreed_rate_nonneg" CHECK ((agreed_rate >= (0)::numeric));

ALTER TABLE public."hotel_reservation_rooms" ADD CONSTRAINT "hotel_reservation_rooms_alloc_valid" CHECK ((allocation_status = ANY (ARRAY['reserved'::text, 'occupied'::text, 'released'::text])));

ALTER TABLE public."hotel_reservation_rooms" ADD CONSTRAINT "hotel_reservation_rooms_base_rate_nonneg" CHECK ((base_rate_snapshot >= (0)::numeric));

ALTER TABLE public."hotel_reservation_rooms" ADD CONSTRAINT "hotel_reservation_rooms_children_nonneg" CHECK ((children >= 0));

ALTER TABLE public."hotel_reservation_rooms" ADD CONSTRAINT "hotel_reservation_rooms_dates_valid" CHECK ((departure_date > arrival_date));

ALTER TABLE public."hotel_reservation_rooms" ADD CONSTRAINT "hotel_reservation_rooms_no_overlap" EXCLUDE USING gist (tenant_id WITH =, hotel_room_id WITH =, stay_range WITH &&) WHERE ((allocation_status = ANY (ARRAY['reserved'::text, 'occupied'::text])));

ALTER TABLE public."hotel_reservation_rooms" ADD CONSTRAINT "hotel_reservation_rooms_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_reservation_rooms" ADD CONSTRAINT "hotel_reservation_rooms_remark_len" CHECK (((remark IS NULL) OR (length(remark) <= 500)));

ALTER TABLE public."hotel_reservation_rooms" ADD CONSTRAINT "hotel_reservation_rooms_unique_per_reservation" UNIQUE (reservation_id, hotel_room_id);

ALTER TABLE public."hotel_reservation_tax_profile" ADD CONSTRAINT "hotel_reservation_tax_profile_evidence_note_check" CHECK (((evidence_note IS NULL) OR (length(evidence_note) <= 240)));

ALTER TABLE public."hotel_reservation_tax_profile" ADD CONSTRAINT "hotel_reservation_tax_profile_pkey" PRIMARY KEY (tenant_id, reservation_id);

ALTER TABLE public."hotel_reservations" ADD CONSTRAINT "hotel_reservations_dates_valid" CHECK ((departure_date > arrival_date));

ALTER TABLE public."hotel_reservations" ADD CONSTRAINT "hotel_reservations_external_ref_length" CHECK (((external_booking_reference IS NULL) OR ((length(external_booking_reference) >= 1) AND (length(external_booking_reference) <= 100))));

ALTER TABLE public."hotel_reservations" ADD CONSTRAINT "hotel_reservations_operational_note_len" CHECK (((operational_note IS NULL) OR (length(operational_note) <= 500)));

ALTER TABLE public."hotel_reservations" ADD CONSTRAINT "hotel_reservations_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_reservations" ADD CONSTRAINT "hotel_reservations_status_valid" CHECK ((status = ANY (ARRAY['tentative'::text, 'confirmed'::text, 'checked_in'::text, 'checked_out'::text, 'cancelled'::text, 'no_show'::text])));

ALTER TABLE public."hotel_reservations" ADD CONSTRAINT "hotel_reservations_tenant_id_uk" UNIQUE (tenant_id, id);

ALTER TABLE public."hotel_reservations" ADD CONSTRAINT "hotel_reservations_tenant_ref_key" UNIQUE (tenant_id, booking_reference);

ALTER TABLE public."hotel_room_housekeeping" ADD CONSTRAINT "hotel_room_housekeeping_condition_valid" CHECK ((condition = ANY (ARRAY['dirty'::text, 'cleaning'::text, 'inspected'::text, 'ready'::text])));

ALTER TABLE public."hotel_room_housekeeping" ADD CONSTRAINT "hotel_room_housekeeping_note_len" CHECK (((note IS NULL) OR (length(note) <= 300)));

ALTER TABLE public."hotel_room_housekeeping" ADD CONSTRAINT "hotel_room_housekeeping_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_room_housekeeping" ADD CONSTRAINT "hotel_room_housekeeping_tenant_room_uk" UNIQUE (tenant_id, hotel_room_id);

ALTER TABLE public."hotel_rooms" ADD CONSTRAINT "hotel_rooms_base_rate_nonnegative" CHECK ((base_rate >= (0)::numeric));

ALTER TABLE public."hotel_rooms" ADD CONSTRAINT "hotel_rooms_max_occupancy_positive" CHECK ((max_occupancy >= 1));

ALTER TABLE public."hotel_rooms" ADD CONSTRAINT "hotel_rooms_number_matches_stock" CHECK ((room_number = n3_stock_code));

ALTER TABLE public."hotel_rooms" ADD CONSTRAINT "hotel_rooms_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_rooms" ADD CONSTRAINT "hotel_rooms_tenant_id_uk" UNIQUE (tenant_id, id);

ALTER TABLE public."hotel_settings" ADD CONSTRAINT "hotel_settings_display_size_check" CHECK ((display_size = ANY (ARRAY[7, 8, 9])));

ALTER TABLE public."hotel_settings" ADD CONSTRAINT "hotel_settings_exception_approval_mode_check" CHECK ((exception_approval_mode = ANY (ARRAY['owner_approval'::text, 'direct'::text])));

ALTER TABLE public."hotel_settings" ADD CONSTRAINT "hotel_settings_folio_body_pt_allowed" CHECK ((folio_body_pt = ANY (ARRAY[(8)::numeric, 8.5, (9)::numeric, 9.5, (10)::numeric])));

ALTER TABLE public."hotel_settings" ADD CONSTRAINT "hotel_settings_folio_contact_length" CHECK (((length(folio_contact_address) <= 500) AND (length(folio_contact_phone) <= 60) AND (length(folio_contact_email) <= 254)));

ALTER TABLE public."hotel_settings" ADD CONSTRAINT "hotel_settings_folio_note_pt_allowed" CHECK ((folio_note_pt = ANY (ARRAY[(5)::numeric, 5.5, (6)::numeric, 6.5, (7)::numeric])));

ALTER TABLE public."hotel_settings" ADD CONSTRAINT "hotel_settings_guest_edit_policy_chk" CHECK ((post_check_in_guest_edit_policy = ANY (ARRAY['locked'::text, 'contact_only'::text])));

ALTER TABLE public."hotel_settings" ADD CONSTRAINT "hotel_settings_housekeeping_mode_valid" CHECK ((housekeeping_mode = ANY (ARRAY['simple'::text, 'dedicated'::text])));

ALTER TABLE public."hotel_settings" ADD CONSTRAINT "hotel_settings_payment_account_visibility_object" CHECK ((jsonb_typeof(payment_account_visibility) = 'object'::text));

ALTER TABLE public."hotel_settings" ADD CONSTRAINT "hotel_settings_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_settings" ADD CONSTRAINT "hotel_settings_post_check_in_guest_edit_policy_check" CHECK ((post_check_in_guest_edit_policy = ANY (ARRAY['locked'::text, 'contact_only'::text])));

ALTER TABLE public."hotel_settings" ADD CONSTRAINT "hotel_settings_tenant_id_key" UNIQUE (tenant_id);

ALTER TABLE public."hotel_tenants" ADD CONSTRAINT "hotel_tenants_n3_tenant_key_key" UNIQUE (n3_tenant_key);

ALTER TABLE public."hotel_tenants" ADD CONSTRAINT "hotel_tenants_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_tourism_tax_evidence" ADD CONSTRAINT "hotel_tourism_tax_evidence_amount_cents_check" CHECK (((amount_cents >= 0) AND (amount_cents <= 100000000)));

ALTER TABLE public."hotel_tourism_tax_evidence" ADD CONSTRAINT "hotel_tourism_tax_evidence_note_check" CHECK (((note IS NULL) OR (length(note) <= 240)));

ALTER TABLE public."hotel_tourism_tax_evidence" ADD CONSTRAINT "hotel_tourism_tax_evidence_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_tourism_tax_evidence" ADD CONSTRAINT "hotel_tourism_tax_evidence_reference_check" CHECK (((reference IS NULL) OR (length(reference) <= 80)));

ALTER TABLE public."hotel_tourism_tax_evidence" ADD CONSTRAINT "hotel_tourism_tax_evidence_source_label_check" CHECK (((length(btrim(source_label)) >= 2) AND (length(btrim(source_label)) <= 60)));

ALTER TABLE public."hotel_tourism_tax_evidence" ADD CONSTRAINT "hotel_tourism_tax_evidence_tenant_id_uk" UNIQUE (tenant_id, id);

ALTER TABLE public."hotel_user_directory" ADD CONSTRAINT "hotel_user_directory_display_len" CHECK (((display_name IS NULL) OR (length(display_name) <= 200)));

ALTER TABLE public."hotel_user_directory" ADD CONSTRAINT "hotel_user_directory_email_len" CHECK (((email IS NULL) OR (length(email) <= 320)));

ALTER TABLE public."hotel_user_directory" ADD CONSTRAINT "hotel_user_directory_key_nonempty" CHECK ((length(btrim(n3_user_key)) > 0));

ALTER TABLE public."hotel_user_directory" ADD CONSTRAINT "hotel_user_directory_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_user_directory" ADD CONSTRAINT "hotel_user_directory_unique" UNIQUE (tenant_id, n3_user_key);

ALTER TABLE public."hotel_user_roles" ADD CONSTRAINT "hotel_user_roles_pkey" PRIMARY KEY (id);

ALTER TABLE public."hotel_user_roles" ADD CONSTRAINT "hotel_user_roles_tenant_id_n3_user_key_key" UNIQUE (tenant_id, n3_user_key);

CREATE UNIQUE INDEX hotel_addon_catalogue_tenant_name_uidx ON public.hotel_addon_catalogue USING btree (tenant_id, lower(btrim(display_name)));

CREATE INDEX hotel_addon_catalogue_tenant_active_idx ON public.hotel_addon_catalogue USING btree (tenant_id, is_active, sort_order);

CREATE INDEX hotel_audit_events_tenant_idx ON public.hotel_audit_events USING btree (tenant_id, created_at DESC);

CREATE INDEX hotel_audit_events_type_idx ON public.hotel_audit_events USING btree (event_type, created_at DESC);

CREATE UNIQUE INDEX hotel_booking_sources_tenant_display_lower_idx ON public.hotel_booking_sources USING btree (tenant_id, lower(display_name));

CREATE INDEX hotel_booking_sources_tenant_sort_idx ON public.hotel_booking_sources USING btree (tenant_id, sort_order, lower(display_name));

CREATE INDEX hotel_folio_lines_folio_idx ON public.hotel_folio_lines USING btree (tenant_id, folio_id, created_at);

CREATE UNIQUE INDEX hotel_folio_lines_room_night_uidx ON public.hotel_folio_lines USING btree (tenant_id, folio_id, source_reservation_room_id, stay_date) WHERE (line_type = 'room_night'::hotel_folio_line_type);

CREATE UNIQUE INDEX hotel_folio_lines_reverses_uidx ON public.hotel_folio_lines USING btree (tenant_id, reverses_line_id) WHERE (reverses_line_id IS NOT NULL);

CREATE UNIQUE INDEX hotel_folio_operations_key_uidx ON public.hotel_folio_operations USING btree (tenant_id, operation, client_request_id);

CREATE INDEX hotel_folio_operations_target_idx ON public.hotel_folio_operations USING btree (tenant_id, reservation_id, created_at);

CREATE UNIQUE INDEX hotel_folios_tenant_reservation_uidx ON public.hotel_folios USING btree (tenant_id, reservation_id);

CREATE INDEX hotel_guests_tenant_name_idx ON public.hotel_guests USING btree (tenant_id, lower(full_name));

CREATE INDEX hotel_housekeeping_events_room_idx ON public.hotel_housekeeping_events USING btree (tenant_id, hotel_room_id, created_at DESC);

CREATE UNIQUE INDEX hotel_hk_handoffs_op_room_uniq ON public.hotel_housekeeping_handoffs USING btree (tenant_id, operation_request_id, hotel_room_id) WHERE (operation_request_id IS NOT NULL);

CREATE INDEX hotel_hk_handoffs_pending_idx ON public.hotel_housekeeping_handoffs USING btree (tenant_id, created_at) WHERE (state = 'pending'::text);

CREATE INDEX hotel_receipt_alert_outbox_due ON public.hotel_receipt_alert_outbox USING btree (tenant_id, status, next_attempt_at);

CREATE INDEX hotel_receipt_control_decisions_request ON public.hotel_receipt_control_decisions USING btree (request_id);

CREATE UNIQUE INDEX hotel_receipt_control_executions_inflight ON public.hotel_receipt_control_executions USING btree (request_id) WHERE (state = 'claimed'::text);

CREATE UNIQUE INDEX hotel_receipt_control_executions_write_once ON public.hotel_receipt_control_executions USING btree (request_id, step) WHERE ((step <> 'verify'::text) AND (state = 'completed'::text));

CREATE UNIQUE INDEX hotel_receipt_control_one_active ON public.hotel_receipt_control_requests USING btree (tenant_id, deposit_id) WHERE (state = ANY (ARRAY['pending'::text, 'approved_awaiting_n3'::text, 'applying'::text, 'failed'::text, 'needs_review'::text]));

CREATE INDEX hotel_receipt_control_requests_queue ON public.hotel_receipt_control_requests USING btree (tenant_id, state, requested_at DESC);

CREATE INDEX hotel_receipt_control_requests_reservation ON public.hotel_receipt_control_requests USING btree (tenant_id, reservation_id);

CREATE UNIQUE INDEX hotel_reservation_deposits_tenant_idem_uidx ON public.hotel_reservation_deposits USING btree (tenant_id, idempotency_key);

CREATE UNIQUE INDEX hotel_reservation_deposits_tenant_reference_uidx ON public.hotel_reservation_deposits USING btree (tenant_id, n3_reference_no);

CREATE UNIQUE INDEX hotel_reservation_deposits_tenant_receipt_uidx ON public.hotel_reservation_deposits USING btree (tenant_id, n3_receipt_id) WHERE (n3_receipt_id IS NOT NULL);

CREATE UNIQUE INDEX hotel_reservation_deposits_tenant_doccode_uidx ON public.hotel_reservation_deposits USING btree (tenant_id, n3_doc_code) WHERE (n3_doc_code IS NOT NULL);

CREATE INDEX hotel_reservation_deposits_tenant_reservation_idx ON public.hotel_reservation_deposits USING btree (tenant_id, reservation_id, created_at DESC);

CREATE INDEX hotel_reservation_events_tenant_res_idx ON public.hotel_reservation_events USING btree (tenant_id, reservation_id, occurred_at DESC);

CREATE UNIQUE INDEX hotel_reservation_guests_one_primary_idx ON public.hotel_reservation_guests USING btree (reservation_id) WHERE is_primary;

CREATE INDEX hotel_reservation_guests_room_idx ON public.hotel_reservation_guests USING btree (tenant_id, reservation_room_id);

CREATE INDEX hotel_reservation_guests_res_idx ON public.hotel_reservation_guests USING btree (tenant_id, reservation_id);

CREATE INDEX hotel_reservation_operation_requests_tenant_res_idx ON public.hotel_reservation_operation_requests USING btree (tenant_id, reservation_id, created_at DESC);

CREATE INDEX hotel_reservation_operation_requests_pending_idx ON public.hotel_reservation_operation_requests USING btree (tenant_id, state, created_at DESC);

CREATE UNIQUE INDEX hotel_reservation_operation_requests_one_pending_idx ON public.hotel_reservation_operation_requests USING btree (tenant_id, reservation_id, operation_type) WHERE (state = 'pending'::text);

CREATE INDEX hotel_reservation_rooms_tenant_room_range_idx ON public.hotel_reservation_rooms USING gist (tenant_id, hotel_room_id, stay_range);

CREATE INDEX hotel_reservation_rooms_res_idx ON public.hotel_reservation_rooms USING btree (tenant_id, reservation_id);

CREATE INDEX hotel_reservations_tenant_arrival_idx ON public.hotel_reservations USING btree (tenant_id, arrival_date DESC);

CREATE INDEX hotel_reservations_tenant_created_idx ON public.hotel_reservations USING btree (tenant_id, created_at DESC);

CREATE INDEX hotel_room_housekeeping_tenant_idx ON public.hotel_room_housekeeping USING btree (tenant_id, condition);

CREATE UNIQUE INDEX hotel_rooms_tenant_stock_code_key ON public.hotel_rooms USING btree (tenant_id, n3_stock_code);

CREATE INDEX hotel_tenants_status_idx ON public.hotel_tenants USING btree (status);

CREATE INDEX hotel_tourism_tax_evidence_res_idx ON public.hotel_tourism_tax_evidence USING btree (tenant_id, reservation_id, created_at);

CREATE INDEX hotel_user_roles_tenant_idx ON public.hotel_user_roles USING btree (tenant_id);

CREATE INDEX hotel_user_roles_user_idx ON public.hotel_user_roles USING btree (n3_user_key);

CREATE UNIQUE INDEX hotel_user_roles_tenant_user_key_uniq ON public.hotel_user_roles USING btree (tenant_id, n3_user_key);

ALTER TABLE public."hotel_addon_catalogue" ADD CONSTRAINT "hotel_addon_catalogue_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id) ON DELETE CASCADE;

ALTER TABLE public."hotel_audit_events" ADD CONSTRAINT "hotel_audit_events_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id) ON DELETE SET NULL;

ALTER TABLE public."hotel_booking_sequences" ADD CONSTRAINT "hotel_booking_sequences_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id) ON DELETE CASCADE;

ALTER TABLE public."hotel_booking_sources" ADD CONSTRAINT "hotel_booking_sources_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id) ON DELETE CASCADE;

ALTER TABLE public."hotel_financial_settings" ADD CONSTRAINT "hotel_financial_settings_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id) ON DELETE CASCADE;

ALTER TABLE public."hotel_folio_bill_to" ADD CONSTRAINT "hotel_folio_bill_to_tenant_id_reservation_id_fkey" FOREIGN KEY (tenant_id, reservation_id) REFERENCES hotel_reservations(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE public."hotel_folio_lines" ADD CONSTRAINT "hotel_folio_lines_catalogue_id_fkey" FOREIGN KEY (catalogue_id) REFERENCES hotel_addon_catalogue(id) ON DELETE RESTRICT;

ALTER TABLE public."hotel_folio_lines" ADD CONSTRAINT "hotel_folio_lines_reverses_line_id_fkey" FOREIGN KEY (reverses_line_id) REFERENCES hotel_folio_lines(id) ON DELETE RESTRICT;

ALTER TABLE public."hotel_folio_lines" ADD CONSTRAINT "hotel_folio_lines_source_hotel_room_id_fkey" FOREIGN KEY (source_hotel_room_id) REFERENCES hotel_rooms(id) ON DELETE SET NULL;

ALTER TABLE public."hotel_folio_lines" ADD CONSTRAINT "hotel_folio_lines_source_reservation_room_id_fkey" FOREIGN KEY (source_reservation_room_id) REFERENCES hotel_reservation_rooms(id) ON DELETE SET NULL;

ALTER TABLE public."hotel_folio_lines" ADD CONSTRAINT "hotel_folio_lines_tenant_folio_fkey" FOREIGN KEY (tenant_id, folio_id) REFERENCES hotel_folios(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE public."hotel_folio_lines" ADD CONSTRAINT "hotel_folio_lines_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id) ON DELETE CASCADE;

ALTER TABLE public."hotel_folio_operations" ADD CONSTRAINT "hotel_folio_operations_tenant_evidence_fkey" FOREIGN KEY (tenant_id, result_evidence_id) REFERENCES hotel_tourism_tax_evidence(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE public."hotel_folio_operations" ADD CONSTRAINT "hotel_folio_operations_tenant_folio_fkey" FOREIGN KEY (tenant_id, folio_id) REFERENCES hotel_folios(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE public."hotel_folio_operations" ADD CONSTRAINT "hotel_folio_operations_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id) ON DELETE CASCADE;

ALTER TABLE public."hotel_folio_operations" ADD CONSTRAINT "hotel_folio_operations_tenant_res_fkey" FOREIGN KEY (tenant_id, reservation_id) REFERENCES hotel_reservations(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE public."hotel_folio_operations" ADD CONSTRAINT "hotel_folio_operations_tenant_result_fkey" FOREIGN KEY (tenant_id, result_line_id) REFERENCES hotel_folio_lines(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE public."hotel_folio_operations" ADD CONSTRAINT "hotel_folio_operations_tenant_target_fkey" FOREIGN KEY (tenant_id, target_line_id) REFERENCES hotel_folio_lines(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE public."hotel_folios" ADD CONSTRAINT "hotel_folios_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id) ON DELETE CASCADE;

ALTER TABLE public."hotel_folios" ADD CONSTRAINT "hotel_folios_tenant_reservation_fkey" FOREIGN KEY (tenant_id, reservation_id) REFERENCES hotel_reservations(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE public."hotel_guests" ADD CONSTRAINT "hotel_guests_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id) ON DELETE CASCADE;

ALTER TABLE public."hotel_housekeeping_events" ADD CONSTRAINT "hotel_housekeeping_events_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id) ON DELETE CASCADE;

ALTER TABLE public."hotel_housekeeping_events" ADD CONSTRAINT "hotel_housekeeping_events_tenant_room_fkey" FOREIGN KEY (tenant_id, hotel_room_id) REFERENCES hotel_rooms(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE public."hotel_housekeeping_handoffs" ADD CONSTRAINT "hotel_housekeeping_handoffs_hotel_room_id_fkey" FOREIGN KEY (hotel_room_id) REFERENCES hotel_rooms(id) ON DELETE CASCADE;

ALTER TABLE public."hotel_housekeeping_handoffs" ADD CONSTRAINT "hotel_housekeeping_handoffs_reservation_id_fkey" FOREIGN KEY (reservation_id) REFERENCES hotel_reservations(id) ON DELETE SET NULL;

ALTER TABLE public."hotel_housekeeping_handoffs" ADD CONSTRAINT "hotel_housekeeping_handoffs_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id) ON DELETE CASCADE;

ALTER TABLE public."hotel_mutation_requests" ADD CONSTRAINT "hotel_mutation_requests_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id);

ALTER TABLE public."hotel_receipt_alert_outbox" ADD CONSTRAINT "hotel_receipt_alert_outbox_request_fk" FOREIGN KEY (tenant_id, request_id) REFERENCES hotel_receipt_control_requests(tenant_id, id);

ALTER TABLE public."hotel_receipt_alert_outbox" ADD CONSTRAINT "hotel_receipt_alert_outbox_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id);

ALTER TABLE public."hotel_receipt_control_decisions" ADD CONSTRAINT "hotel_receipt_control_decisions_request_fk" FOREIGN KEY (tenant_id, request_id) REFERENCES hotel_receipt_control_requests(tenant_id, id);

ALTER TABLE public."hotel_receipt_control_decisions" ADD CONSTRAINT "hotel_receipt_control_decisions_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id);

ALTER TABLE public."hotel_receipt_control_executions" ADD CONSTRAINT "hotel_receipt_control_executions_request_fk" FOREIGN KEY (tenant_id, request_id) REFERENCES hotel_receipt_control_requests(tenant_id, id);

ALTER TABLE public."hotel_receipt_control_executions" ADD CONSTRAINT "hotel_receipt_control_executions_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id);

ALTER TABLE public."hotel_receipt_control_requests" ADD CONSTRAINT "hotel_receipt_control_requests_deposit_fk" FOREIGN KEY (tenant_id, reservation_id, deposit_id) REFERENCES hotel_reservation_deposits(tenant_id, reservation_id, id);

ALTER TABLE public."hotel_receipt_control_requests" ADD CONSTRAINT "hotel_receipt_control_requests_reservation_fk" FOREIGN KEY (tenant_id, reservation_id) REFERENCES hotel_reservations(tenant_id, id);

ALTER TABLE public."hotel_receipt_control_requests" ADD CONSTRAINT "hotel_receipt_control_requests_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id);

ALTER TABLE public."hotel_receipt_versions" ADD CONSTRAINT "hotel_receipt_versions_deposit_fk" FOREIGN KEY (tenant_id, deposit_id) REFERENCES hotel_reservation_deposits(tenant_id, id);

ALTER TABLE public."hotel_receipt_versions" ADD CONSTRAINT "hotel_receipt_versions_request_fk" FOREIGN KEY (tenant_id, request_id, deposit_id) REFERENCES hotel_receipt_control_requests(tenant_id, id, deposit_id);

ALTER TABLE public."hotel_receipt_versions" ADD CONSTRAINT "hotel_receipt_versions_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id);

ALTER TABLE public."hotel_reservation_deposits" ADD CONSTRAINT "hotel_reservation_deposits_reservation_fkey" FOREIGN KEY (tenant_id, reservation_id) REFERENCES hotel_reservations(tenant_id, id);

ALTER TABLE public."hotel_reservation_deposits" ADD CONSTRAINT "hotel_reservation_deposits_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id);

ALTER TABLE public."hotel_reservation_events" ADD CONSTRAINT "hotel_reservation_events_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id) ON DELETE CASCADE;

ALTER TABLE public."hotel_reservation_events" ADD CONSTRAINT "hotel_reservation_events_tenant_reservation_fkey" FOREIGN KEY (reservation_id, tenant_id) REFERENCES hotel_reservations(id, tenant_id) ON DELETE CASCADE;

ALTER TABLE public."hotel_reservation_guests" ADD CONSTRAINT "hotel_reservation_guests_reservation_room_id_fkey" FOREIGN KEY (reservation_room_id) REFERENCES hotel_reservation_rooms(id) ON DELETE SET NULL;

ALTER TABLE public."hotel_reservation_guests" ADD CONSTRAINT "hotel_reservation_guests_tenant_guest_fkey" FOREIGN KEY (tenant_id, guest_id) REFERENCES hotel_guests(tenant_id, id) ON DELETE RESTRICT;

ALTER TABLE public."hotel_reservation_guests" ADD CONSTRAINT "hotel_reservation_guests_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id) ON DELETE CASCADE;

ALTER TABLE public."hotel_reservation_guests" ADD CONSTRAINT "hotel_reservation_guests_tenant_reservation_fkey" FOREIGN KEY (tenant_id, reservation_id) REFERENCES hotel_reservations(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE public."hotel_reservation_operation_requests" ADD CONSTRAINT "hotel_reservation_operation_requests_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id) ON DELETE CASCADE;

ALTER TABLE public."hotel_reservation_operation_requests" ADD CONSTRAINT "hotel_reservation_operation_requests_tenant_reservation_fkey" FOREIGN KEY (reservation_id, tenant_id) REFERENCES hotel_reservations(id, tenant_id) ON DELETE CASCADE;

ALTER TABLE public."hotel_reservation_rooms" ADD CONSTRAINT "hotel_reservation_rooms_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id) ON DELETE CASCADE;

ALTER TABLE public."hotel_reservation_rooms" ADD CONSTRAINT "hotel_reservation_rooms_tenant_reservation_fkey" FOREIGN KEY (tenant_id, reservation_id) REFERENCES hotel_reservations(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE public."hotel_reservation_rooms" ADD CONSTRAINT "hotel_reservation_rooms_tenant_room_fkey" FOREIGN KEY (tenant_id, hotel_room_id) REFERENCES hotel_rooms(tenant_id, id) ON DELETE RESTRICT;

ALTER TABLE public."hotel_reservation_tax_profile" ADD CONSTRAINT "hotel_reservation_tax_profile_reservation_id_fkey" FOREIGN KEY (reservation_id) REFERENCES hotel_reservations(id) ON DELETE CASCADE;

ALTER TABLE public."hotel_reservation_tax_profile" ADD CONSTRAINT "hotel_reservation_tax_profile_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id) ON DELETE CASCADE;

ALTER TABLE public."hotel_reservations" ADD CONSTRAINT "hotel_reservations_booking_source_fk" FOREIGN KEY (tenant_id, booking_source) REFERENCES hotel_booking_sources(tenant_id, source_code) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE public."hotel_reservations" ADD CONSTRAINT "hotel_reservations_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id) ON DELETE CASCADE;

ALTER TABLE public."hotel_room_housekeeping" ADD CONSTRAINT "hotel_room_housekeeping_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id) ON DELETE CASCADE;

ALTER TABLE public."hotel_room_housekeeping" ADD CONSTRAINT "hotel_room_housekeeping_tenant_room_fkey" FOREIGN KEY (tenant_id, hotel_room_id) REFERENCES hotel_rooms(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE public."hotel_rooms" ADD CONSTRAINT "hotel_rooms_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id) ON DELETE CASCADE;

ALTER TABLE public."hotel_settings" ADD CONSTRAINT "hotel_settings_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id) ON DELETE CASCADE;

ALTER TABLE public."hotel_tourism_tax_evidence" ADD CONSTRAINT "hotel_tourism_tax_evidence_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id) ON DELETE CASCADE;

ALTER TABLE public."hotel_tourism_tax_evidence" ADD CONSTRAINT "hotel_tourism_tax_evidence_tenant_res_fkey" FOREIGN KEY (tenant_id, reservation_id) REFERENCES hotel_reservations(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE public."hotel_user_directory" ADD CONSTRAINT "hotel_user_directory_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id) ON DELETE CASCADE;

ALTER TABLE public."hotel_user_roles" ADD CONSTRAINT "hotel_user_roles_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES hotel_tenants(id) ON DELETE CASCADE;

ALTER TABLE public."hotel_addon_catalogue" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_addon_catalogue" TO service_role;

ALTER TABLE public."hotel_audit_events" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_audit_events" TO service_role;

ALTER TABLE public."hotel_booking_sequences" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_booking_sequences" TO service_role;

ALTER TABLE public."hotel_booking_sources" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_booking_sources" TO service_role;

ALTER TABLE public."hotel_financial_settings" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_financial_settings" TO service_role;

ALTER TABLE public."hotel_folio_bill_to" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_folio_bill_to" TO service_role;

ALTER TABLE public."hotel_folio_lines" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_folio_lines" TO service_role;

ALTER TABLE public."hotel_folio_operations" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_folio_operations" TO service_role;

ALTER TABLE public."hotel_folios" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_folios" TO service_role;

ALTER TABLE public."hotel_guests" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_guests" TO service_role;

ALTER TABLE public."hotel_housekeeping_events" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_housekeeping_events" TO service_role;

ALTER TABLE public."hotel_housekeeping_handoffs" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_housekeeping_handoffs" TO service_role;

ALTER TABLE public."hotel_mutation_requests" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_mutation_requests" TO service_role;

ALTER TABLE public."hotel_receipt_alert_outbox" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_receipt_alert_outbox" TO service_role;

ALTER TABLE public."hotel_receipt_control_decisions" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_receipt_control_decisions" TO service_role;

ALTER TABLE public."hotel_receipt_control_executions" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_receipt_control_executions" TO service_role;

ALTER TABLE public."hotel_receipt_control_requests" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_receipt_control_requests" TO service_role;

ALTER TABLE public."hotel_receipt_versions" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_receipt_versions" TO service_role;

ALTER TABLE public."hotel_reservation_deposits" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_reservation_deposits" TO service_role;

ALTER TABLE public."hotel_reservation_events" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_reservation_events" TO service_role;

ALTER TABLE public."hotel_reservation_guests" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_reservation_guests" TO service_role;

ALTER TABLE public."hotel_reservation_operation_requests" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_reservation_operation_requests" TO service_role;

ALTER TABLE public."hotel_reservation_rooms" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_reservation_rooms" TO service_role;

ALTER TABLE public."hotel_reservation_tax_profile" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_reservation_tax_profile" TO service_role;

ALTER TABLE public."hotel_reservations" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_reservations" TO service_role;

ALTER TABLE public."hotel_room_housekeeping" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_room_housekeeping" TO service_role;

ALTER TABLE public."hotel_rooms" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_rooms" TO service_role;

ALTER TABLE public."hotel_settings" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_settings" TO service_role;

ALTER TABLE public."hotel_tenants" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_tenants" TO service_role;

ALTER TABLE public."hotel_tourism_tax_evidence" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_tourism_tax_evidence" TO service_role;

ALTER TABLE public."hotel_user_directory" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_user_directory" TO service_role;

ALTER TABLE public."hotel_user_roles" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public."hotel_user_roles" TO service_role;

CREATE OR REPLACE FUNCTION public.hotelhub_add_folio_line(p_tenant_id uuid, p_reservation_id uuid, p_operation text, p_line_type hotel_folio_line_type, p_catalogue_id uuid, p_tax_class hotel_tax_class, p_description text, p_quantity integer, p_unit_price_cents integer, p_subtotal_cents integer, p_tax_cents integer, p_total_cents integer, p_tax_snapshot jsonb, p_reason text, p_client_request_id uuid, p_actor_n3_user_key text, p_request_fingerprint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_add_tourism_tax_evidence(p_tenant_id uuid, p_reservation_id uuid, p_source_label text, p_reference text, p_collected_on date, p_amount_cents integer, p_note text, p_client_request_id uuid, p_actor_n3_user_key text, p_request_fingerprint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_assign_guest_rooms_v2(p_tenant_id uuid, p_reservation_id uuid, p_actor_n3_user_key text, p_actor_role text, p_client_request_id uuid, p_expected_updated_at timestamp with time zone, p_assignments jsonb, p_correction_reason text)
 RETURNS TABLE(out_updated integer, out_updated_at timestamp with time zone, out_replayed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_res public.hotel_reservations%ROWTYPE;
  v_ledger public.hotel_mutation_requests%ROWTYPE;
  v_policy text;
  v_item jsonb;
  v_link_id uuid;
  v_room_id uuid;
  v_count integer := 0;
  v_reason text;
  v_over integer;
  v_seen uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_tenant_id IS NULL OR p_reservation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH370', MESSAGE='reservation_not_found';
  END IF;
  IF p_actor_n3_user_key IS NULL OR length(btrim(p_actor_n3_user_key)) = 0
     OR p_actor_role IS NULL OR p_actor_role NOT IN ('owner','front_desk') THEN
    RAISE EXCEPTION USING ERRCODE='HH371', MESSAGE='unauthorized';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH372', MESSAGE='invalid_request';
  END IF;

  SELECT * INTO v_ledger FROM public.hotel_mutation_requests
    WHERE tenant_id = p_tenant_id AND scope = 'guest_assignments'
      AND client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_ledger.reservation_id IS DISTINCT FROM p_reservation_id THEN
      RAISE EXCEPTION USING ERRCODE='HH373', MESSAGE='idempotency_conflict';
    END IF;
    SELECT * INTO v_res FROM public.hotel_reservations
      WHERE id = p_reservation_id AND tenant_id = p_tenant_id;
    RETURN QUERY SELECT 0, v_res.updated_at, true;
    RETURN;
  END IF;

  SELECT * INTO v_res FROM public.hotel_reservations
    WHERE id = p_reservation_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='HH374', MESSAGE='reservation_not_found';
  END IF;
  IF p_expected_updated_at IS NULL OR v_res.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION USING ERRCODE='HH375', MESSAGE='stale_reservation';
  END IF;
  IF v_res.status NOT IN ('confirmed','checked_in') THEN
    RAISE EXCEPTION USING ERRCODE='HH376', MESSAGE='reservation_not_editable';
  END IF;

  SELECT s.post_check_in_guest_edit_policy INTO v_policy
    FROM public.hotel_settings s WHERE s.tenant_id = p_tenant_id;
  IF v_policy IS NULL OR v_policy NOT IN ('locked','contact_only') THEN
    v_policy := 'locked';
  END IF;

  v_reason := NULLIF(btrim(COALESCE(p_correction_reason,'')), '');
  IF v_res.status = 'checked_in' THEN
    IF p_actor_role <> 'owner' THEN
      RAISE EXCEPTION USING ERRCODE='HH377', MESSAGE='guest_edit_locked';
    END IF;
    IF v_reason IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='HH378', MESSAGE='correction_reason_required';
    END IF;
    IF length(v_reason) > 300 THEN
      RAISE EXCEPTION USING ERRCODE='HH379', MESSAGE='correction_reason_too_long';
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_assignments, '[]'::jsonb))
  LOOP
    v_link_id := NULLIF(v_item->>'reservation_guest_id','')::uuid;
    v_room_id := NULLIF(v_item->>'reservation_room_id','')::uuid;
    IF v_link_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='HH380', MESSAGE='guest_not_found';
    END IF;
    IF v_link_id = ANY(v_seen) THEN
      RAISE EXCEPTION USING ERRCODE='HH381', MESSAGE='duplicate_guest';
    END IF;
    v_seen := array_append(v_seen, v_link_id);

    IF NOT EXISTS (
      SELECT 1 FROM public.hotel_reservation_guests g
      WHERE g.id = v_link_id AND g.tenant_id = p_tenant_id
        AND g.reservation_id = p_reservation_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE='HH382', MESSAGE='guest_not_found';
    END IF;
    IF v_room_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.hotel_reservation_rooms rr
      WHERE rr.id = v_room_id AND rr.tenant_id = p_tenant_id
        AND rr.reservation_id = p_reservation_id
        AND rr.allocation_status IN ('reserved','occupied')
    ) THEN
      RAISE EXCEPTION USING ERRCODE='HH383', MESSAGE='room_not_found';
    END IF;

    UPDATE public.hotel_reservation_guests
      SET reservation_room_id = v_room_id
      WHERE id = v_link_id AND tenant_id = p_tenant_id;
    v_count := v_count + 1;
  END LOOP;

  SELECT count(*) INTO v_over FROM (
    SELECT g.reservation_room_id AS rid, count(*) AS n
      FROM public.hotel_reservation_guests g
     WHERE g.reservation_id = p_reservation_id AND g.tenant_id = p_tenant_id
       AND g.reservation_room_id IS NOT NULL
     GROUP BY g.reservation_room_id
  ) t
  JOIN public.hotel_reservation_rooms rr ON rr.id = t.rid
  JOIN public.hotel_rooms hr ON hr.id = rr.hotel_room_id
  WHERE t.n > hr.max_occupancy;
  IF v_over > 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH384', MESSAGE='room_capacity_exceeded';
  END IF;

  UPDATE public.hotel_reservations SET updated_at = now()
    WHERE id = p_reservation_id AND tenant_id = p_tenant_id
    RETURNING updated_at INTO out_updated_at;

  INSERT INTO public.hotel_reservation_events
    (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
  VALUES (p_tenant_id, p_reservation_id, 'guest_updated',
          'Guest room assignments updated', p_actor_n3_user_key,
          jsonb_build_object('assignmentCount', v_count,
                             'afterCheckIn', (v_res.status = 'checked_in'),
                             'correctionReason', v_reason));

  INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
  VALUES (p_tenant_id, p_actor_n3_user_key, 'hotel.reservation.guests_assigned',
          jsonb_build_object('bookingReference', v_res.booking_reference,
                             'assignmentCount', v_count));

  INSERT INTO public.hotel_mutation_requests
    (tenant_id, client_request_id, scope, reservation_id, result)
  VALUES (p_tenant_id, p_client_request_id, 'guest_assignments', p_reservation_id,
          jsonb_build_object('updated', v_count));

  out_updated := v_count;
  out_replayed := false;
  RETURN NEXT;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_booking_source_code_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.source_code IS DISTINCT FROM OLD.source_code THEN
    RAISE EXCEPTION 'source_code_immutable' USING ERRCODE = 'HH100';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_check_in_reservation(p_tenant_id uuid, p_reservation_id uuid, p_actor_n3_user_key text, p_expected_updated_at timestamp with time zone, p_allow_early boolean DEFAULT false, p_operation_request_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(out_status text, out_checked_in_at timestamp with time zone, out_updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.hotel_reservations%ROWTYPE;
  v_local timestamp;
  v_ci_time text;
  v_rooms integer;
  v_guests integer;
BEGIN
  IF p_tenant_id IS NULL OR p_reservation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH210', MESSAGE='reservation_not_found';
  END IF;
  IF p_actor_n3_user_key IS NULL OR length(btrim(p_actor_n3_user_key)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH211', MESSAGE='unauthorized';
  END IF;

  SELECT * INTO v_row FROM public.hotel_reservations
    WHERE id = p_reservation_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='HH212', MESSAGE='reservation_not_found';
  END IF;

  -- Idempotent: already checked in returns the existing state unchanged.
  IF v_row.status = 'checked_in' THEN
    RETURN QUERY SELECT v_row.status, v_row.checked_in_at, v_row.updated_at;
    RETURN;
  END IF;
  IF v_row.status <> 'confirmed' THEN
    RAISE EXCEPTION USING ERRCODE='HH213', MESSAGE='invalid_transition';
  END IF;
  IF p_expected_updated_at IS NOT NULL AND v_row.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION USING ERRCODE='HH214', MESSAGE='reservation_changed';
  END IF;

  SELECT count(*) INTO v_rooms FROM public.hotel_reservation_rooms
    WHERE tenant_id = p_tenant_id AND reservation_id = p_reservation_id
      AND allocation_status IN ('reserved','occupied');
  SELECT count(*) INTO v_guests FROM public.hotel_reservation_guests
    WHERE tenant_id = p_tenant_id AND reservation_id = p_reservation_id;
  IF v_rooms < 1 OR v_guests < 1 THEN
    RAISE EXCEPTION USING ERRCODE='HH215', MESSAGE='invalid_transition';
  END IF;

  v_local := public.hotelhub_property_now(p_tenant_id);
  SELECT s.standard_check_in_time INTO v_ci_time
    FROM public.hotel_settings s WHERE s.tenant_id = p_tenant_id;
  v_ci_time := COALESCE(v_ci_time, '15:00');

  IF v_local::date < v_row.arrival_date THEN
    IF NOT p_allow_early THEN
      RAISE EXCEPTION USING ERRCODE='HH216', MESSAGE='early_check_in_required';
    END IF;
  ELSIF v_local::date = v_row.arrival_date
        AND v_local::time < v_ci_time::time
        AND NOT p_allow_early THEN
    RAISE EXCEPTION USING ERRCODE='HH217', MESSAGE='early_check_in_required';
  END IF;

  UPDATE public.hotel_reservations
    SET status = 'checked_in',
        checked_in_at = now(),
        checked_in_by_n3_user_key = p_actor_n3_user_key
    WHERE id = p_reservation_id AND tenant_id = p_tenant_id
    RETURNING * INTO v_row;

  UPDATE public.hotel_reservation_rooms
    SET allocation_status = 'occupied'
    WHERE tenant_id = p_tenant_id AND reservation_id = p_reservation_id
      AND allocation_status = 'reserved';

  INSERT INTO public.hotel_reservation_events
    (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
  VALUES (p_tenant_id, p_reservation_id, 'checked_in',
          CASE WHEN p_allow_early THEN 'Early check-in completed' ELSE 'Checked in' END,
          p_actor_n3_user_key,
          jsonb_build_object('early', p_allow_early, 'operation_request_id', p_operation_request_id));

  INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
  VALUES (p_tenant_id, p_actor_n3_user_key, 'hotel.reservation.check_in',
          jsonb_build_object('bookingReference', v_row.booking_reference, 'early', p_allow_early));

  RETURN QUERY SELECT v_row.status, v_row.checked_in_at, v_row.updated_at;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_check_in_reservation(p_tenant_id uuid, p_reservation_id uuid, p_actor_n3_user_key text, p_expected_updated_at timestamp with time zone, p_allow_early boolean DEFAULT false, p_operation_request_id uuid DEFAULT NULL::uuid, p_client_request_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(out_status text, out_checked_in_at timestamp with time zone, out_updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.hotel_reservations%ROWTYPE;
  v_local timestamp;
  v_ci_time text;
  v_rooms integer;
  v_guests integer;
  v_primary integer;
  v_unassigned integer;
  v_overcap integer;
  v_ledger public.hotel_mutation_requests%ROWTYPE;
BEGIN
  IF p_tenant_id IS NULL OR p_reservation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH210', MESSAGE='reservation_not_found';
  END IF;
  IF p_actor_n3_user_key IS NULL OR length(btrim(p_actor_n3_user_key)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH211', MESSAGE='unauthorized';
  END IF;

  IF p_client_request_id IS NOT NULL THEN
    SELECT * INTO v_ledger FROM public.hotel_mutation_requests
      WHERE tenant_id = p_tenant_id AND scope = 'check_in'
        AND client_request_id = p_client_request_id;
    IF FOUND THEN
      IF v_ledger.reservation_id IS DISTINCT FROM p_reservation_id THEN
        RAISE EXCEPTION USING ERRCODE='HH219', MESSAGE='idempotency_conflict';
      END IF;
      SELECT * INTO v_row FROM public.hotel_reservations
        WHERE id = p_reservation_id AND tenant_id = p_tenant_id;
      RETURN QUERY SELECT v_row.status, v_row.checked_in_at, v_row.updated_at;
      RETURN;
    END IF;
  END IF;

  SELECT * INTO v_row FROM public.hotel_reservations
    WHERE id = p_reservation_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='HH212', MESSAGE='reservation_not_found';
  END IF;

  IF v_row.status = 'checked_in' THEN
    RETURN QUERY SELECT v_row.status, v_row.checked_in_at, v_row.updated_at;
    RETURN;
  END IF;
  IF v_row.status <> 'confirmed' THEN
    RAISE EXCEPTION USING ERRCODE='HH213', MESSAGE='invalid_transition';
  END IF;
  IF p_expected_updated_at IS NOT NULL AND v_row.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION USING ERRCODE='HH214', MESSAGE='reservation_changed';
  END IF;

  SELECT count(*) INTO v_rooms FROM public.hotel_reservation_rooms
    WHERE tenant_id = p_tenant_id AND reservation_id = p_reservation_id
      AND allocation_status IN ('reserved','occupied');
  SELECT count(*) INTO v_guests FROM public.hotel_reservation_guests
    WHERE tenant_id = p_tenant_id AND reservation_id = p_reservation_id;
  IF v_rooms < 1 OR v_guests < 1 THEN
    RAISE EXCEPTION USING ERRCODE='HH215', MESSAGE='invalid_transition';
  END IF;

  SELECT count(*) INTO v_primary FROM public.hotel_reservation_guests
    WHERE tenant_id = p_tenant_id AND reservation_id = p_reservation_id AND is_primary;
  IF v_primary <> 1 THEN
    RAISE EXCEPTION USING ERRCODE='HH21A', MESSAGE='primary_guest_required';
  END IF;

  -- Every guest must be assigned to a live room of THIS reservation.
  SELECT count(*) INTO v_unassigned
    FROM public.hotel_reservation_guests g
    WHERE g.tenant_id = p_tenant_id AND g.reservation_id = p_reservation_id
      AND NOT EXISTS (
        SELECT 1 FROM public.hotel_reservation_rooms r
         WHERE r.id = g.reservation_room_id
           AND r.tenant_id = p_tenant_id
           AND r.reservation_id = p_reservation_id
           AND r.allocation_status IN ('reserved','occupied')
      );
  IF v_unassigned > 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH21B', MESSAGE='guest_assignment_required';
  END IF;

  -- Declared occupancy and assigned headcount must both fit the real room.
  SELECT count(*) INTO v_overcap
    FROM public.hotel_reservation_rooms r
    JOIN public.hotel_rooms hr
      ON hr.id = r.hotel_room_id AND hr.tenant_id = p_tenant_id
    WHERE r.tenant_id = p_tenant_id AND r.reservation_id = p_reservation_id
      AND r.allocation_status IN ('reserved','occupied')
      AND (
        (r.adults + COALESCE(r.children,0)) > hr.max_occupancy
        OR (
          SELECT count(*) FROM public.hotel_reservation_guests g
           WHERE g.tenant_id = p_tenant_id AND g.reservation_room_id = r.id
        ) > hr.max_occupancy
      );
  IF v_overcap > 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH21C', MESSAGE='room_capacity_exceeded';
  END IF;

  v_local := public.hotelhub_property_now(p_tenant_id);
  SELECT s.standard_check_in_time INTO v_ci_time
    FROM public.hotel_settings s WHERE s.tenant_id = p_tenant_id;
  v_ci_time := COALESCE(v_ci_time, '15:00');

  IF v_local::date < v_row.arrival_date THEN
    IF NOT p_allow_early THEN
      RAISE EXCEPTION USING ERRCODE='HH216', MESSAGE='early_check_in_required';
    END IF;
  ELSIF v_local::date = v_row.arrival_date
        AND v_local::time < v_ci_time::time
        AND NOT p_allow_early THEN
    RAISE EXCEPTION USING ERRCODE='HH217', MESSAGE='early_check_in_required';
  END IF;

  UPDATE public.hotel_reservations
    SET status = 'checked_in',
        checked_in_at = now(),
        checked_in_by_n3_user_key = p_actor_n3_user_key
    WHERE id = p_reservation_id AND tenant_id = p_tenant_id
    RETURNING * INTO v_row;

  UPDATE public.hotel_reservation_rooms
    SET allocation_status = 'occupied'
    WHERE tenant_id = p_tenant_id AND reservation_id = p_reservation_id
      AND allocation_status = 'reserved';

  INSERT INTO public.hotel_reservation_events
    (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
  VALUES (p_tenant_id, p_reservation_id, 'checked_in',
          CASE WHEN p_allow_early THEN 'Early check-in completed' ELSE 'Checked in' END,
          p_actor_n3_user_key,
          jsonb_build_object('early', p_allow_early, 'operation_request_id', p_operation_request_id));

  INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
  VALUES (p_tenant_id, p_actor_n3_user_key, 'hotel.reservation.check_in',
          jsonb_build_object('bookingReference', v_row.booking_reference, 'early', p_allow_early));

  IF p_client_request_id IS NOT NULL THEN
    INSERT INTO public.hotel_mutation_requests
      (tenant_id, client_request_id, scope, reservation_id, result)
    VALUES (p_tenant_id, p_client_request_id, 'check_in', p_reservation_id,
            jsonb_build_object('status', v_row.status));
  END IF;

  RETURN QUERY SELECT v_row.status, v_row.checked_in_at, v_row.updated_at;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_claim_folio_operation(p_tenant_id uuid, p_operation text, p_reservation_id uuid, p_folio_id uuid, p_target_line_id uuid, p_client_request_id uuid, p_request_fingerprint text, p_actor_n3_user_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_create_reservation(p_tenant_id uuid, p_created_by_n3_user_key text, p_booking_source text, p_arrival_date date, p_departure_date date, p_notes text, p_external_booking_reference text, p_rooms jsonb, p_guests jsonb)
 RETURNS TABLE(out_reservation_id uuid, out_booking_reference text, out_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_currency text;
  v_timezone text;
  v_walk_in text;
  v_source_active boolean;
  v_room_count integer;
  v_guest_count integer;
  v_primary_count integer;
  v_room jsonb;
  v_guest jsonb;
  v_room_id uuid;
  v_room_rate numeric(12,2);
  v_room_max integer;
  v_room_active boolean;
  v_agreed numeric(12,2);
  v_adults integer;
  v_children integer;
  v_reason text;
  v_remark text;
  v_reservation_id uuid;
  v_booking_ref text;
  v_seq_date date;
  v_next_num integer;
  v_new_guest_id uuid;
  v_new_room_alloc_id uuid;
  v_dup_room boolean;
  v_room_ids uuid[] := ARRAY[]::uuid[];
  v_ext_ref text;
  v_identity_type text;
  v_identity_number text;
  v_key_map jsonb := '{}'::jsonb;   -- hotel_room_id(text) -> reservation_room id(text)
  v_max_map jsonb := '{}'::jsonb;   -- hotel_room_id(text) -> max_occupancy
  v_use_map jsonb := '{}'::jsonb;   -- hotel_room_id(text) -> assigned guest count
  v_assigned_key text;
  v_assigned_alloc uuid;
  v_over record;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH001', MESSAGE='tenant_required';
  END IF;
  IF p_created_by_n3_user_key IS NULL OR length(btrim(p_created_by_n3_user_key)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH002', MESSAGE='creator_required';
  END IF;
  IF p_arrival_date IS NULL OR p_departure_date IS NULL OR p_departure_date <= p_arrival_date THEN
    RAISE EXCEPTION USING ERRCODE='HH004', MESSAGE='invalid_stay_dates';
  END IF;

  SELECT bs.is_active INTO v_source_active
    FROM public.hotel_booking_sources bs
    WHERE bs.tenant_id = p_tenant_id AND bs.source_code = p_booking_source;
  IF v_source_active IS NULL OR NOT v_source_active THEN
    RAISE EXCEPTION USING ERRCODE='HH003', MESSAGE='invalid_booking_source';
  END IF;

  SELECT hs.currency, hs.timezone, hs.n3_walk_in_customer_id
    INTO v_currency, v_timezone, v_walk_in
    FROM public.hotel_settings AS hs
    WHERE hs.tenant_id = p_tenant_id;
  IF v_currency IS NULL OR v_walk_in IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH005', MESSAGE='setup_incomplete';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.hotel_rooms AS hr
    WHERE hr.tenant_id = p_tenant_id AND hr.is_active
  ) THEN
    RAISE EXCEPTION USING ERRCODE='HH005', MESSAGE='setup_incomplete';
  END IF;

  v_room_count := COALESCE(jsonb_array_length(p_rooms), 0);
  v_guest_count := COALESCE(jsonb_array_length(p_guests), 0);
  IF v_room_count = 0 THEN RAISE EXCEPTION USING ERRCODE='HH006', MESSAGE='room_required'; END IF;
  IF v_guest_count = 0 THEN RAISE EXCEPTION USING ERRCODE='HH007', MESSAGE='guest_required'; END IF;

  SELECT EXISTS (
    SELECT (elem->>'hotel_room_id')::uuid
    FROM jsonb_array_elements(p_rooms) AS elem
    GROUP BY (elem->>'hotel_room_id')::uuid
    HAVING count(*) > 1
  ) INTO v_dup_room;
  IF v_dup_room THEN RAISE EXCEPTION USING ERRCODE='HH008', MESSAGE='duplicate_room'; END IF;

  SELECT count(*) INTO v_primary_count
    FROM jsonb_array_elements(p_guests) AS elem
    WHERE COALESCE((elem->>'is_primary')::boolean, false) = true;
  IF v_primary_count = 0 THEN RAISE EXCEPTION USING ERRCODE='HH009', MESSAGE='primary_guest_required'; END IF;
  IF v_primary_count > 1 THEN RAISE EXCEPTION USING ERRCODE='HH010', MESSAGE='multiple_primary_guests'; END IF;

  v_seq_date := (now() AT TIME ZONE v_timezone)::date;
  INSERT INTO public.hotel_booking_sequences AS bs (tenant_id, sequence_date, last_number)
  VALUES (p_tenant_id, v_seq_date, 1)
  ON CONFLICT (tenant_id, sequence_date)
  DO UPDATE SET last_number = bs.last_number + 1, updated_at = now()
  RETURNING bs.last_number INTO v_next_num;
  v_booking_ref := 'BK' || to_char(v_seq_date, 'YYMMDD') || lpad(v_next_num::text, 3, '0');

  v_ext_ref := NULLIF(btrim(COALESCE(p_external_booking_reference, '')), '');
  IF v_ext_ref IS NOT NULL AND length(v_ext_ref) > 100 THEN
    v_ext_ref := substring(v_ext_ref for 100);
  END IF;

  INSERT INTO public.hotel_reservations (
    tenant_id, booking_reference, booking_source, status,
    arrival_date, departure_date, currency, notes,
    external_booking_reference, created_by_n3_user_key
  ) VALUES (
    p_tenant_id, v_booking_ref, p_booking_source, 'confirmed',
    p_arrival_date, p_departure_date, v_currency,
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    v_ext_ref, p_created_by_n3_user_key
  ) RETURNING id INTO v_reservation_id;

  -- Rooms FIRST: guest assignment must resolve to a real reservation room id.
  FOR v_room IN SELECT * FROM jsonb_array_elements(p_rooms) LOOP
    v_room_id  := (v_room->>'hotel_room_id')::uuid;
    v_adults   := COALESCE((v_room->>'adults')::integer, 1);
    v_children := COALESCE((v_room->>'children')::integer, 0);
    v_agreed   := COALESCE((v_room->>'agreed_rate')::numeric, -1);
    v_reason   := NULLIF(btrim(COALESCE(v_room->>'rate_override_reason','')), '');
    v_remark   := NULLIF(btrim(COALESCE(v_room->>'remark','')), '');
    IF v_remark IS NOT NULL AND length(v_remark) > 500 THEN
      RAISE EXCEPTION USING ERRCODE='HH022', MESSAGE='room_remark_too_long';
    END IF;

    SELECT hr.base_rate, hr.max_occupancy, hr.is_active
      INTO v_room_rate, v_room_max, v_room_active
      FROM public.hotel_rooms AS hr
      WHERE hr.id = v_room_id AND hr.tenant_id = p_tenant_id;
    IF v_room_rate IS NULL THEN RAISE EXCEPTION USING ERRCODE='HH012', MESSAGE='room_not_found'; END IF;
    IF NOT v_room_active THEN RAISE EXCEPTION USING ERRCODE='HH013', MESSAGE='room_inactive'; END IF;
    IF v_adults < 1 THEN RAISE EXCEPTION USING ERRCODE='HH014', MESSAGE='invalid_occupancy'; END IF;
    IF (v_adults + v_children) > v_room_max THEN RAISE EXCEPTION USING ERRCODE='HH015', MESSAGE='occupancy_exceeded'; END IF;
    IF v_agreed < 0 THEN RAISE EXCEPTION USING ERRCODE='HH016', MESSAGE='invalid_rate'; END IF;
    IF v_agreed <> v_room_rate AND v_reason IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='HH017', MESSAGE='rate_override_reason_required';
    END IF;

    BEGIN
      INSERT INTO public.hotel_reservation_rooms (
        tenant_id, reservation_id, hotel_room_id,
        arrival_date, departure_date,
        base_rate_snapshot, agreed_rate,
        adults, children, allocation_status, rate_override_reason, remark
      ) VALUES (
        p_tenant_id, v_reservation_id, v_room_id,
        p_arrival_date, p_departure_date,
        v_room_rate, v_agreed,
        v_adults, v_children, 'reserved', v_reason, v_remark
      ) RETURNING id INTO v_new_room_alloc_id;
    EXCEPTION WHEN exclusion_violation THEN
      RAISE EXCEPTION USING ERRCODE='HH018', MESSAGE='room_not_available';
    END;

    v_room_ids := array_append(v_room_ids, v_room_id);
    v_key_map := v_key_map || jsonb_build_object(v_room_id::text, v_new_room_alloc_id::text);
    v_max_map := v_max_map || jsonb_build_object(v_room_id::text, v_room_max);
    v_use_map := v_use_map || jsonb_build_object(v_room_id::text, 0);

    IF v_agreed <> v_room_rate THEN
      INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
      VALUES (p_tenant_id, p_created_by_n3_user_key,
        'hotel.reservation.rate_overridden',
        jsonb_build_object(
          'reservationId', v_reservation_id,
          'bookingReference', v_booking_ref,
          'hotelRoomId', v_room_id,
          'baseRate', v_room_rate,
          'agreedRate', v_agreed
        ));
    END IF;
  END LOOP;

  FOR v_guest IN SELECT * FROM jsonb_array_elements(p_guests) LOOP
    IF length(btrim(COALESCE(v_guest->>'full_name', ''))) = 0 THEN
      RAISE EXCEPTION USING ERRCODE='HH011', MESSAGE='guest_full_name_required';
    END IF;

    v_identity_type   := NULLIF(btrim(COALESCE(v_guest->>'identity_type','')), '');
    v_identity_number := NULLIF(btrim(COALESCE(v_guest->>'identity_number','')), '');
    IF (v_identity_type IS NULL) <> (v_identity_number IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE='HH019', MESSAGE='identity_pair_required';
    END IF;
    IF v_identity_type IS NOT NULL AND v_identity_type NOT IN ('mykad','mypr','passport','other') THEN
      RAISE EXCEPTION USING ERRCODE='HH020', MESSAGE='invalid_identity_type';
    END IF;
    IF v_identity_type IN ('mykad','mypr') THEN
      v_identity_number := regexp_replace(v_identity_number, '[\s-]', '', 'g');
      IF v_identity_number !~ '^[0-9]{12}$' THEN
        RAISE EXCEPTION USING ERRCODE='HH021', MESSAGE='invalid_identity_number';
      END IF;
    ELSIF v_identity_type IN ('passport','other') THEN
      IF length(v_identity_number) > 50 OR length(v_identity_number) = 0 THEN
        RAISE EXCEPTION USING ERRCODE='HH021', MESSAGE='invalid_identity_number';
      END IF;
    END IF;

    -- Resolve the guest -> reservation room assignment. Fail closed.
    v_assigned_key := NULLIF(btrim(COALESCE(v_guest->>'assigned_hotel_room_id','')), '');
    IF v_assigned_key IS NULL THEN
      IF v_room_count = 1 THEN
        v_assigned_key := ((p_rooms->0->>'hotel_room_id')::uuid)::text;
      ELSE
        RAISE EXCEPTION USING ERRCODE='HH023', MESSAGE='guest_assignment_required';
      END IF;
    ELSE
      BEGIN
        v_assigned_key := (v_assigned_key::uuid)::text;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION USING ERRCODE='HH024', MESSAGE='guest_assignment_invalid_room';
      END;
    END IF;
    v_assigned_alloc := NULLIF(v_key_map->>v_assigned_key, '')::uuid;
    IF v_assigned_alloc IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='HH024', MESSAGE='guest_assignment_invalid_room';
    END IF;
    v_use_map := jsonb_set(
      v_use_map,
      ARRAY[v_assigned_key],
      to_jsonb(COALESCE((v_use_map->>v_assigned_key)::integer, 0) + 1)
    );

    INSERT INTO public.hotel_guests (
      tenant_id, full_name, mobile, email, nationality, notes,
      identity_type, identity_number, nationality_code,
      address_line_1, address_line_2, address_line_3, city, postcode,
      country_code, state_code, state_province
    ) VALUES (
      p_tenant_id,
      btrim(v_guest->>'full_name'),
      NULLIF(btrim(COALESCE(v_guest->>'mobile','')), ''),
      NULLIF(btrim(COALESCE(v_guest->>'email','')), ''),
      NULLIF(btrim(COALESCE(v_guest->>'nationality','')), ''),
      NULLIF(btrim(COALESCE(v_guest->>'notes','')), ''),
      v_identity_type, v_identity_number,
      NULLIF(btrim(COALESCE(v_guest->>'nationality_code','')), ''),
      NULLIF(btrim(COALESCE(v_guest->>'address_line_1','')), ''),
      NULLIF(btrim(COALESCE(v_guest->>'address_line_2','')), ''),
      NULLIF(btrim(COALESCE(v_guest->>'address_line_3','')), ''),
      NULLIF(btrim(COALESCE(v_guest->>'city','')), ''),
      NULLIF(btrim(COALESCE(v_guest->>'postcode','')), ''),
      NULLIF(btrim(COALESCE(v_guest->>'country_code','')), ''),
      NULLIF(btrim(COALESCE(v_guest->>'state_code','')), ''),
      NULLIF(btrim(COALESCE(v_guest->>'state_province','')), '')
    ) RETURNING id INTO v_new_guest_id;

    INSERT INTO public.hotel_reservation_guests
      (tenant_id, reservation_id, guest_id, is_primary, reservation_room_id)
    VALUES (p_tenant_id, v_reservation_id, v_new_guest_id,
            COALESCE((v_guest->>'is_primary')::boolean, false),
            v_assigned_alloc);
  END LOOP;

  -- Authoritative per-room capacity check on the resolved assignments.
  FOR v_over IN
    SELECT key AS room_key, value::text::integer AS used
    FROM jsonb_each(v_use_map)
  LOOP
    IF v_over.used > COALESCE((v_max_map->>v_over.room_key)::integer, 0) THEN
      RAISE EXCEPTION USING ERRCODE='HH025', MESSAGE='room_capacity_exceeded';
    END IF;
  END LOOP;

  INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
  VALUES (p_tenant_id, p_created_by_n3_user_key,
    'hotel.reservation.created',
    jsonb_build_object(
      'reservationId', v_reservation_id,
      'bookingReference', v_booking_ref,
      'bookingSource', p_booking_source,
      'arrivalDate', p_arrival_date,
      'departureDate', p_departure_date,
      'roomIds', to_jsonb(v_room_ids),
      'roomCount', v_room_count,
      'guestCount', v_guest_count,
      'hasExternalReference', v_ext_ref IS NOT NULL
    ));

  RETURN QUERY
    SELECT v_reservation_id AS out_reservation_id,
           v_booking_ref    AS out_booking_reference,
           'confirmed'::text AS out_status;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_decide_operation(p_tenant_id uuid, p_request_id uuid, p_actor_n3_user_key text, p_decision text, p_note text, p_idempotency_key text)
 RETURNS TABLE(out_request_id uuid, out_state text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_req public.hotel_reservation_operation_requests%ROWTYPE;
  v_res public.hotel_reservations%ROWTYPE;
  v_alloc public.hotel_reservation_rooms%ROWTYPE;
  v_target public.hotel_rooms%ROWTYPE;
  v_new_departure date;
  v_new_rate numeric(12,2);
  v_expected_out timestamptz;
  v_preserve boolean;
  v_summary text;
  v_old_label text;
  v_new_label text;
BEGIN
  IF p_actor_n3_user_key IS NULL OR length(btrim(p_actor_n3_user_key)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH230', MESSAGE='unauthorized';
  END IF;
  IF p_decision NOT IN ('approve','reject') THEN
    RAISE EXCEPTION USING ERRCODE='HH231', MESSAGE='validation_failed';
  END IF;

  SELECT * INTO v_req FROM public.hotel_reservation_operation_requests
    WHERE id = p_request_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='HH232', MESSAGE='operation_not_found';
  END IF;

  -- Idempotent replay of the same decision request id.
  IF v_req.state <> 'pending' THEN
    IF v_req.decision_idempotency_key IS NOT NULL
       AND v_req.decision_idempotency_key = p_idempotency_key THEN
      RETURN QUERY SELECT v_req.id, v_req.state;
      RETURN;
    END IF;
    RAISE EXCEPTION USING ERRCODE='HH233', MESSAGE='operation_stale';
  END IF;

  SELECT * INTO v_res FROM public.hotel_reservations
    WHERE id = v_req.reservation_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='HH234', MESSAGE='reservation_not_found';
  END IF;

  IF p_decision = 'reject' THEN
    UPDATE public.hotel_reservation_operation_requests
      SET state = 'rejected', decided_at = now(), decided_by_n3_user_key = p_actor_n3_user_key,
          decision_note = NULLIF(btrim(COALESCE(p_note,'')), ''),
          decision_idempotency_key = p_idempotency_key
      WHERE id = v_req.id;
    INSERT INTO public.hotel_reservation_events
      (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
    VALUES (p_tenant_id, v_req.reservation_id, 'operation_rejected',
            'Rejected ' || replace(v_req.operation_type, '_', ' '),
            p_actor_n3_user_key, jsonb_build_object('operation_request_id', v_req.id));
    INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
    VALUES (p_tenant_id, p_actor_n3_user_key, 'hotel.reservation.operation_rejected',
            jsonb_build_object('bookingReference', v_res.booking_reference,
                               'operationType', v_req.operation_type));
    RETURN QUERY SELECT v_req.id, 'rejected'::text;
    RETURN;
  END IF;

  -- ---------------- approve + apply ----------------
  IF v_res.status NOT IN ('confirmed','checked_in') THEN
    RAISE EXCEPTION USING ERRCODE='HH235', MESSAGE='operation_stale';
  END IF;

  IF v_req.operation_type = 'early_check_in' THEN
    IF v_res.status <> 'confirmed' THEN
      RAISE EXCEPTION USING ERRCODE='HH236', MESSAGE='operation_stale';
    END IF;
    PERFORM public.hotelhub_check_in_reservation(
      p_tenant_id, v_req.reservation_id, p_actor_n3_user_key, NULL, true, v_req.id);
    v_summary := 'Early check-in approved';

  ELSIF v_req.operation_type = 'late_checkout' THEN
    v_expected_out := (v_req.payload->>'expected_check_out_at')::timestamptz;
    IF v_expected_out IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='HH237', MESSAGE='validation_failed';
    END IF;
    UPDATE public.hotel_reservations SET expected_check_out_at = v_expected_out
      WHERE id = v_req.reservation_id AND tenant_id = p_tenant_id;
    INSERT INTO public.hotel_reservation_events
      (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
    VALUES (p_tenant_id, v_req.reservation_id, 'late_checkout_approved',
            'Late checkout approved', p_actor_n3_user_key,
            jsonb_build_object('operation_request_id', v_req.id,
                               'expected_check_out_at', v_expected_out));
    v_summary := NULL;

  ELSIF v_req.operation_type = 'room_change' THEN
    SELECT * INTO v_alloc FROM public.hotel_reservation_rooms
      WHERE id = (v_req.payload->>'reservation_room_id')::uuid
        AND tenant_id = p_tenant_id AND reservation_id = v_req.reservation_id
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE='HH238', MESSAGE='operation_stale';
    END IF;
    SELECT * INTO v_target FROM public.hotel_rooms
      WHERE id = (v_req.payload->>'to_hotel_room_id')::uuid AND tenant_id = p_tenant_id;
    IF NOT FOUND OR NOT v_target.is_active THEN
      RAISE EXCEPTION USING ERRCODE='HH239', MESSAGE='room_unavailable';
    END IF;
    IF v_target.max_occupancy < (v_alloc.adults + v_alloc.children) THEN
      RAISE EXCEPTION USING ERRCODE='HH240', MESSAGE='room_capacity_exceeded';
    END IF;
    v_preserve := COALESCE((v_req.payload->>'preserve_rate')::boolean, true);
    SELECT COALESCE(r.display_name, r.n3_stock_name, r.room_number) INTO v_old_label
      FROM public.hotel_rooms r WHERE r.id = v_alloc.hotel_room_id;
    v_new_label := COALESCE(v_target.display_name, v_target.n3_stock_name, v_target.room_number);
    BEGIN
      UPDATE public.hotel_reservation_rooms
        SET hotel_room_id = v_target.id,
            base_rate_snapshot = v_target.base_rate,
            agreed_rate = CASE WHEN v_preserve THEN v_alloc.agreed_rate ELSE v_target.base_rate END
        WHERE id = v_alloc.id;
    EXCEPTION WHEN exclusion_violation OR unique_violation THEN
      RAISE EXCEPTION USING ERRCODE='HH241', MESSAGE='room_unavailable';
    END;
    INSERT INTO public.hotel_reservation_events
      (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
    VALUES (p_tenant_id, v_req.reservation_id, 'room_changed',
            'Room changed from ' || v_old_label || ' to ' || v_new_label,
            p_actor_n3_user_key,
            jsonb_build_object('operation_request_id', v_req.id,
                               'preserve_rate', v_preserve));
    v_summary := NULL;

  ELSIF v_req.operation_type = 'stay_extension' THEN
    v_new_departure := (v_req.payload->>'new_departure_date')::date;
    IF v_new_departure IS NULL OR v_new_departure <= v_res.departure_date THEN
      RAISE EXCEPTION USING ERRCODE='HH242', MESSAGE='operation_stale';
    END IF;
    BEGIN
      UPDATE public.hotel_reservation_rooms
        SET departure_date = v_new_departure
        WHERE tenant_id = p_tenant_id AND reservation_id = v_req.reservation_id
          AND allocation_status IN ('reserved','occupied');
    EXCEPTION WHEN exclusion_violation OR unique_violation THEN
      RAISE EXCEPTION USING ERRCODE='HH243', MESSAGE='room_unavailable';
    END;
    UPDATE public.hotel_reservations SET departure_date = v_new_departure
      WHERE id = v_req.reservation_id AND tenant_id = p_tenant_id;
    INSERT INTO public.hotel_reservation_events
      (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
    VALUES (p_tenant_id, v_req.reservation_id, 'stay_extended',
            'Stay extended to ' || to_char(v_new_departure, 'DD/MM/YYYY'),
            p_actor_n3_user_key,
            jsonb_build_object('operation_request_id', v_req.id,
                               'previous_departure_date', v_res.departure_date,
                               'new_departure_date', v_new_departure));
    v_summary := NULL;

  ELSIF v_req.operation_type = 'rate_change' THEN
    SELECT * INTO v_alloc FROM public.hotel_reservation_rooms
      WHERE id = (v_req.payload->>'reservation_room_id')::uuid
        AND tenant_id = p_tenant_id AND reservation_id = v_req.reservation_id
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE='HH244', MESSAGE='operation_stale';
    END IF;
    v_new_rate := (v_req.payload->>'new_agreed_rate')::numeric(12,2);
    IF v_new_rate IS NULL OR v_new_rate < 0 THEN
      RAISE EXCEPTION USING ERRCODE='HH245', MESSAGE='validation_failed';
    END IF;
    UPDATE public.hotel_reservation_rooms
      SET agreed_rate = v_new_rate,
          rate_override_reason = NULLIF(btrim(COALESCE(v_req.payload->>'reason','')), '')
      WHERE id = v_alloc.id;
    INSERT INTO public.hotel_reservation_events
      (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
    VALUES (p_tenant_id, v_req.reservation_id, 'rate_changed',
            'Room rate changed', p_actor_n3_user_key,
            jsonb_build_object('operation_request_id', v_req.id,
                               'previous_rate', v_alloc.agreed_rate,
                               'new_rate', v_new_rate));
    v_summary := NULL;
  ELSE
    RAISE EXCEPTION USING ERRCODE='HH246', MESSAGE='validation_failed';
  END IF;

  UPDATE public.hotel_reservation_operation_requests
    SET state = 'applied', decided_at = now(), applied_at = now(),
        decided_by_n3_user_key = p_actor_n3_user_key,
        decision_note = NULLIF(btrim(COALESCE(p_note,'')), ''),
        decision_idempotency_key = p_idempotency_key
    WHERE id = v_req.id;

  INSERT INTO public.hotel_reservation_events
    (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
  VALUES (p_tenant_id, v_req.reservation_id, 'operation_approved',
          COALESCE(v_summary, 'Approved ' || replace(v_req.operation_type, '_', ' ')),
          p_actor_n3_user_key, jsonb_build_object('operation_request_id', v_req.id));

  INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
  VALUES (p_tenant_id, p_actor_n3_user_key, 'hotel.reservation.operation_applied',
          jsonb_build_object('bookingReference', v_res.booking_reference,
                             'operationType', v_req.operation_type));

  RETURN QUERY SELECT v_req.id, 'applied'::text;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_deposit_immutable_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_direct_operation_v2(p_tenant_id uuid, p_reservation_id uuid, p_actor_n3_user_key text, p_operation_type text, p_payload jsonb, p_idempotency_key text)
 RETURNS TABLE(out_request_id uuid, out_state text, out_handoff_id uuid, out_old_room_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_request_id uuid;
  v_state text;
  v_blocker text;
  v_dest uuid;
  v_rrid uuid;
  v_old_room uuid;
  v_handoff_id uuid;
  v_room_ids uuid[];
BEGIN
  IF p_tenant_id IS NULL OR p_reservation_id IS NULL THEN
    RAISE EXCEPTION 'reservation_not_found';
  END IF;
  IF p_actor_n3_user_key IS NULL OR length(btrim(p_actor_n3_user_key)) = 0 THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'validation_failed';
  END IF;

  SELECT r.out_request_id, r.out_state
    INTO v_request_id, v_state
    FROM public.hotelhub_request_operation(
      p_tenant_id,
      p_reservation_id,
      p_actor_n3_user_key,
      p_operation_type,
      p_payload,
      p_idempotency_key
    ) AS r;

  IF v_request_id IS NULL THEN
    RAISE EXCEPTION 'operation_request_failed';
  END IF;

  -- (b) Replay of an already-decided action: return the SAME result, touch
  -- nothing, and hand back the handover already correlated to this request.
  IF v_state IS DISTINCT FROM 'pending' THEN
    SELECT h.id, h.hotel_room_id INTO v_handoff_id, v_old_room
      FROM public.hotel_housekeeping_handoffs h
     WHERE h.tenant_id = p_tenant_id
       AND h.operation_request_id = v_request_id
     ORDER BY h.created_at ASC
     LIMIT 1;
    RETURN QUERY SELECT v_request_id, v_state, v_handoff_id, v_old_room;
    RETURN;
  END IF;

  -- (c) Fresh pending action: locked readiness gates inside THIS transaction.
  IF p_operation_type = 'early_check_in' THEN
    SELECT array_agg(rr.hotel_room_id) INTO v_room_ids
      FROM public.hotel_reservation_rooms rr
     WHERE rr.tenant_id = p_tenant_id
       AND rr.reservation_id = p_reservation_id
       AND rr.allocation_status <> 'released';
    v_blocker := public.hotelhub_hk_readiness_blocker_locked(p_tenant_id, v_room_ids);
    IF v_blocker IS NOT NULL THEN
      RAISE EXCEPTION '%', v_blocker;
    END IF;

  ELSIF p_operation_type = 'room_change' THEN
    v_dest := nullif(coalesce(
      p_payload ->> 'to_hotel_room_id',
      p_payload ->> 'toHotelRoomId'
    ), '')::uuid;
    v_rrid := nullif(coalesce(
      p_payload ->> 'reservation_room_id',
      p_payload ->> 'reservationRoomId'
    ), '')::uuid;
    IF v_dest IS NULL OR v_rrid IS NULL THEN
      RAISE EXCEPTION 'validation_failed';
    END IF;

    v_blocker := public.hotelhub_hk_readiness_blocker_locked(p_tenant_id, ARRAY[v_dest]);
    IF v_blocker IS NOT NULL THEN
      -- Same destination-specific vocabulary the approval path uses.
      v_blocker := CASE v_blocker
        WHEN 'housekeeping_not_initialized' THEN 'destination_housekeeping_not_initialized'
        WHEN 'room_not_ready' THEN 'destination_room_not_ready'
        WHEN 'room_dirty' THEN 'destination_room_dirty'
        WHEN 'room_cleaning' THEN 'destination_room_cleaning'
        WHEN 'room_inspected' THEN 'destination_room_inspected'
        WHEN 'dnd_active' THEN 'destination_dnd_active'
        ELSE v_blocker
      END;
      RAISE EXCEPTION '%', v_blocker;
    END IF;

    -- (d) The room actually being vacated, resolved and locked BEFORE apply.
    SELECT rr.hotel_room_id INTO v_old_room
      FROM public.hotel_reservation_rooms rr
     WHERE rr.tenant_id = p_tenant_id
       AND rr.reservation_id = p_reservation_id
       AND rr.id = v_rrid
     FOR UPDATE;
    IF v_old_room IS NULL THEN
      RAISE EXCEPTION 'reservation_room_unresolved';
    END IF;

    SELECT e.out_handoff_id INTO v_handoff_id
      FROM public.hotelhub_hk_enqueue_handoff(
        p_tenant_id,
        v_old_room,
        p_actor_n3_user_key,
        p_reservation_id,
        v_request_id,
        'room_change'
      ) AS e;
    IF v_handoff_id IS NULL THEN
      RAISE EXCEPTION 'handoff_not_recorded';
    END IF;
  END IF;

  -- (e) The existing authoritative approve/apply engine.
  SELECT d.out_request_id, d.out_state
    INTO v_request_id, v_state
    FROM public.hotelhub_decide_operation(
      p_tenant_id,
      v_request_id,
      p_actor_n3_user_key,
      'approve',
      NULL,
      p_idempotency_key || ':direct'
    ) AS d;

  IF v_state = 'pending' THEN
    RAISE EXCEPTION 'operation_decision_failed';
  END IF;

  RETURN QUERY SELECT v_request_id, v_state, v_handoff_id, v_old_room;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_folio_room_night_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_hk_cancel_handoff(p_tenant_id uuid, p_handoff_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE hotel_housekeeping_handoffs
    SET state = 'cancelled', resolved_at = now()
    WHERE tenant_id = p_tenant_id AND id = p_handoff_id AND state = 'pending';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_hk_enqueue_handoff(p_tenant_id uuid, p_hotel_room_id uuid, p_actor_n3_user_key text, p_reservation_id uuid DEFAULT NULL::uuid, p_operation_request_id uuid DEFAULT NULL::uuid, p_source text DEFAULT 'room_change'::text)
 RETURNS TABLE(out_handoff_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_room uuid;
BEGIN
  -- Serialise against readiness/apply on the SAME tenant+room row.
  SELECT r.id INTO v_room
    FROM public.hotel_rooms r
   WHERE r.tenant_id = p_tenant_id AND r.id = p_hotel_room_id
   FOR UPDATE;
  IF v_room IS NULL THEN
    RETURN QUERY SELECT NULL::uuid;
    RETURN;
  END IF;

  IF p_operation_request_id IS NOT NULL THEN
    SELECT id INTO v_id FROM hotel_housekeeping_handoffs
      WHERE tenant_id = p_tenant_id
        AND operation_request_id = p_operation_request_id
        AND hotel_room_id = p_hotel_room_id
      FOR UPDATE;
    IF v_id IS NOT NULL THEN
      UPDATE hotel_housekeeping_handoffs
        SET state = 'pending', resolved_at = NULL
        WHERE id = v_id AND state = 'cancelled';
      RETURN QUERY SELECT v_id;
      RETURN;
    END IF;
  END IF;

  INSERT INTO hotel_housekeeping_handoffs (
    tenant_id, hotel_room_id, reservation_id, operation_request_id, source,
    actor_n3_user_key, state
  ) VALUES (
    p_tenant_id, p_hotel_room_id, p_reservation_id, p_operation_request_id,
    p_source, p_actor_n3_user_key, 'pending'
  ) RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_hk_fail_handoff(p_tenant_id uuid, p_handoff_id uuid, p_error text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE hotel_housekeeping_handoffs
    SET attempts = attempts + 1, last_error = left(coalesce(p_error, ''), 300)
    WHERE tenant_id = p_tenant_id AND id = p_handoff_id AND state = 'pending';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_hk_initialize_room(p_tenant_id uuid, p_hotel_room_id uuid, p_actor_n3_user_key text, p_condition text, p_source text DEFAULT 'owner_bootstrap'::text)
 RETURNS TABLE(out_condition text, out_dnd boolean, out_created boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_room uuid; v_existing text;
BEGIN
  IF p_condition NOT IN ('ready', 'dirty') THEN
    RAISE EXCEPTION 'HH100 invalid_condition';
  END IF;
  SELECT id INTO v_room FROM hotel_rooms
    WHERE id = p_hotel_room_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF v_room IS NULL THEN RAISE EXCEPTION 'HH101 room_not_found'; END IF;

  SELECT condition INTO v_existing FROM hotel_room_housekeeping
    WHERE tenant_id = p_tenant_id AND hotel_room_id = p_hotel_room_id FOR UPDATE;
  IF v_existing IS NOT NULL THEN
    -- Already initialized: idempotent no-op, never a silent re-assertion.
    RETURN QUERY SELECT v_existing, h.dnd_active, false
      FROM hotel_room_housekeeping h
      WHERE h.tenant_id = p_tenant_id AND h.hotel_room_id = p_hotel_room_id;
    RETURN;
  END IF;

  INSERT INTO hotel_room_housekeeping (
    tenant_id, hotel_room_id, condition, initialized_by_n3_user_key,
    last_action, last_actor_n3_user_key, last_transition_at
  ) VALUES (
    p_tenant_id, p_hotel_room_id, p_condition, p_actor_n3_user_key,
    'initialize', p_actor_n3_user_key, now()
  );

  INSERT INTO hotel_housekeeping_events (
    tenant_id, hotel_room_id, action, previous_condition, resulting_condition,
    dnd_before, dnd_after, actor_n3_user_key, source
  ) VALUES (
    p_tenant_id, p_hotel_room_id, 'initialize', NULL, p_condition,
    false, false, p_actor_n3_user_key, p_source
  );

  RETURN QUERY SELECT p_condition, false, true;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_hk_list_pending_handoffs(p_tenant_id uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(out_id uuid, out_hotel_room_id uuid, out_reservation_id uuid, out_actor_n3_user_key text, out_source text, out_attempts integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id, hotel_room_id, reservation_id, actor_n3_user_key, source, attempts
    FROM hotel_housekeeping_handoffs
    WHERE tenant_id = p_tenant_id AND state = 'pending' AND attempts < 10
    ORDER BY created_at
    LIMIT greatest(least(coalesce(p_limit, 20), 100), 1);
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_hk_readiness_blocker_locked(p_tenant_id uuid, p_room_ids uuid[])
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_room_id uuid;
  v_active boolean;
  v_exists boolean;
  v_condition text;
  v_dnd boolean;
  v_handoff_id uuid;
BEGIN
  IF p_tenant_id IS NULL THEN
    RETURN 'validation_failed';
  END IF;
  IF p_room_ids IS NULL OR array_length(p_room_ids, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  FOREACH v_room_id IN ARRAY p_room_ids LOOP
    CONTINUE WHEN v_room_id IS NULL;

    -- Lock the room record. An unreadable/absent room fails closed. This lock
    -- is also what a concurrent hotelhub_hk_enqueue_handoff must wait on.
    SELECT r.is_active INTO v_active
      FROM public.hotel_rooms r
     WHERE r.tenant_id = p_tenant_id AND r.id = v_room_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RETURN 'room_not_found';
    END IF;
    IF v_active IS NOT TRUE THEN
      RETURN 'room_inactive';
    END IF;

    -- A queued vacated-room handover means the room is not usable yet.
    -- Row-level lock, never an aggregate: FOR UPDATE with count() is illegal.
    SELECT h.id INTO v_handoff_id
      FROM public.hotel_housekeeping_handoffs h
     WHERE h.tenant_id = p_tenant_id
       AND h.hotel_room_id = v_room_id
       AND h.state = 'pending'
     ORDER BY h.created_at ASC
     LIMIT 1
     FOR UPDATE;
    IF FOUND AND v_handoff_id IS NOT NULL THEN
      RETURN 'handoff_pending';
    END IF;

    SELECT TRUE, hk.condition, hk.dnd_active
      INTO v_exists, v_condition, v_dnd
      FROM public.hotel_room_housekeeping hk
     WHERE hk.tenant_id = p_tenant_id AND hk.hotel_room_id = v_room_id
     FOR UPDATE;

    IF NOT FOUND OR v_condition IS NULL THEN
      RETURN 'housekeeping_not_initialized';
    END IF;
    IF v_condition <> 'ready' THEN
      RETURN 'room_' || v_condition;
    END IF;
    IF v_dnd IS TRUE THEN
      RETURN 'dnd_active';
    END IF;
  END LOOP;

  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_hk_set_dnd(p_tenant_id uuid, p_hotel_room_id uuid, p_actor_n3_user_key text, p_active boolean, p_source text DEFAULT 'app'::text)
 RETURNS TABLE(out_condition text, out_dnd boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_cur text; v_dnd boolean; v_occupied boolean;
BEGIN
  SELECT condition, dnd_active INTO v_cur, v_dnd FROM hotel_room_housekeeping
    WHERE tenant_id = p_tenant_id AND hotel_room_id = p_hotel_room_id FOR UPDATE;
  IF v_cur IS NULL THEN RAISE EXCEPTION 'HH102 housekeeping_not_initialized'; END IF;

  IF p_active THEN
    SELECT EXISTS (
      SELECT 1 FROM hotel_reservation_rooms rr
      JOIN hotel_reservations r ON r.id = rr.reservation_id AND r.tenant_id = rr.tenant_id
      WHERE rr.tenant_id = p_tenant_id AND rr.hotel_room_id = p_hotel_room_id
        AND r.status = 'checked_in' AND rr.allocation_status IN ('reserved', 'occupied')
    ) INTO v_occupied;
    IF NOT v_occupied THEN RAISE EXCEPTION 'HH105 room_not_occupied'; END IF;
    IF v_cur = 'cleaning' THEN RAISE EXCEPTION 'HH106 cleaning_in_progress'; END IF;
  END IF;

  IF v_dnd = p_active THEN
    RETURN QUERY SELECT v_cur, v_dnd;
    RETURN;
  END IF;

  UPDATE hotel_room_housekeeping SET
    dnd_active = p_active,
    dnd_set_at = CASE WHEN p_active THEN now() ELSE NULL END,
    dnd_set_by_n3_user_key = CASE WHEN p_active THEN p_actor_n3_user_key ELSE NULL END,
    updated_at = now()
  WHERE tenant_id = p_tenant_id AND hotel_room_id = p_hotel_room_id;

  INSERT INTO hotel_housekeeping_events (
    tenant_id, hotel_room_id, action, previous_condition, resulting_condition,
    dnd_before, dnd_after, actor_n3_user_key, source
  ) VALUES (
    p_tenant_id, p_hotel_room_id, CASE WHEN p_active THEN 'set_dnd' ELSE 'clear_dnd' END,
    v_cur, v_cur, v_dnd, p_active, p_actor_n3_user_key, p_source
  );

  RETURN QUERY SELECT v_cur, p_active;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_hk_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_hk_transition(p_tenant_id uuid, p_hotel_room_id uuid, p_actor_n3_user_key text, p_action text, p_note text DEFAULT NULL::text, p_source text DEFAULT 'app'::text)
 RETURNS TABLE(out_previous text, out_condition text, out_dnd boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_cur text; v_dnd boolean; v_next text;
BEGIN
  SELECT condition, dnd_active INTO v_cur, v_dnd FROM hotel_room_housekeeping
    WHERE tenant_id = p_tenant_id AND hotel_room_id = p_hotel_room_id FOR UPDATE;
  IF v_cur IS NULL THEN RAISE EXCEPTION 'HH102 housekeeping_not_initialized'; END IF;

  IF v_dnd AND p_action IN ('start_cleaning', 'finish_cleaning', 'mark_ready', 'revert_to_cleaning') THEN
    RAISE EXCEPTION 'HH103 dnd_active';
  END IF;

  v_next := CASE
    WHEN p_action = 'mark_dirty' AND v_cur IN ('ready', 'cleaning') THEN 'dirty'
    WHEN p_action = 'start_cleaning' AND v_cur = 'dirty' THEN 'cleaning'
    WHEN p_action = 'finish_cleaning' AND v_cur = 'cleaning' THEN 'inspected'
    WHEN p_action = 'mark_ready' AND v_cur = 'inspected' THEN 'ready'
    WHEN p_action = 'revert_to_cleaning' AND v_cur = 'inspected' THEN 'cleaning'
    ELSE NULL
  END;
  IF v_next IS NULL THEN RAISE EXCEPTION 'HH104 illegal_transition'; END IF;

  UPDATE hotel_room_housekeeping SET
    condition = v_next, last_action = p_action,
    last_actor_n3_user_key = p_actor_n3_user_key,
    last_transition_at = now(), note = p_note, updated_at = now()
  WHERE tenant_id = p_tenant_id AND hotel_room_id = p_hotel_room_id;

  INSERT INTO hotel_housekeeping_events (
    tenant_id, hotel_room_id, action, previous_condition, resulting_condition,
    dnd_before, dnd_after, actor_n3_user_key, source, note
  ) VALUES (
    p_tenant_id, p_hotel_room_id, p_action, v_cur, v_next,
    v_dnd, v_dnd, p_actor_n3_user_key, p_source, p_note
  );

  RETURN QUERY SELECT v_cur, v_next, v_dnd;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_hk_vacate_room(p_tenant_id uuid, p_hotel_room_id uuid, p_actor_n3_user_key text, p_source text DEFAULT 'room_change'::text)
 RETURNS TABLE(out_previous text, out_condition text, out_applied boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_cur text; v_dnd boolean;
BEGIN
  SELECT condition, dnd_active INTO v_cur, v_dnd FROM hotel_room_housekeeping
    WHERE tenant_id = p_tenant_id AND hotel_room_id = p_hotel_room_id FOR UPDATE;
  IF v_cur IS NULL THEN
    -- Uninitialized rooms stay uninitialized: never fabricate a condition.
    RETURN QUERY SELECT NULL::text, NULL::text, false;
    RETURN;
  END IF;

  UPDATE hotel_room_housekeeping SET
    condition = 'dirty', dnd_active = false, dnd_set_at = NULL,
    dnd_set_by_n3_user_key = NULL, last_action = 'vacated',
    last_actor_n3_user_key = p_actor_n3_user_key,
    last_transition_at = now(), updated_at = now()
  WHERE tenant_id = p_tenant_id AND hotel_room_id = p_hotel_room_id;

  INSERT INTO hotel_housekeeping_events (
    tenant_id, hotel_room_id, action, previous_condition, resulting_condition,
    dnd_before, dnd_after, actor_n3_user_key, source
  ) VALUES (
    p_tenant_id, p_hotel_room_id, 'vacated', v_cur, 'dirty',
    v_dnd, false, p_actor_n3_user_key, p_source
  );

  RETURN QUERY SELECT v_cur, 'dirty'::text, true;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_hk_vacate_room_v2(p_tenant_id uuid, p_hotel_room_id uuid, p_actor_n3_user_key text, p_source text DEFAULT 'room_change'::text, p_handoff_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(out_previous text, out_condition text, out_applied boolean, out_created boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cur text;
  v_dnd boolean;
  v_created boolean := false;
BEGIN
  PERFORM 1 FROM hotel_rooms
    WHERE tenant_id = p_tenant_id AND id = p_hotel_room_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HH104 room_not_found';
  END IF;

  SELECT condition, dnd_active INTO v_cur, v_dnd FROM hotel_room_housekeeping
    WHERE tenant_id = p_tenant_id AND hotel_room_id = p_hotel_room_id FOR UPDATE;

  IF v_cur IS NULL THEN
    INSERT INTO hotel_room_housekeeping (
      tenant_id, hotel_room_id, condition, dnd_active,
      initialized_at, initialized_by_n3_user_key,
      last_action, last_actor_n3_user_key, last_transition_at
    ) VALUES (
      p_tenant_id, p_hotel_room_id, 'dirty', false,
      now(), p_actor_n3_user_key, 'vacated', p_actor_n3_user_key, now()
    );
    v_created := true;
    v_dnd := false;
  ELSE
    UPDATE hotel_room_housekeeping SET
      condition = 'dirty', dnd_active = false, dnd_set_at = NULL,
      dnd_set_by_n3_user_key = NULL, last_action = 'vacated',
      last_actor_n3_user_key = p_actor_n3_user_key,
      last_transition_at = now(), updated_at = now()
    WHERE tenant_id = p_tenant_id AND hotel_room_id = p_hotel_room_id;
  END IF;

  INSERT INTO hotel_housekeeping_events (
    tenant_id, hotel_room_id, action, previous_condition, resulting_condition,
    dnd_before, dnd_after, actor_n3_user_key, source
  ) VALUES (
    p_tenant_id, p_hotel_room_id, 'vacated', v_cur, 'dirty',
    v_dnd, false, p_actor_n3_user_key, p_source
  );

  IF p_handoff_id IS NOT NULL THEN
    UPDATE hotel_housekeeping_handoffs
      SET state = 'applied', resolved_at = now(), last_error = NULL
      WHERE tenant_id = p_tenant_id AND id = p_handoff_id;
  END IF;

  RETURN QUERY SELECT v_cur, 'dirty'::text, true, v_created;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_housekeeping_history_preview_30d(p_tenant_id uuid)
 RETURNS TABLE(out_cutoff timestamp with time zone, out_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cutoff timestamptz;
  v_count integer := 0;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'validation_failed';
  END IF;
  v_cutoff := now() - interval '30 days';
  SELECT count(*)::integer INTO v_count
    FROM public.hotel_housekeeping_events
   WHERE tenant_id = p_tenant_id
     AND created_at < v_cutoff;
  RETURN QUERY SELECT v_cutoff, v_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_list_reservations(p_tenant_id uuid, p_booking_reference text DEFAULT NULL::text, p_guest_name text DEFAULT NULL::text, p_guest_mobile text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_booking_source text DEFAULT NULL::text, p_arrival_from date DEFAULT NULL::date, p_arrival_to date DEFAULT NULL::date, p_sort_key text DEFAULT 'createdAt'::text, p_sort_dir text DEFAULT 'desc'::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := coalesce(nullif(btrim(p_sort_key), ''), 'createdAt');
  v_dir text := lower(coalesce(nullif(btrim(p_sort_dir), ''), 'desc'));
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_ref text := nullif(btrim(coalesce(p_booking_reference, '')), '');
  v_name text := nullif(btrim(coalesce(p_guest_name, '')), '');
  v_mobile text := nullif(btrim(coalesce(p_guest_mobile, '')), '');
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_source text := nullif(btrim(coalesce(p_booking_source, '')), '');
  v_total bigint := 0;
  v_items jsonb := '[]'::jsonb;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_required';
  END IF;
  IF v_key NOT IN (
    'bookingReference','primaryGuestName','arrivalDate','departureDate',
    'roomNo','guestCount','bookingSource','status','createdAt'
  ) THEN
    RAISE EXCEPTION 'invalid_sort_key';
  END IF;
  IF v_dir NOT IN ('asc','desc') THEN
    RAISE EXCEPTION 'invalid_sort_dir';
  END IF;

  WITH base AS (
    SELECT r.id, r.booking_reference, r.booking_source, r.status,
           r.arrival_date, r.departure_date, r.created_at, r.created_by_n3_user_key
    FROM public.hotel_reservations r
    WHERE r.tenant_id = p_tenant_id
      AND (v_ref IS NULL OR r.booking_reference ILIKE '%' || replace(replace(v_ref, '%', ''), '_', '') || '%')
      AND (v_status IS NULL OR r.status = v_status)
      AND (v_source IS NULL OR r.booking_source = v_source)
      AND (p_arrival_from IS NULL OR r.arrival_date >= p_arrival_from)
      AND (p_arrival_to IS NULL OR r.arrival_date <= p_arrival_to)
      AND (
        (v_name IS NULL AND v_mobile IS NULL)
        OR EXISTS (
          SELECT 1
          FROM public.hotel_reservation_guests rg
          JOIN public.hotel_guests g
            ON g.id = rg.guest_id AND g.tenant_id = p_tenant_id
          WHERE rg.reservation_id = r.id
            AND rg.tenant_id = p_tenant_id
            AND (v_name IS NULL OR g.full_name ILIKE '%' || replace(replace(v_name, '%', ''), '_', '') || '%')
            AND (v_mobile IS NULL OR g.mobile ILIKE '%' || replace(replace(v_mobile, '%', ''), '_', '') || '%')
        )
      )
  )
  SELECT count(*) INTO v_total FROM base;

  WITH base AS (
    SELECT r.id, r.booking_reference, r.booking_source, r.status,
           r.arrival_date, r.departure_date, r.created_at, r.created_by_n3_user_key
    FROM public.hotel_reservations r
    WHERE r.tenant_id = p_tenant_id
      AND (v_ref IS NULL OR r.booking_reference ILIKE '%' || replace(replace(v_ref, '%', ''), '_', '') || '%')
      AND (v_status IS NULL OR r.status = v_status)
      AND (v_source IS NULL OR r.booking_source = v_source)
      AND (p_arrival_from IS NULL OR r.arrival_date >= p_arrival_from)
      AND (p_arrival_to IS NULL OR r.arrival_date <= p_arrival_to)
      AND (
        (v_name IS NULL AND v_mobile IS NULL)
        OR EXISTS (
          SELECT 1
          FROM public.hotel_reservation_guests rg
          JOIN public.hotel_guests g
            ON g.id = rg.guest_id AND g.tenant_id = p_tenant_id
          WHERE rg.reservation_id = r.id
            AND rg.tenant_id = p_tenant_id
            AND (v_name IS NULL OR g.full_name ILIKE '%' || replace(replace(v_name, '%', ''), '_', '') || '%')
            AND (v_mobile IS NULL OR g.mobile ILIKE '%' || replace(replace(v_mobile, '%', ''), '_', '') || '%')
        )
      )
  ),
  agg AS (
    SELECT b.*,
      (
        SELECT coalesce(g.full_name, '')
        FROM public.hotel_reservation_guests rg
        JOIN public.hotel_guests g ON g.id = rg.guest_id AND g.tenant_id = p_tenant_id
        WHERE rg.reservation_id = b.id AND rg.tenant_id = p_tenant_id AND rg.is_primary
        ORDER BY rg.created_at, rg.id
        LIMIT 1
      ) AS primary_name,
      (
        SELECT g.mobile
        FROM public.hotel_reservation_guests rg
        JOIN public.hotel_guests g ON g.id = rg.guest_id AND g.tenant_id = p_tenant_id
        WHERE rg.reservation_id = b.id AND rg.tenant_id = p_tenant_id AND rg.is_primary
        ORDER BY rg.created_at, rg.id
        LIMIT 1
      ) AS primary_mobile,
      (
        SELECT count(*)::int
        FROM public.hotel_reservation_guests rg
        WHERE rg.reservation_id = b.id AND rg.tenant_id = p_tenant_id
      ) AS guest_count,
      (
        SELECT count(*)::int
        FROM public.hotel_reservation_rooms rr
        WHERE rr.reservation_id = b.id AND rr.tenant_id = p_tenant_id
      ) AS room_count,
      coalesce((
        SELECT array_agg(lbl ORDER BY ord)
        FROM (
          SELECT coalesce(
                   nullif(btrim(coalesce(rm.display_name, '')), ''),
                   nullif(btrim(coalesce(rm.n3_stock_name, '')), ''),
                   nullif(btrim(coalesce(rm.room_number, '')), '')
                 ) AS lbl,
                 row_number() OVER (ORDER BY rr.created_at, rr.id) AS ord
          FROM public.hotel_reservation_rooms rr
          JOIN public.hotel_rooms rm ON rm.id = rr.hotel_room_id AND rm.tenant_id = p_tenant_id
          WHERE rr.reservation_id = b.id AND rr.tenant_id = p_tenant_id
        ) labels
        WHERE lbl IS NOT NULL
      ), ARRAY[]::text[]) AS room_labels,
      coalesce((
        SELECT string_agg(num, ',' ORDER BY num)
        FROM (
          SELECT lower(btrim(coalesce(rm.room_number, ''))) AS num
          FROM public.hotel_reservation_rooms rr
          JOIN public.hotel_rooms rm ON rm.id = rr.hotel_room_id AND rm.tenant_id = p_tenant_id
          WHERE rr.reservation_id = b.id AND rr.tenant_id = p_tenant_id
        ) nums
        WHERE num <> ''
      ), '') AS room_number_sort
    FROM base b
  ),
  keyed AS (
    SELECT a.*,
      CASE v_key
        WHEN 'bookingReference' THEN lower(a.booking_reference)
        WHEN 'primaryGuestName' THEN lower(coalesce(a.primary_name, ''))
        WHEN 'arrivalDate' THEN a.arrival_date::text
        WHEN 'departureDate' THEN a.departure_date::text
        WHEN 'roomNo' THEN a.room_number_sort
        WHEN 'bookingSource' THEN lower(a.booking_source)
        WHEN 'status' THEN lower(a.status)
        WHEN 'createdAt' THEN to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
        ELSE NULL
      END AS sort_text,
      CASE WHEN v_key = 'guestCount' THEN a.guest_count ELSE NULL END AS sort_num
    FROM agg a
  ),
  page AS (
    SELECT * FROM keyed
    ORDER BY
      CASE WHEN v_dir = 'asc' THEN sort_num END ASC NULLS LAST,
      CASE WHEN v_dir = 'desc' THEN sort_num END DESC NULLS LAST,
      CASE WHEN v_dir = 'asc' THEN sort_text END ASC NULLS LAST,
      CASE WHEN v_dir = 'desc' THEN sort_text END DESC NULLS LAST,
      created_at DESC,
      id DESC
    LIMIT v_limit OFFSET v_offset
  ),
  numbered AS (
    SELECT row_number() OVER () AS rn, p.* FROM page p
  )
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', n.id,
      'bookingReference', n.booking_reference,
      'primaryGuestName', n.primary_name,
      'primaryGuestMobile', n.primary_mobile,
      'bookingSource', n.booking_source,
      'status', n.status,
      'arrivalDate', n.arrival_date::text,
      'departureDate', n.departure_date::text,
      'roomCount', n.room_count,
      'roomLabels', to_jsonb(n.room_labels),
      'guestCount', n.guest_count,
      'createdAt', n.created_at,
      'createdByN3UserKey', n.created_by_n3_user_key
    ) ORDER BY n.rn
  ), '[]'::jsonb) INTO v_items FROM numbered n;

  RETURN jsonb_build_object('items', v_items, 'total', v_total);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_operation_request_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id
     OR NEW.reservation_id <> OLD.reservation_id
     OR NEW.operation_type <> OLD.operation_type
     OR NEW.requested_by_n3_user_key <> OLD.requested_by_n3_user_key
     OR NEW.idempotency_key <> OLD.idempotency_key
     OR NEW.requested_at <> OLD.requested_at THEN
    RAISE EXCEPTION USING ERRCODE='HH201', MESSAGE='operation_immutable_field';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_property_now(p_tenant_id uuid)
 RETURNS timestamp without time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (now() AT TIME ZONE COALESCE(
    (SELECT s.timezone FROM public.hotel_settings s WHERE s.tenant_id = p_tenant_id),
    'Asia/Kuala_Lumpur'));
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_provision_owner(p_n3_tenant_key text, p_n3_user_key text)
 RETURNS TABLE(out_tenant_id uuid, out_n3_user_key text, out_role hotel_role, out_is_active boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  IF p_n3_tenant_key IS NULL OR length(trim(p_n3_tenant_key)) = 0 THEN
    RAISE EXCEPTION 'p_n3_tenant_key required';
  END IF;
  IF p_n3_user_key IS NULL OR length(trim(p_n3_user_key)) = 0 THEN
    RAISE EXCEPTION 'p_n3_user_key required';
  END IF;

  SELECT t.id
    INTO v_tenant_id
    FROM public.hotel_tenants AS t
   WHERE t.n3_tenant_key = p_n3_tenant_key;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION
      'No hotel_tenants row for n3_tenant_key=%. The N3 user must complete a launch first so the tenant is upserted.',
      p_n3_tenant_key;
  END IF;

  INSERT INTO public.hotel_user_roles AS r (tenant_id, n3_user_key, role, is_active)
  VALUES (v_tenant_id, p_n3_user_key, 'owner', true)
  ON CONFLICT (tenant_id, n3_user_key)
  DO UPDATE
    SET role = 'owner',
        is_active = true,
        updated_at = now();

  INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
  VALUES (
    v_tenant_id,
    p_n3_user_key,
    'role.assigned',
    jsonb_build_object(
      'role', 'owner',
      'source', 'hotelhub_provision_owner',
      'provisioned_at', now()
    )
  );

  RETURN QUERY
    SELECT r.tenant_id   AS out_tenant_id,
           r.n3_user_key AS out_n3_user_key,
           r.role        AS out_role,
           r.is_active   AS out_is_active
      FROM public.hotel_user_roles AS r
     WHERE r.tenant_id   = v_tenant_id
       AND r.n3_user_key = p_n3_user_key;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_purge_housekeeping_history_30d(p_tenant_id uuid, p_actor_n3_user_key text)
 RETURNS TABLE(out_deleted integer, out_cutoff timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cutoff timestamptz;
  v_deleted integer := 0;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'validation_failed';
  END IF;
  IF p_actor_n3_user_key IS NULL OR length(btrim(p_actor_n3_user_key)) = 0 THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  v_cutoff := now() - interval '30 days';

  DELETE FROM public.hotel_housekeeping_events
   WHERE tenant_id = p_tenant_id
     AND created_at < v_cutoff;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
  VALUES (
    p_tenant_id,
    p_actor_n3_user_key,
    'hotel.housekeeping.history_purged',
    jsonb_build_object('days', 30, 'cutoff', v_cutoff, 'deleted', v_deleted)
  );

  RETURN QUERY SELECT v_deleted, v_cutoff;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_receipt_alert_claim(p_tenant_id uuid, p_limit integer)
 RETURNS SETOF hotel_receipt_alert_outbox
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.hotel_receipt_alert_outbox o
     SET status = 'sending', claimed_at = now(), claim_token = gen_random_uuid(), attempts = o.attempts + 1
   WHERE o.id IN (
     SELECT id FROM public.hotel_receipt_alert_outbox
      WHERE tenant_id = p_tenant_id
        AND attempts < 10
        AND ((status IN ('pending','failed') AND next_attempt_at <= now())
             OR (status = 'sending' AND claimed_at < now() - interval '10 minutes'))
      ORDER BY created_at
      LIMIT greatest(1, least(p_limit, 50))
      FOR UPDATE SKIP LOCKED)
  RETURNING o.*;
END $function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_receipt_alert_settle(p_tenant_id uuid, p_alert_id uuid, p_claim_token uuid, p_status text, p_error_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_status NOT IN ('sent','failed','disabled') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  UPDATE public.hotel_receipt_alert_outbox
     SET status = p_status,
         sent_at = CASE WHEN p_status = 'sent' THEN now() ELSE sent_at END,
         last_error_code = p_error_code,
         claim_token = NULL,
         next_attempt_at = CASE WHEN p_status = 'failed'
           THEN now() + least(interval '6 hours', interval '1 minute' * power(2, attempts)) ELSE next_attempt_at END
   WHERE id = p_alert_id AND tenant_id = p_tenant_id AND status = 'sending'
     AND p_claim_token IS NOT NULL AND claim_token = p_claim_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'alert_not_claimed'; END IF;
END $function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_receipt_control_claim(p_tenant_id uuid, p_request_id uuid, p_expected_version integer, p_step text, p_actor text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v public.hotel_receipt_control_requests; v_id uuid;
BEGIN
  SELECT * INTO v FROM public.hotel_receipt_control_requests
    WHERE id = p_request_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF v.approved_at IS NULL THEN RAISE EXCEPTION 'not_approved'; END IF;
  IF p_step NOT IN ('verify','edit','void','replace') THEN RAISE EXCEPTION 'invalid_transition'; END IF;
  IF p_step <> 'verify' AND v.execution_mode = 'manual' THEN RAISE EXCEPTION 'automation_unavailable'; END IF;
  IF v.version <> p_expected_version OR v.state NOT IN ('approved_awaiting_n3','needs_review') THEN RETURN NULL; END IF;
  INSERT INTO public.hotel_receipt_control_executions (tenant_id, request_id, step, claimed_by_n3_user_key, claimed_version)
    VALUES (p_tenant_id, v.id, p_step, p_actor, v.version + 1) ON CONFLICT DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  IF v.state = 'approved_awaiting_n3' THEN
    UPDATE public.hotel_receipt_control_requests SET state = 'applying', version = version + 1 WHERE id = v.id;
  ELSE
    UPDATE public.hotel_receipt_control_requests SET version = version + 1 WHERE id = v.id;
  END IF;
  RETURN v_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_receipt_control_complete(p_tenant_id uuid, p_request_id uuid, p_execution_id uuid, p_to_state text, p_outcome_code text, p_actor text, p_version jsonb)
 RETURNS SETOF hotel_receipt_control_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v public.hotel_receipt_control_requests; v_from text; v_no integer; v_exec public.hotel_receipt_control_executions;
BEGIN
  SELECT * INTO v FROM public.hotel_receipt_control_requests
    WHERE id = p_request_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  -- Fence: the claim must still be the in-flight claim for THIS request version of an approved request.
  SELECT * INTO v_exec FROM public.hotel_receipt_control_executions
    WHERE id = p_execution_id AND request_id = v.id AND tenant_id = p_tenant_id AND state = 'claimed' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim_not_found'; END IF;
  IF v.approved_at IS NULL OR v.state NOT IN ('applying','needs_review') OR v.version <> v_exec.claimed_version THEN
    RAISE EXCEPTION 'claim_stale';
  END IF;
  v_from := v.state;
  -- applied needs version evidence. A failed/needs_review outcome may still carry
  -- CONFIRMED void evidence (void step succeeded, replacement did not) so the
  -- original is excluded even though the overall request failed.
  IF p_to_state NOT IN ('applied','needs_review','failed')
     OR (p_to_state = 'applied' AND p_version IS NULL)
     OR (p_to_state <> 'applied' AND p_version IS NOT NULL AND p_version->>'state' IS DISTINCT FROM 'voided') THEN
    RAISE EXCEPTION 'invalid_transition';
  END IF;
  UPDATE public.hotel_receipt_control_executions SET state = 'completed', result_code = p_outcome_code, completed_at = now()
    WHERE id = v_exec.id;
  IF p_version IS NOT NULL THEN
    SELECT coalesce(max(version_no), 0) + 1 INTO v_no FROM public.hotel_receipt_versions
      WHERE tenant_id = p_tenant_id AND deposit_id = v.deposit_id;
    INSERT INTO public.hotel_receipt_versions (tenant_id, deposit_id, request_id, version_no, state, receipt_id,
      doc_code, document_date, currency, amount_cents, payment_lines, replacement_of, evidence_fingerprint,
      verified_by_n3_user_key)
    VALUES (p_tenant_id, v.deposit_id, v.id, v_no, p_version->>'state', p_version->>'receiptId',
      p_version->>'docCode', p_version->>'documentDate', p_version->>'currency',
      (p_version->>'amountCents')::bigint, p_version->'paymentLines', p_version->>'replacementOf',
      p_version->>'fingerprint', p_actor);
  END IF;
  UPDATE public.hotel_receipt_control_requests SET state = p_to_state, version = version + 1, outcome_code = p_outcome_code
    WHERE id = v.id RETURNING * INTO v;
  INSERT INTO public.hotel_receipt_control_decisions (tenant_id, request_id, decision, from_state, to_state,
    actor_n3_user_key, requester_n3_user_key, self_approved, outcome_code)
  VALUES (p_tenant_id, v.id, 'verify', v_from, p_to_state, p_actor, v.requested_by_n3_user_key,
    p_actor = v.requested_by_n3_user_key, p_outcome_code);
  IF p_to_state IN ('needs_review','failed') THEN
    INSERT INTO public.hotel_receipt_alert_outbox (tenant_id, request_id, event, request_version)
      VALUES (p_tenant_id, v.id, 'execution_failure', v.version) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEXT v;
END $function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_receipt_control_create(p_tenant_id uuid, p_reservation_id uuid, p_deposit_id uuid, p_client_request_id uuid, p_fingerprint text, p_kind text, p_reason text, p_original jsonb, p_proposal jsonb, p_comparison jsonb, p_original_cents bigint, p_proposed_cents bigint, p_actor text)
 RETURNS SETOF hotel_receipt_control_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v public.hotel_receipt_control_requests;
BEGIN
  -- RPC boundary validation mirrors the server contract (UTF-16 units).
  IF p_reason IS NULL OR p_reason <> btrim(p_reason)
     OR public.hotelhub_utf16_length(p_reason) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_reason';
  END IF;
  IF p_kind NOT IN ('correction','void') THEN RAISE EXCEPTION 'invalid_request'; END IF;
  SELECT * INTO v FROM public.hotel_receipt_control_requests
    WHERE tenant_id = p_tenant_id AND client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v.request_fingerprint <> p_fingerprint OR v.deposit_id <> p_deposit_id THEN
      RAISE EXCEPTION 'receipt_control_key_conflict';
    END IF;
    RETURN NEXT v; RETURN;
  END IF;
  PERFORM 1 FROM public.hotel_reservation_deposits d
    WHERE d.id = p_deposit_id AND d.tenant_id = p_tenant_id AND d.reservation_id = p_reservation_id AND d.status = 'posted';
  IF NOT FOUND THEN RAISE EXCEPTION 'deposit_not_found'; END IF;
  BEGIN
    INSERT INTO public.hotel_receipt_control_requests (tenant_id, reservation_id, deposit_id, client_request_id,
      request_fingerprint, kind, reason, original, proposal, comparison, original_amount_cents,
      proposed_amount_cents, requested_by_n3_user_key)
    VALUES (p_tenant_id, p_reservation_id, p_deposit_id, p_client_request_id, p_fingerprint, p_kind,
      p_reason, p_original, p_proposal, p_comparison, p_original_cents, p_proposed_cents, p_actor)
    RETURNING * INTO v;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v FROM public.hotel_receipt_control_requests
      WHERE tenant_id = p_tenant_id AND client_request_id = p_client_request_id;
    IF FOUND AND v.request_fingerprint = p_fingerprint THEN RETURN NEXT v; RETURN; END IF;
    IF FOUND THEN RAISE EXCEPTION 'receipt_control_key_conflict'; END IF;
    RAISE EXCEPTION 'receipt_control_active_exists';
  END;
  INSERT INTO public.hotel_receipt_alert_outbox (tenant_id, request_id, event, request_version)
    VALUES (p_tenant_id, v.id, 'pending', v.version) ON CONFLICT DO NOTHING;
  RETURN NEXT v;
END $function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_receipt_control_decide(p_tenant_id uuid, p_request_id uuid, p_expected_version integer, p_decision text, p_to_state text, p_actor text, p_outcome_code text, p_note text)
 RETURNS SETOF hotel_receipt_control_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v public.hotel_receipt_control_requests; v_from text;
BEGIN
  SELECT * INTO v FROM public.hotel_receipt_control_requests
    WHERE id = p_request_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF v.version <> p_expected_version THEN RAISE EXCEPTION 'version_conflict'; END IF;
  -- A verification claim in flight (e.g. on a previously approved Needs review
  -- request, whose state stays needs_review while claimed) fences ALL decisions:
  -- reject cannot reach a terminal state and free the active index while the
  -- claimed worker may still complete. Completion is additionally fenced to the
  -- claim's version and to applying/needs_review, so it can never resurrect a
  -- terminal request.
  IF EXISTS (SELECT 1 FROM public.hotel_receipt_control_executions
             WHERE request_id = v.id AND tenant_id = p_tenant_id AND state = 'claimed') THEN
    RAISE EXCEPTION 'claim_conflict';
  END IF;
  v_from := v.state;
  IF NOT (
    (p_decision = 'approve' AND v_from = 'pending' AND p_to_state = 'approved_awaiting_n3') OR
    (p_decision = 'hold' AND v_from IN ('pending','approved_awaiting_n3') AND p_to_state = 'needs_review') OR
    (p_decision = 'reject' AND v_from IN ('pending','needs_review') AND p_to_state = 'rejected')
  ) THEN RAISE EXCEPTION 'invalid_transition'; END IF;
  UPDATE public.hotel_receipt_control_requests SET state = p_to_state, version = version + 1,
    decided_by_n3_user_key = CASE WHEN p_decision = 'hold' THEN decided_by_n3_user_key ELSE p_actor END,
    decided_at = CASE WHEN p_decision = 'hold' THEN decided_at ELSE now() END,
    approved_by_n3_user_key = CASE WHEN p_decision = 'approve' THEN p_actor ELSE approved_by_n3_user_key END,
    approved_at = CASE WHEN p_decision = 'approve' THEN now() ELSE approved_at END,
    outcome_code = p_outcome_code
    WHERE id = v.id RETURNING * INTO v;
  INSERT INTO public.hotel_receipt_control_decisions (tenant_id, request_id, decision, from_state, to_state,
    actor_n3_user_key, requester_n3_user_key, self_approved, outcome_code, note)
  VALUES (p_tenant_id, v.id, p_decision, v_from, p_to_state, p_actor, v.requested_by_n3_user_key,
    p_actor = v.requested_by_n3_user_key, p_outcome_code, p_note);
  INSERT INTO public.hotel_receipt_alert_outbox (tenant_id, request_id, event, request_version)
    VALUES (p_tenant_id, v.id, 'decision', v.version) ON CONFLICT DO NOTHING;
  RETURN NEXT v;
END $function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_receipt_control_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'receipt_control_immutable'; END IF;
  IF TG_TABLE_NAME <> 'hotel_receipt_control_requests' THEN RAISE EXCEPTION 'receipt_control_immutable'; END IF;
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.deposit_id <> OLD.deposit_id OR NEW.reservation_id <> OLD.reservation_id
     OR NEW.client_request_id <> OLD.client_request_id OR NEW.request_fingerprint <> OLD.request_fingerprint
     OR NEW.kind <> OLD.kind OR NEW.reason <> OLD.reason OR NEW.original <> OLD.original OR NEW.proposal <> OLD.proposal
     OR NEW.comparison <> OLD.comparison OR NEW.original_amount_cents <> OLD.original_amount_cents
     OR NEW.proposed_amount_cents IS DISTINCT FROM OLD.proposed_amount_cents
     OR NEW.requested_by_n3_user_key <> OLD.requested_by_n3_user_key OR NEW.requested_at <> OLD.requested_at
     OR NEW.execution_mode <> OLD.execution_mode
     OR (OLD.approved_at IS NOT NULL AND (NEW.approved_at IS DISTINCT FROM OLD.approved_at
         OR NEW.approved_by_n3_user_key IS DISTINCT FROM OLD.approved_by_n3_user_key)) THEN
    RAISE EXCEPTION 'receipt_control_immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_receipt_control_recover(p_tenant_id uuid, p_request_id uuid, p_expected_version integer, p_actor text, p_stale_seconds integer)
 RETURNS SETOF hotel_receipt_control_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v public.hotel_receipt_control_requests; v_exec public.hotel_receipt_control_executions; v_from text;
BEGIN
  IF p_stale_seconds IS NULL OR p_stale_seconds < 60 THEN RAISE EXCEPTION 'invalid_transition'; END IF;
  SELECT * INTO v FROM public.hotel_receipt_control_requests
    WHERE id = p_request_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF v.version <> p_expected_version THEN RAISE EXCEPTION 'version_conflict'; END IF;
  IF v.state NOT IN ('applying','needs_review') OR v.approved_at IS NULL THEN
    RAISE EXCEPTION 'invalid_transition';
  END IF;
  SELECT * INTO v_exec FROM public.hotel_receipt_control_executions
    WHERE request_id = v.id AND tenant_id = p_tenant_id AND state = 'claimed' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim_not_found'; END IF;
  IF v_exec.created_at > now() - make_interval(secs => p_stale_seconds) THEN
    RAISE EXCEPTION 'claim_conflict';
  END IF;
  UPDATE public.hotel_receipt_control_executions
    SET state = 'released', result_code = 'recovered', completed_at = now() WHERE id = v_exec.id;
  v_from := v.state;
  UPDATE public.hotel_receipt_control_requests
    SET state = CASE WHEN v.state = 'applying' THEN 'approved_awaiting_n3' ELSE v.state END,
        version = version + 1, outcome_code = 'verification_interrupted'
    WHERE id = v.id RETURNING * INTO v;
  INSERT INTO public.hotel_receipt_control_decisions (tenant_id, request_id, decision, from_state, to_state,
    actor_n3_user_key, requester_n3_user_key, self_approved, outcome_code)
  VALUES (p_tenant_id, v.id, 'recover', v_from, v.state, p_actor, v.requested_by_n3_user_key,
    p_actor = v.requested_by_n3_user_key, 'verification_interrupted');
  RETURN NEXT v;
END $function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_receipt_control_verify_atomic(p_tenant_id uuid, p_request_id uuid, p_expected_version integer, p_actor text, p_to_state text, p_outcome_code text, p_version jsonb)
 RETURNS SETOF hotel_receipt_control_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_exec uuid;
BEGIN
  v_exec := public.hotelhub_receipt_control_claim(p_tenant_id, p_request_id, p_expected_version, 'verify', p_actor);
  IF v_exec IS NULL THEN RAISE EXCEPTION 'claim_conflict'; END IF;
  RETURN QUERY SELECT * FROM public.hotelhub_receipt_control_complete(
    p_tenant_id, p_request_id, v_exec, p_to_state, p_outcome_code, p_actor, p_version);
END $function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_release_folio_operation(p_tenant_id uuid, p_operation text, p_client_request_id uuid)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  delete from public.hotel_folio_operations
   where tenant_id = p_tenant_id
     and operation = p_operation
     and client_request_id = p_client_request_id;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_request_operation(p_tenant_id uuid, p_reservation_id uuid, p_actor_n3_user_key text, p_operation_type text, p_payload jsonb, p_idempotency_key text)
 RETURNS TABLE(out_request_id uuid, out_state text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_res public.hotel_reservations%ROWTYPE;
  v_existing public.hotel_reservation_operation_requests%ROWTYPE;
  v_id uuid;
BEGIN
  IF p_tenant_id IS NULL OR p_reservation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH220', MESSAGE='reservation_not_found';
  END IF;
  IF p_actor_n3_user_key IS NULL OR length(btrim(p_actor_n3_user_key)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH221', MESSAGE='unauthorized';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH222', MESSAGE='validation_failed';
  END IF;

  SELECT * INTO v_existing FROM public.hotel_reservation_operation_requests
    WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN QUERY SELECT v_existing.id, v_existing.state;
    RETURN;
  END IF;

  SELECT * INTO v_res FROM public.hotel_reservations
    WHERE id = p_reservation_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='HH223', MESSAGE='reservation_not_found';
  END IF;
  IF v_res.status NOT IN ('confirmed','checked_in') THEN
    RAISE EXCEPTION USING ERRCODE='HH224', MESSAGE='invalid_transition';
  END IF;

  BEGIN
    INSERT INTO public.hotel_reservation_operation_requests
      (tenant_id, reservation_id, operation_type, state, payload,
       requested_by_n3_user_key, idempotency_key)
    VALUES (p_tenant_id, p_reservation_id, p_operation_type, 'pending',
            COALESCE(p_payload, '{}'::jsonb), p_actor_n3_user_key, p_idempotency_key)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing FROM public.hotel_reservation_operation_requests
      WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN QUERY SELECT v_existing.id, v_existing.state;
      RETURN;
    END IF;
    RAISE EXCEPTION USING ERRCODE='HH225', MESSAGE='operation_pending';
  END;

  INSERT INTO public.hotel_reservation_events
    (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
  VALUES (p_tenant_id, p_reservation_id, 'operation_requested',
          'Requested ' || replace(p_operation_type, '_', ' '),
          p_actor_n3_user_key, jsonb_build_object('operation_request_id', v_id));

  INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
  VALUES (p_tenant_id, p_actor_n3_user_key, 'hotel.reservation.operation_requested',
          jsonb_build_object('bookingReference', v_res.booking_reference,
                             'operationType', p_operation_type));

  RETURN QUERY SELECT v_id, 'pending'::text;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_reservation_events_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION USING ERRCODE='HH202', MESSAGE='reservation_events_append_only';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_reverse_folio_line(p_tenant_id uuid, p_reservation_id uuid, p_line_id uuid, p_reason text, p_client_request_id uuid, p_actor_n3_user_key text, p_request_fingerprint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_seed_booking_sources()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.hotel_booking_sources (tenant_id, source_code, display_name, sort_order)
  VALUES
    (NEW.id, 'walk_in',       'Walk-in',       10),
    (NEW.id, 'phone',         'Phone',         20),
    (NEW.id, 'whatsapp',      'WhatsApp',      30),
    (NEW.id, 'hotel_website', 'Hotel Website', 40),
    (NEW.id, 'agoda',         'Agoda',         50),
    (NEW.id, 'booking_com',   'Booking.com',   60)
  ON CONFLICT (tenant_id, source_code) DO NOTHING;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_set_payment_account_preferences(p_tenant_id uuid, p_account_id uuid, p_label text DEFAULT NULL::text, p_show boolean DEFAULT NULL::boolean)
 RETURNS SETOF hotel_settings
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_update_folio_line_quantity(p_tenant_id uuid, p_reservation_id uuid, p_line_id uuid, p_expected_version integer, p_quantity integer, p_subtotal_cents integer, p_tax_cents integer, p_total_cents integer, p_client_request_id uuid, p_actor_n3_user_key text, p_request_fingerprint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_update_reservation(p_tenant_id uuid, p_reservation_id uuid, p_actor_n3_user_key text, p_expected_updated_at timestamp with time zone, p_booking_source text, p_arrival_date date, p_departure_date date, p_notes text, p_external_booking_reference text, p_rooms jsonb)
 RETURNS TABLE(out_reservation_id uuid, out_updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.hotel_reservations%ROWTYPE;
  v_source_active boolean;
  v_room jsonb;
  v_room_id uuid;
  v_agreed numeric(12,2);
  v_adults integer;
  v_children integer;
  v_reason text;
  v_remark text;
  v_base numeric(12,2);
  v_max integer;
  v_ext_ref text;
  v_changes jsonb := '{}'::jsonb;
BEGIN
  IF p_tenant_id IS NULL OR p_reservation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH101', MESSAGE='tenant_required';
  END IF;
  IF p_actor_n3_user_key IS NULL OR length(btrim(p_actor_n3_user_key))=0 THEN
    RAISE EXCEPTION USING ERRCODE='HH102', MESSAGE='creator_required';
  END IF;
  IF p_arrival_date IS NULL OR p_departure_date IS NULL OR p_departure_date <= p_arrival_date THEN
    RAISE EXCEPTION USING ERRCODE='HH103', MESSAGE='invalid_stay_dates';
  END IF;

  SELECT * INTO v_row FROM public.hotel_reservations
    WHERE id = p_reservation_id AND tenant_id = p_tenant_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='HH104', MESSAGE='not_found';
  END IF;
  IF v_row.status <> 'confirmed' THEN
    RAISE EXCEPTION USING ERRCODE='HH105', MESSAGE='reservation_not_editable';
  END IF;
  IF p_expected_updated_at IS NULL OR v_row.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION USING ERRCODE='HH106', MESSAGE='stale_reservation';
  END IF;

  SELECT bs.is_active INTO v_source_active
    FROM public.hotel_booking_sources bs
    WHERE bs.tenant_id = p_tenant_id AND bs.source_code = p_booking_source;
  IF v_source_active IS NULL OR NOT v_source_active THEN
    RAISE EXCEPTION USING ERRCODE='HH107', MESSAGE='invalid_booking_source';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.hotel_reservation_rooms
    WHERE reservation_id = p_reservation_id AND allocation_status <> 'reserved'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='HH108', MESSAGE='reservation_not_editable';
  END IF;

  v_ext_ref := NULLIF(btrim(COALESCE(p_external_booking_reference,'')), '');
  IF v_ext_ref IS NOT NULL AND length(v_ext_ref) > 100 THEN
    v_ext_ref := substring(v_ext_ref for 100);
  END IF;

  UPDATE public.hotel_reservations
     SET booking_source = p_booking_source,
         arrival_date = p_arrival_date,
         departure_date = p_departure_date,
         notes = NULLIF(btrim(COALESCE(p_notes,'')), ''),
         external_booking_reference = v_ext_ref
   WHERE id = p_reservation_id AND tenant_id = p_tenant_id;

  IF p_rooms IS NOT NULL AND jsonb_array_length(p_rooms) > 0 THEN
    FOR v_room IN SELECT * FROM jsonb_array_elements(p_rooms) LOOP
      v_room_id := (v_room->>'id')::uuid;
      v_agreed := (v_room->>'agreed_rate')::numeric;
      v_adults := (v_room->>'adults')::integer;
      v_children := COALESCE((v_room->>'children')::integer, 0);
      v_reason := NULLIF(btrim(COALESCE(v_room->>'rate_override_reason','')),'');
      v_remark := NULLIF(btrim(COALESCE(v_room->>'remark','')),'');
      IF v_remark IS NOT NULL AND length(v_remark) > 500 THEN
        RAISE EXCEPTION USING ERRCODE='HH109', MESSAGE='room_remark_too_long';
      END IF;

      SELECT rr.base_rate_snapshot, hr.max_occupancy
        INTO v_base, v_max
        FROM public.hotel_reservation_rooms rr
        JOIN public.hotel_rooms hr ON hr.id = rr.hotel_room_id
       WHERE rr.id = v_room_id
         AND rr.reservation_id = p_reservation_id
         AND rr.tenant_id = p_tenant_id
       FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE='HH110', MESSAGE='room_not_found';
      END IF;
      IF v_adults IS NULL OR v_adults < 1 OR v_children < 0 THEN
        RAISE EXCEPTION USING ERRCODE='HH111', MESSAGE='invalid_occupancy';
      END IF;
      IF v_adults + v_children > v_max THEN
        RAISE EXCEPTION USING ERRCODE='HH112', MESSAGE='occupancy_exceeded';
      END IF;
      IF v_agreed IS NULL OR v_agreed < 0 THEN
        RAISE EXCEPTION USING ERRCODE='HH113', MESSAGE='invalid_rate';
      END IF;
      IF v_agreed <> v_base AND v_reason IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='HH114', MESSAGE='rate_override_reason_required';
      END IF;

      UPDATE public.hotel_reservation_rooms
         SET agreed_rate = v_agreed,
             adults = v_adults,
             children = v_children,
             rate_override_reason = CASE WHEN v_agreed <> v_base THEN v_reason ELSE NULL END,
             remark = v_remark,
             arrival_date = p_arrival_date,
             departure_date = p_departure_date
       WHERE id = v_room_id AND reservation_id = p_reservation_id AND tenant_id = p_tenant_id;
    END LOOP;
  ELSE
    UPDATE public.hotel_reservation_rooms
       SET arrival_date = p_arrival_date, departure_date = p_departure_date
     WHERE reservation_id = p_reservation_id AND tenant_id = p_tenant_id;
  END IF;

  v_changes := jsonb_build_object(
    'reservationId', p_reservation_id,
    'arrival', p_arrival_date,
    'departure', p_departure_date,
    'source', p_booking_source,
    'roomCount', COALESCE(jsonb_array_length(p_rooms), 0)
  );
  INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
  VALUES (p_tenant_id, p_actor_n3_user_key, 'hotel.reservation.updated', v_changes);

  SELECT r.updated_at INTO out_updated_at FROM public.hotel_reservations r WHERE r.id = p_reservation_id;
  out_reservation_id := p_reservation_id;
  RETURN NEXT;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.hotelhub_update_reservation_v2(p_tenant_id uuid, p_reservation_id uuid, p_actor_n3_user_key text, p_actor_role text, p_client_request_id uuid, p_fingerprint text, p_expected_updated_at timestamp with time zone, p_booking_source text, p_arrival_date date, p_departure_date date, p_notes text, p_external_booking_reference text, p_rooms jsonb, p_guests jsonb, p_correction_reason text)
 RETURNS TABLE(out_reservation_id uuid, out_updated_at timestamp with time zone, out_replayed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_res public.hotel_reservations%ROWTYPE;
  v_ledger public.hotel_mutation_requests%ROWTYPE;
  v_policy text;
  v_allow_primary boolean;
  v_mode text;
  v_source_active boolean;
  v_ext_ref text;
  v_reason text;
  v_room jsonb;
  v_guest jsonb;
  v_key text;
  v_rr_id uuid;
  v_hotel_room_id uuid;
  v_agreed numeric(12,2);
  v_adults integer;
  v_children integer;
  v_reason_room text;
  v_remark text;
  v_base numeric(12,2);
  v_max integer;
  v_active boolean;
  v_keymap jsonb := '{}'::jsonb;
  v_capmap jsonb := '{}'::jsonb;
  v_keep_rooms uuid[] := ARRAY[]::uuid[];
  v_keep_guests uuid[] := ARRAY[]::uuid[];
  v_seen text[] := ARRAY[]::text[];
  v_seen_uuid uuid[] := ARRAY[]::uuid[];
  v_primary_count integer := 0;
  v_guest_id uuid;
  v_link_id uuid;
  v_assigned_room uuid;
  v_identity_action text;
  v_identity_type text;
  v_identity_number text;
  v_prev_primary uuid;
  v_shared integer;
  v_new_guest_id uuid;
  v_added_rooms integer := 0;
  v_removed_rooms integer := 0;
  v_added_guests integer := 0;
  v_removed_guests integer := 0;
  v_identity_replaced integer := 0;
  v_identity_cleared integer := 0;
  v_primary_changed boolean := false;
  v_over integer;
  v_conflict integer;
BEGIN
  IF p_tenant_id IS NULL OR p_reservation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH300', MESSAGE='reservation_not_found';
  END IF;
  IF p_actor_n3_user_key IS NULL OR length(btrim(p_actor_n3_user_key)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH301', MESSAGE='unauthorized';
  END IF;
  IF p_actor_role IS NULL OR p_actor_role NOT IN ('owner','front_desk') THEN
    RAISE EXCEPTION USING ERRCODE='HH302', MESSAGE='unauthorized';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='HH303', MESSAGE='invalid_request';
  END IF;

  SELECT * INTO v_ledger FROM public.hotel_mutation_requests
    WHERE tenant_id = p_tenant_id AND scope = 'reservation_update'
      AND client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_ledger.reservation_id IS DISTINCT FROM p_reservation_id
       OR v_ledger.fingerprint IS DISTINCT FROM p_fingerprint THEN
      RAISE EXCEPTION USING ERRCODE='HH304', MESSAGE='idempotency_conflict';
    END IF;
    SELECT * INTO v_res FROM public.hotel_reservations
      WHERE id = p_reservation_id AND tenant_id = p_tenant_id;
    RETURN QUERY SELECT p_reservation_id, v_res.updated_at, true;
    RETURN;
  END IF;

  SELECT * INTO v_res FROM public.hotel_reservations
    WHERE id = p_reservation_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='HH305', MESSAGE='reservation_not_found';
  END IF;
  IF p_expected_updated_at IS NULL OR v_res.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION USING ERRCODE='HH306', MESSAGE='stale_reservation';
  END IF;

  SELECT s.post_check_in_guest_edit_policy,
         COALESCE(s.allow_owner_primary_guest_change_after_check_in, false)
    INTO v_policy, v_allow_primary
    FROM public.hotel_settings s WHERE s.tenant_id = p_tenant_id;
  IF v_policy IS NULL OR v_policy NOT IN ('locked','contact_only') THEN
    v_policy := 'locked';
  END IF;
  v_allow_primary := COALESCE(v_allow_primary, false);

  IF v_res.status = 'confirmed' THEN
    IF EXISTS (SELECT 1 FROM public.hotel_reservation_rooms
                WHERE reservation_id = p_reservation_id AND allocation_status <> 'reserved') THEN
      RAISE EXCEPTION USING ERRCODE='HH307', MESSAGE='reservation_not_editable';
    END IF;
    v_mode := 'full';
  ELSIF v_res.status = 'checked_in' THEN
    IF p_actor_role = 'owner' THEN
      v_mode := 'owner_correction';
    ELSIF v_policy = 'contact_only' THEN
      v_mode := 'contact';
    ELSE
      RAISE EXCEPTION USING ERRCODE='HH308', MESSAGE='guest_edit_locked';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE='HH309', MESSAGE='reservation_not_editable';
  END IF;

  v_reason := NULLIF(btrim(COALESCE(p_correction_reason,'')), '');
  IF v_mode = 'owner_correction' THEN
    IF v_reason IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='HH310', MESSAGE='correction_reason_required';
    END IF;
    IF length(v_reason) > 300 THEN
      RAISE EXCEPTION USING ERRCODE='HH311', MESSAGE='correction_reason_too_long';
    END IF;
  END IF;

  IF v_mode <> 'full' THEN
    IF p_arrival_date IS DISTINCT FROM v_res.arrival_date
       OR p_departure_date IS DISTINCT FROM v_res.departure_date
       OR p_booking_source IS DISTINCT FROM v_res.booking_source THEN
      RAISE EXCEPTION USING ERRCODE='HH312', MESSAGE='reservation_not_editable';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_rooms,'[]'::jsonb)) r
      WHERE (r->>'reservation_room_id') IS NULL
    ) THEN
      RAISE EXCEPTION USING ERRCODE='HH313', MESSAGE='reservation_not_editable';
    END IF;
    IF (SELECT count(*) FROM jsonb_array_elements(COALESCE(p_rooms,'[]'::jsonb)))
       <> (SELECT count(*) FROM public.hotel_reservation_rooms
            WHERE reservation_id = p_reservation_id AND tenant_id = p_tenant_id) THEN
      RAISE EXCEPTION USING ERRCODE='HH314', MESSAGE='reservation_not_editable';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_rooms,'[]'::jsonb)) r
      JOIN public.hotel_reservation_rooms rr
        ON rr.id = (r->>'reservation_room_id')::uuid
      WHERE rr.reservation_id = p_reservation_id
        AND ( rr.agreed_rate <> (r->>'agreed_rate')::numeric
           OR rr.adults <> (r->>'adults')::integer
           OR rr.children <> COALESCE((r->>'children')::integer,0) )
    ) THEN
      RAISE EXCEPTION USING ERRCODE='HH315', MESSAGE='reservation_not_editable';
    END IF;
  END IF;

  IF v_mode = 'full' THEN
    IF p_arrival_date IS NULL OR p_departure_date IS NULL
       OR p_departure_date <= p_arrival_date THEN
      RAISE EXCEPTION USING ERRCODE='HH316', MESSAGE='invalid_stay_dates';
    END IF;

    SELECT bs.is_active INTO v_source_active
      FROM public.hotel_booking_sources bs
     WHERE bs.tenant_id = p_tenant_id AND bs.source_code = p_booking_source;
    IF v_source_active IS NULL OR NOT v_source_active THEN
      IF p_booking_source IS DISTINCT FROM v_res.booking_source THEN
        RAISE EXCEPTION USING ERRCODE='HH317', MESSAGE='invalid_booking_source';
      END IF;
    END IF;

    IF p_rooms IS NULL OR jsonb_array_length(p_rooms) = 0 THEN
      RAISE EXCEPTION USING ERRCODE='HH318', MESSAGE='room_required';
    END IF;

    v_ext_ref := NULLIF(btrim(COALESCE(p_external_booking_reference,'')), '');
    IF v_ext_ref IS NOT NULL AND length(v_ext_ref) > 100 THEN
      RAISE EXCEPTION USING ERRCODE='HH319', MESSAGE='external_ref_too_long';
    END IF;

    UPDATE public.hotel_reservations
       SET booking_source = p_booking_source,
           arrival_date = p_arrival_date,
           departure_date = p_departure_date,
           notes = NULLIF(btrim(COALESCE(p_notes,'')), ''),
           external_booking_reference = v_ext_ref
     WHERE id = p_reservation_id AND tenant_id = p_tenant_id;

    FOR v_room IN SELECT * FROM jsonb_array_elements(p_rooms) LOOP
      v_key := v_room->>'client_key';
      IF v_key IS NULL OR length(btrim(v_key)) = 0 THEN
        RAISE EXCEPTION USING ERRCODE='HH320', MESSAGE='invalid_room';
      END IF;
      IF v_key = ANY(v_seen) THEN
        RAISE EXCEPTION USING ERRCODE='HH321', MESSAGE='duplicate_client_key';
      END IF;
      v_seen := array_append(v_seen, v_key);

      v_rr_id := NULLIF(v_room->>'reservation_room_id','')::uuid;
      v_hotel_room_id := NULLIF(v_room->>'hotel_room_id','')::uuid;
      v_agreed := (v_room->>'agreed_rate')::numeric;
      v_adults := (v_room->>'adults')::integer;
      v_children := COALESCE((v_room->>'children')::integer, 0);
      v_reason_room := NULLIF(btrim(COALESCE(v_room->>'rate_override_reason','')),'');
      v_remark := NULLIF(btrim(COALESCE(v_room->>'remark','')),'');
      IF v_remark IS NOT NULL AND length(v_remark) > 500 THEN
        RAISE EXCEPTION USING ERRCODE='HH322', MESSAGE='room_remark_too_long';
      END IF;
      IF v_hotel_room_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='HH323', MESSAGE='room_not_found';
      END IF;
      IF v_hotel_room_id = ANY(v_seen_uuid) THEN
        RAISE EXCEPTION USING ERRCODE='HH324', MESSAGE='duplicate_room';
      END IF;
      v_seen_uuid := array_append(v_seen_uuid, v_hotel_room_id);

      SELECT hr.base_rate, hr.max_occupancy, hr.is_active
        INTO v_base, v_max, v_active
        FROM public.hotel_rooms hr
       WHERE hr.id = v_hotel_room_id AND hr.tenant_id = p_tenant_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE='HH325', MESSAGE='room_not_found';
      END IF;

      IF v_adults IS NULL OR v_adults < 1 OR v_children < 0 THEN
        RAISE EXCEPTION USING ERRCODE='HH326', MESSAGE='invalid_occupancy';
      END IF;
      IF v_adults + v_children > v_max THEN
        RAISE EXCEPTION USING ERRCODE='HH327', MESSAGE='room_capacity_exceeded';
      END IF;
      IF v_agreed IS NULL OR v_agreed < 0 THEN
        RAISE EXCEPTION USING ERRCODE='HH328', MESSAGE='invalid_rate';
      END IF;

      IF v_rr_id IS NOT NULL THEN
        SELECT rr.base_rate_snapshot INTO v_base
          FROM public.hotel_reservation_rooms rr
         WHERE rr.id = v_rr_id AND rr.reservation_id = p_reservation_id
           AND rr.tenant_id = p_tenant_id AND rr.hotel_room_id = v_hotel_room_id
         FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION USING ERRCODE='HH329', MESSAGE='room_not_found';
        END IF;
        IF v_agreed <> v_base AND v_reason_room IS NULL THEN
          RAISE EXCEPTION USING ERRCODE='HH330', MESSAGE='rate_override_reason_required';
        END IF;
        UPDATE public.hotel_reservation_rooms
           SET agreed_rate = v_agreed,
               adults = v_adults,
               children = v_children,
               rate_override_reason = CASE WHEN v_agreed <> v_base THEN v_reason_room ELSE NULL END,
               remark = v_remark,
               arrival_date = p_arrival_date,
               departure_date = p_departure_date
         WHERE id = v_rr_id;
      ELSE
        IF NOT v_active THEN
          RAISE EXCEPTION USING ERRCODE='HH331', MESSAGE='room_unavailable';
        END IF;
        IF v_agreed <> v_base AND v_reason_room IS NULL THEN
          RAISE EXCEPTION USING ERRCODE='HH332', MESSAGE='rate_override_reason_required';
        END IF;
        INSERT INTO public.hotel_reservation_rooms
          (tenant_id, reservation_id, hotel_room_id, arrival_date, departure_date,
           base_rate_snapshot, agreed_rate, adults, children, allocation_status,
           rate_override_reason, remark)
        VALUES (p_tenant_id, p_reservation_id, v_hotel_room_id, p_arrival_date, p_departure_date,
                v_base, v_agreed, v_adults, v_children, 'reserved',
                CASE WHEN v_agreed <> v_base THEN v_reason_room ELSE NULL END, v_remark)
        RETURNING id INTO v_rr_id;
        v_added_rooms := v_added_rooms + 1;
      END IF;

      v_keep_rooms := array_append(v_keep_rooms, v_rr_id);
      v_keymap := v_keymap || jsonb_build_object(v_key, v_rr_id::text);
      v_capmap := v_capmap || jsonb_build_object(v_rr_id::text, v_max);
    END LOOP;

    SELECT count(*) INTO v_removed_rooms FROM public.hotel_reservation_rooms
      WHERE reservation_id = p_reservation_id AND tenant_id = p_tenant_id
        AND NOT (id = ANY(v_keep_rooms));
    UPDATE public.hotel_reservation_guests SET reservation_room_id = NULL
      WHERE reservation_id = p_reservation_id AND tenant_id = p_tenant_id
        AND reservation_room_id IS NOT NULL
        AND NOT (reservation_room_id = ANY(v_keep_rooms));
    DELETE FROM public.hotel_reservation_rooms
      WHERE reservation_id = p_reservation_id AND tenant_id = p_tenant_id
        AND NOT (id = ANY(v_keep_rooms));

    SELECT count(*) INTO v_conflict
      FROM public.hotel_reservation_rooms mine
      JOIN public.hotel_reservation_rooms other
        ON other.tenant_id = mine.tenant_id
       AND other.hotel_room_id = mine.hotel_room_id
       AND other.reservation_id <> mine.reservation_id
       AND other.allocation_status IN ('reserved','occupied')
       AND other.stay_range && mine.stay_range
     WHERE mine.reservation_id = p_reservation_id AND mine.tenant_id = p_tenant_id
       AND mine.allocation_status IN ('reserved','occupied');
    IF v_conflict > 0 THEN
      RAISE EXCEPTION USING ERRCODE='HH333', MESSAGE='room_unavailable';
    END IF;
  ELSE
    FOR v_room IN SELECT * FROM jsonb_array_elements(COALESCE(p_rooms,'[]'::jsonb)) LOOP
      v_key := v_room->>'client_key';
      v_rr_id := NULLIF(v_room->>'reservation_room_id','')::uuid;
      SELECT hr.max_occupancy INTO v_max
        FROM public.hotel_reservation_rooms rr
        JOIN public.hotel_rooms hr ON hr.id = rr.hotel_room_id
       WHERE rr.id = v_rr_id AND rr.reservation_id = p_reservation_id
         AND rr.tenant_id = p_tenant_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE='HH334', MESSAGE='room_not_found';
      END IF;
      v_keymap := v_keymap || jsonb_build_object(v_key, v_rr_id::text);
      v_capmap := v_capmap || jsonb_build_object(v_rr_id::text, v_max);
      v_keep_rooms := array_append(v_keep_rooms, v_rr_id);
    END LOOP;
  END IF;

  IF p_guests IS NULL OR jsonb_array_length(p_guests) = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH340', MESSAGE='guest_required';
  END IF;

  SELECT g.id INTO v_prev_primary FROM public.hotel_reservation_guests g
    WHERE g.reservation_id = p_reservation_id AND g.tenant_id = p_tenant_id AND g.is_primary;

  v_seen := ARRAY[]::text[];
  v_seen_uuid := ARRAY[]::uuid[];

  UPDATE public.hotel_reservation_guests SET is_primary = false
    WHERE reservation_id = p_reservation_id AND tenant_id = p_tenant_id;

  FOR v_guest IN SELECT * FROM jsonb_array_elements(p_guests) LOOP
    v_key := v_guest->>'client_key';
    IF v_key IS NULL OR length(btrim(v_key)) = 0 THEN
      RAISE EXCEPTION USING ERRCODE='HH341', MESSAGE='invalid_guest';
    END IF;
    IF v_key = ANY(v_seen) THEN
      RAISE EXCEPTION USING ERRCODE='HH342', MESSAGE='duplicate_client_key';
    END IF;
    v_seen := array_append(v_seen, v_key);

    v_link_id := NULLIF(v_guest->>'reservation_guest_id','')::uuid;
    IF v_link_id IS NOT NULL THEN
      IF v_link_id = ANY(v_seen_uuid) THEN
        RAISE EXCEPTION USING ERRCODE='HH343', MESSAGE='duplicate_guest';
      END IF;
      v_seen_uuid := array_append(v_seen_uuid, v_link_id);
    END IF;

    IF length(btrim(COALESCE(v_guest->>'full_name',''))) = 0 THEN
      RAISE EXCEPTION USING ERRCODE='HH344', MESSAGE='invalid_guest';
    END IF;

    v_assigned_room := NULL;
    IF (v_guest->>'assigned_room_client_key') IS NOT NULL
       AND length(btrim(v_guest->>'assigned_room_client_key')) > 0 THEN
      IF NOT (v_keymap ? (v_guest->>'assigned_room_client_key')) THEN
        RAISE EXCEPTION USING ERRCODE='HH345', MESSAGE='guest_assignment_required';
      END IF;
      v_assigned_room := (v_keymap->>(v_guest->>'assigned_room_client_key'))::uuid;
    END IF;
    IF v_assigned_room IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='HH346', MESSAGE='guest_assignment_required';
    END IF;

    v_identity_action := COALESCE(v_guest->>'identity_action', 'keep');
    IF v_identity_action NOT IN ('keep','clear','replace') THEN
      RAISE EXCEPTION USING ERRCODE='HH347', MESSAGE='invalid_identity_action';
    END IF;
    v_identity_type := NULLIF(btrim(COALESCE(v_guest->>'identity_type','')),'');
    v_identity_number := NULLIF(btrim(COALESCE(v_guest->>'identity_number','')),'');
    IF v_identity_action = 'replace' THEN
      IF v_identity_type IS NULL OR v_identity_number IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='HH348', MESSAGE='identity_pair_required';
      END IF;
      IF v_identity_type NOT IN ('mykad','mypr','passport','other') THEN
        RAISE EXCEPTION USING ERRCODE='HH349', MESSAGE='invalid_identity_type';
      END IF;
    END IF;

    IF v_link_id IS NOT NULL THEN
      SELECT g.guest_id INTO v_guest_id FROM public.hotel_reservation_guests g
        WHERE g.id = v_link_id AND g.reservation_id = p_reservation_id
          AND g.tenant_id = p_tenant_id
        FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE='HH350', MESSAGE='guest_not_found';
      END IF;

      SELECT count(*) INTO v_shared FROM public.hotel_reservation_guests
        WHERE guest_id = v_guest_id AND tenant_id = p_tenant_id;
      IF v_shared > 1 THEN
        INSERT INTO public.hotel_guests
          (tenant_id, full_name, mobile, email, nationality, notes, identity_type,
           identity_number, nationality_code, address_line_1, address_line_2,
           address_line_3, city, postcode, country_code, state_code, state_province)
        SELECT tenant_id, full_name, mobile, email, nationality, notes, identity_type,
               identity_number, nationality_code, address_line_1, address_line_2,
               address_line_3, city, postcode, country_code, state_code, state_province
          FROM public.hotel_guests WHERE id = v_guest_id
        RETURNING id INTO v_new_guest_id;
        UPDATE public.hotel_reservation_guests SET guest_id = v_new_guest_id
          WHERE id = v_link_id;
        v_guest_id := v_new_guest_id;
      END IF;

      IF v_mode = 'contact' THEN
        UPDATE public.hotel_guests SET
          mobile = NULLIF(btrim(COALESCE(v_guest->>'mobile','')),''),
          email = NULLIF(btrim(COALESCE(v_guest->>'email','')),''),
          notes = NULLIF(btrim(COALESCE(v_guest->>'notes','')),''),
          address_line_1 = NULLIF(btrim(COALESCE(v_guest->>'address_line_1','')),''),
          address_line_2 = NULLIF(btrim(COALESCE(v_guest->>'address_line_2','')),''),
          address_line_3 = NULLIF(btrim(COALESCE(v_guest->>'address_line_3','')),''),
          city = NULLIF(btrim(COALESCE(v_guest->>'city','')),''),
          postcode = NULLIF(btrim(COALESCE(v_guest->>'postcode','')),''),
          country_code = NULLIF(btrim(COALESCE(v_guest->>'country_code','')),''),
          state_code = NULLIF(btrim(COALESCE(v_guest->>'state_code','')),''),
          state_province = NULLIF(btrim(COALESCE(v_guest->>'state_province','')),'')
        WHERE id = v_guest_id AND tenant_id = p_tenant_id;
      ELSE
        UPDATE public.hotel_guests SET
          full_name = btrim(v_guest->>'full_name'),
          mobile = NULLIF(btrim(COALESCE(v_guest->>'mobile','')),''),
          email = NULLIF(btrim(COALESCE(v_guest->>'email','')),''),
          notes = NULLIF(btrim(COALESCE(v_guest->>'notes','')),''),
          nationality_code = NULLIF(btrim(COALESCE(v_guest->>'nationality_code','')),''),
          address_line_1 = NULLIF(btrim(COALESCE(v_guest->>'address_line_1','')),''),
          address_line_2 = NULLIF(btrim(COALESCE(v_guest->>'address_line_2','')),''),
          address_line_3 = NULLIF(btrim(COALESCE(v_guest->>'address_line_3','')),''),
          city = NULLIF(btrim(COALESCE(v_guest->>'city','')),''),
          postcode = NULLIF(btrim(COALESCE(v_guest->>'postcode','')),''),
          country_code = NULLIF(btrim(COALESCE(v_guest->>'country_code','')),''),
          state_code = NULLIF(btrim(COALESCE(v_guest->>'state_code','')),''),
          state_province = NULLIF(btrim(COALESCE(v_guest->>'state_province','')),'')
        WHERE id = v_guest_id AND tenant_id = p_tenant_id;

        IF v_identity_action = 'clear' THEN
          UPDATE public.hotel_guests SET identity_type = NULL, identity_number = NULL
            WHERE id = v_guest_id AND tenant_id = p_tenant_id;
          v_identity_cleared := v_identity_cleared + 1;
        ELSIF v_identity_action = 'replace' THEN
          UPDATE public.hotel_guests
             SET identity_type = v_identity_type, identity_number = v_identity_number
           WHERE id = v_guest_id AND tenant_id = p_tenant_id;
          v_identity_replaced := v_identity_replaced + 1;
        END IF;
      END IF;
    ELSE
      IF v_mode = 'contact' THEN
        RAISE EXCEPTION USING ERRCODE='HH351', MESSAGE='guest_edit_locked';
      END IF;
      IF v_identity_action = 'clear' THEN
        RAISE EXCEPTION USING ERRCODE='HH352', MESSAGE='invalid_identity_action';
      END IF;
      INSERT INTO public.hotel_guests
        (tenant_id, full_name, mobile, email, notes, identity_type, identity_number,
         nationality_code, address_line_1, address_line_2, address_line_3, city,
         postcode, country_code, state_code, state_province)
      VALUES (
        p_tenant_id,
        btrim(v_guest->>'full_name'),
        NULLIF(btrim(COALESCE(v_guest->>'mobile','')),''),
        NULLIF(btrim(COALESCE(v_guest->>'email','')),''),
        NULLIF(btrim(COALESCE(v_guest->>'notes','')),''),
        CASE WHEN v_identity_action = 'replace' THEN v_identity_type ELSE NULL END,
        CASE WHEN v_identity_action = 'replace' THEN v_identity_number ELSE NULL END,
        NULLIF(btrim(COALESCE(v_guest->>'nationality_code','')),''),
        NULLIF(btrim(COALESCE(v_guest->>'address_line_1','')),''),
        NULLIF(btrim(COALESCE(v_guest->>'address_line_2','')),''),
        NULLIF(btrim(COALESCE(v_guest->>'address_line_3','')),''),
        NULLIF(btrim(COALESCE(v_guest->>'city','')),''),
        NULLIF(btrim(COALESCE(v_guest->>'postcode','')),''),
        NULLIF(btrim(COALESCE(v_guest->>'country_code','')),''),
        NULLIF(btrim(COALESCE(v_guest->>'state_code','')),''),
        NULLIF(btrim(COALESCE(v_guest->>'state_province','')),'')
      ) RETURNING id INTO v_guest_id;

      INSERT INTO public.hotel_reservation_guests
        (tenant_id, reservation_id, guest_id, is_primary, reservation_room_id)
      VALUES (p_tenant_id, p_reservation_id, v_guest_id, false, NULL)
      RETURNING id INTO v_link_id;
      v_added_guests := v_added_guests + 1;
    END IF;

    IF v_mode = 'contact' THEN
      IF EXISTS (SELECT 1 FROM public.hotel_reservation_guests
                  WHERE id = v_link_id AND reservation_room_id IS DISTINCT FROM v_assigned_room) THEN
        RAISE EXCEPTION USING ERRCODE='HH353', MESSAGE='guest_edit_locked';
      END IF;
    ELSE
      UPDATE public.hotel_reservation_guests
         SET reservation_room_id = v_assigned_room
       WHERE id = v_link_id AND tenant_id = p_tenant_id;
    END IF;

    IF COALESCE((v_guest->>'is_primary')::boolean, false) THEN
      v_primary_count := v_primary_count + 1;
      IF v_link_id IS DISTINCT FROM v_prev_primary THEN
        IF v_mode = 'contact' THEN
          RAISE EXCEPTION USING ERRCODE='HH354', MESSAGE='guest_edit_locked';
        END IF;
        IF v_mode = 'owner_correction' AND NOT v_allow_primary THEN
          RAISE EXCEPTION USING ERRCODE='HH355', MESSAGE='primary_guest_change_not_allowed';
        END IF;
        v_primary_changed := true;
      END IF;
      UPDATE public.hotel_reservation_guests SET is_primary = true
        WHERE id = v_link_id AND tenant_id = p_tenant_id;
    END IF;

    v_keep_guests := array_append(v_keep_guests, v_link_id);
  END LOOP;

  IF v_primary_count = 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH356', MESSAGE='primary_guest_required';
  END IF;
  IF v_primary_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE='HH357', MESSAGE='multiple_primary_guests';
  END IF;

  SELECT count(*) INTO v_removed_guests FROM public.hotel_reservation_guests
    WHERE reservation_id = p_reservation_id AND tenant_id = p_tenant_id
      AND NOT (id = ANY(v_keep_guests));
  IF v_removed_guests > 0 AND v_mode = 'contact' THEN
    RAISE EXCEPTION USING ERRCODE='HH358', MESSAGE='guest_edit_locked';
  END IF;
  DELETE FROM public.hotel_reservation_guests
    WHERE reservation_id = p_reservation_id AND tenant_id = p_tenant_id
      AND NOT (id = ANY(v_keep_guests));

  SELECT count(*) INTO v_over FROM (
    SELECT g.reservation_room_id AS rid, count(*) AS n
      FROM public.hotel_reservation_guests g
     WHERE g.reservation_id = p_reservation_id AND g.tenant_id = p_tenant_id
       AND g.reservation_room_id IS NOT NULL
     GROUP BY g.reservation_room_id
  ) t
  JOIN public.hotel_reservation_rooms rr ON rr.id = t.rid
  JOIN public.hotel_rooms hr ON hr.id = rr.hotel_room_id
  WHERE t.n > hr.max_occupancy;
  IF v_over > 0 THEN
    RAISE EXCEPTION USING ERRCODE='HH359', MESSAGE='room_capacity_exceeded';
  END IF;

  UPDATE public.hotel_reservations SET updated_at = now()
    WHERE id = p_reservation_id AND tenant_id = p_tenant_id
    RETURNING updated_at INTO out_updated_at;

  INSERT INTO public.hotel_reservation_events
    (tenant_id, reservation_id, event_type, summary, actor_n3_user_key, metadata)
  VALUES (p_tenant_id, p_reservation_id, 'reservation_edited',
          CASE WHEN v_mode = 'full' THEN 'Reservation details updated'
               WHEN v_mode = 'contact' THEN 'Guest contact details updated'
               ELSE 'Owner guest correction applied' END,
          p_actor_n3_user_key,
          jsonb_build_object(
            'mode', v_mode,
            'afterCheckIn', (v_mode <> 'full'),
            'roomsAdded', v_added_rooms,
            'roomsRemoved', v_removed_rooms,
            'guestsAdded', v_added_guests,
            'guestsRemoved', v_removed_guests,
            'identityReplaced', v_identity_replaced,
            'identityCleared', v_identity_cleared,
            'primaryGuestChanged', v_primary_changed,
            'correctionReason', v_reason
          ));

  INSERT INTO public.hotel_audit_events (tenant_id, n3_user_key, event_type, detail)
  VALUES (p_tenant_id, p_actor_n3_user_key,
          CASE WHEN v_mode = 'full' THEN 'hotel.reservation.updated'
               ELSE 'hotel.reservation.guest_correction' END,
          jsonb_build_object(
            'bookingReference', v_res.booking_reference,
            'mode', v_mode,
            'roomsAdded', v_added_rooms,
            'roomsRemoved', v_removed_rooms,
            'guestsAdded', v_added_guests,
            'guestsRemoved', v_removed_guests,
            'identityReplaced', v_identity_replaced,
            'identityCleared', v_identity_cleared,
            'primaryGuestChanged', v_primary_changed));

  INSERT INTO public.hotel_mutation_requests
    (tenant_id, client_request_id, scope, reservation_id, fingerprint, result)
  VALUES (p_tenant_id, p_client_request_id, 'reservation_update', p_reservation_id,
          p_fingerprint, jsonb_build_object('updatedAt', out_updated_at));

  out_reservation_id := p_reservation_id;
  out_replayed := false;
  RETURN NEXT;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION USING ERRCODE='HH360', MESSAGE='room_unavailable';
END;
$function$
;


CREATE TRIGGER hotel_booking_sequences_touch_updated_at BEFORE UPDATE ON public.hotel_booking_sequences FOR EACH ROW EXECUTE FUNCTION hotelhub_touch_updated_at();

CREATE TRIGGER hotel_booking_sources_code_immutable BEFORE UPDATE ON public.hotel_booking_sources FOR EACH ROW EXECUTE FUNCTION hotelhub_booking_source_code_immutable();

CREATE TRIGGER hotel_booking_sources_touch_updated_at BEFORE UPDATE ON public.hotel_booking_sources FOR EACH ROW EXECUTE FUNCTION hotelhub_touch_updated_at();

CREATE TRIGGER hotel_folio_lines_room_night_immutable BEFORE UPDATE ON public.hotel_folio_lines FOR EACH ROW EXECUTE FUNCTION hotelhub_folio_room_night_immutable();

CREATE TRIGGER hotel_guests_touch_updated_at BEFORE UPDATE ON public.hotel_guests FOR EACH ROW EXECUTE FUNCTION hotelhub_touch_updated_at();

CREATE TRIGGER hotel_hk_handoffs_touch BEFORE UPDATE ON public.hotel_housekeeping_handoffs FOR EACH ROW EXECUTE FUNCTION hotelhub_hk_touch_updated_at();

CREATE TRIGGER hotel_receipt_control_decisions_guard BEFORE DELETE OR UPDATE ON public.hotel_receipt_control_decisions FOR EACH ROW EXECUTE FUNCTION hotelhub_receipt_control_guard();

CREATE TRIGGER hotel_receipt_control_requests_guard BEFORE DELETE OR UPDATE ON public.hotel_receipt_control_requests FOR EACH ROW EXECUTE FUNCTION hotelhub_receipt_control_guard();

CREATE TRIGGER hotel_receipt_versions_guard BEFORE DELETE OR UPDATE ON public.hotel_receipt_versions FOR EACH ROW EXECUTE FUNCTION hotelhub_receipt_control_guard();

CREATE TRIGGER hotel_reservation_deposits_immutable BEFORE UPDATE ON public.hotel_reservation_deposits FOR EACH ROW EXECUTE FUNCTION hotelhub_deposit_immutable_fields();

CREATE TRIGGER hotel_reservation_deposits_touch_updated_at BEFORE UPDATE ON public.hotel_reservation_deposits FOR EACH ROW EXECUTE FUNCTION hotelhub_touch_updated_at();

CREATE TRIGGER hotel_reservation_events_no_update BEFORE DELETE OR UPDATE ON public.hotel_reservation_events FOR EACH ROW EXECUTE FUNCTION hotelhub_reservation_events_append_only();

CREATE TRIGGER hotel_reservation_operation_requests_immutable BEFORE UPDATE ON public.hotel_reservation_operation_requests FOR EACH ROW EXECUTE FUNCTION hotelhub_operation_request_immutable();

CREATE TRIGGER hotel_reservation_operation_requests_touch_updated_at BEFORE UPDATE ON public.hotel_reservation_operation_requests FOR EACH ROW EXECUTE FUNCTION hotelhub_touch_updated_at();

CREATE TRIGGER hotel_reservation_rooms_touch_updated_at BEFORE UPDATE ON public.hotel_reservation_rooms FOR EACH ROW EXECUTE FUNCTION hotelhub_touch_updated_at();

CREATE TRIGGER hotel_reservations_touch_updated_at BEFORE UPDATE ON public.hotel_reservations FOR EACH ROW EXECUTE FUNCTION hotelhub_touch_updated_at();

CREATE TRIGGER hotel_rooms_touch_updated_at BEFORE UPDATE ON public.hotel_rooms FOR EACH ROW EXECUTE FUNCTION hotelhub_touch_updated_at();

CREATE TRIGGER hotel_settings_touch_updated_at BEFORE UPDATE ON public.hotel_settings FOR EACH ROW EXECUTE FUNCTION hotelhub_touch_updated_at();

CREATE TRIGGER hotel_tenants_seed_booking_sources AFTER INSERT ON public.hotel_tenants FOR EACH ROW EXECUTE FUNCTION hotelhub_seed_booking_sources();

CREATE TRIGGER hotel_tenants_touch BEFORE UPDATE ON public.hotel_tenants FOR EACH ROW EXECUTE FUNCTION hotelhub_touch_updated_at();

CREATE TRIGGER hotel_user_directory_touch_updated_at BEFORE UPDATE ON public.hotel_user_directory FOR EACH ROW EXECUTE FUNCTION hotelhub_touch_updated_at();

CREATE TRIGGER hotel_user_roles_touch BEFORE UPDATE ON public.hotel_user_roles FOR EACH ROW EXECUTE FUNCTION hotelhub_touch_updated_at();

CREATE TABLE public.hh_settlement_test_marker (identity text PRIMARY KEY); INSERT INTO public.hh_settlement_test_marker VALUES ('hh_settlement_test');
