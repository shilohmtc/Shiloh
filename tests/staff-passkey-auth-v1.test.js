const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  b64url,
  defaultDeviceLabel,
  normalizeDeviceLabel,
  personalizedDeviceLabel,
  normalizeCredentialHint,
  passkeyPolicy,
  registrationUser,
  strongRecentSession,
  verifyRegistrationResponse,
  verifyAssertionResponse,
} = require('../src/services/staffPasskeyAuth');
const {
  passkeyHintCookieName,
  serializePasskeyHintCookie,
} = require('../src/routes/staffPasskeyAuth');
const { signinPanel, signinScript, initialCredentialList, initialHistory, managePage, manageScript } = require('../src/presentation/staffPasskeyUx');

const ORIGIN = 'https://staff.shiloh.example';
const RP_ID = 'staff.shiloh.example';
function encLen(major, n) { if (n < 24) return Buffer.from([(major << 5) | n]); if (n < 256) return Buffer.from([(major << 5) | 24, n]); if (n < 65536) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; } throw new Error('test cbor length'); }
function cbor(v) {
  if (typeof v === 'number') return v >= 0 ? encLen(0, v) : encLen(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([encLen(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([encLen(3, b.length), b]); }
  if (v instanceof Map) { const parts = [encLen(5, v.size)]; for (const [k, val] of v) parts.push(cbor(k), cbor(val)); return Buffer.concat(parts); }
  throw new Error('unsupported test cbor');
}
function clientData(type, challenge, origin = ORIGIN) { return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false })); }
function authData({ credentialId = null, cose = null, signCount = 0, flags = 0x05, rpId = RP_ID } = {}) {
  const head = Buffer.alloc(37); crypto.createHash('sha256').update(rpId).digest().copy(head, 0); head[32] = flags; head.writeUInt32BE(signCount, 33);
  if (!credentialId) return head;
  const aaguid = Buffer.alloc(16); const len = Buffer.alloc(2); len.writeUInt16BE(credentialId.length);
  return Buffer.concat([head, aaguid, len, credentialId, cbor(cose)]);
}
function fixture() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
  const credentialId = crypto.randomBytes(32); const challenge = crypto.randomBytes(32).toString('base64url');
  return { publicKey, privateKey, cose, credentialId, challenge };
}
function registrationResponse(f, { origin = ORIGIN, challenge = f.challenge, rpId = RP_ID, flags = 0x45 } = {}) {
  const cd = clientData('webauthn.create', challenge, origin);
  const ad = authData({ credentialId: f.credentialId, cose: f.cose, signCount: 0, flags, rpId });
  const att = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', ad]]));
  return { id: b64url(f.credentialId), rawId: b64url(f.credentialId), type: 'public-key', response: { clientDataJSON: b64url(cd), attestationObject: b64url(att), transports: ['internal'] } };
}
function assertionResponse(f, credential, { origin = ORIGIN, challenge = f.challenge, rpId = RP_ID, flags = 0x05, signCount = 1 } = {}) {
  const cd = clientData('webauthn.get', challenge, origin); const ad = authData({ signCount, flags, rpId });
  const signed = Buffer.concat([ad, crypto.createHash('sha256').update(cd).digest()]); const sig = crypto.sign('sha256', signed, f.privateKey);
  return { id: credential.credential_id, rawId: credential.credential_id, type: 'public-key', response: { clientDataJSON: b64url(cd), authenticatorData: b64url(ad), signature: b64url(sig), userHandle: null } };
}

test('#794 policy derives RP only from configured HTTPS public origin and fails closed on mismatch', () => {
  assert.equal(passkeyPolicy({ SHILOH_STAFF_PASSKEY_AUTH_ENABLED: 'false' }).operational, false);
  assert.equal(passkeyPolicy({ SHILOH_STAFF_PASSKEY_AUTH_ENABLED: 'true', SHILOH_CALENDAR_PUBLIC_ORIGIN: ORIGIN }).rpId, RP_ID);
  assert.equal(passkeyPolicy({ SHILOH_STAFF_PASSKEY_AUTH_ENABLED: 'true', SHILOH_CALENDAR_PUBLIC_ORIGIN: ORIGIN, SHILOH_STAFF_WEBAUTHN_RP_ID: 'evil.example' }).operational, false);
  assert.equal(passkeyPolicy({ SHILOH_STAFF_PASSKEY_AUTH_ENABLED: 'true', SHILOH_CALENDAR_PUBLIC_ORIGIN: 'http://staff.shiloh.example' }).operational, false);
});

