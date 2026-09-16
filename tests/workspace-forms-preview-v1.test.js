'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const formsRouteSource = source('src/routes/workspaceForms.js');
const formsServiceSource = source('src/services/workspaceForms.js');

const { renderFormsPage } = require('../src/presentation/workspaceFormsUx');
const { renderFormPreviewPage } = require('../src/presentation/workspaceFormsPreviewUx');
const { templateKey } = require('../src/services/workspaceForms');

test('Forms library cards are real links to protected template previews', () => {
  const html = renderFormsPage({
    authority: { displayName: 'Christel' },
    activity: {},
    templates: [{
      templateKey: 'hot_stone_massage_consultation',
      title: 'Hot Stone Massage Consultation',
      version: 1,
      itemCount: 31,
      services: [{ id: 1, name: 'Hot Stone Massage' }],
      sections: [{ title: 'Core Massage Consultation', itemCount: 23 }],
    }],
  });
  assert.match(html, /href="\/calendar\/forms\/hot_stone_massage_consultation"/);
  assert.match(html, /Open form preview/);
  assert.match(html, /aria-label="Open Hot Stone Massage Consultation preview"/);
});

test('staff preview renders the questionnaire structure without collecting answers', () => {
  const html = renderFormPreviewPage({
    authority: { displayName: 'Christel' },
    template: {
      templateKey: 'hot_stone_massage_consultation',
      title: 'Hot Stone Massage Consultation',
      version: 1,
      services: [{ id: 1, name: 'Hot Stone Massage' }],
      settings: { signature_required: true, signed_name_required: true, signed_date_required: true },
      consentText: 'I confirm the information supplied is correct.',
      sections: [{
        title: 'Hot Stone Massage Screening',
        sectionKey: 'hot_stone_massage_screening',
        version: 1,
        definition: {
          groups: [{
            title: 'Hot Stone Massage questions',
            questions: [{
              key: 'anticoagulants_blood_thinners',
              type: 'yes_no',
              label: 'Are you taking anticoagulants or blood thinners?',
              required: true,
            }],
          }],
        },
      }],
    },
  });
  assert.match(html, /Preview only/);
  assert.match(html, /Are you taking anticoagulants or blood thinners\?/);
  assert.match(html, />Yes</);
  assert.match(html, />No</);
  assert.match(html, /Consent &amp; signature|Consent & signature/);
  assert.match(html, /Signed name/);
  assert.doesNotMatch(html, /<form\b|<input\b|<textarea\b|method="post"/i);
});

test('preview route remains staff-session protected and read-only', () => {
  assert.match(formsRouteSource, /requireStaffSession/);
  assert.match(formsRouteSource, /router\.get\('\/:templateKey'/);
  assert.match(formsRouteSource, /service\.getFormPreview/);
  assert.match(formsServiceSource, /requireAccess\(adminId\)/);
  assert.doesNotMatch(formsRouteSource, /router\.(?:post|put|patch|delete)\(/i);
});

test('template preview keys fail closed', () => {
  assert.equal(templateKey('hot_stone_massage_consultation'), 'hot_stone_massage_consultation');
  for (const unsafe of ['', '../admin', 'Hot Stone', 'x/y', 'a?b']) {
    assert.throws(() => templateKey(unsafe), error => error.code === 'WORKSPACE_FORM_NOT_FOUND' && error.httpStatus === 404);
  }
});
