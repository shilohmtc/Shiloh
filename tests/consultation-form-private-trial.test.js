const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { makeTrialFixture } = require('./fixtures/consultationFormTrialFixture');
const { trialConfig, authorizeTrial } = require('../src/services/consultationFormTrial');
const { decryptSubmissionPayload } = require('../src/services/clientConsultationForms');
const { renderTrialForm } = require('../src/presentation/consultationFormTrialUx');
const { createClientConsultationFormsRouter } = require('../src/routes/clientConsultationForms');
const { sanitizeRequestPath } = require('../src/middleware/requestContext');

function statusIs(status) { return error => error.httpStatus === status; }

test('trial access fails closed for disabled, malformed, expired, wrong and duplicate tokens', async () => {
  const f = makeTrialFixture();
  assert.throws(() => trialConfig({}), statusIs(404));
  assert.throws(() => trialConfig({ ...f.env, CONSULTATION_FORM_TRIAL_ACCESS_HASH: 'bad' }), statusIs(503));
  assert.throws(() => trialConfig({ ...f.env, CONSULTATION_FORM_TRIAL_EXPIRES_AT: '2000-01-01T00:00:00Z' }), statusIs(410));
  assert.throws(() => trialConfig({ ...f.env, CONSULTATION_FORM_TRIAL_EXPIRES_AT: new Date(Date.now() + 96 * 3600000).toISOString() }), statusIs(503));
  assert.throws(() => trialConfig({ ...f.env, CONSULTATION_FORM_DATA_KEY: '' }), statusIs(503));
  assert.throws(() => authorizeTrial([f.token, f.token], f.env, new Date()), statusIs(404));
  await assert.rejects(f.service.openTrial(Buffer.alloc(32, 99).toString('base64url')), statusIs(404));
  assert.equal(f.calls.length, 0);
});

test('opening a trial uses the actual versioned questions and fictional prefill, never CRM or appointments', async () => {
  const f = makeTrialFixture();
  const model = await f.service.openTrial(f.token);
  assert.equal(model.completed, false);
  assert.equal(model.prefill.first_name, 'Test');
  assert.equal(model.prefill.mobile, '0000000000');
  assert.deepEqual(model.form.sections, f.form.sections);
  assert.equal(f.rows.size, 1);
  assert.doesNotMatch(JSON.stringify(f.calls.map(call => call.sql)), /FROM clients|FROM appointments|INSERT INTO clients|INSERT INTO appointments|consultation_form_assignments|practitioner_notes/);
  f.form.sections = [];
  assert.equal((await f.service.openTrial(f.token)).form.sections.length, 2);
});

test('test answers and signature persist as ciphertext, round-trip and accept only one submission', async () => {
  const f = makeTrialFixture();
  const result = await f.service.submitTrial(f.token, f.validBody());
  assert.equal(result.storageVerified, true);
  const row = [...f.rows.values()][0];
  assert.ok(row.submitted_at);
  assert.equal(row.answers, undefined);
  assert.equal(row.signature_name, undefined);
  assert.doesNotMatch(row.payload_ciphertext, /Test Client|allergies/);
  assert.doesNotMatch(JSON.stringify(row.template_snapshot), /"answers"|"signature_name"/);
  const plaintext = decryptSubmissionPayload({ ciphertext: row.payload_ciphertext, iv: row.payload_iv, authTag: row.payload_auth_tag }, { env: f.env });
  assert.equal(plaintext.signature.name, 'Test Client');
  assert.equal(plaintext.trial, true);
  assert.equal(plaintext.tokenHash, f.env.CONSULTATION_FORM_TRIAL_ACCESS_HASH);
  assert.equal(plaintext.answers.allergies, 'no');
  const before = row.payload_ciphertext;
  assert.equal((await f.service.submitTrial(f.token, { anything: 'cannot overwrite' })).alreadyCompleted, true);
  assert.equal([...f.rows.values()][0].payload_ciphertext, before);
  assert.deepEqual(await f.service.openTrial(f.token), { completed: true });
});

test('blank health answers, conditional details, missing signature and injected fields cannot be saved', async () => {
  const f = makeTrialFixture();
  const valid = f.validBody();
  for (const body of [
    { ...valid, allergies: '' },
    { ...valid, allergies: 'yes', allergy_details: '' },
    { ...valid, signature_name: '' },
    { ...valid, signature_confirm: '' },
    { ...valid, consent_acknowledged: '' },
    { ...valid, practitioner_notes: 'not allowed' },
  ]) {
    await assert.rejects(f.service.submitTrial(f.token, body), statusIs(422));
    assert.equal(f.rows.size, 0);
  }
  const accepted = await f.service.submitTrial(f.token, { ...valid, allergies: 'yes', allergy_details: 'Fictional test answer' });
  assert.equal(accepted.storageVerified, true);
});

test('database failure or ciphertext tampering rolls back rather than falsely claiming success', async () => {
  for (const fault of ['failSave', 'corruptRead']) {
    const f = makeTrialFixture();
    await f.service.openTrial(f.token);
    f.fault[fault] = true;
    await assert.rejects(f.service.submitTrial(f.token, f.validBody()));
    assert.equal([...f.rows.values()][0].submitted_at, null);
    assert.equal([...f.rows.values()][0].payload_ciphertext, undefined);
  }
});

