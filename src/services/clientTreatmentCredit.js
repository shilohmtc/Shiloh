'use strict';

const { createHash } = require('node:crypto');
const { pool } = require('../db/pool');
const { resolveCalendarAuthority, hasCapability } = require('./calendarAuthorization');
const { moneyCents, text, operation } = require('../domain/workspaceFinancialRecords');

const CAPABILITIES = Object.freeze({ VIEW: 'treatment_credit:view', ISSUE: 'treatment_credit:issue', APPLY: 'treatment_credit:apply', CORRECT: 'treatment_credit:correct' });
class TreatmentCreditError extends Error {
  constructor(code, message, httpStatus = 400) { super(message); this.code = code; this.httpStatus = httpStatus; }
}
function fail(code, message, status = 409) { throw new TreatmentCreditError(code, message, status); }
function id(value) { const result = Number(value); if (!Number.isSafeInteger(result) || result <= 0) fail('CREDIT_INVALID_ID', 'Choose a valid client or appointment.', 400); return result; }
function normalized(input, kind) {
  try {
    const amount = moneyCents(input.amount, { positive: true });
    const result = { kind, adminId: id(input.adminId), clientId: id(input.clientId), amount: (amount / 100).toFixed(2), operationId: operation(input.operationId) };
    if (kind === 'issue') {
      result.creditType = String(input.creditType || '');
      if (!['goodwill', 'service_exchange'].includes(result.creditType)) fail('CREDIT_INVALID_TYPE', 'Choose Goodwill or Service exchange.', 400);
      result.reason = text(input.reason, 240, true);
      result.reference = text(input.reference ?? '', 120, result.creditType === 'service_exchange');
    } else if (kind === 'apply') { result.appointmentId = id(input.appointmentId); result.reason = 'Applied to completed treatment'; result.reference = ''; }
    else if (['reduce','undo'].includes(kind)) {
      result.sourceEntryId = id(input.sourceEntryId); result.reason = text(input.reason, 240, true); result.reference = '';
      if (input.reviewed !== true && input.reviewed !== 'on') fail('CREDIT_REVIEW_REQUIRED', 'Review the original credit and treatment/payment history before confirming a correction.', 400);
      result.reviewed = true;
    } else fail('CREDIT_INVALID_ACTION', 'Choose a valid credit action.', 400);
    result.fingerprint = createHash('sha256').update(JSON.stringify(result)).digest('hex');
    return result;
  } catch (error) { if (error instanceof TreatmentCreditError) throw error; fail('CREDIT_INVALID_INPUT', error.message, 400); }
}
const APPLIED_SQL = `SELECT COALESCE(-SUM(signed_amount),0) AS amount FROM treatment_credit_entries WHERE booking_payment_account_id=$1 AND entry_type IN ('apply','undo')`;

const SOURCE_REMAINING_SQL = `e.signed_amount-COALESCE((SELECT SUM(CASE WHEN debit.entry_type='undo' THEN -alloc.amount ELSE alloc.amount END)
  FROM treatment_credit_allocations alloc JOIN treatment_credit_entries debit ON debit.id=alloc.debit_entry_id WHERE alloc.issue_entry_id=e.id),0)`;

