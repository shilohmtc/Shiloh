'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { createMyShilohBookingService } = require('../src/services/myShilohBooking');

async function fixture(t) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`
    CREATE TABLE crm_v2_clients(id BIGINT PRIMARY KEY,name TEXT,normalized_mobile TEXT,status TEXT,profile_status TEXT,date_of_birth DATE,gender TEXT,provenance JSONB);
    CREATE TABLE appointments(id BIGINT PRIMARY KEY,crm_v2_client_id BIGINT,status TEXT);
    CREATE TABLE client_browser_sessions(id BIGINT,crm_v2_client_id BIGINT,issued_at TIMESTAMPTZ,expires_at TIMESTAMPTZ,revoked_at TIMESTAMPTZ);
    INSERT INTO client_browser_sessions VALUES (1,55,NOW()-INTERVAL '1 minute',NOW()+INTERVAL '1 hour',NULL),(2,56,NOW()-INTERVAL '1 minute',NOW()+INTERVAL '1 hour',NULL);
    CREATE TABLE booking_intents(phone TEXT PRIMARY KEY,service_text TEXT,preferred_date TEXT,preferred_time TEXT,therapist_text TEXT,service_verified BOOLEAN,status TEXT,policy_version TEXT,policy_accepted_at TIMESTAMPTZ,policy_channel TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE client_auth_security_events(event_type TEXT,crm_v2_client_id BIGINT,metadata JSONB);
    INSERT INTO crm_v2_clients VALUES (55,'Synthetic Client','27821234567','active','registered','1981-01-04','female','{}'),(56,'Other Client','27821234568','active','registered','1981-01-04','female','{}');
    INSERT INTO appointments VALUES (812,55,'scheduled');
    INSERT INTO booking_intents(phone,service_text,status,policy_channel,created_at) VALUES
      ('27821234567','Synthetic unfinished treatment','collecting',NULL,'2026-01-01 00:00:00.123456+00'),
      ('27821234568','Other private treatment','policy_accepted','whatsapp','2026-01-02');
  `);
  const query = async (sql, values) => {
    const r = await pg.query(sql, values);
    return { rows: r.rows, rowCount: r.rows.length || r.affectedRows || 0 };
  };
  const db = { query, async connect() { return { query, release() {} }; } };
  const service = createMyShilohBookingService({ db, ensureIntentTable: async () => {} });
  return { pg, db, service };
}

test('only the authenticated canonical client draft is returned; explicit discard preserves appointments and other drafts', async t => {
  const h = await fixture(t);
  const before = (await h.pg.query('SELECT * FROM appointments')).rows;
  const { draft } = await h.service.unfinishedDraft({ crmV2ClientId: 55 });
  assert.equal(draft.treatment, 'Synthetic unfinished treatment');
  assert.equal(draft.canDiscard, true);
  assert.match(draft.revision, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(draft).includes('27821234567'));
  assert.deepEqual(await h.service.discardDraft({ crmV2ClientId: 55, sessionId: 1, revision: draft.revision }), { discarded: true });
  assert.deepEqual((await h.pg.query('SELECT * FROM appointments')).rows, before);
  assert.deepEqual((await h.pg.query('SELECT phone FROM booking_intents')).rows, [{ phone: '27821234568' }]);
  const audit = (await h.pg.query('SELECT * FROM client_auth_security_events')).rows;
  assert.equal(audit[0].event_type, 'booking_draft_discarded');
  assert.equal(Number(audit[0].crm_v2_client_id), 55);
  assert.deepEqual(audit[0].metadata, { status: 'collecting' });
});

