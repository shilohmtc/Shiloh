'use strict';

const { createWorkspaceDepositAttentionService } = require('./workspaceDepositAttention');
const { allowsAppointmentTarget } = require('./calendarAuthorization');

// Bound work, never truncate a balance and call the remainder paid.
const MAX_ROWS = 1000;
const MAX_SUBJECTS = 500;
const privateServiceSql = alias => `EXISTS (SELECT 1 FROM appointment_services aps JOIN service_visibility_policies vp ON vp.service_id=aps.service_id WHERE aps.appointment_id=${alias}.id AND vp.visibility_scope='tenant_private')`;

function clientIds(value) {
  if (!Array.isArray(value) || value.length > 24 || !value.length) throw Object.assign(Error('Choose a valid client page.'), { httpStatus: 400 });
  const ids = [...new Set(value.map(Number))];
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw Object.assign(Error('Choose a valid client page.'), { httpStatus: 400 });
  return ids;
}

function createClientDirectoryPaymentReview({ db, resolveOperator, readPosition, now = () => new Date(), elapsedNow = Date.now, depositReader = client => createWorkspaceDepositAttentionService({ db: client }) }) {
  return async function review({ adminId, ids: input, isCancelled = () => false }) {
    const ids = clientIds(input), unavailable = () => Object.fromEntries(ids.map(id => [id, { state: 'unavailable' }]));
    const client = await db.connect();
    const started = elapsedNow(), at = now();
    function withinBudget() { if (isCancelled()) throw Error('Payment review cancelled.'); if (elapsedNow() - started > 5000) throw Error('Payment review workload limit.'); }
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL statement_timeout='2000ms'");
      const operator = await resolveOperator(client, adminId, 'payment:view');
      if (operator.permissions?.['client:lookup'] !== true || operator.permissions?.['appointment:view'] !== true || String(operator.business_role || '').toLowerCase() === 'tenant_practitioner'
        || operator.calendarAuthority.calendarScope !== 'all_business' || operator.calendarAuthority.serviceScope !== 'all_services') {
        throw Object.assign(Error('Payment review restricted.'), { httpStatus: 403 });
      }
      const allowed = await client.query(`/* DirectoryPaymentReview:clients */ SELECT DISTINCT c.id FROM crm_v2_clients c JOIN crm_v2_client_relationships r ON r.client_id=c.id WHERE c.id=ANY($1::bigint[]) AND r.relationship_type='clinic' AND r.owner_staff_id IS NULL`, [ids]);
      if (allowed.rows.length !== ids.length) throw Object.assign(Error('Payment review restricted.'), { httpStatus: 403 });
      const appointments = await client.query(`/* DirectoryPaymentReview:appointments */ SELECT a.id,a.crm_v2_client_id,a.client_id,a.status,a.starts_at,gm.group_id,${privateServiceSql('a')} AS private_service,
        (EXISTS(SELECT 1 FROM payment_requests pr WHERE pr.payment_account_id=pa.id AND pr.state='paid' AND NOT EXISTS(SELECT 1 FROM payment_ledger_entries e WHERE e.payment_request_id=pr.id AND e.entry_type='payment'))
          OR EXISTS(SELECT 1 FROM crm_audit_events e WHERE e.entity_type='booking_payment_account' AND e.entity_id=pa.id AND e.action IN ('payment.received_after_booking_cancelled','payment.received_after_prior_settlement','payment.received_after_no_charge','payment.received_after_deposit_waived','payment.received_after_collection_changed'))) AS payment_review
        FROM appointments a LEFT JOIN appointment_group_members gm ON gm.appointment_id=a.id
        LEFT JOIN booking_payment_accounts pa ON (gm.group_id IS NULL AND pa.appointment_id=a.id) OR (gm.group_id IS NOT NULL AND pa.appointment_group_id=gm.group_id) WHERE a.crm_v2_client_id=ANY($1::bigint[]) ORDER BY a.starts_at,a.id LIMIT 1001`, [ids]);
      if (appointments.rows.length > MAX_ROWS) throw Error('Payment review workload limit.');
      const result = Object.fromEntries(ids.map(id => [id, { state: 'known', completedVisits: 0, outstandingVisits: 0, sharedBookings: 0, reviewNeeded: 0, upcomingDeposits: 0 }]));
      const subjects = new Map(), appointmentClients = new Map();
      for (const row of appointments.rows) {
        const id = Number(row.crm_v2_client_id), item = result[id];
        if (!item) throw Error('Unexpected client linkage.');
        if (appointmentClients.has(Number(row.id))) throw Error('Ambiguous booking membership.');
        appointmentClients.set(Number(row.id), id);
        if (row.client_id != null || row.private_service) { item.state = 'restricted'; continue; }
        const completed = ['completed', 'no_charge'].includes(row.status);
        if (completed) item.completedVisits++;
        if (row.payment_review) { item.reviewNeeded++; continue; }
        if (!completed) continue;
        if (!(new Date(row.starts_at) <= at)) { item.reviewNeeded++; continue; }
        const key = row.group_id ? `g:${row.group_id}` : `a:${row.id}`;
        const subject = subjects.get(key) || { row, clients: new Set() };
        subject.clients.add(id); subjects.set(key, subject);
      }
      if (subjects.size > MAX_SUBJECTS) throw Error('Payment review workload limit.');
      const groups = [...new Set(appointments.rows.map(row => row.group_id).filter(Boolean))];
      const restrictedGroups = new Set();
      if (groups.length) {
        const members = await client.query(`/* DirectoryPaymentReview:groups */ SELECT gm.group_id,a.id,a.client_id,a.crm_v2_client_id,${privateServiceSql('a')} AS private_service,
          ARRAY(SELECT ast.staff_id FROM appointment_staff ast WHERE ast.appointment_id=a.id ORDER BY ast.position) AS staff_ids,
          ARRAY(SELECT aps.service_id FROM appointment_services aps WHERE aps.appointment_id=a.id ORDER BY aps.position) AS service_ids,
          NOT EXISTS(SELECT 1 FROM crm_v2_client_relationships r WHERE r.client_id=a.crm_v2_client_id AND r.relationship_type='clinic' AND r.owner_staff_id IS NULL) AS outside_clinic
          FROM appointment_group_members gm JOIN appointments a ON a.id=gm.appointment_id WHERE gm.group_id=ANY($1::bigint[]) LIMIT 1001`, [groups]);
        if (members.rows.length > MAX_ROWS) throw Error('Payment review workload limit.');
        for (const group of groups) {
          const rows = members.rows.filter(m => Number(m.group_id) === Number(group));
          if (!rows.length || rows.some(m => m.private_service || m.outside_clinic || m.client_id != null || !m.crm_v2_client_id || !allowsAppointmentTarget(operator.calendarAuthority, {staffIds:m.staff_ids || [],serviceIds:m.service_ids || []}))) restrictedGroups.add(Number(group));
        }
        for (const row of appointments.rows) if (restrictedGroups.has(Number(row.group_id))) result[Number(row.crm_v2_client_id)].state = 'restricted';
      }
      for (const { row, clients } of subjects.values()) {
        withinBudget();
        if (restrictedGroups.has(Number(row.group_id))) continue;
        let summary;
        try { summary = await readPosition(client, operator, Number(row.id)); }
        catch (error) {
          if (error.code !== 'PAYMENT_PRICE_UNRESOLVED' && error.code !== 'PAYMENT_INVALID_AMOUNT') throw error;
          for (const id of clients) result[id].reviewNeeded++;
          continue;
        }
        if (summary.state !== 'known') { for (const id of clients) result[id].reviewNeeded++; continue; }
        const outstanding = Number(summary.outstanding);
        if (!Number.isFinite(outstanding) || outstanding < 0) throw Error('Payment position unavailable.');
        if (outstanding > 0) for (const id of clients) result[id][row.group_id ? 'sharedBookings' : 'outstandingVisits']++;
      }
      withinBudget();
      const hasUpcoming = appointments.rows.some(row => ['scheduled','confirmed'].includes(row.status) && new Date(row.starts_at) > at);
      const deposits = hasUpcoming ? await depositReader(client).list({ principal: operator, now: at }) : [];
      if (!Array.isArray(deposits)) throw Error('Deposit review unavailable.');
      for (const deposit of deposits) {
        const matched = new Set(deposit.members.map(m => appointmentClients.get(Number(m.appointmentId))).filter(Boolean));
        for (const id of matched) result[id].upcomingDeposits++;
      }
      withinBudget();
      await client.query('COMMIT');
      // Partial or restricted coverage must never leak a subtotal or a paid state.
      return Object.fromEntries(Object.entries(result).map(([id, item]) => [id, item.state === 'known' ? item : { state: item.state }]));
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.httpStatus === 403) return Object.fromEntries(ids.map(id => [id, { state: 'restricted' }]));
      return unavailable();
    } finally { client.release(); }
  };
}
module.exports = { clientIds, createClientDirectoryPaymentReview };
