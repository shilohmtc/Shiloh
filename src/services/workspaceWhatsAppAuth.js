'use strict';

const crypto = require('node:crypto');
const { normalizeMobile } = require('./crmV2ClientService');
const { deriveCalendarViewer, safeHashEqual } = require('./staffBrowserSession');
const { strongRecentSession } = require('./staffPasskeyAuth');

const PURPOSES = new Set(['signin', 'enroll', 'recover']);
const INVALID = Object.freeze({ ok: false, code: 'WORKSPACE_WHATSAPP_INVALID' });
const DISABLED = Object.freeze({ ok: false, code: 'WORKSPACE_WHATSAPP_DISABLED' });
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000;
const tokenValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const active = row => row?.admin_active === true &&
  (row.staff_id == null || row.staff_status === 'active') && !!deriveCalendarViewer(row);

// Preparation only: no production store, mounted route, credentials or default
// sender. See docs/WORKSPACE_WHATSAPP_AUTH_PREPARATION.md for the transactional
// persistence contract and mandatory activation gates. Tests supply a synthetic
// store; that store must never become an application fallback.
function createWorkspaceWhatsAppAuth({ enabled = false, store = null, delivery = null,
  hmacKey = null, now = () => new Date(), randomBytes = crypto.randomBytes,
  randomInt = crypto.randomInt } = {}) {
  const key = Buffer.isBuffer(hmacKey) ? Buffer.from(hmacKey) : null;
  const enabledHere = () => enabled === true && key?.length >= 32 &&
    typeof store?.transaction === 'function' && typeof delivery?.configured === 'function' && delivery.configured();
  const digest = (...parts) => crypto.createHmac('sha256', key).update(JSON.stringify(parts)).digest('hex');
  const revision = admin => digest('identity', admin.id, admin.normalized_whatsapp,
    admin.sign_in_first_name ?? null, admin.sign_in_surname ?? null,
    admin.sign_in_date_of_birth instanceof Date ? admin.sign_in_date_of_birth.toISOString().slice(0, 10)
      : admin.sign_in_date_of_birth ?? null);

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
  async function begin({ purpose, mobile, approvalSessionId = null, identityConfirmed = false,
    network, browserToken } = {}) {
    if (!enabledHere()) return DISABLED;
    if (!PURPOSES.has(purpose) || !tokenValid(browserToken) || typeof network !== 'string' || !network || network.length > 120) return INVALID;
    const template = await delivery.readiness();
    if (!template.ready || !Number.isInteger(template.codeTtlSeconds) || template.codeTtlSeconds <= 0 || template.codeTtlSeconds > 300) return DISABLED;
    const normalized = typeof mobile === 'string' && mobile.length <= 30 ? normalizeMobile(mobile) : null;
    const request = randomBytes(32).toString('base64url');
    // Identical response for unknown, inactive, ambiguous, throttled, rejected or
    // provider-failed requests. The decoy token is never persisted or usable.
    const accepted = { ok: true, accepted: true, request };
    const prepared = await store.transaction(async tx => {
      const current = now();
      const buckets = [
        ['identity', normalized || 'invalid', 3, WINDOW_MS],
        ['browser', browserToken, 10, WINDOW_MS],
        ['network', network, 30, WINDOW_MS],
        ['clinic', 'all', 100, WINDOW_MS],
        ['clinic-day', 'all', 500, 24 * 60 * 60 * 1000],
      ].map(([kind, value, limit, windowMs]) => ({ key: digest('issue-rate', kind, value), limit, windowMs }));
      if (!await tx.takeRate(buckets, current)) return null;
      if (!normalized) return null;
      // Include inactive collisions; never copy or register a CRM identity.
      const matches = await tx.adminsByMobile(normalized);
      if (matches.length !== 1 || !active(matches[0])) return null;
      const subject = matches[0];
      let operator = null;
      if (purpose !== 'signin') {
        if (identityConfirmed !== true) return null;
        operator = await approval(tx, approvalSessionId, subject.id, current, true);
        if (!operator) return null;
      }
      const code = String(randomInt(0, 1000000)).padStart(6, '0');
      const requestHash = digest('request', request);
      const row = {
        requestHash, purpose, adminId: subject.id, operatorId: operator?.id || null,
        approvalSessionId: operator ? approvalSessionId : null,
        identityRevision: revision(subject), browserHash: digest('browser', browserToken),
        codeHash: digest('code', request, purpose, code), issuedAt: current,
        expiresAt: new Date(current.getTime() + template.codeTtlSeconds * 1000),
        attempts: 0, state: 'pending', providerMessageId: null,
      };
      await tx.revokeChallenges(subject.id, purpose, current);
      await tx.insertChallenge(row);
      await tx.audit({ event: 'workspace_whatsapp_requested', adminId: subject.id,
        operatorId: operator?.id || null, purpose, at: current });
      return { requestHash, mobile: subject.normalized_whatsapp, code };
    });
    if (!prepared) return accepted;
    let sent;
    try { sent = await delivery.deliver({ mobile: prepared.mobile, code: prepared.code, codeTtlSeconds: template.codeTtlSeconds }); }
    catch (_) { sent = { ok: false }; }
    await store.transaction(async tx => {
      const row = await tx.challenge(prepared.requestHash);
      if (!row || row.state !== 'pending') return;
      const current = now();
      const success = sent?.ok === true && typeof sent.providerMessageId === 'string' && sent.providerMessageId.startsWith('wamid.') && new Date(row.expiresAt) > current;
      row.state = success ? 'ready' : 'revoked';
      row.providerMessageId = success ? sent.providerMessageId : null;
      await tx.saveChallenge(row);
      await tx.audit({ event: success ? 'workspace_whatsapp_provider_accepted' : 'workspace_whatsapp_send_failed',
        adminId: row.adminId, operatorId: row.operatorId, purpose, at: current });
    });
    return accepted;
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
      if (typeof code !== 'string' || !/^[0-9]{6}$/.test(code) || !safeHashEqual(row.codeHash, digest('code', request, purpose, code))) {
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
        ? await tx.issueSession({ admin: subject, authMethod: 'whatsapp_otp',
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

  return { enabled: enabledHere, begin, verify };
}

module.exports = { createWorkspaceWhatsAppAuth, MAX_ATTEMPTS };
