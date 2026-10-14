'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {install,serviceFor,input,snapshot}=require('./helpers/depositWaiverFixture');
async function setup(t){const pg=new PGlite();t.after(()=>pg.close());const query=async(sql,params)=>{const r=params?await pg.query(sql,params):(await pg.exec(sql)).at(-1);return {...r,rowCount:r.rows?.length||r.affectedRows||0};};const db={query,connect:async()=>({query,release(){}})};await install(db);return {pg,db,service:serviceFor(db)};}
test('waiver retains partial money, complete treatment balance and original policy amounts; exact retry retains audit time',async t=>{
 const {db,service}=await setup(t),before=await snapshot(db);const result=await service.recordDepositWaiver(input());
 assert.equal(result.state,'waived');assert.equal(result.originalRequiredAmount,'250.00');assert.equal(result.reason,'Agreed deposit exception');assert.equal(result.actorAdminId,2);assert.ok(result.waivedAt);assert.deepEqual(await snapshot(db),before);
 assert.equal((await db.query('SELECT state FROM booking_deposit_requirements WHERE id=90')).rows[0].state,'waived');assert.equal((await db.query('SELECT state FROM payment_requests WHERE id=100')).rows[0].state,'cancelled');
 const repeat=await service.recordDepositWaiver(input());assert.equal(repeat.status,'idempotent_replay');assert.equal(repeat.auditId,result.auditId);assert.equal(new Date(repeat.waivedAt).toISOString(),new Date(result.waivedAt).toISOString());
 assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM crm_audit_events WHERE action='booking.deposit_waived'")).rows[0].n,1);
 const model=await service.get({adminId:2,appointmentId:201});assert.equal(model.payment.netPaid,'50.00');assert.equal(model.payment.outstanding,'450.00');assert.equal(model.payment.state,'partially_paid');
});
test('verified money already inflight on closed waived deposit is retained exactly once and flagged for review',async t=>{
 const {db,service}=await setup(t);await service.recordDepositWaiver(input());const payload={TransactionId:'SYNTHETIC-LATE-WAIVER',TransactionReference:'synthetic_deposit_link',Status:'Complete',Amount:'250.00',CurrencyCode:'ZAR'};
 assert.equal((await service.handleOzowNotification(payload)).status,'paid_review_required');assert.equal((await service.handleOzowNotification(payload)).status,'duplicate');
 assert.equal((await db.query("SELECT SUM(amount)::text AS total FROM payment_ledger_entries WHERE payment_account_id=80 AND entry_type='payment'")).rows[0].total,'300.00');
 assert.equal((await db.query('SELECT state FROM booking_deposit_requirements WHERE id=90')).rows[0].state,'waived');assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM crm_audit_events WHERE action='payment.received_after_deposit_waived'")).rows[0].n,1);
 assert.equal((await service.get({adminId:2,appointmentId:201})).payment.outstanding,'200.00');
});
for(const [name,sql,code] of [
 ['unauthorized canonical actor',null,'DEPOSIT_WAIVER_FORBIDDEN'],
 ['cancelled booking',"UPDATE appointments SET status='cancelled' WHERE id=201",'DEPOSIT_WAIVER_BOOKING_UNAVAILABLE'],
 ['completed booking',"UPDATE appointments SET status='completed' WHERE id=201",'DEPOSIT_WAIVER_BOOKING_UNAVAILABLE'],
 ['expired request',"UPDATE payment_requests SET state='expired' WHERE id=100",'DEPOSIT_WAIVER_BOOKING_UNAVAILABLE'],
 ['fully covered deposit',"INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount) VALUES(80,'payment',200)",'DEPOSIT_WAIVER_NOT_OUTSTANDING'],
 ['unapproved client booking',"UPDATE appointments SET source='shiloh_client_whatsapp' WHERE id=201",'DEPOSIT_WAIVER_BOOKING_UNAVAILABLE'],
])test(`waiver fails closed: ${name}`,async t=>{const {db,service}=await setup(t);if(sql)await db.query(sql);const before=await snapshot(db);await assert.rejects(service.recordDepositWaiver(input(sql?{}:{adminId:1})),{code});assert.deepEqual(await snapshot(db),before);assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM crm_audit_events WHERE action='booking.deposit_waived'")).rows[0].n,0);assert.equal((await db.query('SELECT state FROM booking_deposit_requirements WHERE id=90')).rows[0].state,'awaiting');});
test('audit failure rolls requirement and closed requests back atomically',async t=>{const {db,service}=await setup(t);await db.query("ALTER TABLE crm_audit_events ADD CONSTRAINT synthetic_reject_waiver CHECK(action<>'booking.deposit_waived')");const before=await snapshot(db);await assert.rejects(service.recordDepositWaiver(input()),/synthetic_reject_waiver/);assert.deepEqual(await snapshot(db),before);assert.equal((await db.query('SELECT state FROM booking_deposit_requirements WHERE id=90')).rows[0].state,'awaiting');assert.equal((await db.query('SELECT state FROM payment_requests WHERE id=100')).rows[0].state,'pending');});

test('whole shared booking waiver preserves both member policy amounts and one account; changed membership rejects historical retry',async t=>{
 const {db,service}=await setup(t);await db.query("INSERT INTO appointment_groups(id,status,final_total,total_price,updated_at,source) VALUES(70,'confirmed',1000,1000,'2026-10-14T08:00Z','shiloh_my_shiloh_couples');INSERT INTO appointment_group_members VALUES(70,201,1),(70,203,2);UPDATE appointments SET crm_v2_client_id=102 WHERE id=203;INSERT INTO appointment_booking_approvals VALUES(201,'approved'),(203,'approved');UPDATE booking_payment_accounts SET appointment_id=NULL,appointment_group_id=70,canonical_amount_due=1000 WHERE id=80;UPDATE booking_deposit_requirements SET required_amount=500 WHERE id=90;INSERT INTO booking_deposit_requirement_members VALUES(90,203,250,500,NULL,'{\"partialForfeitBasisPoints\":5000}'::jsonb)");
 const before=await snapshot(db);const result=await service.recordDepositWaiver(input());assert.deepEqual(result.appointmentIds,[201,203]);assert.equal(result.groupId,70);assert.equal(result.originalRequiredAmount,'500.00');assert.deepEqual(await snapshot(db),before);
 await db.query('DELETE FROM appointment_group_members WHERE group_id=70 AND appointment_id=203');await assert.rejects(service.recordDepositWaiver(input()),{code:'DEPOSIT_WAIVER_REPLAY_SCOPE_CHANGED'});assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM crm_audit_events WHERE action='booking.deposit_waived'")).rows[0].n,1);
});
test('current JP and singleton Reception authority allowed; ambiguous Reception and display-name impostor rejected without grants',async t=>{
 const {db,service}=await setup(t);await db.query("INSERT INTO staff_admin_accounts SELECT 4,NULL,'Synthetic JP','admin','business_admin','all_business','all_services',permissions,TRUE FROM staff_admin_accounts WHERE id=2;INSERT INTO staff_admin_accounts SELECT 5,NULL,'Synthetic Reception','receptionist','booking_operator','all_business','all_services',permissions,TRUE FROM staff_admin_accounts WHERE id=2");
 const {createBookingDepositWaiverActions}=require('../src/services/bookingDepositWaiver');const {resolveCalendarAuthority}=require('../src/services/calendarAuthorization');const gate=createBookingDepositWaiverActions({db});
 const actor=async id=>resolveCalendarAuthority(db,id,{additionalCapabilities:['payment:view','payment:collect']});
 assert.equal(await gate.allowed(await actor(4)),true);assert.equal(await gate.allowed(await actor(5)),true);
 await db.query("INSERT INTO staff_admin_accounts SELECT 6,NULL,'Synthetic Other Reception','receptionist','booking_operator','all_business','all_services',permissions,TRUE FROM staff_admin_accounts WHERE id=2");assert.equal(await gate.allowed(await actor(5)),false);
 await db.query("UPDATE staff_admin_accounts SET display_name='JP',role='admin',business_role='business_admin',permissions=(SELECT permissions FROM staff_admin_accounts WHERE id=2) WHERE id=1");assert.equal(await gate.allowed(await actor(1)),false);
 await db.query("UPDATE staff_admin_accounts SET permissions=permissions-'payment:collect' WHERE id=4");assert.equal(await gate.allowed(await actor(4)),false);
});

test('original cancellation/no-show policy trigger retains waived member amounts and never moves money',async t=>{
 const {db,service}=await setup(t);await service.recordDepositWaiver(input());const before=await snapshot(db);
 await db.query("INSERT INTO appointment_status_history(appointment_id,to_status,changed_at) VALUES(201,'cancelled','2099-10-13T20:00Z'),(201,'no_show','2099-10-15T08:00Z')");
 const events=(await db.query('SELECT member_required_amount,policy_forfeit_amount,policy_creditable_amount FROM booking_deposit_policy_events ORDER BY id')).rows;
 assert.deepEqual(events,[{member_required_amount:'250.00',policy_forfeit_amount:'125.00',policy_creditable_amount:'125.00'},{member_required_amount:'250.00',policy_forfeit_amount:'250.00',policy_creditable_amount:'0.00'}]);assert.deepEqual(await snapshot(db),before);
 await assert.rejects(db.query("UPDATE booking_deposit_requirements SET state='exempt' WHERE id=90"),/synthetic_original_exempt_zero/);assert.equal((await db.query('SELECT state FROM booking_deposit_requirements WHERE id=90')).rows[0].state,'waived');
});

test('late provider audit failure rolls back actual receipt until a verified retry stores it; cancellation is never revived',async t=>{
 const {db,service}=await setup(t);await service.recordDepositWaiver(input());await db.query("UPDATE appointments SET status='cancelled' WHERE id=201;ALTER TABLE crm_audit_events ADD CONSTRAINT synthetic_reject_late CHECK(action<>'payment.received_after_deposit_waived')");
 const payload={TransactionId:'SYNTHETIC-LATE-AUDIT-RETRY',TransactionReference:'synthetic_deposit_link',Status:'Complete',Amount:'250.00',CurrencyCode:'ZAR'};
 await assert.rejects(service.handleOzowNotification(payload),/synthetic_reject_late/);assert.equal((await db.query("SELECT SUM(amount)::text AS total FROM payment_ledger_entries WHERE payment_account_id=80")).rows[0].total,'50.00');assert.equal((await db.query('SELECT state FROM payment_requests WHERE id=100')).rows[0].state,'cancelled');
 await db.query('ALTER TABLE crm_audit_events DROP CONSTRAINT synthetic_reject_late');assert.equal((await service.handleOzowNotification(payload)).status,'paid_review_required');assert.equal((await db.query("SELECT SUM(amount)::text AS total FROM payment_ledger_entries WHERE payment_account_id=80")).rows[0].total,'300.00');assert.equal((await db.query('SELECT status FROM appointments WHERE id=201')).rows[0].status,'cancelled');assert.equal((await db.query('SELECT state FROM booking_deposit_requirements WHERE id=90')).rows[0].state,'waived');
});
test('waiver reason, whole-account confirmation, exact fingerprint and stale booking revision fail closed',async t=>{
 const {db,service}=await setup(t);
 for(const overrides of [{reason:'   '},{reason:'x'.repeat(241)},{confirmed:false}])await assert.rejects(service.recordDepositWaiver(input(overrides)),{code:'DEPOSIT_WAIVER_REASON_REQUIRED'});
 await assert.rejects(service.recordDepositWaiver(input({expectedRevision:'2026-10-14T09:00:00.000Z'})),{code:'DEPOSIT_WAIVER_STALE'});
 await service.recordDepositWaiver(input());await assert.rejects(service.recordDepositWaiver(input({reason:'Different agreement'})),{code:'DEPOSIT_WAIVER_RETRY_MISMATCH'});assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM crm_audit_events WHERE action='booking.deposit_waived'")).rows[0].n,1);
});
for(const status of ['cancelled','completed','no_show'])test(`exact retry after ${status} cannot release confirmation or reinstate the booking`,async t=>{
 const {db,service}=await setup(t);const first=await service.recordDepositWaiver(input());await db.query('UPDATE appointments SET status=$1 WHERE id=201',[status]);let confirmations=0;
 const {createBookingPaymentService}=require('../src/services/bookingPayments');const replayService=createBookingPaymentService({db,ozow:{configured:()=>false},rewards:{getClientBalance:async()=>null,syncEligibleEarnings:async()=>{}},deposits:{getPosition:async()=>({requirement:{state:'waived'},scope:{members:[{appointmentId:201}]}})},confirmBooking:async()=>{confirmations++;}});
 await assert.rejects(replayService.recordDepositWaiver(input()),{code:'DEPOSIT_WAIVER_BOOKING_UNAVAILABLE'});assert.equal(confirmations,0);assert.equal((await db.query('SELECT status FROM appointments WHERE id=201')).rows[0].status,status);assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM crm_audit_events WHERE action='booking.deposit_waived'")).rows[0].n,1);const audit=(await db.query("SELECT created_at FROM crm_audit_events WHERE id=$1",[first.auditId])).rows[0];assert.equal(new Date(audit.created_at).toISOString(),new Date(first.waivedAt).toISOString());
});
