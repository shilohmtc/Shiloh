'use strict';

const { pool } = require('../db/pool');
const clientConsultationForms = require('./clientConsultationForms');

const ACTION_TYPE_FORM = 'consultation_form';
const FORM_ACTION_PATH = '/my-shiloh/forms/complete';
const PENDING_FORM_STATUSES = Object.freeze(['not_sent', 'sent', 'opened']);

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function createMyShilohConsultationFormActionService({
  db = pool,
  formService = clientConsultationForms,
  now = () => new Date(),
} = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('My Shiloh consultation form database is required');
  if (!formService || typeof formService.issueAccessToken !== 'function' || typeof formService.openForm !== 'function') {
    throw new Error('Client consultation form service is required');
  }

  async function requireActiveSession(sessionId, crmV2ClientId) {
    const session = positiveId(sessionId);
    const clientId = positiveId(crmV2ClientId);
    if (!session || !clientId) return false;
    const result = await db.query(
      `/* myShilohConsultationFormActions:session */
       SELECT 1
         FROM client_browser_sessions s
         JOIN crm_v2_clients c ON c.id=s.crm_v2_client_id AND c.status='active'
        WHERE s.id=$1 AND s.crm_v2_client_id=$2
          AND s.revoked_at IS NULL AND s.expires_at>$3
        LIMIT 1`,
      [session, clientId, now()],
    );
    return result.rowCount === 1;
  }

  async function pendingAssignments(crmV2ClientId) {
    const clientId = positiveId(crmV2ClientId);
    if (!clientId) return [];
    const result = await db.query(
      `/* myShilohConsultationFormActions:pending */
       SELECT a.id,a.status,a.access_expires_at,
              t.title,t.template_key,
              ap.id AS appointment_id,ap.starts_at,ap.status AS appointment_status
         FROM consultation_form_assignments a
         JOIN appointments ap
           ON ap.id=a.appointment_id
          AND ap.crm_v2_client_id=$1
          AND ap.client_id IS NULL
          AND ap.status IN ('scheduled','confirmed')
         JOIN consultation_form_template_versions tv ON tv.id=a.template_version_id
         JOIN consultation_form_templates t ON t.id=tv.template_id AND t.status='active'
        WHERE a.crm_v2_client_id=$1
          AND a.client_id IS NULL
          AND a.status = ANY($2::text[])
        ORDER BY ap.starts_at,a.id
        LIMIT 2`,
      [clientId, [...PENDING_FORM_STATUSES]],
    );
    return result.rows;
  }

  async function prepareFormAction({ sessionId, crmV2ClientId } = {}) {
    if (!await requireActiveSession(sessionId, crmV2ClientId)) {
      return { ok: false, code: 'CLIENT_FORM_SESSION_INVALID' };
    }
    const rows = await pendingAssignments(crmV2ClientId);
    if (!rows.length) return { ok: false, code: 'CLIENT_FORM_UNAVAILABLE' };
    if (rows.length !== 1) return { ok: false, code: 'CLIENT_FORM_MULTIPLE_PENDING' };
    const row = rows[0];
    return {
      ok: true,
      modelResult: {
        ok: true,
        prepared: true,
        action: ACTION_TYPE_FORM,
        title: String(row.title || 'Consultation form'),
        message: 'A secure consultation form is waiting in My Shiloh.',
      },
      clientAction: {
        type: ACTION_TYPE_FORM,
        title: 'Complete your consultation form',
        detail: String(row.title || 'Consultation form'),
        href: FORM_ACTION_PATH,
        label: 'Complete form',
      },
    };
  }

  async function openForSession({ sessionId, crmV2ClientId } = {}) {
    if (!await requireActiveSession(sessionId, crmV2ClientId)) {
      return { ok: false, code: 'CLIENT_FORM_SESSION_INVALID' };
    }
    const rows = await pendingAssignments(crmV2ClientId);
    if (!rows.length) return { ok: false, code: 'CLIENT_FORM_UNAVAILABLE' };
    if (rows.length !== 1) return { ok: false, code: 'CLIENT_FORM_MULTIPLE_PENDING' };

    const issued = await formService.issueAccessToken({ assignmentId: positiveId(rows[0].id) });
    // Re-open through the canonical authority immediately after issuing. This
    // catches expiry, completion, identity drift, and appointment changes.
    const model = await formService.openForm(issued.token);
    return {
      ok: true,
      accessToken: issued.token,
      expiresAt: issued.expiresAt,
      model,
    };
  }

  return { prepareFormAction, openForSession, pendingAssignments, requireActiveSession };
}

const service = createMyShilohConsultationFormActionService();

module.exports = {
  ACTION_TYPE_FORM,
  FORM_ACTION_PATH,
  PENDING_FORM_STATUSES,
  positiveId,
  createMyShilohConsultationFormActionService,
  ...service,
};
