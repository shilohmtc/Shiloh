const { pool } = require('../db/pool');

const FORMS_VIEW_CAPABILITY = 'forms:view';
const FORM_STATUSES = Object.freeze(['not_sent', 'sent', 'opened', 'completed', 'needs_review']);

class WorkspaceFormsError extends Error {
  constructor(code, message, httpStatus) {
    super(message);
    this.name = 'WorkspaceFormsError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function permissionSet(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function templateKey(value) {
  const key = String(value || '').trim();
  if (!/^[a-z0-9][a-z0-9_]{1,79}$/.test(key)) {
    throw new WorkspaceFormsError('WORKSPACE_FORM_NOT_FOUND', 'That form was not found.', 404);
  }
  return key;
}

function evaluateFormsReadAuthority(rows = []) {
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row = rows[0];
  const adminId = positiveId(row.id);
  if (!adminId || row.admin_active !== true) return null;
  if (permissionSet(row.permissions)[FORMS_VIEW_CAPABILITY] !== true) return null;
  const linkedStaffId = positiveId(row.staff_id);
  if (row.staff_id != null && (row.staff_status !== 'active' || !linkedStaffId)) return null;

  const businessRole = String(row.business_role || '').trim().toLowerCase();
  const calendarScope = String(row.calendar_scope || '').trim().toLowerCase();
  const formScope = ['owner', 'business_admin', 'booking_operator'].includes(businessRole)
    ? 'all_business'
    : linkedStaffId && calendarScope === 'own_appointments'
      ? 'own_staff'
      : null;
  if (!formScope) return null;

  return {
    key: 'workspace_forms_view_v1',
    operatorAdminId: adminId,
    displayName: String(row.display_name || 'Staff').trim() || 'Staff',
    linkedStaffId,
    businessRole,
    formScope,
    capability: FORMS_VIEW_CAPABILITY,
  };
}

function emptyStatusCounts() {
  return Object.fromEntries(FORM_STATUSES.map(status => [status, 0]));
}

function normalizeStatusCounts(rows = []) {
  const counts = emptyStatusCounts();
  for (const row of rows) {
    const status = String(row.status || '');
    if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] = Number(row.count || 0);
  }
  return counts;
}

