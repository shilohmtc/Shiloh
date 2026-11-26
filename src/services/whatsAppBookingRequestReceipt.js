'use strict';

const { normalizeMobile } = require('./crmV2ClientService');

const PENDING_REPLY = 'Your request is with Reception. We’ll message you when it’s reviewed.';

function validId(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0;
  return (
    typeof value === 'string' &&
    /^[1-9][0-9]{0,18}$/.test(value) &&
    BigInt(value) <= 9223372036854775807n
  );
}

// Called with the original server-bound policy acceptance and verified profile.
// An inconclusive lookup must never authorize a second booking or a client message.
async function pendingRequestReceipt(db, { acceptanceId, verifiedClientId, senderMobile }) {
  if (typeof senderMobile !== 'string' || !/^[0-9]{7,15}$/.test(senderMobile)) return null;
  const phone = normalizeMobile(senderMobile);
  // PostgreSQL bigint identifiers normally arrive as strings.
  if (!phone || !validId(acceptanceId) || !validId(verifiedClientId)) return null;

  const { rows } = await db.query(
    `
    SELECT a.id
      FROM booking_policy_acceptances p
      JOIN appointments a ON a.id=p.appointment_id AND a.crm_v2_client_id=p.crm_v2_client_id
      JOIN crm_v2_clients c ON c.id=a.crm_v2_client_id
      JOIN appointment_booking_approvals r ON r.appointment_id=a.id
     WHERE p.id=$1 AND p.channel='whatsapp' AND p.crm_v2_client_id=$2 AND p.phone=$3
       AND c.status='active' AND c.profile_status='registered' AND c.normalized_mobile=$3 AND c.mobile_verified_at IS NOT NULL
       AND a.source='shiloh_client_whatsapp' AND a.status='scheduled'
       AND r.status='pending' AND r.requested_crm_v2_client_id=c.id
       AND r.requested_client_phone=$3 AND r.requested_revision=a.updated_at
       AND NOT EXISTS (
         SELECT 1 FROM crm_v2_clients other
          WHERE other.id<>c.id AND other.status='active' AND other.normalized_mobile=$3
       )
       AND NOT EXISTS (
         SELECT 1 FROM client_contacts contact
          WHERE contact.normalized_value=$3
            AND lower(contact.contact_type) IN ('phone','telephone','mobile','whatsapp')
       )`,
    [acceptanceId, verifiedClientId, phone],
  );
  if (rows.length !== 1) return null;
  return {
    appointmentId: String(rows[0].id),
    status: 'pending_resolution',
    reply: PENDING_REPLY,
  };
}

module.exports = { pendingRequestReceipt, PENDING_REPLY };
