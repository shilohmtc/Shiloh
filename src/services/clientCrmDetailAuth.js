'use strict';

const crypto = require('node:crypto');
const net = require('node:net');
const { pool } = require('../db/pool');
const crm = require('./crmV2ClientService');
const { isValidOpaqueToken, randomOpaqueToken } = require('./clientBrowserSession');

const INVALID = Object.freeze({ ok: false, code: 'CRM_AUTH_INVALID' });
const WINDOW_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const NAME_PART = /^[\p{L}\p{M}][\p{L}\p{M}.' -]{0,99}$/u;
function canonicalName(value) {
  return typeof value === 'string'
    ? value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase()
    : '';
}
function cleanPart(value) {
  if (typeof value !== 'string') return null;
  const text = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  return NAME_PART.test(text) ? text : null;
}
function details(input, register) {
  try {
    const firstName = cleanPart(input.firstName);
    const surname = cleanPart(input.surname);
    const mobile =
      typeof input.mobile === 'string' && /^[+\d ()-]{10,30}$/.test(input.mobile)
        ? crm.normalizeMobile(input.mobile)
        : null;
    const dateOfBirth = crm.normalizeDateOfBirth(input.dateOfBirth, { required: true });
    const gender = register ? crm.normalizeGender(input.gender, { required: true }) : null;
    const name = firstName && surname ? crm.normalizeName(`${firstName} ${surname}`) : null;
    return name && mobile ? { firstName, surname, mobile, dateOfBirth, gender, name } : null;
  } catch (_) {
    return null;
  }
}
function dateOnly(value) {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value || '').slice(0, 10);
}
function matches(row, input) {
  if (
    !row ||
    row.status !== 'active' ||
    !row.date_of_birth ||
    row.normalized_mobile !== input.mobile ||
    dateOnly(row.date_of_birth) !== input.dateOfBirth ||
    canonicalName(row.name) !== canonicalName(input.name)
  )
    return false;
  // Old records have a single full name: compare the supplied combined value, never guess a split.
  if (row.first_name != null || row.surname != null) {
    return (
      canonicalName(row.first_name) === canonicalName(input.firstName) &&
      canonicalName(row.surname) === canonicalName(input.surname)
    );
  }
  return true;
}
function networkGroup(address) {
  const text = String(address || '')
    .replace(/^::ffff:/, '')
    .split('%')[0];
  if (net.isIP(text) === 4) return text;
  if (net.isIP(text) === 6) {
    // URL canonicalization expands consistently enough to retain the /64 prefix; do not trust forwarded headers here.
    const host = new URL(`http://[${text}]/`).hostname.slice(1, -1);
    const halves = host.split('::');
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves[1] ? halves[1].split(':') : [];
    const words =
      halves.length === 2
        ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
        : left;
    return words
      .slice(0, 4)
      .map((word) => word.padStart(4, '0'))
      .join(':');
  }
  return null;
}

