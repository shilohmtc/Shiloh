const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const { chromium, expect } = require('@playwright/test');
const { makeTrialFixture } = require('../tests/fixtures/consultationFormTrialFixture');
const { createClientConsultationFormsRouter } = require('../src/routes/clientConsultationForms');

async function run() {
  const output = path.join(__dirname, '../artifacts/consultation-form-trial-proof');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const report = [];
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
      const fixture = makeTrialFixture();
      const app = express();
      app.use('/forms', createClientConsultationFormsRouter({ env: fixture.env, trialService: fixture.service, trialLog: fixture.log }));
      const server = app.listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      const origin = `http://127.0.0.1:${server.address().port}`;
      fixture.env.CONSULTATION_FORM_TRIAL_ORIGIN = origin;
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const requests = [];
      page.on('request', request => requests.push(request.url()));
      try {
        await page.goto(origin + '/forms/test#' + fixture.token);
        await expect(page.locator('[data-client-consultation-form]')).toBeVisible();
        assert.ok(!page.url().includes(fixture.token));
        await expect(page.locator('#first_name')).toHaveValue('Test');
        await expect(page.locator('input[type="radio"]:checked')).toHaveCount(0);
        await page.screenshot({ path: path.join(output, `form-${viewport.width}.png`) });
        for (const row of await page.locator('.choice-row').all()) await row.locator('label:has(input[value="no"])').click();
        await page.locator('label:has(input[name="allergies"][value="yes"])').click();
        await expect(page.locator('#allergy_details')).toBeVisible();
        await page.locator('#allergy_details').fill('Fictional test answer');
        await page.locator('#treatment_goal').fill('Testing the mobile form only.');
        await page.locator('#signature_name').fill('Test Client');
        await expect(page.locator('[data-signature-preview]')).toHaveText('Test Client');
        await page.locator('#consent_acknowledged').check();
        await page.locator('#signature_confirm').check();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        await page.locator('#signature_name').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, `signature-${viewport.width}.png`) });
        await page.getByRole('button', { name: 'Submit test form securely' }).click();
        await expect(page.getByRole('heading', { name: 'Thank you — your test form is complete.' })).toBeVisible();
        assert.equal(fixture.rows.size, 1);
        assert.ok([...fixture.rows.values()][0].payload_ciphertext);
        await page.screenshot({ path: path.join(output, `completed-${viewport.width}.png`) });
        await page.goto(origin + '/forms/test#' + fixture.token);
        await expect(page.getByRole('heading', { name: 'Thank you — your test form is complete.' })).toBeVisible();
        await expect(page.locator('[data-client-consultation-form]')).toHaveCount(0);
        assert.ok(requests.every(url => !url.includes(fixture.token)));
        assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
        report.push({ viewport, opened: true, conditionalQuestion: true, signature: true, submissionEncrypted: true, replayReadOnly: true, tokenAbsentFromRequestUrls: true, noHorizontalOverflow: true });
      } finally {
        await context.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ syntheticOnly: true, cases: report }, null, 2));
  console.log(JSON.stringify({ event: 'consultation_form_trial_browser_proof_passed', viewports: report.length, syntheticOnly: true }));
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
