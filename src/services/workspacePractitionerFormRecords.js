const { pool } = require('../db/pool');
const workspaceForms = require('./workspaceForms');
const {
  encryptSubmissionPayload,
  decryptSubmissionPayload,
} = require('./clientConsultationForms');

const CLINICAL_MANAGE_CAPABILITY = 'forms:clinical_manage';
const SPORTS_TEMPLATE_KEY = 'remedial_sports_massage_consultation';
const MAX_POSTURAL_ROWS = 12;
const MAX_PAIN_CONCERNS = 12;
const MAX_TECHNIQUES = 12;

const BODY_REGIONS = Object.freeze([
  'Head / face',
  'Neck',
  'Left shoulder',
  'Right shoulder',
  'Chest',
  'Abdomen',
  'Upper back',
  'Mid back',
  'Lower back',
  'Left arm',
  'Right arm',
  'Left hip / glute',
  'Right hip / glute',
  'Left thigh',
  'Right thigh',
  'Left knee',
  'Right knee',
  'Left calf',
  'Right calf',
  'Left ankle / foot',
  'Right ankle / foot',
]);

class WorkspacePractitionerFormRecordError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = 'WorkspacePractitionerFormRecordError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function normalizeText(value, maxLength) {
  const text = String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim();
  if (text.length > maxLength) {
    throw new WorkspacePractitionerFormRecordError('WORKSPACE_PRACTITIONER_RECORD_TOO_LONG', 'One of the practitioner record fields is too long.', 422);
  }
  return text;
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeArray(value, maxRows, normalizer) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maxRows) {
    throw new WorkspacePractitionerFormRecordError('WORKSPACE_PRACTITIONER_RECORD_INVALID', 'Please check the practitioner assessment and try again.', 422);
  }
  return value.map(normalizer).filter(Boolean);
}

function normalizePosturalRows(value) {
  return normalizeArray(value, MAX_POSTURAL_ROWS, row => {
    const item = plainObject(row);
    const area = normalizeText(item.area, 120);
    const muscleState = normalizeText(item.muscleState, 160);
    const notes = normalizeText(item.notes, 1000);
    if (!area && !muscleState && !notes) return null;
    return { area, muscleState, notes };
  });
}

function normalizePainMap(value) {
  return normalizeArray(value, BODY_REGIONS.length, row => {
    const item = plainObject(row);
    const area = normalizeText(item.area, 80);
    const state = normalizeText(item.state, 20).toLowerCase();
    if (!area && !state) return null;
    if (!BODY_REGIONS.includes(area) || !['primary', 'secondary'].includes(state)) {
      throw new WorkspacePractitionerFormRecordError('WORKSPACE_PRACTITIONER_RECORD_INVALID_BODY_MAP', 'Please check the body map and try again.', 422);
    }
    return { area, state };
  });
}

function normalizePainConcerns(value) {
  return normalizeArray(value, MAX_PAIN_CONCERNS, row => {
    const item = plainObject(row);
    const area = normalizeText(item.area, 120);
    const description = normalizeText(item.description, 1200);
    if (!area && !description) return null;
    return { area, description };
  });
}

function normalizeTechniques(value) {
  return normalizeArray(value, MAX_TECHNIQUES, row => {
    const item = plainObject(row);
    const technique = normalizeText(item.technique, 160);
    const reason = normalizeText(item.reason, 1200);
    if (!technique && !reason) return null;
    return { technique, reason };
  });
}

function normalizePractitionerRecordPayload(value = {}) {
  const body = plainObject(value);
  const allowed = new Set([
    'revision',
    'posturalAnalysis',
    'painMap',
    'painConcerns',
    'techniques',
    'lifestyleRecommendations',
    'practitionerNotes',
  ]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw new WorkspacePractitionerFormRecordError('WORKSPACE_PRACTITIONER_RECORD_UNEXPECTED_FIELD', 'Please reload the practitioner assessment and try again.', 422);
    }
  }
  const revision = Number(body.revision ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new WorkspacePractitionerFormRecordError('WORKSPACE_PRACTITIONER_RECORD_INVALID_REVISION', 'This practitioner assessment is out of date. Reload it and try again.', 409);
  }
  return {
    revision,
    record: {
      schemaVersion: 1,
      posturalAnalysis: normalizePosturalRows(body.posturalAnalysis),
      painMap: normalizePainMap(body.painMap),
      painConcerns: normalizePainConcerns(body.painConcerns),
      techniques: normalizeTechniques(body.techniques),
      lifestyleRecommendations: normalizeText(body.lifestyleRecommendations, 5000),
      practitionerNotes: normalizeText(body.practitionerNotes, 10000),
    },
  };
}

function blankRecord() {
  return {
    schemaVersion: 1,
    posturalAnalysis: [],
    painMap: [],
    painConcerns: [],
    techniques: [],
    lifestyleRecommendations: '',
    practitionerNotes: '',
  };
}

function canReadClinicalRecord(authority = {}) {
  const role = String(authority.businessRole || '').trim().toLowerCase();
  return role === 'owner' || role === 'business_admin' || authority.formScope === 'own_staff';
}

