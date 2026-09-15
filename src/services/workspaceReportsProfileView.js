const { pool } = require('../db/pool');
const { createWorkspaceReportsService } = require('./workspaceReports');

const REPORTS_VIEW_ALL_CAPABILITY = 'reports:view_all';

function permissionSet(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function readProxy(db) {
  return {
    async query(sql, params) {
      const result = await db.query(sql, params);
      if (!String(sql).includes('WorkspaceReports:principal')) return result;
      return {
        ...result,
        rows: (result.rows || []).map((row) => permissionSet(row.permissions)[REPORTS_VIEW_ALL_CAPABILITY] === true
          ? { ...row, calendar_scope: 'all_business' }
          : row),
      };
    },
  };
}

function createWorkspaceReportsProfileViewService({ db = pool } = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('Workspace report profile view database is required');
  return createWorkspaceReportsService({ db: readProxy(db) });
}

const service = createWorkspaceReportsProfileViewService();

module.exports = {
  REPORTS_VIEW_ALL_CAPABILITY,
  createWorkspaceReportsProfileViewService,
  ...service,
};
