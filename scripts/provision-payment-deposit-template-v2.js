#!/usr/bin/env node
require('dotenv').config();

const { ensurePaymentDepositTemplateV2 } = require('../src/services/paymentDepositTemplateProvisioning');

async function main() {
  const result = await ensurePaymentDepositTemplateV2();
  console.log(JSON.stringify({
    event: 'payment_deposit_template_v2_provisioning_complete',
    ok: result?.ok === true,
    submitted: result?.submitted === true,
    reason: result?.reason || null,
    providerStatus: result?.provider?.status || null,
    providerName: result?.provider?.name || null,
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: 'payment_deposit_template_v2_provisioning_failed',
    message: error?.message || 'Unknown Meta template provisioning error',
    metaError: error?.response?.data?.error || null,
  }));
});
