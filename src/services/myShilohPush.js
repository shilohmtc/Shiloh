'use strict';

const crypto = require('crypto');
const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');
const { pool } = require('../db/pool');
const logger = require('../lib/logger');

const CATEGORIES = new Set(['appointment','forms','payment','voucher','rewards','system']);
const MAX_PENDING = 5;
const NOTIFICATION_TTL_DAYS = 7;
const DEFAULT_PUSH_TIMEOUT_MS = 5000;
const MIN_PUSH_TIMEOUT_MS = 1000;
const MAX_PUSH_TIMEOUT_MS = 15000;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function cleanText(value, max, label) {
  const text = String(value || '').trim();
  if (!text || text.length > max) throw new Error(`${label} is required and must be ${max} characters or fewer`);
  return text;
}

function safeTargetPath(value) {
  const path = String(value || '').trim();
  if (!/^\/my-shiloh(?:\/|$)/.test(path)) throw new Error('My Shiloh notification target must stay inside My Shiloh');
  return path;
}

function cleanHostname(value) {
  return String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function validEndpoint(value) {
  try {
    const url = new URL(String(value || ''));
    const hostname = cleanHostname(url.hostname);
    if (url.protocol !== 'https:' || !hostname || url.username || url.password) return null;
    if (url.port && url.port !== '443') return null;
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || net.isIP(hostname)) return null;
    return url.toString();
  } catch (_) {
    return null;
  }
}

function isUnsafeIpv4(address) {
  const parts = String(address || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 2)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function isUnsafeIpv6(address) {
  const normalized = String(address || '').toLowerCase();
  if (!normalized) return true;
  if (normalized === '::' || normalized === '::1' || normalized.startsWith('::ffff:')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith('ff') || normalized.startsWith('2001:db8:')) return true;
  return false;
}

function isUnsafeNetworkAddress(address) {
  const family = net.isIP(String(address || ''));
  if (family === 4) return isUnsafeIpv4(address);
  if (family === 6) return isUnsafeIpv6(address);
  return true;
}

function boundedPushTimeoutMs(env = process.env) {
  const requested = Number(env.MY_SHILOH_PUSH_TIMEOUT_MS || DEFAULT_PUSH_TIMEOUT_MS);
  if (!Number.isFinite(requested)) return DEFAULT_PUSH_TIMEOUT_MS;
  return Math.min(Math.max(Math.trunc(requested), MIN_PUSH_TIMEOUT_MS), MAX_PUSH_TIMEOUT_MS);
}

async function resolveSafePushEndpoint(endpoint, resolveHost = (...args) => dns.lookup(...args)) {
  const cleanEndpoint = validEndpoint(endpoint);
  if (!cleanEndpoint) throw Object.assign(new Error('Push endpoint is not allowed'), { code: 'PUSH_ENDPOINT_INVALID' });
  const url = new URL(cleanEndpoint);
  const hostname = cleanHostname(url.hostname);
  let addresses;
  try {
    addresses = await resolveHost(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw Object.assign(new Error('Push endpoint could not be resolved'), { code: 'PUSH_ENDPOINT_RESOLUTION_FAILED', cause: error });
  }
  const resolved = Array.isArray(addresses) ? addresses : [addresses];
  if (!resolved.length || resolved.some(item => !item?.address || isUnsafeNetworkAddress(item.address))) {
    throw Object.assign(new Error('Push endpoint resolved to an unsafe network address'), { code: 'PUSH_ENDPOINT_UNSAFE' });
  }
  const selected = resolved[0];
  return { url, address: selected.address, family: Number(selected.family) || net.isIP(selected.address) };
}

function timeoutError(code, message) {
  return Object.assign(new Error(message), { code });
}

function createPinnedLookup(address, family) {
  return (_hostname, options, callback) => {
    if (options?.all) return callback(null, [{ address, family }]);
    return callback(null, address, family);
  };
}

async function safePushRequest(endpoint, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_PUSH_TIMEOUT_MS;
  let resolutionTimer;
  const resolved = await Promise.race([
    resolveSafePushEndpoint(endpoint, options.resolveHost || ((...args) => dns.lookup(...args))),
    new Promise((_, reject) => {
      resolutionTimer = setTimeout(() => reject(timeoutError('PUSH_RESOLUTION_TIMEOUT', 'Push endpoint resolution timed out')), timeoutMs);
      resolutionTimer.unref?.();
    }),
  ]).finally(() => clearTimeout(resolutionTimer));

  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: 'https:',
      hostname: resolved.url.hostname,
      port: 443,
      path: `${resolved.url.pathname}${resolved.url.search}`,
      method: 'POST',
      headers: options.headers || {},
      servername: cleanHostname(resolved.url.hostname),
      lookup: createPinnedLookup(resolved.address, resolved.family),
    }, response => {
      clearTimeout(totalTimer);
      response.resume();
      const status = Number(response.statusCode) || 0;
      resolve({ ok: status >= 200 && status < 300, status });
    });
    const totalTimer = setTimeout(() => {
      request.destroy(timeoutError('PUSH_REQUEST_TIMEOUT', 'Push request timed out'));
    }, timeoutMs);
    totalTimer.unref?.();
    request.once('error', error => {
      clearTimeout(totalTimer);
      reject(error);
    });
    request.end();
  });
}

