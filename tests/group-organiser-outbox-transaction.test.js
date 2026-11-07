const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const {PGlite}=require('@electric-sql/pglite');
const {createMyShilohPushService}=require('../src/services/myShilohPush');
test('deferred organiser notice is durable with the booking transaction, rolls back on failure and cannot replay to another client',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE crm_v2_clients(id BIGINT PRIMARY KEY);INSERT INTO crm_v2_clients VALUES(1),(2);');
 await db.exec(fs.readFileSync(require.resolve('../migrations/149_my_shiloh_push_notifications.sql'),'utf8'));
 let queries=0;const adapter={query:async(...args)=>{queries++;return db.query(...args);}};
 const service=createMyShilohPushService({db:adapter,env:{}});
 const notice={crmV2ClientId:1,eventKey:'synthetic-group-organiser:1',category:'appointment',title:'Group booking confirmed',body:'Your group booking is confirmed. Open My Shiloh for your update.',targetPath:'/my-shiloh/',deferWake:true};
 await db.exec('BEGIN');const queued=await service.queueNotification(notice);
 assert.equal(queued.queued,true);assert.equal(queued.deferred,true);assert.equal(queries,1);
 await db.exec('ROLLBACK');assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM my_shiloh_push_notifications')).rows[0].n,0);
 await db.exec('BEGIN');await service.queueNotification(notice);await db.exec('COMMIT');
 const retry=await service.queueNotification({...notice,retryExisting:true});assert.equal(retry.queued,true);assert.equal(retry.duplicate,true);assert.equal(retry.deferred,true);
 const foreign=await service.queueNotification({...notice,crmV2ClientId:2,retryExisting:true});assert.equal(foreign.queued,false);
 assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM my_shiloh_push_notifications')).rows[0].n,1);
});
