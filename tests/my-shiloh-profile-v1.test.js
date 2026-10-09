'use strict';
// Explicitly fabricated fixtures only: no client records, screenshots, database or provider data.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  PROFILE_UPDATE_EVENT,
  MyShilohProfileError,
  profileRevision,
  dateOnly,
  maskMobile,
  publicProfile,
  normalizeProfile,
  createMyShilohProfileService,
} = require('../src/services/myShilohProfile');
const {
  ACTION_TOOL_NAMES,
  PROFILE_TOOL_DEFINITION,
  createMyShilohActionTools,
} = require('../src/services/myShilohActionTools');
const {
  isPersonalDetailsIntent,
  isMobileIdentityChangeIntent,
  myShilohProfileUrl,
} = require('../src/services/customerCare');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function row(overrides = {}) {
  return {
    id: 912,
    name: 'Synthetic Example',
    normalized_mobile: '27820000001',
    date_of_birth: '2000-01-01',
    gender: 'female',
    profile_status: 'registered',
    mobile_verified_at: '2026-09-19T18:00:00.000Z',
    status: 'active',
    provenance: {},
    updated_at: '2026-09-19T18:05:00.000Z',
    ...overrides,
  };
}

test('profile projection masks the identity mobile and exposes an opaque revision', () => {
  const profile = publicProfile(row());
  assert.equal(profile.name, 'Synthetic Example');
  assert.equal(profile.mobile, '0•• ••• 0001');
  assert.equal(profile.mobileEditable, true);
  assert.match(profile.revision, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(profile), /27820000001/);
  assert.equal(maskMobile('invalid'), 'Mobile number unavailable');
  assert.notEqual(profileRevision(row()), profileRevision(row({ gender: 'other' })));
  assert.equal(profile.registrationComplete, true);
  assert.equal(dateOnly(new Date('2000-01-01T00:00:00.000Z')), '2000-01-01');
  assert.equal(dateOnly('Sat Jan 1 2000'), null);
  assert.equal(publicProfile(row({ date_of_birth: new Date('2000-01-01T00:00:00.000Z') })).dateOfBirth, '2000-01-01');
  assert.equal(publicProfile(row({ date_of_birth: null, profile_status: 'registered' })).registrationComplete, false);
});

test('profile input reuses bounded canonical CRM validation', () => {
  assert.deepEqual(normalizeProfile({
    name: '  Synthetic   Example ',
    dateOfBirth: '2000-01-01',
    gender: 'Female',
  }), {
    name: 'Synthetic Example',
    dateOfBirth: '2000-01-01',
    gender: 'female',
  });
  assert.throws(() => normalizeProfile({ name: 'x', dateOfBirth: '2000-01-01', gender: 'female' }), MyShilohProfileError);
  assert.throws(() => normalizeProfile({ name: 'Synthetic Example', dateOfBirth: '2099-01-01', gender: 'female' }), /date of birth/i);
  assert.throws(() => normalizeProfile({ name: 'Synthetic Example', dateOfBirth: '', gender: 'female' }), /date of birth/i);
  assert.throws(() => normalizeProfile({ name: 'Synthetic Example', dateOfBirth: '2000-01-01', gender: '' }), /gender/i);
});

test('profile update is session-bound, revision-checked, transactional and value-minimised in audit', async () => {
  const original = row();
  const updated = row({ name: 'Synthetic Updated Example', updated_at: '2026-09-19T18:10:00.000Z' });
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('myShilohProfile:update-lock')) return { rows: [original], rowCount: 1 };
      if (sql.includes('SELECT id FROM client_browser_sessions')) return {rows:[{id:77}],rowCount:1};
      if (sql.startsWith('UPDATE crm_v2_clients')) return { rows: [updated], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release() { calls.push({ sql: 'RELEASE', values: [] }); },
  };
  const db = { query: client.query, async connect() { return client; } };
  const service = createMyShilohProfileService({
    db,
    now: () => new Date('2026-09-19T18:08:00.000Z'),
  });
  const result = await service.updateProfile({
    sessionId: 77,
    crmV2ClientId: 912,
    expectedRevision: profileRevision(original),
    name: 'Synthetic Updated Example',
    dateOfBirth: '2000-01-01',
    gender: 'female',
  });

  assert.equal(result.status, 'updated');
  assert.equal(result.profile.name, 'Synthetic Updated Example');
  assert.match(calls[0].sql, /BEGIN ISOLATION LEVEL READ COMMITTED/);
  const lock = calls.find(call => call.sql.includes('myShilohProfile:update-lock'));
  assert.deepEqual(lock.values.slice(0, 2), [77, 912]);
  assert.match(lock.sql, /s\.crm_v2_client_id=\$2/);
  assert.match(lock.sql, /s\.issued_at <= \$3/);
  assert.doesNotMatch(lock.sql, /10 minutes|reauthenticated_at/);
  const audit = calls.find(call => call.sql.includes('client_auth_security_events'));
  assert.equal(audit.values[0], PROFILE_UPDATE_EVENT);
  assert.deepEqual(JSON.parse(audit.values[3]), { changedFields: ['name'] });
  assert.doesNotMatch(audit.values[3], /Synthetic|2000|female|2782/);
  assert.ok(calls.some(call => call.sql === 'COMMIT'));
  assert.equal(calls.at(-1).sql, 'RELEASE');
});

