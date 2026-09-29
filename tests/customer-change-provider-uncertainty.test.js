const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const enabled = { env: { SHILOH_META_SIGNIN_ONLY_ENABLED: 'false', SHILOH_BOOKING_CHANGE_RETRY_ENABLED: 'true' } };
const disabled = { env: { SHILOH_BOOKING_CHANGE_RETRY_ENABLED: 'false' } };

function loadService({ templateApproved = true, templateStatusFails = false, providerFails = false, auditFails = false, appAccepted = 0, crmV2ClientId = 912, changeKind = 'time', appRecordFails = false } = {}) {
  const state = { status: 'pending', attemptCount: 0, lastError: null, providerCalls: 0, inAppCalls: 0, auditCalls: 0 };
  const appointment = {
    id: 759, client_id: null, crm_v2_client_id: crmV2ClientId, source_client_name: 'Client',
    crm_v2_client_name: 'Client', client_phone: '27820000000',
    service_name: 'Treatment', staff_name: 'Practitioner', total_price: 500,
    starts_at: '2026-10-01T08:00:00.000Z', ends_at: '2026-10-01T09:00:00.000Z',
  };
  const pool = { async query(sql, values) {
    if (sql.includes('CREATE TABLE') || sql.includes('ALTER TABLE')) return { rowCount: 0, rows: [] };
    if (sql.includes('SELECT audit_event_id,appointment_id,change_kind,status')) {
      return { rows: [{ audit_event_id: 701, appointment_id: 759, change_kind: changeKind, status: state.status, attempt_count: state.attemptCount }] };
    }
    if (sql.includes('SELECT a.id,a.client_id')) return { rows: [appointment] };
    if (sql.includes('UPDATE customer_change_notifications notification')) return { rowCount: 0, rows: [] };
    if (sql.includes("SET status='sending'")) {
      if (!['pending', 'failed'].includes(state.status)) return { rowCount: 0, rows: [] };
      state.status = 'sending'; if (sql.includes('attempt_count=attempt_count+1')) state.attemptCount++;
      return { rowCount: 1, rows: [{ audit_event_id: 701 }] };
    }
    if (sql.includes("SET status='sent'")) {
      if (appRecordFails && sql.includes('RETURNING audit_event_id')) throw new Error('database unavailable after push acceptance');
      state.status = 'sent'; state.lastError = null; return { rowCount: 1 };
    }
    if (sql.includes("SET status='failed'")) { state.status = 'failed'; state.attemptCount++; state.lastError = values[1]; return { rowCount: 1 }; }
    if (sql.includes("last_error='provider_outcome_uncertain'")) { state.lastError = 'provider_outcome_uncertain'; return { rowCount: 1 }; }
    if (sql.includes("SET status='pending'")) { state.status = 'pending'; state.lastError = values[1] || 'app_wake_unaccepted'; return { rowCount: 1 }; }
    if (sql.includes('INSERT INTO crm_audit_events')) {
      state.auditCalls++;
      if (auditFails) throw new Error('audit write failed');
      return { rowCount: 1 };
    }
    if (sql.includes('SELECT audit_event_id') && sql.includes('LIMIT 25')) {
      const eligible = ['pending', 'failed'].includes(state.status) && state.attemptCount < values[0] && values[1];
      return { rowCount: eligible ? 1 : 0, rows: eligible ? [{ audit_event_id: 701 }] : [] };
    }
    throw new Error(`Unexpected SQL: ${sql.slice(0, 80)}`);
  } };
  const originalLoad = Module._load;
  const servicePath = require.resolve('../src/services/customerChangeNotification');
  delete require.cache[servicePath];
  Module._load = function(request, parent, isMain) {
    if (parent?.filename === servicePath) {
      if (request === '../db/pool') return { pool };
      if (request === './whatsapp') return { sendWhatsAppTemplate: async () => {
        state.providerCalls++;
        if (providerFails) throw new Error('response lost after possible acceptance');
        return { messages: [{ id: 'provider-1' }] };
      } };
      if (request === './clientFacingNameAuthority') return { resolveClientFacingName: async () => null };
      if (request === './clientLifecycleTemplateProvisioning') return {
        DEFINITIONS: {}, submitClientLifecycleTemplate: async () => ({}),
        getClientLifecycleTemplateStatus: async () => {
          if (templateStatusFails) throw new Error('template status unavailable');
          return { ok: true, templates: templateApproved
            ? [{ key: 'cancellation_confirmation_v2', provider: { status: 'APPROVED', name: 'cancellation_confirmation_v2' } }] : [] };
        },
      };
      if (request === './sh05ChannelIndependence') return { queueBookingChangeMyShilohNotification: async () => {
        state.inAppCalls++; return { queued: true, accepted: appAccepted, notificationId: 42 };
      } };
      if (request === '../lib/logger') return { info() {}, warn() {}, error() {} };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  let service;
  try { service = require(servicePath); } finally { Module._load = originalLoad; delete require.cache[servicePath]; }
  return { service, state };
}

test('in-app cancellation queues despite unapproved WhatsApp template', async () => {
  const { service, state } = loadService({ templateApproved: false, changeKind: 'cancellation' });
  const outcome = await service.attemptCustomerChangeNotification(701, enabled);
  assert.equal(outcome.reason, 'template_not_approved');
  assert.equal(state.inAppCalls, 1);
  assert.equal(state.providerCalls, 0);
});

test('uncertain provider outcome stays claimed and cannot send again', async () => {
  const { service, state } = loadService({ providerFails: true, changeKind: 'cancellation' });
  const outcome = await service.attemptCustomerChangeNotification(701, enabled);
  assert.equal(outcome.reason, 'provider_outcome_uncertain');
  assert.equal(state.status, 'sending');
  assert.equal(state.lastError, 'provider_outcome_uncertain');
  assert.equal(state.inAppCalls, 1);
  assert.equal((await service.flushCustomerChangeNotifications(enabled)).attempted, 0);
  assert.equal((await service.attemptCustomerChangeNotification(701, enabled)).reason, 'provider_outcome_uncertain');
  assert.equal(state.providerCalls, 1);
});

test('pre-send template status failures stop after three attempts', async () => {
  const { service, state } = loadService({ templateStatusFails: true, changeKind: 'cancellation' });
  assert.equal((await service.attemptCustomerChangeNotification(701, enabled)).reason, 'provider_status_error');
  assert.equal((await service.flushCustomerChangeNotifications(enabled)).attempted, 1);
  assert.equal((await service.flushCustomerChangeNotifications(enabled)).attempted, 1);
  assert.equal(state.attemptCount, 3);
  assert.equal((await service.flushCustomerChangeNotifications(enabled)).attempted, 0);
  assert.equal(state.providerCalls, 0);
});

test('audit failure after provider acceptance does not reopen delivery', async () => {
  const { service, state } = loadService({ auditFails: true, changeKind: 'cancellation' });
  assert.equal((await service.attemptCustomerChangeNotification(701, enabled)).sent, true);
  assert.equal(state.status, 'sent');
  assert.equal(state.auditCalls, 1);
  assert.equal((await service.flushCustomerChangeNotifications(enabled)).attempted, 0);
  assert.equal(state.providerCalls, 1);
});

test('retired booking-update Meta transport remains pending even with the old gate enabled', async () => {
  const { service, state } = loadService();
  const paused = await service.attemptCustomerChangeNotification(701, disabled);
  assert.equal(paused.reason, 'booking_update_meta_retired');
  assert.equal(state.status, 'pending');
  assert.equal(state.lastError, 'booking_update_meta_retired');
  assert.equal(state.attemptCount, 0);
  assert.equal(state.inAppCalls, 1);
  assert.equal(state.providerCalls, 0);
  assert.equal((await service.flushCustomerChangeNotifications(disabled)).attempted, 0);
  assert.equal((await service.attemptCustomerChangeNotification(701, { env: { ...enabled.env, WHATSAPP_BOOKING_UPDATE_ENABLED: 'true' } })).reason, 'booking_update_meta_retired');
  assert.equal(state.providerCalls, 0);
});

test('sign-in-only cut keeps cancellation notification pending without an uncertain provider claim', async () => {
  const { service, state } = loadService({ changeKind: 'cancellation' });
  const result = await service.attemptCustomerChangeNotification(701, {
    env: { SHILOH_META_SIGNIN_ONLY_ENABLED: 'true' },
  });
  assert.equal(result.reason, 'meta_signin_only');
  assert.equal(state.status, 'pending');
  assert.equal(state.lastError, 'meta_signin_only');
  assert.equal(state.providerCalls, 0);
  assert.equal(state.inAppCalls, 1);
});

test('accepted app wake completes a claimed CRM V2 booking change without Meta', async () => {
  const { service, state } = loadService({ appAccepted: 1, templateApproved: false });
  const env = { env: { WHATSAPP_BOOKING_UPDATE_ENABLED: 'false', SHILOH_BOOKING_CHANGE_APP_ONLY_ENABLED: 'true' } };
  const result = await service.attemptCustomerChangeNotification(701, env);
  assert.deepEqual(result, { sent: true, channel: 'my_shiloh', notificationId: 42 });
  assert.equal(state.status, 'sent');
  assert.equal(state.attemptCount, 0);
  assert.equal(state.providerCalls, 0);
  assert.equal(state.auditCalls, 1);
  assert.equal((await service.flushCustomerChangeNotifications(env)).attempted, 0);
});

test('unaccepted app wake retains pending booking update without Meta fallback', async () => {
  const { service, state } = loadService({ appAccepted: 0 });
  const result = await service.attemptCustomerChangeNotification(701, { env: { WHATSAPP_BOOKING_UPDATE_ENABLED: 'true', SHILOH_BOOKING_CHANGE_APP_ONLY_ENABLED: 'true' } });
  assert.equal(result.reason, 'booking_update_meta_retired');
  assert.equal(state.inAppCalls, 1);
  assert.equal(state.providerCalls, 0);
  assert.equal(state.status, 'pending');
});

test('app flag does not complete legacy or unlinked booking changes', async () => {
  const { service, state } = loadService({ appAccepted: 1, crmV2ClientId: null });
  const result = await service.attemptCustomerChangeNotification(701, { env: { WHATSAPP_BOOKING_UPDATE_ENABLED: 'true', SHILOH_BOOKING_CHANGE_APP_ONLY_ENABLED: 'true' } });
  assert.equal(result.reason, 'booking_update_meta_retired');
  assert.equal(state.providerCalls, 0);
});

test('accepted cancellation app wake completes without a Meta cancellation template', async () => {
  const { service, state } = loadService({ appAccepted: 1, changeKind: 'cancellation', templateApproved: false });
  const result = await service.attemptCustomerChangeNotification(701, { env: { SHILOH_BOOKING_CHANGE_APP_ONLY_ENABLED: 'true' } });
  assert.equal(result.channel, 'my_shiloh');
  assert.equal(state.providerCalls, 0);
  assert.equal(state.status, 'sent');
});

test('failed app acceptance record leaves the claim blocked from replay', async () => {
  const { service, state } = loadService({ appAccepted: 1, appRecordFails: true });
  const env = { env: { SHILOH_BOOKING_CHANGE_APP_ONLY_ENABLED: 'true' } };
  await assert.rejects(service.attemptCustomerChangeNotification(701, env), /database unavailable/);
  assert.equal(state.status, 'sending');
  assert.equal((await service.attemptCustomerChangeNotification(701, env)).reason, 'provider_outcome_uncertain');
  assert.equal(state.providerCalls, 0);
});

test('Shiloh retry policy alone selects pending booking updates', () => {
  const { service } = loadService();
  assert.equal(service.bookingChangeRetryEnabled({ WHATSAPP_BOOKING_UPDATE_ENABLED: 'true' }), false);
  assert.equal(service.bookingChangeRetryEnabled({ SHILOH_BOOKING_CHANGE_APP_ONLY_ENABLED: 'true' }), false);
  assert.equal(service.bookingChangeRetryEnabled({}), false);
  assert.equal(service.bookingChangeRetryEnabled({ SHILOH_BOOKING_CHANGE_RETRY_ENABLED: 'false', WHATSAPP_BOOKING_UPDATE_ENABLED: 'true' }), false);
  assert.equal(service.bookingChangeRetryEnabled({ SHILOH_BOOKING_CHANGE_RETRY_ENABLED: 'true' }), true);
});
