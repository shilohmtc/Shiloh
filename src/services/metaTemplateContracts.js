const axios = require('axios');
const { discoverWabaId } = require('./birthdayTemplateProvisioning');
const {
  getShilohMessageContract,
  semanticComponents: canonicalSemanticComponents,
} = require('./shilohMessageContracts');
const {
  META_TEMPLATE_BINDINGS,
  getContractIdForMetaTemplateName,
  buildMetaTemplateContractView,
  configuredMetaTemplateName,
  resolveMetaTemplateBinding,
  compareMetaTemplateVariant,
} = require('./metaTemplateAdapter');

const GRAPH_VERSION = 'v23.0';

const CONTRACTS = Object.freeze(META_TEMPLATE_BINDINGS.map((binding) => {
  const shilohContract = getShilohMessageContract(binding.contractId);
  return Object.freeze({
    key: binding.contractId,
    env: binding.env,
    contract: Object.freeze(buildMetaTemplateContractView(binding.contractId)),
    sendable: Boolean(shilohContract?.sendable),
    defaultWhenUnset: Boolean(binding.defaultWhenUnset),
  });
}));

function semanticComponents(components = []) {
  return canonicalSemanticComponents(components);
}

function componentsMatch(expected, actual) {
  if (!Array.isArray(expected)) return false;
  return JSON.stringify(canonicalSemanticComponents(expected)) === JSON.stringify(canonicalSemanticComponents(actual));
}

function staffAuthComponentsMatch(expected, actual) {
  if (!Array.isArray(expected) || !Array.isArray(actual)) return false;
  return JSON.stringify(canonicalSemanticComponents(expected, 'staff_auth_otp'))
    === JSON.stringify(canonicalSemanticComponents(actual, 'staff_auth_otp'));
}

function compareContract(entry, provider) {
  if (!entry) return { exact: false };
  return compareMetaTemplateVariant(entry.key, provider);
}

function selectProviderVariant(providers, entry) {
  const variants = (Array.isArray(providers) ? providers : [])
    .filter((provider) => provider?.name === entry.contract.name && provider?.language === entry.contract.language);
  variants.sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
  return { provider: variants[0] || null, duplicateCount: Math.max(variants.length - 1, 0) };
}

async function fetchAllTemplates(wabaId) {
  let url = `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates`;
  const templates = [];
  let params = { fields: 'id,name,status,category,language,quality_score,components,message_send_ttl_seconds', limit: 100 };
  do {
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
      timeout: 15000,
      params,
    });
    templates.push(...(response.data?.data || []));
    url = response.data?.paging?.next || null;
    params = undefined;
  } while (url);
  return templates;
}

function configuredTemplateName(entry, environment = process.env) {
  return entry ? configuredMetaTemplateName(entry.key, environment) : null;
}

function sanitizeBinding(binding) {
  if (!binding) return null;
  const sanitized = { ...binding };
  delete sanitized.providerTemplateId;
  return sanitized;
}

async function inspectMetaTemplateInventory() {
  const wabaId = await discoverWabaId();
  if (!wabaId) return { ok: false, reason: 'waba_not_discovered', templates: [] };
  const providers = await fetchAllTemplates(wabaId);
  return {
    ok: true,
    templates: CONTRACTS.map((entry) => {
      const { provider, duplicateCount } = selectProviderVariant(providers, entry);
      const configuredName = configuredTemplateName(entry);
      const contract = provider ? compareContract(entry, provider) : null;
      const binding = resolveMetaTemplateBinding({ contractId: entry.key, providerTemplates: providers });
      return {
        key: entry.key,
        expectedName: entry.contract.name,
        configuredName,
        defined: true,
        configured: configuredName === entry.contract.name,
        provider: {
          exists: Boolean(provider),
          status: provider?.status || null,
          quality: provider?.quality_score?.score || provider?.quality_score || null,
          category: provider?.category || null,
          language: provider?.language || null,
          messageSendTtlSeconds: provider?.message_send_ttl_seconds ?? null,
          duplicateCount,
        },
        contract,
        binding: sanitizeBinding(binding),
        sendable: entry.sendable,
        ready: Boolean(entry.sendable && configuredName === entry.contract.name && binding.bound),
      };
    }),
  };
}

function assertDeliveryFeatureGate(contractId, environment = process.env) {
  if (contractId === 'booking_update' && environment.WHATSAPP_BOOKING_UPDATE_ENABLED !== 'true') {
    throw new Error('Booking-update delivery gate is disabled');
  }
  if ((contractId === 'reschedule_approval_request' || contractId === 'reschedule_declined')
    && environment.WHATSAPP_RESCHEDULE_APPROVAL_ENABLED !== 'true') {
    throw new Error('Reschedule-approval delivery gate is disabled');
  }
  if (contractId === 'staff_auth_otp'
    && environment.SHILOH_STAFF_BROWSER_AUTH_WHATSAPP_DELIVERY_ENABLED !== 'true') {
    throw new Error('Staff authentication WhatsApp delivery gate is disabled');
  }
  if ((contractId === 'consultation_form' || contractId === 'consultation_form_reminder')
    && environment.SHILOH_CONSULTATION_FORM_DELIVERY_ENABLED !== 'true') {
    throw new Error('Consultation form delivery gate is disabled');
  }
}

let cache = null;
let cachedAt = 0;

async function assertMessageContractSendAllowed(contractId, language = null) {
  const entry = CONTRACTS.find((candidate) => candidate.key === contractId);
  const shilohContract = getShilohMessageContract(contractId);
  if (!entry || !shilohContract || shilohContract.lifecycle !== 'current' || !entry.sendable) {
    throw new Error(`Shiloh message is not an approved send contract: ${contractId}`);
  }
  const expectedLanguage = entry.contract.language;
  const requestedLanguage = language == null ? expectedLanguage : language;
  if (requestedLanguage !== expectedLanguage) {
    throw new Error(`Shiloh message language does not match contract: ${contractId}`);
  }
  if (configuredTemplateName(entry) !== entry.contract.name) {
    throw new Error(`WhatsApp template configuration does not match contract: ${entry.env}`);
  }
  assertDeliveryFeatureGate(contractId);
  if (!cache || Date.now() - cachedAt > 60000) {
    cache = await inspectMetaTemplateInventory();
    cachedAt = Date.now();
  }
  const state = cache.templates?.find((candidate) => candidate.key === contractId);
  if (!state?.ready || !state?.binding?.bound) {
    throw new Error(`WhatsApp template is not exact, approved and configured: ${entry.contract.name}`);
  }
  return state;
}

async function assertTemplateSendAllowed(name, language = 'en') {
  const contractId = getContractIdForMetaTemplateName(name);
  const entry = contractId ? CONTRACTS.find((candidate) => candidate.key === contractId) : null;
  if (!entry || !entry.sendable) {
    throw new Error(`WhatsApp template is not an approved Shiloh send contract: ${name}`);
  }
  if (language !== entry.contract.language) {
    throw new Error(`WhatsApp template language does not match contract: ${name}`);
  }
  return assertMessageContractSendAllowed(contractId, language);
}

function resetTemplateInventoryCache() {
  cache = null;
  cachedAt = 0;
}

module.exports = {
  CONTRACTS,
  configuredTemplateName,
  semanticComponents,
  staffAuthComponentsMatch,
  compareContract,
  selectProviderVariant,
  fetchAllTemplates,
  inspectMetaTemplateInventory,
  assertDeliveryFeatureGate,
  assertMessageContractSendAllowed,
  assertTemplateSendAllowed,
  resetTemplateInventoryCache,
};