function parseVapid(env = process.env) {
  const publicKey = String(env.MY_SHILOH_VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(env.MY_SHILOH_VAPID_PRIVATE_KEY || '').trim();
  const subject = String(env.MY_SHILOH_VAPID_SUBJECT || '').trim();
  if (!publicKey || !privateKey || !subject) return null;
  if (!/^(mailto:.+@.+|https:\/\/[^\s]+)$/i.test(subject)) throw new Error('MY_SHILOH_VAPID_SUBJECT must be a mailto: or https: contact');
  const publicBytes = Buffer.from(publicKey, 'base64url');
  const privateBytes = Buffer.from(privateKey, 'base64url');
  if (publicBytes.length !== 65 || publicBytes[0] !== 4 || privateBytes.length !== 32) {
    throw new Error('My Shiloh VAPID keys are invalid');
  }
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(privateBytes);
  const derived = ecdh.getPublicKey(null, 'uncompressed');
  if (!crypto.timingSafeEqual(publicBytes, derived)) throw new Error('My Shiloh VAPID key pair does not match');
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: base64url(publicBytes.subarray(1, 33)),
    y: base64url(publicBytes.subarray(33, 65)),
    d: base64url(privateBytes),
  };
  return {
    publicKey,
    subject,
    signingKey: crypto.createPrivateKey({ key: jwk, format: 'jwk' }),
  };
}

