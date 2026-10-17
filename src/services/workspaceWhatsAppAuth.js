'use strict';

const crypto = require('node:crypto');
const { normalizeMobile } = require('./crmV2ClientService');
const { deriveCalendarViewer, safeHashEqual, sha256 } = require('./staffBrowserSession');
const { strongRecentSession, passkeyPolicy, registrationUser, verifyRegistrationResponse, fromB64url } = require('./staffPasskeyAuth');
const { workspaceWhatsAppRevision } = require('./workspaceWhatsAppIdentity');

const PURPOSES = new Set(['signin', 'enroll', 'recover']);
const INVALID = Object.freeze({ ok: false, code: 'WORKSPACE_WHATSAPP_INVALID' });
const DISABLED = Object.freeze({ ok: false, code: 'WORKSPACE_WHATSAPP_DISABLED' });
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000;
const tokenValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const active = row => row?.admin_active === true &&
  (row.staff_id == null || row.staff_status === 'active') && !!deriveCalendarViewer(row);

// Explicit composition only: no mounted production route or default sender.
function createWorkspaceWhatsAppAuth({ enabled = false, store = null, delivery = null,
  hmacKey = null, now = () => new Date(), randomBytes = crypto.randomBytes,
  randomInt = crypto.randomInt, env = {} } = {}) {
  const key = Buffer.isBuffer(hmacKey) ? Buffer.from(hmacKey) : null;
  const enabledHere = () => enabled === true && key?.length >= 32 &&
    typeof store?.transaction === 'function' && typeof delivery?.configured === 'function' && delivery.configured();
  const digest = (...parts) => crypto.createHmac('sha256', key).update(JSON.stringify(parts)).digest('hex');
  const revision = workspaceWhatsAppRevision;

  async function approval(tx, sessionId, subjectId, current, requireRecent) {
    const session = await tx.session(sessionId);
    if (!session?.ok || session.revokedAt || session.recoveryRequired || session.authMethod !== 'passkey' ||
        !Number.isFinite(new Date(session.expiresAt).getTime()) || new Date(session.expiresAt) <= current ||
        (requireRecent && !strongRecentSession(session, current)) || Number(session.adminId) === Number(subjectId)) return null;
    const operator = await tx.admin(session.adminId);
    if (!active(operator) || operator.calendar_scope !== 'all_business' || operator.service_scope !== 'all_services' ||
        operator.permissions?.['staff_auth:reset'] !== true) return null;
    return operator;
  }

  // network must be the server-derived network group, never request JSON.
  // browserToken must be a server-issued HttpOnly cookie (not UA/IP fingerprint).
  async function begin({ purpose, mobile, setupIntent = null,
    network, browserToken } = {}) {
    if (!enabledHere()) return DISABLED;
    if (!PURPOSES.has(purpose) || !tokenValid(browserToken) || typeof network !== 'string' || !network || network.length > 120) return INVALID;
    const normalized = typeof mobile === 'string' && mobile.length <= 30 ? normalizeMobile(mobile) : null;
    const request = randomBytes(32).toString('base64url');
    const accepted = { ok: true, accepted: true, request };
    // No identity lookup or provider I/O on this public path. All account states
    // take the same intake path; rate admission depends only on caller input.
    await store.transaction(async tx => {
      const current = now();
      const buckets = [
        ['identity', normalized || 'invalid', 3, WINDOW_MS],
        ['browser', browserToken, 10, WINDOW_MS],
        ['network', network, 30, WINDOW_MS],
        ['clinic', 'all', 100, WINDOW_MS],
        ['clinic-day', 'all', 500, 24 * 60 * 60 * 1000],
      ].map(([kind, value, limit, windowMs]) => ({ key: digest('issue-rate', kind, value), limit, windowMs }));
      if (!await tx.takeRate(buckets, current)) return;
      const requestHash = digest('request', request);
      const nonce = randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(digest('intake-encryption'), 'hex'), nonce);
      cipher.setAAD(Buffer.from(requestHash));
      const encrypted = Buffer.concat([cipher.update(normalized || '', 'utf8'), cipher.final()]);
      await tx.insertDispatch({ requestHash, purpose, browserHash: digest('browser', browserToken),
        intentHash: tokenValid(setupIntent) ? sha256(setupIntent) : null,
        mobile: Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64'),
        issuedAt: current, expiresAt: new Date(current.getTime() + 300000), state: 'queued' });
    });
    return accepted;
  }

  // Explicit worker entry point only; never mounted or started by this draft.
  // Claim commits BEFORE any provider call. A crash/uncertain send is never
  // retried automatically, including after process restart.
  async function dispatchOne() {
    if (!enabledHere()) return DISABLED;
    const intake = await store.transaction(tx => tx.claimDispatch(now()));
    if (!intake) return { ok: true, processed: false };
    const completed = { ok: true, processed: true };
    let normalized, template;
    try {
      const packed = Buffer.from(intake.mobile, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(digest('intake-encryption'), 'hex'), packed.subarray(0, 12));
      decipher.setAAD(Buffer.from(intake.requestHash)); decipher.setAuthTag(packed.subarray(12, 28));
      normalized = Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8');
      template = await delivery.readiness();
    } catch (_) { return completed; }
    if (!template.ready || !Number.isInteger(template.codeTtlSeconds) || template.codeTtlSeconds <= 0 || template.codeTtlSeconds > 300) return completed;
    const { purpose, requestHash } = intake;
    const prepared = await store.transaction(async tx => {
      const current = now();
      if (new Date(intake.expiresAt) <= current) return null;
      if (!normalized) return null;
      // Include inactive collisions; never copy or register a CRM identity.
      const matches = await tx.adminsByMobile(normalized);
      if (matches.length !== 1 || !active(matches[0])) return null;
      const subject = matches[0];
      let operator = null;
      let approvalSessionId = null;
      if (purpose !== 'signin') {
        if (!intake.intentHash) return null;
        const intent = await tx.intent(intake.intentHash);
        if (!intent || intent.state !== 'approved' || intent.purpose !== purpose ||
            Number(intent.adminId) !== Number(subject.id) || new Date(intent.expiresAt) <= current ||
            intent.identityRevision !== revision(subject) || intent.browserHash !== intake.browserHash) return null;
        approvalSessionId = intent.approvalSessionId;
        operator = await approval(tx, approvalSessionId, subject.id, current, true);
        if (!operator) return null;
        intent.state = 'consumed'; await tx.saveIntent(intent);
      }
      const code = String(randomInt(0, 1000000)).padStart(6, '0');
      const row = {
        requestHash, purpose, adminId: subject.id, operatorId: operator?.id || null,
        approvalSessionId: operator ? approvalSessionId : null,
        identityRevision: revision(subject), browserHash: intake.browserHash,
        codeHash: digest('code', requestHash, purpose, code), issuedAt: current,
        expiresAt: new Date(Math.min(new Date(intake.expiresAt).getTime(), current.getTime() + template.codeTtlSeconds * 1000)),
        attempts: 0, state: 'dispatching', providerMessageId: null,
      };
      await tx.revokeChallenges(subject.id, purpose, current);
      await tx.insertChallenge(row);
      await tx.audit({ event: 'workspace_whatsapp_requested', adminId: subject.id,
        operatorId: operator?.id || null, purpose, at: current });
      return { requestHash, mobile: subject.normalized_whatsapp, code };
    });
    if (!prepared) return completed;
    let sent;
    try { sent = await delivery.deliver({ mobile: prepared.mobile, code: prepared.code, codeTtlSeconds: template.codeTtlSeconds }); }
    catch (_) { sent = { ok: false }; }
    await store.transaction(async tx => {
      const row = await tx.challenge(prepared.requestHash);
      if (!row || row.state !== 'dispatching') return;
      const current = now();
      const success = sent?.ok === true && typeof sent.providerMessageId === 'string' && sent.providerMessageId.startsWith('wamid.') && new Date(row.expiresAt) > current;
      row.state = success ? 'ready' : 'revoked';
      row.providerMessageId = success ? sent.providerMessageId : null;
      await tx.saveChallenge(row);
      await tx.audit({ event: success ? 'workspace_whatsapp_provider_accepted' : 'workspace_whatsapp_send_failed',
        adminId: row.adminId, operatorId: row.operatorId, purpose, at: current });
    });
    return completed;
  }

  async function verify({ request, code, purpose, browserToken, network } = {}) {
    if (!enabledHere()) return DISABLED;
    if (!tokenValid(request) || !PURPOSES.has(purpose) || !tokenValid(browserToken) ||
        typeof network !== 'string' || !network || network.length > 120) return INVALID;
    return store.transaction(async tx => {
      const current = now();
      if (!await tx.takeRate([
        { key: digest('verify-network', network), limit: 100, windowMs: WINDOW_MS },
        { key: digest('verify-clinic', 'all'), limit: 1000, windowMs: WINDOW_MS },
      ], current)) return INVALID;
      const row = await tx.challenge(digest('request', request));
      if (!row || row.state !== 'ready' || !row.providerMessageId ||
          row.purpose !== purpose || !safeHashEqual(row.browserHash, digest('browser', browserToken))) return INVALID;
      if (new Date(row.expiresAt) <= current || row.attempts >= MAX_ATTEMPTS) {
        row.state = 'revoked'; await tx.saveChallenge(row); return INVALID;
      }
      // Invalid format counts too, but secrets never enter audit or rate keys.
      row.attempts += 1;
      if (typeof code !== 'string' || !/^[0-9]{6}$/.test(code) || !safeHashEqual(row.codeHash, digest('code', row.requestHash, purpose, code))) {
        if (row.attempts >= MAX_ATTEMPTS) row.state = 'revoked';
        await tx.saveChallenge(row);
        return INVALID;
      }
      const subject = await tx.admin(row.adminId);
      const owners = subject ? await tx.adminsByMobile(subject.normalized_whatsapp) : [];
      if (!active(subject) || owners.length !== 1 || Number(owners[0].id) !== Number(subject.id) ||
          !safeHashEqual(row.identityRevision, revision(subject)) ||
          (purpose !== 'signin' && !await approval(tx, row.approvalSessionId, subject.id, current, false))) {
        row.state = 'revoked'; await tx.saveChallenge(row); return INVALID;
      }
      row.state = 'consumed';
      await tx.saveChallenge(row);
      // The adapter MUST commit this effect, consumption and audit atomically.
      // A setup grant is not a session or a credential replacement. It binds the
      // later WebAuthn ceremony to this identity, approval, purpose and browser.
      const result = purpose === 'signin'
        ? await tx.issueSession({ admin: subject, authMethod: 'workspace_whatsapp',
          preserveExistingSessions: true, recentStrongAuth: false, current,
          expiresAt: new Date(current.getTime() + 8 * 60 * 60 * 1000), identityRevision: row.identityRevision })
        : await tx.issuePasskeyGrant({ adminId: subject.id, operatorId: row.operatorId,
          approvalSessionId: row.approvalSessionId, purpose, browserHash: row.browserHash,
          identityRevision: row.identityRevision, current,
          expiresAt: new Date(current.getTime() + 5 * 60 * 1000) });
      if (!result || result.ok !== true) throw new Error('Workspace authentication continuation failed');
      await tx.audit({ event: 'workspace_whatsapp_verified', adminId: subject.id,
        operatorId: row.operatorId, purpose, at: current });
      return result;
    });
  }

  async function requestSetup({ purpose, mobile, browserToken, network } = {}) {
    if (!enabledHere()) return DISABLED;
    if (!['enroll','recover'].includes(purpose) || !tokenValid(browserToken) || !network || typeof network !== 'string' || network.length > 120) return INVALID;
    const intent = randomBytes(32).toString('base64url');
    const normalized = typeof mobile === 'string' && mobile.length <= 30 ? normalizeMobile(mobile) : null;
    await store.transaction(async tx => {
      const current = now();
      if (!await tx.takeRate([{ key: digest('intent-network', network), limit: 20, windowMs: WINDOW_MS },
        { key: digest('intent-clinic','all'), limit: 100, windowMs: WINDOW_MS }], current) || !normalized) return;
      const rows = await tx.adminsByMobile(normalized);
      if (rows.length !== 1 || !active(rows[0])) return;
      await tx.insertIntent({ hash: sha256(intent), adminId: rows[0].id, purpose, state: 'requested',
        browserHash: digest('browser', browserToken), identityRevision: revision(rows[0]),
        expiresAt: new Date(current.getTime() + WINDOW_MS) });
    });
    return { ok: true, intent };
  }

  // sessionId comes exclusively from authenticated session middleware + CSRF.
  async function approveSetup({ intent, sessionId, identityConfirmed } = {}) {
    if (!enabledHere()) return DISABLED;
    if (!tokenValid(intent) || identityConfirmed !== true) return INVALID;
    return store.transaction(async tx => {
      const current = now(), row = await tx.intent(sha256(intent));
      if (!row || row.state !== 'requested' || new Date(row.expiresAt) <= current) return INVALID;
      const admin = await tx.admin(row.adminId);
      const operator = await approval(tx, sessionId, row.adminId, current, true);
      if (!active(admin) || !operator || row.identityRevision !== revision(admin)) return INVALID;
      row.state = 'approved'; row.approvalSessionId = sessionId;
      await tx.saveIntent(row);
      await tx.audit({ event: 'workspace_whatsapp_setup_approved', adminId: admin.id, operatorId: operator.id, purpose: row.purpose, at: current });
      return { ok: true };
    });
  }

  async function inspectSetup({ intent, sessionId } = {}) {
    if (!enabledHere()) return DISABLED;
    if (!tokenValid(intent)) return INVALID;
    return store.transaction(async tx => {
      const current = now(), row = await tx.intent(sha256(intent));
      if (!row || row.state !== 'requested' || new Date(row.expiresAt) <= current ||
          !await approval(tx, sessionId, row.adminId, current, true)) return INVALID;
      const admin = await tx.admin(row.adminId);
      if (!active(admin) || row.identityRevision !== revision(admin)) return INVALID;
      return { ok:true, displayName:admin.display_name, mobileEnding:admin.normalized_whatsapp.slice(-4), purpose:row.purpose };
    });
  }

  async function admitRequest({ network, browserToken } = {}) {
    if (!enabledHere() || !tokenValid(browserToken) || typeof network !== 'string' || !network || network.length > 120) return false;
    return store.transaction(tx => tx.takeRate([
      { key:digest('http-network', network), limit:60, windowMs:WINDOW_MS },
      { key:digest('http-browser', browserToken), limit:30, windowMs:WINDOW_MS },
      { key:digest('http-clinic','all'), limit:500, windowMs:WINDOW_MS },
    ], now()));
  }

  async function authorizedGrant(tx, grant, browserToken, current) {
    if (!tokenValid(grant) || !tokenValid(browserToken)) return null;
    const row = await tx.grant(sha256(grant));
    if (!row || !['issued','started'].includes(row.state) || !['enroll','recover'].includes(row.purpose) ||
        new Date(row.expiresAt) <= current || row.browserHash !== digest('browser', browserToken)) return null;
    const admin = await tx.admin(row.adminId);
    const matches = admin ? await tx.adminsByMobile(admin.normalized_whatsapp) : [];
    if (!active(admin) || matches.length !== 1 || Number(matches[0].id) !== Number(admin.id) ||
        row.identityRevision !== revision(admin) || !await approval(tx, row.approvalSessionId, row.adminId, current, false)) return null;
    return { row, admin };
  }

  async function beginRegistration({ grant, browserToken } = {}) {
    const policy = passkeyPolicy(env);
    if (!enabledHere() || !policy.operational) return DISABLED;
    return store.transaction(async tx => {
      const current = now(), found = await authorizedGrant(tx, grant, browserToken, current);
      if (!found || found.row.state !== 'issued') return INVALID;
      const { row, admin } = found, challenge = randomBytes(32).toString('base64url');
      row.challengeHash = sha256(challenge); row.state = 'started';
      await tx.saveGrant(row);
      const existing = await tx.credentials(admin.id);
      return { ok: true, purpose: row.purpose, options: { challenge,
        rp: { name: 'Shiloh', id: policy.rpId }, user: registrationUser(admin),
        pubKeyCredParams: [{ type:'public-key', alg:-7 }, { type:'public-key', alg:-8 }, { type:'public-key', alg:-257 }],
        timeout: Math.max(1, new Date(row.expiresAt) - current), attestation: 'none',
        authenticatorSelection: { authenticatorAttachment:'platform', residentKey:'required', requireResidentKey:true, userVerification:'required' },
        excludeCredentials: existing.map(c => ({ type:'public-key', id:c.credential_id })) } };
    });
  }

  async function finishRegistration({ grant, browserToken, response, deviceLabel } = {}) {
    const policy = passkeyPolicy(env);
    if (!enabledHere() || !policy.operational) return DISABLED;
    return store.transaction(async tx => {
      const current = now(), found = await authorizedGrant(tx, grant, browserToken, current);
      if (!found || found.row.state !== 'started') return INVALID;
      const { row, admin } = found;
      row.state = 'consumed'; await tx.saveGrant(row);
      let verified;
      try {
        const data = JSON.parse(fromB64url(response?.response?.clientDataJSON,16384).toString('utf8'));
        if (!tokenValid(data.challenge) || sha256(data.challenge) !== row.challengeHash) return INVALID;
        verified = verifyRegistrationResponse(response, { expectedChallenge:data.challenge, origin:policy.origin, rpId:policy.rpId });
      } catch (_) { return INVALID; }
      const result = await tx.completePasskey({ admin, verified, purpose:row.purpose, current, deviceLabel });
      if (!result?.ok) return INVALID;
      await tx.audit({ event:'workspace_whatsapp_passkey_completed', adminId:admin.id, operatorId:row.operatorId, purpose:row.purpose, at:current });
      return result;
    });
  }

  return { enabled: enabledHere, begin, dispatchOne, verify, requestSetup, inspectSetup, approveSetup, admitRequest, beginRegistration, finishRegistration };
}

module.exports = { createWorkspaceWhatsAppAuth, MAX_ATTEMPTS };
