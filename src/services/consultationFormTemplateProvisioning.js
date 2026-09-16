const axios = require('axios');
const { discoverWabaId } = require('./birthdayTemplateProvisioning');
const logger = require('../lib/logger');

const GRAPH_VERSION = 'v23.0';
const TEMPLATE_LANGUAGE = 'en';
const TEMPLATE_CATEGORY = 'UTILITY';
const TEMPLATE_FOOTER = 'Shiloh Massage Therapy & Aesthetic Clinic';
const FORM_URL = 'https://app.shilohmtc.co.za/forms/f/{{1}}';

const TEMPLATE_SPECS = Object.freeze([
  Object.freeze({
    key: 'consultation_form',
    name: 'shiloh_consultation_form_v1',
    header: 'Consultation form',
    body: 'Hi {{1}}, before your Shiloh appointment for {{2}} on {{3}}, please complete your consultation form. It only takes a few minutes and helps your practitioner prepare for your treatment. If you have already completed it, no further action is needed.',
    bodyExample: ['Naledi Mokoena', 'Full Body Swedish', 'Thursday, 24 September 2026'],
  }),
  Object.freeze({
    key: 'consultation_form_reminder',
    name: 'shiloh_consultation_form_reminder_v1',
    header: 'Consultation form reminder',
    body: 'Hi {{1}}, a reminder to complete your consultation form before your Shiloh appointment for {{2}} on {{3}}. If you have already completed it, no further action is needed.',
    bodyExample: ['Naledi Mokoena', 'Hot Stone Massage', 'Thursday, 24 September 2026'],
  }),
]);

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

function buildConsultationFormTemplateDefinition(spec) {
  if (!spec) throw new Error('Consultation form template spec is required');
  return {
    name: spec.name,
    language: TEMPLATE_LANGUAGE,
    category: TEMPLATE_CATEGORY,
    components: [
      {
        type: 'HEADER',
        format: 'TEXT',
        text: spec.header,
      },
      {
        type: 'BODY',
        text: spec.body,
        example: { body_text: [spec.bodyExample] },
      },
      {
        type: 'FOOTER',
        text: TEMPLATE_FOOTER,
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Complete form',
            url: FORM_URL,
            example: ['example-consultation-token'],
          },
        ],
      },
    ],
  };
}

function buildConsultationFormTemplateDefinitions() {
  return TEMPLATE_SPECS.map(buildConsultationFormTemplateDefinition);
}

function semanticButton(button = {}) {
  const normalized = { type: String(button.type || '').toUpperCase() };
  if (button.text != null) normalized.text = button.text;
  if (button.url != null) normalized.url = button.url;
  return normalized;
}

function semanticComponents(components = []) {
  return (Array.isArray(components) ? components : []).map((component) => {
    const normalized = { type: String(component.type || '').toUpperCase() };
    if (component.format != null) normalized.format = String(component.format).toUpperCase();
    if (component.text != null) normalized.text = component.text;
    if (Array.isArray(component.buttons)) normalized.buttons = component.buttons.map(semanticButton);
    return normalized;
  });
}

function providerContractMatches(provider, definition) {
  return Boolean(
    provider?.name === definition.name
    && provider?.language === definition.language
    && String(provider?.category || '').toUpperCase() === definition.category
    && JSON.stringify(semanticComponents(provider?.components)) === JSON.stringify(semanticComponents(definition.components))
  );
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

async function submitConsultationFormTemplates() {
  const initial = await getConsultationFormTemplateStatuses();
  if (!initial.ok) return initial;

  const results = [];
  for (const status of initial.templates) {
    if (status.duplicateCount > 0) {
      results.push({ ...status, submitted: false, reason: 'duplicate_variants_present' });
      continue;
    }
    if (status.template) {
      results.push({ ...status, submitted: false, reason: status.template.exact ? 'already_exists_exact' : 'existing_contract_mismatch' });
      continue;
    }

    const response = await axios.post(
      graphUrl(`${initial.wabaId}/message_templates`),
      status.definition,
      graphConfig(),
    );
    results.push({
      ...status,
      submitted: true,
      reason: 'submitted',
      provider: {
        id: response.data?.id || null,
        status: response.data?.status || null,
        category: response.data?.category || TEMPLATE_CATEGORY,
      },
    });
  }

  const verification = await getConsultationFormTemplateStatuses();
  const verifiedByName = new Map((verification.templates || []).map((item) => [item.templateName, item]));
  const merged = results.map((item) => ({ ...item, verification: verifiedByName.get(item.templateName)?.template || null }));

  logger.info({
    templates: merged.map((item) => ({
      templateName: item.templateName,
      submitted: item.submitted === true,
      reason: item.reason,
      providerStatus: item.provider?.status || item.verification?.status || item.template?.status || null,
      providerCategory: item.provider?.category || item.verification?.category || item.template?.category || null,
      exact: item.verification?.exact ?? item.template?.exact ?? null,
      duplicateCount: item.duplicateCount,
    })),
  }, 'Consultation form template provider verification');

  return { ok: true, wabaId: initial.wabaId, templates: merged };
}

module.exports = {
  TEMPLATE_LANGUAGE,
  TEMPLATE_CATEGORY,
  TEMPLATE_FOOTER,
  FORM_URL,
  TEMPLATE_SPECS,
  buildConsultationFormTemplateDefinition,
  buildConsultationFormTemplateDefinitions,
  providerContractMatches,
  getConsultationFormTemplateStatuses,
  submitConsultationFormTemplates,
};
