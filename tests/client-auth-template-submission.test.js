const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CLIENT_AUTH_TEMPLATE_NAME,
  buildClientAuthTemplateSubmissionDefinition,
} = require('../src/services/clientAuthTemplateDefinition');
const { submitClientAuthTemplateIfAbsent } = require('../src/services/clientAuthTemplateProvisioning');
const { buildMetaTemplateRegistrationPayload, resolveMetaTemplateBinding } = require('../src/services/metaTemplateAdapter');

test('client code template is a distinct five-minute authentication copy-code contract', () => {
  const definition = buildClientAuthTemplateSubmissionDefinition();
  assert.equal(definition.name, CLIENT_AUTH_TEMPLATE_NAME);
  assert.equal(definition.category, 'AUTHENTICATION');
  assert.equal(definition.message_send_ttl_seconds, 300);
  assert.equal(definition.components[1].code_expiration_minutes, 5);
  assert.deepEqual(definition.components[2].buttons, [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy Code' }]);
  assert.deepEqual(buildMetaTemplateRegistrationPayload('client_auth_otp'), definition);
  const provider = { ...definition, id: 'client-template', status: 'APPROVED' };
  provider.components = structuredClone(definition.components);
  provider.components[2].buttons[0] = {
    type: 'URL', otp_type: 'COPY_CODE', text: 'Copy Code',
    url: 'https://www.whatsapp.com/otp/code/?otp_type=COPY_CODE&code=otp{{1}}',
  };
  assert.equal(resolveMetaTemplateBinding({ contractId: 'client_auth_otp', providerTemplates: [provider] }).bound, true);
});

test('submission checks inventory before sending and never replaces a present client template', async () => {
  const sent = [];
  const options = {
    env: { WHATSAPP_TOKEN: 'synthetic-provider-token' },
    discoverWabaId: async () => 'synthetic-waba',
    fetchTemplates: async () => [],
    post: async (url, body, config) => {
      sent.push({ url, body, config });
      return { data: { id: 'client-auth-template-id', status: 'PENDING', category: 'AUTHENTICATION' } };
    },
  };
  const first = await submitClientAuthTemplateIfAbsent(options);
  assert.equal(first.submitted, true);
  assert.equal(first.status, 'PENDING');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.name, CLIENT_AUTH_TEMPLATE_NAME);
  assert.equal(sent[0].url, 'https://graph.facebook.com/v23.0/synthetic-waba/message_templates');
  const second = await submitClientAuthTemplateIfAbsent({
    ...options,
    fetchTemplates: async () => [{ ...buildClientAuthTemplateSubmissionDefinition(), status: 'PENDING', id: 'client-auth-template-id' }],
  });
  assert.equal(second.submitted, false);
  assert.equal(second.status, 'PENDING');
  assert.equal(sent.length, 1);
});

test('no token or failed provider request cannot be treated as a submission', async () => {
  const noToken = await submitClientAuthTemplateIfAbsent({ env: {} });
  assert.deepEqual(noToken, { ok: false, reason: 'provider_token_unavailable' });
  const rejected = await submitClientAuthTemplateIfAbsent({
    env: { WHATSAPP_TOKEN: 'synthetic-provider-token' },
    discoverWabaId: async () => 'synthetic-waba',
    fetchTemplates: async () => [],
    post: async () => {
      throw Object.assign(new Error('provider rejected'), {
        response: { status: 400, data: { error: { code: 100, message: 'Invalid template' } } },
      });
    },
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'provider_rejected_submission');
  assert.equal(rejected.provider.status, 400);
});
