#!/usr/bin/env node
require('dotenv').config();

const { submitClientAuthTemplateIfAbsent } = require('../src/services/clientAuthTemplateProvisioning');

async function main() {
  if (process.env.META_CLIENT_AUTH_TEMPLATE_PROVISION_ON_START !== 'true') return;
  const result = await submitClientAuthTemplateIfAbsent();
  console.log(JSON.stringify({
    event: 'client_auth_meta_template_submission',
    ok: result.ok === true,
    submitted: result.submitted === true,
    reason: result.reason || null,
    status: result.status || null,
    category: result.category || null,
    providerTemplateId: result.providerTemplateId || null,
    bindingState: result.bindingState || null,
    duplicateCount: result.duplicateCount ?? null,
    provider: result.provider || null,
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: 'client_auth_meta_template_submission_failed',
    errorType: String(error?.name || 'Error').slice(0, 60),
  }));
});
