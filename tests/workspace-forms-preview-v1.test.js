const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const formsRouteSource = source('src/routes/workspaceForms.js');
const {
  WorkspaceFormsError,
  normalizeTemplateKey,
  createWorkspaceFormsService,
} = require('../src/services/workspaceForms');
const {
  renderFormsPage,
  renderFormPreviewPage,
} = require('../src/presentation/workspaceFormsUx');

function authorityRow() {
  return {
    id: 9,
    staff_id: null,
    display_name: 'Christel',
    permissions: { 'forms:view': true },
    business_role: 'owner',
    calendar_scope: 'all_business',
    admin_active: true,
    staff_status: null,
  };
}

test('form preview keys are exact safe identifiers and reject path-like input', () => {
  assert.equal(normalizeTemplateKey('Hot_Stone_Massage_Consultation'), 'hot_stone_massage_consultation');
  for (const value of ['', '../secret', 'hot-stone', 'a/b', '<script>']) {
    assert.throws(() => normalizeTemplateKey(value), error => error instanceof WorkspaceFormsError && error.httpStatus === 404);
  }
});

test('Forms library cards are tappable staff-preview links without leaking questionnaire wording', () => {
  const html = renderFormsPage({
    authority: { displayName: 'Christel' },
    activity: {},
    templates: [{
      templateKey: 'hot_stone_massage_consultation',
      title: 'Hot Stone Massage Consultation',
      version: 1,
      itemCount: 31,
      services: [{ id: 30, name: 'Hot Stone Massage' }],
      sections: [{ title: 'Core Massage Consultation', itemCount: 23 }],
    }],
  });
  assert.match(html, /href="\/calendar\/forms\/hot_stone_massage_consultation"/);
  assert.match(html, /Preview form/);
  assert.match(html, /Tap a form below to preview exactly what the client will see/);
  assert.doesNotMatch(html, /blood thinners|pregnant|cancer|doctor number/i);
});

test('staff preview renders the real versioned questions read-only with consent and signature placeholders', () => {
  const html = renderFormPreviewPage({
    authority: { displayName: 'Christel' },
    previewOnly: true,
    form: {
      templateKey: 'hot_stone_massage_consultation',
      title: 'Hot Stone Massage Consultation',
      version: 1,
      services: [{ id: 30, name: 'Hot Stone Massage' }],
      consentText: 'I confirm the information supplied is correct.',
      settings: { signature_required: true, signed_name_required: true, signed_date_required: true },
      sections: [{
        sectionKey: 'hot_stone_massage_screening',
        title: 'Hot Stone Massage Screening',
        version: 1,
        definition: {
          groups: [{
            title: 'Hot Stone Massage questions',
            fields: [{ key: 'doctor_number', type: 'text', label: 'Doctor number', required: false }],
            questions: [{ key: 'anticoagulants_blood_thinners', type: 'yes_no', label: 'Are you taking anticoagulants or blood thinners?', required: true }],
          }],
        },
      }],
    },
  });
  assert.match(html, /Staff preview · Version 1/);
  assert.match(html, /Doctor number/);
  assert.match(html, /anticoagulants or blood thinners/);
  assert.match(html, />Yes<\/span>/);
  assert.match(html, />No<\/span>/);
  assert.match(html, /Consent &amp; declaration|Consent & declaration/);
  assert.match(html, /Digital signature/);
  assert.match(html, /Nothing you tap here is saved or submitted/);
  assert.doesNotMatch(html, /<form\b|<input\b|<textarea\b|<button\b/i);
});

test('preview service loads only the requested active version after Forms authority succeeds', async () => {
  const calls = [];
  const db = {
    query: async (sql, values = []) => {
      calls.push({ sql, values });
      if (sql.includes('workspaceForms:principal')) return { rows: [authorityRow()] };
      if (sql.includes('workspaceForms:preview-template')) return { rows: [{
        id: 2,
        template_key: 'hot_stone_massage_consultation',
        title: 'Hot Stone Massage Consultation',
        status: 'active',
        template_version_id: 20,
        version_number: 1,
        consent_text: 'Consent text',
        settings: { signature_required: true },
      }] };
      if (sql.includes('workspaceForms:preview-sections')) return { rows: [{
        section_key: 'core_massage_consultation',
        title: 'Core Massage Consultation',
        version_number: 1,
        definition: { groups: [] },
        position: 1,
      }] };
      if (sql.includes('workspaceForms:preview-services')) return { rows: [{ id: 30, name: 'Hot Stone Massage' }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const service = createWorkspaceFormsService({ db });
  const result = await service.getFormPreview({ adminId: 9, templateKey: 'hot_stone_massage_consultation' });
  assert.equal(result.authority.formScope, 'all_business');
  assert.equal(result.form.versionId, 20);
  assert.equal(result.form.sections[0].sectionKey, 'core_massage_consultation');
  assert.equal(result.form.services[0].id, 30);
  assert.equal(result.previewOnly, true);
  const templateCall = calls.find(call => call.sql.includes('workspaceForms:preview-template'));
  assert.deepEqual(templateCall.values, ['hot_stone_massage_consultation']);
});

test('Forms browser navigation redirects expired sessions to sign-in instead of raw Unauthorized JSON', () => {
  assert.match(formsRouteSource, /humanNavigationSigninPath:\s*staffAccessPath/);
  assert.match(formsRouteSource, /staffAccessPath = '\/calendar\/staff'/);
  assert.match(formsRouteSource, /router\.get\('\/:templateKey'/);
  assert.doesNotMatch(formsRouteSource, /router\.(?:post|put|patch|delete)\(/i);
});
