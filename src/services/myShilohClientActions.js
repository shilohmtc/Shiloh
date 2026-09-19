'use strict';

const crypto = require('crypto');
const { pool } = require('../db/pool');
const { cancelOwnedAppointmentInTransaction, sameRevision } = require('./clientAppointmentCancellation');
const { authoritativeSlotsForIntent } = require('./clientBookingAvailability');
const clientRescheduleApproval = require('./clientRescheduleApproval');
const { reconcileStalePendingRescheduleHolds } = require('./clientRescheduleHoldReconciliation');

const ACTION_TOKEN_BYTES = 32;
const ACTION_TTL_MS = 10 * 60 * 1000;
const ACTION_TYPE_CANCEL = 'cancel_appointment';
const ACTION_TYPE_RESCHEDULE = 'request_reschedule';
const RESCHEDULE_START_GUARD_MS = 60 * 1000;

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

function exactDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function johannesburgSlotParts(value) {
  const date = exactDate(value);
  if (!date) return null;
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const timeParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Johannesburg',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const dateMap = Object.fromEntries(dateParts.map(part => [part.type, part.value]));
  const timeMap = Object.fromEntries(timeParts.map(part => [part.type, part.value]));
  return {
    date: `${dateMap.year}-${dateMap.month}-${dateMap.day}`,
    time: `${timeMap.hour}:${timeMap.minute}`,
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
    pending_approval: 'pending_approval',
    already_pending: 'already_pending',
    notification_failed: 'notification_failed',
    feature_disabled: 'feature_disabled',
    slot_unavailable: 'slot_unavailable',
  }[status] || 'failed';
}

function rescheduleProposalOutcome(status) {
  if (status === 'pending_approval') return 'pending_approval';
  if (status === 'already_pending') return 'already_pending';
  if (status === 'notification_failed') return 'notification_failed';
  if (status === 'feature_disabled') return 'feature_disabled';
  if (status === 'appointment_started') return 'appointment_started';
  if (['appointment_changed', 'appointment_not_found', 'client_identity_changed'].includes(status)) return 'appointment_changed';
  if (['complex_practitioner_setup', 'complex_service_setup'].includes(status)) return 'complex_booking';
  if ([
    'past_time','clinic_hours','staff_schedule','crm_conflict',
    'reschedule_hold_conflict','booking_proposal_hold_conflict','invalid_time','invalid_duration',
  ].includes(status)) return 'slot_unavailable';
  return 'failed';
}

