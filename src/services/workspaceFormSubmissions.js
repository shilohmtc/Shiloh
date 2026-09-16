const crypto = require('crypto');
const { pool } = require('../db/pool');
const workspaceForms = require('./workspaceForms');
const { decryptSubmissionPayload } = require('./clientConsultationForms');

class WorkspaceFormSubmissionError extends Error {
  constructor(code, message, httpStatus) {
    super(message);
    this.name = 'WorkspaceFormSubmissionError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function canReadSensitiveSubmission(authority = {}) {
  const role = String(authority.businessRole || '').trim().toLowerCase();
  return role === 'owner' || role === 'business_admin' || authority.formScope === 'own_staff';
}

function canReadTrialSubmission(authority = {}) {
  const role = String(authority.businessRole || '').trim().toLowerCase();
  return role === 'owner' || role === 'business_admin';
}

function normalizeSubmissionId(value) {
  const id = positiveId(value);
  if (!id) throw new WorkspaceFormSubmissionError('WORKSPACE_FORM_SUBMISSION_NOT_FOUND', 'That form submission was not found.', 404);
  return id;
}

function trialReference(tokenHash) {
  const hash = String(tokenHash || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new WorkspaceFormSubmissionError('WORKSPACE_FORM_TRIAL_REFERENCE_INVALID', 'That test submission was not found.', 404);
  return crypto.createHash('sha256').update(`workspace-form-trial:${hash}`, 'utf8').digest('hex').slice(0, 24);
}

function normalizeTrialReference(value) {
  const reference = String(value || '').trim().toLowerCase();
  if (!/^[0-9a-f]{24}$/.test(reference)) throw new WorkspaceFormSubmissionError('WORKSPACE_FORM_TRIAL_REFERENCE_INVALID', 'That test submission was not found.', 404);
  return reference;
}

function arrayValue(value) {
  return Array.isArray(value) ? value.map(item => String(item || '')).filter(Boolean) : [];
}

function safeSnapshot(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function createWorkspaceFormSubmissionsService({
  db = pool,
  env = process.env,
  formsService = workspaceForms,
  decrypt = decryptSubmissionPayload,
} = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('Workspace form submissions database is required');

  function scopeSql(authority, startIndex = 1) {
    if (authority.formScope !== 'own_staff') return { sql: '', values: [] };
    return {
      sql: ` AND EXISTS (
        SELECT 1 FROM appointment_staff scope_staff
         WHERE scope_staff.appointment_id=a.appointment_id
           AND scope_staff.staff_id=$${startIndex}
      )`,
      values: [authority.linkedStaffId],
    };
  }

  async function listRealSubmissions(authority) {
    const scope = scopeSql(authority, 1);
    const result = await db.query(`/* workspaceFormSubmissions:list-real */
      SELECT sub.id,sub.submitted_at,sub.signed_at,a.status AS assignment_status,
             ap.id AS appointment_id,ap.starts_at,
             t.template_key,t.title AS form_title,
             COALESCE(v2.name,c.display_name,ap.source_client_name,'Client') AS client_name,
             COALESCE((
               SELECT jsonb_agg(s.service_name_snapshot ORDER BY s.position,s.id)
                 FROM appointment_services s WHERE s.appointment_id=ap.id
             ),'[]'::jsonb) AS services,
             COALESCE((
               SELECT jsonb_agg(st.staff_name_snapshot ORDER BY st.position,st.id)
                 FROM appointment_staff st WHERE st.appointment_id=ap.id
             ),'[]'::jsonb) AS practitioners
        FROM consultation_form_submissions sub
        JOIN consultation_form_assignments a ON a.id=sub.assignment_id
        JOIN appointments ap ON ap.id=a.appointment_id
        JOIN consultation_form_template_versions tv ON tv.id=sub.template_version_id
        JOIN consultation_form_templates t ON t.id=tv.template_id
        LEFT JOIN clients c ON c.id=a.client_id
        LEFT JOIN crm_v2_clients v2 ON v2.id=a.crm_v2_client_id
       WHERE TRUE${scope.sql}
       ORDER BY sub.submitted_at DESC,sub.id DESC
       LIMIT 50`, scope.values);
    const canOpen = canReadSensitiveSubmission(authority);
    return result.rows.map(row => ({
      kind: 'client',
      reference: String(row.id),
      submissionId: positiveId(row.id),
      clientName: String(row.client_name || 'Client'),
      formTitle: String(row.form_title || 'Consultation form'),
      templateKey: String(row.template_key || ''),
      appointmentId: positiveId(row.appointment_id),
      appointmentStartsAt: row.starts_at || null,
      submittedAt: row.submitted_at || null,
      signedAt: row.signed_at || null,
      status: String(row.assignment_status || 'completed'),
      services: arrayValue(row.services),
      practitioners: arrayValue(row.practitioners),
      isTest: false,
      canOpen,
    }));
  }

  async function listTrialSubmissions(authority) {
    if (!canReadTrialSubmission(authority)) return [];
    const result = await db.query(`/* workspaceFormSubmissions:list-trials */
      SELECT token_hash,submitted_at,template_version_id,
             COALESCE(template_snapshot->>'title','Consultation form') AS form_title
        FROM consultation_form_trials
       WHERE submitted_at IS NOT NULL
       ORDER BY submitted_at DESC
       LIMIT 20`);
    return result.rows.map(row => ({
      kind: 'trial',
      reference: trialReference(row.token_hash),
      submissionId: null,
      clientName: 'Test Client',
      formTitle: String(row.form_title || 'Consultation form'),
      templateKey: '',
      appointmentId: null,
      appointmentStartsAt: null,
      submittedAt: row.submitted_at || null,
      signedAt: row.submitted_at || null,
      status: 'completed',
      services: ['Private form test'],
      practitioners: [],
      isTest: true,
      canOpen: true,
    }));
  }

  async function listSubmissions({ adminId } = {}) {
    const authority = await formsService.requireAccess(adminId);
    const [real, trials] = await Promise.all([
      listRealSubmissions(authority),
      listTrialSubmissions(authority),
    ]);
    const items = [...real, ...trials].sort((a, b) => {
      const left = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
      const right = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
      return right - left;
    }).slice(0, 50);
    return {
      authority,
      canReadSensitive: canReadSensitiveSubmission(authority),
      items,
      counts: {
        total: items.length,
        real: real.length,
        test: trials.length,
      },
    };
  }

  async function realSubmissionRow(authority, submissionId) {
    const id = normalizeSubmissionId(submissionId);
    const scope = scopeSql(authority, 2);
    const result = await db.query(`/* workspaceFormSubmissions:real-detail */
      SELECT sub.id,sub.payload_ciphertext,sub.payload_iv,sub.payload_auth_tag,
             sub.template_snapshot,sub.consent_text_snapshot,sub.signature_method,
             sub.signed_at,sub.submitted_at,
             a.status AS assignment_status,a.appointment_id,
             ap.starts_at,ap.ends_at,
             t.template_key,t.title AS form_title,
             COALESCE(v2.name,c.display_name,ap.source_client_name,'Client') AS client_name,
             COALESCE((
               SELECT jsonb_agg(s.service_name_snapshot ORDER BY s.position,s.id)
                 FROM appointment_services s WHERE s.appointment_id=ap.id
             ),'[]'::jsonb) AS services,
             COALESCE((
               SELECT jsonb_agg(st.staff_name_snapshot ORDER BY st.position,st.id)
                 FROM appointment_staff st WHERE st.appointment_id=ap.id
             ),'[]'::jsonb) AS practitioners
        FROM consultation_form_submissions sub
        JOIN consultation_form_assignments a ON a.id=sub.assignment_id
        JOIN appointments ap ON ap.id=a.appointment_id
        JOIN consultation_form_template_versions tv ON tv.id=sub.template_version_id
        JOIN consultation_form_templates t ON t.id=tv.template_id
        LEFT JOIN clients c ON c.id=a.client_id
        LEFT JOIN crm_v2_clients v2 ON v2.id=a.crm_v2_client_id
       WHERE sub.id=$1${scope.sql}
       LIMIT 1`, [id, ...scope.values]);
    const row = result.rows[0];
    if (!row) throw new WorkspaceFormSubmissionError('WORKSPACE_FORM_SUBMISSION_NOT_FOUND', 'That form submission was not found.', 404);
    return row;
  }

  function decryptRow(row) {
    let payload;
    try {
      payload = decrypt({
        ciphertext: String(row.payload_ciphertext || ''),
        iv: String(row.payload_iv || ''),
        authTag: String(row.payload_auth_tag || ''),
      }, { env });
    } catch (_error) {
      throw new WorkspaceFormSubmissionError('WORKSPACE_FORM_SUBMISSION_DECRYPT_FAILED', 'This form submission is temporarily unavailable.', 503);
    }
    if (!payload || Number(payload.schemaVersion) !== 1 || !payload.answers || typeof payload.answers !== 'object') {
      throw new WorkspaceFormSubmissionError('WORKSPACE_FORM_SUBMISSION_PAYLOAD_INVALID', 'This form submission is temporarily unavailable.', 503);
    }
    return payload;
  }

  function detailModel(authority, row, payload, { isTest = false, reference } = {}) {
    const snapshot = safeSnapshot(row.template_snapshot);
    return {
      authority,
      kind: isTest ? 'trial' : 'client',
      reference,
      isTest,
      clientName: isTest ? 'Test Client' : String(row.client_name || 'Client'),
      form: {
        ...snapshot,
        title: String(snapshot.title || row.form_title || 'Consultation form'),
        consentText: String(row.consent_text_snapshot || ''),
      },
      answers: safeSnapshot(payload.answers),
      signature: safeSnapshot(payload.signature),
      signedAt: row.signed_at || payload.signedAt || row.submitted_at || null,
      submittedAt: row.submitted_at || null,
      status: isTest ? 'completed' : String(row.assignment_status || 'completed'),
      appointment: isTest ? null : {
        id: positiveId(row.appointment_id),
        startsAt: row.starts_at || null,
        endsAt: row.ends_at || null,
        services: arrayValue(row.services),
        practitioners: arrayValue(row.practitioners),
      },
    };
  }

  async function getRealSubmission({ adminId, submissionId } = {}) {
    const authority = await formsService.requireAccess(adminId);
    if (!canReadSensitiveSubmission(authority)) {
      throw new WorkspaceFormSubmissionError('WORKSPACE_FORM_SUBMISSION_FORBIDDEN', 'Your Workspace access can see form status but not private health answers.', 403);
    }
    const row = await realSubmissionRow(authority, submissionId);
    const payload = decryptRow(row);
    return detailModel(authority, row, payload, { reference: String(row.id) });
  }

  async function getTrialSubmission({ adminId, reference } = {}) {
    const authority = await formsService.requireAccess(adminId);
    if (!canReadTrialSubmission(authority)) {
      throw new WorkspaceFormSubmissionError('WORKSPACE_FORM_SUBMISSION_FORBIDDEN', 'Your Workspace access does not permit private test submissions.', 403);
    }
    const normalized = normalizeTrialReference(reference);
    const result = await db.query(`/* workspaceFormSubmissions:trial-detail */
      SELECT token_hash,template_snapshot,consent_text_snapshot,
             payload_ciphertext,payload_iv,payload_auth_tag,submitted_at
        FROM consultation_form_trials
       WHERE submitted_at IS NOT NULL
       ORDER BY submitted_at DESC
       LIMIT 50`);
    const row = result.rows.find(item => trialReference(item.token_hash) === normalized);
    if (!row) throw new WorkspaceFormSubmissionError('WORKSPACE_FORM_SUBMISSION_NOT_FOUND', 'That test submission was not found.', 404);
    const payload = decryptRow({ ...row, signed_at: row.submitted_at });
    return detailModel(authority, {
      ...row,
      form_title: safeSnapshot(row.template_snapshot).title,
      signed_at: row.submitted_at,
    }, payload, { isTest: true, reference: normalized });
  }

  async function getSubmission({ adminId, kind, reference } = {}) {
    if (kind === 'client') return getRealSubmission({ adminId, submissionId: reference });
    if (kind === 'trial') return getTrialSubmission({ adminId, reference });
    throw new WorkspaceFormSubmissionError('WORKSPACE_FORM_SUBMISSION_NOT_FOUND', 'That form submission was not found.', 404);
  }

  return {
    listSubmissions,
    getSubmission,
    getRealSubmission,
    getTrialSubmission,
  };
}

const service = createWorkspaceFormSubmissionsService();

module.exports = {
  WorkspaceFormSubmissionError,
  positiveId,
  canReadSensitiveSubmission,
  canReadTrialSubmission,
  normalizeSubmissionId,
  trialReference,
  normalizeTrialReference,
  createWorkspaceFormSubmissionsService,
  ...service,
};
