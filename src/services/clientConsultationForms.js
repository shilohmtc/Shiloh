const crypto = require('crypto');
const { pool } = require('../db/pool');

const CLIENT_FORM_FLAG = 'SHILOH_CLIENT_CONSULTATION_FORMS_ENABLED';
const CLIENT_FORM_DATA_KEY = 'CONSULTATION_FORM_DATA_KEY';
const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ALLOWED_APPOINTMENT_STATUSES = new Set(['scheduled', 'confirmed']);

class ClientConsultationFormError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = 'ClientConsultationFormError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function isClientConsultationFormsEnabled(env = process.env) {
  return String(env[CLIENT_FORM_FLAG] || '').trim().toLowerCase() === 'true';
}

function normalizeAccessToken(value) {
  const token = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new ClientConsultationFormError('CONSULTATION_FORM_LINK_INVALID', 'This consultation form link is not available.', 404);
  }
  return token;
}

function hashAccessToken(value) {
  const token = normalizeAccessToken(value);
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function parseDataKey(env = process.env) {
  const encoded = String(env[CLIENT_FORM_DATA_KEY] || '').trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(encoded)) {
    throw new ClientConsultationFormError('CONSULTATION_FORM_DATA_KEY_UNAVAILABLE', 'Consultation form submission is temporarily unavailable.', 503);
  }
  const key = Buffer.from(encoded, 'base64url');
  if (key.length !== 32) {
    throw new ClientConsultationFormError('CONSULTATION_FORM_DATA_KEY_INVALID', 'Consultation form submission is temporarily unavailable.', 503);
  }
  return key;
}

function encryptSubmissionPayload(payload, { env = process.env, randomBytes = crypto.randomBytes } = {}) {
  const key = parseDataKey(env);
  const iv = randomBytes(12);
  if (!Buffer.isBuffer(iv) || iv.length !== 12) throw new Error('Consultation form encryption IV must be 12 bytes');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    authTag: authTag.toString('base64url'),
  };
}

function decryptSubmissionPayload(record, { env = process.env } = {}) {
  const key = parseDataKey(env);
  const iv = Buffer.from(String(record?.iv || ''), 'base64url');
  const authTag = Buffer.from(String(record?.authTag || ''), 'base64url');
  const ciphertext = Buffer.from(String(record?.ciphertext || ''), 'base64url');
  if (iv.length !== 12 || authTag.length !== 16 || !ciphertext.length) throw new Error('Invalid consultation form ciphertext envelope');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
}

function splitDisplayName(value) {
  const tokens = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { firstName: '', surname: '' };
  if (tokens.length === 1) return { firstName: tokens[0], surname: '' };
  return { firstName: tokens[0], surname: tokens.slice(1).join(' ') };
}

