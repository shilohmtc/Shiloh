'use strict';

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
async function accessibilityViolations(page) {
  let violations;
  // Storybook can own the Axe engine before the explicit scan; all other errors still fail.
  await expect.poll(async () => {
    try {
      violations = (await new AxeBuilder({ page }).include('[data-story-surface]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations;
      return true;
    } catch (error) {
      if (error.message.includes('Axe is already running')) return false;
      throw error;
    }
  }, { timeout: 10000 }).toBe(true);
  return violations;
}
const { documentClientScript } = require('../src/presentation/workspaceClientDocumentsUx');

for (const [device,width,height] of [['phone',390,844],['desktop',1280,900]]) {
  for (const story of ['clinic-client-documents','reception-client-documents','client-documents-empty','client-documents-unavailable','policy-acceptance-record','historical-policy-record','signed-consultation-record']) {
    test(`client documents ${story} on ${device}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width,height });
      await page.route('**/calendar/pwa/icon-192.png*', route => route.fulfill({ path:require('node:path').resolve('public/assets/brand/shiloh-mark-192.png') }));
      await page.goto(`/iframe.html?id=workspace-clients--${story}&viewMode=story`);
      const surface = page.locator('[data-story-surface]');
      await expect(surface).toBeVisible();
      if (story === 'clinic-client-documents') {
        await expect(page.getByRole('link',{ name:'View acceptance' })).toHaveAttribute('href','/calendar/clients/801/policy-acceptances/501');
        await expect(page.getByRole('link',{ name:'View signed form' })).toHaveAttribute('href','/calendar/clients/801/consultation-forms/701');
      } else if (story === 'reception-client-documents') {
        await expect(page.getByRole('link',{ name:'View acceptance' })).toBeVisible();
        await expect(page.getByRole('link',{ name:'View signed form' })).toHaveCount(0);
        await expect(surface).toContainText('Private answers restricted');
      } else if (story === 'client-documents-empty') {
        await expect(surface).toContainText('No completed consultation forms');
        await expect(surface).toContainText('No booking-policy acceptance records');
      } else if (story === 'client-documents-unavailable') {
        await expect(surface).toContainText('Consultation form history is temporarily unavailable');
        await expect(surface).toContainText('No acceptance claim is being made');
      } else {
        const print = page.getByRole('button',{ name:'Print / Save PDF' });
        await expect(print).toBeVisible();
        await page.evaluate(() => { window.printCalls = 0; window.print = () => { window.printCalls++; }; });
        await page.addScriptTag({ content:documentClientScript() });
        await print.click();
        expect(await page.evaluate(() => window.printCalls)).toBe(1);
        await page.getByRole('link',{ name:'Back to client' }).focus();
        await expect(page.getByRole('link',{ name:'Back to client' })).toBeFocused();
        if (story === 'historical-policy-record') {
          await expect(surface).toContainText('policy wording was not captured');
        } else if (story === 'policy-acceptance-record') {
          await expect(surface).toContainText('Example policy wording for interface review only.');
        } else {
          await expect(surface).toContainText('Synthetic Client');
          await expect(surface).toContainText('Example signed declaration');
          await expect(surface).toContainText('Form version 1');
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await accessibilityViolations(page)).toEqual([]);
      await page.screenshot({ path:testInfo.outputPath(`${story}-${device}.png`),fullPage:true });
      if (story.endsWith('record')) {
        await page.emulateMedia({ media:'print' });
        await expect(page.getByRole('button',{ name:'Print / Save PDF' })).toBeHidden();
        await expect(page.locator('.workspace-nav')).toBeHidden();
        await expect(surface).toContainText(story === 'signed-consultation-record' ? 'Example signed declaration' : 'Booking Policy & Terms');
      }
    });
  }
}
