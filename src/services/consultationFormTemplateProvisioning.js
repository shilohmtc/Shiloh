const definitions = require('../messageDefinitions/consultationForm');
const { TEMPLATE_LANGUAGE, TEMPLATE_CATEGORY, TEMPLATE_FOOTER, FORM_URL, TEMPLATE_SPECS, buildConsultationFormTemplateDefinition, buildConsultationFormTemplateDefinitions, semanticButton, semanticComponents, providerContractMatches } = definitions;
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
  let url = graphUrl(`${wabaId}/message_templates`);
  let params = { fields: 'id,name,status,category,language,components', limit: 100 };
  const templates = [];
  do {
    const response = await axios.get(url, { ...graphConfig(), params });
    templates.push(...(response.data?.data || []));
    url = response.data?.paging?.next || null;
    params = undefined;
  } while (url);
  return templates;
}

function statusForDefinition(templates, definition) {
  const variants = templates
    .filter((item) => item?.name === definition.name && item?.language === definition.language)
    .sort((a, b) => String(a?.id || '').localeCompare(String(b?.id || '')));
  const template = variants[0] || null;
  return {
    templateName: definition.name,
    duplicateCount: Math.max(variants.length - 1, 0),
    template: template ? {
      id: template.id || null,
      name: template.name,
      status: template.status || null,
      category: template.category || null,
      language: template.language || null,
      exact: providerContractMatches(template, definition),
      components: semanticComponents(template.components),
    } : null,
    definition,
  };
}

async function getConsultationFormTemplateStatuses() {
  const wabaId = await discoverWabaId();
  if (!wabaId) return { ok: false, reason: 'waba_not_discovered', templates: [] };
  const templates = await listTemplates(wabaId);
  return {
    ok: true,
    wabaId,
    templates: buildConsultationFormTemplateDefinitions().map((definition) => statusForDefinition(templates, definition)),
  };
}

module.exports = { ...definitions, getConsultationFormTemplateStatuses };
