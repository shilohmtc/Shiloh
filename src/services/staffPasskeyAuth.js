const crypto = require('crypto');
const { sha256, issueStaffBrowserSession } = require('./staffBrowserSession');
const { isRecentAuthentication } = require('./providerIndependentStaffAuth');

const FEATURE_FLAG = 'SHILOH_STAFF_PASSKEY_AUTH_ENABLED';
const RP_ID_FLAG = 'SHILOH_STAFF_WEBAUTHN_RP_ID';
const PUBLIC_ORIGIN_FLAG = 'SHILOH_CALENDAR_PUBLIC_ORIGIN';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const REGISTRATION_PURPOSE = 'registration';
const REPLACEMENT_REGISTRATION_PURPOSE = 'registration_replacement';
const STRONG_AUTH_METHODS = new Set(['totp', 'passkey']);
const ALLOWED_TRANSPORTS = new Set(['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card']);
const ALGORITHMS = new Set([-7, -8, -257]);

function b64url(buffer) { return Buffer.from(buffer).toString('base64url'); }
function fromB64url(value, maxBytes = 8192) {
  const text = String(value || '');
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length > Math.ceil(maxBytes * 4 / 3) + 4) throw new Error('WEBAUTHN_ENCODING_INVALID');
  const decoded = Buffer.from(text, 'base64url');
  if (decoded.length > maxBytes || b64url(decoded) !== text) throw new Error('WEBAUTHN_ENCODING_INVALID');
  return decoded;
}
function normalizeCredentialHint(value) {
  try {
    const decoded = fromB64url(value, 1024);
    return decoded.length >= 16 ? b64url(decoded) : null;
  } catch (_) { return null; }
}
function hashBytes(value) { return crypto.createHash('sha256').update(Buffer.from(value)).digest(); }
function safeBufferEqual(a, b) {
  const left = Buffer.from(a || []); const right = Buffer.from(b || []);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function webauthnOrigin(env = process.env) {
  const raw = String(env[PUBLIC_ORIGIN_FLAG] || env.RENDER_EXTERNAL_URL || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch (_) { return null; }
}
function passkeyPolicy(env = process.env) {
  const enabled = String(env[FEATURE_FLAG] || '').trim().toLowerCase() === 'true';
  if (!enabled) return { enabled: false, operational: false, origin: null, rpId: null };
  const origin = webauthnOrigin(env);
  if (!origin) return { enabled: true, operational: false, origin: null, rpId: null };
  const hostname = new URL(origin).hostname.toLowerCase();
  const configured = String(env[RP_ID_FLAG] || hostname).trim().toLowerCase().replace(/\.$/, '');
  const valid = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(configured)
    && (hostname === configured || hostname.endsWith(`.${configured}`));
  return { enabled: true, operational: valid, origin, rpId: valid ? configured : null };
}
function strongRecentSession(session, current = new Date()) {
  return isRecentAuthentication(session, current) && session?.recoveryRequired !== true && STRONG_AUTH_METHODS.has(String(session?.authMethod || ''));
}
function clientData(value, expectedType, expectedOrigin) {
  const raw = fromB64url(value, 16384);
  let parsed;
  try { parsed = JSON.parse(raw.toString('utf8')); } catch (_) { throw new Error('WEBAUTHN_CLIENT_DATA_INVALID'); }
  if (!parsed || parsed.type !== expectedType || parsed.origin !== expectedOrigin || parsed.crossOrigin === true) throw new Error('WEBAUTHN_CLIENT_DATA_INVALID');
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(String(parsed.challenge || ''))) throw new Error('WEBAUTHN_CHALLENGE_INVALID');
  return { raw, parsed };
}

function readLength(buffer, offset, additional) {
  if (additional < 24) return { length: additional, offset };
  const sizes = { 24: 1, 25: 2, 26: 4, 27: 8 };
  const size = sizes[additional];
  if (!size || offset + size > buffer.length) throw new Error('CBOR_INVALID');
  let value = 0n;
  for (let i = 0; i < size; i += 1) value = (value << 8n) | BigInt(buffer[offset + i]);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('CBOR_INVALID');
  return { length: Number(value), offset: offset + size };
}
function decodeCbor(buffer, start = 0, depth = 0) {
  if (depth > 12 || start >= buffer.length) throw new Error('CBOR_INVALID');
  const first = buffer[start]; const major = first >> 5; const additional = first & 31;
  if (additional === 31) throw new Error('CBOR_INVALID');
  const info = readLength(buffer, start + 1, additional);
  let offset = info.offset; const length = info.length;
  if (major === 0) return { value: length, offset };
  if (major === 1) return { value: -1 - length, offset };
  if (major === 2 || major === 3) {
    if (offset + length > buffer.length) throw new Error('CBOR_INVALID');
    const raw = buffer.subarray(offset, offset + length); offset += length;
    return { value: major === 2 ? Buffer.from(raw) : raw.toString('utf8'), offset };
  }
  if (major === 4) {
    if (length > 128) throw new Error('CBOR_INVALID');
    const value = [];
    for (let i = 0; i < length; i += 1) { const item = decodeCbor(buffer, offset, depth + 1); value.push(item.value); offset = item.offset; }
    return { value, offset };
  }
  if (major === 5) {
    if (length > 128) throw new Error('CBOR_INVALID');
    const value = new Map();
    for (let i = 0; i < length; i += 1) {
      const key = decodeCbor(buffer, offset, depth + 1); offset = key.offset;
      const item = decodeCbor(buffer, offset, depth + 1); offset = item.offset;
      value.set(key.value, item.value);
    }
    return { value, offset };
  }
  if (major === 7 && additional === 20) return { value: false, offset: start + 1 };
  if (major === 7 && additional === 21) return { value: true, offset: start + 1 };
  if (major === 7 && additional === 22) return { value: null, offset: start + 1 };
  throw new Error('CBOR_INVALID');
}
function cosePublicKeyToSpki(cose) {
  if (!(cose instanceof Map)) throw new Error('WEBAUTHN_PUBLIC_KEY_INVALID');
  const kty = Number(cose.get(1)); const alg = Number(cose.get(3));
  if (!ALGORITHMS.has(alg)) throw new Error('WEBAUTHN_ALGORITHM_UNSUPPORTED');
  let jwk;
  if (kty === 2 && alg === -7 && Number(cose.get(-1)) === 1) {
    const x = cose.get(-2); const y = cose.get(-3);
    if (!Buffer.isBuffer(x) || x.length !== 32 || !Buffer.isBuffer(y) || y.length !== 32) throw new Error('WEBAUTHN_PUBLIC_KEY_INVALID');
    jwk = { kty: 'EC', crv: 'P-256', x: b64url(x), y: b64url(y), ext: true };
  } else if (kty === 3 && alg === -257) {
    const n = cose.get(-1); const e = cose.get(-2);
    if (!Buffer.isBuffer(n) || n.length < 128 || !Buffer.isBuffer(e) || e.length < 1 || e.length > 8) throw new Error('WEBAUTHN_PUBLIC_KEY_INVALID');
    jwk = { kty: 'RSA', n: b64url(n), e: b64url(e), alg: 'RS256', ext: true };
  } else if (kty === 1 && alg === -8 && Number(cose.get(-1)) === 6) {
    const x = cose.get(-2);
    if (!Buffer.isBuffer(x) || x.length !== 32) throw new Error('WEBAUTHN_PUBLIC_KEY_INVALID');
    jwk = { kty: 'OKP', crv: 'Ed25519', x: b64url(x), ext: true };
  } else throw new Error('WEBAUTHN_ALGORITHM_UNSUPPORTED');
  return { alg, spki: crypto.createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'der' }) };
}
function verifyRpAndFlags(authData, rpId, { registration = false } = {}) {
  if (!Buffer.isBuffer(authData) || authData.length < 37) throw new Error('WEBAUTHN_AUTH_DATA_INVALID');
  if (!safeBufferEqual(authData.subarray(0, 32), hashBytes(Buffer.from(rpId, 'utf8')))) throw new Error('WEBAUTHN_RP_MISMATCH');
  const flags = authData[32];
  if ((flags & 0x01) === 0 || (flags & 0x04) === 0) throw new Error('WEBAUTHN_USER_VERIFICATION_REQUIRED');
  if ((flags & 0x10) !== 0 && (flags & 0x08) === 0) throw new Error('WEBAUTHN_BACKUP_FLAGS_INVALID');
  if (registration && (flags & 0x40) === 0) throw new Error('WEBAUTHN_ATTESTED_DATA_REQUIRED');
  return { flags, signCount: authData.readUInt32BE(33), backedUp: (flags & 0x10) !== 0 };
}
function verifyRegistrationResponse(response, { expectedChallenge, origin, rpId } = {}) {
  if (!response || response.type !== 'public-key') throw new Error('WEBAUTHN_REGISTRATION_INVALID');
  const rawId = fromB64url(response.rawId || response.id, 1024);
  if (rawId.length < 16 || response.id !== b64url(rawId)) throw new Error('WEBAUTHN_CREDENTIAL_ID_INVALID');
  const cd = clientData(response.response?.clientDataJSON, 'webauthn.create', origin);
  if (cd.parsed.challenge !== expectedChallenge) throw new Error('WEBAUTHN_CHALLENGE_MISMATCH');
  const attestationBytes = fromB64url(response.response?.attestationObject, 65536);
  const attestation = decodeCbor(attestationBytes);
  if (!(attestation.value instanceof Map) || attestation.offset !== attestationBytes.length) throw new Error('WEBAUTHN_ATTESTATION_INVALID');
  if (attestation.value.get('fmt') !== 'none') throw new Error('WEBAUTHN_ATTESTATION_FORMAT_UNSUPPORTED');
  const attStmt = attestation.value.get('attStmt');
  if (!(attStmt instanceof Map) || attStmt.size !== 0) throw new Error('WEBAUTHN_ATTESTATION_INVALID');
  const authData = attestation.value.get('authData');
  const parsed = verifyRpAndFlags(authData, rpId, { registration: true });
  if (authData.length < 55) throw new Error('WEBAUTHN_AUTH_DATA_INVALID');
  const credentialIdLength = authData.readUInt16BE(53);
  const credentialStart = 55; const credentialEnd = credentialStart + credentialIdLength;
  if (credentialIdLength < 16 || credentialEnd >= authData.length) throw new Error('WEBAUTHN_CREDENTIAL_ID_INVALID');
  const attestedId = authData.subarray(credentialStart, credentialEnd);
  if (!safeBufferEqual(attestedId, rawId)) throw new Error('WEBAUTHN_CREDENTIAL_ID_MISMATCH');
  const key = decodeCbor(authData, credentialEnd);
  const publicKey = cosePublicKeyToSpki(key.value);
  const transports = Array.isArray(response.response?.transports)
    ? [...new Set(response.response.transports.map(String).filter((v) => ALLOWED_TRANSPORTS.has(v)))].slice(0, 8) : [];
  return { credentialId: b64url(rawId), publicKeySpki: publicKey.spki, algorithm: publicKey.alg, signCount: parsed.signCount, backedUp: parsed.backedUp, transports };
}
function verifyAssertionResponse(response, credential, { expectedChallenge, origin, rpId } = {}) {
  if (!response || response.type !== 'public-key') throw new Error('WEBAUTHN_ASSERTION_INVALID');
  const rawId = fromB64url(response.rawId || response.id, 1024);
  if (response.id !== b64url(rawId) || response.id !== credential.credential_id) throw new Error('WEBAUTHN_CREDENTIAL_OWNERSHIP_MISMATCH');
  const cd = clientData(response.response?.clientDataJSON, 'webauthn.get', origin);
  if (cd.parsed.challenge !== expectedChallenge) throw new Error('WEBAUTHN_CHALLENGE_MISMATCH');
  const authData = fromB64url(response.response?.authenticatorData, 4096);
  const parsed = verifyRpAndFlags(authData, rpId);
  const signature = fromB64url(response.response?.signature, 4096);
  const signed = Buffer.concat([authData, hashBytes(cd.raw)]);
  const key = crypto.createPublicKey({ key: Buffer.from(credential.public_key_spki), format: 'der', type: 'spki' });
  const alg = Number(credential.algorithm);
  let valid = false;
  if (alg === -7 || alg === -257) valid = crypto.verify('sha256', signed, key, signature);
  else if (alg === -8) valid = crypto.verify(null, signed, key, signature);
  if (!valid) throw new Error('WEBAUTHN_SIGNATURE_INVALID');
  const previous = Number(credential.sign_count || 0); const current = Number(parsed.signCount || 0);
  if (previous > 0 && current > 0 && current <= previous) throw new Error('WEBAUTHN_COUNTER_REPLAY');
  return { signCount: Math.max(previous, current), backedUp: parsed.backedUp };
}
function randomChallenge(randomBytes = crypto.randomBytes) { return randomBytes(32).toString('base64url'); }
function opaqueUserId(adminId) { return Buffer.from(`staff-admin:${Number(adminId)}`, 'utf8').toString('base64url'); }
function cleanDisplayName(value) { return String(value || 'Shiloh staff').replace(/[\r\n\t]+/g, ' ').slice(0, 80) || 'Shiloh staff'; }