function scopeSql(authority, parameterIndex) {
  if (authority.formScope !== 'own_staff') return { sql: '', values: [] };
  return {
    sql: ` AND EXISTS (
      SELECT 1 FROM appointment_staff scope_staff
       WHERE scope_staff.appointment_id=a.appointment_id
         AND scope_staff.staff_id=$${parameterIndex}
    )`,
    values: [authority.linkedStaffId],
  };
}

function createWorkspacePractitionerFormRecordService({
  db = pool,
  env = process.env,
  formsService = workspaceForms,
  encrypt = encryptSubmissionPayload,
  decrypt = decryptSubmissionPayload,
} = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('Workspace practitioner form record database is required');

  async function withTransaction(task) {
    const client = typeof db.connect === 'function' ? await db.connect() : db;
    const release = typeof client.release === 'function' ? () => client.release() : () => {};
    try {
      await client.query('BEGIN');
      const result = await task(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_rollbackError) {}
      throw error;
    } finally {
      release();
    }
  }

  async function hasClinicalManageCapability(adminId, queryable = db) {
    const id = positiveId(adminId);
    if (!id) return false;
    const result = await queryable.query(`/* workspacePractitionerFormRecords:capability */
      SELECT permissions
        FROM staff_admin_accounts
       WHERE id=$1 AND active=TRUE
       LIMIT 2`, [id]);
    return result.rows.length === 1
      && plainObject(result.rows[0].permissions)[CLINICAL_MANAGE_CAPABILITY] === true;
  }

  async function targetRow(authority, submissionId, queryable = db, { lock = false } = {}) {
    const id = positiveId(submissionId);
    if (!id) throw new WorkspacePractitionerFormRecordError('WORKSPACE_PRACTITIONER_RECORD_NOT_FOUND', 'That practitioner assessment was not found.', 404);
    const scope = scopeSql(authority, 2);
    const result = await queryable.query(`/* workspacePractitionerFormRecords:target */
      SELECT sub.id AS submission_id,sub.assignment_id,a.appointment_id,
             ap.starts_at,ap.ends_at,
             t.template_key,t.title AS form_title,
             COALESCE(v2.name,c.display_name,ap.source_client_name,'Client') AS client_name,
             COALESCE((SELECT jsonb_agg(s.service_name_snapshot ORDER BY s.position,s.id)
                         FROM appointment_services s WHERE s.appointment_id=ap.id),'[]'::jsonb) AS services,
             COALESCE((SELECT jsonb_agg(st.staff_name_snapshot ORDER BY st.position,st.id)
                         FROM appointment_staff st WHERE st.appointment_id=ap.id),'[]'::jsonb) AS practitioners,
             r.payload_ciphertext,r.payload_iv,r.payload_auth_tag,r.revision,
             r.created_at AS record_created_at,r.updated_at AS record_updated_at
        FROM consultation_form_submissions sub
        JOIN consultation_form_assignments a ON a.id=sub.assignment_id
        JOIN appointments ap ON ap.id=a.appointment_id
        JOIN consultation_form_template_versions tv ON tv.id=sub.template_version_id
        JOIN consultation_form_templates t ON t.id=tv.template_id
        LEFT JOIN clients c ON c.id=a.client_id
        LEFT JOIN crm_v2_clients v2 ON v2.id=a.crm_v2_client_id
        LEFT JOIN consultation_form_practitioner_records r ON r.assignment_id=a.id
       WHERE sub.id=$1
         AND t.template_key='${SPORTS_TEMPLATE_KEY}'${scope.sql}
       LIMIT 1${lock ? ' FOR UPDATE OF a' : ''}`,
      [id, ...scope.values]
    );
    const row = result.rows[0];
    if (!row) throw new WorkspacePractitionerFormRecordError('WORKSPACE_PRACTITIONER_RECORD_NOT_FOUND', 'That practitioner assessment was not found.', 404);
    return row;
  }

  function decodeRecord(row) {
    if (!row.payload_ciphertext) return { revision: 0, record: blankRecord() };
    let value;
    try {
      value = decrypt({
        ciphertext: String(row.payload_ciphertext || ''),
        iv: String(row.payload_iv || ''),
        authTag: String(row.payload_auth_tag || ''),
      }, { env });
    } catch (_error) {
      throw new WorkspacePractitionerFormRecordError('WORKSPACE_PRACTITIONER_RECORD_DECRYPT_FAILED', 'This practitioner assessment is temporarily unavailable.', 503);
    }
    if (!value || Number(value.schemaVersion) !== 1) {
      throw new WorkspacePractitionerFormRecordError('WORKSPACE_PRACTITIONER_RECORD_INVALID', 'This practitioner assessment is temporarily unavailable.', 503);
    }
    return { revision: Number(row.revision || 0), record: value };
  }

  async function audit(queryable, authority, action, row, revision) {
    await queryable.query(`/* workspacePractitionerFormRecords:audit */
      INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
      VALUES($1,$2,'consultation_form_assignment',$3,$4::jsonb)`, [
      authority.operatorAdminId,
      action,
      positiveId(row.assignment_id),
      JSON.stringify({
        appointmentId: positiveId(row.appointment_id),
        submissionId: positiveId(row.submission_id),
        templateKey: SPORTS_TEMPLATE_KEY,
        revision: Number(revision || 0),
      }),
    ]);
  }

  function model(authority, row, decoded, canEdit) {
    return {
      authority,
      submissionId: positiveId(row.submission_id),
      assignmentId: positiveId(row.assignment_id),
      clientName: String(row.client_name || 'Client'),
      formTitle: String(row.form_title || 'Remedial & Sports Massage Consultation'),
      appointment: {
        id: positiveId(row.appointment_id),
        startsAt: row.starts_at || null,
        endsAt: row.ends_at || null,
        services: Array.isArray(row.services) ? row.services.map(String) : [],
        practitioners: Array.isArray(row.practitioners) ? row.practitioners.map(String) : [],
      },
      revision: decoded.revision,
      record: decoded.record,
      canEdit,
      bodyRegions: [...BODY_REGIONS],
      updatedAt: row.record_updated_at || null,
    };
  }

  async function getRecord({ adminId, submissionId } = {}) {
    const authority = await formsService.requireAccess(adminId);
    if (!canReadClinicalRecord(authority)) {
      throw new WorkspacePractitionerFormRecordError('WORKSPACE_PRACTITIONER_RECORD_FORBIDDEN', 'Your Workspace access does not permit practitioner assessment records.', 403);
    }
    const row = await targetRow(authority, submissionId);
    const decoded = decodeRecord(row);
    const canEdit = await hasClinicalManageCapability(authority.operatorAdminId);
    await audit(db, authority, 'workspace.form_practitioner_record_viewed', row, decoded.revision);
    return model(authority, row, decoded, canEdit);
  }

  async function saveRecord({ adminId, submissionId, body } = {}) {
    const normalized = normalizePractitionerRecordPayload(body);
    return withTransaction(async client => {
      const authority = await formsService.requireAccess(adminId, client);
      if (!canReadClinicalRecord(authority) || !(await hasClinicalManageCapability(authority.operatorAdminId, client))) {
        throw new WorkspacePractitionerFormRecordError('WORKSPACE_PRACTITIONER_RECORD_FORBIDDEN', 'Your Workspace access does not permit editing practitioner assessment records.', 403);
      }
      const row = await targetRow(authority, submissionId, client, { lock: true });
      const currentRevision = Number(row.revision || 0);
      if (normalized.revision !== currentRevision) {
        throw new WorkspacePractitionerFormRecordError('WORKSPACE_PRACTITIONER_RECORD_STALE', 'This practitioner assessment changed since you opened it. Reload and try again.', 409);
      }
      const envelope = encrypt(normalized.record, { env });
      let revision;
      if (currentRevision === 0) {
        const inserted = await client.query(`/* workspacePractitionerFormRecords:insert */
          INSERT INTO consultation_form_practitioner_records(
            assignment_id,payload_schema_version,payload_ciphertext,payload_iv,payload_auth_tag,
            revision,created_by_admin_id,updated_by_admin_id
          ) VALUES($1,1,$2,$3,$4,1,$5,$5)
          RETURNING revision,updated_at`, [
          row.assignment_id,
          envelope.ciphertext,
          envelope.iv,
          envelope.authTag,
          authority.operatorAdminId,
        ]);
        revision = Number(inserted.rows[0]?.revision || 1);
      } else {
        const updated = await client.query(`/* workspacePractitionerFormRecords:update */
          UPDATE consultation_form_practitioner_records
             SET payload_schema_version=1,
                 payload_ciphertext=$2,payload_iv=$3,payload_auth_tag=$4,
                 revision=revision+1,updated_by_admin_id=$5,updated_at=NOW()
           WHERE assignment_id=$1 AND revision=$6
           RETURNING revision,updated_at`, [
          row.assignment_id,
          envelope.ciphertext,
          envelope.iv,
          envelope.authTag,
          authority.operatorAdminId,
          currentRevision,
        ]);
        if (updated.rows.length !== 1) {
          throw new WorkspacePractitionerFormRecordError('WORKSPACE_PRACTITIONER_RECORD_STALE', 'This practitioner assessment changed since you opened it. Reload and try again.', 409);
        }
        revision = Number(updated.rows[0].revision);
      }
      await audit(client, authority, 'workspace.form_practitioner_record_saved', row, revision);
      return { ok: true, revision };
    });
  }

  return {
    getRecord,
    saveRecord,
    hasClinicalManageCapability,
  };
}

const service = createWorkspacePractitionerFormRecordService();

module.exports = {
  CLINICAL_MANAGE_CAPABILITY,
  SPORTS_TEMPLATE_KEY,
  BODY_REGIONS,
  WorkspacePractitionerFormRecordError,
  positiveId,
  normalizePractitionerRecordPayload,
  blankRecord,
  canReadClinicalRecord,
  createWorkspacePractitionerFormRecordService,
  ...service,
};
