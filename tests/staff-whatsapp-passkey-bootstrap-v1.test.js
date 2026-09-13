'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  bootstrapPolicy,
  evaluateBootstrapPrincipal,
  setupUrl,
  createStaffWhatsAppPasskeyBootstrapService,
  REPLACEMENT_PURPOSE,
} = require('../src/services/staffWhatsAppPasskeyBootstrap');
const { b64url } = require('../src/services/staffPasskeyAuth');
const {
  isGreetingOnly,
  createStaffWhatsAppPasskeyBootstrapMiddleware,
} = require('../src/middleware/staffWhatsAppPasskeyBootstrap');
const {
  withWhatsAppBootstrapGuidance,
  withFallbackDisclosure,
  bootstrapAwareSigninScript,
} = require('../src/routes/staffCalendarAccessUx');

const ENV = {
  NODE_ENV: 'test',
  SHILOH_STAFF_WHATSAPP_PASSKEY_BOOTSTRAP_ENABLED: 'true',
  SHILOH_STAFF_PASSKEY_AUTH_ENABLED: 'true',
  SHILOH_CALENDAR_PUBLIC_ORIGIN: 'https://shiloh.example',
  SHILOH_STAFF_WEBAUTHN_RP_ID: 'shiloh.example',
};

function principal(overrides = {}) {
  return {
    id: 44,
    staff_id: null,
    display_name: 'Christel',
    role: 'owner',
    business_role: 'owner',
    calendar_scope: 'all_business',
    service_scope: 'all_services',
    permissions: { 'appointment:view': true },
    admin_active: true,
    staff_status: null,
    replacement_required_at: null,
    ...overrides,
  };
}

