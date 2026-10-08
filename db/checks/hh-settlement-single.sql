-- Every assertion uses executed SQL, not a source-text check.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM hh_settlement_test_marker WHERE identity='hh_settlement_test') THEN RAISE EXCEPTION 'disposable_test_required'; END IF; END $$;
CREATE FUNCTION public.hh_assert(p_ok boolean,p_name text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',p_name; END IF; RAISE NOTICE 'PASS %',p_name; END $$;
CREATE FUNCTION public.hh_reject(p_sql text,p_code text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE msg text; BEGIN BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT; END;
PERFORM hh_assert(msg=p_code,p_code||': '||coalesce(msg,'write unexpectedly succeeded')); END $$;
CREATE FUNCTION public.hh_snapshot(p_res uuid DEFAULT 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') RETURNS jsonb LANGUAGE sql AS $$
SELECT jsonb_build_object('tenantId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','reservationId',p_res,'folioId',(SELECT id FROM hotel_folios WHERE reservation_id=p_res),'digest',repeat('d',64),'revision','0','currency','MYR','totalCents',50000,'billDate','2026-10-08','sourceVersions',public.hotelhub_settlement_sources('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',p_res),'receipts','[]'::jsonb) $$;
DO $$ BEGIN
 PERFORM hh_reject($q$ SELECT hotelhub_settlement_freeze('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','synthetic-owner',hh_snapshot()-'totalCents',gen_random_uuid()) $q$,'settlement_snapshot_changed');
 PERFORM hh_reject($q$ SELECT hotelhub_settlement_freeze('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','synthetic-owner',hh_snapshot()||'{"totalCents":50001}',gen_random_uuid()) $q$,'settlement_snapshot_changed');
END $$;
DO $$ DECLARE i jsonb; c jsonb; winners integer:=0; rev text; BEGIN
 i:=hotelhub_settlement_freeze('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','synthetic-owner',hh_snapshot(),'33333333-3333-4333-8333-333333333333');
 PERFORM hh_assert(i IS NOT NULL AND i->>'state'='frozen','freeze creates immutable intent');
 PERFORM hh_assert(hotelhub_settlement_freeze('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','synthetic-owner',hh_snapshot(),'33333333-3333-4333-8333-333333333333')=i,'same key/digest replays');
 PERFORM hh_reject($q$ SELECT hotelhub_settlement_freeze('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','synthetic-owner',hh_snapshot()||jsonb_build_object('digest',repeat('a',64)),'33333333-3333-4333-8333-333333333333') $q$,'settlement_conflicting_request');
 PERFORM hh_reject($q$ UPDATE hotel_reservations SET notes='changed' WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' $q$,'settlement_locked');
 PERFORM hh_reject($q$ UPDATE hotel_folio_lines SET quantity=2 WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' $q$,'settlement_locked');
 PERFORM hh_reject($q$ UPDATE hotel_folio_bill_to SET name='changed' WHERE reservation_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' $q$,'settlement_locked');
 PERFORM hh_reject($q$ UPDATE hotel_reservation_tax_profile SET evidence_note='changed' WHERE reservation_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' $q$,'settlement_locked');
 PERFORM hh_assert((SELECT quantity=1 FROM hotel_folio_lines WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'),'locked writes roll back');
 PERFORM hh_reject(format($q$ SELECT hotelhub_settlement_claim('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','synthetic-owner',%L::uuid,%L,'bill',NULL,repeat('a',64),jsonb_build_object('kind','bill','snapshotDigest',repeat('d',64),'payload','{"synthetic":true}'::jsonb)) $q$,i->>'id',i->>'revision'),'settlement_invalid_dispatch_facts');
 FOR n IN 1..20 LOOP c:=hotelhub_settlement_claim('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','synthetic-owner',(i->>'id')::uuid,i->>'revision','bill',NULL,'a8198524f58e72b56283ab71ebddada22840f108b46ef7165bb3fca9919c5558',jsonb_build_object('kind','bill','snapshotDigest',repeat('d',64),'payload','{"synthetic":true}'::jsonb)); IF c IS NOT NULL THEN winners:=winners+1; END IF; END LOOP;
 PERFORM hh_assert(winners=1,'one claim in 20 sequential calls (NOT concurrency proof)');
 PERFORM hh_assert(hotelhub_settlement_read('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')->'dispatches'->0->'facts' IS NOT NULL,'dispatch recovery facts survive a new read');
 rev:=(SELECT revision::text FROM hotel_settlement_intents WHERE id=(i->>'id')::uuid);
 PERFORM hh_reject(format($q$ SELECT hotelhub_settlement_outcome('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','synthetic-owner',%L::uuid,'0',%L::uuid,%L,'{"kind":"unknown","code":"timeout"}') $q$,i->>'id',(SELECT id FROM hotel_settlement_attempts WHERE intent_id=(i->>'id')::uuid),'a8198524f58e72b56283ab71ebddada22840f108b46ef7165bb3fca9919c5558'),'settlement_stale_revision');
 PERFORM hh_reject(format($q$ SELECT hotelhub_settlement_abandon('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','synthetic-owner',%L::uuid,%L) $q$,i->>'id',rev),'settlement_dispatched');
 PERFORM hh_assert(NOT has_table_privilege('anon','hotel_settlement_intents','SELECT') AND NOT has_table_privilege('authenticated','hotel_settlement_intents','SELECT'),'browser tables denied');
 PERFORM hh_assert(NOT has_function_privilege('anon','hotelhub_settlement_read(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','hotelhub_settlement_read(uuid,uuid)','EXECUTE'),'browser functions denied');
 END $$;
DO $$ DECLARE msg text; state text; i jsonb; c jsonb; a uuid; BEGIN
 -- Cross-tenant composite FK must reject even privileged direct SQL.
 BEGIN INSERT INTO hotel_settlement_attempts(tenant_id,reservation_id,intent_id,kind,claimed_revision,payload_digest,dispatch_facts,actor_n3_user_key) SELECT '99999999-9999-4999-8999-999999999999',reservation_id,id,'balance_receipt',1,repeat('a',64),'{}'::jsonb,'synthetic-owner' FROM hotel_settlement_intents; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE; END;
 PERFORM hh_assert(state='23503','cross_tenant_fk_denied');
 PERFORM hh_reject($q$ UPDATE hotel_reservation_deposits SET last_error_code='changed' WHERE id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' $q$,'settlement_locked');
 PERFORM hh_reject($q$ UPDATE hotel_settlement_intents SET snapshot='{}' $q$,'settlement_immutable');
 PERFORM hh_reject($q$ DELETE FROM hotel_settlement_attempts $q$,'settlement_immutable');
 PERFORM hh_reject($q$ DELETE FROM hotel_settlement_events $q$,'settlement_immutable');
 i:=hotelhub_settlement_read('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 a:=(SELECT id FROM hotel_settlement_attempts WHERE intent_id=(i->>'id')::uuid);
 i:=hotelhub_settlement_outcome('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','synthetic-owner',(i->>'id')::uuid,i->>'revision',a,'a8198524f58e72b56283ab71ebddada22840f108b46ef7165bb3fca9919c5558','{"kind":"unknown","code":"timeout"}');
 PERFORM hh_assert(i->>'state'='needs_review','unknown stays frozen');
 c:=hotelhub_settlement_claim('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','synthetic-owner',(i->>'id')::uuid,i->>'revision','bill',NULL,'a8198524f58e72b56283ab71ebddada22840f108b46ef7165bb3fca9919c5558',jsonb_build_object('kind','bill','snapshotDigest',repeat('d',64),'payload','{"synthetic":true}'::jsonb));
 PERFORM hh_assert(c IS NULL,'expired_lease_never_redispatches (no lease reset exists)');
 PERFORM hh_assert(hotelhub_settlement_read('99999999-9999-4999-8999-999999999999','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') IS NULL,'cross tenant read empty');
END $$;
DO $$ BEGIN
 INSERT INTO hotel_reservation_deposits(id,tenant_id,reservation_id,amount,currency_code,idempotency_key,n3_reference_no,status,created_by_n3_user_key) VALUES ('44444444-4444-4444-8444-444444444444','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','88888888-8888-4888-8888-888888888888',50,'MYR','synthetic-pending','SYNTHETIC-PENDING','submitting','synthetic-owner');
 PERFORM hh_reject($q$ SELECT hotelhub_settlement_freeze('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','88888888-8888-4888-8888-888888888888','synthetic-owner',hh_snapshot('88888888-8888-4888-8888-888888888888'),gen_random_uuid()) $q$,'settlement_pending_financial_operation');
 UPDATE hotel_reservation_deposits SET status='unknown' WHERE id='44444444-4444-4444-8444-444444444444';
 PERFORM hh_reject($q$ SELECT hotelhub_settlement_freeze('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','88888888-8888-4888-8888-888888888888','synthetic-owner',hh_snapshot('88888888-8888-4888-8888-888888888888'),gen_random_uuid()) $q$,'settlement_pending_financial_operation');
 UPDATE hotel_reservation_deposits SET status='failed' WHERE id='44444444-4444-4444-8444-444444444444';
 INSERT INTO hotel_receipt_control_requests(id,tenant_id,reservation_id,deposit_id,client_request_id,request_fingerprint,kind,reason,original,proposal,comparison,original_amount_cents,proposed_amount_cents,requested_by_n3_user_key) VALUES ('22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','88888888-8888-4888-8888-888888888888','44444444-4444-4444-8444-444444444444',gen_random_uuid(),repeat('b',64),'correction','Synthetic reason','{}','{}','{}',5000,6000,'synthetic-owner');
 PERFORM hh_reject($q$ SELECT hotelhub_settlement_freeze('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','88888888-8888-4888-8888-888888888888','synthetic-owner',hh_snapshot('88888888-8888-4888-8888-888888888888'),gen_random_uuid()) $q$,'settlement_pending_financial_operation');
 UPDATE hotel_receipt_control_requests SET state='rejected' WHERE id='22222222-2222-4222-8222-222222222222';
 INSERT INTO hotel_receipt_control_executions(tenant_id,request_id,step,claimed_by_n3_user_key,claimed_version) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','verify','synthetic-owner',1);
 PERFORM hh_reject($q$ SELECT hotelhub_settlement_freeze('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','88888888-8888-4888-8888-888888888888','synthetic-owner',hh_snapshot('88888888-8888-4888-8888-888888888888'),gen_random_uuid()) $q$,'settlement_pending_financial_operation');
 PERFORM hh_assert(NOT EXISTS(SELECT 1 FROM hotel_settlement_intents WHERE reservation_id='88888888-8888-4888-8888-888888888888'),'pending deposit or receipt execution refuses freeze');
END $$;

DO $$ BEGIN
 PERFORM hh_reject($q$ SELECT * FROM hotelhub_add_folio_line(p_tenant_id => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',p_reservation_id => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',p_operation => NULL,p_line_type => NULL,p_catalogue_id => NULL,p_tax_class => NULL,p_description => NULL,p_quantity => NULL,p_unit_price_cents => NULL,p_subtotal_cents => NULL,p_tax_cents => NULL,p_total_cents => NULL,p_tax_snapshot => NULL,p_reason => NULL,p_client_request_id => NULL,p_actor_n3_user_key => NULL,p_request_fingerprint => NULL) $q$,'settlement_locked');
 PERFORM hh_reject($q$ SELECT * FROM hotelhub_decide_operation(p_tenant_id => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',p_request_id => '55555555-5555-4555-8555-555555555555',p_actor_n3_user_key => NULL,p_decision => NULL,p_note => NULL,p_idempotency_key => NULL) $q$,'settlement_locked');
 PERFORM hh_reject($q$ SELECT * FROM hotelhub_direct_operation_v2(p_tenant_id => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',p_reservation_id => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',p_actor_n3_user_key => NULL,p_operation_type => NULL,p_payload => NULL,p_idempotency_key => NULL) $q$,'settlement_locked');
 PERFORM hh_reject($q$ SELECT * FROM hotelhub_receipt_control_verify_atomic(p_tenant_id => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',p_request_id => '66666666-6666-4666-8666-666666666666',p_expected_version => NULL,p_actor => NULL,p_to_state => NULL,p_outcome_code => NULL,p_version => NULL) $q$,'settlement_locked');
 PERFORM hh_reject($q$ SELECT * FROM hotelhub_reverse_folio_line(p_tenant_id => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',p_reservation_id => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',p_line_id => NULL,p_reason => NULL,p_client_request_id => NULL,p_actor_n3_user_key => NULL,p_request_fingerprint => NULL) $q$,'settlement_locked');
 PERFORM hh_reject($q$ SELECT * FROM hotelhub_update_folio_line_quantity(p_tenant_id => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',p_reservation_id => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',p_line_id => NULL,p_expected_version => NULL,p_quantity => NULL,p_subtotal_cents => NULL,p_tax_cents => NULL,p_total_cents => NULL,p_client_request_id => NULL,p_actor_n3_user_key => NULL,p_request_fingerprint => NULL) $q$,'settlement_locked');
 PERFORM hh_reject($q$ SELECT * FROM hotelhub_update_reservation_v2(p_tenant_id => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',p_reservation_id => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',p_actor_n3_user_key => NULL,p_actor_role => NULL,p_client_request_id => NULL,p_fingerprint => NULL,p_expected_updated_at => NULL,p_booking_source => NULL,p_arrival_date => NULL,p_departure_date => NULL,p_notes => NULL,p_external_booking_reference => NULL,p_rooms => NULL,p_guests => NULL,p_correction_reason => NULL) $q$,'settlement_locked');
END $$;
