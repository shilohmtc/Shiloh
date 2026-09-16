const crypto = require('crypto');
const { pool } = require('../db/pool');
const {
  ClientConsultationFormError,
  hashAccessToken,
  parseDataKey,
  flattenFormItems,
  validateSubmissionBody,
  templateSnapshot,
  encryptSubmissionPayload,
  decryptSubmissionPayload,
} = require('./clientConsultationForms');

const TRIAL_FLAG = 'SHILOH_CONSULTATION_FORM_TRIAL_ENABLED';
const MAX_TRIAL_MS = 72 * 60 * 60 * 1000;
const TEMPLATE_KEYS = new Set(['hot_stone_massage_consultation', 'swedish_massage_consultation']);
const TEST_PREFILL = Object.freeze({ first_name: 'Test', surname: 'Client', mobile: '0000000000', email: '', date_of_birth: '', gender: '' });

function trialError(status = 404) {
  return new ClientConsultationFormError('CONSULTATION_TRIAL_UNAVAILABLE', 'This private test link is unavailable or has expired.', status);
}

function trialConfig(env = process.env, now = new Date()) {
  if (String(env[TRIAL_FLAG] || '').toLowerCase() !== 'true') throw trialError();
  const tokenHash = String(env.CONSULTATION_FORM_TRIAL_ACCESS_HASH || '');
  const expiresAt = new Date(String(env.CONSULTATION_FORM_TRIAL_EXPIRES_AT || ''));
  const templateKey = String(env.CONSULTATION_FORM_TRIAL_TEMPLATE || 'hot_stone_massage_consultation');
  if (!/^[0-9a-f]{64}$/.test(tokenHash) || !Number.isFinite(expiresAt.getTime()) || !TEMPLATE_KEYS.has(templateKey)) throw trialError(503);
  if (expiresAt.getTime() <= now.getTime()) throw trialError(410);
  if (expiresAt.getTime() - now.getTime() > MAX_TRIAL_MS) throw trialError(503);
  parseDataKey(env);
  return { tokenHash, expiresAt, templateKey };
}

function authorizeTrial(token, env, now) {
  const config = trialConfig(env, now);
  if (typeof token !== 'string') throw trialError();
  let hash;
  try { hash = hashAccessToken(token); } catch (_error) { throw trialError(); }
  if (!crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(config.tokenHash, 'hex'))) throw trialError();
  return config;
}

async function transaction(db, work, rollbackOnly = false) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query(rollbackOnly ? 'ROLLBACK' : 'COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_rollbackError) { /* No sensitive exception serialization. */ }
    throw error;
  } finally {
    client.release();
  }
}

function formFromRow(row) {
  return { ...row.template_snapshot, versionId: Number(row.template_version_id), consentText: row.consent_text_snapshot };
}

