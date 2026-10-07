const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { WORKSPACE_CARD_PALETTE } = require('../src/presentation/shilohUxTokens');
const rgb = hex => `rgb(${hex.slice(1).match(/../g).map(x => parseInt(x, 16)).join(', ')})`;

for (const viewport of [{name:'phone',width:390,height:844},{name:'desktop',width:1440,height:1000}]) {
  test(`semantic card accents preserve payment and Notes boundaries on ${viewport.name}`, async ({page}, testInfo) => {
    await page.setViewportSize(viewport);
    for (const [story, selector] of [
      ['dashboard-awaiting-deposits','[data-deposit-account]'],
      ['booking-deposit-awaiting','[data-deposit-policy]'],
      ['cancelled-booking-payment-review','[data-deposit-policy]'],
      ['booking-notes-upcoming','.booking-notes-indicator'],
    ]) {
      await page.goto(`/iframe.html?id=workspace-production-surfaces--${story}&viewMode=story`,{waitUntil:'networkidle'});
      const target=page.locator(selector).first();await expect(target).toBeVisible();
      if (story==='dashboard-awaiting-deposits') {
        await expect(page.locator('[data-workspace-card="deposit-pending"]')).toHaveCount(2);
        await expect(page.locator('[data-deposit-account="903"]')).not.toHaveAttribute('data-workspace-card');
        await expect(page.locator('[data-dashboard-deposits] .booking-notes-indicator')).toHaveCount(0);
        await expect(page.locator('[data-dashboard-deposits]')).not.toContainText(/overdue|failed/i);
      } else if (story==='booking-deposit-awaiting') {
        await expect(target).toHaveAttribute('data-workspace-card','deposit-pending');
      } else if (story==='cancelled-booking-payment-review') {
        await expect(target).not.toHaveAttribute('data-workspace-card');
      } else {
        expect(await target.evaluate(n=>getComputedStyle(n).backgroundColor)).toBe(rgb(WORKSPACE_CARD_PALETTE.notes.background));
        const size=await target.boundingBox();expect(size.width).toBeGreaterThanOrEqual(44);expect(size.height).toBeGreaterThanOrEqual(44);
        await target.focus();await expect(target).toBeFocused();expect(await target.evaluate(n=>getComputedStyle(n).outlineWidth)).toBe('3px');
        await expect(target).toHaveAttribute('href',/notesAppointment=/);
        expect(await target.locator('xpath=ancestor::article').evaluate(n=>getComputedStyle(n).backgroundColor)).toBe('rgb(255, 255, 255)');
      }
      for(const card of await page.locator('[data-workspace-card="deposit-pending"]').all()) {
        expect(await card.evaluate(n=>getComputedStyle(n).borderInlineStartColor)).toBe(rgb(WORKSPACE_CARD_PALETTE.depositPending.edge));
        expect(await card.evaluate(n=>getComputedStyle(n).borderInlineStartWidth)).toBe('3px');
      }
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const axe=await new AxeBuilder({page}).include('.workspace-main,[data-workspace-payment]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
      expect(axe.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
      await page.screenshot({path:testInfo.outputPath(`${viewport.name}-${story}.png`),fullPage:true});
    }
  });
}
