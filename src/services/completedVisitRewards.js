'use strict';
const { createHash } = require('node:crypto');
const { pool } = require('../db/pool');
const {
  resolveCalendarAuthority,
  hasCapability,
  allowsAppointmentTarget,
} = require('./calendarAuthorization');
const {
  lockCompletedTreatmentAccount,
  remainingTreatmentCents,
} = require('./clientTreatmentCredit');
const { lockBookingPaymentScope } = require('./paymentCollectionGuard');
function fail(code, message, httpStatus = 409) {
  throw Object.assign(new Error(message), { code, httpStatus });
}
function id(value) {
  if (
    !['string', 'number'].includes(typeof value) ||
    !/^[1-9][0-9]*$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value))
  )
    fail('REWARDS_INVALID_ID', 'Choose a valid client and visit.', 400);
  return Number(value);
}
function cents(value) {
  const raw = String(value ?? '');
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(raw) || !Number.isSafeInteger(Math.round(Number(raw) * 100)))
    fail('REWARDS_INVALID_AMOUNT', 'Enter a valid Rand amount.', 400);
  return Math.round(Number(raw) * 100);
}
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function inputData(input) {
  const amount = cents(input.amount);
  if (amount <= 0) fail('REWARDS_INVALID_AMOUNT', 'Enter a reward amount greater than zero.', 400);
  return {
    adminId: id(input.adminId),
    clientId: id(input.crmV2ClientId),
    appointmentId: id(input.appointmentId),
    amount: (amount / 100).toFixed(2),
  };
}
function createCompletedVisitRewards({
  db = pool,
  authorityResolver = resolveCalendarAuthority,
} = {}) {
  async function access(q, data, lock) {
    if (lock)
      await q.query('SELECT id FROM staff_admin_accounts WHERE id=$1 AND active=TRUE FOR SHARE', [
        data.adminId,
      ]);
    const principal = await authorityResolver(q, data.adminId, {
      additionalCapabilities: ['loyalty:view', 'loyalty:redeem', 'payment:view'],
    });
    const a = principal?.calendarAuthority;
    if (
      !a ||
      a.calendarScope !== 'all_business' ||
      a.serviceScope !== 'all_services' ||
      ![
        'loyalty:view',
        'loyalty:redeem',
        'payment:view',
        'client:lookup',
        'appointment:view',
      ].every((c) => hasCapability(a, c))
    )
      fail(
        'REWARDS_FORBIDDEN',
        'Your current access does not permit this visit reward action.',
        403,
      );
    return a;
  }
  async function target(q, data, authority) {
    const memberships = (
      await q.query('SELECT group_id FROM appointment_group_members WHERE appointment_id=$1', [
        data.appointmentId,
      ])
    ).rows;
    if (memberships.length > 1)
      fail('REWARDS_GROUP_REVIEW', 'Review this linked booking before applying rewards.');
    const groupId = memberships[0]?.group_id || null;
    const members = (
      await q.query(
        `SELECT a.id,a.crm_v2_client_id,a.client_id,a.status,a.total_price,a.currency,a.updated_at,
      ARRAY(SELECT ast.staff_id FROM appointment_staff ast WHERE ast.appointment_id=a.id AND ast.staff_id IS NOT NULL) AS staff_ids,
      ARRAY(SELECT aps.service_id FROM appointment_services aps WHERE aps.appointment_id=a.id AND aps.service_id IS NOT NULL) AS service_ids,
      EXISTS(SELECT 1 FROM appointment_services aps JOIN service_visibility_policies vp ON vp.service_id=aps.service_id WHERE aps.appointment_id=a.id AND vp.visibility_scope='tenant_private') AS private_service,
      EXISTS(SELECT 1 FROM crm_v2_client_relationships r WHERE r.client_id=a.crm_v2_client_id AND r.relationship_type='clinic' AND r.owner_staff_id IS NULL) AS clinic_client,
      (SELECT COUNT(*) FROM appointment_group_members gm WHERE gm.appointment_id=a.id) AS memberships
      FROM appointments a JOIN crm_v2_clients c ON c.id=a.crm_v2_client_id AND c.status='active'
      WHERE ($2::bigint IS NULL AND a.id=$1) OR ($2::bigint IS NOT NULL AND EXISTS(SELECT 1 FROM appointment_group_members gm WHERE gm.appointment_id=a.id AND gm.group_id=$2)) ORDER BY a.id LIMIT 101`,
        [data.appointmentId, groupId],
      )
    ).rows;
    if (
      !members.length ||
      members.length > 100 ||
      !members.some((m) => Number(m.id) === data.appointmentId)
    )
      fail('REWARDS_BOOKING_FORBIDDEN', 'Choose a completed visit for this active client.', 403);
    if (
      members.some(
        (m) =>
          m.private_service ||
          !m.clinic_client ||
          !allowsAppointmentTarget(authority, { staffIds: m.staff_ids, serviceIds: m.service_ids }),
      )
    )
      fail('REWARDS_BOOKING_FORBIDDEN', 'This visit is outside your current access.', 403);
    if (
      members.some(
        (m) =>
          m.client_id != null ||
          Number(m.crm_v2_client_id) !== data.clientId ||
          m.status !== 'completed' ||
          Number(m.memberships) > 1,
      )
    )
      fail(
        'REWARDS_GROUP_REVIEW',
        'All linked treatments must be completed for this same client before rewards can be used.',
      );
    let group = null;
    if (groupId) {
      group = (await q.query('SELECT * FROM appointment_groups WHERE id=$1', [groupId])).rows[0];
      const count = (
        await q.query('SELECT COUNT(*) AS count FROM appointment_group_members WHERE group_id=$1', [
          groupId,
        ])
      ).rows[0];
      if (!group || group.status !== 'completed' || Number(count.count) !== members.length)
        fail('REWARDS_GROUP_REVIEW', 'Review all linked treatments before applying rewards.');
    }
    if (members.some((m) => m.currency !== 'ZAR'))
      fail('REWARDS_PRICE_UNAVAILABLE', 'Confirm the Rand treatment price before using rewards.');
    const due = group ? (group.final_total ?? group.total_price) : members[0].total_price;
    cents(due);
    return {
      groupId,
      members,
      due,
      revision: new Date(group?.updated_at || members[0].updated_at).toISOString(),
    };
  }
  async function position(q, data, subject, { lock = false, account: lockedAccount } = {}) {
    const account =
      lockedAccount ||
      (
        await q.query(
          `SELECT * FROM booking_payment_accounts WHERE ${subject.groupId ? 'appointment_group_id' : 'appointment_id'}=$1`,
          [subject.groupId || data.appointmentId],
        )
      ).rows[0];
    if (
      account &&
      (account.currency !== 'ZAR' || cents(account.canonical_amount_due) !== cents(subject.due))
    )
      fail(
        'REWARDS_PRICE_CHANGED',
        'Review the changed treatment price and payment account first.',
      );
    if (account) {
      await require('./paymentCollectionGuard').assertNoClientCollection(q, account.id);
      const pending = (
        await q.query(
          "SELECT id FROM booking_deposit_requirements WHERE payment_account_id=$1 AND state='awaiting'",
          [account.id],
        )
      ).rows;
      const links = (
        await q.query(
          "SELECT id FROM payment_requests WHERE payment_account_id=$1 AND state IN ('created','link_issued','pending')",
          [account.id],
        )
      ).rows;
      if (pending.length || links.length)
        fail(
          'REWARDS_COLLECTION_REVIEW',
          'Review the deposit and active payment links before applying rewards.',
        );
    }
    const wallet = (
      await q.query(
        `SELECT id FROM loyalty_wallets WHERE crm_v2_client_id=$1 ${lock ? 'FOR UPDATE' : ''}`,
        [data.clientId],
      )
    ).rows[0];
    if (!wallet) fail('REWARDS_NOT_UNLOCKED', 'This client has no available Shiloh Rewards.');
    const entry = (
      await q.query(
        'SELECT COALESCE(SUM(signed_amount),0) AS balance,COALESCE(MAX(id),0) AS revision FROM loyalty_wallet_entries WHERE wallet_id=$1',
        [wallet.id],
      )
    ).rows[0];
    const config = (
      await q.query('SELECT unlock_threshold FROM loyalty_program_settings WHERE singleton=TRUE')
    ).rows[0];
    if (!config) fail('REWARDS_UNAVAILABLE', 'Shiloh Rewards is temporarily unavailable.', 503);
    const available = cents(entry.balance),
      requested = cents(data.amount),
      threshold = cents(config.unlock_threshold);
    const outstanding = await remainingTreatmentCents(
      q,
      account || { id: null, canonical_amount_due: subject.due },
    );
    if (available < threshold)
      fail('REWARDS_NOT_UNLOCKED', `Rewards unlock at R${(threshold / 100).toFixed(2)}.`);
    if (requested > available)
      fail('REWARDS_EXCEEDS_BALANCE', 'That amount exceeds the available reward balance.');
    if (outstanding <= 0)
      fail(
        'REWARDS_ALREADY_SETTLED',
        'This visit has no remaining balance. No refund or credit will be created.',
      );
    if (requested > outstanding)
      fail('REWARDS_EXCEEDS_BOOKING_BALANCE', 'That amount exceeds the remaining visit balance.');
    const reviewToken = hash({
      data,
      revision: subject.revision,
      members: subject.members.map((m) => [m.id, new Date(m.updated_at).toISOString()]),
      available,
      walletRevision: String(entry.revision),
      outstanding,
      threshold,
    });
    return {
      walletId: wallet.id,
      reviewToken,
      amount: data.amount,
      outstanding: (outstanding / 100).toFixed(2),
      remaining: ((outstanding - requested) / 100).toFixed(2),
      rewardsRemaining: ((available - requested) / 100).toFixed(2),
    };
  }
  async function preview(input = {}) {
    const data = inputData(input),
      q = await db.connect();
    try {
      await q.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await q.query("SET LOCAL statement_timeout='2000ms'");
      const authority = await access(q, data, false),
        subject = await target(q, data, authority),
        result = await position(q, data, subject);
      await q.query('COMMIT');
      const { walletId, ...publicResult } = result;
      return publicResult;
    } catch (error) {
      await q.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      q.release();
    }
  }
  async function apply(input = {}) {
    const data = inputData(input),
      operation = String(input.operationId || '');
    if (
      !/^[A-Za-z0-9_-]{8,100}$/.test(operation) ||
      !/^[a-f0-9]{64}$/.test(String(input.reviewToken || ''))
    )
      fail('REWARDS_REVIEW_REQUIRED', 'Review the reward use before confirming.', 400);
    if (input.clientConfirmed !== true && input.clientConfirmed !== 'on')
      fail(
        'REWARDS_CONFIRMATION_REQUIRED',
        'Confirm that the client agreed to use these rewards.',
        400,
      );
    const key = `completed-redeem:${operation}`,
      fingerprint = hash({ data, reviewToken: input.reviewToken }),
      q = await db.connect();
    try {
      await q.query('BEGIN');
      const authority = await access(q, data, true);
      await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
      await lockBookingPaymentScope(q, data.appointmentId);
      await q.query("SELECT id FROM crm_v2_clients WHERE id=$1 AND status='active' FOR SHARE", [
        data.clientId,
      ]);
      const subject = await target(q, data, authority);
      const replay = (
        await q.query(
          `SELECT a.*,e.metadata FROM booking_loyalty_allocations a JOIN crm_audit_events e ON e.entity_type='booking_loyalty_allocation' AND e.entity_id=a.id AND e.action='loyalty.completed_visit_applied' WHERE a.operation_key=$1`,
          [key],
        )
      ).rows[0];
      if (replay) {
        if (replay.metadata?.fingerprint !== fingerprint)
          fail(
            'REWARDS_RETRY_MISMATCH',
            'This request belongs to a different reward decision. Review the history.',
          );
        await q.query('COMMIT');
        return { status: 'idempotent_replay', ...replay.metadata.result };
      }
      if (
        (await q.query('SELECT id FROM booking_loyalty_allocations WHERE operation_key=$1', [key]))
          .rowCount
      )
        fail('REWARDS_RETRY_MISMATCH', 'Review the existing reward operation before continuing.');
      const account = await lockCompletedTreatmentAccount(q, data),
        review = await position(q, data, subject, { lock: true, account });
      if (review.reviewToken !== input.reviewToken)
        fail(
          'REWARDS_REVIEW_CHANGED',
          'The visit or balances changed. Review the current reward use before confirming again.',
        );
      const debit = (
        await q.query(
          `INSERT INTO loyalty_wallet_entries(wallet_id,entry_type,signed_amount,operation_key,booking_payment_account_id,appointment_id,actor_admin_id,notes) VALUES($1,'redeem',$2,$3,$4,$5,$6,'Applied to completed visit balance') RETURNING id`,
          [review.walletId, `-${data.amount}`, key, account.id, data.appointmentId, data.adminId],
        )
      ).rows[0];
      const allocation = (
        await q.query(
          `INSERT INTO booking_loyalty_allocations(booking_payment_account_id,wallet_id,debit_entry_id,amount,applied_by_admin_id,client_confirmed,operation_key) VALUES($1,$2,$3,$4,$5,TRUE,$6) RETURNING id`,
          [account.id, review.walletId, debit.id, data.amount, data.adminId, key],
        )
      ).rows[0];
      const result = {
        allocationId: allocation.id,
        amount: data.amount,
        outstanding: review.remaining,
        rewardsRemaining: review.rewardsRemaining,
      };
      await q.query(
        `INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata) VALUES($1,'loyalty.completed_visit_applied','booking_loyalty_allocation',$2,$3::jsonb)`,
        [data.adminId, allocation.id, JSON.stringify({ fingerprint, result })],
      );
      await q.query('COMMIT');
      return { status: 'applied', ...result };
    } catch (error) {
      await q.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      q.release();
    }
  }
  return { preview, apply };
}
module.exports = { createCompletedVisitRewards };
