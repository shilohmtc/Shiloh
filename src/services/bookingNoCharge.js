'use strict';
const { createHash } = require('node:crypto');
const { hasCapability, hasFullAppointmentEditAuthority } = require('./calendarAuthorization');

// Reuse the canonical appointment financial classification and audit authority.
// A waiver is never a receipt, prior-payment entry, credit or attendance change.
function createBookingNoChargeActions({
  db,
  ErrorType,
  positiveId,
  requestKey,
  resolveOperator,
  loadSubject,
  assertTarget,
  accountFor,
  position,
  syncDepositAfterSettlement,
}) {
  const fail = (code, message, status = 409) => {
    throw new ErrorType(code, message, status);
  };
  function allowed(operator) {
    const authority = operator.calendarAuthority;
    return (
      ['owner', 'business_admin', 'booking_operator'].includes(authority.businessRole) &&
      hasFullAppointmentEditAuthority(authority) &&
      hasCapability(authority, 'payment:view') &&
      hasCapability(authority, 'payment:collect')
    );
  }
  async function record(input = {}) {
    const data = {
      adminId: positiveId(input.adminId),
      appointmentId: positiveId(input.appointmentId),
      operationId: requestKey(input.operationId),
      expectedRevision: String(input.expectedRevision || ''),
      reason: String(input.reason || '').trim(),
    };
    if (
      !data.reason ||
      data.reason.length > 240 ||
      (input.reviewed !== true && input.reviewed !== 'on')
    )
      fail(
        'NO_CHARGE_REVIEW_REQUIRED',
        'Enter a reason and confirm that this treatment is free, not paid previously.',
        400,
      );
    const revision = new Date(data.expectedRevision);
    if (!Number.isFinite(revision.getTime()) || revision.toISOString() !== data.expectedRevision)
      fail('NO_CHARGE_INVALID_REVISION', 'Reload the booking before recording no charge.', 400);
    const fingerprint = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    const client = await db.connect();
    let result;
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT id FROM staff_admin_accounts WHERE id=$1 AND active=TRUE FOR SHARE',
        [data.adminId],
      );
      const operator = await resolveOperator(client, data.adminId, 'payment:collect');
      if (!allowed(operator))
        fail(
          'NO_CHARGE_FORBIDDEN',
          'Clinic-wide payment and appointment editing access is required.',
          403,
        );
      await client.query("SELECT pg_advisory_xact_lock(hashtext('shiloh-prior-payments'))");
      const subject = await loadSubject(client, data.appointmentId, { lock: true });
      assertTarget(operator, subject);
      const replay = (
        await client.query(
          `SELECT metadata FROM crm_audit_events WHERE action='booking.no_charge_recorded' AND actor_admin_id=$1 AND metadata->>'operationId'=$2 ORDER BY id LIMIT 1`,
          [data.adminId, data.operationId],
        )
      ).rows[0];
      if (replay) {
        if (replay.metadata.fingerprint !== fingerprint)
          fail(
            'NO_CHARGE_RETRY_MISMATCH',
            'This request identifier was already used for a different decision.',
          );
        const account = await accountFor(client, subject);
        result = { status: 'idempotent_replay', payment: await position(client, account, subject) };
      } else {
        if (subject.status !== 'completed' || subject.groupId)
          fail(
            'NO_CHARGE_BOOKING_REVIEW',
            'Complete an ordinary treatment first; linked bookings need separate review.',
          );
        if (subject.pricingRevision !== data.expectedRevision)
          fail(
            'NO_CHARGE_STALE',
            'The booking changed. Reload and review it before recording no charge.',
          );
        if (subject.financialClassification === 'no_charge')
          fail(
            'NO_CHARGE_ALREADY_ZERO',
            'This booking is already marked no charge. Review its audit history.',
          );
        const packages = await client.query(
          'SELECT 1 FROM package_session_redemptions WHERE appointment_id=$1 LIMIT 1',
          [subject.appointmentId],
        );
        if (packages.rowCount)
          fail(
            'NO_CHARGE_PACKAGE_REVIEW',
            'This is a package visit. Use its existing package evidence rather than no charge.',
          );
        const account = await accountFor(client, subject, { create: true });
        // Match account-before-request serialization used by collection and
        // verified callbacks before deciding whether financial activity exists.
        await client.query(
          'SELECT id FROM payment_requests WHERE payment_account_id=$1 ORDER BY id FOR UPDATE',
          [account.id],
        );
        const activity = await client.query(
          `SELECT 1 FROM payment_ledger_entries WHERE payment_account_id=$1
          UNION ALL SELECT 1 FROM treatment_credit_entries WHERE booking_payment_account_id=$1
          UNION ALL SELECT 1 FROM booking_gift_voucher_allocations WHERE booking_payment_account_id=$1
          UNION ALL SELECT 1 FROM booking_prior_payment_entries WHERE booking_payment_account_id=$1 OR source_payment_account_id=$1
          UNION ALL SELECT 1 FROM booking_loyalty_allocations WHERE booking_payment_account_id=$1
          UNION ALL SELECT 1 FROM booking_welcome_voucher_allocations WHERE booking_payment_account_id=$1 LIMIT 1`,
          [account.id],
        );
        if (activity.rowCount)
          fail(
            'NO_CHARGE_PAYMENT_REVIEW',
            'This booking already has payment or credit activity. Review that evidence before changing its charge.',
          );
        await client.query(
          `UPDATE appointments SET financial_classification='no_charge',pre_adjustment_total_price=COALESCE(pre_adjustment_total_price,total_price),total_price=0,updated_at=NOW() WHERE id=$1`,
          [subject.appointmentId],
        );
        const updated = await loadSubject(client, subject.appointmentId);
        const refreshed = await accountFor(client, updated, { create: true });
        const closed = await client.query(
          "UPDATE payment_requests SET state='cancelled',updated_at=NOW() WHERE payment_account_id=$1 AND state IN ('created','link_issued','pending') RETURNING id",
          [account.id],
        );
        await client.query(
          `INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata) VALUES($1,'booking.no_charge_recorded','appointment',$2,$3::jsonb)`,
          [
            data.adminId,
            subject.appointmentId,
            JSON.stringify({
              ...data,
              fingerprint,
              originalPrice: subject.originalPrice || subject.amountDue,
              previousChargedPrice: subject.amountDue,
              clientCharge: '0.00',
              practitionerEarnings: '0.00',
              previousClassification: subject.financialClassification,
              closedRequestIds: closed.rows.map((row) => Number(row.id)),
              statusUnchanged: subject.status,
            }),
          ],
        );
        result = {
          status: 'no_charge_recorded',
          payment: await position(client, refreshed, updated),
        };
      }
      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
      throw error;
    } finally {
      client.release();
    }
    await syncDepositAfterSettlement(data.appointmentId);
    return result;
  }
  return { allowed, record };
}
module.exports = { createBookingNoChargeActions };
