const { pool } = require('../db/pool');
const { createWorkspaceStaffEarningsService, clinicDate } = require('./workspaceStaffEarnings');
const { resolvePeriod } = require('./workspaceReports');

const { METHODS, summarizeFinancials } = require('../domain/workspaceFinancialReports');

// Aggregate the immutable ledger once, before joining bookings or practitioners.
const RECEIPTS_SQL = `/* FinancialReports:receipts */
  SELECT e.id,e.created_at,e.entry_type,e.amount,e.method,'booking' AS source,
         COALESCE(p.appointment_id,(SELECT MIN(gm.appointment_id) FROM appointment_group_members gm
           WHERE gm.group_id=p.appointment_group_id)) AS appointment_id,
         p.appointment_group_id AS group_id,NULL::bigint AS voucher_order_id
    FROM payment_ledger_entries e JOIN booking_payment_accounts p ON p.id=e.payment_account_id
   WHERE (e.created_at >= $1::timestamptz AND e.created_at < $2::timestamptz)
      OR (e.created_at >= $3::timestamptz AND e.created_at < $4::timestamptz)
   UNION ALL
  SELECT e.id,e.created_at,'payment',e.amount,e.method,'voucher',NULL,NULL,e.order_id
    FROM gift_voucher_payment_entries e
   WHERE (e.created_at >= $1::timestamptz AND e.created_at < $2::timestamptz)
      OR (e.created_at >= $3::timestamptz AND e.created_at < $4::timestamptz)
   UNION ALL
  SELECT e.id,e.created_at,'payment',e.amount,'ozow','voucher',NULL,NULL,v.order_id
    FROM gift_voucher_ledger_entries e JOIN gift_vouchers v ON v.id=e.voucher_id
   WHERE e.entry_type='issue' AND e.operation_key LIKE 'issue:ozow:%'
     AND ((e.created_at >= $1::timestamptz AND e.created_at < $2::timestamptz)
       OR (e.created_at >= $3::timestamptz AND e.created_at < $4::timestamptz))
   ORDER BY created_at,id`;

const VOUCHERS_SQL = `/* FinancialReports:vouchers */
  SELECT (SELECT COALESCE(SUM(balance),0) FROM gift_vouchers
           WHERE state='active' AND (valid_until IS NULL OR valid_until >= $3::date)) AS available_balance,
         (SELECT COALESCE(SUM(balance),0) FROM gift_vouchers
           WHERE state='active' AND valid_until < $3::date) AS expired_balance,
         COUNT(*) FILTER (WHERE e.entry_type='issue')::int AS issued_count,
         COALESCE(SUM(e.amount) FILTER (WHERE e.entry_type='redemption'),0) AS redeemed_value
    FROM gift_voucher_ledger_entries e
   WHERE e.created_at >= $1::timestamptz AND e.created_at < $2::timestamptz`;

const TREATMENTS_SQL = `/* FinancialReports:treatments */
  SELECT a.id,a.starts_at,
         CASE WHEN gm.group_id IS NULL THEN a.total_price ELSE gm.allocated_price END AS value,
         gm.group_id,
         COALESCE((SELECT string_agg(aps.service_name_snapshot,' + ' ORDER BY aps.position)
           FROM appointment_services aps WHERE aps.appointment_id=a.id),a.title,'Treatment') AS treatment
    FROM appointments a LEFT JOIN appointment_group_members gm ON gm.appointment_id=a.id
   WHERE a.status='completed' AND ((a.starts_at >= $1::timestamptz AND a.starts_at < $2::timestamptz)
      OR (a.starts_at >= $3::timestamptz AND a.starts_at < $4::timestamptz))
   ORDER BY a.starts_at,a.id`;

