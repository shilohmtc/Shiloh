'use strict';

const crypto = require('crypto');
const { pool } = require('../db/pool');
const { cancelOwnedAppointmentInTransaction } = require('./clientAppointmentCancellation');

const ACTION_TOKEN_BYTES = 32;
const ACTION_TTL_MS = 10 * 60 * 1000;
const ACTION_TYPE_CANCEL = 'cancel_appointment';

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function randomActionToken(randomBytes = crypto.randomBytes) {
  return randomBytes(ACTION_TOKEN_BYTES).toString('base64url');
}

function validActionToken(value) {
  return /^[A-Za-z0-9_-]{43}$/.test(String(value || ''));
}

function firstText(values, fallback) {
  const list = Array.isArray(values) ? values.map(value => String(value || '').trim()).filter(Boolean) : [];
  return list.join(' + ') || fallback;
}

function localAppointmentDisplay(startsAt) {
  const start = new Date(startsAt);
  return {
    date: new Intl.DateTimeFormat('en-ZA', {
      timeZone: 'Africa/Johannesburg',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(start),
    time: new Intl.DateTimeFormat('en-ZA', {
      timeZone: 'Africa/Johannesburg',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(start),
  };
}

function cancellationPolicy(startsAt, now = new Date()) {
  const hours = (new Date(startsAt).getTime() - new Date(now).getTime()) / 3600000;
  return hours < 24
    ? "This appointment is within 24 hours. Shiloh's late-cancellation policy may apply a 50% fee."
    : "Shiloh's 24-hour cancellation policy applies.";
}

function proposalOutcome(status) {
  return {
    cancelled: 'confirmed',
    appointment_changed: 'appointment_changed',
    appointment_started: 'appointment_started',
    already_cancelled: 'already_cancelled',
    ownership_changed: 'ownership_changed',
    complex_booking: 'complex_booking',
  }[status] || 'failed';
}

function createMyShilohClientActionService({
  db = pool,
  now = () => new Date(),
  randomBytes = crypto.randomBytes,
  ttlMs = ACTION_TTL_MS,
} = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('My Shiloh client action database is required');

  async function requireActiveSession(queryable, sessionId, crmV2ClientId) {
    const session = positiveId(sessionId);
    const clientId = positiveId(crmV2ClientId);
    if (!session || !clientId) return false;
    const result = await queryable.query(
      `SELECT 1
         FROM client_browser_sessions s
         JOIN crm_v2_clients c ON c.id=s.crm_v2_client_id AND c.status='active'
        WHERE s.id=$1
          AND s.crm_v2_client_id=$2
          AND s.revoked_at IS NULL
          AND s.expires_at>$3
        LIMIT 1`,
      [session, clientId, now()],
    );
    return result.rowCount === 1;
  }

  async function cancellationCandidate(queryable, crmV2ClientId) {
    const clientId = positiveId(crmV2ClientId);
    if (!clientId) return null;
    const result = await queryable.query(
      `/* myShilohClientActions:cancellation-candidate */
       SELECT a.id,a.starts_at,a.ends_at,a.status,a.updated_at,
              (SELECT gm.group_id FROM appointment_group_members gm WHERE gm.appointment_id=a.id LIMIT 1) AS group_id,
              COALESCE((
                SELECT jsonb_agg(aps.service_name_snapshot ORDER BY aps.position,aps.id)
                  FROM appointment_services aps
                 WHERE aps.appointment_id=a.id
              ),'[]'::jsonb) AS services,
              COALESCE((
                SELECT jsonb_agg(ast.staff_name_snapshot ORDER BY ast.position,ast.id)
                  FROM appointment_staff ast
                 WHERE ast.appointment_id=a.id
              ),'[]'::jsonb) AS practitioners
         FROM appointments a
        WHERE a.crm_v2_client_id=$1
          AND a.client_id IS NULL
          AND a.status IN ('scheduled','confirmed')
          AND a.starts_at>$2
        ORDER BY a.starts_at,a.id
        LIMIT 1`,
      [clientId, now()],
    );
    return result.rows[0] || null;
  }

  async function prepareCancellation({ sessionId, crmV2ClientId } = {}) {
    const session = positiveId(sessionId);
    const clientId = positiveId(crmV2ClientId);
    if (!session || !clientId) return { ok: false, code: 'CLIENT_ACTION_SESSION_INVALID' };
    const client = typeof db.connect === 'function' ? await db.connect() : db;
    const release = client !== db && typeof client.release === 'function';
    try {
      await client.query('BEGIN');
      if (!await requireActiveSession(client, session, clientId)) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'CLIENT_ACTION_SESSION_INVALID' };
      }

      const appointment = await cancellationCandidate(client, clientId);
      if (!appointment) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'CLIENT_ACTION_NO_UPCOMING_APPOINTMENT' };
      }

      if (appointment.group_id) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'CLIENT_ACTION_COMPLEX_BOOKING' };
      }

      const token = randomActionToken(randomBytes);
      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + ttlMs);
      await client.query(
        `UPDATE client_action_proposals
            SET revoked_at=$2
          WHERE session_id=$1
            AND action_type='cancel_appointment'
            AND consumed_at IS NULL
            AND revoked_at IS NULL`,
        [session, issuedAt],
      );
      await client.query(
        `INSERT INTO client_action_proposals
           (session_id,crm_v2_client_id,appointment_id,action_type,token_hash,
            appointment_revision,issued_at,expires_at)
         VALUES($1,$2,$3,'cancel_appointment',$4,$5,$6,$7)`,
        [
          session,
          clientId,
          Number(appointment.id),
          sha256(token),
          appointment.updated_at,
          issuedAt,
          expiresAt,
        ],
      );
      await client.query('COMMIT');

      const display = localAppointmentDisplay(appointment.starts_at);
      return {
        ok: true,
        modelResult: {
          ok: true,
          prepared: true,
          action: ACTION_TYPE_CANCEL,
          appointment: {
            service: firstText(appointment.services, 'Shiloh appointment'),
            practitioner: firstText(appointment.practitioners, 'Shiloh practitioner'),
            date: display.date,
            time: display.time,
          },
          message: 'A cancellation confirmation card is ready. The appointment has not changed.',
        },
        clientAction: {
          type: ACTION_TYPE_CANCEL,
          token,
          title: 'Cancel this appointment?',
          service: firstText(appointment.services, 'Shiloh appointment'),
          practitioner: firstText(appointment.practitioners, 'Shiloh practitioner'),
          date: display.date,
          time: display.time,
          policy: cancellationPolicy(appointment.starts_at, issuedAt),
          paymentNote: 'Cancelling an appointment does not automatically issue a refund. Any payment or refund remains a separate Shiloh process.',
          confirmLabel: 'Cancel appointment',
          declineLabel: 'Keep appointment',
          expiresAt: expiresAt.toISOString(),
        },
      };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      if (release) client.release();
    }
  }

  async function confirmAction({ sessionId, crmV2ClientId, actionToken } = {}) {
    const session = positiveId(sessionId);
    const clientId = positiveId(crmV2ClientId);
    if (!session || !clientId || !validActionToken(actionToken)) {
      return { ok: false, code: 'CLIENT_ACTION_INVALID' };
    }

    const client = typeof db.connect === 'function' ? await db.connect() : db;
    const release = client !== db && typeof client.release === 'function';
    try {
      await client.query('BEGIN');
      if (!await requireActiveSession(client, session, clientId)) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'CLIENT_ACTION_SESSION_INVALID' };
      }

      const proposalResult = await client.query(
        `SELECT p.id,p.appointment_id,p.action_type,p.appointment_revision,p.expires_at,
                p.consumed_at,p.revoked_at,
                a.starts_at,
                COALESCE((
                  SELECT jsonb_agg(aps.service_name_snapshot ORDER BY aps.position,aps.id)
                    FROM appointment_services aps
                   WHERE aps.appointment_id=a.id
                ),'[]'::jsonb) AS services,
                COALESCE((
                  SELECT jsonb_agg(ast.staff_name_snapshot ORDER BY ast.position,ast.id)
                    FROM appointment_staff ast
                   WHERE ast.appointment_id=a.id
                ),'[]'::jsonb) AS practitioners
           FROM client_action_proposals p
           JOIN appointments a ON a.id=p.appointment_id
          WHERE p.token_hash=$1
            AND p.session_id=$2
            AND p.crm_v2_client_id=$3
          LIMIT 1
          FOR UPDATE OF p`,
        [sha256(actionToken), session, clientId],
      );
      const proposal = proposalResult.rows[0];
      const current = now();
      if (!proposal || proposal.consumed_at || proposal.revoked_at || new Date(proposal.expires_at).getTime() <= current.getTime()) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'CLIENT_ACTION_INVALID' };
      }
      if (proposal.action_type !== ACTION_TYPE_CANCEL) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'CLIENT_ACTION_UNSUPPORTED' };
      }

      const result = await cancelOwnedAppointmentInTransaction(client, {
        appointmentId: proposal.appointment_id,
        crmV2ClientId: clientId,
        expectedRevision: proposal.appointment_revision,
        requireFutureStart: true,
        allowedStatuses: ['scheduled', 'confirmed'],
        lockAssignedStaff: true,
        disallowLinkedGroup: true,
        now: current,
        changedBy: `client_session:${session}`,
        reason: 'Client cancellation confirmed in My Shiloh',
        auditMetadata: {
          source: 'my_shiloh',
          clientSessionId: session,
          actionProposalId: Number(proposal.id),
        },
      });
      await client.query(
        `UPDATE client_action_proposals
            SET consumed_at=$2,
                outcome=$3
          WHERE id=$1`,
        [Number(proposal.id), current, proposalOutcome(result.status)],
      );
      await client.query('COMMIT');

      const display = localAppointmentDisplay(proposal.starts_at);
      return {
        ok: result.status === 'cancelled',
        status: result.status,
        appointment: {
          service: firstText(proposal.services, 'Shiloh appointment'),
          practitioner: firstText(proposal.practitioners, 'Shiloh practitioner'),
          date: display.date,
          time: display.time,
        },
      };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      if (release) client.release();
    }
  }

  async function declineAction({ sessionId, crmV2ClientId, actionToken } = {}) {
    const session = positiveId(sessionId);
    const clientId = positiveId(crmV2ClientId);
    if (!session || !clientId || !validActionToken(actionToken)) return { ok: false };
    const result = await db.query(
      `UPDATE client_action_proposals
          SET revoked_at=$4,
              outcome='declined'
        WHERE token_hash=$1
          AND session_id=$2
          AND crm_v2_client_id=$3
          AND consumed_at IS NULL
          AND revoked_at IS NULL
          AND expires_at>$4
      RETURNING id`,
      [sha256(actionToken), session, clientId, now()],
    );
    return { ok: result.rowCount === 1 };
  }

  async function revokeSessionActions({ sessionId, crmV2ClientId } = {}) {
    const session = positiveId(sessionId);
    const clientId = positiveId(crmV2ClientId);
    if (!session || !clientId) return { ok: false };
    await db.query(
      `UPDATE client_action_proposals
          SET revoked_at=COALESCE(revoked_at,$3)
        WHERE session_id=$1
          AND crm_v2_client_id=$2
          AND consumed_at IS NULL
          AND revoked_at IS NULL`,
      [session, clientId, now()],
    );
    return { ok: true };
  }

  return {
    prepareCancellation,
    confirmAction,
    declineAction,
    revokeSessionActions,
  };
}

const service = createMyShilohClientActionService();

module.exports = {
  ACTION_TOKEN_BYTES,
  ACTION_TTL_MS,
  ACTION_TYPE_CANCEL,
  positiveId,
  sha256,
  randomActionToken,
  validActionToken,
  localAppointmentDisplay,
  cancellationPolicy,
  proposalOutcome,
  createMyShilohClientActionService,
  ...service,
};
