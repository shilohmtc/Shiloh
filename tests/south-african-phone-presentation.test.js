'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { localPhoneInput, displayPhone, canonicalPhoneInput, phonePresentationClientScript } = require('../src/presentation/southAfricanPhone');
const { normalizeMobile, normalizeMobileSearch, createCrmV2ClientService } = require('../src/services/crmV2ClientService');
const { formatMobile } = require('../src/presentation/workspaceClientsUx');
const { formatClientMobile } = require('../src/presentation/calendarReadOnlyUx');
const { injectClientDetailManagement } = require('../src/presentation/workspaceClientsManageUx');

test('SA display/input round trips preserve canonical CRM identity in every supported format', () => {
  for (const number of ['0821234567', '082 123 4567', '27821234567', '+27 82 123 4567', '0027 82 123 4567']) {
    assert.equal(localPhoneInput(number), '0821234567');
    assert.equal(displayPhone(number), '082 123 4567');
    assert.equal(formatMobile(number), '082 123 4567');
    assert.equal(formatClientMobile(number), '082 123 4567');
    assert.equal(canonicalPhoneInput(number), '27821234567');
    assert.equal(normalizeMobile(localPhoneInput(number)), normalizeMobile(number));
    assert.equal(normalizeMobileSearch(number), '27821234567');
  }
  assert.equal(displayPhone('+27 21 123 4567'), '021 123 4567');
});

test('foreign, invalid, mixed and incomplete entries remain intact, never guessed or silently repaired', () => {
  for (const number of ['+44 20 7946 0958', '442079460958', '+1 (202) 555-0100', '08212', '+27 82 123 456', '08212345678', 'abc0821234567', '+27+821234567', '0821234567 ext 2', '270821234567']) {
    assert.equal(localPhoneInput(number), number);
    assert.equal(canonicalPhoneInput(number), number);
    assert.equal(displayPhone(number), /^\+?[\d\s()-]+$/.test(number) ? number : 'Contact unavailable');
  }
  for (const number of ['08212', '08212345678', '+44 20 7946 0958', '270821234567']) assert.equal(normalizeMobile(number), null);
  assert.equal(localPhoneInput(null), '');
  assert.equal(displayPhone(null), 'Contact unavailable');
});

test('generated browser helper matches the server and keeps payment provider input canonical', () => {
  const context = {}; vm.createContext(context); vm.runInContext(phonePresentationClientScript(), context);
  for (const number of ['0821234567', '+27821234567', '+44 20 7946 0958', 'bad']) {
    assert.equal(context.localPhoneInput(number), localPhoneInput(number));
    assert.equal(context.displayPhone(number), displayPhone(number));
    assert.equal(context.canonicalPhoneInput(number), canonicalPhoneInput(number));
  }
});

test('CRM resolves all equivalent forms to one existing client without creation', async () => {
  const keys = [];
  const repository = { findActiveByNormalizedMobile: async key => { keys.push(key); return [{ id: 91, name: 'Synthetic Phone Client', normalized_mobile: '27821234567' }]; } };
  const service = createCrmV2ClientService({ repository });
  for (const mobile of ['0821234567', '27821234567', '+27821234567']) {
    const result = await service.resolveExactMobile(mobile);
    assert.equal(result.status, 'found'); assert.equal(result.client.id, '91');
    assert.equal(result.client.normalizedMobile, '27821234567');
  }
  assert.deepEqual(keys, ['27821234567', '27821234567', '27821234567']);
});

test('CRM edit prefills local SA while preserving a foreign stored value safely', () => {
  for (const [stored, shown] of [['27821234567', '0821234567'], ['+44 20 7946 0958', '+44 20 7946 0958']]) {
    const client = { id:91, name:'Synthetic Phone Client', status:'active', normalized_mobile:stored };
    const html = injectClientDetailManagement('<section class="history-panel">', { manageAllowed:true, client });
    assert.ok(html.includes(`value="${shown}"`)); assert.equal(client.normalized_mobile, stored);
  }
});

test('consultation prefills show local tel input and Reception links stay international', () => {
  const { renderClientConsultationFormPage } = require('../src/presentation/clientConsultationFormUx');
  const { renderMyShilohPage } = require('../src/presentation/myShilohPwa');
  const model={form:{sections:[{sectionKey:'contact',title:'Contact',definition:{groups:[{title:'Your details',fields:[{key:'mobile',type:'text',label:'Mobile'}]}]}}]},prefill:{mobile:'27821234567'}};
  const form=renderClientConsultationFormPage(model);
  assert.match(form, /type="tel" name="mobile" id="mobile" value="0821234567"/);
  assert.equal(model.prefill.mobile,'27821234567');
  const html=renderMyShilohPage({humanWhatsAppNumber:'0821234567'});
  assert.match(html, /href="tel:\+27821234567"/);
  assert.match(html, /href="https:\/\/wa.me\/27821234567\?/);
});
