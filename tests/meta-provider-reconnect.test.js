const test = require('node:test');
const assert = require('node:assert/strict');

const {
  currentSendableBindings,
  ensureAppSubscription,
  submitMissingCurrentTemplates,
  runMetaProviderReconnect,
  sanitizeProviderError,
} = require('../src/services/metaProviderReconnect');
const {
  RECONNECT_FLAG,
  runMetaProviderReconnectBootstrap,
} = require('../src/bootstrap/metaProviderReconnectBootstrap');
const { META_TEMPLATE_BINDINGS } = require('../src/services/metaTemplateAdapter');
const { getShilohMessageContract } = require('../src/services/shilohMessageContracts');

const env = {
  WHATSAPP_BUSINESS_ACCOUNT_ID: '1114297824590105',
  WHATSAPP_TOKEN: 'secret-token-never-log',
  META_PROVIDER_APP_NAME: 'Shiloh_MTC',
};

function fakeContract(id, lifecycle = 'current', sendable = true) {
  return { id, lifecycle, sendable, message: { language: 'en', category: 'UTILITY', components: [] } };
}

test('canonical reconnect scope contains only current sendable contracts', () => {
  const bindings = currentSendableBindings();
  assert.equal(bindings.length, 26);
  assert.equal(bindings.some((item) => item.contractId === 'workspace_booking_request_alert'), true);
  assert.equal(bindings.some((item) => item.contractId === 'birthday_v1'), false);
  assert.equal(bindings.some((item) => item.contractId === 'appointment_followup_legacy'), false);
  assert.equal(bindings.some((item) => item.contractId === 'appointment_reminder_legacy'), false);
  assert.equal(bindings.some((item) => item.contractId === 'booking_approval_request'), false);
  assert.equal(bindings.some((item) => item.contractId === 'booking_approval_outcome'), false);
  for (const binding of bindings) {
    const contract = getShilohMessageContract(binding.contractId);
    assert.equal(contract.lifecycle, 'current');
    assert.equal(contract.sendable, true);
  }
  assert.equal(META_TEMPLATE_BINDINGS.length, 31);
});

test('existing Shiloh_MTC WABA subscription is not rewritten', async () => {
  let posts = 0;
  const http = {
    get: async () => ({ data: { data: [{ id: 'app-1', name: 'Shiloh_MTC' }] } }),
    post: async () => { posts += 1; return { data: { success: true } }; },
  };
  const result = await ensureAppSubscription({ wabaId: env.WHATSAPP_BUSINESS_ACCOUNT_ID, env, http });
  assert.equal(result.ok, true);
  assert.equal(result.action, 'skipped_existing');
  assert.equal(posts, 0);
});

test('missing WABA app subscription is created once and read back', async () => {
  let subscribed = false;
  let posts = 0;
  const http = {
    get: async () => ({
      data: { data: subscribed ? [{ id: 'app-1', name: 'Shiloh_MTC' }] : [] },
    }),
    post: async (url, body) => {
      assert.match(url, /1114297824590105\/subscribed_apps$/);
      assert.deepEqual(body, {});
      posts += 1;
      subscribed = true;
      return { data: { success: true } };
    },
  };
  const first = await ensureAppSubscription({ wabaId: env.WHATSAPP_BUSINESS_ACCOUNT_ID, env, http });
  assert.equal(first.ok, true);
  assert.equal(first.action, 'subscribed');
  assert.equal(posts, 1);
  const second = await ensureAppSubscription({ wabaId: env.WHATSAPP_BUSINESS_ACCOUNT_ID, env, http });
  assert.equal(second.action, 'skipped_existing');
  assert.equal(posts, 1);
});

