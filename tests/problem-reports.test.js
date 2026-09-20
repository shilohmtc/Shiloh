'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createProblemReportService, ProblemReportError, cleanPath, senderHash } = require('../src/services/problemReports');
const { renderProblemReportsPage } = require('../src/presentation/workspaceProblemReportsUx');
const { renderMyShilohPage } = require('../src/presentation/myShilohPwa');
const { createWorkspaceNavigationService } = require('../src/services/workspaceNavigation');

function fakeDb({ manager = true } = {}) {
  const state = { reports: [], intent: null, queries: [] };
  return {
    state,
    async query(sql, params = []) {
      state.queries.push({ sql, params });
      if (sql.includes('problemReports:staffIdentity')) return { rows: [{ id: Number(params[0]), display_name: Number(params[0]) === 74 ? 'Jean-Pierre' : 'Staff member', active: true, business_role: Number(params[0]) === 74 ? 'business_admin' : 'booking_operator', permissions: manager && Number(params[0]) === 74 ? { 'problem_reports:manage': true } : {} }], rowCount: 1 };
      if (sql.includes('problemReports:clientIdentity')) return { rows: [{ id: Number(params[0]), name: 'Client One', status: 'active' }], rowCount: 1 };
      if (sql.includes('problemReports:openCount')) return { rows: [{ count: state.reports.filter((r) => ['new', 'investigating'].includes(r.status)).length }] };
      if (sql.includes('problemReports:appointment')) return { rows: params[0] === 99 ? [{ id: 99 }] : [], rowCount: params[0] === 99 ? 1 : 0 };
      if (sql.includes('problemReports:create')) {
        const row = { id: state.reports.length + 1, reference_code: params[0], source: params[1], reporter_type: params[2], reporter_staff_admin_id: params[3], reporter_crm_v2_client_id: params[4], reporter_name_snapshot: params[5], category: params[6], description: params[7], expected_behavior: params[8], related_appointment_id: params[9], page_path: params[10], request_id: params[11], diagnostic_context: JSON.parse(params[12]), screenshot_mime_type: params[13], status: 'new', resolution_note: null, revision: 0, created_at: new Date('2026-09-20T10:00:00Z'), updated_at: new Date('2026-09-20T10:00:00Z'), resolved_at: null };
        state.reports.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes('problemReports:audit')) return { rows: [], rowCount: 1 };
      if (sql.includes('problemReports:listForReporter')) {
        const idField = params[0] === 'staff' ? 'reporter_staff_admin_id' : 'reporter_crm_v2_client_id';
        const rows = state.reports.filter((report) => report.reporter_type === params[0] && report[idField] === Number(params[1]));
        return { rows, rowCount: rows.length };
      }
      if (sql.includes('problemReports:list')) return { rows: state.reports, rowCount: state.reports.length };
      if (sql.includes('problemReports:updateStatus')) {
        const row = state.reports.find((report) => report.reference_code === params[1]);
        if (!row) return { rows: [], rowCount: 0 };
        row.status = params[2]; row.resolution_note = params[3]; row.revision = Number(row.revision || 0) + 1; row.updated_at = new Date('2026-09-20T10:05:00Z');
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes('problemReports:reopenFromWhatsapp')) {
        const field = params[0] === 'staff' ? 'reporter_staff_admin_id' : 'reporter_crm_v2_client_id';
        const row = state.reports.find((report) => report.reporter_type === params[0] && report[field] === Number(params[1]) && ['fixed', 'closed'].includes(report.status) && (!params[2] || report.reference_code === params[2]));
        if (!row) return { rows: [], rowCount: 0 };
        row.status = 'investigating'; row.resolution_note = null; row.revision = Number(row.revision || 0) + 1;
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes('problemReports:whatsappStaffIdentity')) return { rows: [], rowCount: 0 };
      if (sql.includes('problemReports:whatsappClientIdentity')) return { rows: [{ id: 501, name: 'Client One' }], rowCount: 1 };
      if (sql.includes('problemReports:whatsappIntent')) return { rows: state.intent ? [state.intent] : [], rowCount: state.intent ? 1 : 0 };
      if (sql.includes('problemReports:startWhatsappIntent')) { state.intent = { sender_hash: params[0], reporter_type: params[1], reporter_staff_admin_id: params[2], reporter_crm_v2_client_id: params[3], step: 'category', category: null }; return { rows: [], rowCount: 1 }; }
      if (sql.includes('problemReports:setWhatsappCategory')) { state.intent.step = 'description'; state.intent.category = params[1]; return { rows: [], rowCount: 1 }; }
      if (sql.includes('problemReports:clearWhatsappIntent')) { state.intent = null; return { rows: [], rowCount: 1 }; }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

test('only JP explicit permission can open the private inbox', async () => {
  const db = fakeDb();
  const service = createProblemReportService({ db, clock: () => new Date('2026-09-20T10:00:00Z'), randomBytes: () => Buffer.from('01020304', 'hex') });
  assert.deepEqual(await service.resolveWorkspaceAccess(74), { canSubmit: true, canManage: true, displayName: 'Jean-Pierre', openCount: 0 });
  await assert.rejects(() => service.listForManager({ adminId: 75 }), (error) => error instanceof ProblemReportError && error.httpStatus === 403);
});

test('every authenticated staff Workspace gets the report form link but only JP gets an inbox badge', async () => {
  const allowed = { resolveAccess: async () => ({}) };
  const staff = { resolveManageAccess: async () => ({}) };
  const makeNavigation = (problemAccess) => createWorkspaceNavigationService({
    clientAccessService: allowed,
    staffAccessService: staff,
    servicesAccessService: allowed,
    formsAccessService: allowed,
    reportsAccessService: allowed,
    clinicHoursAccessService: allowed,
    voucherAccessService: allowed,
    rewardsAccessService: allowed,
    problemReportsAccessService: { resolveWorkspaceAccess: async () => problemAccess },
  });
  const staffNavigation = await makeNavigation({ canSubmit: true, canManage: false, openCount: 8 }).resolve({ session: { adminId: 75, viewer: {} } });
  assert.deepEqual(staffNavigation.problemReports, { allowed: true, href: '/calendar/problem-reports', badge: 0 });
  const jpNavigation = await makeNavigation({ canSubmit: true, canManage: true, openCount: 8 }).resolve({ session: { adminId: 74, viewer: {} } });
  assert.deepEqual(jpNavigation.problemReports, { allowed: true, href: '/calendar/problem-reports', badge: 8 });
});

test('authenticated My Shiloh report stores bounded context and an owned booking', async () => {
  const db = fakeDb();
  const service = createProblemReportService({ db, clock: () => new Date('2026-09-20T10:00:00Z'), randomBytes: () => Buffer.from('01020304', 'hex') });
  const report = await service.createReport({ source: 'my_shiloh', reporterType: 'client', crmV2ClientId: 501, requestId: 'request-1', payload: { category: 'booking', description: 'The reminder showed the wrong appointment time.', expectedBehavior: 'It should match my confirmed booking.', relatedAppointmentId: 99, pagePath: 'https://example.test/my-shiloh/?secret=no#profile', diagnosticContext: { online: true, viewport: { width: 390, height: 844 }, userAgent: 'Mobile Browser' } } });
  assert.equal(report.reference, 'SH-260920-01020304');
  assert.equal(report.pagePath, '/my-shiloh/');
  assert.equal(report.relatedAppointmentId, 99);
  assert.equal(report.diagnosticContext.viewport, '390x844');
  assert.equal(db.state.queries.some(({ sql }) => sql.includes('problem_report.created')), true);
});

test('screenshots are restricted by type and one-megabyte limit', () => {
  const db = fakeDb();
  const service = createProblemReportService({ db });
  return assert.rejects(() => service.createReport({ source: 'workspace', reporterType: 'staff', adminId: 74, payload: { category: 'other', description: 'A detailed but valid problem report.', screenshotDataUrl: 'data:text/plain;base64,SGVsbG8=' } }), /JPG, PNG or WebP/);
});

test('WhatsApp flow verifies exact identity, collects category and saves description', async () => {
  const db = fakeDb();
  const service = createProblemReportService({ db, clock: () => new Date('2026-09-20T10:00:00Z'), randomBytes: () => Buffer.from('aabbccdd', 'hex') });
  const start = await service.processWhatsAppMessage('27821234567', 'Report a problem');
  assert.equal(start.handled, true);
  assert.equal(start.interactive.rows.length, 5);
  const category = await service.processWhatsAppMessage('27821234567', 'problem_report_category_messages');
  assert.match(category.reply, /describe what happened/i);
  const completed = await service.processWhatsAppMessage('27821234567', 'The message showed a time that did not match my booking.');
  assert.match(completed.reply, /SH-260920-AABBCCDD/);
  assert.equal(db.state.intent, null);
  assert.equal(db.state.reports[0].source, 'whatsapp');
});

test('reporters see only their own safe status fields and can reopen a resolved report', async () => {
  const db = fakeDb();
  const service = createProblemReportService({ db, clock: () => new Date('2026-09-20T10:00:00Z'), randomBytes: () => Buffer.from('aabbccdd', 'hex') });
  const own = await service.createReport({ source: 'my_shiloh', reporterType: 'client', crmV2ClientId: 501, payload: { category: 'messages', description: 'The reminder time did not match my confirmed booking.' } });
  db.state.reports.push({ ...db.state.reports[0], id: 2, reference_code: 'SH-260920-11223344', reporter_crm_v2_client_id: 999 });
  const listed = await service.listForReporter({ reporterType: 'client', crmV2ClientId: 501 });
  assert.equal(listed.reports.length, 1);
  assert.deepEqual(Object.keys(listed.reports[0]).sort(), ['category', 'createdAt', 'reference', 'resolutionNote', 'resolvedAt', 'revision', 'status', 'updatedAt'].sort());
  await service.updateStatus({ adminId: 74, reference: own.reference, status: 'fixed', resolutionNote: 'The reminder now uses the confirmed appointment time.' });
  const reopened = await service.processWhatsAppMessage('27821234567', `Still not working ${own.reference}`);
  assert.match(reopened.reply, /has been reopened/);
  assert.equal(db.state.reports[0].status, 'investigating');
});

test('client and JP pages use friendly wording and keep support copy in JP Workspace', () => {
  const clientHtml = renderMyShilohPage({ client: { id: 501, name: 'Client One', firstName: 'Client' }, whatsappNumber: '27821234567' });
  assert.match(clientHtml, /Report a problem/);
  assert.match(clientHtml, /JP will see your report privately/);
  assert.doesNotMatch(clientHtml, /Codex|ChatGPT|Copy report details/);
  const workspaceHtml = renderProblemReportsPage({ model: { displayName: 'Jean-Pierre', canManage: true, reports: [{ reference: 'SH-260920-01020304', status: 'new', category: 'other', reporterType: 'client', reporterName: 'Client One', source: 'my_shiloh', description: 'A visible example problem.', expectedBehavior: null, relatedAppointmentId: null, pagePath: '/my-shiloh/', requestId: null, diagnosticContext: {}, hasScreenshot: false, screenshotMimeType: null, resolutionNote: null, createdAt: '2026-09-20T10:00:00Z', updatedAt: '2026-09-20T10:00:00Z', resolvedAt: null }] }, selectedStatus: 'open' });
  assert.match(workspaceHtml, /JP only/);
  assert.match(workspaceHtml, /Copy report details/);
  const staffHtml = renderProblemReportsPage({ model: { displayName: 'Marietjie', canManage: false, canSubmit: true, reports: [] }, selectedStatus: 'open' });
  assert.match(staffHtml, /technical support team/);
  assert.match(staffHtml, /data-problem-report-form/);
  assert.match(staffHtml, /<h2>Your reports<\/h2>/);
  assert.doesNotMatch(staffHtml, /JP only|Copy report details|<h2>Inbox<\/h2>/);
});

test('migration grants management only to one canonical JP business admin', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '141_problem_reports.sql'), 'utf8');
  assert.match(sql, /problem_reports:manage/);
  assert.match(sql, /business_role = 'business_admin'/);
  assert.match(sql, /Expected exactly one active canonical Jean-Pierre business_admin/);
  assert.doesNotMatch(sql, /business_role IN \('owner','business_admin'\)/);
});

test('resolution migration preserves history and queues idempotent WhatsApp updates', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '142_problem_report_resolution_notifications.sql'), 'utf8');
  assert.match(sql, /problem_report_status_events/);
  assert.match(sql, /problem_report_notifications/);
  assert.match(sql, /UNIQUE\(problem_report_id,event_type,report_revision\)/);
});

test('page paths drop query strings and WhatsApp sender identity is hashed', () => {
  assert.equal(cleanPath('/my-shiloh/?token=secret#profile'), '/my-shiloh/');
  assert.match(senderHash('+27 82 123 4567'), /^[0-9a-f]{64}$/);
  assert.doesNotMatch(senderHash('+27 82 123 4567'), /27821234567/);
});