// One row per ordinary booking or linked account with a completed visit in range.
// A group's unpaid balance belongs to the entire booking, never to every member.
const BALANCES_SQL = `/* FinancialReports:balances */
  WITH subjects AS (
    SELECT 'a:'||a.id AS subject_key,a.id AS appointment_id,NULL::bigint AS group_id,
           a.total_price AS current_due,a.starts_at,FALSE AS mixed_status
      FROM appointments a WHERE a.status='completed'
       AND a.starts_at >= $1::timestamptz AND a.starts_at < $2::timestamptz
       AND NOT EXISTS (SELECT 1 FROM appointment_group_members gm WHERE gm.appointment_id=a.id)
    UNION ALL
    SELECT 'g:'||g.id,MIN(a.id) FILTER (WHERE a.status='completed'
             AND a.starts_at >= $1::timestamptz AND a.starts_at < $2::timestamptz),g.id,
           COALESCE(g.final_total,g.total_price),MIN(a.starts_at),BOOL_OR(a.status<>'completed')
      FROM appointment_groups g JOIN appointment_group_members gm ON gm.group_id=g.id
      JOIN appointments a ON a.id=gm.appointment_id
     GROUP BY g.id HAVING BOOL_OR(a.status='completed'
       AND a.starts_at >= $1::timestamptz AND a.starts_at < $2::timestamptz)
  ) SELECT s.*,p.id AS account_id,
       CASE WHEN EXISTS (SELECT 1 FROM payment_ledger_entries e WHERE e.payment_account_id=p.id)
         THEN p.canonical_amount_due ELSE s.current_due END AS amount_due,
       COALESCE((SELECT SUM(CASE WHEN e.entry_type='payment' THEN e.amount ELSE -e.amount END)
          FROM payment_ledger_entries e WHERE e.payment_account_id=p.id),0) AS net_paid,
       COALESCE((SELECT SUM(l.amount) FROM booking_loyalty_allocations l
         WHERE l.booking_payment_account_id=p.id AND l.state='applied'),0)
       + COALESCE((SELECT SUM(v.amount) FROM booking_welcome_voucher_allocations v
         WHERE v.booking_payment_account_id=p.id AND v.state='applied'),0) AS credits
    FROM subjects s LEFT JOIN booking_payment_accounts p
      ON (s.group_id IS NULL AND p.appointment_id=s.appointment_id)
      OR (s.group_id IS NOT NULL AND p.appointment_group_id=s.group_id)
   ORDER BY s.starts_at,s.subject_key`;

function createWorkspaceFinancialReportsService({ db = pool,
  earningsService = createWorkspaceStaffEarningsService({ db }) } = {}) {
  async function requireAccess(adminId) {
    await earningsService.requireOwner(adminId);
    const result = await db.query(`/* FinancialReports:payment_access */
      SELECT (permissions->'payment:view'='true'::jsonb AND permissions->'voucher:view'='true'::jsonb
        AND service_scope='all_services') AS allowed
        FROM staff_admin_accounts WHERE id=$1 AND active=TRUE`, [adminId]);
    if (result.rows.length !== 1 || result.rows[0].allowed !== true) {
      throw Object.assign(new Error('Financial reports access denied.'), { httpStatus: 403 });
    }
  }
  async function build({ adminId, period, now = new Date() }) {
    await requireAccess(adminId);
    // Revalidate the requested period before any financial reads.
    const validated = resolvePeriod({ from: period.startKey, to: period.endInclusiveKey, now });
    const effective = resolvePeriod({ preset: period.preset, now,
      ...(period.preset === 'custom' ? { from: validated.startKey, to: validated.endInclusiveKey } : {}) });
    if (effective.startKey !== validated.startKey || effective.endInclusiveKey !== validated.endInclusiveKey) {
      throw Object.assign(new Error('Report dates changed. Refresh the report.'), { httpStatus: 409 });
    }
    const params = [effective.from, effective.to, effective.previousFrom, effective.previousTo];
    const [visits, ledger, balances, vouchers] = await Promise.all([
      db.query(TREATMENTS_SQL, params), db.query(RECEIPTS_SQL, params), db.query(BALANCES_SQL, params.slice(0, 2)),
      db.query(VOUCHERS_SQL, [effective.from, effective.to, clinicDate(now)]),
    ]);
    return { ...summarizeFinancials({ period: effective, treatments: visits.rows, receipts: ledger.rows, balances: balances.rows }),
      vouchers: vouchers.rows[0] || {}, period: effective, scope: 'all_business' };
  }
  return { requireAccess, build };
}

module.exports = { METHODS, RECEIPTS_SQL, TREATMENTS_SQL, BALANCES_SQL, VOUCHERS_SQL, summarizeFinancials,
  createWorkspaceFinancialReportsService, ...createWorkspaceFinancialReportsService() };