test('template provisioning skips any existing same-name/language variant including pending', async () => {
  let posts = 0;
  const bindings = [{ contractId: 'booking_update' }];
  const payload = {
    name: 'shiloh_booking_update_v1',
    language: 'en',
    category: 'UTILITY',
    components: [{ type: 'BODY', text: 'Canonical {{1}}' }],
  };
  const result = await submitMissingCurrentTemplates({
    wabaId: env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    env,
    http: { post: async () => { posts += 1; throw new Error('should not post'); } },
    fetchTemplates: async () => [{
      id: 'pending-1',
      name: payload.name,
      language: payload.language,
      status: 'PENDING',
      category: payload.category,
    }],
    bindings,
    getContract: () => fakeContract('booking_update'),
    buildPayload: () => payload,
  });
  assert.equal(result.ok, true);
  assert.equal(result.templates[0].action, 'skipped_existing');
  assert.equal(result.templates[0].provider.status, 'PENDING');
  assert.equal(posts, 0);
});

test('missing current template is submitted with the exact canonical adapter payload', async () => {
  const expectedPayload = {
    name: 'shiloh_example_v1',
    language: 'en',
    category: 'UTILITY',
    components: [{ type: 'BODY', text: 'Exact {{1}}' }],
  };
  const posted = [];
  const result = await submitMissingCurrentTemplates({
    wabaId: env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    env,
    http: {
      post: async (url, body) => {
        posted.push({ url, body });
        return { data: { id: 'provider-1', status: 'PENDING', category: 'UTILITY' } };
      },
    },
    fetchTemplates: async () => [],
    bindings: [{ contractId: 'example' }, { contractId: 'retired' }],
    getContract: (id) => id === 'retired'
      ? fakeContract(id, 'retired', false)
      : fakeContract(id),
    buildPayload: (id) => {
      assert.equal(id, 'example');
      return expectedPayload;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(posted.length, 1);
  assert.match(posted[0].url, /1114297824590105\/message_templates$/);
  assert.deepEqual(posted[0].body, expectedPayload);
  assert.deepEqual(result.templates.map((item) => item.contractId), ['example']);
});

test('provider reconnect fails closed when provider configuration is absent', async () => {
  let calls = 0;
  const http = {
    get: async () => { calls += 1; },
    post: async () => { calls += 1; },
  };
  const result = await runMetaProviderReconnect({ env: {}, http, fetchTemplates: async () => [] });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'provider_config_missing');
  assert.equal(calls, 0);
});

test('provider errors are sanitized without headers, token or raw response body', () => {
  const error = {
    response: {
      status: 403,
      data: { error: { code: 10, error_subcode: 123, type: 'OAuthException', message: env.WHATSAPP_TOKEN } },
    },
    config: { headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` } },
  };
  const sanitized = sanitizeProviderError(error);
  const serialized = JSON.stringify(sanitized);
  assert.deepEqual(sanitized, { status: 403, code: 10, subcode: 123, type: 'OAuthException' });
  assert.equal(serialized.includes(env.WHATSAPP_TOKEN), false);
  assert.equal(serialized.includes('Authorization'), false);
});

test('bootstrap is off by default and makes no reconnect call', async () => {
  let calls = 0;
  const result = await runMetaProviderReconnectBootstrap({
    env: {},
    reconnect: async () => { calls += 1; return { ok: true }; },
    log: { info() {}, warn() {} },
  });
  assert.deepEqual(result, { skipped: true });
  assert.equal(calls, 0);
});

test('bootstrap explicit gate logs only sanitized reconnect summary', async () => {
  const logs = [];
  const result = await runMetaProviderReconnectBootstrap({
    env: { [RECONNECT_FLAG]: 'true' },
    reconnect: async () => ({
      ok: true,
      wabaId: 'waba-1',
      subscription: { ok: true, action: 'subscribed', expectedAppName: 'Shiloh_MTC', app: { id: 'app-1', name: 'Shiloh_MTC' } },
      templateProvisioning: {
        templates: [
          { contractId: 'a', action: 'submitted', ok: true },
          { contractId: 'b', action: 'skipped_existing', ok: true },
        ],
      },
    }),
    log: {
      info: (fields, message) => logs.push({ fields, message }),
      warn: (fields, message) => logs.push({ fields, message }),
    },
  });
  assert.equal(result.ok, true);
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0].fields.templates.submitted, ['a']);
  assert.deepEqual(logs[0].fields.templates.skippedExisting, ['b']);
  assert.equal(JSON.stringify(logs).includes('secret-token-never-log'), false);
});
