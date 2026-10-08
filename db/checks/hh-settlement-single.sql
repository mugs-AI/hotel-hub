-- Every assertion uses executed SQL, not a source-text check.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM hh_settlement_test_marker WHERE identity='hh_settlement_test') THEN RAISE EXCEPTION 'disposable_test_required'; END IF; END $$;
CREATE FUNCTION public.hh_assert(p_ok boolean,p_name text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',p_name; END IF; RAISE NOTICE 'PASS %',p_name; END $$;
CREATE FUNCTION public.hh_reject(p_sql text,p_code text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE msg text; BEGIN BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT; END;
PERFORM hh_assert(msg=p_code,p_code||': '||coalesce(msg,'write unexpectedly succeeded')); END $$;
CREATE FUNCTION public.hh_snapshot(p_res uuid DEFAULT 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') RETURNS jsonb LANGUAGE sql AS $$
SELECT jsonb_build_object('tenantId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','reservationId',p_res,'folioId',(SELECT id FROM hotel_folios WHERE reservation_id=p_res),'digest',repeat('d',64),'revision','0','currency','MYR','currencyId',1,'currencyRate',1,'customerId',7,'propertyTimezone','Asia/Kuala_Lumpur','totalCents',50000,'billDate','2026-10-08','sourceVersions',public.hotelhub_settlement_sources('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',p_res),'receipts','[]'::jsonb) $$;
CREATE FUNCTION public.hh_sign_proof(p jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT (p-'digest')||jsonb_build_object('digest',encode(sha256(convert_to(public.hotelhub_settlement_payload_json(p-'digest'),'UTF8')),'hex')) $$;
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

-- Task7: a dispatch acknowledgement is never a financial verification.
DO $$ DECLARE i jsonb; c jsonb; p jsonb; result jsonb; res uuid:='10101010-1010-4010-8010-101010101010'; bill uuid:='12121212-1212-4212-8212-121212121212'; BEGIN
 INSERT INTO hotel_reservations(id,tenant_id,booking_reference,booking_source,status,arrival_date,departure_date,currency,created_by_n3_user_key) VALUES(res,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SYNTHETIC-PROGRESS','walk_in','checked_in','2026-10-07','2026-10-09','MYR','synthetic-owner');
 INSERT INTO hotel_folios(id,tenant_id,reservation_id,status) VALUES('13131313-1313-4313-8313-131313131313','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res,'prepared');
 INSERT INTO hotel_folio_lines(tenant_id,folio_id,line_type,description_snapshot,unit_price_cents,subtotal_cents,total_cents,actor_n3_user_key) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','13131313-1313-4313-8313-131313131313','add_on','Synthetic proof charge',50000,50000,50000,'synthetic-owner');
 INSERT INTO hotel_rooms(id,tenant_id,n3_stock_id,n3_stock_code,room_number) VALUES('15151515-1515-4515-8515-151515151515','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','151','SYNTHETIC-151','SYNTHETIC-151'),('16161616-1616-4616-8616-161616161616','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','161','SYNTHETIC-161','SYNTHETIC-161');
 INSERT INTO hotel_reservation_rooms(tenant_id,reservation_id,hotel_room_id,arrival_date,departure_date,base_rate_snapshot,agreed_rate,adults,allocation_status) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res,'15151515-1515-4515-8515-151515151515','2026-10-07','2026-10-09',250,250,1,'occupied'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res,'16161616-1616-4616-8616-161616161616','2026-10-07','2026-10-09',250,250,1,'occupied');
 INSERT INTO hotel_room_housekeeping(tenant_id,hotel_room_id,condition,dnd_active,initialized_by_n3_user_key) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','15151515-1515-4515-8515-151515151515','ready',true,'synthetic-owner'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','16161616-1616-4616-8616-161616161616','ready',true,'synthetic-owner');
 i:=hotelhub_settlement_freeze('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res,'synthetic-owner',hh_snapshot(res),gen_random_uuid());
 c:=hotelhub_settlement_claim('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res,'synthetic-owner',(i->>'id')::uuid,i->>'revision','bill',NULL,encode(sha256(convert_to('{"synthetic":true}','UTF8')),'hex'),jsonb_build_object('kind','bill','snapshotDigest',repeat('d',64),'payload','{"synthetic":true}'::jsonb));
 i:=hotelhub_settlement_outcome('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res,'synthetic-owner',(i->>'id')::uuid,c->>'expectedRevision',(c->>'attemptId')::uuid,c->>'payloadDigest',jsonb_build_object('kind','unknown','code','timeout'));
 PERFORM hh_assert(i->>'state'='needs_review','unknown bill cannot advance without bound evidence');
 p:=jsonb_build_object('kind','bill','tenantId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','reservationId',res,'intentId',i->>'id','snapshotDigest',repeat('d',64),'checkedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'receipt',NULL,'bill',jsonb_build_object('id',bill,'intentId',i->>'id','targetId',bill,'targetType','INV','totalCents',50000,'outstandingCents',50000,'documentDate','2026-10-08','code','CS-SYNTHETIC-PROGRESS','fingerprints',jsonb_build_array(repeat('a',64),repeat('b',64))));
 p:=p||jsonb_build_object('digest',encode(sha256(convert_to(public.hotelhub_settlement_payload_json(p),'UTF8')),'hex'));
 PERFORM hh_reject(format($q$ SELECT hotelhub_settlement_prove('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',%L::uuid,'synthetic-owner',%L::uuid,%L,%L::jsonb) $q$,res,i->>'id',i->>'revision',hh_sign_proof(jsonb_set(p,'{checkedAt}',to_jsonb(to_char((clock_timestamp()-interval '61 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))))),'settlement_expired_proof');
 PERFORM hh_reject(format($q$ SELECT hotelhub_settlement_prove('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',%L::uuid,'synthetic-owner',%L::uuid,%L,%L::jsonb) $q$,res,i->>'id',i->>'revision',hh_sign_proof(jsonb_set(p,'{bill,totalCents}','50001'))),'settlement_untrusted_proof');
 PERFORM hh_reject(format($q$ SELECT hotelhub_settlement_prove('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',%L::uuid,'synthetic-owner',%L::uuid,%L,%L::jsonb) $q$,res,i->>'id',i->>'revision',hh_sign_proof(p||'{"n3Token":"synthetic-secret"}'::jsonb)),'settlement_untrusted_proof');
 PERFORM hh_assert((SELECT count(*) FROM hotel_settlement_evidence WHERE intent_id=(i->>'id')::uuid)=0,'invalid progress cannot persist evidence');
 result:=hotelhub_settlement_prove('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res,'synthetic-owner',(i->>'id')::uuid,i->>'revision',p);
 PERFORM hh_assert(result->>'state'='bill_verified','only accounting proof resolves unknown bill');
 PERFORM hh_assert((SELECT count(*) FROM hotel_settlement_evidence WHERE intent_id=(i->>'id')::uuid)=1,'progress evidence is append-only');
 PERFORM hh_assert(hotelhub_settlement_prove('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res,'synthetic-owner',(i->>'id')::uuid,i->>'revision',p)=result,'same progress digest replays without extra event');
END $$;
DO $$ DECLARE i jsonb; c jsonb; p jsonb; wire jsonb; facts jsonb; r jsonb; res uuid:='10101010-1010-4010-8010-101010101010'; receipt uuid:='14141414-1414-4414-8414-141414141414'; BEGIN
 i:=hotelhub_settlement_read('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res);
 wire:=jsonb_build_object('docType','AROR','docDate','2026-10-09','customerId',7,'currencyId',1,'currencyRate',1,'accountId','11111111-1111-4111-8111-111111111111','totalAmount',500,'referenceNo','HH-B-'||replace(i->>'id','-',''),'description','Synthetic settlement balance');
 facts:=jsonb_build_object('kind','balance_receipt','snapshotDigest',repeat('d',64),'payload',wire,'input',jsonb_build_object('customerId',7,'currencyId',1,'currencyRate',1,'amountCents',50000,'accountId','11111111-1111-4111-8111-111111111111','docDate','2026-10-09','contact','{}'::jsonb),'account',jsonb_build_object('id','11111111-1111-4111-8111-111111111111','code','SYNTHETIC-BANK','name','Synthetic bank'));
 c:=hotelhub_settlement_claim('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res,'synthetic-owner',(i->>'id')::uuid,i->>'revision','balance_receipt',NULL,encode(sha256(convert_to(public.hotelhub_settlement_payload_json(wire),'UTF8')),'hex'),facts);
 i:=hotelhub_settlement_outcome('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res,'synthetic-owner',(i->>'id')::uuid,c->>'expectedRevision',(c->>'attemptId')::uuid,c->>'payloadDigest',jsonb_build_object('kind','unknown','code','timeout'));
 r:=jsonb_build_object('receiptId',receipt,'code','OR-SYNTHETIC-BALANCE','reference',wire->>'referenceNo','documentDate','2026-10-09','purpose','settlement','customerId',7,'currency','MYR','amountCents',50000,'refundCents',0,'remainderCents',50000,'payments',jsonb_build_array(jsonb_build_object('accountId','11111111-1111-4111-8111-111111111111','accountCode','SYNTHETIC-BANK','accountName','Synthetic bank','amountCents',50000)),'allocations','[]'::jsonb,'fingerprints',jsonb_build_array(repeat('a',64),repeat('b',64)));
 p:=(SELECT proof FROM hotel_settlement_evidence WHERE intent_id=(i->>'id')::uuid ORDER BY created_at DESC,id DESC LIMIT 1);
 p:=hh_sign_proof(p||jsonb_build_object('kind','balance_receipt','receipt',r,'checkedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
 i:=hotelhub_settlement_prove('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res,'synthetic-owner',(i->>'id')::uuid,i->>'revision',p);
 PERFORM hh_assert(i->>'state'='balance_dispatched','proven balance receipt recovers unknown create without repost');
 PERFORM hh_assert(NOT EXISTS(SELECT 1 FROM hotel_reservation_deposits WHERE reservation_id=res),'settlement balance is never inserted as a deposit');
END $$;
-- Task7 recovery: persisted allocation facts, not an acknowledgement, authorize progress.
DO $$ DECLARE i jsonb; c jsonb; p jsonb; r jsonb; wire jsonb; facts jsonb; before_state jsonb; expected_state jsonb; bill uuid:='12121212-1212-4212-8212-121212121212'; res uuid:='10101010-1010-4010-8010-101010101010'; receipt uuid:='14141414-1414-4414-8414-141414141414'; BEGIN
 i:=hotelhub_settlement_read('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res);
 p:=(SELECT proof FROM hotel_settlement_evidence WHERE intent_id=(i->>'id')::uuid AND proof->>'kind'='balance_receipt' LIMIT 1);
 r:=p->'receipt';
 before_state:=jsonb_build_object('receipt',jsonb_build_object('receiptId',receipt,'reservationId',res),'code',r->>'code','amountCents',50000,'refundCents',0,'remainderCents',50000,'allocations','[]'::jsonb,'fingerprints',r->'fingerprints','immutableHeaderFingerprint',repeat('c',64));
 wire:=jsonb_build_array(jsonb_build_object('customerId',7,'receiptDocType','OR','receiptDocId',receipt,'docType','INV','docId',bill,'paymentAmount',500));
 expected_state:=jsonb_build_object('receiptId',receipt,'amountCents',50000,'refundCents',0,'remainderCents',0,'allocations',jsonb_build_array(jsonb_build_object('docType','INV','docId',bill,'amountCents',50000)));
 facts:=jsonb_build_object('kind','balance_allocation','snapshotDigest',repeat('d',64),'payload',wire,'billId',bill,'receipt',jsonb_build_object('receiptId',receipt,'reservationId',res),'before',before_state,'expectedTotalToBillCents',50000,'expectedAfterFingerprint',encode(sha256(convert_to(public.hotelhub_settlement_payload_json(expected_state),'UTF8')),'hex'));
 c:=hotelhub_settlement_claim('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res,'synthetic-owner',(i->>'id')::uuid,i->>'revision','balance_allocation',receipt,encode(sha256(convert_to(public.hotelhub_settlement_payload_json(wire),'UTF8')),'hex'),facts);
 i:=hotelhub_settlement_outcome('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res,'synthetic-owner',(i->>'id')::uuid,c->>'expectedRevision',(c->>'attemptId')::uuid,c->>'payloadDigest',jsonb_build_object('kind','unknown','code','timeout'));
 r:=r||jsonb_build_object('remainderCents',0,'allocations',expected_state->'allocations','allocatedToBillCents',50000,'beforeFingerprints',before_state->'fingerprints','immutableHeaderFingerprint',repeat('c',64));
 p:=hh_sign_proof(p||jsonb_build_object('kind','allocation','receipt',r,'bill',p->'bill'||'{"outstandingCents":0}'::jsonb,'checkedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
 i:=hotelhub_settlement_prove('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res,'synthetic-owner',(i->>'id')::uuid,i->>'revision',p);
 PERFORM hh_assert(i->>'state'='allocating','allocation proof resolves unknown without a second POST');
 PERFORM hh_reject(format($q$ SELECT hotelhub_settlement_prove('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',%L::uuid,'synthetic-owner',%L::uuid,%L,%L::jsonb) $q$,res,i->>'id',i->>'revision',hh_sign_proof(jsonb_set(p,'{receipt,refundCents}','1'))),'settlement_untrusted_proof');
 PERFORM hh_reject(format($q$ SELECT hotelhub_settlement_prove('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',%L::uuid,'synthetic-owner',%L::uuid,%L,%L::jsonb) $q$,res,i->>'id',i->>'revision',hh_sign_proof(jsonb_set(p,'{receipt,immutableHeaderFingerprint}',to_jsonb(repeat('e',64))))),'settlement_untrusted_proof');
 p:=hh_sign_proof(p||jsonb_build_object('kind','settlement','receipts',jsonb_build_array(r),'receipt',NULL));
 i:=hotelhub_settlement_prove('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res,'synthetic-owner',(i->>'id')::uuid,i->>'revision',p);
 PERFORM hh_assert(i->>'state'='settled','full conservation proof settles without a financial retry');
 PERFORM hh_assert((SELECT count(*) FROM hotel_settlement_attempts WHERE intent_id=(i->>'id')::uuid)=3,'bill balance and allocation each retain exactly one attempt');
END $$;
DO $$ DECLARE i jsonb; p jsonb; BEGIN
 i:=hotelhub_settlement_read('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10101010-1010-4010-8010-101010101010');
 p:=(SELECT proof FROM hotel_settlement_evidence WHERE intent_id=(i->>'id')::uuid AND proof->>'kind'='settlement' LIMIT 1);
 p:=hh_sign_proof(p||jsonb_build_object('checkedAt',to_char((clock_timestamp()+interval '1 second') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
 i:=hotelhub_settlement_prove('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10101010-1010-4010-8010-101010101010','synthetic-owner',(i->>'id')::uuid,i->>'revision',p);
 PERFORM hh_assert(i->>'state'='settled','GET-only proof refresh supports an expired local close retry');
END $$;
-- A proof of an older allocation cannot clear a later unresolved attempt.
DO $$ DECLARE i jsonb; c jsonb; p jsonb; r jsonb; snap jsonb; wire jsonb; facts jsonb; before_state jsonb; expected_state jsonb; res uuid:=gen_random_uuid(); folio uuid:=gen_random_uuid(); bill uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); BEGIN
 INSERT INTO hotel_reservations(id,tenant_id,booking_reference,booking_source,status,arrival_date,departure_date,currency,created_by_n3_user_key) VALUES(res,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SYNTHETIC-FENCE-'||res,'walk_in','checked_in','2026-10-07','2026-10-09','MYR','synthetic-owner');
 INSERT INTO hotel_folios(id,tenant_id,reservation_id,status) VALUES(folio,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res,'prepared');
 INSERT INTO hotel_folio_lines(tenant_id,folio_id,line_type,description_snapshot,unit_price_cents,subtotal_cents,total_cents,actor_n3_user_key) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',folio,'add_on','Synthetic proof fence',50000,50000,50000,'synthetic-owner');
 snap:=hh_snapshot(res)||jsonb_build_object('receipts',jsonb_build_array(jsonb_build_object('receiptId',a,'reservationId',res,'reference','SYNTHETIC-A','receiptDate','2026-10-08','payments','[]'::jsonb),jsonb_build_object('receiptId',b,'reservationId',res,'reference','SYNTHETIC-B','receiptDate','2026-10-08','payments','[]'::jsonb)));
 i:=hotelhub_settlement_freeze('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res,'synthetic-owner',snap,gen_random_uuid());
 wire:='{"synthetic":true}';
 c:=hotelhub_settlement_claim('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res,'synthetic-owner',(i->>'id')::uuid,i->>'revision','bill',NULL,encode(sha256(convert_to(public.hotelhub_settlement_payload_json(wire),'UTF8')),'hex'),jsonb_build_object('kind','bill','snapshotDigest',repeat('d',64),'payload',wire));
 i:=hotelhub_settlement_read('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res);
 p:=hh_sign_proof(jsonb_build_object('kind','bill','tenantId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','reservationId',res,'intentId',i->>'id','snapshotDigest',repeat('d',64),'checkedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'receipt',NULL,'bill',jsonb_build_object('id',bill,'intentId',i->>'id','targetId',bill,'targetType','INV','totalCents',50000,'outstandingCents',50000,'documentDate','2026-10-08','code','CS-SYNTHETIC-FENCE','fingerprints',jsonb_build_array(repeat('a',64),repeat('b',64)))));
 i:=hotelhub_settlement_prove('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res,'synthetic-owner',(i->>'id')::uuid,i->>'revision',p);
 FOR n IN 1..2 LOOP
  r:=snap->'receipts'->(n-1);
  before_state:=jsonb_build_object('receipt',r,'code','OR-SYNTHETIC-FENCE','amountCents',5000,'refundCents',0,'remainderCents',5000,'allocations','[]'::jsonb,'fingerprints',jsonb_build_array(repeat('a',64),repeat('b',64)),'immutableHeaderFingerprint',repeat('c',64));
  wire:=jsonb_build_array(jsonb_build_object('customerId',7,'receiptDocType','OR','receiptDocId',r->>'receiptId','docType','INV','docId',bill,'paymentAmount',50));
  expected_state:=jsonb_build_object('receiptId',r->>'receiptId','amountCents',5000,'refundCents',0,'remainderCents',0,'allocations',jsonb_build_array(jsonb_build_object('docType','INV','docId',bill,'amountCents',5000)));
  facts:=jsonb_build_object('kind','deposit_allocation','snapshotDigest',repeat('d',64),'payload',wire,'billId',bill,'receipt',r,'before',before_state,'expectedTotalToBillCents',5000,'expectedAfterFingerprint',encode(sha256(convert_to(public.hotelhub_settlement_payload_json(expected_state),'UTF8')),'hex'));
  c:=hotelhub_settlement_claim('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res,'synthetic-owner',(i->>'id')::uuid,i->>'revision','deposit_allocation',(r->>'receiptId')::uuid,encode(sha256(convert_to(public.hotelhub_settlement_payload_json(wire),'UTF8')),'hex'),facts);
  i:=hotelhub_settlement_read('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res);
  IF n=1 THEN
   r:=r||jsonb_build_object('code','OR-SYNTHETIC-FENCE','documentDate','2026-10-08','purpose','deposit','customerId',7,'currency','MYR','amountCents',5000,'refundCents',0,'remainderCents',0,'allocations',expected_state->'allocations','fingerprints',before_state->'fingerprints','allocatedToBillCents',5000,'beforeFingerprints',before_state->'fingerprints','immutableHeaderFingerprint',repeat('c',64));
   p:=hh_sign_proof(p||jsonb_build_object('kind','allocation','receipt',r,'bill',p->'bill'||'{"outstandingCents":45000}'::jsonb));
   i:=hotelhub_settlement_prove('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res,'synthetic-owner',(i->>'id')::uuid,i->>'revision',p);
  END IF;
 END LOOP;
 p:=hh_sign_proof(p||jsonb_build_object('checkedAt',to_char((clock_timestamp()+interval '1 second') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
 i:=hotelhub_settlement_prove('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res,'synthetic-owner',(i->>'id')::uuid,i->>'revision',p);
 wire:='{"synthetic":true}';
 facts:=jsonb_build_object('kind','balance_receipt','snapshotDigest',repeat('d',64),'payload',wire);
 PERFORM hh_reject(format($q$ SELECT hotelhub_settlement_claim('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',%L::uuid,'synthetic-owner',%L::uuid,%L,'balance_receipt',NULL,%L,%L::jsonb) $q$,res,i->>'id',i->>'revision',encode(sha256(convert_to(public.hotelhub_settlement_payload_json(wire),'UTF8')),'hex'),facts),'settlement_invalid_state');
 PERFORM hh_assert((SELECT count(*) FROM hotel_settlement_attempts WHERE intent_id=(i->>'id')::uuid)=3,'unresolved later allocation fences every subsequent write');
END $$;
CREATE FUNCTION public.hh_fail_room_two() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.hotel_room_id='16161616-1616-4616-8616-161616161616' AND NEW.condition='dirty' THEN RAISE EXCEPTION 'synthetic_room_two_failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER zz_fail_room_two BEFORE UPDATE ON hotel_room_housekeeping FOR EACH ROW EXECUTE FUNCTION hh_fail_room_two();
DO $$ DECLARE i jsonb; digest text; result jsonb; expired jsonb; scope_error text; BEGIN
 i:=hotelhub_settlement_read('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10101010-1010-4010-8010-101010101010');
 digest:=(SELECT proof_digest FROM hotel_settlement_evidence WHERE intent_id=(i->>'id')::uuid AND proof->>'kind'='settlement' ORDER BY (proof->>'checkedAt')::timestamptz DESC,id DESC LIMIT 1);
 PERFORM hh_reject(format($q$ SELECT hotelhub_settlement_close('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10101010-1010-4010-8010-101010101010','synthetic-owner',%L::uuid,%L,%L) $q$,i->>'id','0',digest),'settlement_stale_revision');
 PERFORM hh_reject(format($q$ SELECT hotelhub_settlement_close('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10101010-1010-4010-8010-101010101010','synthetic-owner',%L::uuid,%L,%L) $q$,i->>'id',i->>'revision',repeat('e',64)),'settlement_untrusted_proof');
 expired:=hh_sign_proof((SELECT proof FROM hotel_settlement_evidence WHERE proof_digest=digest AND intent_id=(i->>'id')::uuid)||jsonb_build_object('checkedAt',to_char((clock_timestamp()-interval '61 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
 INSERT INTO hotel_settlement_evidence(tenant_id,reservation_id,intent_id,proof_digest,proof) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10101010-1010-4010-8010-101010101010',(i->>'id')::uuid,expired->>'digest',expired);
 PERFORM hh_reject(format($q$ SELECT hotelhub_settlement_close('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10101010-1010-4010-8010-101010101010','synthetic-owner',%L::uuid,%L,%L) $q$,i->>'id',i->>'revision',expired->>'digest'),'settlement_expired_proof');
 BEGIN UPDATE hotel_rooms SET tenant_id='99999999-9999-4999-8999-999999999999' WHERE id='16161616-1616-4616-8616-161616161616'; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS scope_error=RETURNED_SQLSTATE; END;
 PERFORM hh_assert(scope_error='23503','alien room reparenting rejected by scoped FK');
 INSERT INTO hotel_reservation_rooms(tenant_id,reservation_id,hotel_room_id,arrival_date,departure_date,base_rate_snapshot,agreed_rate,adults,allocation_status) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','88888888-8888-4888-8888-888888888888','16161616-1616-4616-8616-161616161616','2026-10-10','2026-10-11',250,250,1,'occupied');
 PERFORM hh_reject(format($q$ SELECT hotelhub_settlement_close('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10101010-1010-4010-8010-101010101010','synthetic-owner',%L::uuid,%L,%L) $q$,i->>'id',i->>'revision',digest),'settlement_room_scope_mismatch');
 DELETE FROM hotel_reservation_rooms WHERE reservation_id='88888888-8888-4888-8888-888888888888' AND hotel_room_id='16161616-1616-4616-8616-161616161616';
 PERFORM hh_reject(format($q$ SELECT hotelhub_settlement_close('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10101010-1010-4010-8010-101010101010','synthetic-owner',%L::uuid,%L,%L) $q$,i->>'id',i->>'revision',digest),'synthetic_room_two_failure');
 PERFORM hh_assert((SELECT status='checked_in' FROM hotel_reservations WHERE id='10101010-1010-4010-8010-101010101010') AND (SELECT count(*)=2 FROM hotel_reservation_rooms WHERE reservation_id='10101010-1010-4010-8010-101010101010' AND allocation_status='occupied') AND (SELECT count(*)=2 FROM hotel_room_housekeeping WHERE hotel_room_id IN ('15151515-1515-4515-8515-151515151515','16161616-1616-4616-8616-161616161616') AND condition='ready' AND dnd_active),'room2 failure rolls back reservation room1 and DND');
 PERFORM hh_assert(NOT EXISTS(SELECT 1 FROM hotel_housekeeping_handoffs WHERE reservation_id='10101010-1010-4010-8010-101010101010') AND NOT EXISTS(SELECT 1 FROM hotel_settlement_events WHERE intent_id=(i->>'id')::uuid AND event='closed'),'failed close has zero handoffs and close events');
END $$;
DROP TRIGGER zz_fail_room_two ON hotel_room_housekeeping;
DO $$ DECLARE i jsonb; digest text; result jsonb; BEGIN
 i:=hotelhub_settlement_read('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10101010-1010-4010-8010-101010101010');
 digest:=(SELECT proof_digest FROM hotel_settlement_evidence WHERE intent_id=(i->>'id')::uuid AND proof->>'kind'='settlement' ORDER BY (proof->>'checkedAt')::timestamptz DESC,id DESC LIMIT 1);
 result:=hotelhub_settlement_close('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10101010-1010-4010-8010-101010101010','synthetic-owner',(i->>'id')::uuid,i->>'revision',digest);
 PERFORM hh_assert(result->>'state'='closed' AND (SELECT status='checked_out' FROM hotel_reservations WHERE id='10101010-1010-4010-8010-101010101010'),'settled stay closes atomically');
 PERFORM hh_assert((SELECT count(*)=2 FROM hotel_reservation_rooms WHERE reservation_id='10101010-1010-4010-8010-101010101010' AND allocation_status='released') AND (SELECT count(*)=2 FROM hotel_room_housekeeping WHERE hotel_room_id IN ('15151515-1515-4515-8515-151515151515','16161616-1616-4616-8616-161616161616') AND condition='dirty' AND NOT dnd_active),'all occupied rooms released Dirty DNDoff');
 PERFORM hh_assert((SELECT count(*)=2 FROM hotel_housekeeping_handoffs WHERE settlement_intent_id=(i->>'id')::uuid AND source='settlement' AND state='applied'),'one intent-linked housekeeping handoff per room');
 PERFORM hh_assert((SELECT count(*)=1 FROM hotel_settlement_events WHERE intent_id=(i->>'id')::uuid AND event='closed'),'one close event');
 PERFORM hh_assert(hotelhub_settlement_close('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10101010-1010-4010-8010-101010101010','synthetic-owner',(i->>'id')::uuid,i->>'revision',digest)=result,'repeated close returns same durable result');
 PERFORM hh_reject($q$ UPDATE hotel_reservations SET notes='after-close mutation' WHERE id='10101010-1010-4010-8010-101010101010' $q$,'settlement_locked');
 PERFORM hh_assert(NOT has_function_privilege('authenticated','hotelhub_settlement_close(uuid,uuid,text,uuid,text,text)','EXECUTE'),'browser cannot close');
END $$;
-- Isolated proven-state fixture for the native close race; final proof validation above
-- is independent from the reservation/intent/room lock contention tested here.
CREATE FUNCTION public.hh_settled_close_fixture() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE res uuid:=gen_random_uuid(); folio uuid:=gen_random_uuid(); room uuid; intent uuid:=gen_random_uuid(); s jsonb; p jsonb; BEGIN
 INSERT INTO hotel_reservations(id,tenant_id,booking_reference,booking_source,status,arrival_date,departure_date,currency,created_by_n3_user_key) VALUES(res,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SYNTHETIC-CLOSE-'||res,'walk_in','checked_in','2026-10-07','2026-10-09','MYR','synthetic-owner');
 INSERT INTO hotel_folios(id,tenant_id,reservation_id,status) VALUES(folio,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res,'prepared');
 INSERT INTO hotel_folio_lines(tenant_id,folio_id,line_type,description_snapshot,unit_price_cents,subtotal_cents,total_cents,actor_n3_user_key) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',folio,'add_on','Synthetic close race',50000,50000,50000,'synthetic-owner');
 FOR n IN 1..2 LOOP
  room:=gen_random_uuid();
  INSERT INTO hotel_rooms(id,tenant_id,n3_stock_id,n3_stock_code,room_number) VALUES(room,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',room::text,room::text,room::text);
  INSERT INTO hotel_reservation_rooms(tenant_id,reservation_id,hotel_room_id,arrival_date,departure_date,base_rate_snapshot,agreed_rate,adults,allocation_status) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res,room,'2026-10-07','2026-10-09',250,250,1,'occupied');
  INSERT INTO hotel_room_housekeeping(tenant_id,hotel_room_id,condition,dnd_active,initialized_by_n3_user_key) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',room,'ready',true,'synthetic-owner');
 END LOOP;
 s:=hh_snapshot(res);
 INSERT INTO hotel_settlement_intents(id,tenant_id,reservation_id,client_request_id,snapshot,digest,state,actor_n3_user_key) VALUES(intent,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res,gen_random_uuid(),s,s->>'digest','settled','synthetic-owner');
 p:=(SELECT proof FROM hotel_settlement_evidence WHERE reservation_id='10101010-1010-4010-8010-101010101010' AND proof->>'kind'='settlement' ORDER BY (proof->>'checkedAt')::timestamptz DESC LIMIT 1);
 p:=hh_sign_proof(p||jsonb_build_object('reservationId',res,'intentId',intent,'bill',p->'bill'||jsonb_build_object('intentId',intent),'checkedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
 INSERT INTO hotel_settlement_evidence(tenant_id,reservation_id,intent_id,proof_digest,proof) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',res,intent,p->>'digest',p);
 RETURN jsonb_build_object('res',res,'intent',intent,'revision','1','digest',p->>'digest');
END $$;