function createConsultationFormTrialService({ db = pool, env = process.env, now = () => new Date(), randomBytes = crypto.randomBytes } = {}) {
  async function loadTemplate(client, templateKey) {
    const templates = await client.query(`/* consultationTrial:template */
      SELECT tv.id,t.template_key,t.title,tv.version_number,tv.consent_text,tv.settings
      FROM consultation_form_templates t
      JOIN LATERAL (SELECT * FROM consultation_form_template_versions v WHERE v.template_id=t.id ORDER BY v.version_number DESC LIMIT 1) tv ON TRUE
      WHERE t.template_key=$1 AND t.status='active'`, [templateKey]);
    if (templates.rows.length !== 1) throw trialError(503);
    const row = templates.rows[0];
    const sections = await client.query(`/* consultationTrial:sections */
      SELECT s.section_key,s.title,sv.version_number,sv.definition
      FROM consultation_form_template_sections ts
      JOIN consultation_form_section_versions sv ON sv.id=ts.section_version_id
      JOIN consultation_form_sections s ON s.id=sv.section_id
      WHERE ts.template_version_id=$1 ORDER BY ts.position`, [row.id]);
    const form = {
      versionId: Number(row.id), templateKey: row.template_key, title: row.title,
      version: Number(row.version_number), consentText: row.consent_text, settings: row.settings,
      sections: sections.rows.map(section => ({ sectionKey: section.section_key, title: section.title, version: Number(section.version_number), definition: section.definition })),
    };
    if (!flattenFormItems(form).length || !form.consentText) throw trialError(503);
    return form;
  }

  async function readRow(client, tokenHash) {
    const result = await client.query(`/* consultationTrial:read */
      SELECT r.*,t.status AS template_status FROM consultation_form_trials r
      JOIN consultation_form_template_versions tv ON tv.id=r.template_version_id
      JOIN consultation_form_templates t ON t.id=tv.template_id
      WHERE r.token_hash=$1 FOR UPDATE OF r`, [tokenHash]);
    return result.rows[0];
  }

  async function getOrCreate(client, config) {
    let row = await readRow(client, config.tokenHash);
    if (!row) {
      const form = await loadTemplate(client, config.templateKey);
      await client.query(`/* consultationTrial:create */
        INSERT INTO consultation_form_trials(token_hash,template_version_id,template_snapshot,consent_text_snapshot,expires_at)
        VALUES($1,$2,$3::jsonb,$4,$5) ON CONFLICT(token_hash) DO NOTHING`,
      [config.tokenHash, form.versionId, JSON.stringify(templateSnapshot(form)), form.consentText, config.expiresAt]);
      row = await readRow(client, config.tokenHash);
    }
    if (!row || row.template_status !== 'active') throw trialError();
    if (new Date(row.expires_at).getTime() <= now().getTime()) throw trialError(410);
    return row;
  }

  async function saveAndVerify(client, row, normalized) {
    const signedAt = now();
    const payload = {
      schemaVersion: 1, trial: true, tokenHash: row.token_hash,
      versionId: Number(row.template_version_id), answers: normalized.answers,
      signature: { method: 'typed_name', name: normalized.signatureName, confirmed: true },
      signedAt: signedAt.toISOString(),
    };
    const encrypted = encryptSubmissionPayload(payload, { env, randomBytes });
    await client.query(`/* consultationTrial:save */
      UPDATE consultation_form_trials SET payload_ciphertext=$2,payload_iv=$3,payload_auth_tag=$4,submitted_at=$5
      WHERE token_hash=$1 AND submitted_at IS NULL`,
    [row.token_hash, encrypted.ciphertext, encrypted.iv, encrypted.authTag, signedAt]);
    const stored = await readRow(client, row.token_hash);
    const recovered = decryptSubmissionPayload({ ciphertext: stored?.payload_ciphertext, iv: stored?.payload_iv, authTag: stored?.payload_auth_tag }, { env });
    if (JSON.stringify(recovered) !== JSON.stringify(payload)) throw new Error('CONSULTATION_TRIAL_STORAGE_VERIFICATION_FAILED');
    return { completed: true, storageVerified: true };
  }

  async function openTrial(token) {
    const config = authorizeTrial(token, env, now());
    return transaction(db, async client => {
      const row = await getOrCreate(client, config);
      if (row.submitted_at) return { completed: true };
      const form = formFromRow(row);
      return { completed: false, form, prefill: { ...TEST_PREFILL }, appointment: { services: [form.title.replace(' Consultation', '') + ' — test only'], practitioners: [] } };
    });
  }

  async function submitTrial(token, body) {
    const config = authorizeTrial(token, env, now());
    return transaction(db, async client => {
      const row = await getOrCreate(client, config);
      if (row.submitted_at) return { completed: true, alreadyCompleted: true };
      const normalized = validateSubmissionBody(formFromRow(row), body);
      return saveAndVerify(client, row, normalized);
    });
  }

  // Uses the actual trial table, validator and encryption path, then rolls back.
  // The configured user link is not opened, consumed or included in logs.
  async function verifyStorage() {
    const config = trialConfig(env, now());
    const smokeConfig = { ...config, tokenHash: crypto.createHash('sha256').update(randomBytes(32)).digest('hex') };
    return transaction(db, async client => {
      const row = await getOrCreate(client, smokeConfig);
      const form = formFromRow(row);
      const body = { consent_acknowledged: 'yes', signature_confirm: 'yes', signature_name: 'Test Client' };
      for (const item of flattenFormItems(form)) {
        body[item.key] = item.type === 'yes_no' ? 'no' : TEST_PREFILL[item.key] || (item.required ? 'Test' : '');
      }
      return saveAndVerify(client, row, validateSubmissionBody(form, body));
    }, true);
  }

  async function purgeExpired() {
    await db.query('/* consultationTrial:purge */ DELETE FROM consultation_form_trials WHERE expires_at <= $1', [now()]);
  }

  return { openTrial, submitTrial, verifyStorage, purgeExpired };
}

module.exports = { TRIAL_FLAG, MAX_TRIAL_MS, TEST_PREFILL, trialConfig, authorizeTrial, createConsultationFormTrialService };