function createClientTreatmentCreditService({ db = pool, authorityResolver = resolveCalendarAuthority } = {}) {
  async function requireAccess(queryable, adminId, capability, lock = false) {
    if (lock) await queryable.query('SELECT id FROM staff_admin_accounts WHERE id=$1 AND active=TRUE FOR SHARE', [id(adminId)]);
    const principal = await authorityResolver(queryable, id(adminId), { additionalCapabilities: Object.values(CAPABILITIES) });
    const authority = principal?.calendarAuthority;
    if (!authority || authority.calendarScope !== 'all_business' || authority.serviceScope !== 'all_services'
        || !hasCapability(authority, 'client:lookup') || !hasCapability(authority, capability)) {
      fail('CREDIT_FORBIDDEN', 'Your current access does not permit this treatment credit action.', 403);
    }
    return authority;
  }
  async function clientProfile(queryable, clientId, { active = true } = {}) {
    const client = (await queryable.query(`SELECT id,name,status FROM crm_v2_clients WHERE id=$1 ${active ? "AND status='active'" : ''}`, [clientId])).rows[0];
    if (!client) fail('CREDIT_CLIENT_UNAVAILABLE', 'This active client profile is unavailable.', 404);
    return client;
  }
  async function wallet(queryable, clientId) {
    await clientProfile(queryable, clientId);
    return (await queryable.query(`INSERT INTO treatment_credit_wallets(crm_v2_client_id) VALUES($1)
      ON CONFLICT(crm_v2_client_id) DO UPDATE SET crm_v2_client_id=EXCLUDED.crm_v2_client_id RETURNING id`, [clientId])).rows[0];
  }
  async function transaction(input, kind, perform) {
    const data = normalized(input, kind), connection = await db.connect();
    try {
      await connection.query('BEGIN');
      await requireAccess(connection, data.adminId, kind === 'issue' ? CAPABILITIES.ISSUE : kind === 'apply' ? CAPABILITIES.APPLY : CAPABILITIES.CORRECT, true);
      await connection.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`treatment-credit:${data.operationId}`]);
      const replay = (await connection.query('SELECT * FROM treatment_credit_entries WHERE operation_id=$1', [data.operationId])).rows[0];
      if (replay) {
        if (replay.request_fingerprint !== data.fingerprint) fail('CREDIT_RETRY_MISMATCH', 'This request was already used for a different credit action. Refresh and review the history.');
        await connection.query('COMMIT'); return { status: 'idempotent_replay', entry: replay };
      }
      const result = await perform(connection, data);
      await connection.query('COMMIT'); return result;
    } catch (error) { try { await connection.query('ROLLBACK'); } catch (_) {} throw error; } finally { connection.release(); }
  }
  async function save(queryable, data, walletId, accountId = null) {
    const entry = (await queryable.query(`INSERT INTO treatment_credit_entries
      (wallet_id,entry_type,credit_type,signed_amount,reason,reference,operation_id,request_fingerprint,actor_admin_id,booking_payment_account_id,appointment_id,source_entry_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [walletId, data.kind, data.creditType || null, ['issue','undo'].includes(data.kind) ? data.amount : `-${data.amount}`, data.reason, data.reference, data.operationId, data.fingerprint, data.adminId, accountId, data.appointmentId || null, data.sourceEntryId || null])).rows[0];
    await queryable.query(`INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
      VALUES($1,$2,'treatment_credit_entry',$3,$4::jsonb)`, [data.adminId, `treatment_credit.${data.kind}`, entry.id,
      JSON.stringify({ clientId: data.clientId, amount: data.amount, creditType: data.creditType || null, appointmentId: data.appointmentId || null, operationId: data.operationId, sourceEntryId: data.sourceEntryId || null, reviewed: data.reviewed || false })]);
    return entry;
  }
  async function issue(input) {
    return transaction(input, 'issue', async (queryable, data) => {
      const lockedWallet = await wallet(queryable, data.clientId);
      const entry = await save(queryable, data, lockedWallet.id);
      return { status: 'issued', entry };
    });
  }
  async function apply(input) {
    return transaction(input, 'apply', async (queryable, data) => {
      // Same order as canonical payments: appointment, group, account, wallet.
      const appointment = (await queryable.query('SELECT * FROM appointments WHERE id=$1 FOR UPDATE', [data.appointmentId])).rows[0];
      if (!appointment || Number(appointment.crm_v2_client_id) !== data.clientId || appointment.client_id != null) fail('CREDIT_BOOKING_FORBIDDEN', 'Choose a completed treatment for this client.', 403);
      if (appointment.status !== 'completed') fail('CREDIT_TREATMENT_INCOMPLETE', 'Credit can only be applied after treatment is completed. Booking deposits need payment.');
      const member = (await queryable.query('SELECT group_id FROM appointment_group_members WHERE appointment_id=$1', [data.appointmentId])).rows[0];
      let group = null;
      if (member) {
        group = (await queryable.query('SELECT * FROM appointment_groups WHERE id=$1 FOR UPDATE', [member.group_id])).rows[0];
        const unsafe = await queryable.query(`SELECT 1 FROM appointment_group_members gm JOIN appointments a ON a.id=gm.appointment_id
          WHERE gm.group_id=$1 AND (a.status<>'completed' OR a.crm_v2_client_id IS DISTINCT FROM $2::bigint OR a.client_id IS NOT NULL) LIMIT 1`, [member.group_id, data.clientId]);
        if (!group || group.status !== 'completed' || unsafe.rowCount) fail('CREDIT_GROUP_REVIEW', 'Linked treatments must all be completed for this same client before credit can be applied.');
      }
      const due = group ? group.final_total ?? group.total_price : appointment.total_price;
      if (due == null || String(appointment.currency || 'ZAR') !== 'ZAR') fail('CREDIT_PRICE_UNAVAILABLE', 'Confirm the Rand treatment price before applying credit.');
      const column = group ? 'appointment_group_id' : 'appointment_id', target = group?.id || appointment.id;
      let account = (await queryable.query(`SELECT * FROM booking_payment_accounts WHERE ${column}=$1 FOR UPDATE`, [target])).rows[0];
      if (!account) account = (await queryable.query(`INSERT INTO booking_payment_accounts(${column},canonical_amount_due,currency,pricing_revision)
        VALUES($1,$2,'ZAR',$3) RETURNING *`, [target, due, group?.updated_at || appointment.updated_at])).rows[0];
      if (Number(account.canonical_amount_due) !== Number(due) || account.currency !== 'ZAR') fail('CREDIT_PRICE_CHANGED', 'Review the payment account and changed treatment price before applying credit.');
      const pendingDeposit = await queryable.query("SELECT id FROM booking_deposit_requirements WHERE payment_account_id=$1 AND state='awaiting' FOR UPDATE", [account.id]);
      if (pendingDeposit.rowCount) fail('CREDIT_DEPOSIT_REQUIRED', 'The booking deposit remains due. Treatment credit cannot pay a deposit.');
      const openRequest = await queryable.query("SELECT id FROM payment_requests WHERE payment_account_id=$1 AND state IN ('created','link_issued','pending') LIMIT 1", [account.id]);
      if (openRequest.rowCount) fail('CREDIT_OPEN_PAYMENT', 'Review the active payment link before applying credit, so the client is not charged twice.');
      const lockedWallet = await wallet(queryable, data.clientId);
      const available = (await queryable.query(`SELECT e.id,${SOURCE_REMAINING_SQL} AS remaining
        FROM treatment_credit_entries e WHERE e.wallet_id=$1 AND e.entry_type='issue' ORDER BY e.id`, [lockedWallet.id])).rows;
      const balance = available.reduce((sum, row) => sum + moneyCents(row.remaining), 0), requested = moneyCents(data.amount);
      if (requested > balance) fail('CREDIT_EXCEEDS_BALANCE', 'This amount is greater than the remaining treatment credit.');
      const totals = (await queryable.query(`SELECT
        COALESCE((SELECT SUM(CASE WHEN entry_type='payment' THEN amount ELSE -amount END) FROM payment_ledger_entries WHERE payment_account_id=$1),0) AS net_paid,
        COALESCE((SELECT SUM(amount) FROM booking_loyalty_allocations WHERE booking_payment_account_id=$1 AND state='applied'),0)
        + COALESCE((SELECT SUM(amount) FROM booking_welcome_voucher_allocations WHERE booking_payment_account_id=$1 AND state='applied'),0)
        + COALESCE((SELECT -SUM(signed_amount) FROM treatment_credit_entries WHERE booking_payment_account_id=$1 AND entry_type IN ('apply','undo')),0) AS credits`, [account.id])).rows[0];
      const outstanding = Math.max(0, moneyCents(account.canonical_amount_due) - Math.round(Number(totals.net_paid) * 100) - moneyCents(totals.credits));
      if (requested > outstanding) fail('CREDIT_EXCEEDS_TREATMENT', 'This amount is greater than the remaining treatment balance.');
      const entry = await save(queryable, data, lockedWallet.id, account.id);
      let remaining = requested;
      for (const source of available) {
        const amount = Math.min(remaining, moneyCents(source.remaining));
        if (amount > 0) await queryable.query('INSERT INTO treatment_credit_allocations(debit_entry_id,issue_entry_id,amount) VALUES($1,$2,$3)', [entry.id, source.id, (amount / 100).toFixed(2)]);
        remaining -= amount; if (!remaining) break;
      }
      return { status: 'applied', entry, balance: (balance - requested) / 100, outstanding: (outstanding - requested) / 100 };
    });
  }
  async function correct(input, kind) {
    return transaction(input, kind, async (queryable, data) => {
      await clientProfile(queryable, data.clientId, { active: false });
      const original = (await queryable.query(`SELECT e.*,w.crm_v2_client_id FROM treatment_credit_entries e
        JOIN treatment_credit_wallets w ON w.id=e.wallet_id WHERE e.id=$1`, [data.sourceEntryId])).rows[0];
      if (!original || Number(original.crm_v2_client_id) !== data.clientId || original.entry_type !== (kind === 'reduce' ? 'issue' : 'apply')) {
        fail('CREDIT_CORRECTION_TARGET', 'Choose an original credit entry belonging to this client.');
      }
      if (kind === 'undo') {
        // Restore against the recorded account, even after cancellation/refund; never create a cash entry.
        await queryable.query('SELECT id FROM appointments WHERE id=$1 FOR UPDATE', [original.appointment_id]);
        const beforeLock = (await queryable.query('SELECT * FROM booking_payment_accounts WHERE id=$1', [original.booking_payment_account_id])).rows[0];
        if (!beforeLock) fail('CREDIT_ACCOUNT_UNAVAILABLE', 'Review the original treatment payment account before correction.');
        if (beforeLock.appointment_group_id) await queryable.query('SELECT id FROM appointment_groups WHERE id=$1 FOR UPDATE', [beforeLock.appointment_group_id]);
        await queryable.query('SELECT id FROM booking_payment_accounts WHERE id=$1 FOR UPDATE', [original.booking_payment_account_id]);
        const openRequest = await queryable.query("SELECT id FROM payment_requests WHERE payment_account_id=$1 AND state IN ('created','link_issued','pending') LIMIT 1", [original.booking_payment_account_id]);
        if (openRequest.rowCount) fail('CREDIT_OPEN_PAYMENT', 'Review the active payment link before correcting treatment credit.');
        data.appointmentId = Number(original.appointment_id);
      }
      await queryable.query('SELECT id FROM treatment_credit_wallets WHERE id=$1 FOR UPDATE', [original.wallet_id]);
      const sources = kind === 'reduce'
        ? (await queryable.query(`SELECT e.id,${SOURCE_REMAINING_SQL} AS remaining FROM treatment_credit_entries e WHERE e.id=$1`, [original.id])).rows
        : (await queryable.query(`SELECT original.issue_entry_id AS id,original.amount-COALESCE((SELECT SUM(returned.amount)
          FROM treatment_credit_allocations returned JOIN treatment_credit_entries correction ON correction.id=returned.debit_entry_id
          WHERE correction.entry_type='undo' AND correction.source_entry_id=$1 AND returned.issue_entry_id=original.issue_entry_id),0) AS remaining
          FROM treatment_credit_allocations original WHERE original.debit_entry_id=$1 ORDER BY original.issue_entry_id`, [original.id])).rows;
      const requested = moneyCents(data.amount), available = sources.reduce((sum, row) => sum + moneyCents(row.remaining), 0);
      if (requested > available) fail('CREDIT_CORRECTION_CAP', kind === 'reduce' ? 'Only the unused amount of this original credit can be reduced.' : 'Only the amount still applied from this original entry can be returned.');
      data.reference = original.reference;
      const entry = await save(queryable, data, original.wallet_id, kind === 'undo' ? original.booking_payment_account_id : null);
      let remaining = requested;
      for (const source of sources) {
        const amount = Math.min(remaining, moneyCents(source.remaining));
        if (amount > 0) await queryable.query('INSERT INTO treatment_credit_allocations(debit_entry_id,issue_entry_id,amount) VALUES($1,$2,$3)', [entry.id, source.id, (amount / 100).toFixed(2)]);
        remaining -= amount; if (!remaining) break;
      }
      return { status: kind === 'reduce' ? 'reduced' : 'returned', entry };
    });
  }
  const reduce = input => correct(input, 'reduce'), undo = input => correct(input, 'undo');
  async function getClientModel({ adminId, clientId } = {}) {
    const authority = await requireAccess(db, adminId, CAPABILITIES.VIEW), client = await clientProfile(db, id(clientId), { active: false });
    const entries = (await db.query(`SELECT e.*,a.display_name AS actor_name,source.reason AS source_reason,
      CASE WHEN e.entry_type='issue' THEN ${SOURCE_REMAINING_SQL}
        WHEN e.entry_type='apply' THEN -e.signed_amount-COALESCE((SELECT SUM(u.signed_amount) FROM treatment_credit_entries u WHERE u.entry_type='undo' AND u.source_entry_id=e.id),0)
        ELSE 0 END AS correctable_amount FROM treatment_credit_entries e
      JOIN treatment_credit_wallets w ON w.id=e.wallet_id JOIN staff_admin_accounts a ON a.id=e.actor_admin_id
      LEFT JOIN treatment_credit_entries source ON source.id=e.source_entry_id
      WHERE w.crm_v2_client_id=$1 ORDER BY e.id DESC`, [client.id])).rows;
    const appointments = (await db.query(`SELECT id,starts_at,total_price,title FROM appointments
      WHERE crm_v2_client_id=$1 AND client_id IS NULL AND status='completed' ORDER BY starts_at DESC LIMIT 30`, [client.id])).rows;
    return { client, entries, appointments, balance: entries.reduce((sum, row) => sum + Math.round(Number(row.signed_amount) * 100), 0) / 100,
      authority: { canIssue: client.status === 'active' && hasCapability(authority, CAPABILITIES.ISSUE), canApply: client.status === 'active' && hasCapability(authority, CAPABILITIES.APPLY), canCorrect: hasCapability(authority, CAPABILITIES.CORRECT) } };
  }
  async function canView(adminId) { await requireAccess(db, adminId, CAPABILITIES.VIEW); return true; }
  return { issue, apply, reduce, undo, getClientModel, requireAccess, canView };
}
module.exports = { CAPABILITIES, APPLIED_SQL, TreatmentCreditError, normalized, createClientTreatmentCreditService };