test('startup self-check writes and decrypts the real table path then rolls back without consuming the user link', async () => {
  const f = makeTrialFixture();
  assert.equal((await f.service.verifyStorage()).storageVerified, true);
  assert.equal(f.rows.size, 0);
  assert.ok(f.calls.some(call => call.sql.includes('consultationTrial:save')));
  assert.equal(f.calls.at(-1).sql, 'ROLLBACK');
  assert.ok(!JSON.stringify(f.calls).includes(f.token));
});

test('expiry and flag revocation deny the link; cleanup removes only expired trials', async () => {
  const f = makeTrialFixture();
  await f.service.openTrial(f.token);
  f.env.SHILOH_CONSULTATION_FORM_TRIAL_ENABLED = 'false';
  await assert.rejects(f.service.openTrial(f.token), statusIs(404));
  f.env.SHILOH_CONSULTATION_FORM_TRIAL_ENABLED = 'true';
  f.advance(49 * 3600000);
  await assert.rejects(f.service.openTrial(f.token), statusIs(410));
  await f.service.purgeExpired();
  assert.equal(f.rows.size, 0);
});

test('trial renderer reuses production, clearly marks testing and carries the token only as a hidden POST value', async () => {
  const f = makeTrialFixture();
  const html = renderTrialForm(await f.service.openTrial(f.token), f.token);
  assert.match(html, /TEST FORM/);
  assert.match(html, /No real health information/);
  assert.match(html, /action="\/forms\/test\/submit"/);
  assert.match(html, /name="access_token"/);
  assert.match(html, /data-follow-up-for="allergies"/);
  assert.doesNotMatch(html, new RegExp('(?:href|action)="[^"]*' + f.token));
  assert.doesNotMatch(html, /autocomplete="(?:given-name|family-name|name|tel|email|bday)"/);
  assert.doesNotMatch(html, /unique to this appointment|Your practitioner will review|real client profile/);
});

async function testServer(t, f) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/forms', createClientConsultationFormsRouter({ env: f.env, trialService: f.service, trialLog: f.log }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  f.env.CONSULTATION_FORM_TRIAL_ORIGIN = origin;
  return { origin, post: (route, body, headers = {}) => fetch(origin + route, { method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(body) }) };
}

test('private HTTP journey opens, validates, signs, saves and confirms while real forms remain off', async t => {
  const f = makeTrialFixture();
  const { origin, post } = await testServer(t, f);
  const landing = await fetch(origin + '/forms/test');
  assert.equal(landing.status, 200);
  assert.match(landing.headers.get('cache-control'), /no-store/);
  assert.equal(landing.headers.get('referrer-policy'), 'strict-origin');
  assert.equal(landing.headers.get('x-frame-options'), 'DENY');
  assert.match(landing.headers.get('x-robots-tag'), /noindex/);
  assert.doesNotMatch(await landing.text(), /anticoagulants|signature_name/);
  assert.equal((await fetch(origin + '/forms/f/' + f.token)).status, 404);
  const opened = await post('/forms/test/open', { access_token: f.token });
  assert.equal(opened.status, 200);
  assert.match(await opened.text(), /TEST FORM/);
  assert.equal((await post('/forms/test/submit', { access_token: f.token, ...f.validBody(), allergies: 'yes' })).status, 422);
  const submitted = await post('/forms/test/submit', { access_token: f.token, ...f.validBody() });
  assert.equal(submitted.status, 200);
  assert.match(await submitted.text(), /your test form is complete/);
  const reopened = await post('/forms/test/open', { access_token: f.token });
  assert.doesNotMatch(await reopened.text(), /name="signature_name"|name="allergies"/);
  assert.equal(f.rows.size, 1);
  const logText = JSON.stringify(f.logs);
  for (const secret of [f.token, f.env.CONSULTATION_FORM_DATA_KEY, 'Test Client']) assert.ok(!logText.includes(secret));
});

test('HTTP rejects foreign, null or absent origins, URL tokens, extra fields and oversized bodies', async t => {
  const f = makeTrialFixture();
  const { origin, post } = await testServer(t, f);
  assert.equal((await post('/forms/test/open', { access_token: f.token }, { origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await post('/forms/test/open', { access_token: f.token }, { origin: 'null' })).status, 403);
  assert.equal((await post('/forms/test/open', { access_token: f.token }, { origin: '' })).status, 403);
  assert.equal((await post('/forms/test/open', { access_token: f.token }, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await post('/forms/test/open', { access_token: 'invalid' })).status, 404);
  assert.equal((await post('/forms/test/open', { access_token: f.token, unknown: 'value' })).status, 400);
  assert.equal((await post('/forms/test/submit', { access_token: f.token, notes: 'x'.repeat(100000) })).status, 413);
  assert.equal((await fetch(origin + '/forms/test/open/' + f.token)).status, 404);
  assert.equal(f.rows.size, 0);
});

test('private form logs are redacted and entry script never puts tokens in URLs or browser storage', () => {
  assert.equal(sanitizeRequestPath('/forms/f/private-token'), '/forms/[private]');
  assert.equal(sanitizeRequestPath('/FORMS/F/private-token'), '/forms/[private]');
  assert.equal(sanitizeRequestPath('/forms/test/open'), '/forms/[private]');
  assert.equal(sanitizeRequestPath('/calendar/forms'), '/calendar/forms');
  const script = fs.readFileSync(path.join(__dirname, '../public/assets/forms/consultation-trial-entry.js'), 'utf8');
  assert.doesNotThrow(() => new Function(script));
  assert.match(script, /history\.replaceState/);
  assert.match(script, /form\.method = 'post'/);
  assert.doesNotMatch(script, /localStorage|sessionStorage|console\./);
});