function displayMobile(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  if (/^27[678][0-9]{8}$/.test(digits)) return `+${digits}`;
  return String(value || '').trim();
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildPrefill(client = {}) {
  const name = splitDisplayName(client.name || client.displayName);
  return {
    first_name: name.firstName,
    surname: name.surname,
    mobile: displayMobile(client.mobile),
    email: String(client.email || '').trim(),
    date_of_birth: String(client.dateOfBirth || '').slice(0, 10),
    gender: String(client.gender || '').trim(),
  };
}

function flattenFormItems(form = {}) {
  const items = [];
  const seen = new Set();
  for (const section of form.sections || []) {
    const groups = Array.isArray(section.definition?.groups) ? section.definition.groups : [];
    for (const group of groups) {
      for (const item of [...(Array.isArray(group.fields) ? group.fields : []), ...(Array.isArray(group.questions) ? group.questions : [])]) {
        const key = String(item?.key || '').trim();
        if (!/^[a-z0-9][a-z0-9_]{0,79}$/.test(key) || seen.has(key)) {
          throw new ClientConsultationFormError('CONSULTATION_FORM_SCHEMA_INVALID', 'This consultation form is temporarily unavailable.', 503);
        }
        seen.add(key);
        items.push({ ...item, key });
        if (item?.follow_up) {
          const followKey = String(item.follow_up.key || '').trim();
          if (!/^[a-z0-9][a-z0-9_]{0,79}$/.test(followKey) || seen.has(followKey)) {
            throw new ClientConsultationFormError('CONSULTATION_FORM_SCHEMA_INVALID', 'This consultation form is temporarily unavailable.', 503);
          }
          seen.add(followKey);
        }
      }
    }
  }
  return items;
}

function oneString(body, key) {
  const value = body?.[key];
  if (Array.isArray(value) || (value != null && typeof value === 'object')) {
    throw new ClientConsultationFormError('CONSULTATION_FORM_INVALID_RESPONSE', 'Please check the highlighted form answers.', 422);
  }
  return value == null ? '' : String(value);
}

function normalizeText(value, maxLength) {
  const normalized = String(value || '').replace(/\r\n?/g, '\n').trim();
  if (normalized.length > maxLength) {
    throw new ClientConsultationFormError('CONSULTATION_FORM_RESPONSE_TOO_LONG', 'One of your answers is too long. Please shorten it and try again.', 422);
  }
  return normalized;
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new ClientConsultationFormError('CONSULTATION_FORM_DATE_INVALID', 'Please enter a valid date.', 422);
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text || text < '1900-01-01' || text > new Date().toISOString().slice(0, 10)) {
    throw new ClientConsultationFormError('CONSULTATION_FORM_DATE_INVALID', 'Please enter a valid date.', 422);
  }
  return text;
}

function validateSubmissionBody(form, body = {}) {
  const items = flattenFormItems(form);
  const allowed = new Set(['consent_acknowledged', 'signature_name', 'signature_confirm']);
  for (const item of items) {
    allowed.add(item.key);
    if (item.follow_up?.key) allowed.add(String(item.follow_up.key));
  }
  for (const key of Object.keys(body || {})) {
    if (!allowed.has(key)) {
      throw new ClientConsultationFormError('CONSULTATION_FORM_UNEXPECTED_FIELD', 'Please reload the form and try again.', 422);
    }
  }

  const answers = {};
  const errors = {};
  for (const item of items) {
    const raw = oneString(body, item.key);
    const type = String(item.type || 'text');
    try {
      let value;
      if (type === 'yes_no') {
        value = raw.trim().toLowerCase();
        if (value && !['yes', 'no'].includes(value)) throw new ClientConsultationFormError('CONSULTATION_FORM_YES_NO_INVALID', 'Please choose Yes or No.', 422);
      } else if (type === 'date' || type === 'prefill_date') {
        value = normalizeDate(raw);
      } else {
        value = normalizeText(raw, type === 'textarea' ? 4000 : 500);
        if (item.key === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          throw new ClientConsultationFormError('CONSULTATION_FORM_EMAIL_INVALID', 'Please enter a valid email address.', 422);
        }
      }
      if (item.required === true && !value) throw new ClientConsultationFormError('CONSULTATION_FORM_REQUIRED', 'This answer is required.', 422);
      answers[item.key] = value;

      if (item.follow_up?.key) {
        const followKey = String(item.follow_up.key);
        const followRaw = oneString(body, followKey);
        const followValue = normalizeText(followRaw, String(item.follow_up.type || '') === 'textarea' ? 4000 : 1000);
        if (value === 'yes' && !followValue) {
          errors[followKey] = 'Please add the requested details.';
        }
        if (value === 'yes' || followValue) answers[followKey] = followValue;
      }
    } catch (error) {
      if (error instanceof ClientConsultationFormError && error.httpStatus === 422) errors[item.key] = error.message;
      else throw error;
    }
  }

  const consentAcknowledged = oneString(body, 'consent_acknowledged') === 'yes';
  const signatureConfirmed = oneString(body, 'signature_confirm') === 'yes';
  const signatureName = normalizeText(oneString(body, 'signature_name'), 120);
  if (!consentAcknowledged) errors.consent_acknowledged = 'Please confirm the consultation declaration.';
  if (!signatureConfirmed) errors.signature_confirm = 'Please confirm that your typed name is your electronic signature.';
  if (signatureName.length < 2) errors.signature_name = 'Please type your full name as your signature.';

  if (Object.keys(errors).length) {
    const error = new ClientConsultationFormError('CONSULTATION_FORM_VALIDATION_FAILED', 'Please check the highlighted form answers.', 422);
    error.fieldErrors = errors;
    error.values = Object.fromEntries([...allowed].map(key => [key, oneString(body, key)]));
    throw error;
  }

  return {
    answers,
    signatureName,
    consentAcknowledged,
    signatureConfirmed,
  };
}

