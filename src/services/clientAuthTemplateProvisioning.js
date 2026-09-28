const axios = require('axios');
const { discoverWabaId } = require('./birthdayTemplateProvisioning');
const { fetchAllTemplates } = require('./metaTemplateContracts');
const { resolveMetaTemplateBinding } = require('./metaTemplateAdapter');
const { sanitizedSubmissionFailure } = require('./staffAuthTemplateProvisioning');
const {
  CLIENT_AUTH_TEMPLATE_NAME,
  CLIENT_AUTH_TEMPLATE_LANGUAGE,
  buildClientAuthTemplateSubmissionDefinition,
} = require('./clientAuthTemplateDefinition');

async function submitClientAuthTemplateIfAbsent(options = {}) {
  const env = options.env || process.env;
  if (!env.WHATSAPP_TOKEN) return { ok: false, reason: 'provider_token_unavailable' };

  const discover = options.discoverWabaId || discoverWabaId;
  const fetchTemplates = options.fetchTemplates || fetchAllTemplates;
  const post = options.post || axios.post.bind(axios);
  const wabaId = await discover();
  if (!wabaId) return { ok: false, reason: 'waba_not_discovered' };

  const providers = await fetchTemplates(wabaId);
  const matches = providers.filter((provider) => provider?.name === CLIENT_AUTH_TEMPLATE_NAME
    && provider?.language === CLIENT_AUTH_TEMPLATE_LANGUAGE);
  if (matches.length) {
    const binding = resolveMetaTemplateBinding({ contractId: 'client_auth_otp', providerTemplates: providers });
    return {
      ok: true, submitted: false, reason: 'exact_identity_already_exists',
      status: binding.providerStatus || matches[0].status || null,
      bindingState: binding.state,
      duplicateCount: matches.length - 1,
    };
  }

  try {
    const response = await post(
      `https://graph.facebook.com/v23.0/${wabaId}/message_templates`,
      buildClientAuthTemplateSubmissionDefinition(),
      {
        headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
        timeout: 15000,
      },
    );
    return {
      ok: true, submitted: true,
      status: response?.data?.status || null,
      category: response?.data?.category || null,
      providerTemplateId: response?.data?.id == null ? null : String(response.data.id),
    };
  } catch (error) {
    return { ok: false, reason: 'provider_rejected_submission', provider: sanitizedSubmissionFailure(error) };
  }
}

module.exports = { submitClientAuthTemplateIfAbsent };
