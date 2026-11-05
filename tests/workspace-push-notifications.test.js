'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createWorkspacePushService } = require('../src/services/workspacePush');
const { workspacePwaClientScript, workspacePwaServiceWorkerScript } = require('../src/presentation/workspacePwa');

function fixture() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.alloc(32, 7));
  const env = {
    MY_SHILOH_VAPID_PUBLIC_KEY: ecdh.getPublicKey(null, 'uncompressed').toString('base64url'),
    MY_SHILOH_VAPID_PRIVATE_KEY: ecdh.getPrivateKey().toString('base64url'),
    MY_SHILOH_VAPID_SUBJECT: 'mailto:shiloh@example.com',
  };
  const queries = [];
  const db = { async query(sql, params) {
    queries.push([sql, params]);
    if (sql.includes('calendarAuthorization:principal')) {
      const id = params[0];
      return { rows: id === 3 ? [] : [{ id, business_role: id === 1 ? 'owner' : 'business_admin', calendar_scope:'all_business', service_scope:'all_services', permissions:{}, admin_active:true, staff_status:null, staff_id:null }], rowCount:id === 3 ? 0 : 1 };
    }
    if (sql.includes('SELECT id,admin_id,endpoint')) return { rows:[
      { id:11,admin_id:1,endpoint:'https://push.example.com/device-1' },
      { id:12,admin_id:1,endpoint:'https://push.example.com/device-2' },
      { id:13,admin_id:3,endpoint:'https://push.example.com/revoked' },
    ], rowCount:3 };
    if (sql.includes('INSERT INTO workspace_push_notifications')) return { rows:[{id:20}],rowCount:1 };
    return { rows:[], rowCount:0 };
  } };
  const sends = [];
  const events = new Set();
  const originalQuery = db.query;
  db.query = async (sql, params) => {
    if (sql.includes('INSERT INTO workspace_push_notifications')) {
      const key = `${params[0]}:${params[1]}`;
      if (events.has(key)) return { rows: [], rowCount: 0 };
      events.add(key);
    }
    return originalQuery(sql, params);
  };
  const service = createWorkspacePushService({ db,env,send:async (endpoint,options)=>{sends.push([endpoint,options]);return {ok:true,status:201};} });
  return { db,queries,sends,service };
}

test('Workspace push is restricted to the current Reception/owner authority and fans out to each opted-in device', async () => {
  const {queries,sends,service} = fixture();
  assert.equal(await service.permitted(3),false);
  assert.equal((await service.subscribe({adminId:3,endpoint:'https://push.example.com/no',p256dh:'a'.repeat(30),auth:'a'.repeat(16)})).enabled,false);
  await service.queue('planning:49');
  assert.deepEqual(sends.map(([endpoint])=>endpoint),['https://push.example.com/device-1','https://push.example.com/device-2']);
  assert.equal(queries.filter(([sql])=>sql.includes('INSERT INTO workspace_push_notifications')).length,1);
  assert.ok(sends.every(([,options])=>!options.body && options.headers.Authorization.startsWith('vapid ')));
});

