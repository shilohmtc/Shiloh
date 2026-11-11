'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {tabletBookedFixture}=require('./support/tabletBookedFixture');
const {IDLE_MS,LIFE_MS}=require('../src/services/clinicTabletBookedJourney');
const input={mobile:'27820000001',network:'192.0.2.0/24'};
const answers={consent_acknowledged:'yes',signature_name:'Synthetic Client',signature_confirm:'yes'};
async function setup(t){const h=await tabletBookedFixture();t.after(()=>h.close());return h;}
async function verified(h){const r=await h.service.begin(h.deviceToken,input);await h.otp.dispatchOne();await h.service.verify(h.deviceToken,r.token,{code:h.sent.at(-1).code,network:input.network});return r;}
test('booked tablet uses real synthetic phone proof, explicit visit and sequential signed form confirmations only',async t=>{
 const h=await setup(t),before=(await h.db.query('SELECT * FROM crm_v2_clients ORDER BY id')).rows;
 const r=await h.service.begin(h.deviceToken,input);assert.deepEqual(Object.keys(r).sort(),['state','token']);
 assert.equal((await h.service.resume(h.deviceToken,r.token)).state,'code');
 await h.otp.dispatchOne();const selection=await h.service.verify(h.deviceToken,r.token,{code:h.sent[0].code,network:input.network});
 assert.equal(selection.state,'choose');assert.deepEqual(selection.visits.map(v=>v.id),['42']);
 await assert.rejects(h.service.choose(h.deviceToken,r.token,'43'),{httpStatus:422});
 let current=await h.service.choose(h.deviceToken,r.token,'42');assert.equal(current.assignmentId,'7');assert.equal(current.position,1);assert.equal(current.total,2);
 await assert.rejects(h.service.submit(h.deviceToken,r.token,'8',answers),{httpStatus:409});
 current=await h.service.submit(h.deviceToken,r.token,'7',answers);assert.equal(current.assignmentId,'8');assert.equal(current.position,2);
 // A repeated old step cannot submit answers to the next form.
 await assert.rejects(h.service.submit(h.deviceToken,r.token,'7',answers),{httpStatus:409});
 assert.equal((await h.service.resume(h.deviceToken,r.token)).assignmentId,'8');
 assert.equal((await h.service.submit(h.deviceToken,r.token,'8',answers)).state,'finished');
 assert.equal((await h.service.resume(h.deviceToken,r.token)).state,'finished');
 assert.equal((await h.service.submit(h.deviceToken,r.token,'8',answers)).state,'finished');
 assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM consultation_form_submissions')).rows[0].n,2);
 assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM client_browser_sessions')).rows[0].n,0);
 assert.deepEqual((await h.db.query('SELECT * FROM crm_v2_clients ORDER BY id')).rows,before);
 const encrypted=JSON.stringify((await h.db.query('SELECT payload_ciphertext FROM clinic_tablet_visit_grants')).rows);
 assert.equal(encrypted.includes('Synthetic Client'),false);assert.equal(encrypted.includes(input.mobile),false);
});
test('failed code attempts commit and lock out after five guesses, without identity disclosure',async t=>{
 const h=await setup(t),r=await h.service.begin(h.deviceToken,input);await h.otp.dispatchOne();
 for(let i=0;i<5;i++)await assert.rejects(h.service.verify(h.deviceToken,r.token,{code:'xxxxxx',network:input.network}),{httpStatus:422});
 const row=(await h.db.query('SELECT payload FROM client_code_records')).rows[0].payload;
 assert.equal(row.attempts,5);assert.equal(row.state,'revoked');
 await assert.rejects(h.service.verify(h.deviceToken,r.token,{code:h.sent[0].code,network:input.network}),{httpStatus:422});
});
test('shared or missing identity never shows visits; existing handover remains the fallback',async t=>{
 const h=await setup(t);await h.db.query("INSERT INTO client_contacts VALUES(1,1,'mobile',$1)",[input.mobile]);
 const r=await h.service.begin(h.deviceToken,input);await h.otp.dispatchOne();
 assert.deepEqual(await h.service.verify(h.deviceToken,r.token,{code:h.sent[0].code,network:input.network}),{state:'help'});
});
test('device and identity drift, expiry, cancellation and missing required forms fail closed',async t=>{
 const h=await setup(t),r=await verified(h);
 await assert.rejects(h.service.resume(h.otherDeviceToken,r.token),{httpStatus:410});
 await h.db.query("DELETE FROM consultation_form_assignments WHERE id=8");
 assert.deepEqual(await h.service.choose(h.deviceToken,r.token,'42'),{state:'help'});
 await h.service.cancel(h.deviceToken,r.token);await assert.rejects(h.service.resume(h.deviceToken,r.token),{httpStatus:410});
 h.advance(61000);const next=await verified(h);h.advance(IDLE_MS);await assert.rejects(h.service.resume(h.deviceToken,next.token),{httpStatus:410});
 await h.store.prune(1);assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM clinic_tablet_visit_grants')).rows[0].n,0);
 h.advance(61000);const third=await verified(h);h.access(false);await assert.rejects(h.service.resume(h.deviceToken,third.token),{httpStatus:403});
 assert.ok(LIFE_MS>IDLE_MS);
});
test('queued sends stop after cancellation, grant replacement or device revocation',async t=>{
 const h=await setup(t),first=await h.service.begin(h.deviceToken,input);
 await h.service.cancel(h.deviceToken,first.token);await h.otp.dispatchOne();assert.equal(h.sent.length,0);
 const second=await h.service.begin(h.deviceToken,input);const third=await h.service.begin(h.deviceToken,input);
 await assert.rejects(h.service.resume(h.deviceToken,second.token),{httpStatus:410});
 await h.db.query('UPDATE clinic_checkin_devices SET revoked_at=NOW() WHERE id=1');
 await h.otp.dispatchOne();await h.otp.dispatchOne();assert.equal(h.sent.length,0);
 await assert.rejects(h.service.resume(h.deviceToken,third.token),{httpStatus:401});
});
test('ambiguous owners and no current booking reveal no appointment choices',async t=>{
 const h=await setup(t);await h.db.query("UPDATE appointments SET starts_at='2026-11-12T08:30Z' WHERE id=42");
 const r=await verified(h);assert.deepEqual(await h.service.resume(h.deviceToken,r.token),{state:'help'});
 h.advance(61000);await h.db.query("UPDATE crm_v2_clients SET normalized_mobile=$1 WHERE id=11",[input.mobile]);
 const next=await verified(h);assert.deepEqual(await h.service.resume(h.deviceToken,next.token),{state:'help'});
});
test('unavailable and expired codes, changed visit scope and fixed maximum lifetime fail closed',async t=>{
 const h=await setup(t);h.ready(false);const first=await h.service.begin(h.deviceToken,input);await h.otp.dispatchOne();assert.equal(h.sent.length,0);
 await assert.rejects(h.service.verify(h.deviceToken,first.token,{code:'123456',network:input.network}),{httpStatus:422});
 h.ready(true);h.advance(61000);const r=await verified(h);
 await h.db.query("UPDATE appointments SET status='cancelled' WHERE id=42");
 await assert.rejects(h.service.choose(h.deviceToken,r.token,'42'),{httpStatus:409});
 await h.db.query("UPDATE appointments SET status='confirmed',updated_at=NOW()+interval '1 second' WHERE id=42");
 await assert.rejects(h.service.choose(h.deviceToken,r.token,'42'),{httpStatus:409});
 h.advance(LIFE_MS);await assert.rejects(h.service.resume(h.deviceToken,r.token),{httpStatus:410});
});
test('durable grant failure rolls back queued OTP and canonical signed forms',async t=>{
 const h=await setup(t);
 await h.pg.exec(`CREATE FUNCTION reject_tablet_grant() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'synthetic grant failure'; END; $$ LANGUAGE plpgsql;
 CREATE TRIGGER reject_tablet_grant BEFORE INSERT ON clinic_tablet_visit_grants FOR EACH ROW EXECUTE FUNCTION reject_tablet_grant();`);
 await assert.rejects(h.service.begin(h.deviceToken,input));
 assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM client_code_records')).rows[0].n,0);
 assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM client_code_rates')).rows[0].n,0);
 await h.pg.exec('DROP TRIGGER reject_tablet_grant ON clinic_tablet_visit_grants');
 const r=await verified(h);await h.service.choose(h.deviceToken,r.token,'42');await h.service.submit(h.deviceToken,r.token,'7',answers);
 await h.pg.exec(`CREATE TRIGGER reject_tablet_grant BEFORE UPDATE ON clinic_tablet_visit_grants FOR EACH ROW EXECUTE FUNCTION reject_tablet_grant();`);
 await assert.rejects(h.service.submit(h.deviceToken,r.token,'8',answers));
 assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM consultation_form_submissions')).rows[0].n,1);
 await h.pg.exec('DROP TRIGGER reject_tablet_grant ON clinic_tablet_visit_grants');
 assert.equal((await h.service.submit(h.deviceToken,r.token,'8',answers)).state,'finished');
});
test('encrypted grant tampering fails closed and failed cleanup never claims success',async t=>{
 const h=await setup(t),r=await verified(h);await h.service.choose(h.deviceToken,r.token,'42');
 await h.db.query("UPDATE clinic_tablet_visit_grants SET payload_ciphertext=substring(payload_ciphertext,1,length(payload_ciphertext)-4)||'AAAA'");
 await assert.rejects(h.service.resume(h.deviceToken,r.token));
 h.advance(IDLE_MS);
 // Do not hide an undecryptable row by claiming cleanup succeeded.
 await assert.rejects(h.store.pruneBatch());
});
test('expired grants on revoked devices revoke the matching form token and are deleted',async t=>{
 const h=await setup(t),r=await verified(h);await h.service.choose(h.deviceToken,r.token,'42');
 await h.db.query('UPDATE clinic_checkin_devices SET revoked_at=NOW() WHERE id=1');h.advance(IDLE_MS);
 assert.equal(await h.store.pruneBatch(),1);
 assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM clinic_tablet_visit_grants')).rows[0].n,0);
 assert.ok(new Date((await h.db.query('SELECT access_expires_at FROM consultation_form_assignments WHERE id=7')).rows[0].access_expires_at)<=h.now());
});
test('repeated start requests reuse the original proof and never enqueue another code',async t=>{
 const h=await setup(t),entryGrantToken='Q'.repeat(43);
 const first=await h.service.begin(h.deviceToken,{...input,entryGrantToken});
 const again=await h.service.begin(h.deviceToken,{...input,mobile:'27820000002',entryGrantToken});
 assert.deepEqual(again,first);assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM client_code_records')).rows[0].n,1);
 await h.otp.dispatchOne();assert.equal(h.sent.length,1);assert.equal(h.sent[0].mobile,input.mobile);
});
test('an expired code cannot become visit access even while tablet activity keeps the grant alive',async t=>{
 const h=await setup(t),r=await h.service.begin(h.deviceToken,input);await h.otp.dispatchOne();
 for(let i=0;i<3;i++){h.advance(240000);await h.service.touch(h.deviceToken,r.token);}h.advance(181000);
 await assert.rejects(h.service.verify(h.deviceToken,r.token,{code:h.sent[0].code,network:input.network}),{httpStatus:422});
 assert.equal((await h.service.resume(h.deviceToken,r.token)).state,'code');assert.equal(h.sent.length,1);
});
test('restart resumes the same protected form without issuing a new token or code',async t=>{
 const {createClinicTabletGrantStore}=require('../src/services/clinicTabletGrantStore');
 const {createClinicTabletBookedJourney}=require('../src/services/clinicTabletBookedJourney');
 const h=await setup(t),r=await verified(h);await h.service.choose(h.deviceToken,r.token,'42');
 const before=(await h.db.query('SELECT access_token_hash FROM consultation_form_assignments WHERE id=7')).rows[0].access_token_hash;
 const store=createClinicTabletGrantStore({db:h.db,hmacKey:Buffer.alloc(32,3),closeForm:h.authority.forms.close,now:h.now});
 const restarted=createClinicTabletBookedJourney({store,otp:h.otp,...h.authority,now:h.now});
 assert.equal((await restarted.resume(h.deviceToken,r.token)).assignmentId,'7');
 assert.equal((await h.db.query('SELECT access_token_hash FROM consultation_form_assignments WHERE id=7')).rows[0].access_token_hash,before);
 assert.equal(h.sent.length,1);
});
test('no required forms is backend-confirmed without inventing a signed submission',async t=>{
 const h=await setup(t);await h.db.query('DELETE FROM consultation_form_assignments');await h.db.query('DELETE FROM consultation_form_service_mappings');
 const r=await verified(h);assert.deepEqual(await h.service.choose(h.deviceToken,r.token,'42'),{state:'finished'});
 assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM consultation_form_submissions')).rows[0].n,0);
});
test('an existing staff-prepared handover is never replaced by self-service',async t=>{
 const h=await setup(t),r=await verified(h);
 await h.db.query("INSERT INTO clinic_checkin_form_handoffs(device_id,assignment_id,queued_by_admin_id,expires_at,crm_v2_client_id,appointment_id,identity_revision) VALUES(2,7,2,$1,10,42,$2)",[new Date(h.now().getTime()+900000),'a'.repeat(64)]);
 await assert.rejects(h.service.choose(h.deviceToken,r.token,'42'),{httpStatus:409});
 assert.equal((await h.db.query('SELECT access_token_hash FROM consultation_form_assignments WHERE id=7')).rows[0].access_token_hash,null);
 assert.equal((await h.db.query('SELECT status FROM clinic_checkin_form_handoffs')).rows[0].status,'queued');
});
test('two tablets selecting the same assignment concurrently cannot rotate each other’s form',async t=>{
 const h=await setup(t),first=await verified(h);h.advance(61000);
 const second=await h.service.begin(h.otherDeviceToken,input);await h.otp.dispatchOne();
 await h.service.verify(h.otherDeviceToken,second.token,{code:h.sent.at(-1).code,network:input.network});
 const results=await Promise.allSettled([h.service.choose(h.deviceToken,first.token,'42'),h.service.choose(h.otherDeviceToken,second.token,'42')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.httpStatus===409).length,1);
 assert.equal((await h.db.query("SELECT COUNT(*)::int AS n FROM clinic_tablet_visit_grants WHERE state='form' AND assignment_id=7")).rows[0].n,1);
 const winner=results[0].status==='fulfilled'?[h.deviceToken,first.token]:[h.otherDeviceToken,second.token];
 assert.equal((await h.service.resume(...winner)).assignmentId,'7');
});
