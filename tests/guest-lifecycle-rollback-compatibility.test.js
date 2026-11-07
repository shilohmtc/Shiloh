const test=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {claimDueReminder,claimDueFollowup}=require('../src/services/appointmentLifecycle');
test('the ordinary worker skips null-phone guest rows without marking them sent, preserving direct reminders and private follow-up',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`CREATE TABLE appointments(id BIGINT PRIMARY KEY,status TEXT,starts_at TIMESTAMPTZ,ends_at TIMESTAMPTZ);
 CREATE TABLE appointment_lifecycle(id BIGINT PRIMARY KEY,appointment_id BIGINT,crm_v2_client_id BIGINT,phone TEXT,status TEXT,appointment_at TIMESTAMPTZ,appointment_ends_at TIMESTAMPTZ,reminder_sent_at TIMESTAMPTZ,followup_sent_at TIMESTAMPTZ,updated_at TIMESTAMPTZ DEFAULT NOW());
 CREATE TABLE my_shiloh_push_subscriptions(crm_v2_client_id BIGINT,enabled BOOLEAN,revoked_at TIMESTAMPTZ);
 CREATE TABLE appointment_change_intents(phone TEXT,status TEXT,action TEXT);
 INSERT INTO appointments VALUES(1,'scheduled',NOW()+INTERVAL '1 minute',NOW()+INTERVAL '1 hour'),(2,'scheduled',NOW()+INTERVAL '2 minutes',NOW()+INTERVAL '1 hour');
 INSERT INTO appointment_lifecycle(id,appointment_id,crm_v2_client_id,phone,status,appointment_at,appointment_ends_at) VALUES
 (1,1,101,NULL,'confirmed',NOW()+INTERVAL '1 minute',NOW()+INTERVAL '1 hour'),
 (2,2,102,'27810000002','confirmed',NOW()+INTERVAL '2 minutes',NOW()+INTERVAL '1 hour'),
 (3,NULL,103,NULL,'completed',NOW()-INTERVAL '1 year',NOW()-INTERVAL '1 year'),
 (4,NULL,104,'27810000004','completed',NOW()-INTERVAL '1 year',NOW()-INTERVAL '1 year');
 INSERT INTO my_shiloh_push_subscriptions VALUES(101,TRUE,NULL),(102,TRUE,NULL);`);
 assert.equal((await claimDueReminder(db,{appOnly:true})).id,2);
 assert.equal(await claimDueReminder(db,{appOnly:true}),null);
 assert.equal((await claimDueFollowup(db)).id,4);
 assert.equal(await claimDueFollowup(db),null);
 const guestRows=(await db.query('SELECT reminder_sent_at,followup_sent_at FROM appointment_lifecycle WHERE id IN(1,3)')).rows;
 assert.ok(guestRows.every(row=>row.reminder_sent_at===null&&row.followup_sent_at===null));
});
