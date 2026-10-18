'use strict';
const crypto = require('node:crypto');
const { pool } = require('../db/pool');
const { details, networkGroup, WINDOW_MS } = require('./clientCrmDetailAuth');
const { normalizeMobile } = require('./crmV2ClientService');
const { isValidOpaqueToken, randomOpaqueToken } = require('./clientBrowserSession');
const { issueStaffBrowserSession, deriveCalendarViewer } = require('./staffBrowserSession');
const {
  staffDetailAuthEnabled,
  staffDetailsMatch,
  staffDetailRevision,
} = require('./staffDetailIdentity');
const DAY_MS = 24 * 60 * 60 * 1000;
const INVALID = Object.freeze({ ok: false, code: 'STAFF_DETAIL_AUTH_INVALID' });
function createStaffDetailAuthService({
  db = pool,
  env = process.env,
  now = () => new Date(),
  randomBytes = crypto.randomBytes,
  logger = console,
} = {}) {
  const enabled = () => staffDetailAuthEnabled(env);
  const key = (value) =>
    crypto
      .createHmac('sha256', String(env.SHILOH_STAFF_DETAIL_AUTH_RATE_KEY))
      .update(value)
      .digest('hex');
  async function attempt({ input = {}, address, deviceToken, requestFingerprintHash = null } = {}) {
    if (!enabled()) return { ok: false, code: 'STAFF_DETAIL_AUTH_UNAVAILABLE' };
    input = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const network = networkGroup(address);
    if (!network) return { ok: false, code: 'STAFF_DETAIL_AUTH_UNAVAILABLE' };
    const browserToken = isValidOpaqueToken(deviceToken)
      ? deviceToken
      : randomOpaqueToken(randomBytes);
    const parsed = details(input, false);
    // Count malformed requests too. Never persist raw personal data in limiter/audit keys.
    const identity =
      parsed?.mobile ||
      normalizeMobile(typeof input.mobile === 'string' ? input.mobile.slice(0, 30) : '') ||
      'invalid';
    const buckets = [
      ['identity', identity, 6, WINDOW_MS],
      ['identity-day', identity, 40, DAY_MS],
      ['device', browserToken, 20, WINDOW_MS],
      ['network', network, 100, WINDOW_MS],
      ['global', 'clinic', 1000, WINDOW_MS],
      ['global-day', 'clinic', 5000, DAY_MS],
    ].map(([kind, value, limit, duration]) => ({
      key: key(`${kind}:${value}`),
      limit,
      duration,
      backoff: kind === 'identity' || kind === 'device',
    }));
    let client;
    try {
      client = await db.connect();
      await client.query('BEGIN');
      // Deterministic order prevents deadlocks. The global bucket serializes the shared clinic limit.
      for (const bucket of [...buckets].sort((a, b) => a.key.localeCompare(b.key))) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [bucket.key]);
      }
      // Lock wait time is ordinary contention, not backoff against an earlier timestamp.
      const current = now();
      const stored = await client.query(
        'SELECT * FROM staff_detail_auth_rate_buckets WHERE bucket_key = ANY($1::text[]) FOR UPDATE',
        [buckets.map((b) => b.key)],
      );
      const state = new Map(stored.rows.map((row) => [row.bucket_key, row]));
      const active = buckets.map((bucket) => {
        const row = state.get(bucket.key);
        const fresh =
          row && new Date(row.window_started_at).getTime() + bucket.duration > current.getTime();
        return {
          ...bucket,
          count: fresh ? Number(row.attempts) : 0,
          started: fresh ? new Date(row.window_started_at) : current,
          blockedUntil: fresh ? new Date(row.blocked_until) : current,
        };
      });
      if (active.some((b) => b.count >= b.limit || b.blockedUntil > current)) {
        await client.query('COMMIT');
        return { ok: false, code: 'STAFF_DETAIL_AUTH_RATE_LIMITED', browserToken };
      }
      for (const bucket of active) {
        const count = bucket.count + 1;
        const delay = bucket.backoff && count >= 3 ? Math.min(60, 2 ** (count - 3)) * 1000 : 0;
        await client.query(
          `INSERT INTO staff_detail_auth_rate_buckets (bucket_key,window_started_at,attempts,blocked_until,expires_at)
          VALUES($1,$2,$3,$4,$5) ON CONFLICT(bucket_key) DO UPDATE SET window_started_at=$2,attempts=$3,blocked_until=$4,expires_at=$5`,
          [
            bucket.key,
            bucket.started,
            count,
            new Date(current.getTime() + delay),
            new Date(bucket.started.getTime() + bucket.duration),
          ],
        );
      }
      // Bounded maintenance, never scans/locks an unbounded expired set on an auth request.
      await client.query(
        `DELETE FROM staff_detail_auth_rate_buckets WHERE bucket_key IN
        (SELECT bucket_key FROM staff_detail_auth_rate_buckets WHERE expires_at < $1 ORDER BY expires_at LIMIT 100)`,
        [current],
      );
      let result = INVALID;
      if (parsed) {
        // Resolve by the existing mobile authority, including inactive collisions.
        // Never self-register a Workspace identity or copy a client account.
        const found = await client.query(
          `SELECT a.*, a.active AS admin_active, s.status AS staff_status
          FROM staff_admin_accounts a LEFT JOIN staff s ON s.id=a.staff_id
          WHERE a.normalized_whatsapp=$1 ORDER BY a.id LIMIT 2 FOR UPDATE OF a`,
          [parsed.mobile],
        );
        const owner =
          found.rows.length === 1 && staffDetailsMatch(found.rows[0], parsed)
            ? found.rows[0]
            : null;
        if (owner && deriveCalendarViewer(owner) && enabled()) {
          result = await issueStaffBrowserSession({
            client,
            admin: owner,
            current,
            randomBytes,
            requestFingerprintHash,
            authMethod: 'staff_details',
          });
          await client.query(
            'UPDATE staff_browser_sessions SET detail_identity_revision=$2 WHERE id=$1',
            [result.sessionId, staffDetailRevision(owner)],
          );
          await client.query(
            `INSERT INTO staff_auth_security_events(event_type,subject_admin_id,auth_method,metadata)
            VALUES('staff_detail_authenticated',$1,'staff_details','{"assurance":"biographical_match","phoneOwnershipVerified":false}'::jsonb)`,
            [owner.id],
          );
        }
      }
      if (!result.ok)
        await client.query(`INSERT INTO staff_auth_security_events(event_type,auth_method,metadata)
        VALUES('staff_detail_auth_failed','staff_details','{}'::jsonb)`);
      await client.query('COMMIT');
      return { ...result, browserToken };
    } catch (_) {
      try {
        if (client) await client.query('ROLLBACK');
      } catch (_) {}
      logger.warn?.({ event: 'staff_detail_auth_unavailable' });
      return { ok: false, code: 'STAFF_DETAIL_AUTH_UNAVAILABLE', browserToken };
    } finally {
      client?.release();
    }
  }
  return { enabled, attempt };
}
module.exports = { createStaffDetailAuthService };