test('cross-client, malformed, changed, replaced and already-consumed drafts fail without clearing another intent', async t => {
  const h = await fixture(t);
  const { draft } = await h.service.unfinishedDraft({ crmV2ClientId: 55 });
  await assert.rejects(h.service.discardDraft({ crmV2ClientId: 56, sessionId: 2, revision: draft.revision }), { code: 'BOOKING_DRAFT_CHANGED' });
  await assert.rejects(h.service.discardDraft({ crmV2ClientId: 55, sessionId: 1, revision: 'bad' }), { code: 'BOOKING_DRAFT_INVALID' });
  await h.pg.exec("UPDATE booking_intents SET updated_at=updated_at+INTERVAL '1 microsecond' WHERE phone='27821234567'");
  await assert.rejects(h.service.discardDraft({ crmV2ClientId: 55, sessionId: 1, revision: draft.revision }), { code: 'BOOKING_DRAFT_CHANGED' });
  const refreshed = (await h.service.unfinishedDraft({ crmV2ClientId: 55 })).draft;
  await h.pg.exec("UPDATE booking_intents SET created_at=created_at+INTERVAL '1 microsecond' WHERE phone='27821234567'");
  await assert.rejects(h.service.discardDraft({ crmV2ClientId: 55, sessionId: 1, revision: refreshed.revision }), { code: 'BOOKING_DRAFT_CHANGED' });
  await h.pg.exec("DELETE FROM booking_intents WHERE phone='27821234567'");
  await assert.rejects(h.service.discardDraft({ crmV2ClientId: 55, sessionId: 1, revision: refreshed.revision }), { code: 'BOOKING_DRAFT_CHANGED' });
  assert.equal((await h.pg.query('SELECT * FROM booking_intents')).rows.length, 1);
  assert.equal((await h.pg.query('SELECT * FROM client_auth_security_events')).rows.length, 0);
});

test('unknown states stay protected; audit failure rolls the discard back', async t => {
  const h = await fixture(t);
  await h.pg.exec("UPDATE booking_intents SET status='unknown_state' WHERE phone='27821234567'");
  const { draft } = await h.service.unfinishedDraft({ crmV2ClientId: 55 });
  assert.equal(draft.canDiscard, false);
  await assert.rejects(h.service.discardDraft({ crmV2ClientId: 55, sessionId: 1, revision: draft.revision }), { code: 'BOOKING_DRAFT_CHANGED' });
  await h.pg.exec("UPDATE booking_intents SET status='collecting' WHERE phone='27821234567'; DROP TABLE client_auth_security_events");
  const refreshed = (await h.service.unfinishedDraft({ crmV2ClientId: 55 })).draft;
  await assert.rejects(h.service.discardDraft({ crmV2ClientId: 55, sessionId: 1, revision: refreshed.revision }));
  assert.equal((await h.pg.query("SELECT * FROM booking_intents WHERE phone='27821234567'")).rows.length, 1);
});

test('discard rechecks canonical mobile after the intent lock', async t => {
  const h = await fixture(t);
  const revision = (await h.service.unfinishedDraft({ crmV2ClientId: 55 })).draft.revision;
  const db = { query: h.db.query, async connect() { return { release() {}, async query(sql, values) {
    const result = await h.db.query(sql, values);
    if (sql.includes('booking_intents') && sql.includes('FOR UPDATE')) await h.pg.exec("UPDATE crm_v2_clients SET normalized_mobile='27821234569' WHERE id=55");
    return result;
  } }; } };
  const service = createMyShilohBookingService({ db, ensureIntentTable: async () => {} });
  await assert.rejects(service.discardDraft({ crmV2ClientId: 55, sessionId: 1, revision }), { code: 'BOOKING_DRAFT_CHANGED' });
  assert.equal((await h.pg.query('SELECT * FROM booking_intents')).rows.length, 2);
});

