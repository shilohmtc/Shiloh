'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { readClientAppStatus } = require('../src/services/workspaceClientAppStatus');
const scope = { kind: 'clinic', ownerStaffId: null };

test('profile evidence uses completed authenticated usage and current registered settings, across devices', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE crm_v2_clients(id int,status text);
      CREATE TABLE crm_v2_client_relationships(client_id int,status text,relationship_type text,owner_staff_id int);
      CREATE TABLE client_browser_sessions(crm_v2_client_id int,last_used_at timestamptz,issued_at timestamptz,expires_at timestamptz,revoked_at timestamptz);
      CREATE TABLE my_shiloh_push_subscriptions(crm_v2_client_id int,enabled boolean,revoked_at timestamptz,last_push_error text,endpoint text,p256dh text,auth text);
      INSERT INTO crm_v2_clients VALUES(901,'active'),(902,'active'),(903,'archived');
      INSERT INTO crm_v2_client_relationships VALUES(901,'active','clinic',NULL),(902,'active','tenant_staff',5),(903,'active','clinic',NULL);`);
    const read = (clientId = 901) => readClientAppStatus({ db, clientId, scope });
    assert.deepEqual(await read(), { usage: 'Not yet confirmed', phoneAlerts: 'Setup needed' });
    await db.exec(`INSERT INTO client_browser_sessions VALUES(901,NULL,NOW()-INTERVAL '1 day',NOW()+INTERVAL '1 day',NULL);`);
    assert.equal((await read()).usage, 'Not yet confirmed', 'mere session creation is not usage');
    await db.exec(`UPDATE client_browser_sessions SET last_used_at=NOW()-INTERVAL '1 hour';
      INSERT INTO my_shiloh_push_subscriptions VALUES(901,FALSE,NOW(),NULL,'https://push.example.test/revoked','synthetic','synthetic');`);
    assert.deepEqual(await read(), { usage: 'Used before', phoneAlerts: 'Setup needed' });
    await db.exec(`INSERT INTO my_shiloh_push_subscriptions VALUES(901,TRUE,NULL,'timeout','https://push.example.test/uncertain','synthetic','synthetic');`);
    assert.equal((await read()).phoneAlerts, 'Unknown');
    await db.exec(`INSERT INTO my_shiloh_push_subscriptions VALUES(901,TRUE,NULL,NULL,'https://push.example.test/current','synthetic','synthetic');`);
    assert.equal((await read()).phoneAlerts, 'Enabled', 'one current usable registration survives another revoked or uncertain device');
    assert.deepEqual(await read(902), { usage: 'Not yet confirmed', phoneAlerts: 'Unknown' }, 'private-only relationship cannot expose global account evidence');
    assert.deepEqual(await read(903), { usage: 'Not yet confirmed', phoneAlerts: 'Unknown' });
    await db.exec(`UPDATE crm_v2_client_relationships SET status='removed' WHERE client_id=901;`);
    assert.deepEqual(await read(), { usage: 'Not yet confirmed', phoneAlerts: 'Unknown' });
  } finally { await db.close(); }
});

test('private scope and unavailable evidence stay conservative without a data or permission change', async () => {
  let calls = 0;
  const db = { async query() { calls++; throw Error('unavailable'); } };
  const expected = { usage: 'Not yet confirmed', phoneAlerts: 'Unknown' };
  assert.deepEqual(await readClientAppStatus({ db, clientId: 901, scope: { kind: 'tenant_staff', ownerStaffId: 5 } }), expected);
  assert.equal(calls, 0);
  assert.deepEqual(await readClientAppStatus({ db, clientId: 901, scope }), expected);
  assert.equal(calls, 1);
});
