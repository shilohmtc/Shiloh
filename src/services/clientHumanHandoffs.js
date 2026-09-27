'use strict';

const { pool } = require('../db/pool');
const { isDerivedGlobalCoordinator } = require('./workspaceBookingRequestRouting');

class ClientHumanHandoffError extends Error {
  constructor(code, message, httpStatus = 422) {
    super(message);
    this.name = 'ClientHumanHandoffError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function createClientHumanHandoffService({ db = pool } = {}) {
  async function activeForClient(crmV2ClientId) {
    const clientId = positiveId(crmV2ClientId);
    if (!clientId) return null;
    const result = await db.query(`SELECT id,requested_at FROM client_human_handoffs
      WHERE crm_v2_client_id=$1 AND status='open' LIMIT 1`, [clientId]);
    return result.rows[0] || null;
  }

  async function activeForPhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!/^27[678]\d{8}$/.test(digits)) return null;
    const result = await db.query(`SELECT h.id FROM client_human_handoffs h
      JOIN crm_v2_clients c ON c.id=h.crm_v2_client_id AND c.status='active'
      WHERE c.normalized_mobile=$1 AND h.status='open'
        AND NOT EXISTS (SELECT 1 FROM staff_admin_accounts a
          WHERE a.normalized_whatsapp=$1 AND a.active=TRUE)
      LIMIT 1`, [digits]);
    return result.rows[0] || null;
  }

  async function request(crmV2ClientId) {
    const clientId = positiveId(crmV2ClientId);
    if (!clientId) throw new ClientHumanHandoffError('HUMAN_CLIENT_INVALID', 'Please sign in again.', 401);
    const client = await db.query(`SELECT id FROM crm_v2_clients WHERE id=$1 AND status='active' LIMIT 1`, [clientId]);
    if (!client.rowCount) throw new ClientHumanHandoffError('HUMAN_CLIENT_CHANGED', 'Please sign in again.', 401);
    const inserted = await db.query(`INSERT INTO client_human_handoffs(crm_v2_client_id)
      VALUES($1) ON CONFLICT (crm_v2_client_id) WHERE status='open' DO NOTHING
      RETURNING id,requested_at`, [clientId]);
    const row = inserted.rows[0] || await activeForClient(clientId);
    if (!row) throw new Error('Human handoff could not be recovered after an idempotent submission');
    return { id:Number(row.id), status:'open', created:Boolean(inserted.rowCount) };
  }

  async function forReception(principal) {
    if (!isDerivedGlobalCoordinator(principal)) return [];
    const result = await db.query(`SELECT h.id,h.requested_at,c.name AS client_name,
      c.normalized_mobile AS client_mobile FROM client_human_handoffs h
      JOIN crm_v2_clients c ON c.id=h.crm_v2_client_id
      WHERE h.status='open' ORDER BY h.requested_at,h.id LIMIT 100`);
    return result.rows;
  }

  async function close({ principal, id }) {
    if (!isDerivedGlobalCoordinator(principal)) {
      throw new ClientHumanHandoffError('HUMAN_FORBIDDEN', 'Reception access is required.', 403);
    }
    const handoffId = positiveId(id);
    const adminId = positiveId(principal?.id || principal?.calendarAuthority?.operatorAdminId);
    if (!handoffId || !adminId) throw new ClientHumanHandoffError('HUMAN_ACTION_INVALID', 'Please refresh and try again.');
    const result = await db.query(`UPDATE client_human_handoffs SET status='closed',
      closed_at=NOW(),closed_by_admin_id=$2 WHERE id=$1 AND status='open'
      RETURNING id`, [handoffId,adminId]);
    if (!result.rowCount) throw new ClientHumanHandoffError('HUMAN_ALREADY_CLOSED', 'This handoff has changed. Please refresh.', 409);
    return { id:Number(result.rows[0].id), status:'closed' };
  }

  return { activeForClient, activeForPhone, request, forReception, close };
}

module.exports = { ClientHumanHandoffError, createClientHumanHandoffService };
