const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInstructions } = require('../src/services/orchestrator');
const { createMyShilohAssistantService } = require('../src/services/myShilohAssistant');
const { createMyShilohRouter } = require('../src/routes/myShiloh');
const { renderMyShilohPage } = require('../src/presentation/myShilohPwa');

test('retired WhatsApp context cannot enter the current authenticated assistant', async () => {
  const exchange = { clientMessage: 'SYNTHETIC_RETIRED_EXCHANGE', shilohReply: 'Old reply' };
  assert.doesNotMatch(buildInstructions({ surface: 'my_shiloh', whatsappContinuation: exchange }), /SYNTHETIC_RETIRED_EXCHANGE|CLIENT-APPROVED RECENT WHATSAPP/);
  let options;
  const context = { client: { id: 912, name: 'Synthetic Client' } };
  const service = createMyShilohAssistantService({
    contextService: { async getContext() { return context; } },
    readTools: { definitions: [], async execute() {} },
    ai: async (key, message, args) => {
      assert.equal(key, 'myshiloh:55');
      assert.equal(message, 'What is my appointment status?');
      options = args;
      return 'Let me check your current appointment.';
    },
    continuationService: { async claimedForSession() { throw new Error('Retired bridge must not be consulted'); } },
  });
  const result = await service.reply({ sessionId: 55, crmV2ClientId: 912, message: 'What is my appointment status?' });
  assert.equal(result.reply, 'Let me check your current appointment.');
  assert.equal(options.clientContext, context);
  assert.equal(options.surface, 'my_shiloh');
  assert.equal(Object.hasOwn(options, 'whatsappContinuation'), false);
});

test('retired continuation routes and module are absent while current chat remains registered', () => {
  const router = createMyShilohRouter();
  const routes = router.stack.filter(layer => layer.route).map(layer => layer.route.path);
  assert.equal(routes.includes('/my-shiloh/api/shiloh/whatsapp-continuation'), false);
  assert.equal(routes.includes('/my-shiloh/api/shiloh/message'), true);
  assert.throws(() => require.resolve('../src/services/clientWhatsAppContinuation'), { code: 'MODULE_NOT_FOUND' });
  const html = renderMyShilohPage({ client: { id: '912', name: 'Synthetic Client', firstName: 'Synthetic' }, catalogue: [], crmAvailable: true });
  assert.doesNotMatch(html, /data-whatsapp-continuation|Continue from WhatsApp/);
  assert.match(html, /data-shiloh-chat-form/);
});
