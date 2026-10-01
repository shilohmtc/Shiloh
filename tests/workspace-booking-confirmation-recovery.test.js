const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  providerOutcome,
  recoveryState,
  prepareBookingConfirmationRecovery,
  bookingConfirmationTemplatePayload,
  LIVE_BOOKING_CONFIRMATION_V2,
} = require('../src/services/customerBookingConfirmation');
const {
  createWorkspaceClientNotificationService,
  confirmationProjection,
  safeProviderFailureExplanation,
} = require('../src/services/workspaceClientNotifications');
const { renderMessagesPage } = require('../src/presentation/workspaceMessagesUx');
const { calendarOperationalMutationsClientScript } = require('../src/presentation/calendarOperationalMutationsUx');

const NOW = new Date('2026-09-04T12:00:00Z');
const FUTURE = new Date('2030-09-10T08:00:00Z');
const readyEnv = {
  PHONE_NUMBER_ID: 'phone-id', WHATSAPP_TOKEN: 'token',
  WHATSAPP_BOOKING_CONFIRMATION_TEMPLATE: LIVE_BOOKING_CONFIRMATION_V2,
  SHILOH_WORKSPACE_CLIENT_NOTIFY_PROVIDER_READY: 'true',
};

function failedDelivery(overrides = {}) {
  return {
    appointment_id: 501, appointment_status: 'confirmed', starts_at: FUTURE,
    status: 'sent', sent_audit: true,
    updated_at: new Date('2026-09-04T09:00:00Z'),
    last_attempt_at: new Date('2026-09-04T09:00:00Z'),
    provider_sent_at: new Date('2026-09-04T09:00:01Z'),
    provider_failed_at: new Date('2026-09-04T09:01:00Z'),
    provider_delivered_at: null, provider_read_at: null,
    ...overrides,
  };
}

function crmV2Authority() {
  return {
    appointment_id: 501, client_id: null, crm_v2_client_id: 91,
    identity_model: 'crm_v2', client_status: 'active', client_phone: '27821234567',
    delivery_recipient_mobile: '27821234567', client_name_snapshot: 'Canonical client',
  };
}

test('provider evidence has precedence and only failed, uncertain, or stale obligations are recoverable', () => {
  assert.equal(providerOutcome(failedDelivery()), 'failed');
  assert.equal(recoveryState(failedDelivery(), NOW).recoverable, true);
  assert.deepEqual(recoveryState(failedDelivery({ provider_delivered_at: new Date('2026-09-04T09:02:00Z') }), NOW), {
    recoverable: false, reason: 'already_sent',
  });
  assert.equal(recoveryState({ status: 'sending', last_attempt_at: new Date('2026-09-04T11:55:00Z') }, NOW).reason, 'already_in_progress');
  assert.equal(recoveryState({ status: 'sending', last_attempt_at: new Date('2026-09-04T11:40:00Z') }, NOW).reason, 'pending_too_long');
});

test('legacy sent audit without a delivery row remains terminal rather than becoming a resend exception', () => {
  const projection = confirmationProjection({ appointment_id: 501, already_sent: true }, NOW);
  assert.equal(projection.status, 'sent');
  assert.equal(projection.recoverable, false);
  assert.equal(projection.recoveryReason, 'already_sent');
});

test('provider failure diagnostics map known codes and fail closed for unknown or malformed evidence', () => {
  assert.equal(
    safeProviderFailureExplanation({ code: 131042, message: 'secret provider payload' }),
    'WhatsApp rejected this delivery because the business account has a payment or eligibility issue.'
  );
  assert.equal(
    safeProviderFailureExplanation({ code: '131026', message: 'recipient and token details' }),
    'WhatsApp could not deliver this message to the recipient.'
  );
  const generic = 'WhatsApp reported a delivery failure. No additional safe detail is available.';
  assert.equal(safeProviderFailureExplanation({ code: 999999, message: 'private detail' }), generic);
  assert.equal(safeProviderFailureExplanation('malformed provider evidence'), generic);
  assert.equal(safeProviderFailureExplanation(null), generic);
});

