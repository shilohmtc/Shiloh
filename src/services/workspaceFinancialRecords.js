const crypto = require('node:crypto');
const { pool } = require('../db/pool');
const { createWorkspaceFinancialReportsService, RECEIPTS_SQL } = require('./workspaceFinancialReports');
const { summarizeFinancials } = require('../domain/workspaceFinancialReports');
const { resolvePeriod } = require('./workspaceReports');
const { clinicDate } = require('./workspaceStaffEarnings');
const { error, moneyCents, text, day, operation, summarizeExpenses, cashCalculation, CATEGORIES, EXPENSE_METHODS } = require('../domain/workspaceFinancialRecords');

const EXPENSES_SQL = `/* FinancialRecords:expenses */
 SELECT e.*,e.paid_on::text AS paid_on,a.display_name AS created_by,
        v.display_name AS voided_by FROM workspace_expenses e
 JOIN staff_admin_accounts a ON a.id=e.created_by_admin_id
 LEFT JOIN staff_admin_accounts v ON v.id=e.voided_by_admin_id
 WHERE e.paid_on >= $1::date AND e.paid_on <= $2::date ORDER BY e.paid_on DESC,e.id DESC`;
const CLOSES_SQL = `/* FinancialRecords:closes */
 SELECT c.*,c.business_date::text AS business_date,a.display_name AS created_by
 FROM workspace_cashup_closes c JOIN staff_admin_accounts a ON a.id=c.created_by_admin_id
 WHERE c.business_date >= $1::date AND c.business_date <= $2::date
 ORDER BY c.business_date DESC,c.revision DESC`;
