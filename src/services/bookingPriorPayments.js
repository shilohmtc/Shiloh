'use strict';
const { createHash } = require('node:crypto');
const { priorPaymentOutgoingSql } = require('../domain/priorPaymentSql');
const { hasCapability } = require('./calendarAuthorization');

function createBookingPriorPaymentActions({
  db,
  money,
  requestKey,
  positiveId,
  ErrorType,
  resolveOperator,
  loadSubject,
  assertTarget,
  accountFor,
  position,
  syncDepositAfterSettlement,
  now = () => new Date(),
}) {
  const fail = (code, message, status = 409) => {
    throw new ErrorType(code, message, status);
  };
  const today = () => now().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
  const cents = (value) => Math.round(Number(value) * 100);
  function text(value, max, label) {
    const result = String(value || '').trim();
    if (!result || result.length > max)
      fail('PRIOR_PAYMENT_INVALID_INPUT', `Enter ${label} (up to ${max} characters).`, 400);
    return result;
  }
  function allowed(operator) {
    const authority = operator.calendarAuthority;
    return (
      ['owner', 'booking_operator'].includes(authority.businessRole) &&
      authority.calendarScope === 'all_business' &&
      authority.serviceScope === 'all_services' &&
      hasCapability(authority, 'payment:view')
    );
  }
  async function operatorFor(queryable, adminId) {
    const operator = await resolveOperator(queryable, adminId, 'payment:collect');
    if (!allowed(operator))
      fail('PRIOR_PAYMENT_FORBIDDEN', 'Reception or clinic owner payment access is required.', 403);
    return operator;
  }
  async function evidenceModel(queryable, subject, account, candidatesAllowed = false) {
    const entries = account
      ? (
          await queryable.query(
            `SELECT e.*,a.display_name AS actor_name,
      EXISTS(SELECT 1 FROM booking_prior_payment_entries undo WHERE undo.correction_target_id=e.id) AS reversed
      FROM booking_prior_payment_entries e JOIN staff_admin_accounts a ON a.id=e.actor_admin_id
      WHERE e.booking_payment_account_id=$1 OR e.source_payment_account_id=$1 ORDER BY e.id DESC`,
            [account.id],
          )
        ).rows
      : [];
    const candidates =
      candidatesAllowed && subject.crmV2ClientId && !subject.groupId
        ? (
            await queryable.query(
              `SELECT e.id,e.amount,e.method,e.created_at,
      COALESCE(e.external_reference,e.provider_transaction_id,'Receipt #'||e.id) AS reference,p.appointment_id,
      GREATEST(0,LEAST(e.amount-COALESCE((SELECT SUM(signed_amount) FROM booking_prior_payment_entries WHERE source_payment_ledger_entry_id=e.id),0),
        (SELECT COALESCE(SUM(CASE WHEN entry_type='payment' THEN amount ELSE -amount END),0)
        FROM payment_ledger_entries WHERE payment_account_id=p.id)-p.canonical_amount_due-${priorPaymentOutgoingSql('p.id')})) AS available
      FROM payment_ledger_entries e JOIN booking_payment_accounts p ON p.id=e.payment_account_id
      JOIN appointments source ON source.id=p.appointment_id JOIN crm_v2_clients c ON c.id=source.crm_v2_client_id
      WHERE source.crm_v2_client_id=$1 AND source.client_id IS NULL AND c.status='active'
        AND p.canonical_amount_due>0 AND source.total_price=p.canonical_amount_due
        AND source.id<>$2 AND e.entry_type='payment' AND (e.created_at AT TIME ZONE 'Africa/Johannesburg')::date<$3::date
        AND NOT EXISTS(SELECT 1 FROM appointment_group_members gm WHERE gm.appointment_id=source.id)
      ORDER BY e.id DESC`,
              [subject.crmV2ClientId, subject.appointmentId, today()],
            )
          ).rows.filter((e) => Number(e.available) > 0)
        : [];
    return { entries, candidates };
  }
  async function execute(input, undo = false) {
    const data = {
      adminId: positiveId(input.adminId),
      appointmentId: positiveId(input.appointmentId),
      operationId: requestKey(input.operationId),
      action: undo ? 'undo' : 'apply',
    };
    if (input.reviewed !== true && input.reviewed !== 'on')
      fail(
        'PRIOR_PAYMENT_REVIEW_REQUIRED',
        'Check the payment history and packages before confirming.',
        400,
      );
    data.reason = text(input.reason, 240, undo ? 'a correction reason' : 'a payment evidence note');
    if (undo) data.entryId = positiveId(input.entryId);
    else {
      data.amount = money(input.amount, { positive: true });
      data.sourceEntryId = input.sourceEntryId ? positiveId(input.sourceEntryId) : null;
      if (!data.sourceEntryId) {
        data.reference = text(input.reference, 120, 'the original payment reference');
        data.paymentDate = String(input.paymentDate || '');
        const date = new Date(data.paymentDate + 'T00:00:00Z');
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(data.paymentDate) ||
          !Number.isFinite(date.getTime()) ||
          date.toISOString().slice(0, 10) !== data.paymentDate ||
          data.paymentDate >= today()
        )
          fail('PRIOR_PAYMENT_INVALID_DATE', 'Enter the original payment date before today.', 400);
      }
    }
    const fingerprint = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    const connection = await db.connect();
    let subject, sourceAppointmentId;
    try {
      await connection.query('BEGIN');
      await connection.query(
        'SELECT id FROM staff_admin_accounts WHERE id=$1 AND active=TRUE FOR SHARE',
        [data.adminId],
      );
      const operator = await operatorFor(connection, data.adminId);
      // Serialize receipt allocations, historical evidence checks and reversals across accounts.
      await connection.query("SELECT pg_advisory_xact_lock(hashtext('shiloh-prior-payments'))");
      subject = await loadSubject(connection, data.appointmentId, { lock: true });
      assertTarget(operator, subject);
      const replay = (
        await connection.query(
          'SELECT * FROM booking_prior_payment_entries WHERE operation_id=$1',
          [data.operationId],
        )
      ).rows[0];
      if (replay) {
        if (replay.request_fingerprint !== fingerprint)
          fail(
            'PRIOR_PAYMENT_RETRY_MISMATCH',
            'This request already belongs to different payment evidence. Review the history.',
          );
        await connection.query('COMMIT');
        await syncDepositAfterSettlement(subject.appointmentId);
        return { status: 'idempotent_replay', entry: replay };
      }
      if (!subject.crmV2ClientId || subject.legacyClientId)
        fail(
          'PRIOR_PAYMENT_CLIENT_REQUIRED',
          'Link this booking to its current Shiloh client before recording prior payment.',
        );
      if (
        !undo &&
        !(
          await connection.query(
            "SELECT id FROM crm_v2_clients WHERE id=$1 AND status='active' FOR SHARE",
            [subject.crmV2ClientId],
          )
        ).rows.length
      )
        fail(
          'PRIOR_PAYMENT_CLIENT_REQUIRED',
          'Use the current active Shiloh client before recording prior payment.',
        );
      if (!undo && subject.final)
        fail(
          'PRIOR_PAYMENT_BOOKING_FINAL',
          'Review the cancelled booking before allocating prior payment.',
        );
      if (subject.groupId && !undo) {
        const unsafe = await connection.query(
          `SELECT 1 FROM appointment_group_members gm JOIN appointments a ON a.id=gm.appointment_id
          WHERE gm.group_id=$1 AND (a.crm_v2_client_id IS DISTINCT FROM $2::bigint OR a.client_id IS NOT NULL OR a.status='cancelled') LIMIT 1`,
          [subject.groupId, subject.crmV2ClientId],
        );
        if (unsafe.rowCount)
          fail(
            'PRIOR_PAYMENT_GROUP_REVIEW',
            'Linked bookings with different clients need payment allocation review.',
          );
      }
      const account = await accountFor(connection, subject, { create: true });
      let original;
      if (undo) {
        original = (
          await connection.query(
            "SELECT * FROM booking_prior_payment_entries WHERE id=$1 AND booking_payment_account_id=$2 AND entry_type='apply'",
            [data.entryId, account.id],
          )
        ).rows[0];
        if (!original)
          fail(
            'PRIOR_PAYMENT_NOT_FOUND',
            'Choose original prior-payment evidence on this booking.',
            404,
          );
        if (
          (
            await connection.query(
              'SELECT 1 FROM booking_prior_payment_entries WHERE correction_target_id=$1',
              [original.id],
            )
          ).rows.length
        )
          fail(
            'PRIOR_PAYMENT_ALREADY_REVERSED',
            'That prior-payment entry has already been reversed.',
          );
        Object.assign(data, {
          amount: original.amount,
          reference: original.reference,
          paymentDate: original.payment_date,
          sourceEntryId: original.source_payment_ledger_entry_id,
        });
        if (original.source_payment_account_id) {
          const sourceAccount = (
            await connection.query(
              'SELECT * FROM booking_payment_accounts WHERE id=$1 FOR UPDATE',
              [original.source_payment_account_id],
            )
          ).rows[0];
          sourceAppointmentId = Number(sourceAccount.appointment_id);
        }
      } else {
        const current = await position(connection, account, subject);
        if (Number(data.amount) > Number(current.outstanding))
          fail('PRIOR_PAYMENT_EXCEEDS_BALANCE', 'The amount is greater than the balance to pay.');
        if (data.sourceEntryId) {
          const source = (
            await connection.query(
              `SELECT e.*,p.appointment_id FROM payment_ledger_entries e
            JOIN booking_payment_accounts p ON p.id=e.payment_account_id WHERE e.id=$1 AND e.entry_type='payment'`,
              [data.sourceEntryId],
            )
          ).rows[0];
          if (
            !source?.appointment_id ||
            Number(source.payment_account_id) === Number(account.id) ||
            subject.groupId
          )
            fail(
              'PRIOR_PAYMENT_SOURCE_UNAVAILABLE',
              'Choose an available receipt from another ordinary booking for this client. Payments on this booking are already included.',
            );
          const sourceSubject = await loadSubject(connection, source.appointment_id, {
            lock: true,
          });
          assertTarget(operator, sourceSubject);
          if (
            sourceSubject.crmV2ClientId !== subject.crmV2ClientId ||
            sourceSubject.groupId ||
            sourceSubject.legacyClientId
          )
            fail(
              'PRIOR_PAYMENT_SOURCE_UNAVAILABLE',
              'Choose an available receipt for this same client.',
            );
          const sourceAccount = await accountFor(connection, sourceSubject, { create: true });
          if (Number(sourceAccount.canonical_amount_due) <= 0)
            fail(
              'PRIOR_PAYMENT_SOURCE_PRICE_REVIEW',
              'Review the original treatment price and payment history before linking unused receipt value.',
            );
          const sourcePosition = await position(connection, sourceAccount, sourceSubject);
          const used = (
            await connection.query(
              'SELECT COALESCE(SUM(signed_amount),0) AS amount FROM booking_prior_payment_entries WHERE source_payment_ledger_entry_id=$1',
              [source.id],
            )
          ).rows[0];
          // Only surplus cash can move. Never take payment covering another treatment or credit.
          const surplus = cents(sourcePosition.netPaid) - cents(sourceAccount.canonical_amount_due);
          if (cents(data.amount) > Math.min(surplus, cents(source.amount) - cents(used.amount)))
            fail(
              'PRIOR_PAYMENT_SOURCE_ALLOCATED',
              'This receipt already covers another booking or has insufficient unused value.',
            );
          const paymentDate = new Date(source.created_at).toLocaleDateString('en-CA', {
            timeZone: 'Africa/Johannesburg',
          });
          if (paymentDate >= today())
            fail(
              'PRIOR_PAYMENT_INVALID_DATE',
              'Use the normal payment action for money received today.',
              400,
            );
          Object.assign(data, {
            paymentDate,
            reference: String(
              source.external_reference ||
                source.provider_transaction_id ||
                `Receipt #${source.id}`,
            ),
            sourceAccountId: sourceAccount.id,
          });
          sourceAppointmentId = sourceSubject.appointmentId;
        } else {
          const duplicate = await connection.query(
            `SELECT 1 FROM payment_ledger_entries WHERE entry_type='payment'
            AND (LOWER(TRIM(external_reference))=LOWER($1) OR LOWER(TRIM(provider_transaction_id))=LOWER($1))
            UNION ALL SELECT 1 FROM client_package_entitlements WHERE LOWER(TRIM(payment_reference))=LOWER($1)
            UNION ALL SELECT 1 FROM booking_prior_payment_entries e WHERE e.crm_v2_client_id=$2
              AND LOWER(TRIM(e.reference))=LOWER($1) AND e.entry_type='apply'
              AND NOT EXISTS(SELECT 1 FROM booking_prior_payment_entries undo WHERE undo.correction_target_id=e.id) LIMIT 1`,
            [data.reference, subject.crmV2ClientId],
          );
          if (duplicate.rows.length)
            fail(
              'PRIOR_PAYMENT_DUPLICATE',
              'That payment or package evidence is already recorded. Use the existing record instead.',
            );
        }
      }
      const entry = (
        await connection.query(
          `INSERT INTO booking_prior_payment_entries
        (booking_payment_account_id,appointment_id,crm_v2_client_id,entry_type,amount,source_payment_ledger_entry_id,source_payment_account_id,correction_target_id,payment_date,reference,reason,actor_admin_id,operation_id,request_fingerprint)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
          [
            account.id,
            subject.appointmentId,
            subject.crmV2ClientId,
            data.action,
            data.amount,
            data.sourceEntryId || null,
            original?.source_payment_account_id || data.sourceAccountId || null,
            original?.id || null,
            data.paymentDate,
            data.reference,
            data.reason,
            operator.id,
            data.operationId,
            fingerprint,
          ],
        )
      ).rows[0];
      await connection.query(
        `INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
        VALUES($1,$2,'booking_prior_payment_entry',$3,$4::jsonb)`,
        [
          operator.id,
          undo ? 'payment.prior_reversed' : 'payment.prior_applied',
          entry.id,
          JSON.stringify({
            appointmentId: subject.appointmentId,
            sourceEntryId: data.sourceEntryId,
            amount: data.amount,
            paymentDate: data.paymentDate,
            reference: data.reference,
            operationId: data.operationId,
          }),
        ],
      );
      const payment = await position(connection, account, subject);
      // A previous receipt can make current links unsafe; preserve their history and provider callbacks.
      if (!undo)
        await connection.query(
          "UPDATE payment_requests SET state='cancelled',prior_payment_closed_by_entry_id=$2,updated_at=NOW() WHERE payment_account_id=$1 AND state IN ('created','link_issued','pending')",
          [account.id, entry.id],
        );
      await connection.query('COMMIT');
      await syncDepositAfterSettlement(subject.appointmentId);
      if (sourceAppointmentId) await syncDepositAfterSettlement(sourceAppointmentId);
      return { status: undo ? 'reversed' : 'applied', entry, payment };
    } catch (error) {
      try {
        await connection.query('ROLLBACK');
      } catch (_) {}
      throw error;
    } finally {
      connection.release();
    }
  }
  return {
    allowed,
    evidenceModel,
    recordPrior: (input) => execute(input),
    reversePrior: (input) => execute(input, true),
  };
}
module.exports = { createBookingPriorPaymentActions };
