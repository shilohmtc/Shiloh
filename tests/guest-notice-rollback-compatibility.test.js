const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { createMyShilohPushService } = require('../src/services/myShilohPush');

test('rollback readers suppress unsupported guest notices, advance past them and retain ordinary notification history', async t => {
  const sql = new PGlite();
  t.after(() => sql.close());
  const db = { query: async (...args) => { const r = await sql.query(...args); return { ...r, rowCount: r.rows.length || r.affectedRows || 0 }; } };
  await sql.exec('CREATE TABLE crm_v2_clients(id BIGINT PRIMARY KEY);INSERT INTO crm_v2_clients VALUES(201)');
  await sql.exec(fs.readFileSync(require.resolve('../migrations/149_my_shiloh_push_notifications.sql'), 'utf8'));
  const push = createMyShilohPushService({ db, env: {} });
  const base = { crmV2ClientId: 201, category: 'appointment', title: 'Synthetic notice', body: 'Synthetic booking update.', deferWake: true };
  await push.queueNotification({ ...base, eventKey: 'guest-booking:booking_confirmation:' + 'a'.repeat(64) });
  const ordinary = await push.queueNotification({ ...base, eventKey: 'ordinary-appointment' });
  const latest = await push.queueNotification({ ...base, eventKey: 'guest-booking:appointment_reminder:' + 'b'.repeat(64) });
  const endpoint = 'https://push.example.test/synthetic-rollback';
  await db.query("INSERT INTO my_shiloh_push_subscriptions(crm_v2_client_id,endpoint,p256dh,auth) VALUES(201,$1,'synthetic-key','synthetic-auth')", [endpoint]);
  assert.deepEqual((await push.pending({ crmV2ClientId: 201, endpoint })).notifications.map(r => r.id), [ordinary.notificationId]);
  assert.equal(Number((await db.query('SELECT last_notification_id FROM my_shiloh_push_subscriptions')).rows[0].last_notification_id), latest.notificationId);
  await db.query("UPDATE my_shiloh_push_notifications SET expires_at=NOW()-INTERVAL '1 day' WHERE id=$1", [ordinary.notificationId]);
  assert.deepEqual((await push.listForClient({ crmV2ClientId: 201 })).notifications.map(r => r.id), [ordinary.notificationId]);
  assert.deepEqual((await push.pending({ crmV2ClientId: 201, endpoint })).notifications, []);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM my_shiloh_push_notifications')).rows[0].n, 3);
});
