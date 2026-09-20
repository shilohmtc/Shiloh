'use strict';

const crypto = require('crypto');
const { pool } = require('../db/pool');

const CATEGORIES = new Set(['booking', 'messages', 'profile', 'payments', 'other']);
const STATUSES = new Set(['new', 'investigating', 'fixed', 'closed']);
const SCREENSHOT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SCREENSHOT_BYTES = 1024 * 1024;

class ProblemReportError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = 'ProblemReportError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function cleanText(value, { min = 0, max = 1000, required = false, label = 'Text' } = {}) {
  const clean = String(value || '').replace(/\r\n?/g, '\n').trim();
  if (required && clean.length < min) throw new ProblemReportError('PROBLEM_REPORT_INVALID', `${label} is too short.`);
  if (clean.length > max) throw new ProblemReportError('PROBLEM_REPORT_INVALID', `${label} is too long.`);
  return clean || null;
}

function cleanPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw, 'https://shiloh.invalid');
    return cleanText(parsed.pathname, { max: 240 });
  } catch (_) {
    return null;
  }
}

function cleanAppointmentId(value) {
  if (value == null || String(value).trim() === '') return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new ProblemReportError('PROBLEM_REPORT_INVALID', 'Booking number is not valid.');
  return id;
}

function parseScreenshot(value) {
  if (!value) return null;
  const match = String(value).match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match || !SCREENSHOT_TYPES.has(match[1])) {
    throw new ProblemReportError('PROBLEM_REPORT_SCREENSHOT_INVALID', 'Please choose a JPG, PNG or WebP image.');
  }
  let bytes;
  try { bytes = Buffer.from(match[2], 'base64'); } catch (_) { bytes = null; }
  if (!bytes?.length) throw new ProblemReportError('PROBLEM_REPORT_SCREENSHOT_INVALID', 'That screenshot could not be read.');
  if (bytes.length > MAX_SCREENSHOT_BYTES) {
    throw new ProblemReportError('PROBLEM_REPORT_SCREENSHOT_TOO_LARGE', 'The screenshot must be smaller than 1 MB.', 413);
  }
  return {
    mimeType: match[1],
    bytes,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

function referenceCode(now, randomBytes) {
  const date = new Date(now);
  const stamp = `${String(date.getUTCFullYear()).slice(-2)}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
  return `SH-${stamp}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

function senderHash(value) {
  const normalized = String(value || '').replace(/[^0-9]/g, '');
  return normalized ? crypto.createHash('sha256').update(normalized).digest('hex') : null;
}

function safeContext(context = {}) {
  const viewport = context?.viewport && typeof context.viewport === 'object'
    ? `${Math.max(0, Number(context.viewport.width) || 0)}x${Math.max(0, Number(context.viewport.height) || 0)}`
    : null;
  return {
    appVersion: cleanText(context.appVersion, { max: 80 }),
    viewport: viewport && /^\d{1,5}x\d{1,5}$/.test(viewport) ? viewport : null,
    online: typeof context.online === 'boolean' ? context.online : null,
    userAgent: cleanText(context.userAgent, { max: 300 }),
  };
}

function publicReport(row) {
  return {
    reference: row.reference_code,
    source: row.source,
    reporterType: row.reporter_type,
    reporterName: row.reporter_name_snapshot,
    category: row.category,
    description: row.description,
    expectedBehavior: row.expected_behavior,
    relatedAppointmentId: row.related_appointment_id == null ? null : Number(row.related_appointment_id),
    pagePath: row.page_path,
    requestId: row.request_id,
    diagnosticContext: row.diagnostic_context || {},
    hasScreenshot: Boolean(row.screenshot_mime_type),
    screenshotMimeType: row.screenshot_mime_type || null,
    status: row.status,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    revision: Number(row.revision || 0),
  };
}

function reporterReport(row) {
  const report = publicReport(row);
  return {
    reference: report.reference,
    category: report.category,
    status: report.status,
    resolutionNote: report.resolutionNote,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    resolvedAt: report.resolvedAt,
    revision: report.revision,
  };
}

function createProblemReportService({ db = pool, clock = () => new Date(), randomBytes = crypto.randomBytes } = {}) {
  async function staffIdentity(adminId) {
    const result = await db.query(
      `/* problemReports:staffIdentity */
       SELECT id,display_name,active,permissions,business_role
         FROM staff_admin_accounts WHERE id=$1`,
      [adminId],
    );
    const row = result.rows[0];
    if (!row?.active) throw new ProblemReportError('PROBLEM_REPORT_UNAUTHORIZED', 'Your secure Workspace session is not active.', 403);
    return row;
  }

  async function clientIdentity(crmV2ClientId) {
    const result = await db.query(
      `/* problemReports:clientIdentity */
       SELECT id,name,status FROM crm_v2_clients WHERE id=$1`,
      [crmV2ClientId],
    );
    const row = result.rows[0];
    if (row?.status !== 'active') throw new ProblemReportError('PROBLEM_REPORT_UNAUTHORIZED', 'Your secure My Shiloh session is not active.', 403);
    return row;
  }

  function canManage(identity) {
    return identity?.active === true && identity?.permissions?.['problem_reports:manage'] === true;
  }

  async function resolveWorkspaceAccess(adminId) {
    const identity = await staffIdentity(adminId);
    const manage = canManage(identity);
    let openCount = 0;
    if (manage) {
      const count = await db.query("/* problemReports:openCount */ SELECT COUNT(*)::int AS count FROM problem_reports WHERE status IN ('new','investigating')");
      openCount = Number(count.rows[0]?.count || 0);
    }
    return { canSubmit: true, canManage: manage, displayName: identity.display_name, openCount };
  }

  async function verifyAppointment({ appointmentId, reporterType, crmV2ClientId }) {
    if (!appointmentId) return null;
    const params = [appointmentId];
    let ownership = '';
    if (reporterType === 'client') {
      params.push(crmV2ClientId);
      ownership = ' AND crm_v2_client_id=$2';
    }
    const result = await db.query(
      `/* problemReports:appointment */ SELECT id FROM appointments WHERE id=$1${ownership}`,
      params,
    );
    if (!result.rows[0]) throw new ProblemReportError('PROBLEM_REPORT_APPOINTMENT_NOT_FOUND', 'That booking could not be matched to this report.');
    return Number(result.rows[0].id);
  }

  async function createReport({ source, reporterType, adminId, crmV2ClientId, payload = {}, requestId = null } = {}) {
    if (!['my_shiloh', 'workspace', 'whatsapp'].includes(source)) throw new ProblemReportError('PROBLEM_REPORT_INVALID', 'Report source is not valid.');
    if (!['client', 'staff'].includes(reporterType)) throw new ProblemReportError('PROBLEM_REPORT_INVALID', 'Reporter is not valid.');
    const identity = reporterType === 'staff' ? await staffIdentity(adminId) : await clientIdentity(crmV2ClientId);
    const category = String(payload.category || '').trim().toLowerCase();
    if (!CATEGORIES.has(category)) throw new ProblemReportError('PROBLEM_REPORT_INVALID', 'Please choose what the problem relates to.');
    const description = cleanText(payload.description, { min: 10, max: 2000, required: true, label: 'What happened' });
    const expectedBehavior = cleanText(payload.expectedBehavior, { max: 1000 });
    const relatedAppointmentId = await verifyAppointment({
      appointmentId: cleanAppointmentId(payload.relatedAppointmentId),
      reporterType,
      crmV2ClientId,
    });
    const screenshot = parseScreenshot(payload.screenshotDataUrl);
    const reference = referenceCode(clock(), randomBytes);
    const context = safeContext(payload.diagnosticContext);
    const inserted = await db.query(
      `/* problemReports:create */
       WITH inserted AS (
         INSERT INTO problem_reports(
           reference_code,source,reporter_type,reporter_staff_admin_id,reporter_crm_v2_client_id,
           reporter_name_snapshot,category,description,expected_behavior,related_appointment_id,
           page_path,request_id,diagnostic_context,screenshot_mime_type,screenshot_bytes,screenshot_sha256
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16)
         RETURNING *
       ), audited AS (
         INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
         SELECT $4,'problem_report.created','problem_report',id,
           jsonb_build_object('reference',reference_code,'source',source,'reporterType',reporter_type,'category',category,'hasScreenshot',screenshot_mime_type IS NOT NULL)
         FROM inserted
       ) SELECT * FROM inserted`,
      [
        reference, source, reporterType,
        reporterType === 'staff' ? Number(identity.id) : null,
        reporterType === 'client' ? Number(identity.id) : null,
        reporterType === 'staff' ? identity.display_name : identity.name,
        category, description, expectedBehavior, relatedAppointmentId,
        cleanPath(payload.pagePath), cleanText(requestId, { max: 120 }), JSON.stringify(context),
        screenshot?.mimeType || null, screenshot?.bytes || null, screenshot?.sha256 || null,
      ],
    );
    const row = inserted.rows[0];
    return publicReport(row);
  }

  async function listForManager({ adminId, status = 'open', limit = 100 } = {}) {
    const identity = await staffIdentity(adminId);
    if (!canManage(identity)) throw new ProblemReportError('PROBLEM_REPORT_FORBIDDEN', 'This private inbox is available only in JP’s Workspace.', 403);
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 100));
    const params = [safeLimit];
    let where = "status IN ('new','investigating')";
    if (STATUSES.has(status)) { params.push(status); where = `status=$${params.length}`; }
    else if (status === 'all') where = 'TRUE';
    const result = await db.query(
      `/* problemReports:list */ SELECT * FROM problem_reports WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT $1`,
      params,
    );
    return { canManage: true, reports: result.rows.map(publicReport) };
  }

  async function listForReporter({ reporterType, adminId, crmV2ClientId, limit = 50 } = {}) {
    if (!['client', 'staff'].includes(reporterType)) throw new ProblemReportError('PROBLEM_REPORT_INVALID', 'Reporter is not valid.');
    const identity = reporterType === 'staff' ? await staffIdentity(adminId) : await clientIdentity(crmV2ClientId);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
    const field = reporterType === 'staff' ? 'reporter_staff_admin_id' : 'reporter_crm_v2_client_id';
    const result = await db.query(
      `/* problemReports:listForReporter */ SELECT * FROM problem_reports
       WHERE reporter_type=$1 AND ${field}=$2 ORDER BY created_at DESC,id DESC LIMIT $3`,
      [reporterType, Number(identity.id), safeLimit],
    );
    return { reports: result.rows.map(reporterReport) };
  }

  async function updateStatus({ adminId, reference, status, resolutionNote } = {}) {
    const identity = await staffIdentity(adminId);
    if (!canManage(identity)) throw new ProblemReportError('PROBLEM_REPORT_FORBIDDEN', 'This private inbox is available only in JP’s Workspace.', 403);
    if (!STATUSES.has(status)) throw new ProblemReportError('PROBLEM_REPORT_INVALID', 'Status is not valid.');
    const note = cleanText(resolutionNote, { max: 1000 });
    if (['fixed', 'closed'].includes(status) && !note) throw new ProblemReportError('PROBLEM_REPORT_NOTE_REQUIRED', 'Add a short note before marking this report complete.');
    const result = await db.query(
      `/* problemReports:updateStatus */
       WITH current AS (
         SELECT * FROM problem_reports WHERE reference_code=$2 FOR UPDATE
       ), updated AS (
         UPDATE problem_reports report SET status=$3,resolution_note=$4,managed_by_admin_id=$1,
           resolved_at=CASE WHEN $3 IN ('fixed','closed') THEN NOW() ELSE NULL END,
           revision=report.revision+1,updated_at=NOW()
         FROM current WHERE report.id=current.id
         RETURNING report.*,current.status AS previous_status,current.resolution_note AS previous_resolution_note
       ), status_event AS (
         INSERT INTO problem_report_status_events(problem_report_id,from_status,to_status,resolution_note_snapshot,actor_admin_id,actor_kind)
         SELECT id,previous_status,status,COALESCE(resolution_note,previous_resolution_note),$1,'staff' FROM updated
       ), notification AS (
         INSERT INTO problem_report_notifications(problem_report_id,event_type,report_revision)
         SELECT id,'resolved',revision FROM updated WHERE status='fixed' AND previous_status<>'fixed'
         ON CONFLICT(problem_report_id,event_type,report_revision) DO NOTHING
       ), audited AS (
         INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
         SELECT $1,'problem_report.status_changed','problem_report',id,
           jsonb_build_object('reference',reference_code,'status',status)
         FROM updated
       ) SELECT * FROM updated`,
      [Number(identity.id), String(reference || ''), status, note],
    );
    const row = result.rows[0];
    if (!row) throw new ProblemReportError('PROBLEM_REPORT_NOT_FOUND', 'That report was not found.', 404);
    return publicReport(row);
  }

  async function reopenFromWhatsApp({ sender, reference = null } = {}) {
    const identity = await whatsappIdentity(sender);
    if (!identity) throw new ProblemReportError('PROBLEM_REPORT_UNAUTHORIZED', 'I could not safely match this WhatsApp number to exactly one active Shiloh profile.', 403);
    const reporterField = identity.reporterType === 'staff' ? 'reporter_staff_admin_id' : 'reporter_crm_v2_client_id';
    const reporterId = identity.reporterType === 'staff' ? identity.adminId : identity.crmV2ClientId;
    const result = await db.query(
      `/* problemReports:reopenFromWhatsapp */
       WITH current AS (
         SELECT * FROM problem_reports
          WHERE reporter_type=$1 AND ${reporterField}=$2 AND status IN ('fixed','closed')
            AND ($3::text IS NULL OR reference_code=$3)
          ORDER BY updated_at DESC,id DESC LIMIT 1 FOR UPDATE
       ), updated AS (
         UPDATE problem_reports report SET status='investigating',resolution_note=NULL,resolved_at=NULL,
           revision=report.revision+1,updated_at=NOW()
         FROM current WHERE report.id=current.id
         RETURNING report.*,current.status AS previous_status,current.resolution_note AS previous_resolution_note
       ), status_event AS (
         INSERT INTO problem_report_status_events(problem_report_id,from_status,to_status,resolution_note_snapshot,actor_kind)
         SELECT id,previous_status,'investigating',previous_resolution_note,'reporter' FROM updated
       ), audited AS (
         INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
         SELECT 'problem_report.reopened_by_reporter','problem_report',id,
           jsonb_build_object('reference',reference_code,'channel','whatsapp') FROM updated
       ) SELECT * FROM updated`,
      [identity.reporterType, Number(reporterId), reference ? String(reference).toUpperCase() : null],
    );
    const row = result.rows[0];
    if (!row) throw new ProblemReportError('PROBLEM_REPORT_NOT_FOUND', 'I could not find a resolved report for this WhatsApp profile.', 404);
    return publicReport(row);
  }

  async function getScreenshot({ adminId, reference } = {}) {
    const identity = await staffIdentity(adminId);
    if (!canManage(identity)) throw new ProblemReportError('PROBLEM_REPORT_FORBIDDEN', 'This private inbox is available only in JP’s Workspace.', 403);
    const result = await db.query(
      `/* problemReports:screenshot */ SELECT screenshot_mime_type,screenshot_bytes FROM problem_reports WHERE reference_code=$1`,
      [String(reference || '')],
    );
    const row = result.rows[0];
    if (!row?.screenshot_bytes || !row?.screenshot_mime_type) throw new ProblemReportError('PROBLEM_REPORT_SCREENSHOT_NOT_FOUND', 'Screenshot not found.', 404);
    return { mimeType: row.screenshot_mime_type, bytes: row.screenshot_bytes };
  }

  async function whatsappIdentity(sender) {
    const normalized = String(sender || '').replace(/[^0-9]/g, '');
    const staff = await db.query(
      `/* problemReports:whatsappStaffIdentity */
       SELECT id,display_name FROM staff_admin_accounts
       WHERE normalized_whatsapp=$1 AND active=TRUE ORDER BY id LIMIT 2`,
      [normalized],
    );
    if (staff.rowCount === 1) return { reporterType: 'staff', adminId: Number(staff.rows[0].id), crmV2ClientId: null };
    if (staff.rowCount > 1) return null;
    const clients = await db.query(
      `/* problemReports:whatsappClientIdentity */
       SELECT id,name FROM crm_v2_clients
       WHERE normalized_mobile=$1 AND status='active' ORDER BY id LIMIT 2`,
      [normalized],
    );
    if (clients.rowCount !== 1) return null;
    return { reporterType: 'client', adminId: null, crmV2ClientId: Number(clients.rows[0].id) };
  }

  async function clearWhatsAppIntent(hash) {
    await db.query('/* problemReports:clearWhatsappIntent */ DELETE FROM problem_report_whatsapp_intents WHERE sender_hash=$1', [hash]);
  }

  async function processWhatsAppMessage(sender, text) {
    const hash = senderHash(sender);
    if (!hash) return { handled: false };
    const raw = String(text || '').trim();
    const normalized = raw.toLowerCase().replace(/[.!?]+$/g, '').replace(/\s+/g, ' ');
    const trigger = /^(report a problem|report problem|something is wrong|something isn't working|something is not working)$/.test(normalized);
    const reopenMatch = raw.match(/^still not working(?:\s+(SH-[0-9]{6}-[A-F0-9]{8}))?[.!?]*$/i);
    const categoryMatch = normalized.match(/^problem_report_category_(booking|messages|profile|payments|other)$/);
    const cancel = /^(cancel|stop|problem_report_cancel)$/.test(normalized);
    let intentResult = await db.query(
      `/* problemReports:whatsappIntent */
       SELECT * FROM problem_report_whatsapp_intents
       WHERE sender_hash=$1 AND expires_at>NOW()`,
      [hash],
    );
    let intent = intentResult.rows[0] || null;
    if (reopenMatch) {
      try {
        const report = await reopenFromWhatsApp({ sender, reference: reopenMatch[1] || null });
        return { handled: true, reply: `Your report *${report.reference}* has been reopened. Our technical support team will investigate again and keep you updated. 🌿` };
      } catch (error) {
        if (error instanceof ProblemReportError) return { handled: true, reply: `${error.message} Please open My Shiloh to check your reports or send *Report a problem* to log a new one.` };
        throw error;
      }
    }
    if (!trigger && !categoryMatch && !cancel && !intent) return { handled: false };
    if (cancel) {
      if (!intent) return { handled: false };
      await clearWhatsAppIntent(hash);
      return { handled: true, reply: 'Problem report cancelled. Nothing was saved.' };
    }
    if (trigger) {
      const identity = await whatsappIdentity(sender);
      if (!identity) {
        return { handled: true, reply: 'I could not safely match this WhatsApp number to exactly one active Shiloh profile. Please use Report a problem in My Shiloh, or ask JP for help.' };
      }
      await db.query(
        `/* problemReports:startWhatsappIntent */
         INSERT INTO problem_report_whatsapp_intents(sender_hash,reporter_type,reporter_staff_admin_id,reporter_crm_v2_client_id,step,expires_at)
         VALUES($1,$2,$3,$4,'category',NOW()+INTERVAL '20 minutes')
         ON CONFLICT(sender_hash) DO UPDATE SET reporter_type=EXCLUDED.reporter_type,
           reporter_staff_admin_id=EXCLUDED.reporter_staff_admin_id,
           reporter_crm_v2_client_id=EXCLUDED.reporter_crm_v2_client_id,
           step='category',category=NULL,updated_at=NOW(),expires_at=EXCLUDED.expires_at`,
        [hash, identity.reporterType, identity.adminId, identity.crmV2ClientId],
      );
      return {
        handled: true,
        interactive: {
          type: 'list',
          body: 'What does the problem relate to?',
          buttonText: 'Choose one',
          sectionTitle: 'Problem area',
          rows: [
            { id: 'problem_report_category_booking', title: 'Booking' },
            { id: 'problem_report_category_messages', title: 'Messages' },
            { id: 'problem_report_category_profile', title: 'Personal details' },
            { id: 'problem_report_category_payments', title: 'Payments' },
            { id: 'problem_report_category_other', title: 'Something else' },
          ],
        },
      };
    }
    if (!intent) return { handled: false };
    if (categoryMatch) {
      await db.query(
        `/* problemReports:setWhatsappCategory */
         UPDATE problem_report_whatsapp_intents SET step='description',category=$2,updated_at=NOW(),expires_at=NOW()+INTERVAL '20 minutes'
         WHERE sender_hash=$1`,
        [hash, categoryMatch[1]],
      );
      return { handled: true, reply: 'Please describe what happened in one message. Include what you were trying to do and what went wrong. Send *Cancel* to stop.' };
    }
    if (intent.step === 'category') {
      return { handled: true, reply: 'Please choose a problem area from the list, or send *Cancel*.' };
    }
    if (intent.step === 'description') {
      if (raw.length < 10) return { handled: true, reply: 'Please add a little more detail about what happened, or send *Cancel*.' };
      const report = await createReport({
        source: 'whatsapp',
        reporterType: intent.reporter_type,
        adminId: intent.reporter_staff_admin_id,
        crmV2ClientId: intent.reporter_crm_v2_client_id,
        payload: { category: intent.category, description: raw },
      });
      await clearWhatsAppIntent(hash);
      return { handled: true, reply: `Thank you — your report has been logged as *${report.reference}*. Our technical support team will investigate the issue and let you know once it has been resolved. 🌿` };
    }
    return { handled: false };
  }

  return { resolveWorkspaceAccess, createReport, listForManager, listForReporter, updateStatus, reopenFromWhatsApp, getScreenshot, processWhatsAppMessage };
}

const service = createProblemReportService();

module.exports = {
  CATEGORIES,
  STATUSES,
  MAX_SCREENSHOT_BYTES,
  ProblemReportError,
  cleanPath,
  parseScreenshot,
  safeContext,
  senderHash,
  createProblemReportService,
  ...service,
};
