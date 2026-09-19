process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  TOOL_NAMES,
  READ_TOOL_DEFINITIONS,
  createMyShilohReadTools,
} = require('../src/services/myShilohReadTools');
const {
  runReadToolLoop,
  parseToolArguments,
  functionCalls,
} = require('../src/services/ai');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function appointment(id, startsAt = '2026-09-24T08:00:00.000Z') {
  return {
    id,
    startsAt,
    endsAt: '2026-09-24T09:30:00.000Z',
    status: 'confirmed',
    totalPrice: '850.00',
    currency: 'ZAR',
    services: ['Hot Stone Massage'],
    practitioners: ['Marietjie'],
  };
}

test('My Shiloh read-tool schemas are strict and expose no client selector', () => {
  assert.deepEqual(
    READ_TOOL_DEFINITIONS.map(tool => tool.name),
    [
      TOOL_NAMES.NEXT_APPOINTMENT,
      TOOL_NAMES.UPCOMING_BOOKINGS,
      TOOL_NAMES.FORM_STATUS,
      TOOL_NAMES.PAYMENT_STATUS,
      TOOL_NAMES.FIND_AVAILABLE_SLOTS,
    ],
  );

  for (const tool of READ_TOOL_DEFINITIONS) {
    assert.equal(tool.type, 'function');
    assert.equal(tool.strict, true);
    assert.equal(tool.parameters.type, 'object');
    assert.equal(tool.parameters.additionalProperties, false);
    assert.deepEqual(
      [...tool.parameters.required].sort(),
      Object.keys(tool.parameters.properties).sort(),
    );
    assert.equal(Object.prototype.hasOwnProperty.call(tool.parameters.properties, 'clientId'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(tool.parameters.properties, 'crmV2ClientId'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(tool.parameters.properties, 'appointmentId'), false);
  }
});

test('typed client read tools return presentation-safe canonical facts only', async () => {
  const calls = [];
  const tools = createMyShilohReadTools({
    contextService: {
      async loadNextAppointment(clientId) {
        calls.push(['next', clientId]);
        return appointment(901);
      },
      async loadUpcomingAppointments(clientId, options) {
        calls.push(['upcoming', clientId, options]);
        return [
          appointment(901),
          { ...appointment(902, '2026-10-02T10:00:00.000Z'), services: ['Full Body Swedish'] },
        ];
      },
      async loadForms(clientId, appointmentId) {
        calls.push(['forms', clientId, appointmentId]);
        return [{
          id: 81,
          status: 'sent',
          templateKey: 'hot_stone_massage_consultation',
          title: 'Hot Stone Massage Consultation',
          actionRequired: true,
        }];
      },
      async loadPayment(value) {
        calls.push(['payment', value.id]);
        return {
          state: 'partially_paid',
          amountDue: '850.00',
          paid: '350.00',
          refunded: '0.00',
          netPaid: '350.00',
          outstanding: '500.00',
          currency: 'ZAR',
          activePaymentPath: '/pay/PAYREQ_SECRET',
          providerSecret: 'never expose',
        };
      },
    },
    availability: async (intent, options) => {
      calls.push(['availability', intent, options.daypart]);
      return {
        status: 'available',
        service: { id: 101, name: 'Hot Stone Massage' },
        slots: [
          {
            starts_at: '2026-09-25T07:00:00.000Z',
            ends_at: '2026-09-25T08:30:00.000Z',
            staff_id: 13,
            staff_name: 'Marietjie',
          },
        ],
      };
    },
    now: () => new Date('2026-09-19T05:00:00.000Z'),
  });

  const next = await tools.execute(TOOL_NAMES.NEXT_APPOINTMENT, {}, { crmV2ClientId: 912 });
  assert.equal(next.found, true);
  assert.equal(next.appointment.services[0], 'Hot Stone Massage');
  assert.equal(Object.prototype.hasOwnProperty.call(next.appointment, 'id'), false);

  const upcoming = await tools.execute(TOOL_NAMES.UPCOMING_BOOKINGS, {}, { crmV2ClientId: 912 });
  assert.equal(upcoming.count, 2);
  assert.equal(upcoming.bookings[1].services[0], 'Full Body Swedish');
  assert.equal(Object.prototype.hasOwnProperty.call(upcoming.bookings[0], 'id'), false);

  const forms = await tools.execute(TOOL_NAMES.FORM_STATUS, {}, { crmV2ClientId: 912 });
  assert.deepEqual(forms.forms, [{
    title: 'Hot Stone Massage Consultation',
    status: 'sent',
    actionRequired: true,
  }]);
  assert.equal(JSON.stringify(forms).includes('hot_stone_massage_consultation'), false);
  assert.equal(JSON.stringify(forms).includes('"id"'), false);

  const payment = await tools.execute(TOOL_NAMES.PAYMENT_STATUS, {}, { crmV2ClientId: 912 });
  assert.equal(payment.payment.state, 'partially_paid');
  assert.equal(payment.payment.outstanding, '500.00');
  assert.equal(payment.payment.securePaymentAvailable, true);
  assert.equal(JSON.stringify(payment).includes('PAYREQ_SECRET'), false);
  assert.equal(JSON.stringify(payment).includes('providerSecret'), false);

  const availability = await tools.execute(TOOL_NAMES.FIND_AVAILABLE_SLOTS, {
    service: 'Hot Stone Massage',
    date: '2026-09-25',
    practitioner: 'Marietjie',
    daypart: 'morning',
  }, { crmV2ClientId: 912 });
  assert.equal(availability.status, 'available');
  assert.equal(availability.readOnly, true);
  assert.equal(availability.slots[0].practitioner, 'Marietjie');
  assert.equal(Object.prototype.hasOwnProperty.call(availability.slots[0], 'staffId'), false);

  assert.ok(calls.some(call => call[0] === 'next' && call[1] === 912));
  assert.ok(calls.some(call => call[0] === 'availability'
    && call[1].service_text === 'Hot Stone Massage'
    && call[1].therapist_text === 'Marietjie'
    && call[2] === 'morning'));
});

test('availability tool remains a read-only adapter over the existing canonical client availability path', () => {
  const source = read('src/services/myShilohReadTools.js');
  assert.match(source, /authoritativeSlotsForIntent/);
  assert.match(source, /readOnly: true/);
  assert.doesNotMatch(source, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|processBookingMessage|saveIntent|clearIntent/);
});

test('Responses read-tool loop returns function outputs with previous response continuity', async () => {
  const requests = [];
  const executed = [];
  const responsesClient = {
    responses: {
      async create(payload) {
        requests.push(payload);
        return {
          id: 'resp-final',
          output: [],
          output_text: 'Your next Hot Stone Massage is Thursday at 10:00 with Marietjie.',
        };
      },
    },
  };
  const initial = {
    id: 'resp-tool',
    output: [{
      type: 'function_call',
      name: TOOL_NAMES.NEXT_APPOINTMENT,
      call_id: 'call_1',
      arguments: '{}',
    }],
    output_text: '',
  };

  const result = await runReadToolLoop({
    responsesClient,
    response: initial,
    instructions: 'Use canonical read tools.',
    tools: READ_TOOL_DEFINITIONS,
    toolExecutor: async (name, args) => {
      executed.push({ name, args });
      return { ok: true, found: true, appointment: { services: ['Hot Stone Massage'] } };
    },
    maxToolRounds: 4,
  });

  assert.equal(result.limitReached, false);
  assert.equal(result.rounds, 1);
  assert.equal(result.response.id, 'resp-final');
  assert.deepEqual(executed, [{ name: TOOL_NAMES.NEXT_APPOINTMENT, args: {} }]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].previous_response_id, 'resp-tool');
  assert.equal(requests[0].instructions, 'Use canonical read tools.');
  assert.equal(requests[0].parallel_tool_calls, false);
  assert.equal(requests[0].input[0].type, 'function_call_output');
  assert.equal(requests[0].input[0].call_id, 'call_1');
  assert.match(requests[0].input[0].output, /Hot Stone Massage/);
});

test('tool helpers fail closed for malformed arguments and ignore non-function response items', () => {
  assert.deepEqual(parseToolArguments('{}'), {});
  assert.equal(parseToolArguments('{bad'), null);
  assert.deepEqual(functionCalls({
    output: [
      { type: 'message', content: [] },
      { type: 'function_call', name: 'tool', call_id: 'c', arguments: '{}' },
    ],
  }).map(item => item.name), ['tool']);
});
