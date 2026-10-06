'use strict';

const { pool } = require('../db/pool');
const { allowsAppointmentTarget } = require('./calendarAuthorization');
const { createBookingDepositPolicyService, depositSettlementPosition } = require('./bookingDepositPolicy');

// One row per canonical account, including ALL members before applying scope.
// Never call payment.get(), ensureRequirement() or getPosition(): those can write.
const DEPOSIT_ATTENTION_SQL = `/* WorkspaceDepositAttention:read */
 SELECT r.*,pa.appointment_group_id,pa.canonical_amount_due,pa.currency,
        g.status AS group_status,
        COALESCE((SELECT SUM(CASE WHEN e.entry_type='payment' THEN e.amount
                                 WHEN e.entry_type='refund' THEN -e.amount ELSE 0 END)
                    FROM payment_ledger_entries e WHERE e.payment_account_id=pa.id),0) AS net_paid,
        EXISTS(SELECT 1 FROM payment_requests pr WHERE pr.payment_account_id=pa.id
                AND pr.purpose='deposit' AND pr.deposit_requirement_id=r.id
                AND pr.state IN ('link_issued','pending') AND pr.provider_payment_url IS NOT NULL
                AND (pr.expires_at IS NULL OR pr.expires_at>$1)) AS has_link,
        EXISTS(SELECT 1 FROM payment_requests pr WHERE pr.payment_account_id=pa.id
                AND pr.state='paid' AND NOT EXISTS(SELECT 1 FROM payment_ledger_entries e
                  WHERE e.payment_request_id=pr.id AND e.entry_type='payment')) AS unrecorded_payment,
        (SELECT jsonb_agg(jsonb_build_object(
          'appointmentId',a.id,'startsAt',a.starts_at,'createdAt',a.created_at,'status',a.status,
          'source',a.source,'approval',aba.status,'currency',a.currency,
          'canonicalTotal',CASE WHEN pa.appointment_group_id IS NULL THEN a.total_price ELSE COALESCE(g.final_total,g.total_price) END,
          'clientName',COALESCE(c.display_name,v2.name,a.source_client_name,'Client'),
          'serviceName',COALESCE((SELECT string_agg(aps.service_name_snapshot,' + ' ORDER BY aps.position)
                                  FROM appointment_services aps WHERE aps.appointment_id=a.id),a.title,'Appointment'),
          'staffNames',ARRAY(SELECT ast.staff_name_snapshot FROM appointment_staff ast WHERE ast.appointment_id=a.id ORDER BY ast.position),
          'staffIds',ARRAY(SELECT ast.staff_id FROM appointment_staff ast WHERE ast.appointment_id=a.id ORDER BY ast.position),
          'serviceIds',ARRAY(SELECT aps.service_id FROM appointment_services aps WHERE aps.appointment_id=a.id ORDER BY aps.position),
          'requiredAmount',rm.required_amount)
          ORDER BY a.starts_at,a.id)
           FROM appointments a
           LEFT JOIN clients c ON c.id=a.client_id
           LEFT JOIN crm_v2_clients v2 ON v2.id=a.crm_v2_client_id AND v2.status='active'
           LEFT JOIN appointment_booking_approvals aba ON aba.appointment_id=a.id
           LEFT JOIN booking_deposit_requirement_members rm ON rm.appointment_id=a.id AND rm.requirement_id=r.id
          WHERE a.id=pa.appointment_id OR EXISTS(SELECT 1 FROM appointment_group_members gm
            WHERE gm.group_id=pa.appointment_group_id AND gm.appointment_id=a.id)) AS members
   FROM booking_deposit_requirements r
   JOIN booking_payment_accounts pa ON pa.id=r.payment_account_id
   LEFT JOIN appointment_groups g ON g.id=pa.appointment_group_id
  WHERE r.state<>'exempt' AND r.required_amount>0
    AND EXISTS(SELECT 1 FROM appointments a WHERE a.starts_at>$1 AND a.status IN ('scheduled','confirmed')
      AND (a.id=pa.appointment_id OR EXISTS(SELECT 1 FROM appointment_group_members gm
        WHERE gm.group_id=pa.appointment_group_id AND gm.appointment_id=a.id)))`;

function projectDeposit(row, authority, policy, now) {
  const members = row.members || [];
  if (!members.length || !members.every(member => allowsAppointmentTarget(authority, member))) return null;
  if (row.group_status === 'cancelled' || row.state === 'exempt') return null;
  // Prospective applicability uses the same booking dates as deposit policy.
  if (new Date(members[0].createdAt) < policy.effectiveFrom) return null;
  const upcoming = members.filter(member => ['scheduled', 'confirmed'].includes(member.status)
    && new Date(member.startsAt) > now);
  if (!upcoming.length) return null;
  const approvalReady = member => member.approval === 'approved'
    || (member.approval == null && member.source !== 'shiloh_client_whatsapp');
  if (!upcoming.every(approvalReady)) return null;
  const netPaid = Number(row.net_paid);
  const required = Number(row.required_amount);
  const inconsistent = !Number.isFinite(netPaid) || netPaid < 0 || row.unrecorded_payment
    || upcoming.length !== members.length
    || members.some(member => member.requiredAmount == null || member.currency !== row.currency
      || member.canonicalTotal == null || Number(member.canonicalTotal) !== Number(row.canonical_amount_due))
    || Math.abs(members.reduce((sum, member) => sum + Number(member.requiredAmount), 0) - required) > 0.001;
  const settlement = inconsistent ? null : depositSettlementPosition(row, netPaid);
  if (settlement?.satisfied) return null;
  return {
    accountId: Number(row.payment_account_id),
    appointmentId: Number(upcoming[0].appointmentId),
    members: upcoming.map(({ appointmentId, startsAt, clientName, serviceName, staffNames }) => ({ appointmentId, startsAt, clientName, serviceName, staffNames })),
    outstanding: settlement?.outstanding ?? null,
    state: inconsistent ? 'review' : netPaid > 0 ? 'partial' : 'awaiting',
    hasLink: row.has_link === true,
  };
}

function createWorkspaceDepositAttentionService({ db = pool, deposits = createBookingDepositPolicyService({ db }) } = {}) {
  async function list({ principal, now = new Date() } = {}) {
    if (principal?.permissions?.['payment:view'] !== true || !principal.calendarAuthority) return null;
    const policy = await deposits.loadPolicy(db);
    if (!policy.enabled) return [];
    const { rows } = await db.query(DEPOSIT_ATTENTION_SQL, [now.toISOString()]);
    return rows.map(row => projectDeposit(row, principal.calendarAuthority, policy, now)).filter(Boolean)
      .sort((a, b) => new Date(a.members[0].startsAt) - new Date(b.members[0].startsAt));
  }
  return { list };
}

module.exports = { DEPOSIT_ATTENTION_SQL, projectDeposit, createWorkspaceDepositAttentionService, ...createWorkspaceDepositAttentionService() };
