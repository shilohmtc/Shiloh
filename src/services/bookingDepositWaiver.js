'use strict';

const { createHash } = require('node:crypto');
const { hasCapability, hasFullAppointmentEditAuthority, allowsAppointmentTarget } = require('./calendarAuthorization');
const { priorPaymentSql } = require('../domain/priorPaymentSql');

async function allowsDepositWaiverActor(operator, queryable, { lock = true } = {}) {
    const authority = operator?.calendarAuthority;
    if (!hasFullAppointmentEditAuthority(authority) || !hasCapability(authority, 'payment:view') || !hasCapability(authority, 'payment:collect')) return false;
    if (Number(operator.id) === 2 && operator.role === 'owner' && operator.business_role === 'owner') return true;
    if (Number(operator.id) === 4 && operator.role === 'admin' && operator.business_role === 'business_admin') return true;
    if (operator.staff_id != null || operator.role !== 'receptionist' || operator.business_role !== 'booking_operator') return false;
    const rows = (await queryable.query(`/* depositWaiver:receptionIdentity */
      SELECT id FROM staff_admin_accounts WHERE active=TRUE AND staff_id IS NULL
        AND role='receptionist' AND business_role='booking_operator'
        AND calendar_scope='all_business' AND service_scope='all_services'
      ORDER BY id LIMIT 2${lock ? ' FOR SHARE' : ''}`)).rows;
    return rows.length === 1 && Number(rows[0].id) === Number(operator.id);
}

function depositWaiverMembersEligible(members, groupSource, now) {
  return members.length > 0 && members.every(member => ['scheduled', 'confirmed'].includes(member.status)
    && new Date(member.starts_at) > new Date(now)
    && (member.approval === 'approved' || (member.approval == null && member.source !== 'shiloh_client_whatsapp'
      && !['shiloh_my_shiloh_multi', 'shiloh_my_shiloh_couples'].includes(groupSource))));
}

