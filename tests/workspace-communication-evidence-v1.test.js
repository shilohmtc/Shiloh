const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createWorkspaceCommunicationEvidenceService,
  messageDeliveryEntry,
  rescheduleEntry,
  intentLabel,
} = require('../src/services/workspaceCommunicationEvidence');
const {
  renderCommunicationSection,
  renderClientDetailPageWithCommunications,
} = require('../src/presentation/workspaceCommunicationEvidenceUx');

function dbForEvidence() {
  return { calls: [], async query(sql, values) {
    this.calls.push({ sql, values });
    return { rows: [{ category: 'appointment', title: 'Appointment confirmed', appointment_id: 71,
      client_id: 912, client_name: 'Client', created_at: '2026-10-01T08:00:00Z' }] };
  } };
}

function clientDetailModel(overrides = {}) {
  return {
    client: {
      id: 912,
      name: 'Synthetic Client',
      normalized_mobile: '27821234567',
      date_of_birth: '1994-02-18',
      gender: 'female',
      profile_status: 'registered',
      mobile_verified_at: '2026-08-28T10:00:00.000Z',
      status: 'active',
    },
    appointments: [],
    hasMore: false,
    historyOffset: 0,
    pageSize: 20,
    communications: [],
    ...overrides,
  };
}

test('current communication reads only My Shiloh events with client and appointment scope', async () => {
  const db = dbForEvidence();
  const service = createWorkspaceCommunicationEvidenceService({ db });
  const evidence = await service.listForClient({ clientId: 912, limit: 30, scope: { kind: 'clinic' } });
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /FROM my_shiloh_push_notifications/);
  assert.match(db.calls[0].sql, /n.expires_at>NOW\(\)/);
  assert.match(db.calls[0].sql, /a.crm_v2_client_id=c.id/);
  assert.match(db.calls[0].sql, /crm_v2_client_relationships/);
  assert.doesNotMatch(db.calls[0].sql, /customer_message_deliveries|customer_care_delivery_log|provider_|template_name/);
  assert.deepEqual(db.calls[0].values, [912, 30]);
  assert.equal(evidence[0].label, 'Appointment confirmed');
  assert.equal(evidence[0].statusLabel, 'Available in My Shiloh');
  assert.equal(evidence[0].templateName, null);
  await assert.rejects(service.listRecent({}), /valid client relationship scope/);
});

test('provider evidence uses strongest truthful lifecycle state and never downgrades delivery/read', () => {
  const base = {
    appointment_id: 1,
    message_kind: 'booking_confirmation',
    status: 'sent',
    claimed_at: '2026-09-01T09:59:59Z',
    sent_at: '2026-09-01T10:00:00Z',
    template_name: 'shiloh_booking_confirmation_v2',
  };
  assert.equal(messageDeliveryEntry({ ...base, provider_sent_at: '2026-09-01T10:00:01Z' }).statusLabel, 'Sent to WhatsApp');
  assert.equal(messageDeliveryEntry({ ...base, provider_failed_at: '2026-09-01T10:00:02Z' }).statusLabel, 'WhatsApp delivery failed');
  assert.equal(messageDeliveryEntry({ ...base, provider_failed_at: '2026-09-01T10:00:02Z', provider_delivered_at: '2026-09-01T10:00:03Z' }).statusLabel, 'Delivered on WhatsApp');
  assert.equal(messageDeliveryEntry({ ...base, provider_failed_at: '2026-09-01T10:00:04Z', provider_delivered_at: '2026-09-01T10:00:03Z', provider_read_at: '2026-09-01T10:00:05Z' }).statusLabel, 'Read on WhatsApp');
  assert.equal(messageDeliveryEntry({ ...base, status: 'uncertain', sent_at: null, last_attempt_at: '2026-09-01T10:00:00Z' }).statusLabel, 'Delivery uncertain');
  assert.equal(rescheduleEntry({ appointment_id: 2, client_notification_suppressed_at: '2026-09-01T10:00:00Z' }).statusLabel, 'Suppressed');
  assert.equal(intentLabel('booking_update'), 'Booking update');
});

test('Client Communications UX shows Shiloh template and provider outcome but hides provider identifiers', () => {
  const html = renderClientDetailPageWithCommunications(clientDetailModel({
    communications: [{
      intent: 'booking_confirmation',
      label: 'Booking confirmation',
      status: 'delivered',
      statusLabel: 'Delivered on WhatsApp',
      occurredAt: '2026-09-01T08:00:08.000Z',
      appointmentId: 71,
      templateName: 'shiloh_booking_confirmation_v2',
    }],
  }), { calendarNavigationAllowed: true });

  assert.match(html, /data-client-communications/);
  assert.match(html, /My Shiloh updates/);
  assert.match(html, /Booking confirmation/);
  assert.match(html, /Delivered on WhatsApp/);
  assert.match(html, /Appointment #71/);
  assert.match(html, /Template: shiloh_booking_confirmation_v2/);
  assert.doesNotMatch(html, /provider_message_id|Graph API/i);
  assert.doesNotMatch(html, /Send message|Reply|Compose/);
});

test('Client appointment history exposes an obvious accessible drill-in to Calendar details', () => {
  const html = renderClientDetailPageWithCommunications(clientDetailModel({
    appointments: [{
      id: 71,
      starts_at: '2026-09-12T08:00:00.000Z',
      ends_at: '2026-09-12T08:45:00.000Z',
      status: 'completed',
      services: [{ name: 'Quick Relief' }],
      staff: [{ name: 'Christel' }],
    }],
  }));

  assert.match(html, /class="history-row history-row-link"/);
  assert.match(html, /data-appointment-detail-link="71"/);
  assert.match(html, /appointment=71&amp;staff=all/);
  assert.match(html, /aria-label="Open appointment details"/);
  assert.match(html, /<span>Open<\/span>›/);
  assert.match(html, /history-row-link:hover/);
  assert.match(html, /history-row-link:focus-visible/);
});

test('communication evidence failure renders a neutral unavailable state rather than a false empty or delivery claim', () => {
  const html = renderClientDetailPageWithCommunications(clientDetailModel({
    communications: [],
    communicationsUnavailable: true,
  }));
  assert.match(html, /Communication evidence is temporarily unavailable/);
  assert.match(html, /No delivery claim is being made/);
  assert.doesNotMatch(html, /No recorded Shiloh notifications yet/);
});

test('communication section remains truthful when there is no recorded evidence', () => {
  const html = renderCommunicationSection([]);
  assert.match(html, /No recorded Shiloh notifications yet/);
  assert.doesNotMatch(html, /delivered/i);
});
