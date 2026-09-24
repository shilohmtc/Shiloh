'use strict';

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function cancelOutstandingPaymentRequestsForAppointment(db, {
  appointmentId,
  actorAdminId = null,
  reason = 'appointment_cancelled',
} = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('Payment safety database is required');
  const id = positiveId(appointmentId);
  if (!id) return { cancelled: 0, requests: [] };

  const result = await db.query(
    `UPDATE payment_requests pr
        SET state='cancelled',updated_at=NOW()
       FROM booking_payment_accounts bpa
      WHERE pr.payment_account_id=bpa.id
        AND pr.gift_voucher_order_id IS NULL
        AND pr.state IN ('created','link_issued','pending')
        AND (
          bpa.appointment_id=$1
          OR pr.deposit_member_appointment_id=$1
        )
    RETURNING pr.id,pr.request_key,pr.purpose,pr.amount,pr.payer_crm_v2_client_id`,
    [id],
  );

  if (result.rowCount) {
    await db.query(
      `INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
       VALUES($1,'payment.open_requests_cancelled_with_booking','appointment',$2,$3::jsonb)`,
      [
        positiveId(actorAdminId),
        id,
        JSON.stringify({
          reason: String(reason || 'appointment_cancelled').slice(0, 160),
          requestCount: result.rowCount,
          requestIds: result.rows.map(row => Number(row.id)),
          requestPurposes: result.rows.map(row => String(row.purpose || 'general')),
          providerLinksNoLongerUsableThroughShiloh: true,
          automaticRefundIssued: false,
        }),
      ],
    );
  }

  return {
    cancelled: result.rowCount,
    requests: result.rows.map(row => ({
      id: Number(row.id),
      requestKey: row.request_key,
      purpose: row.purpose,
      amount: row.amount,
      crmV2ClientId: row.payer_crm_v2_client_id ? Number(row.payer_crm_v2_client_id) : null,
    })),
  };
}

function isCancelledAppointmentStatus(value) {
  return String(value || '').trim().toLowerCase() === 'cancelled';
}

module.exports = {
  positiveId,
  cancelOutstandingPaymentRequestsForAppointment,
  isCancelledAppointmentStatus,
};
