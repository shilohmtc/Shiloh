const test = require('node:test');
const assert = require('node:assert/strict');
const { createConsultationFormDeliveryService } = require('../src/services/consultationFormDelivery');

function fixture({ eligible = [7], push = { queued: true, accepted: 1 }, templateReady = false } = {}) {
  const actions = [];
  const db = { async query(sql, values = []) {
    if (sql.includes('consultationFormDelivery:context')) return { rows: [{
      assignment_id: 7, appointment_id: 101, template_version_id: 12,
      starts_at: '2026-09-30T08:00:00Z', service_name: 'Toe Gel Only',
    }] };
    if (sql.includes('consultationFormDelivery:appEligibility')) return { rows: eligible.map(id => ({ id })) };
    if (sql.includes('UPDATE consultation_form_assignments')) { actions.push('marked'); return { rowCount: 1 }; }
    if (sql.includes('INSERT INTO crm_audit_events')) { actions.push({ audit: values }); return { rowCount: 1 }; }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const service = createConsultationFormDeliveryService({
    db,
    env: {
      SHILOH_CONSULTATION_FORM_DELIVERY_ENABLED: 'true',
      SHILOH_CONSULTATION_FORM_DELIVERY_NOT_BEFORE: '2026-09-01T00:00:00Z',
      SHILOH_CONSULTATION_FORM_APP_ONLY_ENABLED: 'true',
    },
    formService: {
      isClientConsultationFormsEnabled: () => true,
      parseDataKey: () => Buffer.alloc(32),
      issueAccessToken: async () => { actions.push('token'); return { token: 'secret' }; },
    },
    loadAuthority: async () => ({ identity_model: 'crm_v2', crm_v2_client_id: 55,
      client_phone: '27821234567', client_name_snapshot: 'Client' }),
    initialFailure: () => null,
    notifyClient: async (notification) => { actions.push({ notification }); return push; },
    assertSendAllowed: async () => { actions.push('preflight'); if (!templateReady) throw Error('template unavailable'); },
    sendTemplate: async () => { actions.push('whatsapp'); return { messages: [{ id: 'wamid.1' }] }; },
    now: () => new Date('2026-09-27T12:00:00Z'),
  });
  return { service, actions };
}

test('single eligible client gets app form without Meta or token in notification', async () => {
  const { service, actions } = fixture();
  const result = await service.sendAssignment(7);
  assert.equal(result.channel, 'my_shiloh');
  assert.deepEqual(actions.filter(action => typeof action === 'string'), ['marked']);
  assert.equal(actions[0].notification.targetPath, '/my-shiloh/forms/complete');
  assert.equal(actions.find(action => action.audit)?.audit[0], 'consultation_form.sent');
  assert.equal(JSON.stringify(actions).includes('secret'), false);
});

test('ambiguous app forms keep WhatsApp fallback', async () => {
  const { service, actions } = fixture({ eligible: [7, 8], templateReady: true });
  const result = await service.sendAssignment(7);
  assert.equal(result.providerMessageId, 'wamid.1');
  assert.equal(actions.filter(action => action.notification).length, 1);
  assert.equal(actions.includes('whatsapp'), true);
});

test('unaccepted push and unavailable WhatsApp leave form unsent', async () => {
  const { service, actions } = fixture({ push: { queued: true, accepted: 0 } });
  assert.deepEqual(await service.sendAssignment(7), { sent: false, reason: 'template_not_ready' });
  assert.equal(actions.includes('marked'), false);
  assert.equal(actions.includes('whatsapp'), false);
});
