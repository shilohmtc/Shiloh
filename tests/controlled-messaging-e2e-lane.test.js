const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createControlledMessagingTestLane,
  e2eLaneEnabled,
} = require('../src/services/controlledMessagingTestLane');
const { deliverClaimedReminder } = require('../src/services/appointmentLifecycle');
const { sendCustomerBookingConfirmationForAppointment } = require('../src/services/customerBookingConfirmation');
const { requestedAppointmentId } = require('../scripts/run-controlled-booking-confirmation-e2e');

const enabledEnv = {
  SHILOH_CONTROLLED_MESSAGING_E2E_ENABLED: 'true',
  PHONE_NUMBER_ID: 'provider-phone-id',
  WHATSAPP_TOKEN: 'provider-token',
};

function configuredTarget() {
  return {
    status: 'bound',
    demoKey: 'durable-demo-key',
    normalizedPhone: '27821234567',
    client: { id: 41 },
    crmV2Client: { id: 91, normalized_mobile: '27821234567' },
  };
}

test('controlled messaging E2E gate requires explicit enablement and provider configuration', () => {
  assert.equal(e2eLaneEnabled({ ...enabledEnv, SHILOH_CONTROLLED_MESSAGING_E2E_ENABLED: 'false' }), false);
  assert.equal(e2eLaneEnabled({ ...enabledEnv, WHATSAPP_TOKEN: '' }), false);
  assert.equal(e2eLaneEnabled(enabledEnv), true);
});

test('controlled messaging E2E resolves the durable CRM binding and denies every mismatched identity or mobile', async () => {
  let resolveCalls = 0;
  const lane = createControlledMessagingTestLane({
    db: { query: async () => { throw new Error('resolver owns queries'); } },
    resolver: async () => { resolveCalls += 1; return configuredTarget(); },
  });

  const allowed = await lane.assertTarget({ crmV2ClientId: 91, phone: '+27 82 123 4567', env: enabledEnv });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.crmV2ClientId, 91);
  assert.equal(resolveCalls, 1);

  await assert.rejects(
    lane.assertTarget({ crmV2ClientId: 92, phone: '27821234567', env: enabledEnv }),
    error => error.code === 'CONTROLLED_MESSAGING_E2E_TARGET_DENIED'
  );
  await assert.rejects(
    lane.assertTarget({ crmV2ClientId: 91, phone: '27820000000', env: enabledEnv }),
    error => error.code === 'CONTROLLED_MESSAGING_E2E_TARGET_DENIED'
  );
  await assert.rejects(
    lane.assertTarget({ crmV2ClientId: 91, phone: '27821234567', env: { ...enabledEnv, SHILOH_CONTROLLED_MESSAGING_E2E_ENABLED: 'false' } }),
    error => error.code === 'CONTROLLED_MESSAGING_E2E_DISABLED'
  );
});

test('reminder E2E guard executes before the existing provider adapter', async () => {
  const appointment = {
    id: 4, appointment_id: 501, client_id: 41, crm_v2_client_id: 91,
    phone: '27821234567', client_name_snapshot: 'Configured client',
    service_text: 'Treatment', appointment_at: '2026-09-10T08:00:00Z',
  };
  let sends = 0;
  await assert.rejects(deliverClaimedReminder(appointment, 'reminder_template', null, {
    controlledE2e: true,
    env: enabledEnv,
    assertE2eTarget: async () => { throw Object.assign(new Error('denied'), { code: 'CONTROLLED_MESSAGING_E2E_TARGET_DENIED' }); },
    send: async () => { sends += 1; },
  }), error => error.code === 'CONTROLLED_MESSAGING_E2E_TARGET_DENIED');
  assert.equal(sends, 0);

  const calls = [];
  await deliverClaimedReminder(appointment, 'reminder_template', 'actions_template', {
    controlledE2e: true,
    env: enabledEnv,
    assertE2eTarget: async target => { calls.push({ target }); },
    send: async (...args) => { calls.push({ args }); return { messages: [{ id: 'wamid.test' }] }; },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].target.crmV2ClientId, 91);
  assert.equal(calls[1].args[0], appointment.phone);
});

test('booking-confirmation E2E mismatch fails before recovery, queue, claim, lifecycle, or provider writes', async () => {
  const queries = [];
  const db = { async query(sql) {
    const text = String(sql);
    queries.push(text);
    if (text.includes('FROM appointments a LEFT JOIN locations l ON l.id=a.location_id')) return { rows: [{
      id: 501, client_id: null, starts_at: '2026-09-10T08:00:00Z', ends_at: '2026-09-10T09:00:00Z',
      source: 'shiloh_calendar', location_name: 'Shiloh', service_name: 'Treatment', staff_name: 'Practitioner',
    }] };
    if (text.includes('SELECT a.id AS appointment_id')) return { rows: [{
      appointment_id: 501, client_id: null, crm_v2_client_id: 999, identity_model: 'crm_v2',
      client_status: 'active', client_phone: '27820000000', client_name_snapshot: 'Other client',
    }] };
    throw new Error(`Unexpected query: ${text.slice(0, 100)}`);
  } };
  let providerCalls = 0;
  await assert.rejects(sendCustomerBookingConfirmationForAppointment(501, {
    db, env: enabledEnv, controlledE2e: true, recovery: true,
    assertE2eTarget: async () => { throw Object.assign(new Error('denied'), { code: 'CONTROLLED_MESSAGING_E2E_TARGET_DENIED' }); },
    sendTemplate: async () => { providerCalls += 1; },
  }), error => error.code === 'CONTROLLED_MESSAGING_E2E_TARGET_DENIED');
  assert.equal(providerCalls, 0);
  assert.equal(queries.length, 2);
  assert.equal(queries.some(sql => /\b(INSERT|UPDATE|DELETE)\b/.test(sql)), false);
});

test('controlled booking-confirmation runner accepts only an explicit positive canonical appointment id', () => {
  assert.equal(requestedAppointmentId(['node', 'script', '--appointment=501']), 501);
  assert.throws(() => requestedAppointmentId(['node', 'script']), /--appointment/);
  assert.throws(() => requestedAppointmentId(['node', 'script', '--appointment=0']), /positive id/);
});

test('runtime E2E authorization contains no person-name or literal-phone allow rule', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/services/controlledMessagingTestLane.js'), 'utf8');
  assert.doesNotMatch(source, /Juvan Botha/i);
  assert.doesNotMatch(source, /278[0-9]{8}/);
  assert.match(source, /resolveCurrentControlledDemoCrmV2Client/);
});
