'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const {
  createBookingPolicyAcceptanceService,
  safeRequestKey,
} = require('../src/services/bookingPolicyAcceptance');
const {
  renderBookingPolicyAcceptancePage,
} = require('../src/presentation/bookingPolicyAcceptanceUx');
const {
  BOOKING_POLICY_TEXT,
  BOOKING_POLICY_VERSION,
  BOOKING_POLICY_UPDATED,
} = require('../src/config/bookingPolicyAuthority');

function fakeDb() {
  const state = {
    request: null,
    acceptance: null,
    acceptanceInserts: 0,
    audits: 0,
  };
  const identity = {
    id: 812,
    crm_v2_client_id: 901,
    starts_at: '2026-09-30T08:00:00.000Z',
    status: 'scheduled',
    source: 'shiloh_calendar',
    client_name: 'Test Client',
    normalized_mobile: '27821234567',
    client_status: 'active',
  };
  const db = {
    state,
    async connect() {
      return { query: db.query, release() {} };
    },
    async query(sql, params = []) {
      const text = String(sql);
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text.trim())) return { rows: [], rowCount: 0 };
      if (text.includes('FROM appointments a') && text.includes('JOIN crm_v2_clients c')) {
        return { rows: [identity], rowCount: 1 };
      }
      if (text.includes('INSERT INTO booking_policy_acceptance_requests')) {
        if (!state.request) {
          state.request = {
            appointment_id: 812,
            crm_v2_client_id: 901,
            phone_snapshot: '27821234567',
            policy_version: params[3],
            policy_text_snapshot: params[4],
            policy_updated_snapshot: params[5],
            clinic_request_key: params[6],
            client_request_key: params[7],
            created_by_admin_id: params[8],
            consumed_at: null,
            revoked_at: null,
            created_at: '2026-09-25T08:00:00.000Z',
          };
        }
        return { rows: [], rowCount: state.request ? 1 : 0 };
      }
      if (text.includes('FROM booking_policy_acceptance_requests') && text.includes('WHERE appointment_id=$1') && !text.includes('LEFT JOIN LATERAL')) {
        return { rows: state.request ? [state.request] : [], rowCount: state.request ? 1 : 0 };
      }
      if (text.includes('FROM booking_policy_acceptance_requests r') && text.includes('LEFT JOIN LATERAL') && text.includes('WHERE r.appointment_id=$1')) {
        if (!state.request) return { rows: [], rowCount: 0 };
        return {
          rows: [{
            ...state.request,
            acceptance_id: state.acceptance?.id || null,
            accepted_at: state.acceptance?.accepted_at || null,
            channel: state.acceptance?.channel || null,
          }],
          rowCount: 1,
        };
      }
      if (text.includes('FROM booking_policy_acceptance_requests r') && text.includes('JOIN appointments a') && text.includes('acceptance_channel')) {
        if (!state.request || ![state.request.clinic_request_key, state.request.client_request_key].includes(params[0])) {
          return { rows: [], rowCount: 0 };
        }
        return {
          rows: [{
            ...state.request,
            ...identity,
            acceptance_channel: params[0] === state.request.clinic_request_key ? 'clinic_device' : 'secure_link',
            accepted_at: state.acceptance?.accepted_at || null,
            accepted_channel: state.acceptance?.channel || null,
          }],
          rowCount: 1,
        };
      }
      if (text.includes('SELECT r.*') && text.includes('FROM booking_policy_acceptance_requests r') && text.includes('FOR UPDATE')) {
        if (!state.request || ![state.request.clinic_request_key, state.request.client_request_key].includes(params[0])) {
          return { rows: [], rowCount: 0 };
        }
        return {
          rows: [{
            ...state.request,
            acceptance_channel: params[0] === state.request.clinic_request_key ? 'clinic_device' : 'secure_link',
          }],
          rowCount: 1,
        };
      }
      if (text.includes('INSERT INTO booking_policy_acceptances')) {
        if (state.acceptance) return { rows: [], rowCount: 0 };
        state.acceptanceInserts += 1;
        state.acceptance = {
          id: 77,
          accepted_at: '2026-09-25T08:32:00.000Z',
          channel: params[2],
          policy_version: params[1],
        };
        return { rows: [state.acceptance], rowCount: 1 };
      }
      if (text.includes('FROM booking_policy_acceptances') && text.includes('WHERE appointment_id=$1')) {
        return { rows: state.acceptance ? [state.acceptance] : [], rowCount: state.acceptance ? 1 : 0 };
      }
      if (text.includes('UPDATE booking_policy_acceptance_requests')) {
        state.request.consumed_at = state.request.consumed_at || '2026-09-25T08:32:00.000Z';
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('INSERT INTO crm_audit_events')) {
        state.audits += 1;
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL in in-person policy fake: ${text}`);
    },
  };
  return db;
}

test('migration links canonical acceptance evidence without creating a second policy authority', () => {
  const migration = read('migrations/155_in_person_booking_policy_acceptance.sql');
  assert.match(migration, /ALTER TABLE booking_policy_acceptances/);
  assert.match(migration, /crm_v2_client_id BIGINT REFERENCES crm_v2_clients/);
  assert.match(migration, /appointment_id BIGINT REFERENCES appointments/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_policy_acceptances_appointment_version/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS booking_policy_acceptance_requests/);
  assert.match(migration, /policy_text_snapshot TEXT NOT NULL/);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS .*consent/i);
});

test('one future staff booking exposes two secure review channels but records one canonical acceptance', async () => {
  const db = fakeDb();
  let randomCounter = 1;
  const service = createBookingPolicyAcceptanceService({
    db,
    now: () => new Date('2026-09-25T08:00:00.000Z'),
    randomBytes: () => Buffer.alloc(32, randomCounter++),
  });
  const links = await service.ensureForAppointment({
    appointmentId: 812,
    crmV2ClientId: 901,
    phone: '082 123 4567',
    adminId: 14,
  });
  assert.match(links.clinicPath, /^\/booking-policy\/[A-Za-z0-9_-]{32,80}$/);
  assert.match(links.clientPath, /^\/booking-policy\/[A-Za-z0-9_-]{32,80}$/);
  assert.notEqual(links.clinicPath, links.clientPath);
  assert.equal(links.clientMobile, '27821234567');

  const pending = await service.policyGateForAppointment({ appointmentId: 812 });
  assert.equal(pending.required, true);
  assert.equal(pending.accepted, false);

  const clinicKey = links.clinicPath.split('/').pop();
  const phoneKey = links.clientPath.split('/').pop();
  assert.equal((await service.loadPublicRequest(clinicKey)).channel, 'clinic_device');
  assert.equal((await service.loadPublicRequest(phoneKey)).channel, 'secure_link');

  const first = await service.acceptRequest(clinicKey);
  const replay = await service.acceptRequest(phoneKey);
  assert.equal(first.channel, 'clinic_device');
  assert.equal(replay.channel, 'clinic_device');
  assert.equal(db.state.acceptanceInserts, 1);
  assert.equal(db.state.audits, 2);

  const accepted = await service.policyGateForAppointment({ appointmentId: 812 });
  assert.equal(accepted.required, false);
  assert.equal(accepted.accepted, true);
});

test('public acceptance page makes the client acknowledgement explicit and keeps payment separate', () => {
  const html = renderBookingPolicyAcceptancePage({
    request: {
      appointmentId: 812,
      channel: 'clinic_device',
      requestKey: 'A'.repeat(43),
      policyVersion: BOOKING_POLICY_VERSION,
      policyUpdated: BOOKING_POLICY_UPDATED,
      policyText: BOOKING_POLICY_TEXT,
      startsAt: '2026-09-30T08:00:00.000Z',
      accepted: false,
    },
  });
  assert.match(html, /Please review these terms yourself/);
  assert.match(html, /acknowledgement below is yours to make/);
  assert.match(html, /I have read and accept Shiloh’s Booking Policy &amp; Terms/);
  assert.match(html, /acknowledgement and any payment are recorded separately/);
  assert.doesNotMatch(html, /staff.*accept.*on.*behalf/i);
});

test('staff-created booking gate is durable before deposit/confirmation and Workspace reads reuse it', () => {
  const direct = read('src/services/calendarDirectBookingConfirmation.js');
  const confirmation = read('src/services/customerBookingConfirmation.js');
  const workspace = read('src/services/workspaceClients.js');
  const payment = read('src/routes/paymentLinks.js');
  const directEnsure = direct.indexOf('bookingPolicyAcceptance.ensureForAppointment');
  const queue = direct.indexOf('queueCustomerBookingConfirmation(appointment.id');
  assert.ok(directEnsure >= 0 && directEnsure < queue);
  const policyGate = confirmation.indexOf('policyGateForAppointment');
  const depositGate = confirmation.indexOf('ensureDepositRequest');
  assert.ok(policyGate >= 0 && policyGate < depositGate);
  assert.match(workspace, /policyAcceptances/);
  assert.match(workspace, /bookingReadiness/);
  assert.match(payment, /acceptanceForAppointment/);
  assert.match(payment, /recordPaymentLinkAcceptance/);
});

test('request keys fail closed when malformed', () => {
  assert.equal(safeRequestKey('short'), null);
  assert.equal(safeRequestKey('../unsafe'), null);
  assert.equal(safeRequestKey('A'.repeat(43)), 'A'.repeat(43));
});
