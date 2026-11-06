'use strict';
const { allowsAppointmentTarget } = require('./calendarAuthorization');
const PAGE_SIZE = 25;
const EXCEPTIONS = "'payment.received_after_booking_cancelled','payment.received_after_prior_settlement','payment.received_after_no_charge','payment.received_after_deposit_waived','payment.received_after_collection_changed'";
// Candidate pages include settled visits. Never advertise their count as a
// clinic-wide outstanding total. A shared account is considered once per page.
const CANDIDATES_SQL = `/* WorkspacePaymentReview:candidates */
 WITH subjects AS (
   SELECT CASE WHEN gm.group_id IS NULL THEN 'a:'||a.id ELSE 'g:'||gm.group_id END AS subject_key,
          MIN(a.id) AS appointment_id,gm.group_id,g.status AS group_status,MAX(pa.currency) AS account_currency,
          BOOL_OR(EXISTS(SELECT 1 FROM payment_requests pr WHERE pr.payment_account_id=pa.id AND pr.state='paid'
            AND NOT EXISTS(SELECT 1 FROM payment_ledger_entries e WHERE e.payment_request_id=pr.id AND e.entry_type='payment'))) AS unrecorded_payment,
          BOOL_OR(EXISTS(SELECT 1 FROM crm_audit_events e WHERE e.entity_type='booking_payment_account' AND e.entity_id=pa.id
            AND e.action IN (${EXCEPTIONS}))) AS recorded_exception,
          BOOL_OR(a.status IN ('completed','no_charge')) AS has_completed,
          BOOL_OR(EXISTS(SELECT 1 FROM appointment_services aps JOIN service_visibility_policies vp ON vp.service_id=aps.service_id
            WHERE aps.appointment_id=a.id AND vp.visibility_scope='tenant_private')
            OR (a.crm_v2_client_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crm_v2_client_relationships r
              WHERE r.client_id=a.crm_v2_client_id AND r.relationship_type='clinic' AND r.owner_staff_id IS NULL))
            OR NOT EXISTS(SELECT 1 FROM appointment_staff ast WHERE ast.appointment_id=a.id AND ast.staff_id IS NOT NULL)) AS restricted_subject
     FROM appointments a LEFT JOIN appointment_group_members gm ON gm.appointment_id=a.id
     LEFT JOIN appointment_groups g ON g.id=gm.group_id
     LEFT JOIN booking_payment_accounts pa ON (gm.group_id IS NULL AND pa.appointment_id=a.id)
       OR (gm.group_id IS NOT NULL AND pa.appointment_group_id=gm.group_id)
    GROUP BY subject_key,gm.group_id,g.status
 ) SELECT * FROM subjects WHERE NOT restricted_subject AND (has_completed OR unrecorded_payment OR recorded_exception)
   AND appointment_id>$1 ORDER BY appointment_id LIMIT 26`;
const MEMBERS_SQL = `/* WorkspacePaymentReview:members */
 SELECT a.id,a.client_id,a.crm_v2_client_id,a.status,a.starts_at,a.currency,
        COALESCE(v.name,c.display_name,a.source_client_name,'Client') AS client_name,
        COALESCE((SELECT string_agg(s.service_name_snapshot,' + ' ORDER BY s.position) FROM appointment_services s WHERE s.appointment_id=a.id),a.title,'Appointment') AS service_name,
        ARRAY(SELECT ast.staff_name_snapshot FROM appointment_staff ast WHERE ast.appointment_id=a.id ORDER BY ast.position) AS staff_names,
        ARRAY(SELECT ast.staff_id FROM appointment_staff ast WHERE ast.appointment_id=a.id ORDER BY ast.position) AS staff_ids,
        ARRAY(SELECT aps.service_id FROM appointment_services aps WHERE aps.appointment_id=a.id ORDER BY aps.position) AS service_ids,
        EXISTS(SELECT 1 FROM appointment_services aps JOIN service_visibility_policies vp ON vp.service_id=aps.service_id WHERE aps.appointment_id=a.id AND vp.visibility_scope='tenant_private') AS private_service,
        EXISTS(SELECT 1 FROM crm_v2_client_relationships r WHERE r.client_id=a.crm_v2_client_id AND r.relationship_type='clinic' AND r.owner_staff_id IS NULL) AS clinic_client,
        (SELECT COUNT(*) FROM appointment_group_members gm WHERE gm.appointment_id=a.id) AS group_memberships
   FROM appointments a LEFT JOIN crm_v2_clients v ON v.id=a.crm_v2_client_id LEFT JOIN clients c ON c.id=a.client_id
  WHERE ($2::bigint IS NULL AND a.id=$1) OR ($2::bigint IS NOT NULL AND EXISTS(SELECT 1 FROM appointment_group_members gm WHERE gm.group_id=$2 AND gm.appointment_id=a.id))
  ORDER BY a.starts_at,a.id LIMIT 101`;
