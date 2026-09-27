'use strict';

const crypto = require('node:crypto');
const { pool } = require('../db/pool');
const crm = require('./crmV2ClientService');
const logger = require('../lib/logger');

const TTL_HOURS = 6;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let cleanupTimer = null;
function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
function mobileHash(mobile) {
  const normalized = crm.normalizeMobile(mobile);
  return normalized ? crypto.createHash('sha256').update(normalized).digest('hex') : null;
}
function bounded(value, max) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function createClientWhatsAppContinuationService({ db = pool, crmService = crm } = {}) {
  async function cleanupExpired() {
    const result = await db.query('DELETE FROM client_whatsapp_continuations WHERE expires_at <= NOW()');
    return result.rowCount;
  }
  async function record({ mobile, clientMessage, shilohReply } = {}) {
    const hash = mobileHash(mobile);
    const question = bounded(clientMessage, 500);
    const reply = bounded(shilohReply, 900);
    if (!hash || !question || !reply) return false;
    const owner = await crmService.resolveExactMobile(mobile);
    if (owner.status !== 'found' || owner.client?.status !== 'active') return false;
    const id = positiveId(owner.client.id);
    if (!id) return false;
    await db.query(
      `INSERT INTO client_whatsapp_continuations
         (crm_v2_client_id,mobile_hash,client_message,shiloh_reply,expires_at)
       VALUES ($1,$2,$3,$4,NOW() + make_interval(hours => $5::int))
       ON CONFLICT (crm_v2_client_id) DO UPDATE SET
         mobile_hash=EXCLUDED.mobile_hash,client_message=EXCLUDED.client_message,
         shiloh_reply=EXCLUDED.shiloh_reply,created_at=NOW(),expires_at=EXCLUDED.expires_at,
         claimed_by_session_id=NULL,claimed_at=NULL`,
      [id, hash, question, reply, TTL_HOURS],
    );
    return true;
  }

  async function currentMobileHash(crmV2ClientId) {
    const id = positiveId(crmV2ClientId);
    if (!id) return null;
    const client = await crmService.getClientById(id);
    return client.status === 'active' ? mobileHash(client.normalizedMobile) : null;
  }

  async function available({ crmV2ClientId } = {}) {
    const hash = await currentMobileHash(crmV2ClientId);
    if (!hash) return false;
    const result = await db.query(
      `SELECT 1 FROM client_whatsapp_continuations
        WHERE crm_v2_client_id=$1 AND mobile_hash=$2 AND expires_at>NOW()
          AND claimed_by_session_id IS NULL LIMIT 1`,
      [positiveId(crmV2ClientId), hash],
    );
    return Boolean(result.rows[0]);
  }

  async function claim({ crmV2ClientId, sessionId } = {}) {
    const id = positiveId(crmV2ClientId);
    const session = positiveId(sessionId);
    const hash = await currentMobileHash(id);
    if (!id || !session || !hash) return null;
    const result = await db.query(
      `UPDATE client_whatsapp_continuations
          SET claimed_by_session_id=$3,claimed_at=NOW()
        WHERE crm_v2_client_id=$1 AND mobile_hash=$2 AND expires_at>NOW()
          AND claimed_by_session_id IS NULL
        RETURNING client_message,shiloh_reply`,
      [id, hash, session],
    );
    const row = result.rows[0];
    return row ? { clientMessage:row.client_message, shilohReply:row.shiloh_reply } : null;
  }

  async function claimedForSession({ crmV2ClientId, sessionId } = {}) {
    const id = positiveId(crmV2ClientId);
    const session = positiveId(sessionId);
    const hash = await currentMobileHash(id);
    if (!id || !session || !hash) return null;
    const result = await db.query(
      `SELECT client_message,shiloh_reply FROM client_whatsapp_continuations
        WHERE crm_v2_client_id=$1 AND mobile_hash=$2 AND claimed_by_session_id=$3
          AND expires_at>NOW() LIMIT 1`,
      [id, hash, session],
    );
    const row = result.rows[0];
    return row ? { clientMessage:row.client_message, shilohReply:row.shiloh_reply } : null;
  }

  return { record, available, claim, claimedForSession, cleanupExpired };
}

function startClientWhatsAppContinuationCleanupScheduler() {
  if (cleanupTimer) return cleanupTimer;
  const service = createClientWhatsAppContinuationService();
  const cleanup = () => service.cleanupExpired().catch(error => {
    logger.error({ err:error }, 'Failed to expire WhatsApp continuation');
  });
  cleanup();
  cleanupTimer = setInterval(cleanup, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
  return cleanupTimer;
}

module.exports = { TTL_HOURS, mobileHash, bounded, createClientWhatsAppContinuationService, startClientWhatsAppContinuationCleanupScheduler };
