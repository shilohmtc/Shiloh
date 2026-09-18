const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');

const {
  processWhatsAppStatuses,
  sanitizeProviderText,
} = require('../src/services/whatsappStatusCallback');
const { processWhatsAppStatusWebhook } = require('../src/controllers/whatsappStatusWebhookController');
const {
  STAFF_AUTH_TEMPLATE_NAME,
  STAFF_AUTH_TEMPLATE_LANGUAGE,
  STAFF_AUTH_TEMPLATE_CATEGORY,
  STAFF_AUTH_MESSAGE_TTL_SECONDS,
  STAFF_AUTH_CODE_EXPIRATION_MINUTES,
  buildStaffAuthTemplateSubmissionDefinition,
  buildStaffAuthTemplateContract,
} = require('../src/services/staffAuthTemplateDefinition');
const { sendStaffAuthTemplate } = require('../src/services/staffAuthWhatsApp');
const { createStaffBrowserChallengeDispatcher } = require('../src/services/staffBrowserChallengeDelivery');
const {
  summarizeExactTemplate,
  inspectStaffAuthTemplateInventory,
  submitStaffAuthTemplateIfAbsent,
} = require('../src/services/staffAuthTemplateProvisioning');
const {
  CONTRACTS,
  compareContract,
  inspectMetaTemplateInventory,
  assertTemplateSendAllowed,
  resetTemplateInventoryCache,
} = require('../src/services/metaTemplateContracts');

const originalGet = axios.get;
const originalEnv = { ...process.env };

test.afterEach(() => {
  axios.get = originalGet;
  process.env = { ...originalEnv };
  resetTemplateInventoryCache();
});

function mockLog() {
  const entries = [];
  return {
    entries,
    info(fields, message) { entries.push({ level: 'info', fields, message }); },
    warn(fields, message) { entries.push({ level: 'warn', fields, message }); },
    error(fields, message) { entries.push({ level: 'error', fields, message }); },
  };
}

function mockResponse() {
  return {
    statusCode: 0,
    sendStatus(code) { this.statusCode = code; return this; },
  };
}

test('valid status callbacks correlate sent delivered read and failed by Meta message ID', () => {
  const statuses = ['sent', 'delivered', 'read', 'failed'].map((status, index) => ({
    id: `wamid.repair-${index}`,
    status,
    timestamp: `17876000${index}`,
    ...(status === 'failed' ? { errors: [{ code: 131026, title: 'Undeliverable', message: 'Delivery failed' }] } : {}),
  }));
  const result = processWhatsAppStatuses(statuses);
  assert.equal(result.invalidCount, 0);
  assert.deepEqual(result.records.map((item) => item.providerStatus), ['sent', 'delivered', 'read', 'failed']);
  assert.deepEqual(result.records.map((item) => item.metaMessageId), ['wamid.repair-0', 'wamid.repair-1', 'wamid.repair-2', 'wamid.repair-3']);
  assert.equal(result.records[3].providerError.code, '131026');
});

test('failed provider status retains only sanitized error evidence', () => {
  const phone = '+27821234567';
  const otp = 'ABCDEFGHJK';
  const token = 'EAAabcdefghijklmnopqrstuvwxyz1234567890';
  const result = processWhatsAppStatuses([{
    id: 'wamid.failed-safe',
    status: 'failed',
    timestamp: '1787600000',
    errors: [{ code: '131026', title: `Failure for ${phone}`, message: `OTP ${otp}; Bearer ${token}; recipient ${phone}` }],
  }]);
  const serialized = JSON.stringify(result);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].providerStatus, 'failed');
  assert.doesNotMatch(serialized, /27821234567/);
  assert.doesNotMatch(serialized, /ABCDEFGHJK/);
  assert.doesNotMatch(serialized, /EAAabcdefghijklmnopqrstuvwxyz1234567890/);
  assert.match(serialized, /REDACTED/);
});

test('malformed status payload fails safely without manufacturing records', () => {
  assert.deepEqual(processWhatsAppStatuses({ id: 'not-an-array' }), { records: [], invalidCount: 1 });
  const result = processWhatsAppStatuses([null, {}, { id: 'x', status: 'unknown' }, { id: 'ok', status: 'sent', timestamp: 'not-a-timestamp' }]);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].providerTimestamp, null);
  assert.equal(result.invalidCount, 3);
});

