const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'migrations/132_secure_client_consultation_forms.sql'), 'utf8');
const serviceSource = fs.readFileSync(path.join(root, 'src/services/clientConsultationForms.js'), 'utf8');
const routeSource = fs.readFileSync(path.join(root, 'src/routes/clientConsultationForms.js'), 'utf8');
const presentationSource = fs.readFileSync(path.join(root, 'src/presentation/clientConsultationFormUx.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const clientScript = fs.readFileSync(path.join(root, 'public/assets/forms/client-consultation.js'), 'utf8');

const forms = require('../src/services/clientConsultationForms');
const routes = require('../src/routes/clientConsultationForms');
const presentation = require('../src/presentation/clientConsultationFormUx');

function fixtureForm() {
  return {
    templateKey: 'hot_stone_massage_consultation',
    title: 'Hot Stone Massage Consultation',
    version: 1,
    consentText: 'I confirm that the information I have provided is correct.',
    settings: { signature_required: true, signed_name_required: true, signed_date_required: true },
    sections: [{
      sectionKey: 'core_massage_consultation',
      title: 'Core Massage Consultation',
      version: 1,
      definition: {
        groups: [{
          key: 'details',
          title: 'Your details',
          fields: [
            { key: 'first_name', type: 'prefill_text', label: 'First name', required: true },
            { key: 'surname', type: 'prefill_text', label: 'Surname', required: true },
            { key: 'email', type: 'prefill_text', label: 'Email address', required: false },
          ],
          questions: [{
            key: 'allergies',
            type: 'yes_no',
            label: 'Do you have any allergies?',
            required: true,
            follow_up: { key: 'allergy_details', type: 'text', label: 'Please list your allergies.' },
          }],
        }],
      },
    }],
  };
}

test('secure submission migration keeps health answers encrypted and form wording snapshotted', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS consultation_form_submissions/);
  assert.match(migration, /payload_ciphertext TEXT NOT NULL/);
  assert.match(migration, /payload_iv TEXT NOT NULL/);
  assert.match(migration, /payload_auth_tag TEXT NOT NULL/);
  assert.match(migration, /template_snapshot JSONB NOT NULL/);
  assert.match(migration, /consent_text_snapshot TEXT NOT NULL/);
  assert.match(migration, /signature_method TEXT NOT NULL DEFAULT 'typed_name'/);
  assert.match(migration, /uq_consultation_form_assignments_access_token_hash/);
  assert.doesNotMatch(migration, /\banswers\s+JSONB\b/i);
  assert.doesNotMatch(migration, /\bsignature_name\s+TEXT\b/i);
});

test('access links are high-entropy shaped and only their SHA-256 hash is persisted', () => {
  const token = Buffer.alloc(32, 7).toString('base64url');
  assert.equal(token.length, 43);
  assert.equal(forms.normalizeAccessToken(token), token);
  assert.match(forms.hashAccessToken(token), /^[0-9a-f]{64}$/);
  assert.throws(() => forms.normalizeAccessToken('short-token'), /not available/i);
  assert.match(serviceSource, /access_token_hash=\$2/);
  assert.doesNotMatch(migration, /\baccess_token\s+TEXT\b/);
});

test('health answers and typed signature round-trip through AES-256-GCM without plaintext persistence', () => {
  const env = {
    CONSULTATION_FORM_DATA_KEY: Buffer.alloc(32, 9).toString('base64url'),
  };
  const payload = {
    schemaVersion: 1,
    answers: { allergies: 'yes', allergy_details: 'Lavender' },
    signature: { method: 'typed_name', name: 'Naledi Mokoena', confirmed: true },
  };
  const encrypted = forms.encryptSubmissionPayload(payload, {
    env,
    randomBytes: size => Buffer.alloc(size, 4),
  });
  assert.equal(encrypted.iv.length, 16);
  assert.equal(encrypted.authTag.length, 22);
  assert.doesNotMatch(encrypted.ciphertext, /Lavender|Naledi|allergies/i);
  assert.deepEqual(forms.decryptSubmissionPayload(encrypted, { env }), payload);
});

test('client form feature is dark by default and requires an exact explicit flag', () => {
  assert.equal(forms.isClientConsultationFormsEnabled({}), false);
  assert.equal(forms.isClientConsultationFormsEnabled({ SHILOH_CLIENT_CONSULTATION_FORMS_ENABLED: 'false' }), false);
  assert.equal(forms.isClientConsultationFormsEnabled({ SHILOH_CLIENT_CONSULTATION_FORMS_ENABLED: 'TRUE' }), true);
  assert.throws(() => forms.parseDataKey({}), /temporarily unavailable/i);
});