test('#794 registration verifies attested credential ownership, RP hash, exact origin and UV', () => {
  const f = fixture(); const verified = verifyRegistrationResponse(registrationResponse(f), { expectedChallenge: f.challenge, origin: ORIGIN, rpId: RP_ID });
  assert.equal(verified.credentialId, b64url(f.credentialId)); assert.equal(verified.algorithm, -7); assert.equal(verified.transports[0], 'internal');
  assert.throws(() => verifyRegistrationResponse(registrationResponse(f, { origin: 'https://evil.example' }), { expectedChallenge: f.challenge, origin: ORIGIN, rpId: RP_ID }));
  assert.throws(() => verifyRegistrationResponse(registrationResponse(f, { rpId: 'other.example' }), { expectedChallenge: f.challenge, origin: ORIGIN, rpId: RP_ID }));
  assert.throws(() => verifyRegistrationResponse(registrationResponse(f, { challenge: crypto.randomBytes(32).toString('base64url') }), { expectedChallenge: f.challenge, origin: ORIGIN, rpId: RP_ID }));
  assert.throws(() => verifyRegistrationResponse(registrationResponse(f, { flags: 0x41 }), { expectedChallenge: f.challenge, origin: ORIGIN, rpId: RP_ID }));
});

test('#794 successful assertion verifies signature, credential ownership, origin/RP/challenge and counters', () => {
  const f = fixture(); const reg = verifyRegistrationResponse(registrationResponse(f), { expectedChallenge: f.challenge, origin: ORIGIN, rpId: RP_ID });
  const credential = { credential_id: reg.credentialId, public_key_spki: reg.publicKeySpki, algorithm: reg.algorithm, sign_count: 0 };
  const result = verifyAssertionResponse(assertionResponse(f, credential), credential, { expectedChallenge: f.challenge, origin: ORIGIN, rpId: RP_ID }); assert.equal(result.signCount, 1);
  const wrong = { ...credential, credential_id: b64url(crypto.randomBytes(32)) }; assert.throws(() => verifyAssertionResponse(assertionResponse(f, credential), wrong, { expectedChallenge: f.challenge, origin: ORIGIN, rpId: RP_ID }));
  assert.throws(() => verifyAssertionResponse(assertionResponse(f, credential, { origin: 'https://evil.example' }), credential, { expectedChallenge: f.challenge, origin: ORIGIN, rpId: RP_ID }));
  assert.throws(() => verifyAssertionResponse(assertionResponse(f, credential, { rpId: 'wrong.example' }), credential, { expectedChallenge: f.challenge, origin: ORIGIN, rpId: RP_ID }));
  assert.throws(() => verifyAssertionResponse(assertionResponse(f, credential, { challenge: crypto.randomBytes(32).toString('base64url') }), credential, { expectedChallenge: f.challenge, origin: ORIGIN, rpId: RP_ID }));
  assert.throws(() => verifyAssertionResponse(assertionResponse(f, credential, { flags: 0x01 }), credential, { expectedChallenge: f.challenge, origin: ORIGIN, rpId: RP_ID }));
});

test('#794 counter replay and invalid assertion signature fail closed', () => {
  const f = fixture(); const reg = verifyRegistrationResponse(registrationResponse(f), { expectedChallenge: f.challenge, origin: ORIGIN, rpId: RP_ID });
  const credential = { credential_id: reg.credentialId, public_key_spki: reg.publicKeySpki, algorithm: reg.algorithm, sign_count: 4 };
  assert.throws(() => verifyAssertionResponse(assertionResponse(f, credential, { signCount: 4 }), credential, { expectedChallenge: f.challenge, origin: ORIGIN, rpId: RP_ID }), /COUNTER_REPLAY/);
  const response = assertionResponse(f, credential, { signCount: 5 }); response.response.signature = b64url(crypto.randomBytes(64));
  assert.throws(() => verifyAssertionResponse(response, credential, { expectedChallenge: f.challenge, origin: ORIGIN, rpId: RP_ID }), /SIGNATURE_INVALID/);
});

test('#952 registration and lifecycle require a recent passkey session', () => {
  const now = new Date(); const base = { ok: true, authenticatedAt: now, recoveryRequired: false };
  assert.equal(strongRecentSession({ ...base, authMethod: 'totp' }, now), false);
  assert.equal(strongRecentSession({ ...base, authMethod: 'passkey' }, now), true);
  assert.equal(strongRecentSession({ ...base, authMethod: 'recovery_code' }, now), false);
  assert.equal(strongRecentSession({ ...base, authMethod: 'break_glass' }, now), false);
  assert.equal(strongRecentSession({ ...base, authMethod: 'whatsapp_otp' }, now), false);
  assert.equal(strongRecentSession({ ...base, authMethod: 'totp', recoveryRequired: true }, now), false);
});

