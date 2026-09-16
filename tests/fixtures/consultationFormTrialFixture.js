const fs = require('node:fs');
const path = require('node:path');
const { hashAccessToken, flattenFormItems } = require('../../src/services/clientConsultationForms');
const { createConsultationFormTrialService, TEST_PREFILL } = require('../../src/services/consultationFormTrial');

function makeTrialFixture() {
  const definitions = [...fs.readFileSync(path.join(__dirname, '../../migrations/131_workspace_consultation_forms_foundation.sql'), 'utf8').matchAll(/\$json\$([\s\S]*?)\$json\$/g)].map(match => JSON.parse(match[1]));
  let clock = new Date();
  const token = Buffer.alloc(32, 23).toString('base64url');
  const env = {
    NODE_ENV: 'test',
    SHILOH_CONSULTATION_FORM_TRIAL_ENABLED: 'true',
    SHILOH_CLIENT_CONSULTATION_FORMS_ENABLED: 'false',
    CONSULTATION_FORM_TRIAL_ACCESS_HASH: hashAccessToken(token),
    CONSULTATION_FORM_TRIAL_EXPIRES_AT: new Date(clock.getTime() + 48 * 3600000).toISOString(),
    CONSULTATION_FORM_DATA_KEY: Buffer.alloc(32, 25).toString('base64url'),
  };
  const form = {
    versionId: 2, templateKey: 'hot_stone_massage_consultation', title: 'Hot Stone Massage Consultation', version: 1,
    consentText: 'Sample consultation declaration.', settings: { signature_required: true },
    sections: [
      { sectionKey: 'core_massage_consultation', title: 'Core Massage Consultation', version: 1, definition: definitions[0] },
      { sectionKey: 'hot_stone_massage_screening', title: 'Hot Stone Massage Screening', version: 1, definition: definitions[2] },
    ],
  };
  const rows = new Map();
  const calls = [];
  const logs = [];
  const fault = { corruptRead: false, failSave: false };
  const log = { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) };
  const db = {
    async connect() {
      let backup;
      return {
        async query(sql, values = []) {
          if (sql === 'BEGIN') { backup = structuredClone(rows); calls.push({ sql, values }); return { rows: [] }; }
          if (sql === 'ROLLBACK') { rows.clear(); for (const [key, value] of backup || []) rows.set(key, value); calls.push({ sql, values }); return { rows: [] }; }
          if (sql === 'COMMIT') { calls.push({ sql, values }); return { rows: [] }; }
          return db.query(sql, values);
        },
        release() {},
      };
    },
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('consultationTrial:read')) {
        const row = rows.get(values[0]);
        const copy = row ? structuredClone(row) : null;
        if (copy?.payload_ciphertext && fault.corruptRead) copy.payload_auth_tag = 'AAAAAAAAAAAAAAAAAAAAAA';
        return { rows: copy ? [{ ...copy, template_status: 'active' }] : [] };
      }
      if (sql.includes('consultationTrial:template')) return { rows: [{ id: form.versionId, template_key: form.templateKey, title: form.title, version_number: form.version, consent_text: form.consentText, settings: form.settings }] };
      if (sql.includes('consultationTrial:sections')) return { rows: form.sections.map(section => ({ section_key: section.sectionKey, title: section.title, version_number: section.version, definition: section.definition })) };
      if (sql.includes('consultationTrial:create')) {
        if (!rows.has(values[0])) rows.set(values[0], { token_hash: values[0], template_version_id: values[1], template_snapshot: JSON.parse(values[2]), consent_text_snapshot: values[3], expires_at: values[4], submitted_at: null });
        return { rows: [] };
      }
      if (sql.includes('consultationTrial:save')) {
        if (fault.failSave) throw new Error('synthetic-storage-failure');
        const row = rows.get(values[0]);
        if (row && !row.submitted_at) Object.assign(row, { payload_ciphertext: values[1], payload_iv: values[2], payload_auth_tag: values[3], submitted_at: values[4] });
        return { rows: [] };
      }
      if (sql.includes('consultationTrial:purge')) {
        for (const [key, row] of rows) if (new Date(row.expires_at) <= values[0]) rows.delete(key);
        return { rows: [] };
      }
      throw new Error('Unexpected query outside the isolated form-trial boundary');
    },
  };
  const service = createConsultationFormTrialService({ db, env, now: () => new Date(clock) });
  function validBody() {
    const body = { consent_acknowledged: 'yes', signature_confirm: 'yes', signature_name: 'Test Client' };
    for (const item of flattenFormItems(form)) body[item.key] = item.type === 'yes_no' ? 'no' : TEST_PREFILL[item.key] || '';
    return body;
  }
  return { db, env, token, form, rows, calls, logs, log, fault, service, validBody, advance(ms) { clock = new Date(clock.getTime() + ms); } };
}

module.exports = { makeTrialFixture };