test('submission validation requires deliberate health answers, conditional details, consent and signature', () => {
  const form = fixtureForm();
  assert.throws(() => forms.validateSubmissionBody(form, {
    first_name: 'Naledi',
    surname: 'Mokoena',
    allergies: 'yes',
    allergy_details: '',
    consent_acknowledged: 'yes',
    signature_name: 'Naledi Mokoena',
    signature_confirm: 'yes',
  }), error => {
    assert.equal(error.httpStatus, 422);
    assert.equal(error.fieldErrors.allergy_details, 'Please add the requested details.');
    return true;
  });

  const valid = forms.validateSubmissionBody(form, {
    first_name: 'Naledi',
    surname: 'Mokoena',
    email: 'naledi@example.com',
    allergies: 'yes',
    allergy_details: 'Lavender',
    consent_acknowledged: 'yes',
    signature_name: 'Naledi Mokoena',
    signature_confirm: 'yes',
  });
  assert.equal(valid.answers.allergies, 'yes');
  assert.equal(valid.answers.allergy_details, 'Lavender');
  assert.equal(valid.signatureName, 'Naledi Mokoena');
  assert.equal(valid.consentAcknowledged, true);
});

test('unexpected client payload fields fail closed rather than being silently persisted', () => {
  const form = fixtureForm();
  assert.throws(() => forms.validateSubmissionBody(form, {
    first_name: 'Naledi',
    surname: 'Mokoena',
    allergies: 'no',
    consent_acknowledged: 'yes',
    signature_name: 'Naledi Mokoena',
    signature_confirm: 'yes',
    practitioner_notes: 'client should never write this',
  }), /reload the form/i);
});

test('client presentation is mobile-first, noindex, escaped and uses a typed electronic signature', () => {
  const html = presentation.renderClientConsultationFormPage({
    accessToken: Buffer.alloc(32, 3).toString('base64url'),
    form: fixtureForm(),
    prefill: { first_name: '<Naledi>', surname: 'Mokoena', email: 'naledi@example.com' },
    appointment: {
      startsAt: '2026-09-24T12:30:00.000Z',
      services: ['Hot Stone Massage'],
      practitioners: ['Christel'],
    },
  });
  assert.match(html, /Secure consultation form/);
  assert.match(html, /noindex,nofollow,noarchive/);
  assert.match(html, /Sign &amp; submit securely|Sign & submit securely/);
  assert.match(html, /electronic signature/i);
  assert.match(html, /&lt;Naledi&gt;/);
  assert.match(html, /Hot Stone Massage/);
  assert.match(html, /data-follow-up-for="allergies"/);
  assert.doesNotMatch(html, /practitioner_notes/);
});

test('public client route is bearer-link only, no-store, same-origin on submit and sends no WhatsApp', () => {
  assert.match(routeSource, /router\.get\('\/f\/:accessToken'/);
  assert.match(routeSource, /router\.post\('\/f\/:accessToken'/);
  assert.match(routeSource, /Cache-Control', 'private, no-store/);
  assert.match(routeSource, /Referrer-Policy', 'no-referrer/);
  assert.match(routeSource, /X-Robots-Tag', 'noindex, nofollow,noarchive|X-Robots-Tag', 'noindex, nofollow, noarchive/);
  assert.match(routeSource, /sameOriginSubmission/);
  assert.doesNotMatch(routeSource, /requireStaffSession/);
  assert.doesNotMatch(`${routeSource}\n${serviceSource}`, /sendWhatsAppMessage|sendTemplateMessage|WHATSAPP_TOKEN/);
  assert.match(appSource, /app\.use\("\/forms", createClientConsultationFormsRouter\(\)\)/);
});

test('same-origin submission guard rejects a foreign origin and accepts same host', () => {
  const makeReq = origin => ({ get(name) { if (name === 'origin') return origin; if (name === 'host') return 'app.shilohmtc.co.za'; return ''; } });
  assert.equal(routes.sameOriginSubmission(makeReq('https://app.shilohmtc.co.za')), true);
  assert.equal(routes.sameOriginSubmission(makeReq('https://example.com')), false);
  assert.equal(routes.sameOriginSubmission(makeReq('')), true);
});

test('progressive enhancement contains no browser storage or logging of sensitive answers', () => {
  assert.doesNotThrow(() => new Function(clientScript));
  assert.doesNotMatch(clientScript, /localStorage|sessionStorage|console\./);
  assert.match(clientScript, /data-follow-up-for/);
  assert.match(clientScript, /Submitting securely/);
  assert.doesNotMatch(presentationSource, /localStorage|sessionStorage/);
});