test('recovery revalidates current CRM V2 recipient and conditionally reopens provider-failed local-sent evidence', async () => {
  const calls = [];
  const db = { async query(sql, params = []) {
    const text = String(sql);
    calls.push({ text, params });
    if (text.includes('customerBookingConfirmation:recoveryState')) return { rows: [failedDelivery()], rowCount: 1 };
    if (text.includes('SELECT a.id AS appointment_id')) return { rows: [crmV2Authority()], rowCount: 1 };
    if (text.includes('customerBookingConfirmation:prepareRecovery')) return { rows: [{ appointment_id: 501 }], rowCount: 1 };
    if (text.includes('customer.booking_confirmation_recovery_requested')) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected query: ${text.slice(0, 100)}`);
  } };
  const result = await prepareBookingConfirmationRecovery(501, { db, operatorAdminId: 7, now: NOW });
  assert.deepEqual(result, { prepared: true, reason: 'failed' });
  assert.ok(calls.some(call => call.text.includes("status IN ('failed','uncertain','sent')")));
  const audit = calls.find(call => call.text.includes('customer.booking_confirmation_recovery_requested'));
  assert.equal(audit.params[1], 7);
  assert.match(audit.params[2], /canonicalRecipientRevalidated/);
});

test('delivered provider evidence and changed canonical recipients fail closed before recovery mutation', async () => {
  for (const scenario of [
    { row: failedDelivery({ provider_delivered_at: new Date('2026-09-04T09:02:00Z') }), authority: crmV2Authority(), reason: 'already_sent' },
    { row: failedDelivery(), authority: { ...crmV2Authority(), client_phone: '27820000000' }, reason: 'crm_v2_recipient_changed' },
  ]) {
    let writes = 0;
    const db = { async query(sql) {
      const text = String(sql);
      if (text.includes('customerBookingConfirmation:recoveryState')) return { rows: [scenario.row], rowCount: 1 };
      if (text.includes('SELECT a.id AS appointment_id')) return { rows: [scenario.authority], rowCount: 1 };
      writes += 1;
      return { rows: [], rowCount: 0 };
    } };
    const result = await prepareBookingConfirmationRecovery(501, { db, operatorAdminId: 7, now: NOW });
    assert.equal(result.prepared, false);
    assert.equal(result.reason, scenario.reason);
    assert.equal(writes, 0);
  }
});

function appointmentRow(overrides = {}) {
  return {
    client_id: 91, client_name: 'Canonical client', normalized_mobile: '27821234567', client_status: 'active',
    appointment_id: 501, starts_at: FUTURE, ends_at: new Date('2030-09-10T09:00:00Z'), appointment_status: 'confirmed',
    source: 'shiloh_calendar', location_name: 'Shiloh', service_name: 'Treatment', staff_name: 'Practitioner',
    delivery_status: 'sent', sent_at: new Date('2026-09-04T09:00:00Z'), already_sent: true,
    provider_sent_at: new Date('2026-09-04T09:00:01Z'), provider_failed_at: new Date('2026-09-04T09:01:00Z'),
    provider_error: { code: 131042, message: 'private provider text 27829999999' },
    ...overrides,
  };
}

function workspaceDb(row = appointmentRow()) {
  return { async query(sql) {
    const text = String(sql);
    if (text.includes('workspaceClientNotifications:principal')) return { rows: [{
      id: 7, staff_id: 12, display_name: 'Operator', permissions: { 'client:lookup': true, 'client:notify': true },
      admin_active: true, staff_status: 'active',
    }] };
    if (text.includes('workspaceClientNotifications:appointmentConfirmation')) return { rows: row ? [row] : [] };
    if (text.includes('workspaceClientNotifications:exceptions')) return { rows: row ? [row] : [] };
    throw new Error(`Unexpected query: ${text.slice(0, 100)}`);
  } };
}

test('Workspace recovery requires client:notify, exposes sanitized evidence, and delegates to the canonical sender', async () => {
  const calls = [];
  const db = workspaceDb();
  const service = createWorkspaceClientNotificationService({
    db, env: readyEnv, providerGuard: async () => ({ ready: true }),
    sender: async (id, options) => { calls.push({ id, options }); return { sent: true }; },
  });
  const preview = await service.getAppointmentConfirmation({ adminId: 7, appointmentId: 501, now: NOW });
  assert.equal(preview.canRecover, true);
  assert.equal(preview.confirmation.status, 'failed');
  assert.equal(preview.client.mobileLast4, '4567');
  assert.equal(preview.client.normalizedMobile, undefined);
  const sent = await service.sendBookingConfirmation({ adminId: 7, appointmentId: 501 });
  assert.equal(sent.sent, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 501);
  assert.equal(calls[0].options.recovery, true);
  assert.equal(calls[0].options.operatorAdminId, 7);
});

test('Messages attention shows truthful recovery state without provider internals or a full mobile', async () => {
  const service = createWorkspaceClientNotificationService({
    db: workspaceDb(), env: readyEnv, providerGuard: async () => ({ ready: true }), sender: async () => ({ sent: true }),
  });
  const model = await service.listBookingConfirmationExceptions({ adminId: 7, now: NOW });
  const html = renderMessagesPage({
    ...model,
    selectedView: 'attention',
    notificationAuthority: model.authority,
    attention: model.exceptions,
    attentionUnavailable: false,
    activity: [],
    activityUnavailable: false,
  });
  assert.match(html, /Failed/);
  assert.match(html, /Re-send booking confirmation/);
  assert.doesNotMatch(html, /WhatsApp ending 4567/);
  assert.match(html, /Delivery/);
  assert.match(html, /business account has a payment or eligibility issue/);
  assert.match(html, /Recovery/);
  assert.match(html, /Retry is available through Shiloh/);
  assert.doesNotMatch(html, /27821234567|27829999999|private provider text|wamid|provider_error|131042/i);
  assert.match(calendarOperationalMutationsClientScript(), /my-shiloh-availability/);
  assert.doesNotMatch(calendarOperationalMutationsClientScript(), /booking-confirmation\/recover/);
});

test('Workspace exception SQL reads only the provider error field needed for sanitized diagnostics', async () => {
  let exceptionSql = '';
  const db = workspaceDb();
  const originalQuery = db.query;
  db.query = async (sql, params) => {
    if (String(sql).includes('workspaceClientNotifications:exceptions')) exceptionSql = String(sql);
    return originalQuery(sql, params);
  };
  const service = createWorkspaceClientNotificationService({
    db, env: readyEnv, providerGuard: async () => ({ ready: true }), sender: async () => ({ sent: true }),
  });
  await service.listBookingConfirmationExceptions({ adminId: 7, now: NOW });
  assert.match(exceptionSql, /delivery\.provider_error/);
  assert.doesNotMatch(exceptionSql, /provider_message_id/);
});

test('Calendar exception routes retain session, same-origin, CSRF and client:notify boundaries', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'src/routes/calendarOperationalMutations.js'), 'utf8');
  const calendar = fs.readFileSync(path.join(__dirname, '..', 'src/routes/calendarReadOnlyUx.js'), 'utf8');
  assert.match(route, /router\.get\('\/booking-confirmation-exceptions', requireSession, requireNotificationCapability/);
  assert.match(route, /res\.redirect\(302, '\/calendar\/messages\?view=attention'\)/);
  assert.match(route, /router\.post\('\/appointments\/:appointmentId\/booking-confirmation\/recover', sameOrigin, requireSession, requireCsrf, requireNotificationCapability/);
  assert.doesNotMatch(calendar, /Confirmation exceptions/);
});

test('Bot and Workspace use the same canonical booking-confirmation payload contract', () => {
  const common = {
    template: LIVE_BOOKING_CONFIRMATION_V2, appointmentId: 501, clientName: 'Canonical client',
    serviceName: 'Treatment', staffName: 'Practitioner', date: 'Thursday, 10 September 2026',
    time: '10:00–11:00', google: 'https://calendar.example/google', ics: 'https://calendar.example/file.ics',
  };
  const botPayload = bookingConfirmationTemplatePayload({ ...common, source: 'shiloh_client_whatsapp' });
  const workspacePayload = bookingConfirmationTemplatePayload({ ...common, source: 'shiloh_calendar' });
  assert.deepEqual(workspacePayload, botPayload);
  assert.deepEqual(botPayload.quickReplyPayloads, [
    'client_booking_confirmation_v2_calendar_501',
    'client_booking_confirmation_v2_manage_501',
    'client_postbook_my_appointments',
  ]);
});

test('client:notify rollout is least-privilege for all-business operational roles only', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations/099_workspace_booking_confirmation_notify_capability.sql'), 'utf8');
  assert.match(migration, /permissions[\s\S]*client:notify/);
  assert.match(migration, /business_role IN \('owner','business_admin','booking_operator'\)/);
  assert.doesNotMatch(migration, /tenant_practitioner/);
  assert.doesNotMatch(migration, /Christel|Jean|Naomi|Marietjie|Juvan/i);
});


test('production confirmation attention reads current app events and rejects tenant client visibility', async () => {
  let tenant = false;
  const queries = [];
  const db = { async query(sql) {
    queries.push(sql);
    if (sql.includes('principal')) return { rows: [{ id: 7, admin_active: true, staff_id: 55, staff_status: 'active',
      business_role: tenant ? 'tenant_practitioner' : 'owner', permissions: { 'client:lookup': true, 'client:notify': true } }] };
    assert.match(sql, /workspaceClientNotifications:appExceptions/);
    assert.match(sql, /my_shiloh_push_notifications/);
    assert.match(sql, /visibility_scope='tenant_private'/);
    assert.doesNotMatch(sql, /customer_message_deliveries|provider_|template_name/);
    return { rows: [{ appointment_id: 92, client_id: 81, client_name: 'Client', starts_at: '2026-10-02T08:00:00Z', service_name: 'Massage' }] };
  } };
  const service = createWorkspaceClientNotificationService({ db, env: process.env, providerGuard: async () => { throw new Error('Must not read retired provider'); } });
  const result = await service.listBookingConfirmationExceptions({ adminId: 7, now: NOW });
  assert.equal(result.exceptions[0].confirmation.status, 'unavailable');
  assert.equal(result.exceptions[0].canRecover, false);
  tenant = true;
  const count = queries.length;
  assert.deepEqual((await service.listBookingConfirmationExceptions({ adminId: 7, now: NOW })).exceptions, []);
  assert.equal(queries.length - count, 2);
});
