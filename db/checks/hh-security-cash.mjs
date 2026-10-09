// Real disposable embedded PostgreSQL: no secrets/URL and no operational DB.
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const req=createRequire(resolve(process.env.HH_SECURITY_SQL_TOOLS||'.superpowers/sdd/2026-10-09-security-cash/sql-tools','package.json'));
const {PGlite}=req('@electric-sql/pglite');const pg=new PGlite();
const t='22222222-2222-4222-8222-222222222222', other='33333333-3333-4333-8333-333333333333';
const res='44444444-4444-4444-8444-444444444444', rr='55555555-5555-4555-8555-555555555555', room='66666666-6666-4666-8666-666666666666', rr2='77777777-7777-4777-8777-777777777777';
const cmd=(body,role='owner',key=randomUUID(),tenant=t)=>pg.query('select public.hh_security_command($1::uuid,$2::uuid,$3,$4,$5::uuid,$6::jsonb) as result',[tenant,res,role==='front_desk'?'desk':'owner',role,key,JSON.stringify(body)]).then(r=>r.rows[0].result);
const read=()=>pg.query('select public.hh_security_read($1::uuid,$2::uuid) as result',[t,res]).then(r=>r.rows[0].result);
const report=(from,asAt)=>pg.query('select public.hh_security_report($1::uuid,$2::timestamptz,$3::timestamptz) as result',[t,from,asAt]).then(r=>r.rows[0].result);
try{
await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create table public.hotel_reservations(id uuid primary key,tenant_id uuid,status text,booking_reference text,unique(tenant_id,id));
create table public.hotel_rooms(id uuid primary key,tenant_id uuid,room_number text,unique(tenant_id,id));
create table public.hotel_reservation_rooms(id uuid primary key,tenant_id uuid,reservation_id uuid,hotel_room_id uuid,allocation_status text);
create table public.hotel_reservation_deposits(id uuid default gen_random_uuid(),tenant_id uuid,status text);
insert into public.hotel_reservations values('${res}','${t}','confirmed','BK-TEST');
insert into public.hotel_rooms values('${room}','${t}','101');
insert into public.hotel_reservation_rooms values('${rr}','${t}','${res}','${room}','reserved'),('${rr2}','${t}','${res}','${room}','reserved');`);
for(const ending of ['_hh_deposit_module_controls.sql','_hh_security_cash.sql']){
const file=readdirSync('supabase/migrations').find(f=>f.endsWith(ending));if(file)await pg.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
}
const before=(await pg.query('select clock_timestamp() as at')).rows[0].at;
await assert.rejects(cmd({action:'collect',roomStayId:rr,payer:'Guest',recipient:'Guest',storage:'Envelope A',method:'cash',policyVersion:'0'}),/security_collection_disabled/);
let policy=(await pg.query("select public.hh_update_deposit_module_policy($1::uuid,'owner','0',false,true) as p",[t])).rows[0].p;
await assert.rejects(pg.query("update public.hotel_reservations set status='checked_in' where id=$1::uuid",[res]),/security_collection_required/);
const collection={action:'collect',roomStayId:rr,payer:'Guest',recipient:'Guest',storage:'Envelope A',method:'cash',policyVersion:'0'};const key=randomUUID();
await assert.rejects(cmd({...collection,amountCents:1}),/security_invalid_request/);
let h=await cmd(collection,'front_desk',key);assert.equal(h.heldCents,5000);assert.equal(h.returnableCents,5000);assert.match(h.receiptNumber,/^SD\d{4}00001$/);
assert.equal((await cmd(collection,'front_desk',key)).id,h.id);
await assert.rejects(cmd({...collection,storage:'other'},'front_desk',key),/security_key_conflict/);
await assert.rejects(cmd(collection),/security_holding_exists/);
await assert.rejects(cmd({...collection,roomStayId:rr2},'housekeeper'),/forbidden/);
await assert.rejects(cmd({...collection,roomStayId:rr2},'front_desk',randomUUID(),other),/reservation_not_found/);
await assert.rejects(cmd({...collection,roomStayId:rr2,method:'bank'}),/security_cash_only/);
await assert.rejects(cmd({action:'waive',roomStayId:rr2,reason:'No deposit required'},'front_desk'),/forbidden/);
await cmd({action:'waive',roomStayId:rr2,reason:'Owner grants disclosed exception'});
await pg.query("update public.hotel_reservations set status='checked_in' where id=$1::uuid",[res]);
await assert.rejects(cmd({action:'deduct',holdingId:h.id,version:h.version,cents:2000,reason:'Key',evidence:'paper#1',acknowledgment:'Agreed'},'front_desk'),/forbidden/);
const oldVersion=h.version;h=await cmd({action:'deduct',holdingId:h.id,version:h.version,cents:2000,reason:'Key replacement',evidence:'inspection#1',acknowledgment:'Guest agreed',disputed:false});
assert.equal(h.heldCents,5000);assert.equal(h.returnableCents,3000);assert.equal(h.pendingDispositionCents,2000);
await assert.rejects(cmd({action:'inspect',holdingId:h.id,version:oldVersion,clear:true,evidence:'all clear'}),/security_version_conflict/);
h=await cmd({action:'inspect',holdingId:h.id,version:h.version,clear:true,evidence:'Checked keys and room'});
await assert.rejects(cmd({action:'reserve_return',holdingId:h.id,version:h.version,recipient:'Stranger'}),/security_recipient_mismatch/);
h=await cmd({action:'reserve_return',holdingId:h.id,version:h.version,recipient:'Guest'},'front_desk');const operation=h.pendingReturn;
await assert.rejects(cmd({action:'confirm_return',holdingId:h.id,version:h.version,operationId:operation.id,recipient:'Guest',acknowledgment:'signed',cents:1}),/security_invalid_request/);
assert.equal(operation.cents,3000);assert.equal(h.heldCents,5000);
await assert.rejects(cmd({action:'reserve_return',holdingId:h.id,version:h.version,recipient:'Guest'}),/security_return_pending/);
await assert.rejects(cmd({action:'release_return',holdingId:h.id,version:h.version,operationId:operation.id,reason:'Not handed'},'front_desk'),/forbidden/);
await pg.query("select public.hh_update_deposit_module_policy($1::uuid,'owner',$2,false,false)",[t,policy.version]);
h=await cmd({action:'confirm_return',holdingId:h.id,version:h.version,operationId:operation.id,recipient:'Guest',acknowledgment:'Signed return receipt',reason:'Owner checked staff paper and actual notes'},'owner');
assert.equal(h.heldCents,2000);assert.equal(h.returnableCents,0);assert.equal(h.pendingReturn,null);
await assert.rejects(cmd({action:'confirm_return',holdingId:h.id,version:h.version,operationId:operation.id,recipient:'Guest',acknowledgment:'again'}),/security_return_not_pending/);
h=await cmd({action:'transfer',holdingId:h.id,version:h.version,cents:2000,reason:'Move actual cash to hotel drawer',evidence:'Signed movement#1',accountantReference:'charge#1'});assert.equal(h.heldCents,0);
// An as-at boundary cannot show cash without its holding snapshot.
const cashAt=(await pg.query("select created_at as at from public.hotel_security_events where tenant_id=$1::uuid and event='collect' order by created_at limit 1",[t])).rows[0].at;
const exact=await report(before,cashAt);assert.equal(exact.closingCents,5000);assert.equal(exact.holdings.find(x=>x.id===h.id)?.heldCents,5000);
const now=(await pg.query('select clock_timestamp() as at')).rows[0].at;
const r=await report(before,now);assert.equal(r.openingCents,0);assert.equal(r.collectionsCents,5000);assert.equal(r.returnsCents,3000);assert.equal(r.transfersCents,2000);assert.equal(r.closingCents,0);
const historical=await report(before,now);await assert.rejects(pg.exec("update public.hotel_security_events set delta_held=99"),/security_immutable/);
await assert.rejects(pg.exec("delete from public.hotel_security_events"),/security_immutable/);
assert.deepEqual(await report(before,now),historical);
await pg.query("update public.hotel_reservations set status='checked_out' where id=$1::uuid",[res]);
// New holding allows local correction/release and persists beyond module off and month boundaries.
policy=(await pg.query("select public.hh_update_deposit_module_policy($1::uuid,'owner',(select version::text from public.hotel_deposit_module_policies where tenant_id=$1::uuid),false,true) as p",[t])).rows[0].p;
await pg.query("update public.hotel_reservations set status='checked_in' where id=$1::uuid",[res]);
let h2=await cmd({...collection,roomStayId:rr2,storage:'Envelope B'});assert.equal(h2.heldCents,5000);
h2=await cmd({action:'adjust',holdingId:h2.id,version:h2.version,cents:-1000,actualCountCents:4000,reason:'Owner count corrected documented overstatement',evidence:'Count sheet'});assert.equal(h2.heldCents,4000);
await assert.rejects(cmd({action:'adjust',holdingId:h2.id,version:h2.version,cents:-5000,actualCountCents:0,reason:'Bad',evidence:'bad'}),/security_invalid_amount/);
await assert.rejects(pg.query("update public.hotel_reservations set status='checked_out' where id=$1::uuid",[res]),/security_return_required/);
h2=await cmd({action:'open_case',holdingId:h2.id,version:h2.version,kind:'guest_left',reason:'Guest departed before collection',evidence:'Departure log'});
await pg.query("update public.hotel_reservations set status='checked_out' where id=$1::uuid",[res]);
await pg.exec(`insert into public.hotel_rooms values('88888888-8888-4888-8888-888888888888','${t}','102');`);
await pg.query("update public.hotel_reservation_rooms set hotel_room_id='88888888-8888-4888-8888-888888888888' where id=$1::uuid",[rr2]);
const moved=(await read()).holdings.find(x=>x.id===h2.id);assert.equal(moved.receiptNumber,h2.receiptNumber);assert.equal(moved.roomNumber,'102');assert.equal(moved.heldCents,4000);
// Owner releases a return only after reconciliation; its old operation/version is fenced.
let recovery=await cmd({action:'inspect',holdingId:h2.id,version:moved.version,clear:true,evidence:'Physical room/key check'});
recovery=await cmd({action:'reserve_return',holdingId:h2.id,version:recovery.version,recipient:'Guest'},'front_desk');
const releasedOperation=recovery.pendingReturn.id, reservedVersion=recovery.version;
recovery=await cmd({action:'release_return',holdingId:h2.id,version:recovery.version,operationId:releasedOperation,reason:'Owner found all notes intact; no signed payout'});
assert.equal(recovery.heldCents,4000);assert.equal(recovery.pendingReturn,null);
await assert.rejects(cmd({action:'confirm_return',holdingId:h2.id,version:reservedVersion,operationId:releasedOperation,recipient:'Guest',acknowledgment:'Late handover'}),/security_version_conflict/);
await assert.rejects(cmd({action:'bank_return_record',holdingId:h2.id,version:recovery.version,reason:'Accountant bank transfer',evidence:'Bank slip',acknowledgment:'Guest received',accountantReference:'bank#1'}),/security_bank_evidence_required/);
const cutoff=(await pg.query('select clock_timestamp() as at')).rows[0].at;const carry=await report(cutoff,new Date(Date.now()+86400000*40).toISOString());assert.equal(carry.openingCents,4000);assert.equal(carry.closingCents,4000);assert.equal(carry.holdings.find(x=>x.id===h2.id).openCase,true);
const statementBody={action:'count',from:before,counts:[{holdingId:h2.id,cents:3900}],storage:'Locked safe',singlePerson:true,note:'One staff on duty'};
let statement=(await pg.query('select public.hh_security_statement($1::uuid,$2,$3,$4::uuid,$5::jsonb) as result',[t,'desk','front_desk',randomUUID(),JSON.stringify(statementBody)])).rows[0].result;
assert.equal(statement.varianceCents,-100);assert.equal(statement.status,'awaiting_owner_review');
statement=(await pg.query('select public.hh_security_statement($1::uuid,$2,$3,$4::uuid,$5::jsonb) as result',[t,'owner','owner',randomUUID(),JSON.stringify({action:'sign',statementId:statement.id,version:statement.version,acknowledgment:'Count reviewed; shortage requires investigation'})])).rows[0].result;
assert.equal(statement.status,'variance_needs_review');assert.equal(statement.snapshot.closingCents,4000);
await assert.rejects(pg.exec('delete from public.hotel_security_statements'),/security_immutable/);
for(const role of ['anon','authenticated']){await pg.exec(`set role ${role}`);await assert.rejects(read(),/permission denied/);await assert.rejects(cmd(collection),/permission denied/);await pg.exec('reset role');}
console.log('PASS security cash PostgreSQL: numbering/idempotency/roles/tenants, check-in/checkout, deductions vs physical cash, two-step return, correction/move, carry-forward/immutable statements, grants/RLS. Native multi-session scheduling NOT VERIFIED.');
}finally{await pg.close();}
