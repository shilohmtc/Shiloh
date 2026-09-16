#!/usr/bin/env node
require('dotenv').config();

const { submitConsultationFormTemplates } = require('../src/services/consultationFormTemplateProvisioning');

async function main() {
  const result = await submitConsultationFormTemplates();
  console.log(JSON.stringify({
    event: 'consultation_form_meta_template_provisioning_complete',
    ok: result?.ok === true,
    templates: (result?.templates || []).map((item) => ({
      templateName: item.templateName,
      submitted: item.submitted === true,
      reason: item.reason || null,
      providerStatus: item.provider?.status || item.verification?.status || item.template?.status || null,
      providerCategory: item.provider?.category || item.verification?.category || item.template?.category || null,
      exact: item.verification?.exact ?? item.template?.exact ?? null,
      duplicateCount: item.duplicateCount ?? null,
    })),
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: 'consultation_form_meta_template_provisioning_failed',
    message: error?.message || 'Unknown Meta template provisioning error',
    metaError: error?.response?.data?.error || null,
  }));
});
