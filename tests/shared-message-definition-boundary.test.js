const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('shared message definitions and payment values load without provider or database modules', () => {
  const result = execFileSync(process.execPath, ['-e', `
    const Module = require('node:module');
    const load = Module._load;
    Module._load = function(request, ...args) {
      if (/TemplateProvisioning|paymentWhatsAppNotifications|axios|db\\/pool/.test(request)) {
        throw new Error('Provider dependency reached: ' + request);
      }
      return load.call(this, request, ...args);
    };
    const contracts = require('./src/services/shilohMessageContracts').getShilohMessageContracts();
    const values = require('./src/services/paymentValues');
    if (contracts.length !== 35 || values.securePaymentUrl('synthetic_request_123') !== 'https://app.shilohmtc.co.za/pay/synthetic_request_123') {
      throw new Error('Shared authorities unavailable');
    }
    process.stdout.write('ready');
  `], { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 10000 });
  assert.equal(result, 'ready');
});

test('retired payment transport and unused provider submissions cannot be invoked', () => {
  for (const file of [
    'paymentWhatsAppNotifications',
    'profileExtractor',
    'scopeGuard',
    'englishLanguageGuard',
    'identityOnboardingGuard',
    'adminAuthorityRetirement',
    'adminInteractiveMenu',
    'clientHumanHandoffs',
    'clientBookingDateChoices',
    'clientBookingIdentityGate',
    'bookingConfirmationTemplateProvisioning',
    'bookingConfirmationV2TemplateProvisioning',
    'staffFinalizationTemplateProvisioning',
    'reminderActionTemplateProvisioning',
    'consultationFormTemplateProvisioning',
  ]) {
    assert.throws(() => require.resolve('../src/services/' + file), { code: 'MODULE_NOT_FOUND' });
  }
  const removed = {
    clientLifecycleTemplateProvisioning: ['submitClientLifecycleTemplate'],
  };
  for (const [file, functions] of Object.entries(removed)) {
    const service = require('../src/services/' + file);
    for (const name of functions) assert.equal(service[name], undefined, name);
  }
});
