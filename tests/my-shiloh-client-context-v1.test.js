const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createMyShilohClientContextService,
} = require('../src/services/myShilohClientContext');
const {
  buildClientExperience,
} = require('../src/services/myShilohExperienceOrchestrator');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('authenticated client context is keyed only by CRM V2 identity and projects canonical read-only facts', async () => {
  const calls = [];
  const db = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('myShilohClientContext:client')) {
        return { rows: [{ id: 55, name: 'Naledi Mokoena' }], rowCount: 1 };
      }
      if (sql.includes('myShilohClientContext:next-appointment')) {
        assert.equal(values[0], 55);
        return {
          rows: [{
            id: 901,
            starts_at: '2026-09-24T08:00:00.000Z',
            ends_at: '2026-09-24T09:00:00.000Z',
            status: 'confirmed',
            total_price: '850.00',
            currency: 'ZAR',
            services: [{ name: 'Hot Stone Massage', position: 1 }],
            practitioners: [{ name: 'Marietjie', position: 1 }],
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('myShilohClientContext:forms-status-only')) {
        assert.deepEqual(values, [55, 901]);
        return {
          rows: [{
            id: 81,
            status: 'sent',
            template_key: 'hot_stone_massage_consultation',
            title: 'Hot Stone Massage Consultation',
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('myShilohClientContext:payment-position')) {
        assert.deepEqual(values, [901]);
        return {
          rows: [{
            id: 71,
            canonical_amount_due: '850.00',
            currency: 'ZAR',
            paid: '350.00',
            refunded: '0.00',
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('myShilohClientContext:active-payment-request')) {
        assert.deepEqual(values, [71]);
        return { rows: [{ request_key: 'PAYREQ_123456' }], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const service = createMyShilohClientContextService({
    db,
    now: () => new Date('2026-09-18T20:00:00.000Z'),
  });
  const context = await service.getContext({ crmV2ClientId: 55 });

  assert.equal(context.client.name, 'Naledi Mokoena');
  assert.equal(context.nextAppointment.id, 901);
  assert.deepEqual(context.nextAppointment.services, ['Hot Stone Massage']);
  assert.deepEqual(context.nextAppointment.practitioners, ['Marietjie']);
  assert.equal(context.forms[0].actionRequired, true);
  assert.equal(context.payment.state, 'partially_paid');
  assert.equal(context.payment.outstanding, '500.00');
  assert.equal(context.payment.activePaymentPath, '/pay/PAYREQ_123456');
  assert.equal(calls.some(call => call.values.includes(55)), true);
});

test('Shiloh experience prioritises client action without becoming booking, forms or payment authority', () => {
  const experience = buildClientExperience({
    version: 'my_shiloh_client_context_v1',
    generatedAt: '2026-09-18T20:00:00.000Z',
    client: { id: 55, name: 'Naledi Mokoena' },
    nextAppointment: {
      id: 901,
      startsAt: '2026-09-24T08:00:00.000Z',
      endsAt: '2026-09-24T09:00:00.000Z',
      status: 'confirmed',
      services: ['Hot Stone Massage'],
      practitioners: ['Marietjie'],
    },
    forms: [{
      id: 81,
      status: 'sent',
      title: 'Hot Stone Massage Consultation',
      actionRequired: true,
    }],
    payment: {
      state: 'partially_paid',
      outstanding: '500.00',
      activePaymentPath: '/pay/PAYREQ_123456',
    },
  });

  assert.equal(experience.version, 'my_shiloh_client_experience_v1');
  assert.equal(experience.client.firstName, 'Naledi');
  assert.equal(experience.home.status, 'Action needed');
  assert.equal(experience.home.primaryAction.href, '#shiloh');
  assert.equal(experience.bookings.upcoming[0].service, 'Hot Stone Massage');
  assert.match(experience.home.facts.find(item => item.label === 'Payment').value, /R500/);
  assert.ok(experience.assistant.prompts.some(prompt => /consultation form/i.test(prompt)));
});

test('payment action becomes primary only when forms need no client action', () => {
  const experience = buildClientExperience({
    generatedAt: '2026-09-18T20:00:00.000Z',
    client: { id: 55, name: 'Naledi Mokoena' },
    nextAppointment: {
      id: 901,
      startsAt: '2026-09-24T08:00:00.000Z',
      endsAt: '2026-09-24T09:00:00.000Z',
      status: 'confirmed',
      services: ['Hot Stone Massage'],
      practitioners: ['Marietjie'],
    },
    forms: [{ id: 81, status: 'completed', title: 'Consultation', actionRequired: false }],
    payment: {
      state: 'partially_paid',
      outstanding: '500.00',
      activePaymentPath: '/pay/PAYREQ_123456',
    },
  });

  assert.equal(experience.home.status, 'Payment');
  assert.equal(experience.home.primaryAction.href, '/pay/PAYREQ_123456');
});

test('no upcoming appointment produces a calm booking entry instead of invented client facts', () => {
  const experience = buildClientExperience({
    generatedAt: '2026-09-18T20:00:00.000Z',
    client: { id: 55, name: 'Naledi Mokoena' },
    nextAppointment: null,
    forms: [],
    payment: null,
  });
  assert.equal(experience.home.primaryAction.href, '/book');
  assert.deepEqual(experience.bookings.upcoming, []);
  assert.match(experience.home.summary, /no upcoming appointment/i);
});

test('client context never reads health answers, practitioner notes or provider payloads', () => {
  const source = read('src/services/myShilohClientContext.js');
  assert.match(source, /crm_v2_client_id=\$1/);
  assert.match(source, /consultation_form_assignments/);
  assert.match(source, /booking_payment_accounts/);
  assert.match(source, /payment_ledger_entries/);
  assert.doesNotMatch(source, /consultation_form_submissions|consultation_form_practitioner_notes|consultation_form_practitioner_records/);
  assert.doesNotMatch(source, /payload_ciphertext|payload_auth_tag|payment_provider_events/);
  assert.doesNotMatch(source, /normalized_mobile|date_of_birth|gender/);
});

test('My Shiloh experience API derives client identity from validated session, never browser input', () => {
  const route = read('src/routes/myShiloh.js');
  assert.match(route, /router\.get\('\/my-shiloh\/api\/experience', requireSession/);
  assert.match(route, /crmV2ClientId: req\.myShilohClientSession\.crmV2ClientId/);
  assert.doesNotMatch(route, /req\.(?:body|query|params).*crmV2ClientId/);

  const app = read('public/my-shiloh/assets/app.js');
  assert.match(app, /fetch\('\/my-shiloh\/api\/experience'/);
  assert.match(app, /cache: 'no-store'/);
  assert.doesNotMatch(app, /localStorage|sessionStorage/);
});
