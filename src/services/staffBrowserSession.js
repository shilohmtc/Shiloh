const crypto = require('crypto');
const {
  CALENDAR_CAPABILITIES,
  evaluateCalendarAuthority,
  hasCapability,
} = require('./calendarAuthorization');

const DEFAULT_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const RECENT_AUTH_TTL_MS = 10 * 60 * 1000;
const CHALLENGE_ISSUE_WINDOW_MS = 10 * 60 * 1000;
const CHALLENGE_ISSUE_LIMIT = 3;
const MAX_CHALLENGE_ATTEMPTS = 5;
const CHALLENGE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SESSION_TOKEN_BYTES = 32;
const CSRF_TOKEN_BYTES = 32;

function normalizeWhatsapp(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function safeHashEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function randomOpaqueToken(randomBytes = crypto.randomBytes, bytes = SESSION_TOKEN_BYTES) {
  return randomBytes(bytes).toString('base64url');
}

function randomChallengeCode(randomBytes = crypto.randomBytes) {
  const source = randomBytes(10);
  let code = '';
  for (let i = 0; i < 10; i += 1) code += CHALLENGE_ALPHABET[source[i] % CHALLENGE_ALPHABET.length];
  return code;
}

function isValidChallengeCode(value) {
  return new RegExp(`^[${CHALLENGE_ALPHABET}]{10}$`).test(String(value || '').trim().toUpperCase());
}

function isValidSessionToken(value) {
  return /^[A-Za-z0-9_-]{43}$/.test(String(value || ''));
}

function isValidCsrfToken(value) {
  return /^[A-Za-z0-9_-]{43}$/.test(String(value || ''));
}

function isRecentAuthentication(session, current = new Date(), ttlMs = RECENT_AUTH_TTL_MS) {
  if (!session?.ok || session.recoveryRequired === true) return false;
  const authenticatedAt = new Date(session.authenticatedAt);
  const currentAt = current instanceof Date ? current : new Date(current);
  if (!Number.isFinite(authenticatedAt.getTime()) || !Number.isFinite(currentAt.getTime())) return false;
  const age = currentAt.getTime() - authenticatedAt.getTime();
  return age >= 0 && age <= ttlMs;
}

function deriveCalendarViewer(admin) {
  const authority = evaluateCalendarAuthority(admin || {});
  if (!authority) return null;

  // #900: Calendar read is a baseline Workspace capability for every active linked
  // staff member. Existing non-staff admin/reception identities still require the
  // explicit appointment:view capability. This broadens read visibility only;
  // booking and operational mutation services continue to evaluate the persisted
  // capabilities and calendar/service scopes independently.
  const activeLinkedStaff = Number.isSafeInteger(Number(authority.linkedStaffId))
    && Number(authority.linkedStaffId) > 0;
  if (!activeLinkedStaff && !hasCapability(authority, CALENDAR_CAPABILITIES.VIEW)) return null;

  return { calendarScope: 'business_all_staff' };
}

function deriveAccountPrincipal(admin) {
  if (!admin || !Number.isSafeInteger(Number(admin.id)) || Number(admin.id) <= 0) return null;
  return {
    id: Number(admin.id),
    role: String(admin.role || ''),
    businessRole: String(admin.business_role || admin.businessRole || ''),
    linkedStaffId: admin.staff_id == null ? (admin.linkedStaffId == null ? null : Number(admin.linkedStaffId)) : Number(admin.staff_id),
    calendarScope: String(admin.calendar_scope || admin.calendarScope || ''),
    serviceScope: String(admin.service_scope || admin.serviceScope || ''),
  };
}

async function issueStaffBrowserSession({
  client,
  admin,
  current,
  randomBytes = crypto.randomBytes,
  sessionTtlMs = DEFAULT_SESSION_TTL_MS,
  requestFingerprintHash = null,
  authMethod = 'whatsapp_otp',
  recoveryRequired = false,
} = {}) {
  if (!client || typeof client.query !== 'function') throw new Error('staff browser session transaction is required');
  if (!admin || !Number.isSafeInteger(Number(admin.id)) || Number(admin.id) <= 0) throw new Error('canonical staff Admin is required');
  const authenticatedAt = current instanceof Date ? current : new Date(current);
  const sessionToken = randomOpaqueToken(randomBytes, SESSION_TOKEN_BYTES);
  const csrfToken = randomOpaqueToken(randomBytes, CSRF_TOKEN_BYTES);
  const sessionHash = sha256(sessionToken);
  const csrfHash = sha256(csrfToken);
  const expiresAt = new Date(authenticatedAt.getTime() + sessionTtlMs);

  const previousResult = await client.query(
    `SELECT id
       FROM staff_browser_sessions
      WHERE admin_id = $1
        AND revoked_at IS NULL
      ORDER BY issued_at DESC, id DESC
      LIMIT 1
      FOR UPDATE`,
    [admin.id]
  );
  const previousSessionId = previousResult.rows[0]?.id || null;
  await client.query(
    `UPDATE staff_browser_sessions
        SET revoked_at = $2,
            revoke_reason = 'rotated'
      WHERE admin_id = $1
        AND revoked_at IS NULL`,
    [admin.id, authenticatedAt]
  );
  const insertedSession = await client.query(
    `INSERT INTO staff_browser_sessions
       (admin_id, token_hash, csrf_hash, issued_at, expires_at, rotated_from_session_id,
        client_fingerprint_hash, auth_method, reauthenticated_at, recovery_required)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $4, $9)
     RETURNING id`,
    [admin.id, sessionHash, csrfHash, authenticatedAt, expiresAt, previousSessionId,
      requestFingerprintHash, authMethod, recoveryRequired]
  );
  return {
    ok: true,
    sessionToken,
    csrfToken,
    sessionId: insertedSession.rows[0].id,
    expiresAt,
    viewer: recoveryRequired ? null : deriveCalendarViewer(admin),
    recoveryRequired,
  };
}

function createStaffBrowserSessionService({
  db,
  now = () => new Date(),
  randomBytes = crypto.randomBytes,
  challengeDispatcher = null,
  challengeTtlMs = DEFAULT_CHALLENGE_TTL_MS,
  sessionTtlMs = DEFAULT_SESSION_TTL_MS,
} = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('staff browser session db is required');

  async function beginChallenge({ whatsapp, requestFingerprintHash = null } = {}) {
    if (typeof challengeDispatcher !== 'function') {
      return { ok: false, code: 'STAFF_AUTH_DELIVERY_DISABLED' };
    }
    const normalized = normalizeWhatsapp(whatsapp);
    if (!normalized) return { ok: true, accepted: true, delivered: false };

    const adminResult = await db.query(
      `SELECT id, whatsapp_number
         FROM staff_admin_accounts
        WHERE normalized_whatsapp = $1
          AND active = TRUE
        LIMIT 1`,
      [normalized]
    );
    const admin = adminResult.rows[0];
    if (!admin) return { ok: true, accepted: true, delivered: false };

    const current = now();
    const since = new Date(current.getTime() - CHALLENGE_ISSUE_WINDOW_MS);
    const code = randomChallengeCode(randomBytes);
    const challengeHash = sha256(code);
    const expiresAt = new Date(current.getTime() + challengeTtlMs);

    const client = typeof db.connect === 'function' ? await db.connect() : db;
    let challengeId;
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('staff-browser-auth:' || $1::text, 0))`, [admin.id]);
      const countResult = await client.query(
        `SELECT COUNT(*)::int AS count
           FROM staff_browser_auth_challenges
          WHERE admin_id = $1
            AND created_at >= $2`,
        [admin.id, since]
      );
      if (Number(countResult.rows[0]?.count || 0) >= CHALLENGE_ISSUE_LIMIT) {
        await client.query('ROLLBACK');
        return { ok: true, accepted: true, delivered: false, rateLimited: true };
      }
      await client.query(
        `UPDATE staff_browser_auth_challenges
            SET revoked_at = $2
          WHERE admin_id = $1
            AND consumed_at IS NULL
            AND revoked_at IS NULL`,
        [admin.id, current]
      );
      const inserted = await client.query(
        `INSERT INTO staff_browser_auth_challenges
           (admin_id, challenge_hash, expires_at, max_attempts, request_fingerprint_hash)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [admin.id, challengeHash, expiresAt, MAX_CHALLENGE_ATTEMPTS, requestFingerprintHash]
      );
      challengeId = inserted.rows[0].id;
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      if (client !== db && typeof client.release === 'function') client.release();
    }

    try {
      await challengeDispatcher({ destination: admin.whatsapp_number, code, expiresAt });
    } catch (error) {
      await db.query(
        `UPDATE staff_browser_auth_challenges
            SET revoked_at = COALESCE(revoked_at, $2)
          WHERE id = $1`,
        [challengeId, now()]
      );
      return { ok: false, code: 'STAFF_AUTH_DELIVERY_FAILED' };
    }

    return { ok: true, accepted: true, delivered: true };
  }

  async function verifyChallenge({ whatsapp, code, requestFingerprintHash = null } = {}) {
    const normalized = normalizeWhatsapp(whatsapp);
    const normalizedCode = String(code || '').trim().toUpperCase();
    if (!normalized || !isValidChallengeCode(normalizedCode)) return { ok: false, code: 'STAFF_AUTH_INVALID_CHALLENGE' };

    const current = now();
    const codeHash = sha256(normalizedCode);

    const client = typeof db.connect === 'function' ? await db.connect() : db;
    try {
      await client.query('BEGIN');
      const adminResult = await client.query(
        `SELECT a.id, a.staff_id, a.role, a.business_role, a.calendar_scope, a.service_scope,
                a.permissions, a.active AS admin_active, s.status AS staff_status
           FROM staff_admin_accounts a
           LEFT JOIN staff s ON s.id = a.staff_id
          WHERE a.normalized_whatsapp = $1
            AND a.active = TRUE
          LIMIT 1
          FOR UPDATE OF a`,
        [normalized]
      );
      const admin = adminResult.rows[0];
      if (!admin) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'STAFF_AUTH_INVALID_CHALLENGE' };
      }

      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('staff-browser-auth:' || $1::text, 0))`, [admin.id]);
      const challengeResult = await client.query(
        `SELECT id, challenge_hash, expires_at, attempt_count, max_attempts
           FROM staff_browser_auth_challenges
          WHERE admin_id = $1
            AND consumed_at IS NULL
            AND revoked_at IS NULL
          ORDER BY created_at DESC, id DESC
          LIMIT 1
          FOR UPDATE`,
        [admin.id]
      );
      const challenge = challengeResult.rows[0];
      if (!challenge) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'STAFF_AUTH_INVALID_CHALLENGE' };
      }

      if (new Date(challenge.expires_at).getTime() <= current.getTime()) {
        await client.query(`UPDATE staff_browser_auth_challenges SET revoked_at = $2 WHERE id = $1`, [challenge.id, current]);
        await client.query('COMMIT');
        return { ok: false, code: 'STAFF_AUTH_INVALID_CHALLENGE' };
      }

      const nextAttempts = Number(challenge.attempt_count || 0) + 1;
      if (!safeHashEqual(codeHash, challenge.challenge_hash)) {
        await client.query(
          `UPDATE staff_browser_auth_challenges
              SET attempt_count = $2,
                  last_attempt_at = $3,
                  revoked_at = CASE WHEN $2 >= max_attempts THEN $3 ELSE revoked_at END
            WHERE id = $1`,
          [challenge.id, nextAttempts, current]
        );
        await client.query('COMMIT');
        return { ok: false, code: 'STAFF_AUTH_INVALID_CHALLENGE' };
      }

      if (nextAttempts > Number(challenge.max_attempts || MAX_CHALLENGE_ATTEMPTS)) {
        await client.query(`UPDATE staff_browser_auth_challenges SET revoked_at = $2 WHERE id = $1`, [challenge.id, current]);
        await client.query('COMMIT');
        return { ok: false, code: 'STAFF_AUTH_INVALID_CHALLENGE' };
      }

      await client.query(
        `UPDATE staff_browser_auth_challenges
            SET consumed_at = $2,
                attempt_count = $3,
                last_attempt_at = $2
          WHERE id = $1`,
        [challenge.id, current, nextAttempts]
      );
      const issued = await issueStaffBrowserSession({
        client,
        admin,
        current,
        randomBytes,
        sessionTtlMs,
        requestFingerprintHash,
        authMethod: 'whatsapp_otp',
      });
      await client.query('COMMIT');
      return issued;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      if (client !== db && typeof client.release === 'function') client.release();
    }
  }

  async function validateSessionToken(token) {
    if (!isValidSessionToken(token)) return { ok: false, code: 'STAFF_SESSION_INVALID' };
    const tokenHash = sha256(token);
    const result = await db.query(
      `SELECT bs.id AS session_id, bs.admin_id, bs.csrf_hash, bs.issued_at, bs.expires_at, bs.revoked_at,
              bs.auth_method, bs.reauthenticated_at, bs.recovery_required,
              a.id, a.staff_id, a.role, a.business_role, a.calendar_scope, a.service_scope,
              a.permissions, a.active AS admin_active, s.status AS staff_status
         FROM staff_browser_sessions bs
         JOIN staff_admin_accounts a ON a.id = bs.admin_id
         LEFT JOIN staff s ON s.id = a.staff_id
        WHERE bs.token_hash = $1
        LIMIT 1`,
      [tokenHash]
    );
    const row = result.rows[0];
    const current = now();
    const linkedStaffInactive = row?.staff_id != null && row.staff_status !== 'active';
    if (!row || row.revoked_at || row.admin_active !== true || linkedStaffInactive || new Date(row.expires_at).getTime() <= current.getTime()) {
      return { ok: false, code: 'STAFF_SESSION_INVALID' };
    }

    await db.query(
      `UPDATE staff_browser_sessions
          SET last_used_at = $2
        WHERE id = $1
          AND revoked_at IS NULL
          AND expires_at > $2
          AND (last_used_at IS NULL OR last_used_at < $2 - INTERVAL '5 minutes')`,
      [row.session_id, current]
    );
    const recoveryRequired = row.recovery_required === true;
    return {
      ok: true,
      sessionId: row.session_id,
      adminId: row.admin_id,
      csrfHash: row.csrf_hash,
      authenticatedAt: row.reauthenticated_at || row.issued_at,
      authMethod: row.auth_method || 'whatsapp_otp',
      recoveryRequired,
      viewer: recoveryRequired ? null : deriveCalendarViewer(row),
      accountPrincipal: recoveryRequired ? null : deriveAccountPrincipal(row),
    };
  }

  async function rotateCsrfToken(sessionId) {
    const csrfToken = randomOpaqueToken(randomBytes, CSRF_TOKEN_BYTES);
    const csrfHash = sha256(csrfToken);
    const current = now();
    const result = await db.query(
      `UPDATE staff_browser_sessions
          SET csrf_hash = $2,
              last_used_at = $3
        WHERE id = $1
          AND revoked_at IS NULL
          AND expires_at > $3
      RETURNING id`,
      [sessionId, csrfHash, current]
    );
    if (!result.rowCount) return { ok: false, code: 'STAFF_SESSION_INVALID' };
    return { ok: true, csrfToken, csrfHash };
  }

  async function revokeSession(sessionId, reason = 'logout') {
    const current = now();
    const result = await db.query(
      `UPDATE staff_browser_sessions
          SET revoked_at = COALESCE(revoked_at, $2),
              revoke_reason = CASE WHEN revoked_at IS NULL THEN $3 ELSE revoke_reason END
        WHERE id = $1
      RETURNING id`,
      [sessionId, current, String(reason || 'logout').slice(0, 40)]
    );
    return { ok: result.rowCount > 0 };
  }

  async function revokeAllForAdmin(adminId, reason = 'authority_revoked') {
    const current = now();
    const result = await db.query(
      `UPDATE staff_browser_sessions
          SET revoked_at = COALESCE(revoked_at, $2),
              revoke_reason = CASE WHEN revoked_at IS NULL THEN $3 ELSE revoke_reason END
        WHERE admin_id = $1
          AND revoked_at IS NULL`,
      [adminId, current, String(reason || 'authority_revoked').slice(0, 40)]
    );
    return { ok: true, revokedCount: result.rowCount };
  }

  function validateCsrfToken(session, suppliedToken) {
    if (!session?.ok || !isValidCsrfToken(suppliedToken)) return false;
    return safeHashEqual(sha256(suppliedToken), session.csrfHash);
  }

  return {
    beginChallenge,
    verifyChallenge,
    validateSessionToken,
    rotateCsrfToken,
    revokeSession,
    revokeAllForAdmin,
    validateCsrfToken,
  };
}

module.exports = {
  CHALLENGE_ISSUE_LIMIT,
  CHALLENGE_ISSUE_WINDOW_MS,
  MAX_CHALLENGE_ATTEMPTS,
  DEFAULT_CHALLENGE_TTL_MS,
  DEFAULT_SESSION_TTL_MS,
  RECENT_AUTH_TTL_MS,
  normalizeWhatsapp,
  sha256,
  safeHashEqual,
  randomOpaqueToken,
  randomChallengeCode,
  isValidChallengeCode,
  isValidSessionToken,
  isValidCsrfToken,
  isRecentAuthentication,
  deriveCalendarViewer,
  deriveAccountPrincipal,
  issueStaffBrowserSession,
  createStaffBrowserSessionService,
};
