'use strict';
const { pool } = require('../db/pool');
const {
  createWorkspaceFinancialReportsService,
  RECEIPTS_SQL,
} = require('./workspaceFinancialReports');
const { summarizeFinancials } = require('../domain/workspaceFinancialReports');
const { resolvePeriod } = require('./workspaceReports');
const { clinicDate } = require('./workspaceStaffEarnings');
const {
  METRICS,
  monthPeriod,
  validateTarget,
  comparison,
} = require('../domain/workspaceBusinessTargets');
const { error } = require('../domain/workspaceFinancialRecords');
function createWorkspaceBusinessTargetsService({
  db = pool,
  now = () => new Date(),
  access = (client) => createWorkspaceFinancialReportsService({ db: client }),
} = {}) {
  const requireAccess = (adminId) => access(db).requireAccess(adminId);
  async function transaction(readOnly, work) {
    const client = await db.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ' + (readOnly ? ' READ ONLY' : ''));
      await client.query("SET LOCAL statement_timeout='5000ms'");
      await client.query("SET LOCAL lock_timeout='2000ms'");
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (['40001', '23505'].includes(e.code))
        throw error('Targets changed. Refresh and review before saving.', 409);
      throw e;
    } finally {
      client.release();
    }
  }
  async function build({ adminId, month } = {}) {
    const at = now(),
      selected = monthPeriod(month || clinicDate(at).slice(0, 7));
    return transaction(true, async (client) => {
      await access(client).requireAccess(adminId);
      const revisions = (
        await client.query(
          `SELECT t.*,a.display_name AS actor_name FROM workspace_business_target_revisions t JOIN staff_admin_accounts a ON a.id=t.created_by_admin_id WHERE t.scope_key='whole_clinic' AND t.period_start=$1::date ORDER BY t.created_at DESC,t.id DESC LIMIT 51`,
          [selected.start],
        )
      ).rows;
      const latest = (
        await client.query(
          `SELECT DISTINCT ON(metric) metric,action,target_value,revision FROM workspace_business_target_revisions WHERE scope_key='whole_clinic' AND period_start=$1::date ORDER BY metric,revision DESC`,
          [selected.start],
        )
      ).rows;
      const cutoff = new Date(Math.min(new Date(selected.to).getTime(), at.getTime()));
      let receipts = null,
        visits = null;
      if (cutoff.getTime() <= new Date(selected.from).getTime()) {
        receipts = 0;
        visits = 0;
      } else {
        const period = resolvePeriod({
          from: selected.start,
          to: new Date(new Date(selected.end + 'T12:00:00Z').getTime() - 86400000)
            .toISOString()
            .slice(0, 10),
          now: at,
        });
        const rows = (
          await client.query(RECEIPTS_SQL, [
            selected.from,
            cutoff.toISOString(),
            selected.from,
            cutoff.toISOString(),
          ])
        ).rows;
        const finance = summarizeFinancials({
          period,
          treatments: [],
          receipts: rows,
          balances: [],
        });
        receipts = Math.round(finance.current.netReceived * 100);
        const count = await client.query(
          "SELECT COUNT(*)::bigint AS count FROM appointments WHERE status IN ('completed','no_charge') AND starts_at >= $1::timestamptz AND starts_at < $2::timestamptz",
          [selected.from, cutoff.toISOString()],
        );
        visits = Number(count.rows[0].count);
      }
      return {
        month: selected.month,
        asOf: at.toISOString(),
        metrics: Object.entries(METRICS).map(([key, meta]) => {
          const row = latest.find((r) => r.metric === key);
          const target = row?.action === 'set' ? Number(row.target_value) : null;
          return {
            key,
            ...meta,
            ...comparison(key === 'net_receipts' ? receipts : visits, target),
            revision: Number(row?.revision || 0),
          };
        }),
        history: revisions.slice(0, 50),
        hasMoreHistory: revisions.length > 50,
      };
    });
  }
  async function save(input) {
    await requireAccess(input.adminId);
    const v = validateTarget(input);
    return transaction(false, async (client) => {
      await access(client).requireAccess(input.adminId);
      const prior = (
        await client.query(
          'SELECT *,period_start::text AS month_start FROM workspace_business_target_revisions WHERE operation_id=$1',
          [v.operationId],
        )
      ).rows[0];
      if (prior) {
        if (
          Number(prior.created_by_admin_id) !== Number(input.adminId) ||
          prior.metric !== v.metric ||
          prior.month_start !== v.period.start ||
          prior.action !== v.action ||
          (prior.target_value == null ? null : Number(prior.target_value)) !== v.value ||
          Number(prior.revision) !== v.revision + 1
        )
          throw error('This save reference has already been used. Refresh and review.', 409);
        return { id: prior.id, revision: Number(prior.revision), replayed: true };
      }
      const latest = (
        await client.query(
          "SELECT revision FROM workspace_business_target_revisions WHERE scope_key='whole_clinic' AND metric=$1 AND period_start=$2::date ORDER BY revision DESC LIMIT 1",
          [v.metric, v.period.start],
        )
      ).rows[0];
      if (Number(latest?.revision || 0) !== v.revision)
        throw error('This target changed. Refresh and review before saving.', 409);
      const row = (
        await client.query(
          `INSERT INTO workspace_business_target_revisions(operation_id,metric,period_start,revision,action,target_value,created_by_admin_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,revision`,
          [
            v.operationId,
            v.metric,
            v.period.start,
            v.revision + 1,
            v.action,
            v.value,
            input.adminId,
          ],
        )
      ).rows[0];
      await client.query(
        `INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata) VALUES($1,'workspace.target.'||$2,'workspace_business_target',$3,$4::jsonb)`,
        [
          input.adminId,
          v.action,
          row.id,
          JSON.stringify({
            operationId: v.operationId,
            month: v.period.month,
            metric: v.metric,
            value: v.value,
            revision: v.revision + 1,
          }),
        ],
      );
      return { id: row.id, revision: Number(row.revision), replayed: false };
    });
  }
  return { requireAccess, build, save };
}
module.exports = {
  createWorkspaceBusinessTargetsService,
  ...createWorkspaceBusinessTargetsService(),
};