function templateSnapshot(form = {}) {
  return {
    schemaVersion: 1,
    templateKey: String(form.templateKey || ''),
    title: String(form.title || ''),
    version: Number(form.version || 0),
    sections: (form.sections || []).map(section => ({
      sectionKey: String(section.sectionKey || ''),
      title: String(section.title || ''),
      version: Number(section.version || 0),
      definition: plainObject(section.definition),
    })),
    settings: plainObject(form.settings),
  };
}

async function withTransaction(db, task) {
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

function createClientConsultationFormsService({
  db = pool,
  env = process.env,
  now = () => new Date(),
  randomBytes = crypto.randomBytes,
  tokenTtlMs = TOKEN_TTL_MS,
} = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('Client consultation form database is required');
  if (!Number.isFinite(tokenTtlMs) || tokenTtlMs <= 0 || tokenTtlMs > MAX_TOKEN_TTL_MS) throw new Error('Client consultation form token TTL is invalid');

  async function assignmentRowByHash(tokenHash, queryable = db, { lock = false } = {}) {
    const result = await queryable.query(
      `/* clientConsultationForms:assignment */
       SELECT a.id AS assignment_id,a.appointment_id,a.template_version_id,
              a.client_id,a.crm_v2_client_id,a.status AS assignment_status,
              a.access_expires_at,a.opened_at,a.completed_at,
              ap.client_id AS appointment_client_id,
              ap.crm_v2_client_id AS appointment_crm_v2_client_id,
              ap.starts_at,ap.ends_at,ap.status AS appointment_status,
              t.template_key,t.title AS template_title,t.status AS template_status,
              tv.version_number,tv.consent_text,tv.settings
         FROM consultation_form_assignments a
         JOIN appointments ap ON ap.id=a.appointment_id
         JOIN consultation_form_template_versions tv ON tv.id=a.template_version_id
         JOIN consultation_form_templates t ON t.id=tv.template_id
        WHERE a.access_token_hash=$1
        LIMIT 2${lock ? ' FOR UPDATE OF a' : ''}`,
      [tokenHash]
    );
    if (result.rows.length !== 1) return null;
    return result.rows[0];
  }

  function validateAssignment(row, { allowCompleted = true } = {}) {
    if (!row || row.template_status !== 'active') throw new ClientConsultationFormError('CONSULTATION_FORM_LINK_UNAVAILABLE', 'This consultation form link is not available.', 404);
    const assignmentId = positiveId(row.assignment_id);
    const appointmentId = positiveId(row.appointment_id);
    const versionId = positiveId(row.template_version_id);
    if (!assignmentId || !appointmentId || !versionId) throw new ClientConsultationFormError('CONSULTATION_FORM_LINK_UNAVAILABLE', 'This consultation form link is not available.', 404);
    const sameLegacy = positiveId(row.client_id) && positiveId(row.client_id) === positiveId(row.appointment_client_id) && !row.crm_v2_client_id && !row.appointment_crm_v2_client_id;
    const sameV2 = positiveId(row.crm_v2_client_id) && positiveId(row.crm_v2_client_id) === positiveId(row.appointment_crm_v2_client_id) && !row.client_id && !row.appointment_client_id;
    if (!sameLegacy && !sameV2) throw new ClientConsultationFormError('CONSULTATION_FORM_IDENTITY_DRIFT', 'This consultation form link is not available.', 404);
    const expiresAt = row.access_expires_at ? new Date(row.access_expires_at) : null;
    if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now().getTime()) {
      throw new ClientConsultationFormError('CONSULTATION_FORM_LINK_EXPIRED', 'This consultation form link has expired.', 410);
    }
    const completed = String(row.assignment_status || '') === 'completed';
    if (completed && !allowCompleted) throw new ClientConsultationFormError('CONSULTATION_FORM_ALREADY_COMPLETED', 'This consultation form has already been completed.', 409);
    if (!completed && !ALLOWED_APPOINTMENT_STATUSES.has(String(row.appointment_status || ''))) {
      throw new ClientConsultationFormError('CONSULTATION_FORM_APPOINTMENT_CLOSED', 'This consultation form link is no longer available.', 410);
    }
    return { assignmentId, appointmentId, versionId, completed };
  }

  async function loadFormVersion(row, queryable = db) {
    const versionId = positiveId(row.template_version_id);
    const sectionsResult = await queryable.query(
      `/* clientConsultationForms:sections */
       SELECT s.section_key,s.title,sv.version_number,sv.definition,ts.position
         FROM consultation_form_template_sections ts
         JOIN consultation_form_section_versions sv ON sv.id=ts.section_version_id
         JOIN consultation_form_sections s ON s.id=sv.section_id
        WHERE ts.template_version_id=$1
        ORDER BY ts.position`,
      [versionId]
    );
    return {
      templateKey: String(row.template_key || ''),
      title: String(row.template_title || ''),
      versionId,
      version: Number(row.version_number || 0),
      consentText: String(row.consent_text || ''),
      settings: plainObject(row.settings),
      sections: sectionsResult.rows.map(section => ({
        sectionKey: String(section.section_key || ''),
        title: String(section.title || ''),
        version: Number(section.version_number || 0),
        position: Number(section.position || 0),
        definition: plainObject(section.definition),
      })),
    };
  }

  async function loadClient(row, queryable = db) {
    if (positiveId(row.crm_v2_client_id)) {
      const result = await queryable.query(
        `/* clientConsultationForms:crm-v2-client */
         SELECT name,normalized_mobile,date_of_birth::text,gender
           FROM crm_v2_clients
          WHERE id=$1 AND status='active'
          LIMIT 1`,
        [positiveId(row.crm_v2_client_id)]
      );
      const client = result.rows[0];
      if (!client) throw new ClientConsultationFormError('CONSULTATION_FORM_CLIENT_UNAVAILABLE', 'This consultation form link is not available.', 404);
      return {
        model: 'crm_v2',
        name: String(client.name || ''),
        mobile: String(client.normalized_mobile || ''),
        email: '',
        dateOfBirth: String(client.date_of_birth || ''),
        gender: String(client.gender || ''),
      };
    }

    const clientId = positiveId(row.client_id);
    const result = await queryable.query(
      `/* clientConsultationForms:legacy-client */
       SELECT c.display_name,c.status,
              (SELECT cc.value FROM client_contacts cc
                WHERE cc.client_id=c.id AND cc.contact_type IN ('whatsapp','mobile')
                ORDER BY cc.is_primary DESC,cc.id LIMIT 1) AS mobile,
              (SELECT cc.value FROM client_contacts cc
                WHERE cc.client_id=c.id AND cc.contact_type='email'
                ORDER BY cc.is_primary DESC,cc.id LIMIT 1) AS email
         FROM clients c
        WHERE c.id=$1 AND c.status='active'
        LIMIT 1`,
      [clientId]
    );
    const client = result.rows[0];
    if (!client) throw new ClientConsultationFormError('CONSULTATION_FORM_CLIENT_UNAVAILABLE', 'This consultation form link is not available.', 404);
    return {
      model: 'legacy',
      name: String(client.display_name || ''),
      mobile: String(client.mobile || ''),
      email: String(client.email || ''),
      dateOfBirth: '',
      gender: '',
    };
  }

  async function loadAppointmentContext(row, queryable = db) {
    const [services, staff] = await Promise.all([
      queryable.query(
        `/* clientConsultationForms:appointment-services */
         SELECT service_name_snapshot
           FROM appointment_services
          WHERE appointment_id=$1
          ORDER BY position,id`,
        [positiveId(row.appointment_id)]
      ),
      queryable.query(
        `/* clientConsultationForms:appointment-staff */
         SELECT staff_name_snapshot
           FROM appointment_staff
          WHERE appointment_id=$1
          ORDER BY position,id`,
        [positiveId(row.appointment_id)]
      ),
    ]);
    return {
      appointmentId: positiveId(row.appointment_id),
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      services: services.rows.map(item => String(item.service_name_snapshot || '')).filter(Boolean),
      practitioners: staff.rows.map(item => String(item.staff_name_snapshot || '')).filter(Boolean),
    };
  }

  async function formModelFromRow(row, queryable = db) {
    const state = validateAssignment(row, { allowCompleted: true });
    if (state.completed) return { completed: true, assignmentId: state.assignmentId };
    const [form, client, appointment] = await Promise.all([
      loadFormVersion(row, queryable),
      loadClient(row, queryable),
      loadAppointmentContext(row, queryable),
    ]);
    flattenFormItems(form);
    return {
      completed: false,
      assignmentId: state.assignmentId,
      form,
      client,
      prefill: buildPrefill(client),
      appointment,
      expiresAt: row.access_expires_at,
    };
  }

  async function openForm(accessToken) {
    const tokenHash = hashAccessToken(accessToken);
    const row = await assignmentRowByHash(tokenHash);
    if (!row) throw new ClientConsultationFormError('CONSULTATION_FORM_LINK_UNAVAILABLE', 'This consultation form link is not available.', 404);
    const model = await formModelFromRow(row);
    if (!model.completed && ['not_sent', 'sent'].includes(String(row.assignment_status || ''))) {
      await db.query(
        `/* clientConsultationForms:mark-opened */
         UPDATE consultation_form_assignments
            SET status='opened',opened_at=COALESCE(opened_at,$2),updated_at=$2
          WHERE id=$1 AND status IN ('not_sent','sent')`,
        [model.assignmentId, now()]
      );
    }
    return model;
  }

  async function issueAccessToken({ assignmentId } = {}) {
    const id = positiveId(assignmentId);
    if (!id) throw new ClientConsultationFormError('CONSULTATION_FORM_ASSIGNMENT_INVALID', 'Consultation form assignment is invalid.', 400);
    return withTransaction(db, async client => {
      const result = await client.query(
        `/* clientConsultationForms:issue-token */
         SELECT a.id AS assignment_id,a.appointment_id,a.template_version_id,a.client_id,a.crm_v2_client_id,
                a.status AS assignment_status,ap.client_id AS appointment_client_id,
                ap.crm_v2_client_id AS appointment_crm_v2_client_id,ap.status AS appointment_status,
                ap.starts_at,t.status AS template_status
           FROM consultation_form_assignments a
           JOIN appointments ap ON ap.id=a.appointment_id
           JOIN consultation_form_template_versions tv ON tv.id=a.template_version_id
           JOIN consultation_form_templates t ON t.id=tv.template_id
          WHERE a.id=$1
          FOR UPDATE OF a`,
        [id]
      );
      const row = result.rows[0];
      if (!row || row.template_status !== 'active' || !ALLOWED_APPOINTMENT_STATUSES.has(String(row.appointment_status || ''))) {
        throw new ClientConsultationFormError('CONSULTATION_FORM_ASSIGNMENT_UNAVAILABLE', 'Consultation form assignment is not available.', 409);
      }
      const sameLegacy = positiveId(row.client_id) && positiveId(row.client_id) === positiveId(row.appointment_client_id) && !row.crm_v2_client_id && !row.appointment_crm_v2_client_id;
      const sameV2 = positiveId(row.crm_v2_client_id) && positiveId(row.crm_v2_client_id) === positiveId(row.appointment_crm_v2_client_id) && !row.client_id && !row.appointment_client_id;
      if (!sameLegacy && !sameV2) throw new ClientConsultationFormError('CONSULTATION_FORM_IDENTITY_DRIFT', 'Consultation form assignment is not available.', 409);
      if (String(row.assignment_status || '') === 'completed') throw new ClientConsultationFormError('CONSULTATION_FORM_ALREADY_COMPLETED', 'This consultation form has already been completed.', 409);

      const token = randomBytes(TOKEN_BYTES).toString('base64url');
      const tokenHash = hashAccessToken(token);
      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + tokenTtlMs);
      await client.query(
        `/* clientConsultationForms:store-token */
         UPDATE consultation_form_assignments
            SET access_token_hash=$2,access_expires_at=$3,access_issued_at=$4,
                access_revoked_at=NULL,updated_at=$4
          WHERE id=$1`,
        [id, tokenHash, expiresAt, issuedAt]
      );
      return { assignmentId: id, token, expiresAt };
    });
  }

  async function submitForm(accessToken, body = {}) {
    const tokenHash = hashAccessToken(accessToken);
    return withTransaction(db, async client => {
      const row = await assignmentRowByHash(tokenHash, client, { lock: true });
      if (!row) throw new ClientConsultationFormError('CONSULTATION_FORM_LINK_UNAVAILABLE', 'This consultation form link is not available.', 404);
      const state = validateAssignment(row, { allowCompleted: true });
      if (state.completed) return { alreadyCompleted: true, assignmentId: state.assignmentId };

      const form = await loadFormVersion(row, client);
      const normalized = validateSubmissionBody(form, body);
      const signedAt = now();
      const encrypted = encryptSubmissionPayload({
        schemaVersion: 1,
        answers: normalized.answers,
        signature: {
          method: 'typed_name',
          name: normalized.signatureName,
          confirmed: true,
        },
      }, { env, randomBytes });
      const snapshot = templateSnapshot(form);

      const inserted = await client.query(
        `/* clientConsultationForms:submit */
         INSERT INTO consultation_form_submissions(
           assignment_id,template_version_id,payload_schema_version,
           payload_ciphertext,payload_iv,payload_auth_tag,
           template_snapshot,consent_text_snapshot,signature_method,signed_at,submitted_at
         ) VALUES ($1,$2,1,$3,$4,$5,$6::jsonb,$7,'typed_name',$8,$8)
         ON CONFLICT (assignment_id) DO NOTHING
         RETURNING id`,
        [
          state.assignmentId,
          state.versionId,
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.authTag,
          JSON.stringify(snapshot),
          form.consentText,
          signedAt,
        ]
      );
      if (!inserted.rows[0]) return { alreadyCompleted: true, assignmentId: state.assignmentId };

      await client.query(
        `/* clientConsultationForms:complete-assignment */
         UPDATE consultation_form_assignments
            SET status='completed',completed_at=$2,updated_at=$2
          WHERE id=$1`,
        [state.assignmentId, signedAt]
      );
      return {
        alreadyCompleted: false,
        assignmentId: state.assignmentId,
        submittedAt: signedAt,
      };
    });
  }

  return {
    openForm,
    submitForm,
    issueAccessToken,
  };
}

const service = createClientConsultationFormsService();

module.exports = {
  CLIENT_FORM_FLAG,
  CLIENT_FORM_DATA_KEY,
  TOKEN_BYTES,
  TOKEN_TTL_MS,
  MAX_TOKEN_TTL_MS,
  ClientConsultationFormError,
  positiveId,
  isClientConsultationFormsEnabled,
  normalizeAccessToken,
  hashAccessToken,
  parseDataKey,
  encryptSubmissionPayload,
  decryptSubmissionPayload,
  splitDisplayName,
  displayMobile,
  buildPrefill,
  flattenFormItems,
  validateSubmissionBody,
  templateSnapshot,
  createClientConsultationFormsService,
  ...service,
};