test('profile API trusts only signed-in identity and requires same-origin CSRF for changes', () => {
  const route = read('src/routes/myShiloh.js');
  assert.match(route, /router\.get\('\/my-shiloh\/api\/profile', requireSession/);
  assert.match(route, /router\.post\('\/my-shiloh\/api\/profile\/update', sameOrigin, requireSession, requireCsrf/);
  assert.match(route, /new Set\(\['expectedRevision', 'name', 'dateOfBirth', 'gender', 'mobile'\]\)/);
  assert.match(route, /sessionId: req\.myShilohClientSession\.sessionId/);
  assert.match(route, /crmV2ClientId: req\.myShilohClientSession\.crmV2ClientId/);
  assert.doesNotMatch(route, /req\.(?:body|query|params).*crmV2ClientId/);
});

test('profile UI edits only approved fields and never persists private profile data in the browser', () => {
  const presentation = read('src/presentation/myShilohPwa.js');
  const app = read('public/my-shiloh/assets/app.js');
  const worker = read('public/my-shiloh/sw.js');
  assert.match(presentation, /data-client-profile-form/);
  assert.match(presentation, /Full name/);
  assert.match(presentation, /Date of birth/);
  assert.match(presentation, /name="dateOfBirth"[^>]*required/);
  assert.match(presentation, /name="gender"[^>]*required/);
  assert.match(presentation, /New mobile number/);
  // Number replacement stays inside the signed-in profile editor.
  const profileEditor = presentation.match(/<form data-client-profile-form>[\s\S]*?<\/form>/)?.[0];
  assert.ok(profileEditor);
  assert.match(profileEditor, /name="mobile"/);
  assert.doesNotMatch(presentation, /Confirm details for account changes/);
  assert.match(app, /fetch\('\/my-shiloh\/api\/profile'/);
  assert.match(app, /postJson\('\/my-shiloh\/api\/profile\/update'/);
  assert.match(app, /freshCsrfToken\(\)/);
  assert.match(app, /registrationComplete/);
  assert.match(app, /to finish registration\./);
  assert.doesNotMatch(app, /unlock your R100 voucher/);
  const styles = read('public/my-shiloh/assets/app.css');
  assert.match(styles, /\.profile-field\{[^}]*min-width:0/);
  assert.match(styles, /\.profile-field input,[^{]+\{[^}]*max-width:100%[^}]*min-width:0/);
  assert.match(styles, /input\[type="date"\][^{]*\{[^}]*-webkit-appearance:none[^}]*max-inline-size:100%[^}]*min-inline-size:0[^}]*text-align:left/);
  assert.match(styles, /input\[type="date"\]::-webkit-date-and-time-value\{[^}]*text-align:left[^}]*margin:0/);
  assert.doesNotMatch(app, /INSTALL_VERIFIED_KEY|installationVerificationRequired/);
  assert.doesNotMatch(app, /sessionStorage|indexedDB/i);
  assert.doesNotMatch(app, /localStorage\.setItem\([^\n]*(?:name|mobile|dateOfBirth|gender|profile|client|token|session|csrf)/i);
  assert.match(worker, /url\.pathname\.startsWith\('\/my-shiloh\/api\/'\)/);
});

test('Shiloh opens personal details without receiving or mutating profile values', async () => {
  assert.equal(PROFILE_TOOL_DEFINITION.name, ACTION_TOOL_NAMES.OPEN_PROFILE);
  assert.deepEqual(PROFILE_TOOL_DEFINITION.parameters.required, []);
  assert.equal(PROFILE_TOOL_DEFINITION.parameters.additionalProperties, false);
  const tools = createMyShilohActionTools({
    actionService: { async prepareCancellation() {}, async prepareReschedule() {} },
    formActionService: { async prepareFormAction() {} },
  });
  const result = await tools.execute(ACTION_TOOL_NAMES.OPEN_PROFILE, {}, { sessionId: 77, crmV2ClientId: 912 });
  assert.equal(result.clientAction.type, 'profile_details');
  assert.equal(result.clientAction.href, '#profile');
  assert.doesNotMatch(JSON.stringify(result), /Synthetic|2000|female|2782/);
});

test('WhatsApp personal-details intent routes to private My Shiloh while mobile changes require clinic verification', () => {
  assert.equal(isPersonalDetailsIntent('I want to update my personal details.'), true);
  assert.equal(isPersonalDetailsIntent('edit my profile'), true);
  assert.equal(isPersonalDetailsIntent('book a massage'), false);
  assert.equal(isMobileIdentityChangeIntent('change my WhatsApp number'), true);
  assert.equal(myShilohProfileUrl(), 'https://app.shilohmtc.co.za/my-shiloh/#profile');
});
