const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const serviceSource = fs.readFileSync(path.join(root, 'src/services/workspaceFormSubmissions.js'), 'utf8');
const routeSource = fs.readFileSync(path.join(root, 'src/routes/workspaceForms.js'), 'utf8');
const presentationSource = fs.readFileSync(path.join(root, 'src/presentation/workspaceFormsUx.js'), 'utf8');

const submissions = require('../src/services/workspaceFormSubmissions');
const ux = require('../src/presentation/workspaceFormsUx');

function authority(overrides = {}) {
  return {
    businessRole: 'owner',
    formScope: 'all_business',
    linkedStaffId: 40,
    ...overrides,
  };
}

function formSnapshot() {
  return {
    title: 'Hot Stone Massage Consultation',
    version: 1,
    consentText: 'I confirm that the information I provided is correct.',
    sections: [{
      sectionKey: 'core_massage_consultation',
      title: 'Core Massage Consultation',
      version: 1,
      definition: {
        groups: [{
          title: 'Health & safety',
          questions: [{
            key: 'allergies',
            type: 'yes_no',
            label: 'Do you have any allergies?',
            required: true,
            follow_up: { key: 'allergy_details', label: 'Please list your allergies.' },
          }],
        }],
      },
    }],
  };
}

test('sensitive answer access excludes reception-style booking operators but allows owners, admins and own-scope practitioners', () => {
  assert.equal(submissions.canReadSensitiveSubmission(authority()), true);
  assert.equal(submissions.canReadSensitiveSubmission(authority({ businessRole: 'business_admin' })), true);
  assert.equal(submissions.canReadSensitiveSubmission(authority({ businessRole: 'booking_operator' })), false);
  assert.equal(submissions.canReadSensitiveSubmission(authority({ businessRole: 'practitioner', formScope: 'own_staff' })), true);
  assert.equal(submissions.canReadTrialSubmission(authority({ businessRole: 'booking_operator' })), false);
});

test('trial references never expose the configured bearer token hash', () => {
  const tokenHash = 'a'.repeat(64);
  const reference = submissions.trialReference(tokenHash);
  assert.match(reference, /^[0-9a-f]{24}$/);
  assert.notEqual(reference, tokenHash.slice(0, 24));
  assert.equal(submissions.normalizeTrialReference(reference), reference);
  assert.throws(() => submissions.normalizeTrialReference(tokenHash), /not found/i);
});

test('Forms landing page visibly includes recent submissions and protects restricted answers', () => {
  const html = ux.renderFormsPage({
    authority: { displayName: 'Christel' },
    activity: { completed: 1 },
    templates: [],
    submissions: {
      items: [{
        kind: 'client', reference: '7', clientName: 'Example Client',
        formTitle: 'Hot Stone Massage Consultation', status: 'completed',
        services: ['Hot Stone Massage'], submittedAt: '2026-09-16T18:44:10Z', canOpen: false,
      }],
    },
  });
  assert.match(html, /Recent submissions/);
  assert.match(html, /Example Client/);
  assert.match(html, /Hot Stone Massage/);
  assert.match(html, /Private answers restricted/);
  assert.doesNotMatch(html, /allergy_details|payload_ciphertext/);
});

test('authorised submission page renders signed answers safely and labels test records', () => {
  const html = ux.renderSubmissionPage({
    authority: { displayName: 'Christel' },
    isTest: true,
    clientName: 'Test Client',
    form: formSnapshot(),
    answers: { allergies: 'yes', allergy_details: '<fictional answer>' },
    signature: { method: 'typed_name', name: 'Test Client' },
    signedAt: '2026-09-16T18:44:10Z',
    status: 'completed',
  });
  assert.match(html, /TEST SUBMISSION/);
  assert.match(html, /Do you have any allergies\?/);
  assert.match(html, /Yes/);
  assert.match(html, /&lt;fictional answer&gt;/);
  assert.match(html, /Electronic signature/);
  assert.match(html, /Test Client/);
  assert.doesNotMatch(html, /payload_ciphertext|token_hash/);
});

test('Workspace submission routes remain behind staff browser session and no-store security headers', () => {
  assert.match(routeSource, /requireStaffSession/);
  assert.match(routeSource, /Cache-Control', 'private, no-store/);
  assert.match(routeSource, /router\.get\('\/submissions\/:kind\/:reference'/);
  assert.match(routeSource, /submissionService\.getSubmission/);
  assert.match(routeSource, /renderSubmission/);
});

test('submission service decrypts only detail views and never returns ciphertext in list models', () => {
  assert.match(serviceSource, /decryptSubmissionPayload/);
  assert.match(serviceSource, /canReadSensitiveSubmission/);
  assert.match(serviceSource, /WORKSPACE_FORM_SUBMISSION_FORBIDDEN/);
  assert.match(serviceSource, /workspaceFormSubmissions:list-real/);
  assert.doesNotMatch(serviceSource.match(/async function listRealSubmissions[\s\S]*?async function listTrialSubmissions/)?.[0] || '', /payload_ciphertext/);
  assert.match(serviceSource, /workspaceFormSubmissions:real-detail/);
  assert.match(serviceSource, /payload_ciphertext/);
});

test('presentation keeps signed form detail read-only and never adds mutation controls', () => {
  assert.match(presentationSource, /Read-only signed record/);
  assert.doesNotMatch(presentationSource, /Mark reviewed|Save answers|Edit submission|Delete submission/);
});