function createClientCrmDetailAuthService({
  db = pool,
  env = process.env,
  sessionService,
  now = () => new Date(),
  randomBytes = crypto.randomBytes,
  logger = console,
} = {}) {
  const enabled = () =>
    env.MY_SHILOH_CRM_AUTH_ENABLED === 'true' &&
    Buffer.byteLength(String(env.MY_SHILOH_CRM_AUTH_RATE_KEY || '')) >= 32 &&
    typeof sessionService?.issueCrmDetailSession === 'function';
  const key = (value) =>
    crypto
      .createHmac('sha256', String(env.MY_SHILOH_CRM_AUTH_RATE_KEY))
      .update(value)
      .digest('hex');

  async function attempt({
    input = {},
    register = false,
    address,
    deviceToken,
    requestFingerprintHash = null,
  } = {}) {
    if (!enabled()) return { ok: false, code: 'CRM_AUTH_UNAVAILABLE' };
    const network = networkGroup(address);
    if (!network) return { ok: false, code: 'CRM_AUTH_UNAVAILABLE' };
    const browserToken = isValidOpaqueToken(deviceToken)
      ? deviceToken
      : randomOpaqueToken(randomBytes);
    const parsed = details(input, register);
    // Count malformed requests too. Never persist raw personal data in limiter/audit keys.
    const identity =
      parsed?.mobile ||
      crm.normalizeMobile(typeof input.mobile === 'string' ? input.mobile.slice(0, 30) : '') ||
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
        'SELECT * FROM client_crm_auth_rate_buckets WHERE bucket_key = ANY($1::text[]) FOR UPDATE',
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
        return { ok: false, code: 'CRM_AUTH_RATE_LIMITED', browserToken };
      }
      for (const bucket of active) {
        const count = bucket.count + 1;
        const delay = bucket.backoff && count >= 3 ? Math.min(60, 2 ** (count - 3)) * 1000 : 0;
        await client.query(
          `INSERT INTO client_crm_auth_rate_buckets (bucket_key,window_started_at,attempts,blocked_until,expires_at)
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
        `DELETE FROM client_crm_auth_rate_buckets WHERE bucket_key IN
        (SELECT bucket_key FROM client_crm_auth_rate_buckets WHERE expires_at < $1 ORDER BY expires_at LIMIT 100)`,
        [current],
      );
      await client.query('SAVEPOINT identity_operation');
      let result = INVALID;
      try {
        if (parsed) {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
            `crm-v2-mobile:${parsed.mobile}`,
          ]);
          const found = await client.query(
            'SELECT * FROM crm_v2_clients WHERE normalized_mobile=$1 LIMIT 2 FOR UPDATE',
            [parsed.mobile],
          );
          let owner =
            found.rows.length === 1 && matches(found.rows[0], parsed) ? found.rows[0] : null;
          if (register && found.rows.length === 0) {
            // Serialize explicit registrations so a typo in a phone cannot create the same name/DOB twice.
            await client.query(
              "SELECT pg_advisory_xact_lock(hashtextextended('crm-detail-registration',0))",
            );
            const candidates = await client.query(
              'SELECT name FROM crm_v2_clients WHERE date_of_birth=$1::date LIMIT 51',
              [parsed.dateOfBirth],
            );
            const collision =
              candidates.rows.length > 50 ||
              candidates.rows.some((row) => canonicalName(row.name) === canonicalName(parsed.name));
            if (!collision) {
              const inserted = await client.query(
                `INSERT INTO crm_v2_clients
              (name,first_name,surname,normalized_mobile,date_of_birth,gender,profile_status,mobile_verified_at,source,status,provenance)
              VALUES($1,$2,$3,$4,$5::date,$6,'registered',NULL,'my_shiloh_crm','active',$7::jsonb) RETURNING *`,
                [
                  parsed.name,
                  parsed.firstName,
                  parsed.surname,
                  parsed.mobile,
                  parsed.dateOfBirth,
                  parsed.gender,
                  JSON.stringify({
                    createdVia: 'my_shiloh_crm',
                    identityAssurance: 'self_reported',
                    phoneOwnershipVerified: false,
                  }),
                ],
              );
              owner = inserted.rows[0];
            }
          }
          if (owner)
            result = await sessionService.issueCrmDetailSession({
              transaction: client,
              owner,
              requestFingerprintHash,
            });
        }
      } catch (error) {
        if (error.code !== '23505') throw error;
        await client.query('ROLLBACK TO SAVEPOINT identity_operation');
        result = INVALID;
      }
      // No submitted names/DOB/mobile, matched client IDs or match reasons on failed attempts.
      if (!result.ok)
        await client.query(`INSERT INTO client_auth_security_events(event_type,metadata)
        VALUES('crm_detail_auth_failed','{"assurance":"biographical_match"}'::jsonb)`);
      await client.query('COMMIT');
      return { ...result, browserToken };
    } catch (error) {
      try {
        if (client) await client.query('ROLLBACK');
      } catch (_) {}
      // DB uniqueness races must not disclose the conflicting account.
      if (error.code === '23505') return { ...INVALID, browserToken };
      logger.warn?.({
        event: 'crm_detail_auth_unavailable',
        category: error.code === '42P01' || error.code === '42703' ? 'schema' : 'database',
      });
      // Fail closed, redact driver diagnostics (may contain submitted field values).
      return { ok: false, code: 'CRM_AUTH_UNAVAILABLE', browserToken };
    } finally {
      client?.release();
    }
  }
  return { enabled, attempt };
}
module.exports = {
  createClientCrmDetailAuthService,
  canonicalName,
  details,
  matches,
  networkGroup,
  WINDOW_MS,
};
