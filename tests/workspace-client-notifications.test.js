const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  CLIENT_LOOKUP_CAPABILITY,
  CLIENT_NOTIFY_CAPABILITY,
  evaluateClientNotificationAuthority,
  createWorkspaceClientNotificationService,
} = require('../src/services/workspaceClientNotifications');
const { renderClientNotificationActionSection } = require('../src/presentation/workspaceCommunicationEvidenceUx');
const { renderBookingConfirmationPreviewPage } = require('../src/presentation/workspaceClientNotificationsUx');

const fullPermissions = { [CLIENT_LOOKUP_CAPABILITY]: true, [CLIENT_NOTIFY_CAPABILITY]: true };
function principal(permissions = fullPermissions) {
  return { id: 7, staff_id: 12, display_name: 'Operator', permissions, admin_active: true, staff_status: 'active' };
}
function previewRow(overrides = {}) {
  return {
    client_id: 41, client_name: 'Client One', normalized_mobile: '27821234567',
    mobile_verified_at: new Date('2026-01-01T00:00:00Z'), client_status: 'active',
    appointment_id: 501, starts_at: new Date('2099-09-10T08:00:00Z'), ends_at: new Date('2099-09-10T09:00:00Z'),
    appointment_status: 'confirmed', source: 'shiloh', location_name: 'Shiloh', service_name: 'Treatment',
    staff_name: 'Practitioner', already_sent: false, ...overrides,
  };
}
function fakeDb({ permissions = fullPermissions, row = previewRow() } = {}) {
  return { async query(sql) {
    if (String(sql).includes('workspaceClientNotifications:principal')) return { rows: [principal(permissions)] };
    if (String(sql).includes('workspaceClientNotifications:preview')) return { rows: row ? [row] : [] };
    throw new Error(`Unexpected query: ${String(sql).slice(0, 80)}`);
  } };
}
const readyEnv = {
  PHONE_NUMBER_ID: 'phone-id', WHATSAPP_TOKEN: 'token',
  WHATSAPP_BOOKING_CONFIRMATION_TEMPLATE: 'shiloh_booking_confirmation_v2',
  SHILOH_WORKSPACE_CLIENT_NOTIFY_PROVIDER_READY: 'true',
};
const readyProvider = async () => ({ ready: true });

test('client notification authority requires client visibility and the distinct outbound capability', () => {
  assert.equal(evaluateClientNotificationAuthority([principal({ [CLIENT_LOOKUP_CAPABILITY]: true })]), null);
  assert.equal(evaluateClientNotificationAuthority([principal({ [CLIENT_NOTIFY_CAPABILITY]: true })]), null);
  const authority = evaluateClientNotificationAuthority([principal(fullPermissions)]);
  assert.equal(authority.capability, CLIENT_NOTIFY_CAPABILITY);
  assert.equal(authority.requiredVisibilityCapability, CLIENT_LOOKUP_CAPABILITY);
  assert.equal(authority.key, 'workspace_client_notify_v1');
});

test('authorized preview is bounded to the next canonical CRM V2 appointment and sends nothing', async () => {
  let sendCalls = 0;
  const service = createWorkspaceClientNotificationService({
    db: fakeDb(), env: readyEnv, providerGuard: readyProvider,
    sender: async () => { sendCalls += 1; return { sent: true }; },
  });
  const preview = await service.getPreview({ adminId: 7, clientId: 41 });
  assert.equal(preview.canSend, true);
  assert.equal(preview.providerReady, true);
  assert.equal(preview.client.id, 41);
  assert.equal(preview.appointment.id, 501);
  assert.equal(preview.appointment.serviceName, 'Treatment');
  assert.equal(sendCalls, 0);
  const html = renderBookingConfirmationPreviewPage(preview);
  assert.match(html, /Booking confirmation preview/);
  assert.match(html, /Send booking confirmation/);
  assert.match(html, /Nothing is sent until you press the button and confirm/);
});

test('lookup-only and notify-only principals are both forbidden from direct preview/send', async () => {
  for (const permissions of [{ [CLIENT_LOOKUP_CAPABILITY]: true }, { [CLIENT_NOTIFY_CAPABILITY]: true }]) {
    let sendCalls = 0;
    const service = createWorkspaceClientNotificationService({
      db: fakeDb({ permissions }), env: readyEnv, providerGuard: readyProvider,
      sender: async () => { sendCalls += 1; return { sent: true }; },
    });
    await assert.rejects(service.getPreview({ adminId: 7, clientId: 41 }), error => error.code === 'WORKSPACE_CLIENT_NOTIFY_FORBIDDEN' && error.httpStatus === 403);
    await assert.rejects(service.sendBookingConfirmation({ adminId: 7, clientId: 41 }), error => error.code === 'WORKSPACE_CLIENT_NOTIFY_FORBIDDEN');
    assert.equal(sendCalls, 0);
  }
});