function fingerprint(receipts, expenses) {
  const evidence = receipts.map(row => ['receipt', row.source, String(row.id), new Date(row.created_at).toISOString(), row.entry_type, String(row.amount), row.method]);
  evidence.push(...expenses.filter(row => !row.voided_at).map(row => ['expense', String(row.id), row.paid_on, String(row.amount), row.method]));
  return crypto.createHash('sha256').update(JSON.stringify(evidence.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))).digest('hex');
}
function createWorkspaceFinancialRecordsService({ db = pool, now = () => new Date(),
  access = client => createWorkspaceFinancialReportsService({ db: client }) } = {}) {
  async function requireAccess(adminId, client = db) { return access(client).requireAccess(adminId); }
  async function transaction(task) {
    const client = await db.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await client.query("SET LOCAL statement_timeout='15s'");
      const result = await task(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      if (['40001','23505'].includes(err.code)) throw error('Another entry was saved. Refresh and review before saving again.', 409);
      throw err;
    } finally { client.release(); }
  }
  async function audit(client, adminId, action, entityType, id, metadata) {
    await client.query(`INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
      VALUES($1,$2,$3,$4,$5::jsonb)`, [adminId, action, entityType, id, JSON.stringify(metadata)]);
  }
  async function build({ adminId, period }) {
    await requireAccess(adminId);
    const valid = resolvePeriod({ from: period.startKey, to: period.endInclusiveKey, now: now() });
    const params = [valid.startKey, valid.endInclusiveKey];
    const [expenses, closes] = await Promise.all([db.query(EXPENSES_SQL, params), db.query(CLOSES_SQL, params)]);
    return { ...summarizeExpenses(expenses.rows), closes: closes.rows, today: clinicDate(now()) };
  }
  async function addExpense(input) {
    await requireAccess(input.adminId);
    const operationId = operation(input.operationId), paidOn = day(input.paidOn, clinicDate(now()));
    const amount = moneyCents(input.amount, { positive: true }) / 100;
    const description = text(input.description, 200, true), reference = text(input.reference || '', 120);
    if (!Object.hasOwn(CATEGORIES, input.category) || !Object.hasOwn(EXPENSE_METHODS, input.method)) throw error('Choose an expense category and payment method.');
    return transaction(async client => {
      await requireAccess(input.adminId, client);
      const previous = (await client.query('SELECT *,paid_on::text AS paid_on FROM workspace_expenses WHERE operation_id=$1', [operationId])).rows[0];
      if (previous) {
        if (Number(previous.created_by_admin_id) !== Number(input.adminId) || previous.paid_on !== paidOn || Number(previous.amount) !== amount || previous.description !== description
          || previous.reference !== reference || previous.category !== input.category || previous.method !== input.method) throw error('This save reference has already been used. Refresh and review.', 409);
        return { id: previous.id, replayed: true };
      }
      const row = (await client.query(`/* FinancialRecords:add_expense */
       INSERT INTO workspace_expenses(operation_id,paid_on,category,description,reference,amount,method,created_by_admin_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [operationId, paidOn, input.category, description, reference, amount, input.method, input.adminId])).rows[0];
      await audit(client, input.adminId, 'workspace.expense.create', 'workspace_expense', row.id, { operationId, paidOn, amount, method: input.method, category: input.category });
      return { id: row.id };
    });
  }
  async function voidExpense({ adminId, expenseId, reason }) {
    await requireAccess(adminId);
    const id = Number(expenseId), note = text(reason, 200, true);
    if (!Number.isSafeInteger(id) || id <= 0) throw error('Choose a valid expense.');
    return transaction(async client => {
      await requireAccess(adminId, client);
      const row = (await client.query('SELECT * FROM workspace_expenses WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!row) throw error('Expense not found.', 404);
      if (row.voided_at) return { id, replayed: true };
      await client.query(`UPDATE workspace_expenses SET voided_at=NOW(),voided_by_admin_id=$2,void_reason=$3 WHERE id=$1`, [id, adminId, note]);
      await audit(client, adminId, 'workspace.expense.void', 'workspace_expense', id, { reason: note });
      return { id };
    });
  }
  async function source(client, date) {
    const period = resolvePeriod({ from: date, to: date, now: now() });
    const receipts = (await client.query(RECEIPTS_SQL, [period.from, period.to, period.from, period.to])).rows;
    const expenses = (await client.query(EXPENSES_SQL, [date, date])).rows;
    const closes = (await client.query(CLOSES_SQL, [date, date])).rows;
    const hash = fingerprint(receipts, expenses);
    return { date, fingerprint: hash, methods: summarizeFinancials({ period, receipts }).methods,
      cashExpenses: summarizeExpenses(expenses.filter(row => row.method === 'cash')).total,
      expenseTotal: summarizeExpenses(expenses).total,
      expenseIds: expenses.filter(row => !row.voided_at).map(row => row.id),
      receiptEvidence: receipts.map(row => ({ source: row.source, id: row.id, amount: row.amount, method: row.method, type: row.entry_type })),
      revision: Number(closes[0]?.revision || 0), closes,
      changedSinceClose: closes.length > 0 && closes[0].source_fingerprint !== hash };
  }
  async function preview({ adminId, date }) {
    await requireAccess(adminId);
    const selected = day(date, clinicDate(now()));
    return transaction(async client => { await requireAccess(adminId, client); return source(client, selected); });
  }
  async function saveCashup(input) {
    await requireAccess(input.adminId);
    const date = day(input.date, clinicDate(now())), operationId = operation(input.operationId), note = text(input.note || '', 500);
    for (const key of ['openingFloat','cashAdded','cashRemoved','countedCash']) moneyCents(input[key]);
    if (!/^[a-f0-9]{64}$/.test(String(input.fingerprint)) || !Number.isSafeInteger(input.revision) || input.revision < 0) throw error('Review the day before saving.');
    return transaction(async client => {
      await requireAccess(input.adminId, client);
      await client.query("SELECT pg_advisory_xact_lock(hashtext('workspace.cashup:'||$1))", [date]);
      const previous = (await client.query('SELECT *,business_date::text AS business_date FROM workspace_cashup_closes WHERE operation_id=$1', [operationId])).rows[0];
      if (previous) {
        if (Number(previous.created_by_admin_id) !== Number(input.adminId) || previous.business_date !== date || previous.source_fingerprint !== input.fingerprint
          || Number(previous.revision) !== input.revision + 1 || previous.note !== note
          || ['openingFloat','cashAdded','cashRemoved','countedCash'].some((key, index) => Number(previous[['opening_float','cash_added','cash_removed','counted_cash'][index]]) !== Number(input[key]))) throw error('This save reference has already been used. Refresh and review.', 409);
        return { id: previous.id, replayed: true };
      }
      const current = await source(client, date);
      if (current.fingerprint !== input.fingerprint || current.revision !== input.revision) throw error('The day changed since you reviewed it. Review the day again before saving.', 409);
      const calculation = cashCalculation(current, input);
      if ((calculation.difference !== 0 || current.revision > 0 || Number(input.cashAdded) > 0 || Number(input.cashRemoved) > 0) && !note) throw error('Add a note explaining the difference, cash movement or revised close.');
      const row = (await client.query(`/* FinancialRecords:save_cashup */
        INSERT INTO workspace_cashup_closes(operation_id,business_date,revision,source_fingerprint,snapshot,
          opening_float,cash_added,cash_removed,counted_cash,expected_cash,difference,note,created_by_admin_id)
        VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [operationId,date,current.revision + 1,current.fingerprint,JSON.stringify({ methods: current.methods, cashExpenses: current.cashExpenses,
        expenseTotal: current.expenseTotal, expenseIds: current.expenseIds, receiptEvidence: current.receiptEvidence }),
      calculation.openingFloat,calculation.cashAdded,calculation.cashRemoved,calculation.countedCash,calculation.expectedCash,calculation.difference,note,input.adminId])).rows[0];
      await audit(client, input.adminId, 'workspace.cashup.close', 'workspace_cashup', row.id, { date, revision: current.revision + 1, ...calculation });
      return { id: row.id, revision: current.revision + 1, ...calculation };
    });
  }
  return { requireAccess, build, addExpense, voidExpense, preview, saveCashup };
}
module.exports = { EXPENSES_SQL, CLOSES_SQL, fingerprint, createWorkspaceFinancialRecordsService, ...createWorkspaceFinancialRecordsService() };
