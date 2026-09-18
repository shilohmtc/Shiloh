const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const deliverySource = fs.readFileSync(path.join(root, 'src/services/consultationFormDelivery.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

const delivery = require('../src/services/consultationFormDelivery');
const { assertDeliveryFeatureGate } = require('../src/services/metaTemplateContracts');
const { configuredMetaTemplateName } = require('../src/services/metaTemplateAdapter');

function enabledFormService(token = Buffer.alloc(32, 17).toString('base64url')) {
  return {
    isClientConsultationFormsEnabled: () => true,
    parseDataKey: () => Buffer.alloc(32, 1),
    issueAccessToken: async () => ({ assignmentId: 7, token, expiresAt: new Date('2026-09-30T00:00:00Z') }),
  };
}

test('consultation form appointment delivery is dark by default and requires an exact explicit flag', () => {
  assert.equal(delivery.isConsultationFormDeliveryEnabled({}), false);
  assert.equal(delivery.isConsultationFormDeliveryEnabled({ SHILOH_CONSULTATION_FORM_DELIVERY_ENABLED: 'false' }), false);
  assert.equal(delivery.isConsultationFormDeliveryEnabled({ SHILOH_CONSULTATION_FORM_DELIVERY_ENABLED: 'TRUE' }), true);
  assert.throws(() => assertDeliveryFeatureGate('consultation_form', {}), /delivery gate is disabled/i);
  assert.doesNotThrow(() => assertDeliveryFeatureGate('consultation_form', { SHILOH_CONSULTATION_FORM_DELIVERY_ENABLED: 'true' }));
  assert.throws(() => assertDeliveryFeatureGate('consultation_form_reminder', {}), /delivery gate is disabled/i);
});

test('consultation Meta bindings use the exact provisioned templates by default', () => {
  assert.equal(configuredMetaTemplateName('consultation_form', {}), 'shiloh_consultation_form_v1');
  assert.equal(configuredMetaTemplateName('consultation_form_reminder', {}), 'shiloh_consultation_form_reminder_v1');
});

test('appointment date is formatted for the clinic timezone and template wording', () => {
  assert.equal(delivery.formatAppointmentDate('2026-09-24T12:30:00.000Z'), 'Thursday, 24 September 2026');
  assert.equal(delivery.formatAppointmentDate('not-a-date'), '');
});

test('CRM V2 delivery requires the existing canonical recipient authority', async () => {
  const recipient = await delivery.resolveDeliveryRecipient({
    identity_model: 'crm_v2',
    client_id: null,
    crm_v2_client_id: 55,
    client_phone: '27821234567',
    client_name_snapshot: 'Naledi Mokoena',
  }, {
    initialFailure: () => null,
  });
  assert.deepEqual(recipient, {
    ok: true,
    identityModel: 'crm_v2',
    clientId: null,
    crmV2ClientId: 55,
    clientName: 'Naledi Mokoena',
    phone: '27821234567',
  });
});

test('legacy delivery fails closed unless contact ownership is unique and the client-facing name is authoritative', async () => {
  const authority = {
    identity_model: 'legacy',
    client_id: 42,
    crm_v2_client_id: null,
    contact_id: 9,
    client_phone: '27821234567',
  };

  const ambiguous = await delivery.resolveDeliveryRecipient(authority, {
    initialFailure: () => null,
    exactPhoneCandidatesFn: async () => [
      { id: 42, contact_ids: [9] },
      { id: 99, contact_ids: [10] },
    ],
    resolveName: async () => ({ status: 'authoritative', name: 'Naledi Mokoena' }),
  });
  assert.deepEqual(ambiguous, { ok: false, reason: 'client_contact_ambiguous' });

  const noName = await delivery.resolveDeliveryRecipient(authority, {
    initialFailure: () => null,
    exactPhoneCandidatesFn: async () => [{ id: 42, contact_ids: [9] }],
    resolveName: async () => ({ status: 'neutral', name: null }),
  });
  assert.deepEqual(noName, { ok: false, reason: 'client_name_authority_not_found' });

  const resolved = await delivery.resolveDeliveryRecipient(authority, {
    initialFailure: () => null,
    exactPhoneCandidatesFn: async () => [{ id: 42, contact_ids: [9] }],
    resolveName: async () => ({ status: 'authoritative', name: 'Naledi Mokoena' }),
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.clientName, 'Naledi Mokoena');
  assert.equal(resolved.phone, '27821234567');
});

test('scan does not touch appointment data while real client forms are disabled', async () => {
  let queries = 0;
  const service = delivery.createConsultationFormDeliveryService({
    db: { async query() { queries += 1; throw new Error('database should not be touched'); } },
    env: {},
    formService: {
      isClientConsultationFormsEnabled: () => false,
      parseDataKey: () => { throw new Error('not expected'); },
    },
  });
  const result = await service.runOnce();
  assert.equal(result.reason, 'client_forms_disabled');
  assert.equal(result.created, 0);
  assert.equal(result.attempted, 0);
  assert.equal(queries, 0);
});

test('assignment discovery can run without sending while the separate delivery switch remains off', async () => {
  const sqlSeen = [];
  const service = delivery.createConsultationFormDeliveryService({
    db: {
      async query(sql) {
        sqlSeen.push(sql);
        if (sql.includes('consultationFormDelivery:discover')) return { rowCount: 2, rows: [{ id: 1 }, { id: 2 }] };
        throw new Error(`Unexpected query: ${sql}`);
      },
    },
    env: {
      SHILOH_CLIENT_CONSULTATION_FORMS_ENABLED: 'true',
      SHILOH_CONSULTATION_FORM_DELIVERY_ENABLED: 'false',
    },
    formService: enabledFormService(),
  });
  const result = await service.runOnce();
  assert.equal(result.created, 2);
  assert.equal(result.attempted, 0);
  assert.equal(result.sent, 0);
  assert.equal(result.reason, 'delivery_disabled');
  assert.equal(sqlSeen.length, 1);
  assert.match(sqlSeen[0], /consultation_form_service_mappings/);
  assert.match(sqlSeen[0], /ON CONFLICT \(appointment_id,template_version_id\) DO NOTHING/);
  assert.match(sqlSeen[0], /'not_sent',\$1::timestamptz,\$1::timestamptz/);
  assert.match(sqlSeen[0], /ap\.starts_at>\$1::timestamptz AND ap\.starts_at<=\$2::timestamptz/);
});

test('a due assignment sends only appointment context plus the opaque URL token, never health answers', async () => {
  const token = Buffer.alloc(32, 23).toString('base64url');
  const sends = [];
  const sqlSeen = [];
  const db = {
    async query(sql, values = []) {
      sqlSeen.push({ sql, values });
      if (sql.includes('consultationFormDelivery:context')) {
        return {
          rowCount: 1,
          rows: [{
            assignment_id: 7,
            appointment_id: 101,
            template_version_id: 12,
            assignment_status: 'not_sent',
            starts_at: '2026-09-24T12:30:00.000Z',
            appointment_status: 'confirmed',
            template_key: 'hot_stone_massage_consultation',
            service_name: 'Hot Stone Massage',
          }],
        };
      }
      if (/UPDATE consultation_form_assignments/.test(sql)) return { rowCount: 1, rows: [] };
      if (/INSERT INTO crm_audit_events/.test(sql)) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const service = delivery.createConsultationFormDeliveryService({
    db,
    env: {
      SHILOH_CLIENT_CONSULTATION_FORMS_ENABLED: 'true',
      SHILOH_CONSULTATION_FORM_DELIVERY_ENABLED: 'true',
    },
    formService: enabledFormService(token),
    assertSendAllowed: async (templateName, language) => {
      assert.equal(templateName, 'shiloh_consultation_form_v1');
      assert.equal(language, 'en');
    },
    loadAuthority: async () => ({
      identity_model: 'crm_v2',
      client_id: null,
      crm_v2_client_id: 55,
      client_phone: '27821234567',
      client_name_snapshot: 'Naledi Mokoena',
    }),
    initialFailure: () => null,
    sendTemplate: async (...args) => {
      sends.push(args);
      return { messages: [{ id: 'wamid.form-1' }] };
    },
    now: () => new Date('2026-09-17T08:00:00.000Z'),
  });

  const result = await service.sendAssignment(7);
  assert.equal(result.sent, true);
  assert.equal(result.providerMessageId, 'wamid.form-1');
  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0], [
    '27821234567',
    'shiloh_consultation_form_v1',
    ['Naledi Mokoena', 'Hot Stone Massage', 'Thursday, 24 September 2026'],
    'en',
    [],
    [token],
  ]);
  assert.doesNotMatch(JSON.stringify(sends), /allerg|medical|answer|signature/i);
  const audit = sqlSeen.find((entry) => /INSERT INTO crm_audit_events/.test(entry.sql));
  assert.ok(audit);
  assert.equal(String(audit.values[3] || '').includes(token), false);
});

test('delivery source stays mapping-driven, avoids plaintext health payloads and suppresses uncertain automatic retries', () => {
  assert.match(deliverySource, /consultation_form_service_mappings/);
  assert.match(deliverySource, /status='not_sent'/);
  assert.match(deliverySource, /consultation_form\.delivery_uncertain/);
  assert.match(deliverySource, /NOT EXISTS[\s\S]*consultation_form\.delivery_uncertain/);
  assert.doesNotMatch(deliverySource, /payload_ciphertext|decryptSubmissionPayload|consultation_form_submissions/);
  assert.match(deliverySource, /assertTemplateSendAllowed\(INITIAL_TEMPLATE, TEMPLATE_LANGUAGE\)/);
  assert.match(appSource, /startConsultationFormDeliveryScheduler/);
});
