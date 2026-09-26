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
      if (sql.includes('myShilohClientContext:active-booking-request')) {
        assert.deepEqual(values, [55]);
        return { rows: [], rowCount: 0 };
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
  assert.equal(context.activeRequest, null);
  assert.deepEqual(context.activeRequests, []);
  assert.deepEqual(context.nextAppointment.services, ['Hot Stone Massage']);
  assert.deepEqual(context.nextAppointment.practitioners, ['Marietjie']);
  assert.equal(context.forms[0].actionRequired, true);
  assert.equal(context.payment.state, 'partially_paid');
  assert.equal(context.payment.outstanding, '500.00');
  assert.equal(context.payment.activePaymentPath, '/pay/PAYREQ_123456');
  assert.equal(calls.some(call => call.values.includes(55)), true);
});

test('a canonical client request takes priority over an upcoming visit without appearing confirmed or payable', () => {
  const base = {
    generatedAt: '2026-09-26T10:00:00.000Z',
    client: { id: 55, name: 'Naledi Mokoena' },
    nextAppointment: { id: 901, startsAt: '2026-09-27T08:00:00.000Z', services: ['Massage'], practitioners: ['Abigail'], status: 'confirmed' },
    forms: [{ title: 'Form', actionRequired: true }],
    payment: { state: 'unpaid', depositState: 'awaiting', activePaymentPath: '/pay/existing_booking' },
    activeRequest: { id: 902, startsAt: '2026-10-02T08:00:00.000Z', services: ['Facial'], practitioners: ['Christel'], bookingRequestStatus: 'pending' },
  };
  const requested = buildClientExperience(base);
  assert.equal(requested.home.status, 'Requested');
  assert.match(requested.home.summary, /not confirmed yet/i);
  assert.equal(requested.home.primaryAction.href, '#bookings');
  assert.equal(requested.bookings.upcoming[0].id, 902);
  assert.doesNotMatch(JSON.stringify(requested.home), /\/pay\/existing_booking/);

  const multiple = buildClientExperience({ ...base, activeRequests: [base.activeRequest, {
    ...base.activeRequest, id: 903, startsAt: '2026-10-04T08:00:00.000Z',
  }] });
  assert.deepEqual(multiple.bookings.upcoming.map(item => item.id), [902, 903, 901]);

  const offered = buildClientExperience({ ...base, activeRequest: {
    ...base.activeRequest,
    bookingRequestStatus: 'awaiting_client_confirmation',
    proposedStartsAt: '2026-10-03T08:00:00.000Z',
    proposalExpiresAt: '2026-09-27T10:00:00.000Z',
  } });
  assert.equal(offered.home.status, 'Awaiting your response');
  assert.match(offered.bookings.upcoming[0].nextAction, /Reply to the Shiloh message/);

  const expired = buildClientExperience({ ...base, generatedAt: '2026-09-28T10:00:00.000Z', activeRequest: {
    ...base.activeRequest,
    bookingRequestStatus: 'awaiting_client_confirmation',
    proposedStartsAt: '2026-10-03T08:00:00.000Z',
    proposalExpiresAt: '2026-09-27T10:00:00.000Z',
  } });
  assert.equal(expired.home.status, 'Requested');
});

test('active request is scoped to the signed-in CRM client and reads the existing approval state', async () => {
  const db = { async query(sql, values) {
    assert.match(sql, /a\.crm_v2_client_id=\$1 AND a\.client_id IS NULL/);
    assert.match(sql, /aba\.status IN \('pending','awaiting_client_confirmation'\)/);
    assert.deepEqual(values, [55]);
    return { rows: [{
      id: 902, crm_v2_client_id: 55, starts_at: '2026-10-02T08:00:00.000Z', ends_at: '2026-10-02T09:00:00.000Z',
      status: 'scheduled', booking_request_status: 'awaiting_client_confirmation',
      proposed_starts_at: '2026-10-03T08:00:00.000Z', proposal_expires_at: '2026-09-27T10:00:00.000Z',
      services: [{ name: 'Facial' }], practitioners: [{ name: 'Christel' }],
    }] };
  } };
  const request = await createMyShilohClientContextService({ db }).loadActiveBookingRequest(55);
  assert.equal(request.bookingRequestStatus, 'awaiting_client_confirmation');
  assert.equal(request.proposedStartsAt, '2026-10-03T08:00:00.000Z');
  assert.deepEqual(request.services, ['Facial']);
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
  assert.equal(experience.home.facts.find(item => item.key === 'appointment').href, '#bookings');
  assert.equal(experience.home.facts.find(item => item.key === 'forms').href, '/my-shiloh/forms/complete');
  assert.equal(experience.home.facts.find(item => item.key === 'payment').href, '/pay/PAYREQ_123456');
  assert.match(experience.home.facts.find(item => item.key === 'payment').value, /R500/);
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
  assert.equal(experience.bookings.upcoming[0].paymentHelpNeeded, false);
});

test('client booking can request WhatsApp help when its deposit awaits a missing link', () => {
  const experience = buildClientExperience({
    generatedAt: '2026-09-26T12:00:00.000Z',
    client: { id: 55, name: 'Client Example' },
    nextAppointment: { id: 779, status:'scheduled',startsAt:'2026-09-29T08:00:00.000Z',endsAt:'2026-09-29T09:30:00.000Z',services:['Swedish Massage'],practitioners:['Ilince'] },
    forms: [],
    payment: { state:'unpaid',depositState:'awaiting',depositOutstanding:'295.00',activePaymentPath:null },
  });
  assert.equal(experience.bookings.upcoming[0].paymentHelpNeeded, true);
  assert.equal(experience.bookings.upcoming[0].id, 779);
});

test('no upcoming appointment produces a calm booking entry instead of invented client facts', () => {
  const experience = buildClientExperience({
    generatedAt: '2026-09-18T20:00:00.000Z',
    client: { id: 55, name: 'Naledi Mokoena' },
    nextAppointment: null,
    forms: [],
    payment: null,
  });
  assert.equal(experience.home.primaryAction.href, '/my-shiloh/book');
  assert.deepEqual(experience.bookings.upcoming, []);
  assert.equal(experience.home.facts.find(item => item.key === 'appointment').href, '#bookings');
  assert.equal(experience.home.facts.find(item => item.key === 'forms').href, null);
  assert.equal(experience.home.facts.find(item => item.key === 'forms').message, 'Nothing waiting right now.');
  assert.equal(experience.home.facts.find(item => item.key === 'payment').href, null);
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
  assert.match(app, /INSTALL_VERIFIED_KEY = 'my-shiloh-install-whatsapp-verified-v1'/);
  assert.doesNotMatch(app, /sessionStorage|indexedDB/);
  assert.doesNotMatch(app, /localStorage\.setItem\([^\n]*(?:experience|appointment|payment|forms|client|token|session|csrf)/i);
});