test('status-only webhook is processed and acknowledged while mixed inbound payload continues unchanged', () => {
  const log = mockLog();
  const response = mockResponse();
  let nextCalls = 0;
  processWhatsAppStatusWebhook({
    log,
    body: { entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.status-only', status: 'delivered', timestamp: '1787600000' }] } }] }] },
  }, response, () => { nextCalls += 1; });
  assert.equal(response.statusCode, 200);
  assert.equal(nextCalls, 0);
  assert.equal(log.entries[0].fields.metaMessageId, 'wamid.status-only');
  assert.equal(log.entries[0].fields.providerStatus, 'delivered');

  const mixedResponse = mockResponse();
  processWhatsAppStatusWebhook({
    log,
    body: { entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.mixed', status: 'sent', timestamp: '1787600001' }], messages: [{ id: 'inbound' }] } }] }] },
  }, mixedResponse, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
  assert.equal(mixedResponse.statusCode, 0);
});

test('webhook route keeps status processing first, bounded auth middleware before the existing inbound controller, and staff bootstrap order intact', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '../src/routes/webhook.js'), 'utf8');
  const inboundSource = fs.readFileSync(path.join(__dirname, '../src/controllers/webhookController.js'), 'utf8');
  const routeBlock = routeSource.slice(routeSource.indexOf('router.post('));
  const statusAt = routeBlock.indexOf('processWhatsAppStatusWebhook');
  const clientAuthAt = routeBlock.indexOf('myShilohWhatsAppAuthMiddleware');
  const bootstrapAt = routeBlock.indexOf('staffWhatsAppPasskeyBootstrapMiddleware');
  const inboundAt = routeBlock.indexOf('receiveWebhook');
  assert.ok(statusAt >= 0 && clientAuthAt > statusAt && bootstrapAt > clientAuthAt && inboundAt > bootstrapAt);
  assert.match(routeBlock, /processWhatsAppStatusWebhook[\s\S]*myShilohWhatsAppAuthMiddleware[\s\S]*staffWhatsAppPasskeyBootstrapMiddleware[\s\S]*receiveWebhook/);
  assert.match(inboundSource, /if\(!value\?\.messages\)return res\.sendStatus\(200\)/);
});