test('#940 passkey registration presents the canonical staff name while retaining an opaque stable user id', () => {
  const user = registrationUser({ id: 4, display_name: 'Jean-Pierre\nBotha' });
  assert.deepEqual(user, {
    id: Buffer.from('staff-admin:4').toString('base64url'),
    name: 'Jean-Pierre Botha',
    displayName: 'Jean-Pierre Botha',
  });
  assert.doesNotMatch(user.name, /^staff-\d+$/);
});

test('#794 device credential is non-discoverable, platform-bound, and targeted on re-entry', () => {
  const service = fs.readFileSync(path.join(__dirname, '../src/services/staffPasskeyAuth.js'), 'utf8');
  const ux = fs.readFileSync(path.join(__dirname, '../src/presentation/staffPasskeyUx.js'), 'utf8');
  assert.match(service, /authenticatorAttachment:\s*'platform'/);
  assert.match(service, /residentKey:\s*'discouraged'/);
  assert.match(service, /requireResidentKey:\s*false/);
  assert.doesNotMatch(service, /residentKey:\s*'required'/);
  assert.match(service, /userVerification:\s*'required'/);
  assert.match(service, /allowCredentials:\s*\[\{ type: 'public-key', id: credential\.credential_id/);
  assert.match(service, /STAFF_PASSKEY_KNOWN_PRINCIPAL_REQUIRED/);
  assert.match(service, /INSERT INTO staff_auth_webauthn_challenges \(challenge_hash, purpose, admin_id/);
  assert.match(service, /Number\(credential\.admin_id\) !== Number\(challenge\.admin_id\)/);
  assert.match(ux, /allowCredentials\|\|\[\]/);
  assert.match(ux, /known-principal/);
});

test('#968 missing browser device link is explained without disclosing staff identity', () => {
  const panel = signinPanel();
  const ux = signinScript();
  assert.doesNotThrow(() => new Function(ux));
  assert.match(panel, /data-shiloh-passkey-status[^>]*hidden/);
  assert.match(ux, /This app is not linked to a Shiloh staff account/);
  assert.match(ux, /removing or reinstalling Shiloh/);
  assert.match(ux, /Workspace → Devices & sign-in → Set up another device/);
  assert.match(ux, /fresh private QR code/);
  assert.match(ux, /Device setup required/);
  assert.match(ux, /device-unlinked/);
  assert.doesNotMatch(ux, /staff-admin:\\d+|normalized_whatsapp|whatsapp_number/);
});

test('#794 remembered device hint is opaque, HttpOnly, strict, secure in production, and not authority', () => {
  const hint = b64url(crypto.randomBytes(32));
  assert.equal(normalizeCredentialHint(hint), hint);
  assert.equal(normalizeCredentialHint('not a credential id'), null);
  const env = { NODE_ENV: 'production' };
  assert.equal(passkeyHintCookieName(env), '__Host-shiloh_staff_device_credential');
  const cookie = serializePasskeyHintCookie(hint, { env });
  assert.match(cookie, /^__Host-shiloh_staff_device_credential=/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Max-Age=/);
  assert.doesNotMatch(cookie, /session|mobile|whatsapp|admin_id/i);
});

test('#794 schema is additive, multi-credential, soft-revocable and extends canonical auth method', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/111_staff_passkey_auth_v1.sql'), 'utf8');
  assert.match(sql, /staff_auth_passkey_credentials/); assert.match(sql, /admin_id BIGINT NOT NULL REFERENCES staff_admin_accounts/); assert.match(sql, /credential_id TEXT NOT NULL UNIQUE/);
  assert.match(sql, /revoked_at TIMESTAMPTZ/); assert.doesNotMatch(sql, /DELETE FROM staff_auth_passkey_credentials/i); assert.match(sql, /'passkey'/);
  assert.match(sql, /staff_auth_webauthn_challenges/); assert.match(sql, /purpose IN \('registration', 'authentication'\)/);
});

test('#952 ordinary fallback and controlled recovery routes are retired while passkey protection remains', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/staffBrowserSession.js'), 'utf8');
  const access = fs.readFileSync(path.join(__dirname, '../src/routes/staffCalendarAccessUx.js'), 'utf8');
  const pwa = fs.readFileSync(path.join(__dirname, '../src/presentation/workspacePwa.js'), 'utf8');
  assert.doesNotMatch(routes, /router\.post\('\/totp\/verify'/);
  assert.doesNotMatch(routes, /router\.post\('\/totp\/recovery\/verify'/);
  assert.doesNotMatch(routes, /break-glass\/exchange/);
  assert.match(access, /withPasskeyReentry/);
  assert.doesNotMatch(access, /providerIndependentAuthPolicy|Emergency sign-in/);
  assert.doesNotMatch(pwa, /staff-auth\/passkeys.*cache/i); assert.match(pwa, /no-store|NETWORK|fetch/i);
});

test('#794 source/UX introduces no biometric collection, alternate provider, raw mobile field, or secret persistence', () => {
  const files = ['../src/services/staffPasskeyAuth.js','../src/routes/staffPasskeyAuth.js','../src/presentation/staffPasskeyUx.js'].map((p) => fs.readFileSync(path.join(__dirname, p), 'utf8')).join('\n');
  assert.doesNotMatch(files, /localStorage|sessionStorage|indexedDB/i);
  assert.doesNotMatch(files, /face.?id.*(send|store)|fingerprint.*(send|store)/i);
  assert.doesNotMatch(files, /normalized_whatsapp|whatsapp_number/);
  assert.doesNotMatch(files, /google|microsoft|sms otp|magic.?link/i);
});

test('#926 authenticated replacement enrolls first, preserves the current session and then revokes older access', () => {
  const service = fs.readFileSync(path.join(__dirname, '../src/services/staffPasskeyAuth.js'), 'utf8');
  const route = fs.readFileSync(path.join(__dirname, '../src/routes/staffPasskeyAuth.js'), 'utf8');
  const ux = fs.readFileSync(path.join(__dirname, '../src/presentation/staffPasskeyUx.js'), 'utf8');
  const insertAt = service.indexOf('INSERT INTO staff_auth_passkey_credentials');
  const revokeAt = service.indexOf('UPDATE staff_auth_passkey_credentials', insertAt);
  const sessionRevokeAt = service.indexOf('UPDATE staff_browser_sessions', revokeAt);
  assert.ok(insertAt >= 0 && revokeAt > insertAt && sessionRevokeAt > revokeAt);
  assert.match(service, /id <> \$2 AND revoked_at IS NULL/);
  assert.match(service, /revoke_reason = 'device_replaced'/);
  assert.match(service, /eventType: replacement \? 'passkey_device_replaced' : 'passkey_registered'/);
  assert.match(route, /mode: req\.body\?\.mode/);
  assert.match(ux, /Replace a lost device/);
  assert.match(ux, /Existing device access was not changed/);
  assert.doesNotMatch(service, /DELETE FROM staff_auth_passkey_credentials|DELETE FROM staff_browser_sessions/i);
});

test('#932 signed-in device management exposes bounded cross-device setup without browser persistence', () => {
  const route = fs.readFileSync(path.join(__dirname, '../src/routes/staffPasskeyAuth.js'), 'utf8');
  const ux = fs.readFileSync(path.join(__dirname, '../src/presentation/staffPasskeyUx.js'), 'utf8');
  const bootstrapUx = fs.readFileSync(path.join(__dirname, '../src/presentation/staffPasskeyBootstrapUx.js'), 'utf8');
  assert.match(route, /post\('\/self-bootstrap'/);
  assert.match(route, /issueSelfBootstrap\(\{/);
  assert.match(route, /qrCode\.toDataURL/);
  assert.match(route, /img-src data:/);
  assert.match(ux, /Set up this device/);
  assert.match(ux, /Set up another device/);
  assert.match(ux, /data-passkey-other-qr/);
  assert.match(ux, /private setup link/i);
  assert.match(bootstrapUx, /forcedMode.*flow.*add/);
  assert.match(bootstrapUx, /data-bootstrap-mode'\)===\s*'replace'\)modeButtons\[j\]\.hidden=true/);
  assert.doesNotMatch(ux, /localStorage|sessionStorage|indexedDB/i);
});

test('#957 device labels are privacy-safe, bounded, and inferred without storing a raw user agent', () => {
  assert.equal(normalizeDeviceLabel('  JP\nphone  '), 'JP phone');
  assert.equal(normalizeDeviceLabel(''), null);
  assert.equal(normalizeDeviceLabel({ toString: () => 'Deceptive label' }), null);
  assert.equal(normalizeDeviceLabel('x'.repeat(49)), null);
  assert.equal(defaultDeviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_6)'), 'iPhone');
  assert.equal(defaultDeviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'Windows PC');
  assert.equal(defaultDeviceLabel('private-browser'), 'Shiloh device');
  assert.equal(personalizedDeviceLabel('Jean-Pierre Botha', 'iPhone'), 'Jean-Pierre’s iPhone');
  assert.equal(personalizedDeviceLabel('Christel Botha', 'Windows PC'), 'Christel’s Windows PC');
  assert.equal(personalizedDeviceLabel('James Smith', 'iPad'), 'James’ iPad');
  assert.equal(personalizedDeviceLabel('', 'Android device'), 'Android device');
  const authService = fs.readFileSync(path.join(__dirname, '../src/services/staffPasskeyAuth.js'), 'utf8');
  const bootstrapService = fs.readFileSync(path.join(__dirname, '../src/services/staffWhatsAppPasskeyBootstrap.js'), 'utf8');
  assert.match(authService, /personalizedDeviceLabel\(admin\.display_name, deviceLabel\)/);
  assert.match(bootstrapService, /personalizedDeviceLabel\(admin\.display_name, deviceLabel\)/);
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/119_workspace_passkey_device_labels.sql'), 'utf8');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS device_label TEXT/);
  assert.match(migration, /char_length\(device_label\) BETWEEN 1 AND 48/);
  assert.doesNotMatch(migration, /user.?agent|fingerprint/i);
});

test('#957 Workspace device manager is self-scoped, protects the last passkey, and keeps removed devices read-only', () => {
  const service = fs.readFileSync(path.join(__dirname, '../src/services/staffPasskeyAuth.js'), 'utf8');
  const route = fs.readFileSync(path.join(__dirname, '../src/routes/staffPasskeyAuth.js'), 'utf8');
  const script = manageScript();
  assert.match(service, /WHERE admin_id = \$1 AND revoked_at IS NULL ORDER BY id FOR UPDATE/);
  assert.match(service, /active\.rows\.length <= 1/);
  assert.match(service, /STAFF_PASSKEY_ONLY_CREDENTIAL/);
  assert.match(service, /SET device_label = \$3\s+WHERE id = \$2 AND admin_id = \$1 AND revoked_at IS NULL/);
  assert.match(service, /eventType: 'passkey_label_updated'[\s\S]{0,160}metadata: \{ credentialReference: `passkey:\$\{id\}` \}/);
  assert.match(route, /post\('\/:credentialId\/rename'/);
  assert.match(route, /credentialIdHint: passkeyHintFromRequest/);
  assert.match(script, /This device/);
  assert.match(script, /data-passkey-history-list/);
  assert.match(script, /Add another device before removing your only active device/);
  const rows = [
    { label: '<JP phone>', current: true, createdAt: '2026-09-13T00:00:00Z' },
    { label: 'Old PC', revokedAt: '2026-09-12T00:00:00Z' },
  ];
  assert.match(initialCredentialList(rows), /&lt;JP phone&gt;/);
  assert.doesNotMatch(initialCredentialList(rows), /Old PC/);
  assert.match(initialHistory(rows), /Old PC/);
  assert.doesNotMatch(initialHistory(rows), />Rename<|>Remove</);
});

test('#970 device management uses accessible Shiloh dialogs instead of browser prompts', () => {
  const page = managePage({ credentials: [{ id: 1, label: 'JP\u2019s iPhone', current: true }] });
  const script = manageScript();
  assert.match(page, /<dialog class="device-dialog"/);
  assert.match(page, /aria-labelledby="device-dialog-title"/);
  assert.match(page, /aria-describedby="device-dialog-copy"/);
  assert.match(page, /data-device-dialog-input/);
  assert.match(page, /maxlength="48"/);
  assert.match(page, /@media\(max-width:560px\)[\s\S]*\.device-dialog/);
  assert.doesNotMatch(script, /window\.(?:confirm|prompt)\(/);
  assert.match(script, /dialog\.showModal\(\)/);
  assert.match(script, /event\.key==='Enter'/);
  assert.match(script, /event\.preventDefault\(\);settleDialog\(null\)/);
  assert.match(script, /opener\.focus\(\)/);
  assert.match(script, /Remove device/);
  assert.match(script, /Rename this device/);
  assert.match(script, /Replace a lost device\?/);
  assert.doesNotThrow(() => new Function(script));
});