// Requirement-only authority: never change price, settlement or attendance.
function createBookingDepositWaiverActions({ db, ErrorType, positiveId, requestKey, resolveOperator, loadSubject }) {
  const fail = (code, message, status = 409) => { throw new ErrorType(code, message, status); };
  async function allowed(operator, queryable = db) { return allowsDepositWaiverActor(operator, queryable); }

  async function record(input = {}) {
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (!reason || reason.length > 240 || (input.confirmed !== true && input.confirmed !== 'on')) fail('DEPOSIT_WAIVER_REASON_REQUIRED', 'Enter a short reason and confirm the whole booking deposit waiver.', 400);
    const data = { adminId: positiveId(input.adminId), appointmentId: positiveId(input.appointmentId), requirementId: positiveId(input.requirementId), operationId: requestKey(input.operationId), expectedRevision: String(input.expectedRevision || ''), reason };
    const revision = new Date(data.expectedRevision);
    if (!Number.isFinite(revision.getTime()) || revision.toISOString() !== data.expectedRevision) fail('DEPOSIT_WAIVER_REVISION_REQUIRED', 'Reload the booking before waiving its deposit.', 400);
    const fingerprint = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='15s'");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('shiloh-prior-payments'))");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`deposit-waiver-operation:${data.adminId}:${data.operationId}`]);
      await client.query('SELECT id FROM staff_admin_accounts WHERE id=$1 AND active=TRUE FOR SHARE', [data.adminId]);
      const operator = await resolveOperator(client, data.adminId, 'payment:collect');
      if (!await allowed(operator, client)) fail('DEPOSIT_WAIVER_FORBIDDEN', 'Only the authorised Reception, Christel or JP account may waive a booking deposit.', 403);
      if (operator.staff_id != null) {
        const active = await client.query("SELECT id FROM staff WHERE id=$1 AND status='active' FOR SHARE", [operator.staff_id]);
        if (!active.rowCount) fail('DEPOSIT_WAIVER_FORBIDDEN', 'Current active clinic authority is required.', 403);
      }
      const seed = await loadSubject(client, data.appointmentId);
      let groupSource = null;
      if (seed.groupId) {
        const group = (await client.query('SELECT id,source FROM appointment_groups WHERE id=$1 FOR UPDATE NOWAIT', [seed.groupId])).rows[0];
        if (!group) fail('DEPOSIT_WAIVER_SCOPE_CHANGED', 'Reload the booking and review its current shared deposit.');
        groupSource = group.source;
        await client.query('SELECT appointment_id FROM appointment_group_members WHERE group_id=$1 ORDER BY appointment_id FOR UPDATE NOWAIT', [seed.groupId]);
      }
      const members = (await client.query(`/* depositWaiver:members */
        SELECT a.id,a.status,a.starts_at,a.source,a.currency,a.updated_at,
          aba.status AS approval,
          ARRAY(SELECT ast.staff_id FROM appointment_staff ast WHERE ast.appointment_id=a.id AND ast.staff_id IS NOT NULL ORDER BY ast.position) AS staff_ids,
          ARRAY(SELECT aps.service_id FROM appointment_services aps WHERE aps.appointment_id=a.id AND aps.service_id IS NOT NULL ORDER BY aps.position) AS service_ids
        FROM appointments a LEFT JOIN appointment_booking_approvals aba ON aba.appointment_id=a.id
        WHERE a.id=$1 OR ($2::bigint IS NOT NULL AND EXISTS(SELECT 1 FROM appointment_group_members gm WHERE gm.group_id=$2 AND gm.appointment_id=a.id))
        ORDER BY a.id FOR UPDATE OF a NOWAIT`, [data.appointmentId, seed.groupId])).rows;
      const subject = await loadSubject(client, data.appointmentId);
      if (subject.groupId !== seed.groupId || !members.length) fail('DEPOSIT_WAIVER_SCOPE_CHANGED', 'Reload the booking and review all included appointments.');
      if (!members.every(member => allowsAppointmentTarget(operator.calendarAuthority, { staffIds: member.staff_ids, serviceIds: member.service_ids }))) fail('DEPOSIT_WAIVER_FORBIDDEN', 'Every appointment in this shared booking must be within your current access.', 403);
      const account = (await client.query(`SELECT * FROM booking_payment_accounts WHERE ${subject.groupId ? 'appointment_group_id' : 'appointment_id'}=$1 FOR UPDATE`, [subject.groupId || subject.appointmentId])).rows[0];
      if (!account) fail('DEPOSIT_WAIVER_REVIEW_REQUIRED', 'Open payment details and review the existing deposit requirement first.');
      const clock = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
      if (subject.final || !depositWaiverMembersEligible(members, groupSource, clock)) fail('DEPOSIT_WAIVER_BOOKING_UNAVAILABLE', 'Only approved future active bookings can have their deposit waived. Cancelled or expired bookings remain unchanged.');
      const replay = (await client.query(`SELECT id,created_at,metadata FROM crm_audit_events WHERE action='booking.deposit_waived' AND actor_admin_id=$1 AND metadata->>'operationId'=$2 ORDER BY id LIMIT 1`, [data.adminId, data.operationId])).rows[0];
      if (replay) {
        if (replay.metadata.fingerprint !== fingerprint) fail('DEPOSIT_WAIVER_RETRY_MISMATCH', 'This request identifier already belongs to another waiver decision.');
        const original = replay.metadata.result;
        const currentIds = members.map(member => Number(member.id)).sort((a, b) => a - b);
        const originalIds = Array.isArray(original?.appointmentIds) ? original.appointmentIds.map(Number).sort((a, b) => a - b) : [];
        const currentRequirement = (await client.query('SELECT * FROM booking_deposit_requirements WHERE payment_account_id=$1 FOR UPDATE', [account.id])).rows[0];
        if (!original || subject.pricingRevision !== data.expectedRevision || Number(original.paymentAccountId) !== Number(account.id)
          || (original.groupId == null ? null : Number(original.groupId)) !== (subject.groupId == null ? null : Number(subject.groupId))
          || originalIds.length !== currentIds.length || !originalIds.every((id, index) => id === currentIds[index])
          || Number(original.requirementId) !== data.requirementId
          || !currentRequirement || Number(currentRequirement.id) !== data.requirementId || currentRequirement.state !== 'waived'
          || Number(currentRequirement.required_amount) !== Number(original.originalRequiredAmount)) {
          fail('DEPOSIT_WAIVER_REPLAY_SCOPE_CHANGED', 'The booking or shared deposit changed. Reload and review its current deposit status.');
        }
        await client.query('COMMIT');
        return { status: 'idempotent_replay', ...original, auditId: Number(replay.id), waivedAt: replay.created_at };
      }
      if (subject.pricingRevision !== data.expectedRevision) fail('DEPOSIT_WAIVER_STALE', 'The booking changed. Reload and review it before deciding.');
      if (Number(account.canonical_amount_due) !== Number(subject.amountDue) || account.currency !== subject.currency) fail('DEPOSIT_WAIVER_REVIEW_REQUIRED', 'Review the booking price and payment history before waiving a deposit.');
      const requirement = (await client.query('SELECT * FROM booking_deposit_requirements WHERE payment_account_id=$1 FOR UPDATE', [account.id])).rows[0];
      if (!requirement || Number(requirement.id) !== data.requirementId || !['awaiting', 'satisfied'].includes(requirement.state)) fail('DEPOSIT_WAIVER_NOT_OUTSTANDING', 'This booking no longer has an outstanding deposit to waive.');
      const snapshots = (await client.query('SELECT * FROM booking_deposit_requirement_members WHERE requirement_id=$1 ORDER BY appointment_id', [requirement.id])).rows;
      if (snapshots.some(row => !Number.isFinite(Number(row.required_amount)) || Number(row.required_amount) < 0) || snapshots.length !== members.length || !members.every(member => snapshots.some(row => Number(row.appointment_id) === Number(member.id))) || Math.abs(snapshots.reduce((sum,row) => sum + Number(row.required_amount), 0) - Number(requirement.required_amount)) > 0.001) fail('DEPOSIT_WAIVER_REVIEW_REQUIRED', 'The shared deposit evidence needs review before a waiver.');
      const requests = (await client.query('SELECT * FROM payment_requests WHERE payment_account_id=$1 ORDER BY id FOR UPDATE', [account.id])).rows;
      if (requests.some(row => row.purpose === 'deposit' && Number(row.deposit_requirement_id) === Number(requirement.id) && (row.state === 'expired' || (['created','link_issued','pending'].includes(row.state) && row.expires_at && new Date(row.expires_at) <= new Date(clock))))) fail('DEPOSIT_WAIVER_BOOKING_UNAVAILABLE', 'This deposit request expired. Reload and review the booking before any decision.');
      const evidence = (await client.query(`SELECT COALESCE(SUM(amount) FILTER (WHERE entry_type='payment'),0)-COALESCE(SUM(amount) FILTER (WHERE entry_type='refund'),0)+${priorPaymentSql('$1')} AS net_paid FROM payment_ledger_entries WHERE payment_account_id=$1`, [account.id])).rows[0];
      const netPaid = Number(evidence?.net_paid || 0), required = Number(requirement.required_amount);
      const missingLedger = await client.query("SELECT 1 FROM payment_requests pr WHERE pr.payment_account_id=$1 AND pr.state='paid' AND NOT EXISTS(SELECT 1 FROM payment_ledger_entries e WHERE e.payment_request_id=pr.id AND e.entry_type='payment') LIMIT 1", [account.id]);
      if (!Number.isFinite(netPaid) || netPaid < 0 || !Number.isFinite(required) || required <= 0 || missingLedger.rowCount) fail('DEPOSIT_WAIVER_REVIEW_REQUIRED', 'The actual payment evidence needs review before a waiver.');
      if (netPaid + 0.0001 >= required) fail('DEPOSIT_WAIVER_NOT_OUTSTANDING', 'The required deposit is already covered by recorded money.');
      const closed = requests.filter(row => row.purpose === 'deposit' && Number(row.deposit_requirement_id) === Number(requirement.id) && ['created','link_issued','pending'].includes(row.state)).map(row => Number(row.id));
      if (closed.length) await client.query("UPDATE payment_requests SET state='cancelled',updated_at=NOW() WHERE id=ANY($1::bigint[]) AND state IN ('created','link_issued','pending')", [closed]);
      await client.query("UPDATE booking_deposit_requirements SET state='waived',updated_at=NOW() WHERE id=$1", [requirement.id]);
      const result = { paymentAccountId: Number(account.id), requirementId: Number(requirement.id), groupId: subject.groupId, appointmentIds: members.map(member => Number(member.id)), state: 'waived', originalRequiredAmount: String(requirement.required_amount), reason, actorAdminId: data.adminId };
      const audit = (await client.query(`INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata) VALUES($1,'booking.deposit_waived','booking_payment_account',$2,$3::jsonb) RETURNING id,created_at`, [data.adminId, account.id, JSON.stringify({ operationId: data.operationId, fingerprint, result, originalRequirement: requirement, originalMembers: snapshots, originalNetPaid: String(evidence.net_paid), canonicalAmountDue: String(account.canonical_amount_due), currency: account.currency, closedDepositRequestIds: closed, originalRequestStates: requests.filter(row => closed.includes(Number(row.id))).map(row => ({id:Number(row.id),state:row.state})), fullSharedAccount: true, treatmentPriceChanged: false, moneyRecorded: false, receiptIssued: false })])).rows[0];
      if (!audit) fail('DEPOSIT_WAIVER_AUDIT_REQUIRED', 'The waiver could not be recorded safely.');
      await client.query('COMMIT');
      return { status: 'waived', ...result, auditId: Number(audit.id), waivedAt: audit.created_at };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* preserve original failure */ }
      if (error.code === '55P03') fail('DEPOSIT_WAIVER_BUSY', 'The booking is being changed. Reload and review before trying again.');
      throw error;
    } finally { client.release(); }
  }
  return { allowed, record };
}

module.exports = { createBookingDepositWaiverActions, allowsDepositWaiverActor, depositWaiverMembersEligible };