function cursor(value) {
  if (value === undefined || value === '') return 0;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value) || value !== value.trim() || !Number.isSafeInteger(Number(value))) throw Object.assign(Error('Choose a valid payment review page.'), { httpStatus: 400 });
  return Number(value);
}
function createWorkspacePaymentReview({ db, resolveOperator, readPosition, now = () => new Date(), elapsedNow = Date.now }) {
  return async function review({ adminId, after, isCancelled = () => false } = {}) {
    const start = cursor(after), started = elapsedNow(), at = now();
    let client;
    const unavailable = { state: 'unavailable', items: [], next: null, ...(start ? { after: String(start) } : {}) };
    function budget() { if (isCancelled() || elapsedNow() - started > 5000) throw Error('Payment review unavailable.'); }
    try {
      client = await db.connect();
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL statement_timeout='2000ms'");
      const operator = await resolveOperator(client, adminId, 'payment:view');
      if (operator.permissions?.['client:lookup'] !== true || operator.permissions?.['appointment:view'] !== true || operator.business_role === 'tenant_practitioner'
        || operator.calendarAuthority?.calendarScope !== 'all_business' || operator.calendarAuthority?.serviceScope !== 'all_services') throw Object.assign(Error('Payment review restricted.'), { httpStatus: 403 });
      const rows = (await client.query(CANDIDATES_SQL, [start])).rows;
      if (rows.length > PAGE_SIZE + 1) throw Error('Unexpected payment review page.');
      const items = [], seen = new Set(); let restricted = false;
      for (const row of rows.slice(0, PAGE_SIZE)) {
        budget();
        const id = Number(row.appointment_id), groupId = row.group_id == null ? null : Number(row.group_id);
        if (!Number.isSafeInteger(id) || id <= start || (groupId !== null && (!Number.isSafeInteger(groupId) || groupId <= 0)) || seen.has(row.subject_key)) throw Error('Ambiguous payment subject.');
        seen.add(row.subject_key);
        const members = (await client.query(MEMBERS_SQL, [id, groupId])).rows;
        if (!members.length || members.length > 100 || members.some(m => !Number.isSafeInteger(Number(m.id)) || Number(m.id) <= 0 || Number(m.group_memberships) > 1)) throw Error('Ambiguous payment membership.');
        if (members.some(m => m.private_service || !allowsAppointmentTarget(operator.calendarAuthority, { staffIds: m.staff_ids || [], serviceIds: m.service_ids || [] }) || (m.crm_v2_client_id && !m.clinic_client))) { restricted = true; continue; }
        const item = { appointmentId: id, groupId, members: members.map(m => ({ appointmentId: Number(m.id), startsAt: m.starts_at, clientName: m.client_name, serviceName: m.service_name, staffNames: m.staff_names || [] })), state: 'review', outstanding: null };
        if (row.unrecorded_payment) { items.push({ ...item, reason: 'Payment receipt needs verification' }); continue; }
        if (row.recorded_exception) { items.push({ ...item, reason: 'Recorded payment exception' }); continue; }
        if (members.some(m => m.client_id != null || !m.crm_v2_client_id)) { items.push({ ...item, reason: 'Historical payment details need review' }); continue; }
        if (row.group_status === 'cancelled' || members.some(m => !['completed', 'no_charge'].includes(m.status) || !m.starts_at || !Number.isFinite(new Date(m.starts_at).getTime()) || new Date(m.starts_at) > at)) { items.push({ ...item, reason: 'Booking outcomes need review' }); continue; }
        if (members.some(m => !/^[A-Z]{3}$/.test(m.currency || '') || m.currency !== members[0].currency || (row.account_currency && m.currency !== row.account_currency))) { items.push({ ...item, reason: 'Payment currency needs review' }); continue; }
        let summary;
        try { summary = await readPosition(client, operator, id); }
        catch (error) { if (!['PAYMENT_PRICE_UNRESOLVED', 'PAYMENT_INVALID_AMOUNT'].includes(error.code)) throw error; summary = { state: 'needs_review' }; }
        if (summary.state !== 'known') { items.push({ ...item, reason: 'Payment price needs review' }); continue; }
        const balance = Number(summary.outstanding);
        if (!Number.isFinite(balance) || balance < 0) throw Error('Invalid payment position.');
        if (balance > 0) items.push({ ...item, state: 'outstanding', outstanding: summary.outstanding, currency: members[0].currency, reason: groupId ? 'Whole booking balance' : 'Completed visit balance' });
      }
      budget();
      await client.query('COMMIT');
      return { state: 'known', items, restricted, next: rows.length > PAGE_SIZE ? String(rows[PAGE_SIZE - 1].appointment_id) : null, after: start ? String(start) : null };
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return error.httpStatus === 403 ? { state: 'restricted', items: [], next: null } : unavailable;
    } finally { if (client) client.release(); }
  };
}
module.exports = { PAGE_SIZE, CANDIDATES_SQL, MEMBERS_SQL, cursor, createWorkspacePaymentReview };