test('preview blocks missing recipient and disabled Workspace provider gate before delivery', async () => {
  const missingRecipient = createWorkspaceClientNotificationService({
    db: fakeDb({ row: previewRow({ normalized_mobile: null }) }), env: readyEnv,
    providerGuard: readyProvider, sender: async () => ({ sent: true }),
  });
  const first = await missingRecipient.getPreview({ adminId: 7, clientId: 41 });
  assert.equal(first.canSend, false);
  assert.equal(first.reason, 'recipient_missing');
  assert.match(first.reasonMessage, /valid canonical WhatsApp\/mobile recipient/);

  const noChannel = createWorkspaceClientNotificationService({
    db: fakeDb(),
    env: { PHONE_NUMBER_ID: 'phone-id', WHATSAPP_TOKEN: 'token', WHATSAPP_BOOKING_CONFIRMATION_TEMPLATE: 'shiloh_booking_confirmation_v2' },
    providerGuard: readyProvider, sender: async () => ({ sent: true }),
  });
  const second = await noChannel.getPreview({ adminId: 7, clientId: 41 });
  assert.equal(second.canSend, false);
  assert.equal(second.reason, 'channel_unavailable');
  assert.match(second.reasonMessage, /Automated WhatsApp booking confirmations are retired/);
});

test('provider-unready state fails closed before the existing sender can be invoked', async () => {
  let sendCalls = 0;
  const service = createWorkspaceClientNotificationService({
    db: fakeDb(), env: readyEnv,
    providerGuard: async () => { throw new Error('provider blocked'); },
    sender: async () => { sendCalls += 1; return { sent: true }; },
  });
  const preview = await service.getPreview({ adminId: 7, clientId: 41 });
  assert.equal(preview.canSend, false);
  assert.equal(preview.providerReady, false);
  assert.equal(preview.reason, 'provider_unavailable');
  assert.match(preview.reasonMessage, /Nothing can be sent/);
  await assert.rejects(service.sendBookingConfirmation({ adminId: 7, clientId: 41 }), error => error.code === 'WORKSPACE_CLIENT_NOTIFY_NOT_SENDABLE');
  assert.equal(sendCalls, 0);
});

test('final send re-previews authority and provider readiness then delegates only to the semantic sender', async () => {
  const calls = [];
  const db = fakeDb();
  let guardCalls = 0;
  const service = createWorkspaceClientNotificationService({
    db, env: readyEnv,
    providerGuard: async () => { guardCalls += 1; return { ready: true }; },
    sender: async (appointmentId, options) => { calls.push({ appointmentId, options }); return { sent: true }; },
  });
  const result = await service.sendBookingConfirmation({ adminId: 7, clientId: 41 });
  assert.equal(result.sent, true);
  assert.equal(result.appointmentId, 501);
  assert.equal(guardCalls, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].appointmentId, 501);
  assert.equal(calls[0].options.db, db);
  assert.equal(calls[0].options.env, readyEnv);
});

test('client detail exposes a preview deep-link only when notification authority is resolved', () => {
  const denied = renderClientNotificationActionSection({ id: 41 }, false);
  assert.doesNotMatch(denied, /href="\/calendar\/clients\/41\/booking-confirmation"/);
  assert.match(denied, /Additional capability required: client:notify/);
  const allowed = renderClientNotificationActionSection({ id: 41 }, true);
  assert.match(allowed, /href="\/calendar\/clients\/41\/booking-confirmation"/);
  assert.match(allowed, /Preview booking confirmation/);
});

test('browser mutation route preserves same-origin, staff-session and CSRF guards', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/routes/workspaceClientNotifications.js'), 'utf8');
  assert.match(source, /sameOriginGuard/);
  assert.match(source, /csrfGuard/);
  assert.match(source, /router\.post\('\/:clientId\/booking-confirmation\/send', sameOrigin, requireSession, requireCsrf/);
  assert.match(source, /service\.sendBookingConfirmation/);
});
