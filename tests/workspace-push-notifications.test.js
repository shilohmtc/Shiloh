'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createWorkspacePushService } = require('../src/services/workspacePush');
const { workspacePwaClientScript, workspacePwaServiceWorkerScript } = require('../src/presentation/workspacePwa');

function fixture() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
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

test('Workspace notification UI requests device permission on tap and the worker checks the live staff session', () => {
  const client=workspacePwaClientScript();
  const worker=workspacePwaServiceWorkerScript();
  new Function(client);
  new Function('self','caches','fetch','Response',worker);
  assert.match(client,/button\.addEventListener\('click'.*Notification\.requestPermission\(\)/s);
  assert.match(worker,/push\/pending/);
  assert.match(worker,/if\(response\.ok\)count=/);
  assert.doesNotMatch(worker,/client.*(?:name|phone|email)/i);
});