function vapidAuthorization(endpoint, vapid, now = () => new Date()) {
  const target = new URL(endpoint);
  const header = base64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = base64url(JSON.stringify({
    aud: `${target.protocol}//${target.host}`,
    exp: Math.floor(now().getTime() / 1000) + (12 * 60 * 60),
    sub: vapid.subject,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = crypto.sign('sha256', Buffer.from(unsigned), {
    key: vapid.signingKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${unsigned}.${base64url(signature)}, k=${vapid.publicKey}`;
}

function createMyShilohPushService({
  db = pool,
  env = process.env,
  fetchImpl = safePushRequest,
  resolveHost = (...args) => dns.lookup(...args),
  now = () => new Date(),
} = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('My Shiloh push database is required');

  function config() {
    try {
      const vapid = parseVapid(env);
      return { configured: Boolean(vapid), publicKey: vapid?.publicKey || null };
    } catch (error) {
      logger.error({ err: error }, 'My Shiloh push configuration is invalid');
      return { configured: false, publicKey: null };
    }
  }

  async function audit(action, clientId, metadata = {}) {
    try {
      await db.query(
        `INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
         VALUES($1,'crm_v2_client',$2,$3::jsonb)`,
        [action, Number(clientId), JSON.stringify(metadata)],
      );
    } catch (error) {
      logger.warn({ err: error, clientId, action }, 'My Shiloh push audit write failed');
    }
  }

  async function subscribe({ crmV2ClientId, endpoint, p256dh, auth, userAgent = null } = {}) {
    const clientId = Number(crmV2ClientId);
    const cleanEndpoint = validEndpoint(endpoint);
    if (!Number.isSafeInteger(clientId) || clientId <= 0 || !cleanEndpoint) throw new Error('A valid My Shiloh client and push endpoint are required');
    const key = cleanText(p256dh, 256, 'Push key');
    const authSecret = cleanText(auth, 128, 'Push auth secret');
    const result = await db.query(
      `INSERT INTO my_shiloh_push_subscriptions
         (crm_v2_client_id,endpoint,p256dh,auth,user_agent,enabled,revoked_at,updated_at)
       VALUES($1,$2,$3,$4,$5,TRUE,NULL,$6)
       ON CONFLICT (endpoint) DO UPDATE SET
         crm_v2_client_id=EXCLUDED.crm_v2_client_id,
         p256dh=EXCLUDED.p256dh,
         auth=EXCLUDED.auth,
         user_agent=EXCLUDED.user_agent,
         enabled=TRUE,
         revoked_at=NULL,
         updated_at=EXCLUDED.updated_at,
         last_push_error=NULL
       RETURNING id`,
      [clientId, cleanEndpoint, key, authSecret, String(userAgent || '').slice(0, 500) || null, now()],
    );
    await audit('my_shiloh.push_enabled', clientId, { subscriptionId: Number(result.rows[0].id) });
    return { enabled: true };
  }

  async function unsubscribe({ crmV2ClientId, endpoint } = {}) {
    const clientId = Number(crmV2ClientId);
    const cleanEndpoint = validEndpoint(endpoint);
    if (!Number.isSafeInteger(clientId) || clientId <= 0 || !cleanEndpoint) return { enabled: false };
    const result = await db.query(
      `UPDATE my_shiloh_push_subscriptions
          SET enabled=FALSE,revoked_at=COALESCE(revoked_at,$3),updated_at=$3
        WHERE crm_v2_client_id=$1 AND endpoint=$2 AND revoked_at IS NULL
        RETURNING id`,
      [clientId, cleanEndpoint, now()],
    );
    if (result.rowCount) await audit('my_shiloh.push_disabled', clientId, { subscriptionId: Number(result.rows[0].id) });
    return { enabled: false };
  }

  async function markPushResult(subscriptionId, { status, error = null, revoke = false } = {}) {
    await db.query(
      `UPDATE my_shiloh_push_subscriptions
          SET last_push_at=$2,last_push_status=$3,last_push_error=$4,
              enabled=CASE WHEN $5 THEN FALSE ELSE enabled END,
              revoked_at=CASE WHEN $5 THEN COALESCE(revoked_at,$2) ELSE revoked_at END,
              updated_at=$2
        WHERE id=$1`,
      [Number(subscriptionId), now(), String(status || '').slice(0, 40), error ? String(error).slice(0, 500) : null, Boolean(revoke)],
    );
  }

  async function wakeSubscription(subscription, vapid) {
    if (typeof fetchImpl !== 'function') return { ok: false, reason: 'fetch_unavailable' };
    try {
      const response = await fetchImpl(subscription.endpoint, {
        method: 'POST',
        headers: {
          Authorization: vapidAuthorization(subscription.endpoint, vapid, now),
          TTL: '300',
          Urgency: 'normal',
        },
        resolveHost,
        timeoutMs: boundedPushTimeoutMs(env),
      });
      if (response.ok) {
        await markPushResult(subscription.id, { status: `accepted_${response.status}` });
        return { ok: true };
      }
      const revoke = response.status === 404 || response.status === 410;
      await markPushResult(subscription.id, { status: `rejected_${response.status}`, error: `push service returned ${response.status}`, revoke });
      return { ok: false, reason: revoke ? 'subscription_gone' : 'push_rejected' };
    } catch (error) {
      await markPushResult(subscription.id, { status: 'network_error', error: error.message || 'network error' });
      logger.warn({ err: error, subscriptionId: subscription.id }, 'My Shiloh push wake failed');
      return { ok: false, reason: 'network_error' };
    }
  }

  async function wakeClient(crmV2ClientId) {
    let vapid;
    try { vapid = parseVapid(env); } catch (error) {
      logger.error({ err: error }, 'My Shiloh push configuration is invalid');
      return { configured: false, attempted: 0, accepted: 0 };
    }
    if (!vapid) return { configured: false, attempted: 0, accepted: 0 };
    const subscriptions = await db.query(
      `SELECT id,endpoint
         FROM my_shiloh_push_subscriptions
        WHERE crm_v2_client_id=$1 AND enabled=TRUE AND revoked_at IS NULL
        ORDER BY id`,
      [Number(crmV2ClientId)],
    );
    let accepted = 0;
    for (const subscription of subscriptions.rows) {
      const result = await wakeSubscription(subscription, vapid);
      if (result.ok) accepted += 1;
    }
    return { configured: true, attempted: subscriptions.rowCount, accepted };
  }

  async function queueNotification({
    crmV2ClientId,
    eventKey,
    category,
    title,
    body,
    targetPath = '/my-shiloh/',
  } = {}) {
    const clientId = Number(crmV2ClientId);
    if (!Number.isSafeInteger(clientId) || clientId <= 0) return { queued: false, reason: 'client_unavailable' };
    const cleanCategory = String(category || '').trim();
    if (!CATEGORIES.has(cleanCategory)) throw new Error('Unsupported My Shiloh push category');
    const key = cleanText(eventKey, 180, 'Push event key');
    const cleanTitle = cleanText(title, 120, 'Push title');
    const cleanBody = cleanText(body, 240, 'Push body');
    const path = safeTargetPath(targetPath);
    const inserted = await db.query(
      `INSERT INTO my_shiloh_push_notifications
         (crm_v2_client_id,event_key,category,title,body,target_path,created_at,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$7 + ($8 * INTERVAL '1 day'))
       ON CONFLICT (event_key) DO NOTHING
       RETURNING id`,
      [clientId, key, cleanCategory, cleanTitle, cleanBody, path, now(), NOTIFICATION_TTL_DAYS],
    );
    if (!inserted.rowCount) return { queued: false, duplicate: true };
    const delivery = await wakeClient(clientId);
    return { queued: true, notificationId: Number(inserted.rows[0].id), ...delivery };
  }

  async function pending({ crmV2ClientId, endpoint } = {}) {
    const clientId = Number(crmV2ClientId);
    const cleanEndpoint = validEndpoint(endpoint);
    if (!Number.isSafeInteger(clientId) || clientId <= 0 || !cleanEndpoint) return { notifications: [] };
    const subscription = (await db.query(
      `SELECT id,last_notification_id
         FROM my_shiloh_push_subscriptions
        WHERE crm_v2_client_id=$1 AND endpoint=$2 AND enabled=TRUE AND revoked_at IS NULL
        LIMIT 1`,
      [clientId, cleanEndpoint],
    )).rows[0];
    if (!subscription) return { notifications: [] };
    const result = await db.query(
      `SELECT id,category,title,body,target_path
         FROM my_shiloh_push_notifications
        WHERE crm_v2_client_id=$1
          AND id>COALESCE($2,0)
          AND expires_at>$3
        ORDER BY id ASC
        LIMIT $4`,
      [clientId, subscription.last_notification_id, now(), MAX_PENDING],
    );
    if (result.rowCount) {
      const lastId = Number(result.rows[result.rows.length - 1].id);
      await db.query(
        `UPDATE my_shiloh_push_subscriptions
            SET last_notification_id=$2,updated_at=$3
          WHERE id=$1`,
        [Number(subscription.id), lastId, now()],
      );
    }
    return {
      notifications: result.rows.map((row) => ({
        id: Number(row.id),
        category: row.category,
        title: row.title,
        body: row.body,
        targetPath: safeTargetPath(row.target_path),
      })),
    };
  }

  return { config, subscribe, unsubscribe, queueNotification, pending, wakeClient };
}

const defaultPushService = createMyShilohPushService();

async function queueClientNotification(notification) {
  try {
    return await defaultPushService.queueNotification(notification);
  } catch (error) {
    logger.warn({ err: error, crmV2ClientId: notification?.crmV2ClientId, eventKey: notification?.eventKey }, 'My Shiloh push notification was not queued');
    return { queued: false, reason: 'push_unavailable' };
  }
}

module.exports = {
  CATEGORIES,
  validEndpoint,
  isUnsafeNetworkAddress,
  boundedPushTimeoutMs,
  resolveSafePushEndpoint,
  createPinnedLookup,
  safePushRequest,
  parseVapid,
  vapidAuthorization,
  createMyShilohPushService,
  defaultPushService,
  queueClientNotification,
};
