'use strict';

const crypto = require('crypto');
const { pool } = require('../db/pool');
const { cancelOwnedAppointmentInTransaction } = require('./clientAppointmentCancellation');
const { listAvailableSlots } = require('./availabilityService');
const { createPendingRescheduleRequest } = require('./clientRescheduleApproval');
const { cancellationPolicyNotice } = require('../config/bookingPolicyAuthority');

const ACTION_TOKEN_BYTES = 32;
const ACTION_TTL_MS = 10 * 60 * 1000;
const ACTION_TYPE_CANCEL = 'cancel_appointment';
const ACTION_TYPE_RESCHEDULE = 'reschedule_appointment';

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

function cancellationPolicy(startsAt, now = new Date(), practitioners = []) {
  return cancellationPolicyNotice({ startsAt, now, practitioners });
}

function johannesburgDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    time: `${map.hour}:${map.minute}`,
  };
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
  availability = listAvailableSlots,
  createRescheduleRequest = createPendingRescheduleRequest,
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

  async function rescheduleCandidate(queryable, crmV2ClientId) {
    const clientId = positiveId(crmV2ClientId);
    if (!clientId) return null;
    const result = await queryable.query(
      `/* myShilohClientActions:reschedule-candidate */
       SELECT a.id,a.location_id,a.starts_at,a.ends_at,a.status,a.updated_at,
              v2.normalized_mobile,
              (SELECT gm.group_id FROM appointment_group_members gm WHERE gm.appointment_id=a.id LIMIT 1) AS group_id,
              (SELECT COUNT(*)::int FROM appointment_staff ast WHERE ast.appointment_id=a.id) AS staff_count,
              (SELECT ast.staff_id FROM appointment_staff ast WHERE ast.appointment_id=a.id ORDER BY ast.position,ast.id LIMIT 1) AS staff_id,
              (SELECT COUNT(*)::int FROM appointment_services aps WHERE aps.appointment_id=a.id) AS service_count,
              (SELECT aps.service_id FROM appointment_services aps WHERE aps.appointment_id=a.id ORDER BY aps.position,aps.id LIMIT 1) AS service_id,
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
         JOIN crm_v2_clients v2 ON v2.id=a.crm_v2_client_id AND v2.status='active'
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

  async function exactAvailableSlot(appointment, proposedStartsAt) {
    if (
      !appointment
      || Number(appointment.staff_count) !== 1
      || !positiveId(appointment.staff_id)
      || Number(appointment.service_count) !== 1
      || !positiveId(appointment.service_id)
    ) return null;

    const local = johannesburgDateTime(proposedStartsAt);
    if (!local) return null;
    const result = await availability({
      staffId: Number(appointment.staff_id),
      serviceId: Number(appointment.service_id),
      date: local.date,
      locationId: positiveId(appointment.location_id),
      intervalMinutes: 15,
      excludeAppointmentId: Number(appointment.id),
    });
    return (result.slots || []).find(slot =>
      new Date(slot.starts_at).getTime() === new Date(proposedStartsAt).getTime()
    ) || null;
  }

  async function prepareReschedule({ sessionId, crmV2ClientId, proposedStartsAt } = {}) {
    const session = positiveId(sessionId);
    const clientId = positiveId(crmV2ClientId);
    const proposedStart = new Date(proposedStartsAt);
    if (!session || !clientId || Number.isNaN(proposedStart.getTime()) || proposedStart.getTime() <= now().getTime()) {
      return { ok: false, code: 'CLIENT_ACTION_RESCHEDULE_SLOT_INVALID' };
    }

    const client = typeof db.connect === 'function' ? await db.connect() : db;
    const release = client !== db && typeof client.release === 'function';
    try {
      await client.query('BEGIN');
      if (!await requireActiveSession(client, session, clientId)) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'CLIENT_ACTION_SESSION_INVALID' };
      }

      const appointment = await rescheduleCandidate(client, clientId);
      if (!appointment) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'CLIENT_ACTION_NO_UPCOMING_APPOINTMENT' };
      }
      if (appointment.group_id || Number(appointment.staff_count) !== 1 || Number(appointment.service_count) !== 1) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'CLIENT_ACTION_COMPLEX_BOOKING' };
      }

      const slot = await exactAvailableSlot(appointment, proposedStart);
      if (!slot) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'CLIENT_ACTION_SLOT_UNAVAILABLE' };
      }
      const proposedEnd = new Date(slot.ends_at);
      const token = randomActionToken(randomBytes);
      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + ttlMs);

      await client.query(
        `UPDATE client_action_proposals
            SET revoked_at=$2
          WHERE session_id=$1
            AND action_type='reschedule_appointment'
            AND consumed_at IS NULL
            AND revoked_at IS NULL`,
        [session, issuedAt],
      );
      await client.query(
        `INSERT INTO client_action_proposals
           (session_id,crm_v2_client_id,appointment_id,action_type,token_hash,
            appointment_revision,proposed_starts_at,proposed_ends_at,issued_at,expires_at)
         VALUES($1,$2,$3,'reschedule_appointment',$4,$5,$6,$7,$8,$9)`,
        [
          session,
          clientId,
          Number(appointment.id),
          sha256(token),
          appointment.updated_at,
          proposedStart,
          proposedEnd,
          issuedAt,
          expiresAt,
        ],
      );
      await client.query('COMMIT');

      const currentDisplay = localAppointmentDisplay(appointment.starts_at);
      const proposedDisplay = localAppointmentDisplay(proposedStart);
      return {
        ok: true,
        modelResult: {
          ok: true,
          prepared: true,
          action: ACTION_TYPE_RESCHEDULE,
          appointment: {
            service: firstText(appointment.services, 'Shiloh appointment'),
            practitioner: firstText(appointment.practitioners, 'Shiloh practitioner'),
            currentDate: currentDisplay.date,
            currentTime: currentDisplay.time,
            proposedDate: proposedDisplay.date,
            proposedTime: proposedDisplay.time,
          },
          message: 'A reschedule confirmation card is ready. The appointment has not changed.',
        },
        clientAction: {
          type: ACTION_TYPE_RESCHEDULE,
          token,
          title: 'Request this new time?',
          service: firstText(appointment.services, 'Shiloh appointment'),
          practitioner: firstText(appointment.practitioners, 'Shiloh practitioner'),
          currentDate: currentDisplay.date,
          currentTime: currentDisplay.time,
          proposedDate: proposedDisplay.date,
          proposedTime: proposedDisplay.time,
          note: 'Your current appointment stays confirmed until you submit this request and Reception confirms the new arrangement.',
          confirmLabel: 'Request reschedule',
          declineLabel: 'Keep current time',
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
          policy: cancellationPolicy(appointment.starts_at, issuedAt, appointment.practitioners),
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
                p.consumed_at,p.revoked_at,p.proposed_starts_at,p.proposed_ends_at,
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
      if (proposal.action_type === ACTION_TYPE_RESCHEDULE) {
        const local = johannesburgDateTime(proposal.proposed_starts_at);
        if (!local || !proposal.proposed_ends_at) {
          await client.query(
            `UPDATE client_action_proposals SET consumed_at=$2,outcome='failed' WHERE id=$1`,
            [Number(proposal.id), current],
          );
          await client.query('COMMIT');
          return { ok: false, status: 'slot_unavailable' };
        }

        await client.query(
          `UPDATE client_action_proposals SET consumed_at=$2,outcome='pending_approval' WHERE id=$1`,
          [Number(proposal.id), current],
        );
        await client.query('COMMIT');

        let requestResult;
        try {
          const phoneResult = await db.query(
            `SELECT normalized_mobile
               FROM crm_v2_clients
              WHERE id=$1 AND status='active'
              LIMIT 1`,
            [clientId],
          );
          const phone = String(phoneResult.rows[0]?.normalized_mobile || '');
          if (!phone) {
            await db.query(
              `UPDATE client_action_proposals SET outcome='approval_request_failed' WHERE id=$1`,
              [Number(proposal.id)],
            );
            return { ok: false, status: 'approval_request_failed' };
          }
          requestResult = await createRescheduleRequest(phone, {
            appointment_id: Number(proposal.appointment_id),
            preferred_date: local.date,
            preferred_time: local.time,
          });
        } catch (error) {
          await db.query(
            `UPDATE client_action_proposals SET outcome='approval_request_failed' WHERE id=$1`,
            [Number(proposal.id)],
          );
          throw error;
        }

        const accepted = requestResult?.status === 'pending_approval';
        await db.query(
          `UPDATE client_action_proposals
              SET outcome=$2
            WHERE id=$1`,
          [
            Number(proposal.id),
            accepted ? 'pending_approval'
              : ['crm_conflict','staff_schedule','clinic_hours','reschedule_hold_conflict','booking_proposal_hold_conflict','appointment_changed','past_time'].includes(String(requestResult?.status || ''))
                ? 'slot_unavailable'
                : 'approval_request_failed',
          ],
        );
        return {
          ok: accepted,
          status: requestResult?.status || 'approval_request_failed',
          reply: requestResult?.reply || null,
          appointment: {
            service: firstText(proposal.services, 'Shiloh appointment'),
            practitioner: firstText(proposal.practitioners, 'Shiloh practitioner'),
            proposedDate: localAppointmentDisplay(proposal.proposed_starts_at).date,
            proposedTime: localAppointmentDisplay(proposal.proposed_starts_at).time,
          },
        };
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
    prepareReschedule,
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
  ACTION_TYPE_RESCHEDULE,
  positiveId,
  sha256,
  randomActionToken,
  validActionToken,
  localAppointmentDisplay,
  cancellationPolicy,
  johannesburgDateTime,
  proposalOutcome,
  createMyShilohClientActionService,
  ...service,
};
