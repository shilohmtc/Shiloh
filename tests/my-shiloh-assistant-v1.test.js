const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildAuthenticatedClientContext,
  buildInstructions,
} = require('../src/services/orchestrator');
const {
  MAX_MESSAGE_CHARS,
  MyShilohAssistantError,
  normalizeMessage,
  conversationKey,
  createMessageLimiter,
  createMyShilohAssistantService,
} = require('../src/services/myShilohAssistant');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function sampleContext() {
  return {
    version: 'my_shiloh_client_context_v1',
    generatedAt: '2026-09-19T04:30:00.000Z',
    client: { id: 912, name: 'Christel Botha' },
    nextAppointment: {
      id: 901,
      startsAt: '2026-09-24T08:00:00.000Z',
      endsAt: '2026-09-24T09:30:00.000Z',
      status: 'confirmed',
      services: ['Hot Stone Massage'],
      practitioners: ['Marietjie'],
    },
    forms: [{
      id: 81,
      status: 'sent',
      templateKey: 'hot_stone_massage_consultation',
      title: 'Hot Stone Massage Consultation',
      actionRequired: true,
    }],
    payment: {
      state: 'partially_paid',
      amountDue: '850.00',
      paid: '350.00',
      refunded: '0.00',
      netPaid: '350.00',
      outstanding: '500.00',
      activePaymentPath: '/pay/PAYREQ_123456',
      providerSecret: 'never-send-this',
    },
  };
}

test('authenticated AI context exposes only presentation-safe client facts', () => {
  const context = buildAuthenticatedClientContext(sampleContext());
  assert.match(context, /Client first name: Christel/);
  assert.match(context, /Hot Stone Massage/);
  assert.match(context, /Marietjie/);
  assert.match(context, /Consultation form: Hot Stone Massage Consultation — sent/);
  assert.match(context, /Outstanding: ZAR 500\.00/);
  assert.doesNotMatch(context, /Botha/);
  assert.doesNotMatch(context, /\b912\b|\b901\b|\b81\b/);
  assert.doesNotMatch(context, /PAYREQ|providerSecret|never-send-this|\/pay\//);
});

test('My Shiloh instructions keep AI read-only and canonical client context above conversation history', () => {
  const instructions = buildInstructions({
    profile: { name: 'Christel' },
    clientContext: sampleContext(),
    surface: 'my_shiloh',
  });
  assert.match(instructions, /authenticated My Shiloh client assistant/);
  assert.match(instructions, /AUTHENTICATED CLIENT CONTEXT/);
  assert.match(instructions, /server-derived and authoritative/);
  assert.match(instructions, /No such mutation tools are available in this phase/);
  assert.match(instructions, /Never infer health information/);
  assert.match(instructions, /Never claim that you booked, rescheduled, cancelled, paid, refunded/);
});

test('My Shiloh message validation is bounded and conversation keys stay session-scoped', () => {
  assert.equal(normalizeMessage('  Hello Shiloh  '), 'Hello Shiloh');
  assert.throws(() => normalizeMessage(''), MyShilohAssistantError);
  assert.throws(() => normalizeMessage('x'.repeat(MAX_MESSAGE_CHARS + 1)), /shorten/i);
  assert.equal(conversationKey(55), 'myshiloh:55');
  assert.throws(() => conversationKey('bad'), /session/i);
});

test('authenticated assistant reuses Shiloh AI with server context and a separate conversation key', async () => {
  const calls = [];
  const cleared = [];
  const service = createMyShilohAssistantService({
    ai: async (...args) => {
      calls.push(args);
      return 'Your Hot Stone Massage is confirmed for Thursday at 10:00.';
    },
    contextService: {
      async getContext({ crmV2ClientId }) {
        assert.equal(crmV2ClientId, 912);
        return sampleContext();
      },
    },
    clearConversationSession: async (key) => { cleared.push(key); },
  });

  const result = await service.reply({
    sessionId: 55,
    crmV2ClientId: 912,
    message: 'When is my appointment?',
  });

  assert.match(result.reply, /Hot Stone Massage/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'myshiloh:55');
  assert.equal(calls[0][1], 'When is my appointment?');
  assert.equal(calls[0][2].conversationKey, 'myshiloh:55');
  assert.equal(calls[0][2].surface, 'my_shiloh');
  assert.equal(calls[0][2].profileOverride.name, 'Christel');
  assert.equal(calls[0][2].clientContext.client.id, 912);

  await service.clearConversation({ sessionId: 55 });
  assert.deepEqual(cleared, ['myshiloh:55']);
});

test('assistant rate limiter is per secure session and fails closed after the bounded window', async () => {
  let now = 1000;
  const limiter = createMessageLimiter({ now: () => now, windowMs: 60000, limit: 2 });
  const service = createMyShilohAssistantService({
    ai: async () => 'ok',
    contextService: { async getContext() { return sampleContext(); } },
    limiter,
    clearConversationSession: async () => true,
  });

  await service.reply({ sessionId: 1, crmV2ClientId: 912, message: 'one' });
  await service.reply({ sessionId: 1, crmV2ClientId: 912, message: 'two' });
  await assert.rejects(
    () => service.reply({ sessionId: 1, crmV2ClientId: 912, message: 'three' }),
    error => error.code === 'MY_SHILOH_ASSISTANT_RATE_LIMITED' && error.httpStatus === 429,
  );

  now += 60001;
  const result = await service.reply({ sessionId: 1, crmV2ClientId: 912, message: 'again' });
  assert.equal(result.reply, 'ok');
});

test('My Shiloh chat endpoint trusts only validated session identity and rejects browser client selectors', () => {
  const route = read('src/routes/myShiloh.js');
  assert.match(route, /router\.post\('\/my-shiloh\/api\/shiloh\/message', sameOrigin, requireSession/);
  assert.match(route, /sessionId: req\.myShilohClientSession\.sessionId/);
  assert.match(route, /crmV2ClientId: req\.myShilohClientSession\.crmV2ClientId/);
  assert.match(route, /filter\(\(key\) => key !== 'message'\)/);
  assert.doesNotMatch(route, /req\.(?:body|query|params).*crmV2ClientId/);
});

test('in-app chat uses text-only DOM rendering and no browser persistence', () => {
  const presentation = read('src/presentation/myShilohPwa.js');
  const app = read('public/my-shiloh/assets/app.js');
  const worker = read('public/my-shiloh/sw.js');

  assert.match(presentation, /data-shiloh-chat-form/);
  assert.match(presentation, /data-shiloh-chat-input/);
  assert.match(presentation, /Prefer WhatsApp\?/);
  assert.match(app, /postJson\('\/my-shiloh\/api\/shiloh\/message'/);
  assert.match(app, /copy\.textContent = String\(message \|\| ''\)/);
  assert.doesNotMatch(app, /localStorage|sessionStorage|indexedDB/i);
  assert.match(worker, /url\.pathname\.startsWith\('\/my-shiloh\/api\/'\)/);
  assert.doesNotMatch(worker, /cache\.put\([^\n]*my-shiloh\/api/);
});

test('shared AI pipeline accepts app surface and session conversation key without changing WhatsApp default', () => {
  const ai = read('src/services/ai.js');
  assert.match(ai, /conversationKey = phone/);
  assert.match(ai, /surface = "whatsapp"/);
  assert.match(ai, /getSession\(conversationKey\)/);
  assert.match(ai, /saveSession\(conversationKey, response\.id\)/);
  assert.match(ai, /surface === "whatsapp"/);
});