test('Workspace notification UI requests permission on tap and display does not depend on a live staff session', () => {
  const client=workspacePwaClientScript();
  const worker=workspacePwaServiceWorkerScript();
  new Function(client);
  new Function('self','caches','fetch','Response',worker);
  assert.match(client,/button\.addEventListener\('click'.*Notification\.requestPermission\(\)/s);
  assert.match(worker,/push\/pending/);
  assert.match(worker,/controller.abort\(\)/);
  assert.match(worker,/event.waitUntil\(workspaceAlertBody\(\).then/);
  assert.doesNotMatch(worker,/client.*(?:name|phone|email)/i);
});

test('booking-request push respects scoped recipients, rechecks live permission and deduplicates per event', async () => {
  const { sends, service } = fixture();
  const first = await service.queue('booking_request:501', { adminIds: [1, 3] });
  assert.deepEqual(first, { queued: 1, accepted: 2, failed: 0 });
  assert.equal(sends.length, 2);
  assert.deepEqual(await service.queue('booking_request:501', { adminIds: [1, 3] }), { queued: 0, accepted: 0, failed: 0 });
  assert.equal(sends.length, 2);
  assert.deepEqual(await service.queue('booking_request:502', { adminIds: [] }), { queued: 0, accepted: 0, failed: 0 });
  assert.deepEqual(await service.queue('booking_request:503', { adminIds: [2] }), { queued: 0, accepted: 0, failed: 0 });
});

test('missing push configuration cannot claim an alert was queued or delivered', async () => {
  const service = createWorkspacePushService({ env: {}, db: { query: async () => { throw new Error('No DB required'); } } });
  assert.deepEqual(await service.queue('booking_request:501', { adminIds: [1] }), { queued: 0, accepted: 0, failed: 0 });
});

test('every received wake displays a generic notification despite expired session, network failure or zero-pending races', async t => {
  const vm=require('node:vm');
  for (const mode of ['expired-session','network-failure','zero-pending','missing-subscription','android-normal']) await t.test(mode, async()=>{
    const handlers={},shown=[],opened=[];let fetches=0,reads=0;
    const self={addEventListener:(name,handler)=>{handlers[name]=handler;},registration:{
      pushManager:{getSubscription:async()=>{reads++;return mode==='missing-subscription'?null:{endpoint:'https://push.example/device'};}},
      showNotification:async(...args)=>{shown.push(args);},
    },clients:{openWindow:async url=>opened.push(url)}};
    vm.runInNewContext(workspacePwaServiceWorkerScript(),{self,AbortController,setTimeout,clearTimeout,fetch:async()=>{fetches++;if(mode==='network-failure')throw Error('offline');return {ok:mode!=='expired-session',status:401,json:async()=>({count:0})};}});
    let completion;const waits=[];handlers.push({waitUntil:value=>waits.push(value)});await Promise.all(waits);
    assert.deepEqual(shown.map(([title,options])=>[title,options.body,options.tag,options.data.url]),[['Shiloh Workspace','Open Workspace to review updates.','shiloh-workspace-attention','/calendar/workspace']]);
    assert.equal(fetches,mode==='missing-subscription'?0:1);assert.equal(reads,1);
    let closed=false;handlers.notificationclick({notification:{close(){closed=true;}},waitUntil:value=>{completion=value;}});await completion;
    assert.equal(closed,true);assert.deepEqual(opened,['/calendar/workspace']);
  });
});

test('device status is a read-only enabled-registration check scoped to the current eligible account',async t=>{
  const {PGlite}=require('@electric-sql/pglite');const pg=new PGlite();t.after(()=>pg.close());
  await pg.exec(`CREATE TABLE workspace_push_subscriptions(id INT,admin_id INT,endpoint TEXT,enabled BOOLEAN,last_notification_id INT);
    INSERT INTO workspace_push_subscriptions VALUES(1,1,'https://push.example.com/current',TRUE,42),(2,1,'https://push.example.com/disabled',FALSE,43),(3,2,'https://push.example.com/other',TRUE,44);`);
  const {db,queries}=fixture();const principal=db.query;db.query=async(sql,params)=>sql.includes('calendarAuthorization:principal')?principal(sql,params):pg.query(sql,params);
  const service=createWorkspacePushService({db,env:{}});
  const before=(await pg.query('SELECT * FROM workspace_push_subscriptions ORDER BY id')).rows;
  for(const [adminId,endpoint,enabled] of [[1,'current',true],[1,'disabled',false],[1,'other',false],[1,'missing',false],[3,'current',false]]) {
    assert.deepEqual(await service.status({adminId,endpoint:'https://push.example.com/'+endpoint}),{enabled});
  }
  assert.deepEqual(await service.status({adminId:1,endpoint:'http://127.0.0.1/invalid'}),{enabled:false});
  assert.deepEqual((await pg.query('SELECT * FROM workspace_push_subscriptions ORDER BY id')).rows,before);
  assert.ok(queries.some(([sql])=>sql.includes('calendarAuthorization:principal')));
});

test('read-only device status keeps session/origin protections and ignores a supplied account identity',async t=>{
  const express=require('express');const {createWorkspacePwaRouter}=require('../src/routes/workspacePwa');
  const calls=[];const app=express();app.use(express.json());
  app.use('/calendar/pwa',createWorkspacePwaRouter({env:{},sessionService:{validateSessionToken:async token=>token==='synthetic'?{ok:true,adminId:1}:{ok:false}},pushService:{status:async input=>{calls.push(input);return {enabled:true};}}}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin='http://127.0.0.1:'+server.address().port;
  async function request(headers){return fetch(origin+'/calendar/pwa/push/status',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...headers},body:JSON.stringify({endpoint:'https://push.example.com/current',adminId:2})});}
  assert.equal((await request({})).status,401);
  assert.equal((await request({Cookie:'shiloh_staff_session=synthetic',Origin:'https://other.example'})).status,403);
  const response=await request({Cookie:'shiloh_staff_session=synthetic'});assert.equal(response.status,200);
  assert.match(response.headers.get('cache-control'),/private, no-store/);assert.deepEqual(await response.json(),{enabled:true});
  assert.deepEqual(calls,[{adminId:1,endpoint:'https://push.example.com/current'}]);
});

test('alert context describes categories only, preserves batches and falls back for malformed data or a stalled fetch', async t => {
  const vm = require('node:vm');
  const fallback = 'Open Workspace to review updates.';
  const cases = [
    [{count:1,categories:['booking_request']}, 'Booking request update. Open Workspace to review.'],
    [{count:2,categories:['planning','handoff']}, 'Appointment planning update. Reception update. Open Workspace to review.'],
    [{count:5,categories:['booking_request','planning','handoff']}, 'Booking request update. Appointment planning update. Reception update. Open Workspace to review.'],
    [{count:1,categories:['booking_request','booking_request']}, 'Booking request update. Open Workspace to review.'],
    [{count:0,categories:['booking_request']}, fallback],
    [{count:1,categories:['private client name']}, fallback],
    [{count:1,categories:['__proto__']}, fallback],
    [{count:1}, fallback],
    ['stalled', fallback],
  ];
  for (const [result, expected] of cases) await t.test(JSON.stringify(result), async () => {
    const handlers={}, shown=[], waits=[]; let timer, signal;
    const self={addEventListener:(name,handler)=>{handlers[name]=handler;},registration:{
      pushManager:{getSubscription:async()=>({endpoint:'https://push.example.com/device'})},
      showNotification:async(...args)=>shown.push(args),
    }};
    vm.runInNewContext(workspacePwaServiceWorkerScript(), {self,AbortController,
      setTimeout:(callback,delay)=>{assert.equal(delay,1500);timer=callback;return 1;},clearTimeout:()=>{},
      fetch:async(url,options)=>{
        assert.equal(url,'/calendar/pwa/push/pending');
        assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');
        assert.deepEqual(JSON.parse(options.body),{endpoint:'https://push.example.com/device'});
        signal=options.signal;
        return result==='stalled'?new Promise(()=>{}):{ok:true,json:async()=>({...result,clientName:'Never display this',url:'https://evil.example'})};
      },
    });
    handlers.push({waitUntil:value=>waits.push(value)});
    if(result==='stalled'){await Promise.resolve();timer();}
    await Promise.all(waits);
    assert.equal(shown.length,1);assert.equal(shown[0][1].body,expected);
    assert.equal(shown[0][1].data.url,'/calendar/workspace');
    assert.doesNotMatch(JSON.stringify(shown),/Never display|evil.example/);
    if(result==='stalled')assert.equal(signal.aborted,true);
  });
});

test('pending context reads only the current account subscription and returns no event IDs or private record fields',async t=>{
  const {PGlite}=require('@electric-sql/pglite');const pg=new PGlite();t.after(()=>pg.close());
  await pg.exec(`CREATE TABLE workspace_push_subscriptions(id INT,admin_id INT,endpoint TEXT,enabled BOOLEAN,last_notification_id INT);
    CREATE TABLE workspace_push_notifications(id INT,admin_id INT,event_key TEXT,created_at TIMESTAMPTZ DEFAULT NOW());
    INSERT INTO workspace_push_subscriptions VALUES(1,1,'https://push.example.com/current',TRUE,0),(2,2,'https://push.example.com/other',TRUE,0);
    INSERT INTO workspace_push_notifications(id,admin_id,event_key) VALUES(1,1,'booking_request:91'),(2,1,'planning:92'),(3,2,'handoff:93'),(4,1,'unknown:94');`);
  const {db}=fixture();const principal=db.query;db.query=async(sql,params)=>sql.includes('calendarAuthorization:principal')?principal(sql,params):pg.query(sql,params);
  const service=createWorkspacePushService({db,env:{}});
  assert.deepEqual(await service.pending({adminId:1,endpoint:'https://push.example.com/other'}),{count:0});
  assert.deepEqual(await service.pending({adminId:3,endpoint:'https://push.example.com/current'}),{count:0});
  assert.deepEqual(await service.pending({adminId:1,endpoint:'https://push.example.com/current'}),{count:3,categories:['booking_request','planning']});
  assert.deepEqual(await service.pending({adminId:1,endpoint:'https://push.example.com/current'}),{count:0,categories:[]});
  assert.deepEqual((await pg.query('SELECT last_notification_id FROM workspace_push_subscriptions ORDER BY id')).rows,[{last_notification_id:4},{last_notification_id:0}]);
});