test('failed native booking cleanup preserves a replacement draft', async t => {
  const h = await fixture(t);
  await h.pg.exec("DELETE FROM booking_intents WHERE phone='27821234567'");
  const startsAt = '2026-11-02T08:00:00.000Z';
  const db = { async query(sql, values) {
    if (sql.includes('FROM services s')) return { rows: [{ id: 7, name: 'Synthetic treatment', status: 'active', price: '650.00', duration_minutes: 60 }], rowCount: 1 };
    if (sql.includes('FROM staff') && sql.includes('tenant_practitioner')) return { rows: [{ id: 11 }], rowCount: 1 };
    return h.db.query(sql, values);
  } };
  const service = createMyShilohBookingService({ db,
    eligibleStaff: async () => [{ id: 11, display_name: 'Synthetic practitioner' }],
    availability: async () => ({ status: 'available', slots: [{ staff_id: 11, starts_at: startsAt, ends_at: '2026-11-02T09:00:00.000Z' }] }),
    ensureIntentTable: async () => {}, ensurePolicy: async () => {}, acceptPolicy: async () => true,
    commitBooking: async () => {
      await h.pg.exec("DELETE FROM booking_intents WHERE phone='27821234567'; INSERT INTO booking_intents(phone,service_text,status,created_at) VALUES('27821234567','Replacement draft','collecting','2026-12-01')");
      throw new Error('synthetic failed attempt');
    }, now: () => new Date('2026-10-13T00:00:00Z') });
  await assert.rejects(service.createRequest({ crmV2ClientId: 55, serviceId: 7, staffId: 11, startsAt, policyAccepted: true, specialOccasion: false }), /synthetic failed attempt/);
  assert.equal((await h.pg.query("SELECT service_text FROM booking_intents WHERE phone='27821234567'")).rows[0].service_text, 'Replacement draft');
});

test('draft routes require session, same origin and CSRF; callers cannot choose client or phone', async t => {
  const express = require('express');
  const { createMyShilohRouter } = require('../src/routes/myShiloh');
  const received = [];
  const app = express(); app.use(express.json());
  app.use(createMyShilohRouter({ env: { NODE_ENV: 'test' }, sessionService: {
    validateSessionToken: async token => token === 'signed-in' ? { ok: true, crmV2ClientId: 55, sessionId: 1 } : { ok: false },
    validateCsrfToken: (_session, token) => token === 'valid-csrf',
  }, bookingService: {
    unfinishedDraft: async input => { received.push(input); return { draft: null }; },
    discardDraft: async input => { received.push(input); return { discarded: true }; },
  } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = { origin, cookie: 'shiloh_client_session=signed-in', 'x-shiloh-csrf-token': 'valid-csrf', 'content-type': 'application/json' };
  const post = (payload, overrides = {}) => fetch(origin + '/my-shiloh/api/booking/unfinished-draft/discard', { method: 'POST', headers: { ...headers, ...overrides }, body: JSON.stringify(payload) });
  const revision = 'a'.repeat(64);
  assert.equal((await post({ revision }, { cookie: '' })).status, 401);
  assert.equal((await post({ revision }, { origin: 'https://untrusted.invalid' })).status, 403);
  assert.equal((await post({ revision }, { 'x-shiloh-csrf-token': '' })).status, 403);
  assert.equal((await post({ revision, crmV2ClientId: 56 })).status, 422);
  assert.equal((await post({ revision, phone: '27821234568' })).status, 422);
  assert.equal(received.length, 0);
  const get = await fetch(origin + '/my-shiloh/api/booking/unfinished-draft?crmV2ClientId=56', { headers });
  assert.equal(get.status, 200); assert.match(get.headers.get('cache-control'), /no-store/);
  assert.equal((await post({ revision })).status, 200);
  assert.deepEqual(received, [{ crmV2ClientId: 55 }, { crmV2ClientId: 55, sessionId: 1, revision }]);
});


test('expired, revoked and foreign persisted sessions cannot discard a draft', async t => {
  const h = await fixture(t);
  const revision = (await h.service.unfinishedDraft({ crmV2ClientId: 55 })).draft.revision;
  await assert.rejects(h.service.discardDraft({ crmV2ClientId: 55, sessionId: 2, revision }), { code: 'BOOKING_DRAFT_SESSION_EXPIRED' });
  await h.pg.exec("UPDATE client_browser_sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE id=1");
  await assert.rejects(h.service.discardDraft({ crmV2ClientId: 55, sessionId: 1, revision }), { code: 'BOOKING_DRAFT_SESSION_EXPIRED' });
  await h.pg.exec("UPDATE client_browser_sessions SET expires_at=NOW()+INTERVAL '1 hour',revoked_at=NOW() WHERE id=1");
  await assert.rejects(h.service.discardDraft({ crmV2ClientId: 55, sessionId: 1, revision }), { code: 'BOOKING_DRAFT_SESSION_EXPIRED' });
  assert.equal((await h.pg.query('SELECT * FROM booking_intents')).rows.length, 2);
});