class BootstrapDb {
  constructor(rows = [principal()]) {
    this.identityRows = rows;
    this.bootstraps = [];
    this.challenges = [];
    this.auditEvents = [];
    this.credentials = [{ id: 70, admin_id: 44, credential_id: Buffer.alloc(32, 7).toString('base64url'), revoked_at: null }];
    this.sessions = [{ id: 80, admin_id: 44, revoked_at: null }];
  }
  async connect() { return this; }
  release() {}
  async query(sql, params = []) {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text)) return { rows: [], rowCount: 0 };
    if (text.includes('FROM staff_admin_accounts a') && text.includes('a.normalized_whatsapp = $1')) return { rows: [...this.identityRows] };
    if (text.includes('FROM staff_admin_accounts a') && text.includes('a.id = $1')) {
      return { rows: this.identityRows.filter(row => Number(row.id) === Number(params[0])) };
    }
    if (text.includes('pg_advisory_xact_lock')) return { rows: [{ pg_advisory_xact_lock: null }] };
    if (text.includes('COUNT(*)::int AS count FROM staff_auth_passkey_bootstraps')) {
      return { rows: [{ count: this.bootstraps.filter(row => Number(row.admin_id) === Number(params[0])).length }] };
    }
    if (text.startsWith('UPDATE staff_auth_passkey_bootstraps SET revoked_at')) {
      for (const row of this.bootstraps) if (Number(row.admin_id) === Number(params[0]) && !row.consumed_at && !row.revoked_at) row.revoked_at = params[1];
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith('INSERT INTO staff_auth_passkey_bootstraps')) {
      this.bootstraps.push({ id: this.bootstraps.length + 1, admin_id: params[0], token_hash: params[1], issued_at: params[2], expires_at: params[3], source: params[4], consumed_at: null, revoked_at: null });
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('FROM staff_auth_passkey_bootstraps') && text.includes('token_hash = $1')) {
      const row = this.bootstraps.find(item => item.token_hash === params[0]);
      return { rows: row ? [{ ...row }] : [] };
    }
    if (text.startsWith('UPDATE staff_auth_passkey_bootstraps SET consumed_at')) {
      const row = this.bootstraps.find(item => Number(item.id) === Number(params[0]));
      if (row) row.consumed_at = params[1];
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (text.startsWith('UPDATE staff_auth_webauthn_challenges SET consumed_at') && text.includes('WHERE admin_id = $1')) {
      for (const row of this.challenges) if (Number(row.admin_id) === Number(params[0]) && !row.consumed_at) row.consumed_at = params[1];
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('SELECT credential_id FROM staff_auth_passkey_credentials')) return { rows: this.credentials.filter(row => !row.revoked_at) };
    if (text.startsWith('INSERT INTO staff_auth_webauthn_challenges')) {
      this.challenges.push({ id: this.challenges.length + 1, challenge_hash: params[0], purpose: params[1], admin_id: params[2], request_fingerprint_hash: params[3], expires_at: params[4], consumed_at: null });
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('FROM staff_auth_webauthn_challenges') && text.includes('challenge_hash = $1')) {
      const row = this.challenges.find(item => item.challenge_hash === params[0] && !item.consumed_at);
      return { rows: row ? [{ ...row }] : [] };
    }
    if (text.startsWith('UPDATE staff_auth_webauthn_challenges SET consumed_at') && text.includes('WHERE id = $1')) {
      const row = this.challenges.find(item => Number(item.id) === Number(params[0]));
      if (row) row.consumed_at = params[1];
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (text.includes('SELECT id FROM staff_auth_passkey_credentials WHERE credential_id')) {
      return { rows: this.credentials.filter(row => row.credential_id === params[0]).map(row => ({ id: row.id })) };
    }
    if (text.startsWith('INSERT INTO staff_auth_passkey_credentials')) {
      const id = Math.max(0, ...this.credentials.map(row => row.id)) + 1;
      this.credentials.push({ id, admin_id: params[0], credential_id: params[1], revoked_at: null });
      return { rows: [{ id }], rowCount: 1 };
    }
    if (text.startsWith('UPDATE staff_auth_passkey_credentials')) {
      let count = 0;
      for (const row of this.credentials) if (Number(row.admin_id) === Number(params[0]) && Number(row.id) !== Number(params[1]) && !row.revoked_at) { row.revoked_at = params[2]; count += 1; }
      return { rows: [], rowCount: count };
    }
    if (text.includes('SELECT id FROM staff_browser_sessions')) {
      const rows = this.sessions.filter(row => Number(row.admin_id) === Number(params[0]) && !row.revoked_at).sort((a, b) => b.id - a.id);
      return { rows: rows.slice(0, 1).map(row => ({ id: row.id })) };
    }
    if (text.startsWith('UPDATE staff_browser_sessions')) {
      let count = 0;
      for (const row of this.sessions) if (Number(row.admin_id) === Number(params[0]) && !row.revoked_at) { row.revoked_at = params[1]; count += 1; }
      return { rows: [], rowCount: count };
    }
    if (text.startsWith('INSERT INTO staff_browser_sessions')) {
      const id = Math.max(0, ...this.sessions.map(row => row.id)) + 1;
      this.sessions.push({ id, admin_id: params[0], revoked_at: null });
      return { rows: [{ id }], rowCount: 1 };
    }
    if (text.startsWith('INSERT INTO staff_auth_security_events')) {
      this.auditEvents.push({ eventType: params[0], adminId: params[1], fingerprint: params[2], metadata: params[3] });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unhandled bootstrap test SQL: ${text}`);
  }
}

function encLength(major, value) {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value < 256) return Buffer.from([(major << 5) | 24, value]);
  const result = Buffer.alloc(3); result[0] = (major << 5) | 25; result.writeUInt16BE(value, 1); return result;
}
function cbor(value) {
  if (typeof value === 'number') return value >= 0 ? encLength(0, value) : encLength(1, -1 - value);
  if (Buffer.isBuffer(value)) return Buffer.concat([encLength(2, value.length), value]);
  if (typeof value === 'string') { const bytes = Buffer.from(value); return Buffer.concat([encLength(3, bytes.length), bytes]); }
  if (value instanceof Map) { const chunks = [encLength(5, value.size)]; for (const [key, item] of value) chunks.push(cbor(key), cbor(item)); return Buffer.concat(chunks); }
  throw new Error('unsupported cbor fixture');
}
function registrationResponse(challenge) {
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
  const credentialId = Buffer.alloc(32, 99);
  const head = Buffer.alloc(37); crypto.createHash('sha256').update('shiloh.example').digest().copy(head); head[32] = 0x45;
  const idLength = Buffer.alloc(2); idLength.writeUInt16BE(credentialId.length);
  const authData = Buffer.concat([head, Buffer.alloc(16), idLength, credentialId, cbor(cose)]);
  const attestationObject = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin: 'https://shiloh.example', crossOrigin: false }));
  return { id: b64url(credentialId), rawId: b64url(credentialId), type: 'public-key', response: { clientDataJSON: b64url(clientDataJSON), attestationObject: b64url(attestationObject), transports: ['internal'] } };
}

function deterministicRandom() {
  let seed = 1;
  return function randomBytes(size) {
    const value = seed++;
    return Buffer.alloc(size, value);
  };
}

test('#804 policy is separately gated and depends on released passkey authority', () => {
  assert.equal(bootstrapPolicy(ENV).operational, true);
  assert.equal(bootstrapPolicy({ ...ENV, SHILOH_STAFF_WHATSAPP_PASSKEY_BOOTSTRAP_ENABLED: 'false' }).operational, false);
  assert.equal(bootstrapPolicy({ ...ENV, SHILOH_STAFF_PASSKEY_AUTH_ENABLED: 'false' }).operational, false);
});

test('#804 bootstrap principal must be exact, active and already Workspace-enabled', () => {
  assert.equal(evaluateBootstrapPrincipal([]).matched, false);
  assert.equal(evaluateBootstrapPrincipal([principal(), principal({ id: 45 })]).code, 'STAFF_PASSKEY_BOOTSTRAP_AMBIGUOUS');
  assert.equal(evaluateBootstrapPrincipal([principal({ admin_active: false })]).eligible, false);
  assert.equal(evaluateBootstrapPrincipal([principal({ replacement_required_at: new Date() })]).code, 'STAFF_PASSKEY_BOOTSTRAP_RECOVERY_REQUIRED');
  assert.equal(evaluateBootstrapPrincipal([principal({ calendar_scope: 'none', permissions: {} })]).code, 'STAFF_PASSKEY_BOOTSTRAP_ACCESS_REQUIRED');
  const allowed = evaluateBootstrapPrincipal([principal()]);
  assert.equal(allowed.eligible, true);
  assert.equal(allowed.admin.id, 44);
});

test('#804 secure setup token stays in URL fragment and never in server request path/query', () => {
  const token = Buffer.alloc(32, 9).toString('base64url');
  const url = new URL(setupUrl(token, ENV));
  assert.equal(url.pathname, '/calendar/staff-auth/passkeys/bootstrap');
  assert.equal(url.search, '');
  assert.equal(new URLSearchParams(url.hash.slice(1)).get('setup'), token);
});

test('#804 recognized eligible WhatsApp identity gets one-time token; redemption consumes it before WebAuthn', async () => {
  const db = new BootstrapDb();
  const service = createStaffWhatsAppPasskeyBootstrapService({ db, env: ENV, randomBytes: deterministicRandom(), now: () => new Date('2026-09-09T18:00:00Z') });
  const issued = await service.issueBootstrap({ whatsapp: '27721234567' });
  assert.equal(issued.ok, true);
  assert.equal(issued.handled, true);
  assert.equal(issued.eligible, true);
  assert.match(issued.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(db.bootstraps.length, 1);
  assert.equal(db.bootstraps[0].token_hash.includes(issued.token), false);
  assert.equal(db.auditEvents[0].eventType, 'passkey_bootstrap_issued');
  assert.doesNotMatch(JSON.stringify(db.auditEvents), new RegExp(issued.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const started = await service.startRegistration({ token: issued.token, requestFingerprintHash: 'a'.repeat(64) });
  assert.equal(started.ok, true);
  assert.equal(db.bootstraps[0].consumed_at instanceof Date, true);
  assert.equal(started.options.authenticatorSelection.authenticatorAttachment, 'platform');
  assert.equal(started.options.authenticatorSelection.residentKey, 'discouraged');
  assert.equal(started.options.authenticatorSelection.requireResidentKey, false);
  assert.equal(started.options.authenticatorSelection.userVerification, 'required');
  assert.equal(db.challenges[0].purpose, 'bootstrap_registration');
  assert.equal(Number(db.challenges[0].admin_id), 44);

  const replay = await service.startRegistration({ token: issued.token, requestFingerprintHash: 'a'.repeat(64) });
  assert.equal(replay.ok, false);
  assert.equal(replay.code, 'STAFF_PASSKEY_BOOTSTRAP_INVALID');
});

test('#804 access removal between WhatsApp issuance and redemption fails closed', async () => {
  const db = new BootstrapDb();
  const service = createStaffWhatsAppPasskeyBootstrapService({ db, env: ENV, randomBytes: deterministicRandom(), now: () => new Date('2026-09-09T18:00:00Z') });
  const issued = await service.issueBootstrap({ whatsapp: '27721234567' });
  db.identityRows = [principal({ admin_active: false })];
  const started = await service.startRegistration({ token: issued.token, requestFingerprintHash: 'b'.repeat(64) });
  assert.equal(started.ok, false);
  assert.equal(started.code, 'STAFF_PASSKEY_BOOTSTRAP_INVALID');
});

test('#932 recent strong Workspace session creates a same-principal one-use setup link without phone lookup', async () => {
  const current = new Date('2026-09-13T10:00:00Z');
  const db = new BootstrapDb();
  const service = createStaffWhatsAppPasskeyBootstrapService({ db, env: ENV, randomBytes: deterministicRandom(), now: () => current });
  const issued = await service.issueSelfBootstrap({
    session: { ok: true, adminId: 44, authMethod: 'passkey', authenticatedAt: current, recoveryRequired: false },
    requestFingerprintHash: 'b'.repeat(64),
  });
  assert.equal(issued.ok, true);
  assert.equal(issued.eligible, true);
  assert.equal(db.bootstraps.length, 1);
  assert.equal(db.bootstraps[0].admin_id, 44);
  assert.equal(db.bootstraps[0].source, 'workspace_self');
  assert.equal(new URLSearchParams(new URL(issued.url).hash.slice(1)).get('flow'), 'add');
  assert.equal(db.auditEvents[0].fingerprint, 'b'.repeat(64));
  assert.deepEqual(JSON.parse(db.auditEvents[0].metadata), { source: 'workspace_self' });
  assert.doesNotMatch(JSON.stringify(db.auditEvents), new RegExp(issued.token));
  const replacement = await service.startRegistration({ token: issued.token, mode: 'replace' });
  assert.equal(replacement.ok, false);
  assert.equal(db.bootstraps[0].consumed_at, null);
});

test('#932 self setup fails closed for weak, recovery-required, stale, or disabled principals', async () => {
  const current = new Date('2026-09-13T10:00:00Z');
  const session = { ok: true, adminId: 44, authMethod: 'passkey', authenticatedAt: current, recoveryRequired: false };
  const service = createStaffWhatsAppPasskeyBootstrapService({ db: new BootstrapDb(), env: ENV, now: () => current });
  assert.equal((await service.issueSelfBootstrap({ session: { ...session, authMethod: 'recovery_code' } })).code, 'STAFF_RECENT_STRONG_AUTH_REQUIRED');
  assert.equal((await service.issueSelfBootstrap({ session: { ...session, recoveryRequired: true } })).code, 'STAFF_RECENT_STRONG_AUTH_REQUIRED');
  assert.equal((await service.issueSelfBootstrap({ session: { ...session, authenticatedAt: new Date(current.getTime() - 11 * 60 * 1000) } })).code, 'STAFF_RECENT_STRONG_AUTH_REQUIRED');
  const disabled = createStaffWhatsAppPasskeyBootstrapService({ db: new BootstrapDb([principal({ admin_active: false })]), env: ENV, now: () => current });
  assert.equal((await disabled.issueSelfBootstrap({ session })).code, 'STAFF_AUTH_FORBIDDEN');
});

test('#926 lost-device replacement revokes prior passkeys and sessions only after verified new enrollment', async () => {
  const db = new BootstrapDb();
  const service = createStaffWhatsAppPasskeyBootstrapService({ db, env: ENV, randomBytes: deterministicRandom(), now: () => new Date('2026-09-13T12:30:00Z') });
  const issued = await service.issueBootstrap({ whatsapp: '27721234567' });
  const started = await service.startRegistration({ token: issued.token, mode: 'replace', requestFingerprintHash: 'c'.repeat(64) });
  assert.equal(started.ok, true);
  assert.equal(started.mode, 'replace');
  assert.equal(db.challenges[0].purpose, REPLACEMENT_PURPOSE);
  assert.equal(db.credentials[0].revoked_at, null);
  assert.equal(db.sessions[0].revoked_at, null);

  const finished = await service.finishRegistration({ response: registrationResponse(started.options.challenge), requestFingerprintHash: 'c'.repeat(64) });
  assert.equal(finished.ok, true);
  assert.equal(finished.mode, 'replace');
  assert.equal(finished.revokedCredentialCount, 1);
  assert.equal(db.credentials[0].revoked_at instanceof Date, true);
  assert.equal(db.credentials.at(-1).revoked_at, null);
  assert.equal(db.sessions[0].revoked_at instanceof Date, true);
  assert.equal(db.sessions.at(-1).revoked_at, null);
  const completed = db.auditEvents.find(event => event.eventType === 'passkey_bootstrap_completed');
  assert.deepEqual(JSON.parse(completed.metadata), { source: 'bootstrap_link', mode: 'replace', credentialReference: `passkey:${finished.credentialId}`, backedUp: false, priorCredentialsRevoked: 1, priorSessionsRevoked: 1 });
  assert.doesNotMatch(JSON.stringify(db.auditEvents), /27721234567/);
});

test('#926 invalid replacement mode fails before consuming the one-use setup link', async () => {
  const db = new BootstrapDb();
  const service = createStaffWhatsAppPasskeyBootstrapService({ db, env: ENV, randomBytes: deterministicRandom(), now: () => new Date('2026-09-13T12:30:00Z') });
  const issued = await service.issueBootstrap({ whatsapp: '27721234567' });
  const result = await service.startRegistration({ token: issued.token, mode: 'reset-everything' });
  assert.equal(result.ok, false);
  assert.equal(db.bootstraps[0].consumed_at, null);
  assert.equal(db.credentials[0].revoked_at, null);
});

test('#804 unknown WhatsApp greeting remains on the existing client flow; eligible greeting is handled by existing sender seam', async () => {
  assert.equal(isGreetingOnly('Hi!'), true);
  assert.equal(isGreetingOnly('I need an appointment'), false);

  let nextCount = 0;
  const unknown = createStaffWhatsAppPasskeyBootstrapMiddleware({
    bootstrapService: { issueBootstrap: async () => ({ ok: true, handled: false }) },
    sendMessage: async () => { throw new Error('must not send'); },
  });
  const unknownReq = {
    body: {
      entry: [{ changes: [{ value: { messages: [{ type: 'text', from: '2772', text: { body: 'Hi' } }] } }] }],
    },
  };
  await unknown(unknownReq, {}, () => { nextCount += 1; });
  assert.equal(nextCount, 1);

  const sends = [];
  const eligible = createStaffWhatsAppPasskeyBootstrapMiddleware({
    bootstrapService: { issueBootstrap: async () => ({ ok: true, handled: true, eligible: true, displayName: 'Christel', url: 'https://shiloh.example/calendar/staff-auth/passkeys/bootstrap#setup=secret' }) },
    sendMessage: async (to, body) => sends.push({ to, body }),
  });
  const res = { status: null, sendStatus(value) { this.status = value; return this; } };
  const eligibleReq = {
    body: {
      entry: [{ changes: [{ value: { messages: [{ type: 'text', from: '2772', text: { body: 'Hi' } }] } }] }],
    },
    log: { error() {} },
  };
  await eligible(eligibleReq, res, () => { throw new Error('must not fall through'); });
  assert.equal(res.status, 200);
  assert.equal(sends.length, 1);
  assert.match(sends[0].body, /Set up Shiloh securely/);
});

test('#804 migration isolates ordinary passkey bootstrap from break-glass/reset authority', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '113_staff_whatsapp_passkey_bootstrap_v1.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS staff_auth_passkey_bootstraps/);
  assert.match(migration, /bootstrap_registration/);
  assert.doesNotMatch(migration, /ALTER TABLE staff_auth_break_glass_bootstraps/);
  assert.doesNotMatch(migration, /UPDATE staff_admin_accounts|permissions\s*=|calendar_scope\s*=|service_scope\s*=/i);
});

test('#932 migration only extends the existing hashed bootstrap source authority', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/118_workspace_self_passkey_bootstrap.sql'), 'utf8');
  assert.match(sql, /source IN \('whatsapp_self', 'workspace_self'\)/);
  assert.doesNotMatch(sql, /CREATE TABLE|phone|whatsapp_number|session token|otp/i);
});

test('#926 migration adds only purpose-isolated replacement ceremonies', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '117_workspace_device_recovery_v1.sql'), 'utf8');
  assert.match(migration, /registration_replacement/);
  assert.match(migration, /bootstrap_replacement_registration/);
  assert.doesNotMatch(migration, /CREATE TABLE|staff_admin_accounts\s+SET|permissions\s*=|DELETE FROM/i);
});

test('#804 bootstrap route cannot issue a Workspace session until successful passkey finish', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'staffPasskeyBootstrap.js'), 'utf8');
  const service = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'staffWhatsAppPasskeyBootstrap.js'), 'utf8');
  assert.match(route, /router\.post\('\/bootstrap\/start', sameOrigin/);
  assert.match(route, /router\.post\('\/bootstrap\/finish', sameOrigin/);
  assert.match(service, /verifyRegistrationResponse/);
  const verifyAt = service.indexOf('verified = verifyRegistrationResponse');
  const sessionAt = service.indexOf('const issued = await issueStaffBrowserSession');
  assert.ok(verifyAt >= 0 && sessionAt > verifyAt, 'canonical browser session must be issued only after WebAuthn verification');
  assert.doesNotMatch(service, /UPDATE staff_admin_accounts|INSERT INTO staff_admin_accounts|permissions\s*=|calendar_scope\s*=|service_scope\s*=/i);
});

test('#829 simplified sign-in removes bootstrap explainer while preserving fallback and bootstrap authority', () => {
  const base = '<section data-shiloh-provider-independent-auth><h2>Use your authenticator</h2><details><summary>Use a recovery code</summary></details>\n      </section>';
  const guided = withWhatsAppBootstrapGuidance(base);
  assert.equal(guided, base);
  assert.doesNotMatch(guided, /First time \/ new device|Set up Shiloh from WhatsApp|send <code>Hi<\/code> to Shiloh/);
  const folded = withFallbackDisclosure(guided);
  assert.match(folded, /Use another sign-in method/);
  assert.match(folded, /data-shiloh-fallback-auth/);
  const script = bootstrapAwareSigninScript(ENV);
  assert.match(script, /\/calendar\/staff-auth\/passkeys\/authentication\/options/);
  assert.match(script, /\/calendar\/staff-auth\/passkeys\/authentication\/finish/);
  assert.doesNotMatch(script, /Device sign-in is not set up in this app yet|Send “Hi” to Shiloh on WhatsApp/);
});

test('#804 bootstrap presentation persists no browser authority or setup token', () => {
  const presentation = fs.readFileSync(path.join(__dirname, '..', 'src', 'presentation', 'staffPasskeyBootstrapUx.js'), 'utf8');
  assert.match(presentation, /history\.replaceState/);
  assert.doesNotMatch(presentation, /localStorage|sessionStorage|indexedDB|document\.cookie|Authorization|Bearer/i);
  assert.match(presentation, /Add this device/);
  assert.match(presentation, /Replace a lost device/);
  assert.match(presentation, /Previous device access will be removed only after setup succeeds/);
});
