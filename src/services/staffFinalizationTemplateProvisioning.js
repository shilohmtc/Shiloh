const definitions = require('../messageDefinitions/staffFinalization');
const { TEMPLATE_NAME, ACTION_TEMPLATE_NAME, TEMPLATE_LANGUAGE, TEMPLATE_CATEGORY, TEMPLATE_BODY, ACTION_TEMPLATE_BODY, ACTION_BUTTON_TEXT, ACTION_BUTTON_PAYLOAD, buildStaffFinalizationTemplateDefinition, buildStaffFinalizationActionTemplateDefinition } = definitions;
const axios = require('axios');
const { discoverWabaId } = require('./birthdayTemplateProvisioning');

const GRAPH_VERSION = 'v23.0';

function graphUrl(path) {
  return `https://graph.facebook.com/${GRAPH_VERSION}/${String(path).replace(/^\//, '')}`;
}

function graphConfig() {
  return {
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  };
}

async function listTemplates(wabaId) {
  const response = await axios.get(graphUrl(`${wabaId}/message_templates`), {
    ...graphConfig(),
    params: { fields: 'id,name,status,category,language,components', limit: 250 },
  });
  return response.data;
}

function sanitizeTemplate(template) {
  if (!template) return null;
  return {
    id: template.id || null,
    name: template.name || null,
    status: template.status || null,
    category: template.category || null,
    language: template.language || null,
  };
}

async function statusFor(templateName, definition) {
  const wabaId = await discoverWabaId();
  if (!wabaId) return { ok: false, reason: 'waba_not_discovered', templateName };
  const templates = await listTemplates(wabaId);
  const target = (templates?.data || []).find((item) => item?.name === templateName) || null;
  return { ok: true, wabaId, templateName, template: sanitizeTemplate(target), definition };
}

async function getStaffFinalizationTemplateStatus() {
  return statusFor(TEMPLATE_NAME, buildStaffFinalizationTemplateDefinition());
}

async function getStaffFinalizationActionTemplateStatus() {
  return statusFor(ACTION_TEMPLATE_NAME, buildStaffFinalizationActionTemplateDefinition());
}

module.exports = { ...definitions, getStaffFinalizationTemplateStatus, getStaffFinalizationActionTemplateStatus };