function createMyShilohClientActionService({
  db = pool,
  now = () => new Date(),
  randomBytes = crypto.randomBytes,
  ttlMs = ACTION_TTL_MS,
  availability = authoritativeSlotsForIntent,
  rescheduleApproval = clientRescheduleApproval,
  reconcileRescheduleHolds = reconcileStalePendingRescheduleHolds,
} = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('My Shiloh client action database is required');
  if (typeof availability !== 'function') throw new Error('Canonical client availability service is required');
  if (!rescheduleApproval || typeof rescheduleApproval.createPendingRescheduleRequest !== 'function') {
    throw new Error('Canonical client reschedule approval service is required');
  }
  if (typeof reconcileRescheduleHolds !== 'function') throw new Error('Reschedule hold reconciliation is required');

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
       SELECT a.id,a.starts_at,a.ends_at,a.status,a.updated_at,a.location_id,
              v2.normalized_mobile,
              (SELECT gm.group_id FROM appointment_group_members gm WHERE gm.appointment_id=a.id LIMIT 1) AS group_id,
              (SELECT COUNT(*)::int FROM appointment_staff x WHERE x.appointment_id=a.id) AS staff_count,
              (SELECT COUNT(*)::int FROM appointment_services x WHERE x.appointment_id=a.id) AS service_count,
              (SELECT ast.staff_id FROM appointment_staff ast WHERE ast.appointment_id=a.id ORDER BY ast.position,ast.id LIMIT 1) AS staff_id,
              (SELECT ast.staff_name_snapshot FROM appointment_staff ast WHERE ast.appointment_id=a.id ORDER BY ast.position,ast.id LIMIT 1) AS staff_name,
              (SELECT aps.service_id FROM appointment_services aps WHERE aps.appointment_id=a.id ORDER BY aps.position,aps.id LIMIT 1) AS service_id,
              (SELECT aps.service_name_snapshot FROM appointment_services aps WHERE aps.appointment_id=a.id ORDER BY aps.position,aps.id LIMIT 1) AS service_name,
              (SELECT request.id
                 FROM appointment_reschedule_requests request
                WHERE request.appointment_id=a.id
                  AND request.status='pending'
                ORDER BY request.id DESC
                LIMIT 1) AS pending_request_id
         FROM appointments a
         JOIN crm_v2_clients v2 ON v2.id=a.crm_v2_client_id AND v2.status='active'
        WHERE a.crm_v2_client_id=$1
          AND a.client_id IS NULL
          AND a.status IN ('scheduled','confirmed')
          AND a.starts_at>$2
        ORDER BY a.starts_at,a.id
        LIMIT 1`,
      [clientId, new Date(now().getTime() + RESCHEDULE_START_GUARD_MS)],
    );
    return result.rows[0] || null;
  }

  async function exactRescheduleSlot(appointment, proposedStartsAt) {
    const requested = exactDate(proposedStartsAt);
    const parts = johannesburgSlotParts(requested);
    if (!requested || !parts || requested.getTime() <= now().getTime()) return null;
    const result = await availability({
      service_text: String(appointment.service_name || ''),
      preferred_date: parts.date,
      preferred_time: parts.time,
      therapist_text: String(appointment.staff_name || ''),
      service_verified: true,
      status: 'collecting',
    }, {
      now: now(),
    });
    if (result?.status !== 'available' || !Array.isArray(result.slots)) return null;
    return result.slots.find(slot => (
      new Date(slot.starts_at).getTime() === requested.getTime()
      && Number(slot.staff_id) === Number(appointment.staff_id)
      && Number(slot.service_id) === Number(appointment.service_id)
    )) || null;
  }

  async function prepareReschedule({ sessionId, crmV2ClientId, proposedStartsAt } = {}) {
    const session = positiveId(sessionId);
    const clientId = positiveId(crmV2ClientId);
    const requestedStart = exactDate(proposedStartsAt);
    if (!session || !clientId || !requestedStart) {
      return { ok: false, code: 'CLIENT_ACTION_INVALID_RESCHEDULE' };
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
      if (
        appointment.group_id
        || Number(appointment.staff_count) !== 1
        || Number(appointment.service_count) !== 1
        || !positiveId(appointment.staff_id)
        || !positiveId(appointment.service_id)
      ) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'CLIENT_ACTION_COMPLEX_BOOKING' };
      }
      if (appointment.pending_request_id) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'CLIENT_ACTION_ALREADY_PENDING' };
      }

      const slot = await exactRescheduleSlot(appointment, requestedStart);
      if (!slot) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'CLIENT_ACTION_SLOT_UNAVAILABLE' };
      }

      const proposedStart = new Date(slot.starts_at);
      const proposedEnd = new Date(slot.ends_at);
      const currentDisplay = localAppointmentDisplay(appointment.starts_at);
      const requestedDisplay = localAppointmentDisplay(proposedStart);
      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + ttlMs);
      const token = randomActionToken(randomBytes);

      await client.query(
        `UPDATE client_action_proposals
            SET revoked_at=$2
          WHERE session_id=$1
            AND action_type='request_reschedule'
            AND consumed_at IS NULL
            AND revoked_at IS NULL`,
        [session, issuedAt],
      );
      await client.query(
        `INSERT INTO client_action_proposals
           (session_id,crm_v2_client_id,appointment_id,action_type,token_hash,
            appointment_revision,action_payload,issued_at,expires_at)
         VALUES($1,$2,$3,'request_reschedule',$4,$5,$6::jsonb,$7,$8)`,
        [
          session,
          clientId,
          Number(appointment.id),
          sha256(token),
          appointment.updated_at,
          JSON.stringify({
            proposedStartsAt: proposedStart.toISOString(),
            proposedEndsAt: proposedEnd.toISOString(),
          }),
          issuedAt,
          expiresAt,
        ],
      );
      await client.query('COMMIT');

      return {
        ok: true,
        modelResult: {
          ok: true,
          prepared: true,
          action: ACTION_TYPE_RESCHEDULE,
          service: String(appointment.service_name || 'Shiloh appointment'),
          practitioner: String(appointment.staff_name || 'Shiloh practitioner'),
          current: { date: currentDisplay.date, time: currentDisplay.time },
          requested: { date: requestedDisplay.date, time: requestedDisplay.time },
          message: 'A reschedule request confirmation card is ready. The current appointment has not changed.',
        },
        clientAction: {
          type: ACTION_TYPE_RESCHEDULE,
          token,
          title: 'Request this new time?',
          service: String(appointment.service_name || 'Shiloh appointment'),
          practitioner: String(appointment.staff_name || 'Shiloh practitioner'),
          currentDate: currentDisplay.date,
          currentTime: currentDisplay.time,
          requestedDate: requestedDisplay.date,
          requestedTime: requestedDisplay.time,
          approvalNote: `Your current appointment stays confirmed until ${String(appointment.staff_name || 'the practitioner')} approves the requested change.`,
          confirmLabel: 'Request change',
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
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      if (!await requireActiveSession(client, session, clientId)) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return { ok: false, code: 'CLIENT_ACTION_SESSION_INVALID' };
      }

      const proposalResult = await client.query(
        `SELECT p.id,p.appointment_id,p.action_type,p.appointment_revision,p.action_payload,p.expires_at,
                p.consumed_at,p.revoked_at,
                a.starts_at,a.ends_at,a.updated_at AS current_revision,a.status AS appointment_status,
                a.crm_v2_client_id AS appointment_crm_v2_client_id,
                v2.normalized_mobile,
                (SELECT gm.group_id FROM appointment_group_members gm WHERE gm.appointment_id=a.id LIMIT 1) AS group_id,
                (SELECT COUNT(*)::int FROM appointment_staff x WHERE x.appointment_id=a.id) AS staff_count,
                (SELECT COUNT(*)::int FROM appointment_services x WHERE x.appointment_id=a.id) AS service_count,
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
           LEFT JOIN crm_v2_clients v2 ON v2.id=a.crm_v2_client_id AND v2.status='active'
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
        transactionOpen = false;
        return { ok: false, code: 'CLIENT_ACTION_INVALID' };
      }

      if (proposal.action_type === ACTION_TYPE_CANCEL) {
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
        transactionOpen = false;

        const display = localAppointmentDisplay(proposal.starts_at);
        return {
          ok: result.status === 'cancelled',
          status: result.status,
          actionType: ACTION_TYPE_CANCEL,
          appointment: {
            service: firstText(proposal.services, 'Shiloh appointment'),
            practitioner: firstText(proposal.practitioners, 'Shiloh practitioner'),
            date: display.date,
            time: display.time,
          },
        };
      }

      if (proposal.action_type !== ACTION_TYPE_RESCHEDULE) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return { ok: false, code: 'CLIENT_ACTION_UNSUPPORTED' };
      }

      const proposedStart = exactDate(proposal.action_payload?.proposedStartsAt);
      const proposedEnd = exactDate(proposal.action_payload?.proposedEndsAt);
      const slotParts = johannesburgSlotParts(proposedStart);
      let preflightStatus = null;
      if (
        Number(proposal.appointment_crm_v2_client_id) !== clientId
        || !proposal.normalized_mobile
      ) {
        preflightStatus = 'ownership_changed';
      } else if (!sameRevision(proposal.current_revision, proposal.appointment_revision)) {
        preflightStatus = 'appointment_changed';
      } else if (!['scheduled', 'confirmed'].includes(String(proposal.appointment_status || ''))) {
        preflightStatus = 'appointment_changed';
      } else if (new Date(proposal.starts_at).getTime() <= current.getTime() + RESCHEDULE_START_GUARD_MS) {
        preflightStatus = 'appointment_started';
      } else if (
        proposal.group_id
        || Number(proposal.staff_count) !== 1
        || Number(proposal.service_count) !== 1
      ) {
        preflightStatus = 'complex_booking';
      } else if (
        !proposedStart
        || !proposedEnd
        || !slotParts
        || proposedStart.getTime() <= current.getTime()
        || proposedEnd.getTime() <= proposedStart.getTime()
      ) {
        preflightStatus = 'slot_unavailable';
      }

      if (preflightStatus) {
        await client.query(
          `UPDATE client_action_proposals
              SET consumed_at=$2,
                  outcome=$3
            WHERE id=$1`,
          [Number(proposal.id), current, proposalOutcome(preflightStatus)],
        );
        await client.query('COMMIT');
        transactionOpen = false;
        return {
          ok: false,
          status: preflightStatus,
          actionType: ACTION_TYPE_RESCHEDULE,
        };
      }

      await client.query(
        `UPDATE client_action_proposals
            SET consumed_at=$2
          WHERE id=$1`,
        [Number(proposal.id), current],
      );
      await client.query('COMMIT');
      transactionOpen = false;

      let requestResult;
      try {
        await reconcileRescheduleHolds();
        requestResult = await rescheduleApproval.createPendingRescheduleRequest(
          String(proposal.normalized_mobile),
          {
            action: 'reschedule',
            appointment_id: Number(proposal.appointment_id),
            preferred_date: slotParts.date,
            preferred_time: slotParts.time,
            expected_revision: new Date(proposal.appointment_revision).toISOString(),
            status: 'awaiting_confirmation',
          },
        );
      } catch (error) {
        await db.query(
          `UPDATE client_action_proposals
              SET outcome='failed'
            WHERE id=$1 AND consumed_at IS NOT NULL`,
          [Number(proposal.id)],
        );
        throw error;
      }

      const outcome = rescheduleProposalOutcome(requestResult?.status);
      await db.query(
        `UPDATE client_action_proposals
            SET outcome=$2
          WHERE id=$1 AND consumed_at IS NOT NULL`,
        [Number(proposal.id), outcome],
      );

      const currentDisplay = localAppointmentDisplay(proposal.starts_at);
      const requestedDisplay = localAppointmentDisplay(proposedStart);
      return {
        ok: ['pending_approval', 'already_pending'].includes(String(requestResult?.status || '')),
        status: String(requestResult?.status || 'failed'),
        actionType: ACTION_TYPE_RESCHEDULE,
        appointment: {
          service: firstText(proposal.services, 'Shiloh appointment'),
          practitioner: firstText(proposal.practitioners, 'Shiloh practitioner'),
          currentDate: currentDisplay.date,
          currentTime: currentDisplay.time,
          requestedDate: requestedDisplay.date,
          requestedTime: requestedDisplay.time,
        },
      };
    } catch (error) {
      if (transactionOpen) {
        try { await client.query('ROLLBACK'); } catch (_) {}
      }
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
  RESCHEDULE_START_GUARD_MS,
  positiveId,
  sha256,
  randomActionToken,
  validActionToken,
  exactDate,
  johannesburgSlotParts,
  localAppointmentDisplay,
  cancellationPolicy,
  proposalOutcome,
  createMyShilohClientActionService,
  ...service,
};
