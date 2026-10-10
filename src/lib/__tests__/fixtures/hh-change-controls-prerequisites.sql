-- Test-only minimum parent schema; never applied to Cloud.
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE TABLE public.hotel_tenants(id uuid PRIMARY KEY);
CREATE TABLE public.hotel_reservations(tenant_id uuid NOT NULL, id uuid PRIMARY KEY, status text NOT NULL, booking_reference text NOT NULL DEFAULT 'BK-TEST', UNIQUE(tenant_id,id));
CREATE TABLE public.hotel_reservation_deposits(tenant_id uuid NOT NULL,id uuid PRIMARY KEY,reservation_id uuid NOT NULL,status text NOT NULL DEFAULT 'posted',n3_receipt_id uuid);
CREATE TABLE public.hotel_guests(tenant_id uuid NOT NULL,id uuid PRIMARY KEY,full_name text,mobile text,email text,address_line_1 text,address_line_2 text,address_line_3 text,postcode text,city text,state_province text,state_code text,country_code text);
CREATE TABLE public.hotel_reservation_guests(tenant_id uuid,reservation_id uuid,guest_id uuid,is_primary boolean);
CREATE TABLE public.hotel_audit_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,n3_user_key text,event_type text NOT NULL,detail jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO hotel_tenants VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
INSERT INTO hotel_reservations(tenant_id,id,status) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','44444444-4444-4444-8444-444444444444','checked_in');
INSERT INTO hotel_reservation_deposits VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444','posted',NULL);
INSERT INTO hotel_guests(tenant_id,id,full_name,mobile,email) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','77777777-7777-4777-8777-777777777777','Original','0100000000','old@example.test');
INSERT INTO hotel_reservation_guests VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','44444444-4444-4444-8444-444444444444','77777777-7777-4777-8777-777777777777',true);
