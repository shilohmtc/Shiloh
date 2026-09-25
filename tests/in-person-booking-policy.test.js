'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const {
  createInPersonBookingPolicyService,
} = require('../src/services/inPersonBookingPolicy');

test('in-person future-booking terms reuse the canonical acceptance table and link new evidence', () => {
  const migration = read('migrations/155_in_person_booking_policy_acceptance_links.sql');
  assert.match(migration, /ALTER TABLE booking_policy_acceptances/);
  assert.match(migration, /crm_v2_client_id BIGINT REFERENCES crm_v2_clients/);
  assert.match(migration, /appointment_id BIGINT REFERENCES appointments/);
  assert.match(migration, /clinic_device','payment_link/);
  assert.doesNotMatch(migration, /CREATE TABLE[^;]*consent/i);
});

test('clinic-device acceptance is future-appointment scoped and client-linked', async () => {
  const calls = [];
  const acceptance = {
    id: 501,
    policy_version: '2026-09-25-v3',
    accepted_at: '2026-09-25T08:32:00.000Z',
    channel: 'clinic_device',
  };
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (sql.includes('SELECT id FROM appointments') && sql.includes('FOR UPDATE')) return { rows:[{ id:812 }], rowCount:1 };
      if (sql.includes('FROM appointments a') && sql.includes('JOIN crm_v2_clients')) {
        return { rows:[{
          id:812,
          status:'scheduled',
          starts_at:'2026-09-30T08:00:00.000Z',
          crm_v2_client_id:91,
          client_name:'Naledi Mokoena',
          normalized_mobile:'27821234567',
          client_status:'active',
          service_text:'Hot Stone Massage',
          therapist_text:'Christel',
        }], rowCount:1 };
      }
      if (sql.includes('FROM booking_policy_acceptances') && sql.includes('policy_version=$2')) {
        return { rows:[], rowCount:0 };
      }
      if (sql.includes('INSERT INTO booking_policy_acceptances')) {
        assert.deepEqual(params.slice(-2), [91, 812]);
        assert.match(sql, /'clinic_device'/);
        return { rows:[acceptance], rowCount:1 };
      }
      throw new Error('Unexpected SQL: ' + sql);
    },
    release() {},
  };
  const db = { async connect() { return client; }, query: client.query.bind(client) };
  const service = createInPersonBookingPolicyService({
    db,
    now: () => new Date('2026-09-25T10:00:00.000Z'),
  });
  const result = await service.recordClinicDeviceAcceptance({ appointmentId:812 });
  assert.equal(result.crmV2ClientId, 91);
  assert.equal(result.appointmentId, 812);
  assert.equal(result.acceptance.channel, 'clinic_device');
  assert.equal(calls.some(call => call.sql === 'COMMIT'), true);
});

test('clinic-device acceptance fails closed for a cancelled or started appointment', async () => {
  const db = {
    async query(sql) {
      if (sql.includes('FROM appointments a')) {
        return { rows:[{
          id:812,status:'cancelled',starts_at:'2026-09-30T08:00:00.000Z',
          crm_v2_client_id:91,client_name:'Naledi',normalized_mobile:'27821234567',
          client_status:'active',service_text:'Massage',therapist_text:'Christel',
        }] };
      }
      if (sql.includes('FROM booking_policy_acceptances')) return { rows:[] };
      throw new Error('Unexpected SQL: '+sql);
    },
  };
  const service = createInPersonBookingPolicyService({ db, now: () => new Date('2026-09-25T10:00:00.000Z') });
  await assert.rejects(
    service.appointmentContext(812),
    error => error.code === 'IN_PERSON_POLICY_APPOINTMENT_INACTIVE' && error.httpStatus === 409,
  );
});

test('payment-link acceptance records the same canonical client and appointment linkage', () => {
  const source = read('src/routes/paymentLinks.js');
  assert.match(source, /payer_crm_v2_client_id/);
  assert.match(source, /crm_v2_client_id,appointment_id/);
  assert.match(source, /channel IN \('clinic_device','payment_link'\)/);
  assert.doesNotMatch(source, /CREATE TABLE[^;]*consent/i);
});

test('clinic-device review remains staff-session guarded but client acknowledged', () => {
  const route = read('src/routes/calendarCreateBooking.js');
  const ux = read('src/presentation/inPersonBookingPolicyUx.js');
  assert.match(route, /router\.get\('\/policy\/:appointmentId', requireSession/);
  assert.match(route, /router\.post\('\/policy\/:appointmentId\/accept', sameOrigin, requireSession, requireCsrf/);
  assert.match(route, /req\.body\?\.accept !== true/);
  assert.match(ux, /client must read and tap the acknowledgement themselves/i);
  assert.match(ux, /staff must not accept on their behalf/i);
  assert.match(ux, /I have read and accept Shiloh’s Booking Policy &amp; Terms/);
});

test('Workspace client record exposes policy history and appointment readiness without a second source', () => {
  const service = read('src/services/workspaceClients.js');
  const ux = read('src/presentation/workspaceClientsUx.js');
  assert.match(service, /listClientAcceptanceHistory/);
  assert.match(service, /readinessForAppointments/);
  assert.match(ux, /Policies &amp; consents/);
  assert.match(ux, /Booking readiness/);
  assert.match(ux, /Terms accepted/);
  assert.match(ux, /Deposit received/);
  assert.match(ux, /Confirmed/);
});
