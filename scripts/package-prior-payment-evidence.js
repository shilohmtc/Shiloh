'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const directory = 'artifacts/prior-payments-review';
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding:'utf8' }).trim();
if (process.env.EVIDENCE_EXPECTED_HEAD && process.env.EVIDENCE_EXPECTED_HEAD !== head) throw new Error('Prior-payment evidence must match the exact reviewed head.');
const images = fs.readdirSync(directory).filter(file=>file.endsWith('.png')).sort();
for (const viewport of ['desktop','phone','narrow']) for (const state of ['storybook-reception','storybook-paid-previously','storybook-view-only','storybook-partial-prior-with-credit','storybook-prior-receipt-review','ready','settled','reversed']) {
  if (!images.includes(`${viewport}-${state}.png`)) throw new Error(`Missing prior-payment review: ${viewport}-${state}`);
}
const sources = ['migrations/191_booking_prior_payments.sql','src/services/bookingPriorPayments.js','src/services/bookingPayments.js','src/services/bookingDepositPolicy.js','src/services/myShilohClientContext.js','src/services/workspaceFinancialReports.js','src/presentation/bookingPriorPaymentsUx.js','src/presentation/bookingPaymentMethodUx.js','src/presentation/calendarPaymentsUx.js','src/routes/calendarPayments.js','tests/booking-prior-payments.spec.js'];
fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({head,tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(),synthetic:true,sources:sources.map(file=>({file,sha256:digest(file)})),images:images.map(file=>({file,sha256:digest(path.join(directory,file))}))},null,2)+'\n');
