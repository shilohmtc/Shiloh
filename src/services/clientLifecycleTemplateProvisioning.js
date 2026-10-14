const definitions = require('../messageDefinitions/clientLifecycle');
const { TEMPLATE_LANGUAGE, TEMPLATE_CATEGORY, DEFINITIONS, buildDefinition, isSafeToEnable } = definitions;
const axios = require('axios');
const { discoverWabaId } = require('./birthdayTemplateProvisioning');

const GRAPH_VERSION = 'v23.0';

function graphUrl(path) { return `https://graph.facebook.com/${GRAPH_VERSION}/${String(path).replace(/^\//, '')}`; }
function graphConfig() { return { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }, timeout: 15000 }; }

function sanitize(template) { return template ? { id: template.id || null, name: template.name || null, status: template.status || null, category: template.category || null, language: template.language || null } : null; }

async function listProviderTemplates(wabaId) { const response = await axios.get(graphUrl(`${wabaId}/message_templates`), { ...graphConfig(), params: { fields: 'id,name,status,category,language,components', limit: 250 } }); return response.data?.data || []; }
async function getClientLifecycleTemplateStatus() {
  const wabaId = await discoverWabaId(); if (!wabaId) return { ok: false, reason: 'waba_not_discovered', templates: [] };
  const providerTemplates = await listProviderTemplates(wabaId);
  const templates = Object.entries(DEFINITIONS).map(([key, item]) => { const provider = sanitize(providerTemplates.find((candidate) => candidate?.name === item.name) || null); const configuredTemplateName = item.env ? process.env[item.env] || null : null; const lifecycle = item.lifecycle || 'current'; return { key, lifecycle, templateName: item.name, configuredTemplateName, provider, safeToEnable: lifecycle === 'current' && isSafeToEnable(provider, configuredTemplateName, item.name), definition: buildDefinition(key) }; });
  return { ok: true, wabaId, templates };
}

module.exports = { ...definitions, getClientLifecycleTemplateStatus };
