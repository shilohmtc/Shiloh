// Reviewable second-phase contracts and fixture OAuth adapter. No production executor, env or default network client.
const { setTimeout: delay } = require('node:timers/promises');
const { databaseEvidence } = require('./database-backup-evidence');
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const SAFE_RETRY_STAGES = new Set([
  'oauth-refresh',
  'owner-read',
  'metadata-read',
  'readback',
  'session-status',
]);
const TRANSIENT = new Set([429, 500, 502, 503, 504]);
const FAILURE_STAGES = new Set([
  'authorization',
  'destination',
  'scratch',
  'export',
  'encryption',
  'upload',
  'readback',
  'receipt',
  'timeout',
  'interrupted',
]);
function productionWrapperDesign() {
  return {
    status: 'disabled',
    phase: 'review-required',
    proposedExecutor: 'dedicated-render-cron',
    proposedRegion: 'oregon',
    productionDatabaseConfigured: false,
    oauthConfigured: false,
    receiptTrustConfigured: false,
    scheduleConfigured: false,
    notificationsConfigured: false,
    deletionEnabled: false,
    attempts: 3,
    backoffMs: [1000, 3000],
    maxRetryAfterMs: 5000,
    requestTimeoutMs: 30000,
    totalTimeoutMs: 120000,
    blindUploadCreateRetry: false,
  };
}
function retryDecision({ stage, status, attempt, remainingMs, retryAfterMs = 0 }) {
  if (
    !SAFE_RETRY_STAGES.has(stage) ||
    !TRANSIENT.has(status) ||
    !Number.isInteger(attempt) ||
    attempt < 1 ||
    attempt >= 3
  )
    return { retry: false };
  if (
    !Number.isFinite(retryAfterMs) ||
    retryAfterMs < 0 ||
    retryAfterMs > 5000 ||
    !Number.isFinite(remainingMs)
  )
    return { retry: false };
  const waitMs = Math.max([1000, 3000][attempt - 1], retryAfterMs);
  return remainingMs >= waitMs + 30000 ? { retry: true, waitMs } : { retry: false };
}
function scratchBudget({ availableBytes, maxCiphertextBytes, reserveBytes }) {
  if (
    ![availableBytes, maxCiphertextBytes, reserveBytes].every(
      (v) => Number.isSafeInteger(v) && v > 0,
    ) ||
    !Number.isSafeInteger(maxCiphertextBytes * 2 + reserveBytes)
  )
    throw new Error('Bounded scratch inputs required');
  const requiredBytes = maxCiphertextBytes * 2 + reserveBytes;
  return { status: availableBytes >= requiredBytes ? 'sufficient' : 'insufficient', requiredBytes };
}
function reconcileUpload({ matches, ambiguousOutcome = false }) {
  if (!Number.isInteger(matches) || matches < 0)
    throw new Error('Trusted inventory count required');
  if (matches > 1)
    return { status: 'blocked', action: 'manual-duplicate-review', delete: false, success: false };
  if (matches === 1)
    return {
      status: 'unverified',
      action: 'verify-existing-ciphertext-readback',
      delete: false,
      success: false,
    };
  return {
    status: ambiguousOutcome ? 'blocked' : 'new',
    action: ambiguousOutcome ? 'inspect-session-and-orphans' : 'create-once',
    delete: false,
    success: false,
  };
}
function failureEvidence(stage) {
  if (!FAILURE_STAGES.has(stage)) throw new Error('Fixed failure stage required');
  return { status: 'failed', stage, databaseRecoveryVerified: false };
}
function runObservation({ enabled = false, envelope, context, deadlineAt, now = Date.now() }) {
  if (!enabled) return { status: 'disabled', notificationDelivered: false };
  if (!Number.isFinite(deadlineAt) || !Number.isFinite(now))
    throw new Error('Expected run deadline required');
  if (!envelope)
    return {
      status: now > deadlineAt ? 'missing-run' : 'awaiting-run',
      notificationDelivered: false,
    };
  const evidence = databaseEvidence(envelope, { ...context, now });
  return {
    status:
      evidence.status === 'ciphertext-readback-verified'
        ? 'fixture-ciphertext-verified'
        : 'unverified',
    databaseRecoveryVerified: false,
    notificationDelivered: false,
  };
}
function createFixtureOAuthAdapter({
  request,
  credentials,
  now = Date.now,
  wait = (ms, signal) => delay(ms, undefined, { signal }),
}) {
  // Real grants/credentials cannot be passed to this fixture adapter. A production adapter needs separate review.
  if (
    typeof request !== 'function' ||
    !credentials ||
    credentials.clientId !== 'synthetic-client' ||
    credentials.clientSecret !== 'synthetic-secret' ||
    credentials.refreshToken !== 'synthetic-refresh' ||
    Object.keys(credentials).length !== 3
  )
    throw new Error('Synthetic OAuth fixtures required');
  let cached;
  return async function token({ signal: callerSignal, forceRefresh = false } = {}) {
    callerSignal?.throwIfAborted();
    if (!forceRefresh && cached && cached.expiresAt > now() + 30000) return cached.accessToken;
    cached = undefined;
    const started = now(),
      signal = callerSignal
        ? AbortSignal.any([callerSignal, AbortSignal.timeout(120000)])
        : AbortSignal.timeout(120000);
    for (let attempt = 1; attempt <= 3; attempt++) {
      signal.throwIfAborted();
      let response;
      try {
        response = await request('https://oauth2.googleapis.com/token', {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
          body: new URLSearchParams({
            client_id: credentials.clientId,
            client_secret: credentials.clientSecret,
            refresh_token: credentials.refreshToken,
            grant_type: 'refresh_token',
          }),
        });
      } catch {
        // Generic fetch errors can represent a blocked redirect. Do not blindly retry them.
        throw new Error('Fixture authorization unavailable');
      }
      signal.throwIfAborted();
      if (!response.ok) {
        const raw = response.headers.get('retry-after');
        const retryAfterMs = raw === null ? 0 : /^\d+$/.test(raw) ? Number(raw) * 1000 : Infinity;
        const decision = retryDecision({
          stage: 'oauth-refresh',
          status: response.status,
          attempt,
          remainingMs: 120000 - (now() - started),
          retryAfterMs,
        });
        if (!decision.retry) throw new Error('Fixture authorization unavailable');
        await wait(decision.waitMs, signal);
        continue;
      }
      const body = await response.json().catch(() => {
        throw new Error('Fixture authorization metadata unavailable');
      });
      signal.throwIfAborted();
      if (
        !/^synthetic-access-[0-9]+$/.test(body.access_token || '') ||
        body.token_type !== 'Bearer' ||
        body.scope !== DRIVE_FILE_SCOPE ||
        !Number.isInteger(body.expires_in) ||
        body.expires_in <= 60 ||
        body.expires_in > 3600 ||
        body.refresh_token
      )
        throw new Error('Fixture authorization metadata mismatch');
      cached = { accessToken: body.access_token, expiresAt: now() + body.expires_in * 1000 };
      return cached.accessToken;
    }
    throw new Error('Fixture authorization unavailable');
  };
}
module.exports = {
  productionWrapperDesign,
  retryDecision,
  scratchBudget,
  reconcileUpload,
  failureEvidence,
  runObservation,
  createFixtureOAuthAdapter,
  DRIVE_FILE_SCOPE,
};