function createStaffPasskeyAuthService({ db, env = process.env, now = () => new Date(), randomBytes = crypto.randomBytes, sessionTtlMs } = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('staff passkey auth db is required');
  function policy() { return passkeyPolicy(env); }
  async function audit(client, { eventType, subjectAdminId = null, requestFingerprintHash = null, reason = null, metadata = {} }) {
    await client.query(`INSERT INTO staff_auth_security_events
      (event_type, operator_admin_id, subject_admin_id, auth_method, reason, request_fingerprint_hash, metadata)
      VALUES ($1, $2, $2, 'passkey', $3, $4, $5::jsonb)`,
    [eventType, subjectAdminId, reason, requestFingerprintHash, JSON.stringify(metadata)]);
  }
  async function resolveAdmin(client, adminId, forUpdate = false) {
    const result = await client.query(`SELECT a.id, a.staff_id, a.display_name, a.role, a.business_role, a.calendar_scope,
      a.service_scope, a.permissions, a.active AS admin_active, s.status AS staff_status
      FROM staff_admin_accounts a LEFT JOIN staff s ON s.id = a.staff_id
      WHERE a.id = $1 LIMIT 1${forUpdate ? ' FOR UPDATE OF a' : ''}`, [Number(adminId)]);
    const admin = result.rows[0];
    if (!admin || admin.admin_active !== true || (admin.staff_id != null && admin.staff_status !== 'active')) return null;
    return admin;
  }
  async function resolveCredentialHint(client, credentialIdHint, forUpdate = false) {
    const credentialId = normalizeCredentialHint(credentialIdHint);
    if (!credentialId) return null;
    const result = await client.query(`SELECT c.id AS passkey_id, c.admin_id, c.credential_id, c.transports, c.revoked_at,
      a.display_name, a.staff_id, a.active AS admin_active, s.status AS staff_status
      FROM staff_auth_passkey_credentials c
      JOIN staff_admin_accounts a ON a.id = c.admin_id
      LEFT JOIN staff s ON s.id = a.staff_id
      WHERE c.credential_id = $1 AND c.revoked_at IS NULL
      LIMIT 1${forUpdate ? ' FOR UPDATE OF c, a' : ''}`, [credentialId]);
    const credential = result.rows[0];
    if (!credential || credential.admin_active !== true || (credential.staff_id != null && credential.staff_status !== 'active')) return null;
    return credential;
  }
  function unavailableCode() { const p = policy(); return p.enabled ? 'STAFF_PASSKEY_UNAVAILABLE' : 'STAFF_PASSKEY_DISABLED'; }
  async function listCredentials({ session } = {}) {
    const p = policy(); if (!p.operational) return { ok: false, code: unavailableCode() };
    const admin = await resolveAdmin(db, session?.adminId); if (!admin) return { ok: false, code: 'STAFF_AUTH_FORBIDDEN' };
    const result = await db.query(`SELECT id, transports, backed_up, created_at, last_used_at, revoked_at
      FROM staff_auth_passkey_credentials WHERE admin_id = $1 ORDER BY created_at DESC, id DESC`, [admin.id]);
    return { ok: true, credentials: result.rows.map((row) => ({ id: Number(row.id), transports: row.transports || [], backedUp: row.backed_up === true, createdAt: row.created_at, lastUsedAt: row.last_used_at, revokedAt: row.revoked_at })) };
  }
  async function knownPrincipal({ credentialIdHint } = {}) {
    const p = policy(); if (!p.operational) return { ok: false, code: unavailableCode() };
    const credential = await resolveCredentialHint(db, credentialIdHint);
    if (!credential) return { ok: false, code: 'STAFF_PASSKEY_KNOWN_PRINCIPAL_REQUIRED' };
    return {
      ok: true,
      adminId: Number(credential.admin_id),
      displayName: cleanDisplayName(credential.display_name),
      credentialId: credential.credential_id,
      transports: Array.isArray(credential.transports) ? credential.transports : [],
    };
  }
  async function beginRegistration({ session, mode = 'add', requestFingerprintHash = null } = {}) {
    const p = policy(); const current = now();
    if (!p.operational) return { ok: false, code: unavailableCode() };
    if (!strongRecentSession(session, current)) return { ok: false, code: 'STAFF_RECENT_STRONG_AUTH_REQUIRED' };
    const purpose = mode === 'replace' ? REPLACEMENT_REGISTRATION_PURPOSE : mode === 'add' ? REGISTRATION_PURPOSE : null;
    if (!purpose) return { ok: false, code: 'STAFF_PASSKEY_INVALID' };
    const client = typeof db.connect === 'function' ? await db.connect() : db;
    try {
      await client.query('BEGIN');
      const admin = await resolveAdmin(client, session.adminId, true);
      if (!admin) { await client.query('ROLLBACK'); return { ok: false, code: 'STAFF_AUTH_FORBIDDEN' }; }
      await client.query(`UPDATE staff_auth_webauthn_challenges SET consumed_at = $2
        WHERE session_id = $1 AND purpose IN ('registration', 'registration_replacement') AND consumed_at IS NULL`, [session.sessionId, current]);
      const existing = await client.query(`SELECT credential_id FROM staff_auth_passkey_credentials WHERE admin_id = $1 AND revoked_at IS NULL`, [admin.id]);
      const challenge = randomChallenge(randomBytes); const expiresAt = new Date(current.getTime() + CHALLENGE_TTL_MS);
      await client.query(`INSERT INTO staff_auth_webauthn_challenges
        (challenge_hash, purpose, admin_id, session_id, request_fingerprint_hash, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6)`, [sha256(challenge), purpose, admin.id, session.sessionId, requestFingerprintHash, expiresAt]);
      await client.query('COMMIT');
      return { ok: true, mode, options: { challenge, rp: { name: 'Shiloh', id: p.rpId }, user: { id: opaqueUserId(admin.id), name: `staff-${admin.id}`, displayName: cleanDisplayName(admin.display_name) }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -8 }, { type: 'public-key', alg: -257 }], timeout: CHALLENGE_TTL_MS, attestation: 'none', authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'discouraged', requireResidentKey: false, userVerification: 'required' }, excludeCredentials: existing.rows.map((row) => ({ type: 'public-key', id: row.credential_id })) }, expiresAt };
    } catch (error) { try { await client.query('ROLLBACK'); } catch (_) {} throw error; }
    finally { if (client !== db && typeof client.release === 'function') client.release(); }
  }
  async function finishRegistration({ session, response, requestFingerprintHash = null } = {}) {
    const p = policy(); const current = now();
    if (!p.operational) return { ok: false, code: unavailableCode() };
    if (!strongRecentSession(session, current)) return { ok: false, code: 'STAFF_RECENT_STRONG_AUTH_REQUIRED' };
    let cd; try { cd = clientData(response?.response?.clientDataJSON, 'webauthn.create', p.origin); } catch (_) { return { ok: false, code: 'STAFF_PASSKEY_INVALID' }; }
    const client = typeof db.connect === 'function' ? await db.connect() : db;
    try {
      await client.query('BEGIN');
      const admin = await resolveAdmin(client, session.adminId, true);
      if (!admin) { await client.query('ROLLBACK'); return { ok: false, code: 'STAFF_AUTH_FORBIDDEN' }; }
      const challengeResult = await client.query(`SELECT id, purpose, expires_at FROM staff_auth_webauthn_challenges
        WHERE challenge_hash = $1 AND purpose IN ('registration', 'registration_replacement') AND admin_id = $2 AND session_id = $3 AND consumed_at IS NULL LIMIT 1 FOR UPDATE`,
      [sha256(cd.parsed.challenge), admin.id, session.sessionId]);
      const challenge = challengeResult.rows[0];
      if (!challenge || new Date(challenge.expires_at).getTime() <= current.getTime()) { await client.query('ROLLBACK'); return { ok: false, code: 'STAFF_PASSKEY_INVALID' }; }
      await client.query(`UPDATE staff_auth_webauthn_challenges SET consumed_at = $2 WHERE id = $1`, [challenge.id, current]);
      let verified;
      try { verified = verifyRegistrationResponse(response, { expectedChallenge: cd.parsed.challenge, origin: p.origin, rpId: p.rpId }); }
      catch (_) { await audit(client, { eventType: 'passkey_registration_failed', subjectAdminId: admin.id, requestFingerprintHash, reason: 'invalid_registration' }); await client.query('COMMIT'); return { ok: false, code: 'STAFF_PASSKEY_INVALID' }; }
      const duplicate = await client.query(`SELECT id, admin_id FROM staff_auth_passkey_credentials WHERE credential_id = $1 LIMIT 1 FOR UPDATE`, [verified.credentialId]);
      if (duplicate.rows[0]) { await audit(client, { eventType: 'passkey_registration_failed', subjectAdminId: admin.id, requestFingerprintHash, reason: 'credential_exists' }); await client.query('COMMIT'); return { ok: false, code: 'STAFF_PASSKEY_INVALID' }; }
      const inserted = await client.query(`INSERT INTO staff_auth_passkey_credentials
        (admin_id, credential_id, public_key_spki, algorithm, sign_count, transports, backed_up)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING id`,
      [admin.id, verified.credentialId, verified.publicKeySpki, verified.algorithm, verified.signCount, JSON.stringify(verified.transports), verified.backedUp]);
      const replacement = challenge.purpose === REPLACEMENT_REGISTRATION_PURPOSE;
      let revokedCredentialCount = 0;
      let revokedSessionCount = 0;
      if (replacement) {
        const revokedCredentials = await client.query(`UPDATE staff_auth_passkey_credentials
          SET revoked_at = $3, revoked_by_admin_id = $1
          WHERE admin_id = $1 AND id <> $2 AND revoked_at IS NULL`, [admin.id, inserted.rows[0].id, current]);
        revokedCredentialCount = Number(revokedCredentials.rowCount || 0);
        const revokedSessions = await client.query(`UPDATE staff_browser_sessions
          SET revoked_at = $3, revoke_reason = 'device_replaced'
          WHERE admin_id = $1 AND id <> $2 AND revoked_at IS NULL`, [admin.id, session.sessionId, current]);
        revokedSessionCount = Number(revokedSessions.rowCount || 0);
      }
      await audit(client, { eventType: replacement ? 'passkey_device_replaced' : 'passkey_registered', subjectAdminId: admin.id, requestFingerprintHash, metadata: { credentialReference: `passkey:${inserted.rows[0].id}`, backedUp: verified.backedUp, priorCredentialsRevoked: revokedCredentialCount, priorSessionsRevoked: revokedSessionCount } });
      await client.query('COMMIT'); return { ok: true, mode: replacement ? 'replace' : 'add', credentialId: Number(inserted.rows[0].id), credentialHint: verified.credentialId, revokedCredentialCount, revokedSessionCount };
    } catch (error) { try { await client.query('ROLLBACK'); } catch (_) {} throw error; }
    finally { if (client !== db && typeof client.release === 'function') client.release(); }
  }
  async function beginAuthentication({ credentialIdHint = null, requestFingerprintHash = null } = {}) {
    const p = policy(); if (!p.operational) return { ok: false, code: unavailableCode() };
    const credential = await resolveCredentialHint(db, credentialIdHint);
    if (!credential) return { ok: false, code: 'STAFF_PASSKEY_KNOWN_PRINCIPAL_REQUIRED' };
    const current = now(); const challenge = randomChallenge(randomBytes); const expiresAt = new Date(current.getTime() + CHALLENGE_TTL_MS);
    await db.query(`INSERT INTO staff_auth_webauthn_challenges (challenge_hash, purpose, admin_id, request_fingerprint_hash, expires_at)
      VALUES ($1, 'authentication', $2, $3, $4)`, [sha256(challenge), credential.admin_id, requestFingerprintHash, expiresAt]);
    return { ok: true, options: { challenge, rpId: p.rpId, timeout: CHALLENGE_TTL_MS, userVerification: 'required', allowCredentials: [{ type: 'public-key', id: credential.credential_id, transports: Array.isArray(credential.transports) ? credential.transports : [] }] }, expiresAt, displayName: cleanDisplayName(credential.display_name) };
  }
  async function finishAuthentication({ response, requestFingerprintHash = null } = {}) {
    const p = policy(); const current = now();
    if (!p.operational) return { ok: false, code: unavailableCode() };
    let cd; let credentialId;
    try { cd = clientData(response?.response?.clientDataJSON, 'webauthn.get', p.origin); credentialId = b64url(fromB64url(response?.rawId || response?.id, 1024)); }
    catch (_) { return { ok: false, code: 'STAFF_PASSKEY_INVALID' }; }
    const client = typeof db.connect === 'function' ? await db.connect() : db;
    try {
      await client.query('BEGIN');
      const challengeResult = await client.query(`SELECT id, expires_at, admin_id FROM staff_auth_webauthn_challenges
        WHERE challenge_hash = $1 AND purpose = 'authentication' AND consumed_at IS NULL LIMIT 1 FOR UPDATE`, [sha256(cd.parsed.challenge)]);
      const challenge = challengeResult.rows[0];
      if (!challenge || new Date(challenge.expires_at).getTime() <= current.getTime()) { await client.query('ROLLBACK'); return { ok: false, code: 'STAFF_PASSKEY_INVALID' }; }
      await client.query(`UPDATE staff_auth_webauthn_challenges SET consumed_at = $2 WHERE id = $1`, [challenge.id, current]);
      const credentialResult = await client.query(`SELECT id, admin_id, credential_id, public_key_spki, algorithm, sign_count, revoked_at
        FROM staff_auth_passkey_credentials WHERE credential_id = $1 LIMIT 1 FOR UPDATE`, [credentialId]);
      const credential = credentialResult.rows[0];
      if (!credential || credential.revoked_at || Number(credential.admin_id) !== Number(challenge.admin_id)) { await audit(client, { eventType: 'passkey_authentication_failed', requestFingerprintHash, reason: 'unknown_revoked_or_unbound_credential' }); await client.query('COMMIT'); return { ok: false, code: 'STAFF_PASSKEY_INVALID' }; }
      const admin = await resolveAdmin(client, credential.admin_id, true);
      if (!admin) { await audit(client, { eventType: 'passkey_authentication_failed', subjectAdminId: credential.admin_id, requestFingerprintHash, reason: 'inactive_principal' }); await client.query('COMMIT'); return { ok: false, code: 'STAFF_PASSKEY_INVALID' }; }
      let verified;
      try { verified = verifyAssertionResponse(response, credential, { expectedChallenge: cd.parsed.challenge, origin: p.origin, rpId: p.rpId }); }
      catch (error) { await audit(client, { eventType: 'passkey_authentication_failed', subjectAdminId: admin.id, requestFingerprintHash, reason: String(error.message || 'invalid_assertion').slice(0, 120), metadata: { credentialReference: `passkey:${credential.id}` } }); await client.query('COMMIT'); return { ok: false, code: 'STAFF_PASSKEY_INVALID' }; }
      await client.query(`UPDATE staff_auth_passkey_credentials SET sign_count = $2, backed_up = $3, last_used_at = $4 WHERE id = $1`, [credential.id, verified.signCount, verified.backedUp, current]);
      const issued = await issueStaffBrowserSession({ client, admin, current, randomBytes, sessionTtlMs, requestFingerprintHash, authMethod: 'passkey', recoveryRequired: false });
      await audit(client, { eventType: 'passkey_authenticated', subjectAdminId: admin.id, requestFingerprintHash, metadata: { credentialReference: `passkey:${credential.id}` } });
      await client.query('COMMIT'); return { ...issued, credentialHint: credential.credential_id };
    } catch (error) { try { await client.query('ROLLBACK'); } catch (_) {} throw error; }
    finally { if (client !== db && typeof client.release === 'function') client.release(); }
  }
  async function revokeCredential({ session, credentialId, requestFingerprintHash = null } = {}) {
    const p = policy(); const current = now();
    if (!p.operational) return { ok: false, code: unavailableCode() };
    if (!strongRecentSession(session, current)) return { ok: false, code: 'STAFF_RECENT_STRONG_AUTH_REQUIRED' };
    const id = Number(credentialId); if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, code: 'STAFF_PASSKEY_NOT_FOUND' };
    const client = typeof db.connect === 'function' ? await db.connect() : db;
    try {
      await client.query('BEGIN'); const admin = await resolveAdmin(client, session.adminId, true);
      if (!admin) { await client.query('ROLLBACK'); return { ok: false, code: 'STAFF_AUTH_FORBIDDEN' }; }
      const result = await client.query(`UPDATE staff_auth_passkey_credentials SET revoked_at = $3, revoked_by_admin_id = $1
        WHERE id = $2 AND admin_id = $1 AND revoked_at IS NULL RETURNING id, credential_id`, [admin.id, id, current]);
      if (!result.rowCount) { await client.query('ROLLBACK'); return { ok: false, code: 'STAFF_PASSKEY_NOT_FOUND' }; }
      await audit(client, { eventType: 'passkey_revoked', subjectAdminId: admin.id, requestFingerprintHash, metadata: { credentialReference: `passkey:${id}` } });
      await client.query('COMMIT'); return { ok: true, credentialHint: result.rows[0].credential_id };
    } catch (error) { try { await client.query('ROLLBACK'); } catch (_) {} throw error; }
    finally { if (client !== db && typeof client.release === 'function') client.release(); }
  }
  return { policy, listCredentials, knownPrincipal, beginRegistration, finishRegistration, beginAuthentication, finishAuthentication, revokeCredential };
}

module.exports = {
  FEATURE_FLAG, RP_ID_FLAG, PUBLIC_ORIGIN_FLAG, CHALLENGE_TTL_MS, STRONG_AUTH_METHODS,
  REGISTRATION_PURPOSE, REPLACEMENT_REGISTRATION_PURPOSE,
  b64url, fromB64url, normalizeCredentialHint, passkeyPolicy, strongRecentSession, decodeCbor, cosePublicKeyToSpki,
  verifyRpAndFlags, verifyRegistrationResponse, verifyAssertionResponse, createStaffPasskeyAuthService,
};