test('staff authentication template definition is dedicated Authentication OTP with five-minute controls', () => {
  const submission = buildStaffAuthTemplateSubmissionDefinition();
  const contract = buildStaffAuthTemplateContract();
  assert.equal(submission.name, STAFF_AUTH_TEMPLATE_NAME);
  assert.equal(submission.language, 'en_US');
  assert.equal(submission.category, 'AUTHENTICATION');
  assert.equal(submission.message_send_ttl_seconds, 300);
  assert.equal(submission.components[0].add_security_recommendation, true);
  assert.equal(submission.components[1].code_expiration_minutes, 5);
  assert.deepEqual(submission.components[2].buttons, [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy Code' }]);
  assert.equal(contract.category, STAFF_AUTH_TEMPLATE_CATEGORY);
  assert.equal(contract.message_send_ttl_seconds, STAFF_AUTH_MESSAGE_TTL_SECONDS);
  assert.equal(contract.components[1].code_expiration_minutes, STAFF_AUTH_CODE_EXPIRATION_MINUTES);
  assert.equal(contract.components[2].buttons[0].type, 'URL');
  assert.equal(contract.components[2].buttons[0].otp_type, 'COPY_CODE');
});

test('staff authentication exact contract detects semantic drift', () => {
  const entry = CONTRACTS.find((item) => item.key === 'staff_auth_otp');
  assert.ok(entry);
  const exact = { ...entry.contract, status: 'APPROVED', components: structuredClone(entry.contract.components) };
  assert.equal(compareContract(entry, exact).exact, true);
  for (const mutate of [
    (value) => { value.category = 'UTILITY'; },
    (value) => { value.language = 'en'; },
    (value) => { value.message_send_ttl_seconds = 600; },
    (value) => { value.components[0].add_security_recommendation = false; },
    (value) => { value.components[1].code_expiration_minutes = 10; },
    (value) => { value.components[2].buttons[0].otp_type = 'ONE_TAP'; },
    (value) => { value.components[2].buttons.push(structuredClone(value.components[2].buttons[0])); },
  ]) {
    const changed = structuredClone(exact);
    mutate(changed);
    assert.equal(compareContract(entry, changed).exact, false);
  }
});

async function authInventoryState(providers) {
  process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = 'hidden-waba';
  delete process.env.WHATSAPP_STAFF_AUTH_TEMPLATE;
  axios.get = async () => ({ data: { data: providers } });
  const report = await inspectMetaTemplateInventory();
  return report.templates.find((item) => item.key === 'staff_auth_otp');
}

test('staff authentication readiness fails closed for pending duplicate drift and wrong category, and passes exact approved', async () => {
  const entry = CONTRACTS.find((item) => item.key === 'staff_auth_otp');
  const exactProvider = { id: 'auth-1', status: 'APPROVED', ...entry.contract, components: structuredClone(entry.contract.components) };
  let state = await authInventoryState([exactProvider]);
  assert.equal(state.ready, true);

  state = await authInventoryState([{ ...exactProvider, status: 'PENDING' }]);
  assert.equal(state.ready, false);

  state = await authInventoryState([exactProvider, { ...structuredClone(exactProvider), id: 'auth-2' }]);
  assert.equal(state.provider.duplicateCount, 1);
  assert.equal(state.ready, false);

  const drift = structuredClone(exactProvider);
  drift.components[1].code_expiration_minutes = 10;
  state = await authInventoryState([drift]);
  assert.equal(state.contract.exact, false);
  assert.equal(state.ready, false);

  state = await authInventoryState([{ ...exactProvider, category: 'UTILITY' }]);
  assert.equal(state.contract.exact, false);
  assert.equal(state.ready, false);
});

test('staff authentication send gate remains disabled while production delivery flag is off', async () => {
  const entry = CONTRACTS.find((item) => item.key === 'staff_auth_otp');
  process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = 'hidden-waba';
  process.env.SHILOH_STAFF_BROWSER_AUTH_WHATSAPP_DELIVERY_ENABLED = 'false';
  axios.get = async () => ({ data: { data: [{ id: 'auth', status: 'APPROVED', ...entry.contract, components: structuredClone(entry.contract.components) }] } });
  await assert.rejects(() => assertTemplateSendAllowed(STAFF_AUTH_TEMPLATE_NAME, STAFF_AUTH_TEMPLATE_LANGUAGE), /delivery gate is disabled/);
});

test('mocked approved staff authentication dispatch uses template transport and logs no phone or OTP', async () => {
  const log = mockLog();
  const phone = '+27821234567';
  const otp = 'ABCDEFGHJK';
  let request;
  const result = await sendStaffAuthTemplate(phone, otp, {
    env: { PHONE_NUMBER_ID: 'phone-id', WHATSAPP_TOKEN: 'provider-secret' },
    log,
    assertAllowed: async (name, language) => {
      assert.equal(name, STAFF_AUTH_TEMPLATE_NAME);
      assert.equal(language, STAFF_AUTH_TEMPLATE_LANGUAGE);
      return { ready: true };
    },
    post: async (url, body, config) => {
      request = { url, body, config };
      return { data: { messages: [{ id: 'wamid.mocked-approved' }] } };
    },
  });
  assert.equal(result.messages[0].id, 'wamid.mocked-approved');
  assert.equal(request.body.type, 'template');
  assert.equal(request.body.template.name, STAFF_AUTH_TEMPLATE_NAME);
  assert.equal(request.body.template.language.code, STAFF_AUTH_TEMPLATE_LANGUAGE);
  assert.equal(request.body.template.components[0].parameters[0].text, otp);
  assert.equal(request.body.template.components[1].parameters[0].text, otp);
  assert.equal(request.body.template.components[1].sub_type, 'url');
  const logs = JSON.stringify(log.entries);
  assert.doesNotMatch(logs, /27821234567/);
  assert.doesNotMatch(logs, /ABCDEFGHJK/);
  assert.doesNotMatch(logs, /provider-secret/);
});

test('mocked provider rejection fails closed and logs only sanitized evidence', async () => {
  const log = mockLog();
  const phone = '+27821234567';
  const otp = 'ABCDEFGHJK';
  const token = 'EAAabcdefghijklmnopqrstuvwxyz1234567890';
  await assert.rejects(() => sendStaffAuthTemplate(phone, otp, {
    env: { PHONE_NUMBER_ID: 'phone-id', WHATSAPP_TOKEN: 'provider-secret' },
    log,
    assertAllowed: async () => ({ ready: true }),
    post: async () => {
      const error = new Error('raw provider error');
      error.response = { status: 400, data: { error: { code: 131026, message: `Cannot deliver to ${phone}; OTP ${otp}; Bearer ${token}` } } };
      throw error;
    },
  }), (error) => error.code === 'STAFF_AUTH_PROVIDER_REJECTED');
  const logs = JSON.stringify(log.entries);
  assert.doesNotMatch(logs, /27821234567/);
  assert.doesNotMatch(logs, /ABCDEFGHJK/);
  assert.doesNotMatch(logs, /EAAabcdefghijklmnopqrstuvwxyz1234567890/);
  assert.doesNotMatch(logs, /provider-secret/);
  assert.match(logs, /REDACTED/);
});

test('production challenge dispatcher has no generic free-form WhatsApp dependency', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/staffBrowserChallengeDelivery.js'), 'utf8');
  assert.doesNotMatch(source, /require\(['"]\.\/whatsapp['"]\)/);
  let delivered;
  const dispatcher = createStaffBrowserChallengeDispatcher({
    env: { SHILOH_STAFF_BROWSER_AUTH_WHATSAPP_DELIVERY_ENABLED: 'true' },
    sendTemplate: async (destination, code) => { delivered = { destination, code }; return { messages: [{ id: 'mocked' }] }; },
  });
  await dispatcher({ destination: '+27821234567', code: 'ABCDEFGHJK', expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
  assert.deepEqual(delivered, { destination: '+27821234567', code: 'ABCDEFGHJK' });
});

test('provider inventory inspection is sanitized and template submission is exactly one mocked request when absent', async () => {
  const otherAuth = { id: 'provider-secret-id', name: 'other_auth', language: 'en_US', category: 'AUTHENTICATION', status: 'APPROVED' };
  const inspection = await inspectStaffAuthTemplateInventory({
    discoverWabaId: async () => 'secret-waba',
    fetchTemplates: async () => [otherAuth],
  });
  assert.equal(inspection.ok, true);
  assert.equal(inspection.authenticationTemplateCount, 1);
  assert.equal(inspection.exactTemplate.exists, false);
  const serialized = JSON.stringify(inspection);
  assert.doesNotMatch(serialized, /secret-waba/);
  assert.doesNotMatch(serialized, /provider-secret-id/);
  assert.doesNotMatch(serialized, /other_auth/);

  let posts = 0;
  let submittedBody;
  const submission = await submitStaffAuthTemplateIfAbsent({
    env: { WHATSAPP_TOKEN: 'secret' },
    discoverWabaId: async () => 'secret-waba',
    fetchTemplates: async () => [otherAuth],
    post: async (url, body) => {
      posts += 1;
      submittedBody = body;
      return { data: { status: 'PENDING', category: 'AUTHENTICATION', id: 'do-not-return' } };
    },
  });
  assert.equal(posts, 1);
  assert.equal(submission.submitted, true);
  assert.equal(submission.status, 'PENDING');
  assert.equal(submission.category, 'AUTHENTICATION');
  assert.equal(submittedBody.name, STAFF_AUTH_TEMPLATE_NAME);
  assert.equal(JSON.stringify(submission).includes('do-not-return'), false);
});

test('provider provisioning never submits when the exact template identity already exists', async () => {
  const exact = { id: 'hidden-id', name: STAFF_AUTH_TEMPLATE_NAME, language: STAFF_AUTH_TEMPLATE_LANGUAGE, category: STAFF_AUTH_TEMPLATE_CATEGORY, status: 'PENDING' };
  assert.equal(summarizeExactTemplate([exact]).exists, true);
  let posts = 0;
  const result = await submitStaffAuthTemplateIfAbsent({
    env: { WHATSAPP_TOKEN: 'secret' },
    discoverWabaId: async () => 'hidden-waba',
    fetchTemplates: async () => [exact],
    post: async () => { posts += 1; throw new Error('must not be called'); },
  });
  assert.equal(posts, 0);
  assert.equal(result.submitted, false);
  assert.equal(result.reason, 'exact_identity_already_exists');
});

test('provider text sanitizer redacts phone challenge and credentials', () => {
  const sanitized = sanitizeProviderText('recipient +27821234567 otp ABCDEFGHJK Bearer EAAabcdefghijklmnopqrstuvwxyz1234567890');
  assert.doesNotMatch(sanitized, /27821234567/);
  assert.doesNotMatch(sanitized, /ABCDEFGHJK/);
  assert.doesNotMatch(sanitized, /EAAabcdefghijklmnopqrstuvwxyz1234567890/);
});
