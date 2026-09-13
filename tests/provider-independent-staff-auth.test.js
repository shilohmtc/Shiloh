const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const express = require('express');
const OTPAuth = require('otpauth');

const auth = require('../src/services/providerIndependentStaffAuth');
const sessions = require('../src/services/staffBrowserSession');
const sessionMiddleware = require('../src/middleware/staffBrowserSession');
const requestContext = require('../src/middleware/requestContext');
const logger = require('../src/lib/logger');
const { createStaffBrowserSessionRouter } = require('../src/routes/staffBrowserSession');
const {
  renderProviderIndependentStaffAuthPage,
  providerIndependentStaffAuthClientScript,
} = require('../src/presentation/providerIndependentStaffAuthUx');
const {
  renderStaffCalendarAccessPage,
  staffCalendarAccessClientScript,
} = require('../src/presentation/staffCalendarAccessUx');

const FIXED_NOW = new Date('2026-08-25T12:00:00.000Z');

function deterministicRandom() {
  let value = 1;
  return (size) => {
    const result = Buffer.alloc(size, value);
    value = value === 254 ? 1 : value + 1;
    return result;
  };
}

function enabledEnv(ids = '1,2') {
  return {
    SHILOH_STAFF_TOTP_AUTH_ENABLED: 'true',
    SHILOH_STAFF_TOTP_PILOT_ADMIN_IDS: ids,
    SHILOH_STAFF_TOTP_ACTIVE_KEY_VERSION: 'v1',
    SHILOH_STAFF_TOTP_ENCRYPTION_KEYS_JSON: JSON.stringify({ v1: Buffer.alloc(32, 42).toString('base64url') }),
    SHILOH_CALENDAR_PUBLIC_ORIGIN: 'https://calendar.shiloh.example',
  };
}

function canonicalAdmin(overrides = {}) {
  return {
    id: 1,
    staff_id: null,
    display_name: 'Jean-Pierre',
    role: 'admin',
    business_role: 'business_admin',
    calendar_scope: 'all_business',
    service_scope: 'all_services',
    permissions: { 'staff_auth:reset': true, 'appointment:view': true },
    admin_active: true,
    staff_status: null,
    normalized_whatsapp: '27725128605',
    ...overrides,
  };
}

function activeCredential(adminId, secret, env = enabledEnv()) {
  const keyring = auth.parseEncryptionKeyring(env);
  const encrypted = auth.encryptTotpSecret(secret, adminId, keyring, () => Buffer.alloc(12, 8));
  return {
    admin_id: adminId,
    status: 'active',
    secret_ciphertext: encrypted.ciphertext,
    secret_nonce: encrypted.nonce,
    secret_auth_tag: encrypted.authTag,
    secret_key_version: encrypted.keyVersion,
    confirmed_at: FIXED_NOW,
    last_accepted_timestep: null,
    failure_window_started_at: null,
    failed_attempt_count: 0,
    locked_until: null,
    recovery_generation: 1,
    replacement_required_at: null,
  };
}

