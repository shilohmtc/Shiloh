'use strict';

const axios = require('axios');
const { discoverWabaId } = require('./birthdayTemplateProvisioning');

const GRAPH_VERSION = 'v23.0';
const TEMPLATE_NAME = 'shiloh_problem_report_resolved_v1';
const TEMPLATE_LANGUAGE = 'en';
const TEMPLATE_CATEGORY = 'UTILITY';
const TEMPLATE_BODY = `Hi {{1}}, your Shiloh problem report {{2}} has been resolved. ✅\n\nUpdate: {{3}}\n\nIf the problem continues, reply “Still not working {{2}}” and we’ll reopen it. 🌿`;

function buildProblemReportResolvedTemplateDefinition() {
  return {
    name: TEMPLATE_NAME,
    language: TEMPLATE_LANGUAGE,
    category: TEMPLATE_CATEGORY,
    components: [{
      type: 'BODY',
      text: TEMPLATE_BODY,
      example: { body_text: [['Miranda', 'SH-260920-AABBCCDD', 'The reminder now shows the confirmed time.']] },
    }],
  };
}

async function listTemplates(wabaId) {
  const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates`, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
    timeout: 15000,
    params: { fields: 'id,name,status,category,language,components', limit: 100 },
  });
  return response.data?.data || [];
}

async function submitProblemReportResolvedTemplate() {
  const wabaId = await discoverWabaId();
  if (!wabaId) return { ok: false, reason: 'waba_not_discovered', templateName: TEMPLATE_NAME };
  const existing = (await listTemplates(wabaId)).filter((item) => item?.name === TEMPLATE_NAME && item?.language === TEMPLATE_LANGUAGE);
  if (existing.length) return { ok: true, submitted: false, reason: existing.length === 1 ? 'already_exists' : 'duplicate_variants_present', templateName: TEMPLATE_NAME, providerStatus: existing[0]?.status || null, duplicateCount: Math.max(0, existing.length - 1) };
  const response = await axios.post(
    `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates`,
    buildProblemReportResolvedTemplateDefinition(),
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }, timeout: 15000 },
  );
  return { ok: true, submitted: true, reason: 'submitted', templateName: TEMPLATE_NAME, providerStatus: response.data?.status || null };
}

module.exports = { TEMPLATE_NAME, TEMPLATE_LANGUAGE, TEMPLATE_CATEGORY, TEMPLATE_BODY, buildProblemReportResolvedTemplateDefinition, submitProblemReportResolvedTemplate };
