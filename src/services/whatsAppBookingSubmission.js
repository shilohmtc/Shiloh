'use strict';

const { pool } = require('../db/pool');
const {
  BOOKING_POLICY_VERSION: POLICY_VERSION,
  BOOKING_POLICY_TEXT: POLICY_TEXT,
} = require('../config/bookingPolicyAuthority');
const { localDate, localTime } = require('./myShilohBooking');
const { issueBookingAction, BOOKING_ACTION_TTL_SECONDS } = require('./whatsAppBookingActions');

async function stageReviewedRequest(pool, { mobile, clientId, service, practitioner, startsAt }) {
  const db = await pool.connect();
  const slot = new Date(startsAt);
  const details = [
    mobile,
    clientId,
    service,
    practitioner,
    localDate(slot),
    localTime(slot),
    POLICY_VERSION,
  ];
  try {
    await db.query('BEGIN');
    const intent = await db.query(
      `
      INSERT INTO booking_intents (
        phone,service_text,therapist_text,preferred_date,preferred_time,service_verified,
        status,policy_version,policy_accepted_at,policy_channel
      )
      SELECT $1::text,$3,$4,$5,$6,true,'policy_accepted',$7,NOW(),'whatsapp'
      FROM crm_v2_clients c
      WHERE c.id=$2 AND c.normalized_mobile=$1::text AND c.status='active'
        AND c.profile_status='registered' AND c.mobile_verified_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM crm_v2_clients other WHERE other.id<>c.id AND other.status='active' AND other.normalized_mobile=$1::text
        )
        AND NOT EXISTS (
          SELECT 1 FROM client_contacts contact WHERE contact.normalized_value=$1::text
            AND lower(contact.contact_type) IN ('phone','telephone','mobile','whatsapp')
        )
      ON CONFLICT (phone) DO NOTHING
      RETURNING policy_accepted_at::text AS accepted_at`,
      details,
    );
    if (!intent.rows.length) {
      const prior = await db.query(
        `
        SELECT p.id, p.accepted_at FROM booking_policy_acceptances p
        JOIN booking_intents i ON i.phone=p.phone AND i.policy_accepted_at=p.accepted_at
          AND i.policy_version=p.policy_version AND i.policy_channel=p.channel
        JOIN crm_v2_clients c ON c.id=p.crm_v2_client_id
        WHERE p.phone=$1::text AND p.crm_v2_client_id=$2 AND p.service_text=$3
          AND p.therapist_text=$4 AND p.preferred_date=$5 AND p.preferred_time=$6
          AND p.policy_version=$7 AND p.channel='whatsapp' AND p.appointment_id IS NULL
          AND p.accepted_at >= NOW()-INTERVAL '15 minutes'
          AND i.status='policy_accepted'
          AND i.service_text=$3 AND i.therapist_text=$4 AND i.preferred_date=$5 AND i.preferred_time=$6
          AND c.status='active' AND c.profile_status='registered' AND c.mobile_verified_at IS NOT NULL
          AND c.normalized_mobile=$1::text
        FOR UPDATE OF i,p`,
        details,
      );
      await db.query('COMMIT');
      return prior.rows.length === 1
        ? { id: String(prior.rows[0].id), acceptedAt: prior.rows[0].accepted_at }
        : null;
    }

    const acceptance = await db.query(
      `
      INSERT INTO booking_policy_acceptances (
        phone,crm_v2_client_id,service_text,therapist_text,preferred_date,preferred_time,
        policy_version,accepted_at,policy_text_snapshot,channel
      ) VALUES($1::text,$2,$3,$4,$5,$6,$7,$8,$9,'whatsapp')
      RETURNING id`,
      [...details, intent.rows[0].accepted_at, POLICY_TEXT],
    );
    await db.query('COMMIT');
    return { id: String(acceptance.rows[0].id), acceptedAt: intent.rows[0].accepted_at };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

function createWhatsAppBookingSubmission({
  continuation,
  actionSecret,
  db = pool,
  stage = stageReviewedRequest,
}) {
  if (!actionSecret) throw new TypeError('Booking action key required');
  return async ({ token, session, reviewHash, policyAccepted }) => {
    if (policyAccepted !== true) return { status: 'terms_required' };
    const review = await continuation.resume(token, session);
    if (review?.status !== 'review' || review.reviewHash !== reviewHash)
      return { status: 'review_changed' };
    const mobile = continuation.selectedMobile(token);
    if (!mobile) return { status: 'review_changed' };
    const acceptance = await stage(db, {
      mobile,
      clientId: session.crmV2ClientId,
      service: review.service.name,
      practitioner: review.practitioner.name,
      startsAt: review.startsAt,
    });
    if (!acceptance) return { status: 'request_in_progress' };
    const acceptanceId = acceptance.id;
    const acceptedAt = new Date(acceptance.acceptedAt).getTime();
    return {
      status: 'ready',
      recipient: mobile,
      acceptanceId,
      expiresAt: new Date(
        (Math.floor(acceptedAt / 1000) + BOOKING_ACTION_TTL_SECONDS) * 1000,
      ).toISOString(),
      action: issueBookingAction(
        {
          acceptanceId,
          verifiedClientId: String(session.crmV2ClientId),
          senderMobile: mobile,
          reviewHash,
        },
        { secret: actionSecret, now: acceptedAt },
      ),
    };
  };
}

module.exports = { createWhatsAppBookingSubmission };
