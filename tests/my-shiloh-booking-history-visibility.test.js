'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');
const {
  MyShilohBookingHistoryVisibilityError,
  normalizeVisibilityPayload,
  createMyShilohBookingHistoryVisibilityService,
} = require('../src/services/myShilohBookingHistoryVisibility');
const { createMyShilohClientContextService } = require('../src/services/myShilohClientContext');
const { buildClientExperience } = require('../src/services/myShilohExperienceOrchestrator');
const { createMyShilohRouter } = require('../src/routes/myShiloh');

const NOW = new Date('2026-10-06T12:00:00.000Z');
const migration = fs.readFileSync(path.join(__dirname, '../migrations/186_my_shiloh_booking_history_visibility.sql'), 'utf8');

function experience(declinedRequests) {
  return buildClientExperience({
    generatedAt: NOW.toISOString(), client: { id: 55, name: 'Client A' },
    declinedRequests, nextAppointment: null, forms: [], payment: null,
  });
}

async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE crm_v2_clients (id bigint PRIMARY KEY,name text,status text,mobile_verified_at timestamptz);
    CREATE TABLE client_browser_sessions (id bigint PRIMARY KEY,crm_v2_client_id bigint,revoked_at timestamptz,expires_at timestamptz);
    CREATE TABLE appointments (id bigint PRIMARY KEY,crm_v2_client_id bigint,client_id bigint,status text,starts_at timestamptz,ends_at timestamptz,total_price numeric,currency text);
    CREATE TABLE appointment_booking_approvals (appointment_id bigint PRIMARY KEY,status text,decision_note text,requested_starts_at timestamptz,requested_ends_at timestamptz,decided_at timestamptz);
    CREATE TABLE appointment_services (id bigint,appointment_id bigint,service_name_snapshot text,position int);
    CREATE TABLE appointment_staff (id bigint,appointment_id bigint,staff_name_snapshot text,position int);
    CREATE TABLE appointment_payment_accounts (id bigint,appointment_id bigint,amount_due numeric);
    CREATE TABLE consultation_form_assignments (id bigint,appointment_id bigint,status text);
    INSERT INTO crm_v2_clients VALUES
      (55,'Client A','active','2026-01-01'),(56,'Client B','active','2026-01-01'),
      (57,'Unverified','active',NULL),(58,'Archived','archived','2026-01-01');
    INSERT INTO client_browser_sessions VALUES
      (8,55,NULL,'2099-01-01'),(9,56,NULL,'2099-01-01'),
      (10,55,NULL,'2025-01-01'),(11,55,'2026-01-01','2099-01-01'),
      (12,57,NULL,'2099-01-01'),(13,58,NULL,'2099-01-01'),(14,55,NULL,'2099-01-01');
    INSERT INTO appointments
      SELECT n,CASE WHEN n=902 THEN 56 WHEN n=914 THEN 57 WHEN n=915 THEN 58 ELSE 55 END,
        CASE WHEN n=911 THEN 88 ELSE NULL END,
        CASE n WHEN 903 THEN 'scheduled' WHEN 904 THEN 'confirmed' WHEN 905 THEN 'completed' WHEN 906 THEN 'no_show' ELSE 'cancelled' END,
        '2026-10-02T08:00:00Z','2026-10-02T09:00:00Z',550,'ZAR'
      FROM generate_series(901,915) n;
    INSERT INTO appointment_booking_approvals
      SELECT n,CASE n WHEN 907 THEN 'approved' WHEN 908 THEN 'pending' ELSE 'declined' END,
        CASE WHEN n=909 THEN 'client_cancelled' ELSE 'workspace_cannot_accommodate' END,
        CASE WHEN n=910 THEN NULL ELSE '2026-10-02T08:00:00Z'::timestamptz END,
        '2026-10-02T09:00:00Z','2026-10-01T08:00:00Z'
      FROM generate_series(901,915) n WHERE n<>912;
    INSERT INTO appointment_services SELECT n,n,'Massage',1 FROM generate_series(901,915) n;
    INSERT INTO appointment_staff SELECT n,n,'Therapist',1 FROM generate_series(901,915) n;
    INSERT INTO appointment_payment_accounts VALUES (1,901,100),(2,904,200);
    INSERT INTO consultation_form_assignments VALUES (1,901,'completed'),(2,904,'sent');
  `);
  // Execute the exact additive migration only in this disposable PostgreSQL fixture.
  await db.exec(migration);
  return db;
}

async function canonicalSnapshot(db) {
  const tables = ['crm_v2_clients', 'client_browser_sessions', 'appointments', 'appointment_booking_approvals',
    'appointment_services', 'appointment_staff', 'appointment_payment_accounts', 'consultation_form_assignments'];
  return Object.fromEntries(await Promise.all(tables.map(async table => [table, (await db.query(`SELECT * FROM ${table} ORDER BY 1`)).rows])));
}

async function startApp(t, options) {
  const app = express();
  app.use(express.json());
  app.use(createMyShilohRouter({ env: { NODE_ENV: 'test' }, ...options }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    send(payload = { appointmentId: 901, hidden: false }, headers = {}) {
      return fetch(`${origin}/my-shiloh/api/booking-history/visibility`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin, cookie: 'shiloh_client_session=session',
          'x-shiloh-csrf-token': 'csrf', ...headers },
        body: JSON.stringify(payload),
      });
    },
  };
}

function sessionService() {
  return {
    async validateSessionToken(token) {
      return token === 'session' || token === 'second-device'
        ? { ok: true, crmV2ClientId: 55, sessionId: token === 'session' ? 8 : 14 }
        : { ok: false };
    },
    validateCsrfToken(_session, supplied) { return supplied === 'csrf'; },
  };
}

test('visibility payload accepts only an appointment ID and a real boolean', async () => {
  assert.deepEqual(normalizeVisibilityPayload({ appointmentId: '901', hidden: false }), { appointmentId: 901, hidden: false });
  const invalid = [undefined, null, [], {}, '901', 901, true,
    { appointmentId: 901 }, { hidden: true },
    ...['true', 'false', 0, 1, null, [], {}].map(hidden => ({ appointmentId: 901, hidden })),
    ...[true, [], {}, null, '', ' 901', '901 ', '9e2', '901.0', '0x385', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map(appointmentId => ({ appointmentId, hidden: true })),
    { appointmentId: 901, hidden: true, crmV2ClientId: 56 },
    { appointmentId: 901, hidden: true, sessionId: 9 },
    { appointmentId: 901, hidden: true, remove: true },
  ];
  for (const payload of invalid) {
    assert.throws(() => normalizeVisibilityPayload(payload), { code: 'MY_SHILOH_BOOKING_HISTORY_INPUT_INVALID', httpStatus: 422 });
  }
  const service = createMyShilohBookingHistoryVisibilityService({ db: { async query() { assert.fail('Invalid input must not query'); } } });
  await assert.rejects(service.setVisibility({ sessionId: 8, crmV2ClientId: 55, appointmentId: [], hidden: true }), MyShilohBookingHistoryVisibilityError);
  await assert.rejects(service.setVisibility({ sessionId: null, crmV2ClientId: 55, appointmentId: 901, hidden: true }), { httpStatus: 401 });
});

test('PostgreSQL preferences persist across reloads/devices, repeat idempotently, and leave staff records untouched', async t => {
  const db = await fixture(t);
  const before = await canonicalSnapshot(db);
  const service = createMyShilohBookingHistoryVisibilityService({ db, now: () => NOW });
  const context = createMyShilohClientContextService({ db });
  const app = await startApp(t, {
    sessionService: sessionService(), bookingHistoryVisibilityService: service,
    experienceService: { async getExperience({ crmV2ClientId }) { return experience(await context.loadDeclinedBookingRequests(crmV2ClientId)); } },
  });
  const load = async token => {
    const response = await fetch(`${app.origin}/my-shiloh/api/experience`, { headers: { cookie: `shiloh_client_session=${token}` } });
    assert.equal(response.status, 200);
    return response.json();
  };
  const initial = await load('session');
  assert.deepEqual(initial.bookings.history.map(item => item.id), [913, 901]);
  assert.ok(initial.bookings.history.every(item => item.hidden && item.canChangeVisibility));
  assert.deepEqual(initial.bookings.upcoming, []);
  assert.equal((await db.query('SELECT * FROM my_shiloh_booking_history_visibility')).rows.length, 0);

  let response = await app.send();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.deepEqual(await response.json(), { appointmentId: 901, hidden: false });
  const restored = await load('second-device');
  assert.equal(restored.bookings.history.find(item => item.id === 901).hidden, false);
  assert.equal(restored.bookings.history.find(item => item.id === 913).hidden, true);
  const saved = (await db.query('SELECT * FROM my_shiloh_booking_history_visibility')).rows;
  response = await app.send();
  assert.deepEqual(await response.json(), { appointmentId: 901, hidden: false });
  assert.deepEqual((await db.query('SELECT * FROM my_shiloh_booking_history_visibility')).rows, saved);

  response = await app.send({ appointmentId: 901, hidden: true }, { cookie: 'shiloh_client_session=second-device' });
  assert.deepEqual(await response.json(), { appointmentId: 901, hidden: true });
  assert.equal((await load('session')).bookings.history.find(item => item.id === 901).hidden, true);
  const rehidden = (await db.query('SELECT * FROM my_shiloh_booking_history_visibility')).rows;
  const repeated = await Promise.all([true, true].map(hidden => service.setVisibility({ sessionId: 8, crmV2ClientId: 55, appointmentId: 901, hidden })));
  assert.deepEqual(repeated, [{ appointmentId: 901, hidden: true }, { appointmentId: 901, hidden: true }]);
  assert.deepEqual((await db.query('SELECT * FROM my_shiloh_booking_history_visibility')).rows, rehidden);
  assert.deepEqual(await canonicalSnapshot(db), before);
});

test('PostgreSQL mutations reject foreign, missing, active, nonlegacy and stale identities without changing preferences', async t => {
  const db = await fixture(t);
  const before = await canonicalSnapshot(db);
  const service = createMyShilohBookingHistoryVisibilityService({ db, now: () => NOW });
  let unavailable;
  for (const appointmentId of [9999, 902, 903, 904, 905, 906, 907, 908, 909, 910, 911, 912]) {
    for (const hidden of [true, false]) {
      await assert.rejects(service.setVisibility({ sessionId: 8, crmV2ClientId: 55, appointmentId, hidden }), error => {
        const result = { code: error.code, message: error.message, httpStatus: error.httpStatus };
        if (!unavailable) unavailable = result;
        assert.deepEqual(result, unavailable);
        assert.equal(error.httpStatus, 404);
        return true;
      });
    }
  }
  for (const input of [
    { sessionId: 9, crmV2ClientId: 55, appointmentId: 901 },
    { sessionId: 8, crmV2ClientId: 56, appointmentId: 902 },
    { sessionId: 10, crmV2ClientId: 55, appointmentId: 901 },
    { sessionId: 11, crmV2ClientId: 55, appointmentId: 901 },
    { sessionId: 12, crmV2ClientId: 57, appointmentId: 914 },
    { sessionId: 13, crmV2ClientId: 58, appointmentId: 915 },
  ]) {
    await assert.rejects(service.setVisibility({ ...input, hidden: true }), { code: unavailable.code, httpStatus: 404 });
  }
  assert.deepEqual((await db.query('SELECT * FROM my_shiloh_booking_history_visibility')).rows, []);
  assert.deepEqual(await canonicalSnapshot(db), before);

  // A stale card cannot hide a request after its canonical state changes.
  await service.setVisibility({ sessionId: 8, crmV2ClientId: 55, appointmentId: 901, hidden: false });
  await db.exec("UPDATE appointments SET status='confirmed' WHERE id=901");
  await assert.rejects(service.setVisibility({ sessionId: 8, crmV2ClientId: 55, appointmentId: 901, hidden: true }), { httpStatus: 404 });
  assert.equal((await db.query('SELECT hidden FROM my_shiloh_booking_history_visibility WHERE appointment_id=901')).rows[0].hidden, false);
  assert.equal((await createMyShilohClientContextService({ db }).loadDeclinedBookingRequests(55)).some(item => item.id === 901), false);
  // Preferences for another owner must never influence the signed-in client's card.
  await db.exec("INSERT INTO my_shiloh_booking_history_visibility (crm_v2_client_id,appointment_id,hidden) VALUES (56,913,FALSE)");
  assert.equal((await createMyShilohClientContextService({ db }).loadDeclinedBookingRequests(55))[0].historyHidden, true);
});

test('history projection stays bounded to the existing five requests and does not grant controls to other states', async t => {
  const db = await fixture(t);
  await db.exec(`
    INSERT INTO appointments SELECT n,55,NULL,'cancelled','2026-10-02T08:00:00Z','2026-10-02T09:00:00Z',550,'ZAR' FROM generate_series(920,927) n;
    INSERT INTO appointment_booking_approvals SELECT n,'declined','workspace_cannot_accommodate','2026-10-02T08:00:00Z','2026-10-02T09:00:00Z','2026-10-01T08:00:00Z' FROM generate_series(920,927) n;
  `);
  const requests = await createMyShilohClientContextService({ db }).loadDeclinedBookingRequests(55);
  assert.deepEqual(requests.map(item => item.id), [927, 926, 925, 924, 923]);
  const valid = requests[0];
  for (const overrides of [
    { status: 'scheduled' }, { status: 'confirmed' }, { status: 'completed' },
    { bookingRequestStatus: 'pending' }, { bookingRequestStatus: 'approved' },
    { bookingRequestDecisionNote: 'client_cancelled' }, { bookingRequestDecisionNote: undefined },
  ]) {
    assert.equal(experience([{ ...valid, ...overrides }]).bookings.history[0].canChangeVisibility, false);
  }
  assert.equal(experience([{ ...valid, historyHidden: false }]).bookings.history[0].hidden, false);
  assert.equal(experience([{ ...valid, historyHidden: 'false' }]).bookings.history[0].hidden, true);
});

test('visibility endpoint requires same-origin session/CSRF, rejects extra fields, and forwards only trusted identity', async t => {
  const calls = [];
  const app = await startApp(t, {
    sessionService: sessionService(),
    bookingHistoryVisibilityService: {
      async setVisibility(input) {
        calls.push(input);
        if (input.appointmentId !== 901) throw new MyShilohBookingHistoryVisibilityError('MY_SHILOH_BOOKING_HISTORY_UNAVAILABLE', 'Unavailable.', 404);
        return { appointmentId: input.appointmentId, hidden: input.hidden };
      },
    },
  });
  assert.equal((await app.send(undefined, { cookie: '' })).status, 401);
  assert.equal((await app.send(undefined, { cookie: 'shiloh_client_session=expired' })).status, 401);
  assert.equal((await app.send(undefined, { 'x-shiloh-csrf-token': '' })).status, 403);
  assert.equal((await app.send(undefined, { 'x-shiloh-csrf-token': 'wrong' })).status, 403);
  assert.equal((await app.send(undefined, { origin: 'https://unrelated.invalid' })).status, 403);
  assert.equal((await app.send(undefined, { origin: '', 'sec-fetch-site': 'cross-site' })).status, 403);
  for (const payload of [[], {}, { appointmentId: 901, hidden: 'false' },
    { appointmentId: [], hidden: false },
    { appointmentId: 901, hidden: false, crmV2ClientId: 56 },
    { appointmentId: 901, hidden: false, sessionId: 9 },
    { appointmentId: 901, hidden: false, delete: true },
  ]) assert.equal((await app.send(payload)).status, 422);
  assert.equal(calls.length, 0);
  const response = await app.send({ appointmentId: '901', hidden: false });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { appointmentId: 901, hidden: false });
  assert.deepEqual(calls, [{ sessionId: 8, crmV2ClientId: 55, appointmentId: 901, hidden: false }]);
  assert.equal((await app.send({ appointmentId: 902, hidden: true })).status, 404);
});

test('visibility mutation locks eligibility atomically and migration adds only the display preference table', async () => {
  let captured;
  const db = { async query(sql, values) { captured = { sql, values }; return { rows: [{ appointment_id: 901, hidden: false }] }; } };
  await createMyShilohBookingHistoryVisibilityService({ db, now: () => NOW }).setVisibility({ sessionId: 8, crmV2ClientId: 55, appointmentId: 901, hidden: false });
  assert.match(captured.sql, /WITH eligible_request AS MATERIALIZED/);
  assert.match(captured.sql, /FOR UPDATE OF a,aba/);
  assert.match(captured.sql, /INSERT INTO my_shiloh_booking_history_visibility/);
  assert.match(captured.sql, /ON CONFLICT \(crm_v2_client_id,appointment_id\) DO UPDATE/);
  assert.deepEqual(captured.values, [8, 55, 901, false, NOW]);
  assert.doesNotMatch(captured.sql, /(?:UPDATE|DELETE FROM) (?:appointments|appointment_booking_approvals|crm_v2_clients|appointment_payment_accounts|consultation_form_assignments)\b/i);
  assert.match(migration, /PRIMARY KEY \(crm_v2_client_id, appointment_id\)/);
  assert.match(migration, /hidden BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.doesNotMatch(migration, /^\s*(?:UPDATE|DELETE FROM|INSERT INTO|ALTER TABLE)\b/im);
});
