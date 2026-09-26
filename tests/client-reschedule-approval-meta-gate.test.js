const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');

const root = path.join(__dirname, '..');
const approvalService = fs.readFileSync(path.join(root, 'src', 'services', 'clientRescheduleApproval.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'src', 'bootstrap', 'clientRescheduleApprovalTemplateProvisioningBootstrap.js'), 'utf8');
const pkg = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
const { CONTRACTS, resetTemplateInventoryCache } = require('../src/services/metaTemplateContracts');
const { buildDefinition } = require('../src/services/clientLifecycleTemplateProvisioning');
const { submitOneIfAbsent, inspectRescheduleApprovalTemplates, TARGET_KEYS } = require('../src/services/clientRescheduleApprovalTemplateProvisioning');

const originalGet = axios.get;
const originalPost = axios.post;
const originalEnv = { ...process.env };

test.afterEach(() => {
  axios.get = originalGet;
  axios.post = originalPost;
  process.env = { ...originalEnv };
  resetTemplateInventoryCache();
});

function providerFor(key, status = 'APPROVED') {
  const entry = CONTRACTS.find((candidate) => candidate.key === key);
  return { id: `${key}-provider`, status, ...entry.contract, components: structuredClone(entry.contract.components) };
}

function configureTargets() {
  process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = 'hidden-waba';
  process.env.WHATSAPP_RESCHEDULE_APPROVAL_REQUEST_TEMPLATE = 'shiloh_reschedule_approval_request_v1';
  process.env.WHATSAPP_RESCHEDULE_DECLINED_TEMPLATE = 'shiloh_reschedule_declined_v1';
}

test('legacy provider definitions remain frozen while new requests use Reception', () => {
  const requestDefinition = buildDefinition('reschedule_approval_request');
  const declinedDefinition = buildDefinition('reschedule_declined');
  assert.deepEqual(TARGET_KEYS, ['reschedule_approval_request', 'reschedule_declined']);
  assert.match(approvalService, /'pending','reception'/);
  assert.doesNotMatch(approvalService, /sendApprovalRequest\(/);
  assert.match(approvalService, /context\.decision_owner !== 'practitioner'/);
  assert.match(approvalService, /context\.client_name,[\s\S]*context\.service_name,[\s\S]*fmtDateTime\(context\.proposed_starts_at\),[\s\S]*fmtDateTime\(context\.original_starts_at\),[\s\S]*String\(context\.appointment_id\)/);
  assert.match(approvalService, /\['client_reschedule_booking'\]/);
  assert.deepEqual(requestDefinition.components[1].buttons.map((button) => button.text), ['Approve', 'Decline']);
  assert.deepEqual(declinedDefinition.components[1].buttons.map((button) => button.text), ['Choose another time']);
});

test('targeted provider provisioning remains explicit and is detached from ordinary startup', () => {
  assert.match(bootstrap, /META_RESCHEDULE_APPROVAL_TEMPLATES_PROVISION_ON_START/);
  assert.match(bootstrap, /toLowerCase\(\) === 'true'/);
  assert.doesNotMatch(pkg, /clientRescheduleApprovalTemplateProvisioningBootstrap\.js/);
  assert.doesNotMatch(bootstrap, /WHATSAPP_RESCHEDULE_APPROVAL_ENABLED\s*=/);
});

test('exact existing provider templates are read back and never resubmitted', async () => {
  configureTargets();
  const providers = [providerFor('reschedule_approval_request'), providerFor('reschedule_declined')];
  let posts = 0;
  axios.get = async () => ({ data: { data: providers } });
  axios.post = async () => { posts += 1; throw new Error('should not post'); };
  const request = await submitOneIfAbsent('reschedule_approval_request');
  const declined = await submitOneIfAbsent('reschedule_declined');
  assert.equal(posts, 0);
  assert.equal(request.reason, 'already_exists_exact');
  assert.equal(declined.reason, 'already_exists_exact');
  assert.equal(request.template.contract.exact, true);
  assert.equal(declined.template.provider.duplicateCount, 0);
});

test('drift and duplicate variants fail closed without provider submission', async () => {
  configureTargets();
  const request = providerFor('reschedule_approval_request');
  const requestDuplicate = { ...providerFor('reschedule_approval_request'), id: 'duplicate' };
  const declined = providerFor('reschedule_declined');
  declined.components[0].text = declined.components[0].text.replace('not approved', 'declined');
  let posts = 0;
  axios.get = async () => ({ data: { data: [request, requestDuplicate, declined] } });
  axios.post = async () => { posts += 1; return { data: {} }; };
  const duplicateResult = await submitOneIfAbsent('reschedule_approval_request');
  const driftResult = await submitOneIfAbsent('reschedule_declined');
  assert.equal(posts, 0);
  assert.equal(duplicateResult.reason, 'duplicate_variants_present');
  assert.equal(driftResult.reason, 'existing_contract_mismatch');
  assert.equal(driftResult.template.contract.exact, false);
});

test('absent template posts once then performs immediate sanitized read-only provider readback', async () => {
  configureTargets();
  const approved = providerFor('reschedule_approval_request', 'PENDING');
  let gets = 0;
  let posts = 0;
  let postedBody = null;
  axios.get = async () => {
    gets += 1;
    return { data: { data: gets === 1 ? [] : [approved] } };
  };
  axios.post = async (_url, body) => { posts += 1; postedBody = body; return { data: { id: 'not-exposed', status: 'PENDING' } }; };
  const result = await submitOneIfAbsent('reschedule_approval_request');
  assert.equal(posts, 1);
  assert.equal(gets, 2);
  assert.deepEqual(postedBody, buildDefinition('reschedule_approval_request'));
  assert.equal(result.submitted, true);
  assert.equal(result.reason, 'submitted');
  assert.equal(result.template.provider.status, 'PENDING');
  assert.equal(result.template.provider.category, 'UTILITY');
  assert.equal(result.template.provider.language, 'en');
  assert.equal(result.template.provider.duplicateCount, 0);
  assert.equal(result.template.contract.exact, true);
  assert.equal(JSON.stringify(result).includes('not-exposed'), false);
});

test('read-only target inventory reports configuration independently of provider approval', async () => {
  configureTargets();
  const providers = [providerFor('reschedule_approval_request', 'PENDING'), providerFor('reschedule_declined', 'APPROVED')];
  axios.get = async () => ({ data: { data: providers } });
  const report = await inspectRescheduleApprovalTemplates();
  assert.equal(report.ok, true);
  assert.equal(report.templates.length, 2);
  assert.equal(report.templates[0].configured, true);
  assert.equal(report.templates[0].ready, false);
  assert.equal(report.templates[1].ready, true);
});