function memoryDb({
  admins = [canonicalAdmin()],
  credentials = [],
  recoveryCodes = [],
  sessions: seededSessions = [],
  forceTotpAdvanceMiss = false,
} = {}) {
  const state = {
    admins: new Map(admins.map((admin) => [Number(admin.id), { ...admin }])),
    credentials: new Map(credentials.map((credential) => [Number(credential.admin_id), { ...credential }])),
    recoveryCodes: recoveryCodes.map((item, index) => ({ id: index + 1, consumed_at: null, revoked_at: null, ...item })),
    rate: new Map(),
    sessions: seededSessions.map((item) => ({ ...item })),
    breakGlass: [],
    audits: [],
    calls: [],
    totpAdvanceTransitions: 0,
    recoveryConsumptionTransitions: 0,
    breakGlassConsumptionTransitions: 0,
  };
  let transactionTail = Promise.resolve();

  const client = {
    async query(sql, params = []) {
      const q = String(sql).replace(/\s+/g, ' ').trim();
      state.calls.push({ sql: q, params });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(q) || q.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
      if (q.includes('FROM staff_admin_accounts a')) {
        let rows;
        if (q.includes('a.normalized_whatsapp = $1')) rows = [...state.admins.values()].filter((item) => item.normalized_whatsapp === params[0]);
        else rows = [state.admins.get(Number(params[0]))].filter(Boolean);
        return { rows: rows.map((item) => ({ ...item })), rowCount: rows.length };
      }
      if (q.startsWith('SELECT * FROM staff_totp_credentials')) {
        const row = state.credentials.get(Number(params[0]));
        return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
      }
      if (q.startsWith('SELECT status, confirmed_at, replacement_required_at')) {
        const row = state.credentials.get(Number(params[0]));
        return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
      }
      if (q.startsWith('SELECT window_started_at')) {
        const row = state.rate.get(params[0]);
        return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
      }
      if (q.startsWith('INSERT INTO staff_auth_security_events')) {
        state.audits.push({ eventType: params[0], operatorAdminId: params[1], subjectAdminId: params[2], authMethod: params[3], reason: params[4], fingerprint: params[5], metadata: JSON.parse(params[6]) });
        return { rows: [], rowCount: 1 };
      }
      if (q.startsWith('UPDATE staff_totp_credentials SET last_accepted_timestep')) {
        if (forceTotpAdvanceMiss) return { rows: [], rowCount: 0 };
        const row = state.credentials.get(Number(params[0]));
        if (row && (row.last_accepted_timestep == null || Number(row.last_accepted_timestep) < Number(params[1]))) {
          row.last_accepted_timestep = Number(params[1]); row.updated_at = params[2]; state.totpAdvanceTransitions += 1; return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (q.startsWith('UPDATE staff_totp_credentials SET failure_window_started_at = NULL')) {
        Object.assign(state.credentials.get(Number(params[0])), { failure_window_started_at: null, failed_attempt_count: 0, locked_until: null, updated_at: params[1] });
        return { rows: [], rowCount: 1 };
      }
      if (q.startsWith('UPDATE staff_totp_credentials SET failure_window_started_at = $2')) {
        Object.assign(state.credentials.get(Number(params[0])), { failure_window_started_at: params[1], failed_attempt_count: params[2], locked_until: params[3], updated_at: params[4] });
        return { rows: [], rowCount: 1 };
      }
      if (q.startsWith('INSERT INTO staff_auth_rate_limits')) {
        state.rate.set(params[0], { window_started_at: params[1], failed_attempt_count: params[2], locked_until: params[3], updated_at: params[4] });
        return { rows: [], rowCount: 1 };
      }
      if (q.startsWith('DELETE FROM staff_auth_rate_limits')) {
        state.rate.delete(params[0]);
        return { rows: [], rowCount: 1 };
      }
      if (q.startsWith('SELECT id FROM staff_browser_sessions')) {
        const active = state.sessions.filter((item) => item.admin_id === Number(params[0]) && !item.revoked_at).at(-1);
        return { rows: active ? [{ id: active.id }] : [], rowCount: active ? 1 : 0 };
      }
      if (q.includes('FROM staff_browser_sessions bs')) {
        const session = state.sessions.find((item) => item.token_hash === params[0]);
        const admin = session ? state.admins.get(Number(session.admin_id)) : null;
        if (!session || !admin) return { rows: [], rowCount: 0 };
        return { rows: [{
          session_id: session.id,
          admin_id: session.admin_id,
          csrf_hash: session.csrf_hash,
          issued_at: session.issued_at,
          expires_at: session.expires_at,
          revoked_at: session.revoked_at,
          auth_method: session.auth_method,
          reauthenticated_at: session.issued_at,
          recovery_required: session.recovery_required,
          staff_id: admin.staff_id,
          role: admin.role,
          business_role: admin.business_role,
          calendar_scope: admin.calendar_scope,
          service_scope: admin.service_scope,
          permissions: admin.permissions,
          admin_active: admin.admin_active,
          staff_status: admin.staff_status,
        }], rowCount: 1 };
      }
      if (q.startsWith('UPDATE staff_browser_sessions SET last_used_at')) {
        const session = state.sessions.find((item) => item.id === Number(params[0]) && !item.revoked_at);
        if (session) session.last_used_at = params[1];
        return { rows: [], rowCount: session ? 1 : 0 };
      }
      if (q.startsWith('UPDATE staff_browser_sessions SET csrf_hash')) {
        const session = state.sessions.find((item) => item.id === Number(params[0]) && !item.revoked_at && new Date(item.expires_at).getTime() > new Date(params[2]).getTime());
        if (session) {
          session.csrf_hash = params[1];
          session.last_used_at = params[2];
        }
        return { rows: session ? [{ id: session.id }] : [], rowCount: session ? 1 : 0 };
      }
      if (q.startsWith('UPDATE staff_browser_sessions SET revoked_at = $2') || q.startsWith('UPDATE staff_browser_sessions SET revoked_at = COALESCE')) {
        let count = 0;
        for (const item of state.sessions) if (item.admin_id === Number(params[0]) && !item.revoked_at) { item.revoked_at = params[1]; item.revoke_reason = q.includes('credential_reset') ? 'credential_reset' : q.includes('break_glass') ? 'break_glass' : 'rotated'; count += 1; }
        return { rows: [], rowCount: count };
      }
      if (q.startsWith('INSERT INTO staff_browser_sessions')) {
        const item = { id: state.sessions.length + 1, admin_id: Number(params[0]), token_hash: params[1], csrf_hash: params[2], issued_at: params[3], expires_at: params[4], rotated_from_session_id: params[5], auth_method: params[7], recovery_required: params[8], revoked_at: null };
        state.sessions.push(item);
        return { rows: [{ id: item.id }], rowCount: 1 };
      }
      if (q.startsWith('INSERT INTO staff_totp_credentials')) {
        const existing = state.credentials.get(Number(params[0])) || { admin_id: Number(params[0]), status: 'pending', recovery_generation: 0, failed_attempt_count: 0 };
        Object.assign(existing, { pending_secret_ciphertext: params[1], pending_secret_nonce: params[2], pending_secret_auth_tag: params[3], pending_secret_key_version: params[4], enrollment_started_at: params[5], enrollment_expires_at: params[6], status: existing.status === 'active' ? 'active' : 'pending' });
        state.credentials.set(Number(params[0]), existing);
        return { rows: [], rowCount: 1 };
      }
      if (q.startsWith('UPDATE staff_auth_recovery_codes SET revoked_at')) {
        let count = 0;
        for (const item of state.recoveryCodes) if (item.admin_id === Number(params[0]) && !item.consumed_at && !item.revoked_at) { item.revoked_at = params[1]; count += 1; }
        return { rows: [], rowCount: count };
      }
      if (q.startsWith('INSERT INTO staff_auth_recovery_codes')) {
        state.recoveryCodes.push({ id: state.recoveryCodes.length + 1, admin_id: Number(params[0]), generation: Number(params[1]), code_hash: params[2], created_at: params[3], consumed_at: null, revoked_at: null });
        return { rows: [], rowCount: 1 };
      }
      if (q.startsWith('UPDATE staff_totp_credentials SET status = \'active\'')) {
        const row = state.credentials.get(Number(params[0]));
        Object.assign(row, { status: 'active', secret_ciphertext: row.pending_secret_ciphertext, secret_nonce: row.pending_secret_nonce, secret_auth_tag: row.pending_secret_auth_tag, secret_key_version: row.pending_secret_key_version, pending_secret_ciphertext: null, pending_secret_nonce: null, pending_secret_auth_tag: null, pending_secret_key_version: null, enrollment_started_at: null, enrollment_expires_at: null, confirmed_at: params[1], last_accepted_timestep: Number(params[2]), recovery_generation: Number(params[3]), replacement_required_at: null, failed_attempt_count: 0, locked_until: null });
        return { rows: [], rowCount: 1 };
      }
      if (q.startsWith('UPDATE staff_browser_sessions SET recovery_required = FALSE')) return { rows: [], rowCount: 1 };
      if (q.startsWith('SELECT id, code_hash FROM staff_auth_recovery_codes')) {
        const rows = state.recoveryCodes.filter((item) => item.admin_id === Number(params[0]) && item.generation === Number(params[1]) && !item.consumed_at && !item.revoked_at);
        return { rows: rows.map((item) => ({ id: item.id, code_hash: item.code_hash })), rowCount: rows.length };
      }
      if (q.startsWith('UPDATE staff_auth_recovery_codes SET consumed_at')) {
        const row = state.recoveryCodes.find((item) => item.id === Number(params[0]) && !item.consumed_at && !item.revoked_at);
        if (!row) return { rows: [], rowCount: 0 };
        row.consumed_at = params[1]; state.recoveryConsumptionTransitions += 1; return { rows: [{ id: row.id }], rowCount: 1 };
      }
      if (q.startsWith('UPDATE staff_totp_credentials SET replacement_required_at')) {
        const row = state.credentials.get(Number(params[0])); row.replacement_required_at = row.replacement_required_at || params[1]; return { rows: [], rowCount: 1 };
      }
      if (q.startsWith('UPDATE staff_auth_break_glass_bootstraps SET revoked_at')) {
        let count = 0;
        for (const item of state.breakGlass) if (item.admin_id === Number(params[0]) && !item.consumed_at && !item.revoked_at) { item.revoked_at = params[1]; count += 1; }
        return { rows: [], rowCount: count };
      }
      if (q.startsWith('INSERT INTO staff_auth_break_glass_bootstraps')) {
        state.breakGlass.push({ id: state.breakGlass.length + 1, admin_id: Number(params[0]), token_hash: params[1], issued_at: params[2], expires_at: params[3], operator_reference: params[4], control_reference: params[5], consumed_at: null, revoked_at: null });
        return { rows: [], rowCount: 1 };
      }
      if (q.startsWith('SELECT id, admin_id, expires_at, consumed_at, revoked_at, operator_reference, control_reference FROM staff_auth_break_glass_bootstraps')) {
        const row = state.breakGlass.find((item) => item.token_hash === params[0]);
        return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
      }
      if (q.startsWith('UPDATE staff_auth_break_glass_bootstraps SET consumed_at')) {
        const row = state.breakGlass.find((item) => item.id === Number(params[0]) && !item.consumed_at && !item.revoked_at);
        if (!row) return { rows: [], rowCount: 0 };
        row.consumed_at = params[1]; state.breakGlassConsumptionTransitions += 1; return { rows: [], rowCount: 1 };
      }
      if (q.startsWith('UPDATE staff_totp_credentials SET recovery_generation')) {
        const row = state.credentials.get(Number(params[0])); row.recovery_generation = Number(params[1]); return { rows: [], rowCount: 1 };
      }
      if (q.startsWith('UPDATE staff_totp_credentials SET status = \'disabled\'')) {
        const row = state.credentials.get(Number(params[0]));
        if (row) Object.assign(row, { status: 'disabled', secret_ciphertext: null, secret_nonce: null, secret_auth_tag: null, secret_key_version: null, replacement_required_at: params[1], disabled_at: params[1], disabled_reason: params[2] });
        return { rows: [], rowCount: row ? 1 : 0 };
      }
      throw new Error(`Unhandled test SQL: ${q}`);
    },
    release() {},
  };

  function transactionClient() {
    let releaseTransaction = null;
    return {
      async query(sql, params = []) {
        const q = String(sql).replace(/\s+/g, ' ').trim();
        if (q === 'BEGIN') {
          const previous = transactionTail;
          let unlock;
          transactionTail = new Promise((resolve) => { unlock = resolve; });
          await previous;
          releaseTransaction = unlock;
        }
        try {
          return await client.query(sql, params);
        } finally {
          if ((q === 'COMMIT' || q === 'ROLLBACK') && releaseTransaction) {
            const unlock = releaseTransaction;
            releaseTransaction = null;
            unlock();
          }
        }
      },
      release() {
        if (releaseTransaction) {
          const unlock = releaseTransaction;
          releaseTransaction = null;
          unlock();
        }
      },
    };
  }

  return {
    ...state,
    get totpAdvanceTransitions() { return state.totpAdvanceTransitions; },
    get recoveryConsumptionTransitions() { return state.recoveryConsumptionTransitions; },
    get breakGlassConsumptionTransitions() { return state.breakGlassConsumptionTransitions; },
    query: client.query.bind(client),
    async connect() { return transactionClient(); },
  };
}

async function withHttpServer(app, run) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

async function reserveTcpPort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function pollValue(load, predicate, { timeoutMs = 15_000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await load();
      if (predicate(value)) return value;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  if (lastError) throw lastError;
  throw new Error('Timed out waiting for browser state');
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      clearTimeout(waiter.timeout);
      if (message.error) waiter.reject(new Error(`${message.error.code}: ${message.error.message}`));
      else waiter.resolve(message.result || {});
      return;
    }
    for (const listener of listeners.get(message.method) || []) listener(message.params || {});
  });
  function rejectPending(error) {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    pending.clear();
  }
  socket.addEventListener('close', () => rejectPending(new Error('Chrome DevTools connection closed')));
  socket.addEventListener('error', () => rejectPending(new Error('Chrome DevTools connection failed')));
  return {
    send(method, params = {}, timeoutMs = 15_000) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Chrome DevTools command timed out: ${method}`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timeout });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, listener) {
      if (!listeners.has(method)) listeners.set(method, []);
      listeners.get(method).push(listener);
    },
    close() { socket.close(); },
  };
}

async function evaluateInBrowser(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed');
  return result.result?.value;
}

function createTestCertificate(directory) {
  const keyPath = path.join(directory, 'key.pem');
  const certPath = path.join(directory, 'cert.pem');
  const generated = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', certPath,
    '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
    '-days', '1',
  ], { encoding: 'utf8' });
  if (generated.status !== 0) throw new Error(`OpenSSL test certificate failed: ${generated.stderr}`);
  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

test('feature control and incomplete configuration fail closed by default', () => {
  assert.equal(auth.providerIndependentAuthPolicy({}).enabled, false);
  assert.equal(auth.providerIndependentAuthPolicy({ SHILOH_STAFF_TOTP_AUTH_ENABLED: 'true' }).operational, false);
  assert.equal(auth.providerIndependentAuthPolicy(enabledEnv()).operational, true);
});

test('generated staff-auth management client is syntactically valid JavaScript', () => {
  assert.doesNotThrow(() => new Function(providerIndependentStaffAuthClientScript()));
});

test('TOTP secret is 160-bit and AES-256-GCM storage is versioned, authenticated, and not plaintext', () => {
  const env = enabledEnv();
  const keyring = auth.parseEncryptionKeyring(env);
  const secret = new OTPAuth.Secret({ buffer: Buffer.alloc(auth.TOTP_SECRET_BYTES, 7) }).base32;
  const encrypted = auth.encryptTotpSecret(secret, 1, keyring, () => Buffer.alloc(12, 9));
  assert.equal(auth.TOTP_SECRET_BYTES, 20);
  assert.equal(encrypted.keyVersion, 'v1');
  assert.notEqual(encrypted.ciphertext, secret);
  assert.equal(auth.decryptTotpSecret({ ciphertext: encrypted.ciphertext, nonce: encrypted.nonce, authTag: encrypted.authTag, keyVersion: encrypted.keyVersion }, 1, keyring), secret);
  assert.throws(() => auth.decryptTotpSecret({ ciphertext: encrypted.ciphertext, nonce: encrypted.nonce, authTag: encrypted.authTag, keyVersion: encrypted.keyVersion }, 2, keyring), /DECRYPTION_FAILED/);
});

test('valid RFC 6238 SHA-1 six-digit TOTP creates the existing opaque session with canonical authorization', async () => {
  const env = enabledEnv();
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const db = memoryDb({ credentials: [activeCredential(1, secret, env)], sessions: [{ id: 1, admin_id: 1, revoked_at: null }] });
  const service = auth.createProviderIndependentStaffAuthService({ db, env, now: () => FIXED_NOW, randomBytes: deterministicRandom() });
  const code = auth.createTotp(secret).generate({ timestamp: FIXED_NOW.getTime() });
  const result = await service.verifyTotp({ identifier: '+27 72 512 8605', code, requestFingerprintHash: 'a'.repeat(64) });
  assert.equal(result.ok, true);
  assert.deepEqual(result.viewer, { calendarScope: 'business_all_staff' });
  assert.match(result.sessionToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(db.sessions[0].revoke_reason, 'rotated');
  assert.equal(db.sessions[1].token_hash, sessions.sha256(result.sessionToken));
  assert.equal(db.sessions[1].rotated_from_session_id, 1);
  assert.equal(db.sessions[1].auth_method, 'totp');
  assert.equal(db.audits.some((event) => event.eventType === 'totp_verification_succeeded'), true);
});

test('retired browser-pilot variables cannot reject valid TOTP authentication', async () => {
  const env = {
    ...enabledEnv('1'),
    SHILOH_STAFF_BROWSER_PILOT_MODE_ENABLED: 'true',
    SHILOH_STAFF_BROWSER_PILOT_ADMIN_IDS: '999',
  };
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const db = memoryDb({ credentials: [activeCredential(1, secret, env)] });
  const service = auth.createProviderIndependentStaffAuthService({ db, env, now: () => FIXED_NOW, randomBytes: deterministicRandom() });
  const code = auth.createTotp(secret).generate({ timestamp: FIXED_NOW.getTime() });

  const result = await service.verifyTotp({ identifier: '27725128605', code, requestFingerprintHash: 'a'.repeat(64) });

  assert.equal(result.ok, true);
  assert.equal(db.totpAdvanceTransitions, 1);
  assert.equal(db.sessions.length, 1);
  assert.equal(db.audits.some((event) => event.eventType === 'pilot_authority_mismatch'), false);
});

test('invalid and malformed TOTP fail closed without session creation', async () => {
  const env = enabledEnv();
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  for (const code of ['000000', '12345x']) {
    const db = memoryDb({ credentials: [activeCredential(1, secret, env)] });
    const service = auth.createProviderIndependentStaffAuthService({ db, env, now: () => FIXED_NOW });
    const result = await service.verifyTotp({ identifier: '27725128605', code, requestFingerprintHash: 'b'.repeat(64) });
    assert.equal(result.ok, false);
    assert.equal(db.sessions.length, 0);
  }
});

test('missing or corrupt encrypted authenticator state fails closed with sanitized audit evidence', async () => {
  const env = enabledEnv();
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const credential = activeCredential(1, secret, env);
  credential.secret_auth_tag = Buffer.alloc(16, 99).toString('base64url');
  const db = memoryDb({ credentials: [credential] });
  const service = auth.createProviderIndependentStaffAuthService({ db, env, now: () => FIXED_NOW });
  const result = await service.verifyTotp({ identifier: '27725128605', code: '123456', requestFingerprintHash: '1'.repeat(64) });
  assert.equal(result.code, 'STAFF_TOTP_UNAVAILABLE');
  assert.equal(db.sessions.length, 0);
  const event = db.audits.find((item) => item.eventType === 'totp_secret_unavailable');
  assert.ok(event);
  assert.equal(JSON.stringify(event).includes(secret), false);
});

test('bounded clock skew accepts previous timestep but rejects an older timestep', () => {
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const totp = auth.createTotp(secret);
  const previous = totp.generate({ timestamp: FIXED_NOW.getTime() - 30_000 });
  const old = totp.generate({ timestamp: FIXED_NOW.getTime() - 60_000 });
  assert.notEqual(auth.validateTotp(secret, previous, FIXED_NOW.getTime()), null);
  assert.equal(auth.validateTotp(secret, old, FIXED_NOW.getTime()), null);
});

test('same-timestep replay is rejected after the first atomic acceptance', async () => {
  const env = enabledEnv();
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const db = memoryDb({ credentials: [activeCredential(1, secret, env)] });
  const service = auth.createProviderIndependentStaffAuthService({ db, env, now: () => FIXED_NOW, randomBytes: deterministicRandom() });
  const code = auth.createTotp(secret).generate({ timestamp: FIXED_NOW.getTime() });
  assert.equal((await service.verifyTotp({ identifier: '27725128605', code })).ok, true);
  const replay = await service.verifyTotp({ identifier: '27725128605', code });
  assert.equal(replay.ok, false);
  assert.equal(db.audits.some((event) => event.eventType === 'totp_replay_rejected'), true);
});

test('concurrent TOTP replay permits one authentication and advances the timestep exactly once', async () => {
  const env = enabledEnv();
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const db = memoryDb({ credentials: [activeCredential(1, secret, env)] });
  const service = auth.createProviderIndependentStaffAuthService({ db, env, now: () => FIXED_NOW, randomBytes: deterministicRandom() });
  const code = auth.createTotp(secret).generate({ timestamp: FIXED_NOW.getTime() });

  const results = await Promise.all([
    service.verifyTotp({ identifier: '27725128605', code, requestFingerprintHash: '1'.repeat(64) }),
    service.verifyTotp({ identifier: '27725128605', code, requestFingerprintHash: '2'.repeat(64) }),
  ]);

  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok && result.code === 'STAFF_AUTH_INVALID').length, 1);
  assert.equal(db.sessions.length, 1);
  assert.equal(db.totpAdvanceTransitions, 1);
  assert.equal(db.credentials.get(1).last_accepted_timestep, Math.floor(FIXED_NOW.getTime() / 1000 / auth.TOTP_PERIOD_SECONDS));
  assert.equal(db.audits.filter((event) => event.eventType === 'totp_replay_rejected').length, 1);
});

test('a lost TOTP compare-and-update fails closed, audits replay, and cannot issue a session', async () => {
  const env = enabledEnv();
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const db = memoryDb({ credentials: [activeCredential(1, secret, env)], forceTotpAdvanceMiss: true });
  const service = auth.createProviderIndependentStaffAuthService({ db, env, now: () => FIXED_NOW, randomBytes: deterministicRandom() });
  const code = auth.createTotp(secret).generate({ timestamp: FIXED_NOW.getTime() });

  const result = await service.verifyTotp({ identifier: '27725128605', code, requestFingerprintHash: '3'.repeat(64) });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'STAFF_AUTH_INVALID');
  assert.equal(db.sessions.length, 0);
  assert.equal(db.totpAdvanceTransitions, 0);
  assert.equal(db.audits.filter((event) => event.eventType === 'totp_replay_rejected').length, 1);
});

test('per-account and per-source failures escalate into temporary lockout', async () => {
  const env = enabledEnv();
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const db = memoryDb({ credentials: [activeCredential(1, secret, env)] });
  const service = auth.createProviderIndependentStaffAuthService({ db, env, now: () => FIXED_NOW });
  let result;
  for (let attempt = 0; attempt < 3; attempt += 1) result = await service.verifyTotp({ identifier: '27725128605', code: '000000', requestFingerprintHash: 'c'.repeat(64) });
  assert.equal(result.code, 'STAFF_AUTH_RATE_LIMITED');
  assert.ok(new Date(db.rate.get('c'.repeat(64)).locked_until).getTime() > FIXED_NOW.getTime());
  assert.equal(db.audits.some((event) => event.eventType === 'authentication_rate_limited'), true);
});

test('per-account lockout is independent of source throttling and expires after the bounded lock', async () => {
  const env = enabledEnv();
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const db = memoryDb({ credentials: [activeCredential(1, secret, env)] });
  let current = new Date(FIXED_NOW);
  const service = auth.createProviderIndependentStaffAuthService({
    db,
    env,
    now: () => new Date(current),
    randomBytes: deterministicRandom(),
  });
  const fingerprint = (value) => value.toString(16).padStart(64, '0');
  const invalidCode = () => {
    const valid = auth.createTotp(secret).generate({ timestamp: current.getTime() });
    return valid === '000000' ? '000001' : '000000';
  };

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await service.verifyTotp({ identifier: '27725128605', code: invalidCode(), requestFingerprintHash: fingerprint(attempt) });
  }
  current = new Date(current.getTime() + 5_001);
  await service.verifyTotp({ identifier: '27725128605', code: invalidCode(), requestFingerprintHash: fingerprint(7) });
  current = new Date(current.getTime() + 30_001);
  await service.verifyTotp({ identifier: '27725128605', code: invalidCode(), requestFingerprintHash: fingerprint(8) });

  const credential = db.credentials.get(1);
  assert.equal(credential.failed_attempt_count, auth.ACCOUNT_FAILURE_LIMIT);
  assert.equal(new Date(credential.locked_until).getTime(), current.getTime() + auth.LOCKOUT_MS);
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    assert.equal(db.rate.get(fingerprint(attempt)).failed_attempt_count, 1);
    assert.equal(db.rate.get(fingerprint(attempt)).locked_until, null);
  }

  const lockedCode = auth.createTotp(secret).generate({ timestamp: current.getTime() });
  const locked = await service.verifyTotp({ identifier: '27725128605', code: lockedCode, requestFingerprintHash: fingerprint(9) });
  assert.equal(locked.code, 'STAFF_AUTH_RATE_LIMITED');
  assert.equal(db.sessions.length, 0);

  current = new Date(current.getTime() + auth.LOCKOUT_MS + 1);
  const unlockedCode = auth.createTotp(secret).generate({ timestamp: current.getTime() });
  const unlocked = await service.verifyTotp({ identifier: '27725128605', code: unlockedCode, requestFingerprintHash: fingerprint(10) });
  assert.equal(unlocked.ok, true);
  assert.equal(db.sessions.length, 1);
});

test('source throttling also covers unknown account guesses without revealing identity state', async () => {
  const env = enabledEnv();
  const db = memoryDb({ admins: [], credentials: [] });
  const service = auth.createProviderIndependentStaffAuthService({ db, env, now: () => FIXED_NOW });
  const fingerprint = '9'.repeat(64);
  let result;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    result = await service.verifyTotp({ identifier: '27829999999', code: '000000', requestFingerprintHash: fingerprint });
  }
  assert.equal(result.code, 'STAFF_AUTH_RATE_LIMITED');
  assert.equal(db.audits.every((event) => event.subjectAdminId == null), true);
});

test('inactive linked staff and inactive Admin identities cannot authenticate', async () => {
  const env = enabledEnv();
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  for (const admin of [canonicalAdmin({ staff_id: 4, staff_status: 'inactive' }), canonicalAdmin({ admin_active: false })]) {
    const db = memoryDb({ admins: [admin], credentials: [activeCredential(1, secret, env)] });
    const service = auth.createProviderIndependentStaffAuthService({ db, env, now: () => FIXED_NOW });
    const code = auth.createTotp(secret).generate({ timestamp: FIXED_NOW.getTime() });
    assert.equal((await service.verifyTotp({ identifier: '27725128605', code })).ok, false);
    assert.equal(db.sessions.length, 0);
  }
});

test('enrollment returns QR/manual material once, requires possession proof, and issues ten 128-bit recovery codes', async () => {
  const env = enabledEnv();
  const db = memoryDb();
  const randomBytes = deterministicRandom();
  const service = auth.createProviderIndependentStaffAuthService({ db, env, now: () => FIXED_NOW, randomBytes, qrToDataURL: async (uri) => `data:image/png;base64,${Buffer.from(uri).toString('base64')}` });
  const session = { ok: true, adminId: 1, sessionId: 99, authenticatedAt: FIXED_NOW, recoveryRequired: false };
  const started = await service.startEnrollment({ session, requestFingerprintHash: 'd'.repeat(64) });
  assert.equal(started.ok, true);
  assert.match(started.qrDataUrl, /^data:image\/png;base64,/);
  const secret = started.manualKey.replace(/\s/g, '');
  const code = auth.createTotp(secret).generate({ timestamp: FIXED_NOW.getTime() });
  const confirmed = await service.confirmEnrollment({ session, code, requestFingerprintHash: 'd'.repeat(64) });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.recoveryCodes.length, 10);
  assert.equal(new Set(confirmed.recoveryCodes).size, 10);
  assert.ok(confirmed.recoveryCodes.every((item) => item.replace(/-/g, '').length === 32));
  assert.equal(db.credentials.get(1).pending_secret_ciphertext, null);
  assert.equal(db.recoveryCodes.some((item) => confirmed.recoveryCodes.includes(item.code_hash)), false);
});

test('recovery code is atomically single-use and its session cannot authorize Calendar until replacement', async () => {
  const env = enabledEnv();
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const code = 'ABCD'.repeat(8);
  const db = memoryDb({ credentials: [activeCredential(1, secret, env)], recoveryCodes: [{ admin_id: 1, generation: 1, code_hash: await auth.hashRecoveryCode(code, () => Buffer.alloc(16, 4)) }] });
  const service = auth.createProviderIndependentStaffAuthService({ db, env, now: () => FIXED_NOW, randomBytes: deterministicRandom() });
  const first = await service.verifyRecovery({ identifier: '27725128605', recoveryCode: code, requestFingerprintHash: 'e'.repeat(64) });
  assert.equal(first.ok, true);
  assert.equal(first.recoveryRequired, true);
  assert.equal(first.viewer, null);
  assert.equal(db.recoveryCodes[0].consumed_at != null, true);
  const replay = await service.verifyRecovery({ identifier: '27725128605', recoveryCode: code, requestFingerprintHash: 'e'.repeat(64) });
  assert.equal(replay.ok, false);
});

test('retired browser-pilot variables cannot reject valid single-use recovery authentication', async () => {
  const env = {
    ...enabledEnv('1'),
    SHILOH_STAFF_BROWSER_PILOT_MODE_ENABLED: 'true',
    SHILOH_STAFF_BROWSER_PILOT_ADMIN_IDS: '999',
  };
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const code = 'FACE'.repeat(8);
  const db = memoryDb({
    credentials: [activeCredential(1, secret, env)],
    recoveryCodes: [{ admin_id: 1, generation: 1, code_hash: await auth.hashRecoveryCode(code, () => Buffer.alloc(16, 6)) }],
  });
  const service = auth.createProviderIndependentStaffAuthService({ db, env, now: () => FIXED_NOW, randomBytes: deterministicRandom() });

  const result = await service.verifyRecovery({ identifier: '27725128605', recoveryCode: code, requestFingerprintHash: 'b'.repeat(64) });

  assert.equal(result.ok, true);
  assert.equal(result.recoveryRequired, true);
  assert.equal(db.recoveryCodes[0].consumed_at != null, true);
  assert.equal(db.recoveryConsumptionTransitions, 1);
  assert.equal(db.sessions.length, 1);
  assert.equal(db.audits.some((event) => event.eventType === 'pilot_authority_mismatch'), false);
});

test('concurrent recovery-code use consumes once, issues one recovery session, and rejects every replay', async () => {
  const env = enabledEnv();
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const code = 'DCBA'.repeat(8);
  const db = memoryDb({
    credentials: [activeCredential(1, secret, env)],
    recoveryCodes: [{ admin_id: 1, generation: 1, code_hash: await auth.hashRecoveryCode(code, () => Buffer.alloc(16, 5)) }],
  });
  const service = auth.createProviderIndependentStaffAuthService({ db, env, now: () => FIXED_NOW, randomBytes: deterministicRandom() });

  const results = await Promise.all([
    service.verifyRecovery({ identifier: '27725128605', recoveryCode: code, requestFingerprintHash: '4'.repeat(64) }),
    service.verifyRecovery({ identifier: '27725128605', recoveryCode: code, requestFingerprintHash: '5'.repeat(64) }),
  ]);

  const accepted = results.filter((result) => result.ok);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].recoveryRequired, true);
  assert.equal(accepted[0].viewer, null);
  assert.equal(results.filter((result) => !result.ok && result.code === 'STAFF_AUTH_INVALID').length, 1);
  assert.equal(db.recoveryConsumptionTransitions, 1);
  assert.equal(db.recoveryCodes[0].consumed_at != null, true);
  assert.equal(db.sessions.length, 1);
  assert.equal(db.sessions[0].recovery_required, true);

  const replay = await service.verifyRecovery({ identifier: '27725128605', recoveryCode: code, requestFingerprintHash: '6'.repeat(64) });
  assert.equal(replay.ok, false);
  assert.equal(replay.code, 'STAFF_AUTH_INVALID');
  assert.equal(db.recoveryConsumptionTransitions, 1);
  assert.equal(db.sessions.length, 1);
});

test('recovery-required session is accepted only by credential-management middleware, not Calendar authorization', async () => {
  const service = { async validateSessionToken() { return { ok: true, recoveryRequired: true, adminId: 1, viewer: null }; } };
  const req = { headers: {}, get() {}, id: 'request' };
  const res = { statusCode: null, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  let nextCalls = 0;
  await sessionMiddleware.requireStaffSession({ service })(req, res, () => { nextCalls += 1; });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalls, 0);
  await sessionMiddleware.requireStaffSession({ service, allowRecoveryRequired: true })(req, res, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
});

test('recovery-code regeneration revokes every prior unused code before activating ten replacements', async () => {
  const env = enabledEnv();
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const old = { admin_id: 1, generation: 1, code_hash: await auth.hashRecoveryCode('1234'.repeat(8), () => Buffer.alloc(16, 3)) };
  const db = memoryDb({ credentials: [activeCredential(1, secret, env)], recoveryCodes: [old] });
  const service = auth.createProviderIndependentStaffAuthService({ db, env, now: () => FIXED_NOW, randomBytes: deterministicRandom() });
  const result = await service.regenerateRecoveryCodes({ session: { ok: true, adminId: 1, sessionId: 5, authenticatedAt: FIXED_NOW, recoveryRequired: false } });
  assert.equal(result.ok, true);
  assert.equal(result.recoveryCodes.length, 10);
  assert.equal(db.recoveryCodes[0].revoked_at != null, true);
  assert.equal(db.credentials.get(1).recovery_generation, 2);
});

test('privileged reset is capability-bound, revokes the subject, and prohibits self-reset', async () => {
  const env = enabledEnv();
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const subject = canonicalAdmin({ id: 2, normalized_whatsapp: '27820000000', display_name: 'Christel', staff_id: 4, staff_status: 'active', permissions: {} });
  const db = memoryDb({ admins: [canonicalAdmin(), subject], credentials: [activeCredential(2, secret, env)], sessions: [{ id: 1, admin_id: 2, revoked_at: null }] });
  const service = auth.createProviderIndependentStaffAuthService({ db, env, now: () => FIXED_NOW });
  const session = { ok: true, adminId: 1, sessionId: 9, authenticatedAt: FIXED_NOW, recoveryRequired: false };
  assert.equal((await service.privilegedReset({ session, subjectAdminId: 1, reason: 'lost device' })).code, 'STAFF_RESET_FORBIDDEN');
  const noPermissionDb = memoryDb({ admins: [canonicalAdmin({ permissions: {} }), subject], credentials: [activeCredential(2, secret, env)] });
  const noPermissionService = auth.createProviderIndependentStaffAuthService({ db: noPermissionDb, env, now: () => FIXED_NOW });
  assert.equal((await noPermissionService.privilegedReset({ session, subjectAdminId: 2, reason: 'lost device' })).code, 'STAFF_RESET_FORBIDDEN');
  const reset = await service.privilegedReset({ session, subjectAdminId: 2, reason: 'lost device', requestFingerprintHash: 'f'.repeat(64) });
  assert.equal(reset.ok, true);
  assert.equal(db.credentials.get(2).status, 'disabled');
  assert.equal(db.sessions[0].revoke_reason, 'credential_reset');
  assert.equal(db.audits.some((event) => event.eventType === 'credential_reset' && event.operatorAdminId === 1 && event.subjectAdminId === 2), true);
});

test('JP total-factor-loss path exists only as controlled 00+40 one-time break glass, not privileged self-reset', () => {
  const serviceSource = fs.readFileSync(path.join(__dirname, '..', 'src/services/providerIndependentStaffAuth.js'), 'utf8');
  const issueScript = fs.readFileSync(path.join(__dirname, '..', 'scripts/issue-staff-auth-break-glass.js'), 'utf8');
  assert.match(serviceSource, /subjectId === Number\(session\.adminId\)/);
  assert.match(issueScript, /--operator/);
  assert.match(issueScript, /--control-reference/);
  assert.match(serviceSource, /token_hash/);
  assert.match(serviceSource, /recoveryRequired: true/);
});

test('controlled break-glass handoff is hash-at-rest, short-lived, single-use, and recovery-only', async () => {
  const env = enabledEnv();
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const db = memoryDb({ credentials: [activeCredential(1, secret, env)], sessions: [{ id: 1, admin_id: 1, revoked_at: null }] });
  const service = auth.createProviderIndependentStaffAuthService({ db, env, now: () => FIXED_NOW, randomBytes: deterministicRandom() });
  const issued = await service.issueBreakGlass({ adminId: 1, operatorReference: '40:JP', controlReference: '00:WS-10-recovery' });
  assert.equal(issued.ok, true);
  assert.equal(new Date(issued.expiresAt).getTime() - FIXED_NOW.getTime(), auth.BREAK_GLASS_TTL_MS);
  assert.equal(db.breakGlass[0].token_hash, sessions.sha256(issued.token));
  assert.notEqual(db.breakGlass[0].token_hash, issued.token);
  const exchanged = await service.exchangeBreakGlass({ token: issued.token, requestFingerprintHash: '7'.repeat(64) });
  assert.equal(exchanged.ok, true);
  assert.equal(exchanged.recoveryRequired, true);
  assert.equal(exchanged.viewer, null);
  assert.equal((await service.exchangeBreakGlass({ token: issued.token })).ok, false);
});

test('retired browser-pilot variables cannot deny controlled break-glass issuance or exchange', async () => {
  const env = {
    ...enabledEnv('1'),
    NODE_ENV: 'production',
    SHILOH_STAFF_BROWSER_PILOT_MODE_ENABLED: 'true',
    SHILOH_STAFF_BROWSER_PILOT_ADMIN_IDS: '999',
  };
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const db = memoryDb({ credentials: [activeCredential(1, secret, env)] });
  const providerService = auth.createProviderIndependentStaffAuthService({ db, env, now: () => FIXED_NOW, randomBytes: deterministicRandom() });
  const issued = await providerService.issueBreakGlass({ adminId: 1, operatorReference: '40:JP', controlReference: '00:WS-10-route-proof' });
  assert.equal(issued.ok, true);

  const app = express();
  app.use(express.json());
  app.use('/calendar/staff-auth', createStaffBrowserSessionRouter({
    env,
    service: { async validateSessionToken() { return { ok: false }; }, validateCsrfToken() { return false; } },
    providerIndependentAuthService: providerService,
  }));

  await withHttpServer(app, async (origin) => {
    const exchange = () => fetch(`${origin}/calendar/staff-auth/totp/break-glass/exchange`, {
      method: 'POST',
      headers: {
        Origin: 'https://calendar.shiloh.example',
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'calendar.shiloh.example',
        'Sec-Fetch-Site': 'same-origin',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ token: issued.token }),
    });

    const accepted = await exchange();
    assert.equal(accepted.status, 200);
    assert.match(accepted.headers.get('set-cookie'), /^__Host-shiloh_staff_session=[A-Za-z0-9_-]{43};/);
    assert.equal((await accepted.json()).recoveryRequired, true);
    assert.equal(db.breakGlassConsumptionTransitions, 1);
    assert.equal(db.sessions.length, 1);

    const replay = await exchange();
    assert.equal(replay.status, 401);
    assert.equal(replay.headers.get('set-cookie'), null);
  });
});

test('real Chromium persists the break-glass session and executes management status and enrollment flows', { timeout: 45_000 }, async (t) => {
  const executable = chromeExecutable();
  if (!executable) {
    if (process.env.CI) assert.fail('CI must provide Chrome for the staff-auth browser-cookie proof');
    t.skip('Chrome is not installed in this local workspace; CI executes this mandatory browser proof');
    return;
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shiloh-staff-auth-browser-'));
  const env = { ...enabledEnv('1'), NODE_ENV: 'production' };
  const current = new Date();
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const db = memoryDb({ credentials: [activeCredential(1, secret, env)] });
  const providerService = auth.createProviderIndependentStaffAuthService({ db, env, now: () => current });
  const baseSessionService = sessions.createStaffBrowserSessionService({ db, now: () => current });
  const responseBodies = [];
  const capturedLogs = [];
  const captureLogger = { info(...args) { capturedLogs.push(args); }, error(...args) { capturedLogs.push(args); } };
  const originalLoggerChild = logger.child;
  let server;
  let chrome;
  let cdp;
  let sessionCdp;

  try {
    logger.child = () => captureLogger;
    const app = express();
    app.use(express.json());
    app.use(requestContext);
    app.use((req, res, next) => {
      const sendJson = res.json.bind(res);
      res.json = (body) => {
        const containsEnrollmentMaterial = req.originalUrl === '/calendar/staff-auth/totp/enrollment/start';
        responseBodies.push(containsEnrollmentMaterial
          ? { path: req.originalUrl, keys: Object.keys(body || {}).sort() }
          : { path: req.originalUrl, body });
        return sendJson(body);
      };
      next();
    });
    app.get('/calendar/staff', (_req, res) => res.type('html').send(renderStaffCalendarAccessPage({ providerIndependentAuthEnabled: true })));
    app.get('/calendar/staff/client.js', (_req, res) => res.type('application/javascript').send(staffCalendarAccessClientScript()));
    app.use('/calendar/staff-auth', createStaffBrowserSessionRouter({
      env,
      service: baseSessionService,
      providerIndependentAuthService: providerService,
    }));

    const certificate = createTestCertificate(directory);
    server = https.createServer(certificate, app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `https://127.0.0.1:${server.address().port}`;
    env.SHILOH_CALENDAR_PUBLIC_ORIGIN = origin;
    const issued = await providerService.issueBreakGlass({
      adminId: 1,
      operatorReference: '40:browser-proof',
      controlReference: '00:WS-10-browser-proof',
    });
    assert.equal(issued.ok, true);

    const debuggingPort = await reserveTcpPort();
    chrome = spawn(executable, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--ignore-certificate-errors',
      '--allow-insecure-localhost',
      '--remote-allow-origins=*',
      `--remote-debugging-port=${debuggingPort}`,
      `--user-data-dir=${path.join(directory, 'profile')}`,
      'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let browserErrors = '';
    chrome.stderr.on('data', (chunk) => { browserErrors += String(chunk).slice(-4_000); });

    const targets = await pollValue(
      async () => {
        const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/list`);
        if (!response.ok) throw new Error(`Chrome target discovery failed: ${response.status}`);
        return response.json();
      },
      (items) => Array.isArray(items) && items.some((item) => item.type === 'page' && item.webSocketDebuggerUrl),
      { timeoutMs: 15_000 }
    ).catch((error) => { throw new Error(`${error.message}\n${browserErrors}`); });
    const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
    cdp = await connectCdp(target.webSocketDebuggerUrl);
    const networkResponses = [];
    const networkRequests = [];
    const browserExceptions = [];
    let pausedManage = null;
    cdp.on('Network.requestWillBeSent', (event) => networkRequests.push({
      url: event.request.url,
      method: event.request.method,
    }));
    cdp.on('Network.responseReceived', (event) => networkResponses.push({
      requestId: event.requestId,
      url: event.response.url,
      status: event.response.status,
      mimeType: event.response.mimeType,
      headers: event.response.headers,
    }));
    cdp.on('Runtime.exceptionThrown', (event) => browserExceptions.push({
      text: event.exceptionDetails?.text || '',
      description: event.exceptionDetails?.exception?.description || '',
      lineNumber: event.exceptionDetails?.lineNumber,
      columnNumber: event.exceptionDetails?.columnNumber,
    }));
    cdp.on('Fetch.requestPaused', (event) => {
      if (event.request.url === `${origin}/calendar/staff-auth/totp/manage`) pausedManage = event;
    });
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: `${origin}/calendar/staff-auth/totp/manage`, requestStage: 'Request' }] });

    await cdp.send('Page.navigate', { url: `${origin}/calendar/staff#staff-recovery=${encodeURIComponent(issued.token)}` });
    await pollValue(() => pausedManage, Boolean, { timeoutMs: 15_000 });

    const navigationHistory = await cdp.send('Page.getNavigationHistory');
    const urlBeforeManage = navigationHistory.entries[navigationHistory.currentIndex]?.url;
    assert.equal(urlBeforeManage, `${origin}/calendar/staff`);
    assert.equal(urlBeforeManage.includes(issued.token), false);

    const cookieResult = await cdp.send('Network.getAllCookies');
    const sessionCookie = cookieResult.cookies.find((cookie) => cookie.name === '__Host-shiloh_staff_session');
    assert.ok(sessionCookie, 'Chromium must accept the production __Host- session cookie');
    assert.equal(sessionCookie.secure, true);
    assert.equal(sessionCookie.httpOnly, true);
    assert.equal(sessionCookie.path, '/');
    assert.equal(sessionCookie.sameSite, 'Strict');
    assert.notEqual(sessionCookie.value, issued.token);

    const sessionTarget = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const sessionTargets = await pollValue(
      async () => {
        const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/list`);
        if (!response.ok) throw new Error(`Chrome session target discovery failed: ${response.status}`);
        return response.json();
      },
      (items) => Array.isArray(items) && items.some((item) => item.id === sessionTarget.targetId && item.webSocketDebuggerUrl),
      { timeoutMs: 15_000 }
    );
    const sessionTargetInfo = sessionTargets.find((item) => item.id === sessionTarget.targetId && item.webSocketDebuggerUrl);
    sessionCdp = await connectCdp(sessionTargetInfo.webSocketDebuggerUrl);
    let sessionResponse = null;
    sessionCdp.on('Network.responseReceived', (event) => {
      if (event.response.url === `${origin}/calendar/staff-auth/session`) sessionResponse = event.response;
    });
    await sessionCdp.send('Page.enable');
    await sessionCdp.send('Runtime.enable');
    await sessionCdp.send('Network.enable');
    await sessionCdp.send('Page.navigate', { url: `${origin}/calendar/staff-auth/session` });
    await pollValue(() => sessionResponse, Boolean, { timeoutMs: 15_000 });
    await pollValue(() => evaluateInBrowser(sessionCdp, 'document.readyState'), (value) => value === 'complete', { timeoutMs: 15_000 });
    const sessionBody = await evaluateInBrowser(sessionCdp, 'JSON.parse(document.body.innerText)');
    assert.equal(sessionResponse.status, 200);
    assert.equal(sessionBody.authenticated, true);
    assert.equal(sessionBody.recoveryRequired, true);
    assert.equal(sessionBody.viewer, null);
    await cdp.send('Target.closeTarget', { targetId: sessionTarget.targetId });
    sessionCdp.close();
    sessionCdp = null;

    await cdp.send('Fetch.continueRequest', { requestId: pausedManage.requestId });
    await cdp.send('Fetch.disable');
    const finalUrl = await pollValue(
      () => evaluateInBrowser(cdp, 'location.href'),
      (value) => value === `${origin}/calendar/staff-auth/totp/manage`,
      { timeoutMs: 15_000 }
    );
    assert.equal(finalUrl.includes('#'), false);
    assert.equal(finalUrl.includes(issued.token), false);
    const documentHtml = await evaluateInBrowser(cdp, 'document.documentElement.outerHTML');
    assert.equal(documentHtml.includes(issued.token), false);

    const exchangeResponse = networkResponses.find((item) => item.url === `${origin}/calendar/staff-auth/totp/break-glass/exchange`);
    const manageResponse = networkResponses.find((item) => item.url === `${origin}/calendar/staff-auth/totp/manage`);
    const manageScriptResponse = await pollValue(
      () => networkResponses.find((item) => item.url === `${origin}/calendar/staff-auth/totp/manage.js`),
      Boolean,
      { timeoutMs: 15_000 }
    );
    const statusResponse = await pollValue(
      () => networkResponses.find((item) => item.url === `${origin}/calendar/staff-auth/totp/status`),
      Boolean,
      { timeoutMs: 15_000 }
    );
    assert.equal(exchangeResponse?.status, 200);
    assert.equal(manageResponse?.status, 200);
    assert.equal(manageScriptResponse.status, 200);
    const manageScriptHeaders = Object.fromEntries(Object.entries(manageScriptResponse.headers || {}).map(([name, value]) => [name.toLowerCase(), value]));
    const manageHeaders = Object.fromEntries(Object.entries(manageResponse.headers || {}).map(([name, value]) => [name.toLowerCase(), value]));
    assert.match(String(manageScriptResponse.mimeType), /javascript/i);
    assert.match(String(manageScriptHeaders['content-type']), /^application\/javascript/i);
    assert.equal(String(manageScriptHeaders['x-content-type-options']).toLowerCase(), 'nosniff');
    assert.match(String(manageHeaders['content-security-policy']), /script-src 'self'/);
    assert.equal(statusResponse.status, 200);
    const loadedStatus = await pollValue(
      () => evaluateInBrowser(cdp, "document.querySelector('[data-management-status]').textContent"),
      (value) => value !== 'Checking your current security state…',
      { timeoutMs: 15_000 }
    );
    assert.equal(loadedStatus, 'Recovery authentication is active. Enroll a replacement authenticator before Calendar access.');
    assert.deepEqual(browserExceptions, []);

    await evaluateInBrowser(cdp, "document.querySelector('[data-start-enrollment]').click()");
    const csrfResponse = await pollValue(
      () => networkResponses.find((item) => item.url === `${origin}/calendar/staff-auth/csrf`),
      Boolean,
      { timeoutMs: 15_000 }
    );
    const enrollmentResponse = await pollValue(
      () => networkResponses.find((item) => item.url === `${origin}/calendar/staff-auth/totp/enrollment/start`),
      Boolean,
      { timeoutMs: 15_000 }
    );
    assert.equal(networkRequests.some((item) => item.url === `${origin}/calendar/staff-auth/csrf` && item.method === 'POST'), true);
    assert.equal(networkRequests.some((item) => item.url === `${origin}/calendar/staff-auth/totp/enrollment/start` && item.method === 'POST'), true);
    assert.equal(csrfResponse.status, 200);
    assert.equal(enrollmentResponse.status, 200);
    const enrollmentUi = await pollValue(
      () => evaluateInBrowser(cdp, `(()=>{var box=document.querySelector('[data-enrollment]');var image=document.querySelector('[data-enrollment-qr]');var manual=document.querySelector('[data-manual-key]');var state=document.querySelector('[data-management-status]');return {visible:box&&!box.hidden,qr:String(image&&image.getAttribute('src')||''),manual:String(manual&&manual.textContent||''),status:String(state&&state.textContent||'')};})()`),
      (value) => value?.visible && value.manual.length > 0 && value.qr.startsWith('data:image/png;base64,'),
      { timeoutMs: 15_000 }
    );
    assert.equal(enrollmentUi.status, 'Scan the QR code, then prove possession with a current six-digit code.');
    assert.equal(db.audits.some((event) => event.eventType === 'enrollment_initiated'), true);
    assert.deepEqual(browserExceptions, []);

    const replay = await evaluateInBrowser(cdp, `(async()=>{const response=await fetch('/calendar/staff-auth/totp/break-glass/exchange',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({token:${JSON.stringify(issued.token)}})});return {status:response.status,body:await response.json()};})()`);
    assert.equal(replay.status, 401);
    assert.equal(db.breakGlassConsumptionTransitions, 1);
    assert.equal(db.sessions.length, 1);

    await new Promise((resolve) => setImmediate(resolve));
    const emittedEvidence = JSON.stringify({ responseBodies, capturedLogs, audits: db.audits });
    assert.equal(emittedEvidence.includes(issued.token), false);
    assert.equal(JSON.stringify(responseBodies).includes(issued.token), false);
    assert.equal(JSON.stringify(capturedLogs).includes(issued.token), false);
    assert.equal(JSON.stringify(db.audits).includes(issued.token), false);
    assert.equal(db.audits.some((event) => event.eventType === 'break_glass_consumed'), true);
    assert.equal(emittedEvidence.includes(enrollmentUi.manual), false);
    assert.equal(emittedEvidence.includes(enrollmentUi.qr), false);
    assert.equal(JSON.stringify(capturedLogs).includes(enrollmentUi.manual), false);
    assert.equal(JSON.stringify(capturedLogs).includes(enrollmentUi.qr), false);
    assert.equal(JSON.stringify(db.audits).includes(enrollmentUi.manual), false);
    assert.equal(JSON.stringify(db.audits).includes(enrollmentUi.qr), false);
    assert.equal(db.recoveryCodes.length, 0);
  } finally {
    logger.child = originalLoggerChild;
    if (sessionCdp) sessionCdp.close();
    if (cdp) cdp.close();
    if (chrome && chrome.exitCode == null) {
      chrome.kill('SIGTERM');
      await Promise.race([once(chrome, 'exit'), new Promise((resolve) => setTimeout(resolve, 2_000))]);
      if (chrome.exitCode == null) chrome.kill('SIGKILL');
    }
    if (server) {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise((resolve) => server.close(() => resolve()));
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('#946 rollback cannot restore retired browser OTP, authenticator, or recovery-code login routes', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'src/routes/staffBrowserSession.js'), 'utf8');
  const rollback = fs.readFileSync(path.join(__dirname, '..', 'scripts/audit-staff-auth-rollback.js'), 'utf8');
  assert.doesNotMatch(routes, /router\.post\('\/challenge'/);
  assert.doesNotMatch(routes, /router\.post\('\/verify'/);
  assert.doesNotMatch(routes, /router\.post\('\/totp\/verify'/);
  assert.doesNotMatch(routes, /router\.post\('\/totp\/recovery\/verify'/);
  assert.match(routes, /router\.post\('\/totp\/break-glass\/exchange'/);
  assert.match(routes, /router\.post\('\/calendar-handoff\/exchange'/);
  assert.match(rollback, /recordRollback/);
  assert.doesNotMatch(routes, /delete.*template|WABA/i);
});

test('Meta unavailable cannot affect provider-independent verification path', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/services/providerIndependentStaffAuth.js'), 'utf8');
  assert.doesNotMatch(source, /require\(['"]\.\/whatsapp|staffAuthWhatsApp|axios|graph\.facebook|sendMessage|challengeDispatcher/);
  assert.match(source, /issueStaffBrowserSession/);
});

test('migration and UI contain no plaintext-secret persistence or persistent browser storage', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations/081_provider_independent_staff_auth.sql'), 'utf8');
  const html = renderProviderIndependentStaffAuthPage();
  const client = providerIndependentStaffAuthClientScript();
  assert.match(migration, /secret_ciphertext TEXT/);
  assert.match(migration, /code_hash TEXT NOT NULL/);
  assert.match(migration, /auth_method TEXT NOT NULL DEFAULT 'whatsapp_otp'/);
  assert.doesNotMatch(migration, /\b(?:totp_secret|recovery_code|session_token|otp_value)\s+TEXT\b/i);
  assert.doesNotMatch(html + client, /localStorage|sessionStorage|document\.cookie/i);
  assert.match(client, /removeAttribute\('src'\)/);
  assert.match(client, /textContent=''/);
});

test('secret-shaped inputs are absent from error responses, request logs, and security-audit evidence', async () => {
  const materials = {
    totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    liveTotp: '654321',
    recoveryCode: 'ABCD-EF12-3456-7890-ABCD-EF12-3456-7890',
    sessionToken: Buffer.alloc(32, 13).toString('base64url'),
    encryptionKey: Buffer.alloc(32, 42).toString('base64url'),
  };
  materials.otpauthUri = `otpauth://totp/Shiloh%20OS:JP?secret=${materials.totpSecret}&issuer=Shiloh%20OS`;
  const prohibited = Object.values(materials);

  const capturedLogs = [];
  const captureLogger = {
    info(...args) { capturedLogs.push({ level: 'info', args }); },
    error(...args) { capturedLogs.push({ level: 'error', args }); },
  };
  const hadOwnChild = Object.prototype.hasOwnProperty.call(logger, 'child');
  const originalChild = logger.child;
  logger.child = () => captureLogger;
  const responseBodies = [];
  let retiredVerifierCalls = 0;
  try {
    const app = express();
    app.use(express.json());
    app.use(requestContext);
    app.use('/calendar/staff-auth', createStaffBrowserSessionRouter({
      env: { NODE_ENV: 'test' },
      service: {
        async validateSessionToken() { return { ok: false }; },
        validateCsrfToken() { return false; },
      },
      providerIndependentAuthService: {
        async verifyTotp() { retiredVerifierCalls += 1; return { ok: false, code: 'STAFF_AUTH_INVALID' }; },
        async verifyRecovery() { retiredVerifierCalls += 1; return { ok: false, code: 'STAFF_AUTH_INVALID' }; },
      },
    }));
    app.use((error, req, res, _next) => {
      req.log.error({ err: error }, 'Unhandled Express error');
      res.status(500).json({ error: 'Internal server error', requestId: req.id });
    });

    await withHttpServer(app, async (origin) => {
      for (const [pathName, payload] of [
        ['/calendar/staff-auth/totp/verify', { identifier: `${materials.totpSecret} ${materials.otpauthUri}`, code: materials.liveTotp, sessionToken: materials.sessionToken, encryptionKey: materials.encryptionKey }],
        ['/calendar/staff-auth/totp/recovery/verify', { identifier: `${materials.sessionToken} ${materials.encryptionKey}`, recoveryCode: materials.recoveryCode, totpSecret: materials.totpSecret, otpauthUri: materials.otpauthUri }],
      ]) {
        const response = await fetch(`${origin}${pathName}`, {
          method: 'POST',
          headers: { Origin: origin, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload),
        });
        assert.equal(response.status, 404);
        responseBodies.push(await response.text());
      }
    });
    assert.equal(retiredVerifierCalls, 0);
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    if (hadOwnChild) logger.child = originalChild;
    else delete logger.child;
  }

  const env = enabledEnv();
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const subject = canonicalAdmin({ id: 2, normalized_whatsapp: '27820000000', display_name: 'Christel', staff_id: 4, staff_status: 'active', permissions: {} });
  const db = memoryDb({ admins: [canonicalAdmin(), subject], credentials: [activeCredential(2, secret, env)] });
  const service = auth.createProviderIndependentStaffAuthService({ db, env, now: () => FIXED_NOW });
  const reset = await service.privilegedReset({
    session: { ok: true, adminId: 1, sessionId: 9, authenticatedAt: FIXED_NOW, recoveryRequired: false },
    subjectAdminId: 2,
    reason: prohibited.join(' | '),
    requestFingerprintHash: '8'.repeat(64),
  });
  assert.equal(reset.ok, true);

  const evidence = JSON.stringify({ responseBodies, capturedLogs, audits: db.audits });
  for (const value of prohibited) assert.equal(evidence.includes(value), false, `prohibited material was retained: ${value}`);
  const resetAudit = db.audits.find((event) => event.eventType === 'credential_reset');
  assert.equal(resetAudit.operatorAdminId, 1);
  assert.equal(resetAudit.subjectAdminId, 2);
  assert.equal(resetAudit.authMethod, 'totp');
  assert.match(resetAudit.reason, /\[redacted-totp-secret\]/);
  assert.match(resetAudit.reason, /\[redacted-otp\]/);
  assert.match(resetAudit.reason, /\[redacted-auth-uri\]/);
  assert.match(resetAudit.reason, /\[redacted-recovery-code\]/);
  assert.match(resetAudit.reason, /\[redacted-secret\]/);
});

test('management mutations retain same-origin, staff-session, and CSRF guards', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'src/routes/staffBrowserSession.js'), 'utf8');
  for (const route of ['enrollment/start', 'enrollment/confirm', 'enrollment/cancel', 'recovery/regenerate', 'admin/reset']) {
    assert.match(routes, new RegExp(`router\\.post\\('\\/totp\\/${route.replace('/', '\\/')}', sameOrigin, requireSession, requireCsrf`));
  }
});

test('current session validation immediately rejects authority loss for linked staff', async () => {
  const token = Buffer.alloc(32, 9).toString('base64url');
  const db = {
    async query(sql) {
      if (String(sql).includes('FROM staff_browser_sessions')) return { rows: [{
        session_id: 1, admin_id: 2, csrf_hash: 'a'.repeat(64), issued_at: FIXED_NOW,
        expires_at: new Date(FIXED_NOW.getTime() + 60_000), revoked_at: null,
        admin_active: true, staff_id: 4, staff_status: 'inactive',
      }], rowCount: 1 };
      throw new Error('unexpected query');
    },
  };
  const service = sessions.createStaffBrowserSessionService({ db, now: () => FIXED_NOW });
  assert.equal((await service.validateSessionToken(token)).ok, false);
});