function createWorkspaceFormsService({ db = pool } = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('Workspace Forms database is required');

  async function principalRows(adminId, queryable = db) {
    const id = positiveId(adminId);
    if (!id) return [];
    const result = await queryable.query(
      `/* workspaceForms:principal */
       SELECT a.id,a.staff_id,a.display_name,a.permissions,a.business_role,a.calendar_scope,
              a.active AS admin_active,s.status AS staff_status
         FROM staff_admin_accounts a
         LEFT JOIN staff s ON s.id=a.staff_id
        WHERE a.id=$1 AND a.active=TRUE
        LIMIT 2`,
      [id]
    );
    return result.rows;
  }

  async function resolveAccess(adminId, queryable = db) {
    return evaluateFormsReadAuthority(await principalRows(adminId, queryable));
  }

  async function requireAccess(adminId, queryable = db) {
    const authority = await resolveAccess(adminId, queryable);
    if (!authority) {
      throw new WorkspaceFormsError('WORKSPACE_FORMS_FORBIDDEN', 'Current staff access does not permit Forms.', 403);
    }
    return authority;
  }

  async function listTemplates() {
    const result = await db.query(`/* workspaceForms:templates */
      WITH section_counts AS (
        SELECT sv.id AS section_version_id,
               COALESCE(SUM(
                 jsonb_array_length(COALESCE(g.value->'fields','[]'::jsonb))
                 + jsonb_array_length(COALESCE(g.value->'questions','[]'::jsonb))
               ),0)::int AS item_count
          FROM consultation_form_section_versions sv
          LEFT JOIN LATERAL jsonb_array_elements(COALESCE(sv.definition->'groups','[]'::jsonb)) g(value) ON TRUE
         GROUP BY sv.id
      ), template_sections AS (
        SELECT ts.template_version_id,
               jsonb_agg(jsonb_build_object(
                 'title', s.title,
                 'sectionKey', s.section_key,
                 'version', sv.version_number,
                 'itemCount', COALESCE(sc.item_count,0)
               ) ORDER BY ts.position) AS sections,
               COALESCE(SUM(sc.item_count),0)::int AS item_count
          FROM consultation_form_template_sections ts
          JOIN consultation_form_section_versions sv ON sv.id=ts.section_version_id
          JOIN consultation_form_sections s ON s.id=sv.section_id
          LEFT JOIN section_counts sc ON sc.section_version_id=sv.id
         GROUP BY ts.template_version_id
      ), service_links AS (
        SELECT m.template_version_id,
               jsonb_agg(jsonb_build_object('id',svc.id,'name',svc.name) ORDER BY LOWER(svc.name),svc.id) AS services
          FROM consultation_form_service_mappings m
          JOIN services svc ON svc.id=m.service_id
         WHERE m.required=TRUE
         GROUP BY m.template_version_id
      )
      SELECT t.id,t.template_key,t.title,t.status,
             tv.id AS template_version_id,tv.version_number,
             COALESCE(ts.sections,'[]'::jsonb) AS sections,
             COALESCE(ts.item_count,0)::int AS item_count,
             COALESCE(sl.services,'[]'::jsonb) AS services
        FROM consultation_form_templates t
        JOIN LATERAL (
          SELECT v.* FROM consultation_form_template_versions v
           WHERE v.template_id=t.id
           ORDER BY v.version_number DESC LIMIT 1
        ) tv ON TRUE
        LEFT JOIN template_sections ts ON ts.template_version_id=tv.id
        LEFT JOIN service_links sl ON sl.template_version_id=tv.id
       WHERE t.status='active'
       ORDER BY LOWER(t.title),t.id`);
    return result.rows.map(row => ({
      id: positiveId(row.id),
      templateKey: row.template_key,
      title: row.title,
      status: row.status,
      versionId: positiveId(row.template_version_id),
      version: Number(row.version_number || 0),
      sections: Array.isArray(row.sections) ? row.sections : [],
      itemCount: Number(row.item_count || 0),
      services: Array.isArray(row.services) ? row.services : [],
    }));
  }

  async function readTemplatePreview(rawTemplateKey) {
    const key = templateKey(rawTemplateKey);
    const result = await db.query(
      `/* workspaceForms:template-preview */
       SELECT t.id,t.template_key,t.title,t.status,
              tv.id AS template_version_id,tv.version_number,tv.consent_text,tv.settings,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'id',svc.id,
                  'name',svc.name
                ) ORDER BY LOWER(svc.name),svc.id)
                  FROM consultation_form_service_mappings m
                  JOIN services svc ON svc.id=m.service_id
                 WHERE m.template_version_id=tv.id AND m.required=TRUE
              ),'[]'::jsonb) AS services,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'title',s.title,
                  'sectionKey',s.section_key,
                  'version',sv.version_number,
                  'position',ts.position,
                  'definition',sv.definition
                ) ORDER BY ts.position)
                  FROM consultation_form_template_sections ts
                  JOIN consultation_form_section_versions sv ON sv.id=ts.section_version_id
                  JOIN consultation_form_sections s ON s.id=sv.section_id
                 WHERE ts.template_version_id=tv.id
              ),'[]'::jsonb) AS sections
         FROM consultation_form_templates t
         JOIN LATERAL (
           SELECT v.* FROM consultation_form_template_versions v
            WHERE v.template_id=t.id
            ORDER BY v.version_number DESC LIMIT 1
         ) tv ON TRUE
        WHERE t.status='active' AND t.template_key=$1
        LIMIT 2`,
      [key]
    );
    if (result.rows.length !== 1) {
      throw new WorkspaceFormsError('WORKSPACE_FORM_NOT_FOUND', 'That form was not found.', 404);
    }
    const row = result.rows[0];
    return {
      id: positiveId(row.id),
      templateKey: row.template_key,
      title: row.title,
      status: row.status,
      versionId: positiveId(row.template_version_id),
      version: Number(row.version_number || 0),
      consentText: String(row.consent_text || ''),
      settings: row.settings && typeof row.settings === 'object' && !Array.isArray(row.settings) ? row.settings : {},
      services: Array.isArray(row.services) ? row.services : [],
      sections: Array.isArray(row.sections) ? row.sections : [],
    };
  }

  async function assignmentStatusRows(authority) {
    const values = [];
    let scope = '';
    if (authority.formScope === 'own_staff') {
      values.push(authority.linkedStaffId);
      scope = ` AND EXISTS (
        SELECT 1 FROM appointment_staff af
         WHERE af.appointment_id=a.appointment_id AND af.staff_id=$1
      )`;
    }
    const result = await db.query(
      `/* workspaceForms:assignment-status */
       SELECT a.status,COUNT(*)::int AS count
         FROM consultation_form_assignments a
        WHERE TRUE${scope}
        GROUP BY a.status`,
      values
    );
    return result.rows;
  }

  async function listForms({ adminId } = {}) {
    const authority = await requireAccess(adminId);
    const [templates, statuses] = await Promise.all([
      listTemplates(),
      assignmentStatusRows(authority),
    ]);
    return {
      authority,
      templates,
      activity: normalizeStatusCounts(statuses),
      deliveryEnabled: false,
      clientFormEnabled: false,
    };
  }

  async function getFormPreview({ adminId, templateKey: rawTemplateKey } = {}) {
    const authority = await requireAccess(adminId);
    const template = await readTemplatePreview(rawTemplateKey);
    return {
      authority,
      template,
      deliveryEnabled: false,
      clientFormEnabled: false,
    };
  }

  return {
    resolveAccess,
    requireAccess,
    listForms,
    getFormPreview,
  };
}

const service = createWorkspaceFormsService();

module.exports = {
  FORMS_VIEW_CAPABILITY,
  FORM_STATUSES,
  WorkspaceFormsError,
  positiveId,
  permissionSet,
  templateKey,
  evaluateFormsReadAuthority,
  emptyStatusCounts,
  normalizeStatusCounts,
  createWorkspaceFormsService,
  ...service,
};
