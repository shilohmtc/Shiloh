const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { renderPaymentStatusPage } = require('../src/presentation/paymentStatusUx');

for (const viewport of [{ name:'phone', width:390, height:844 }, { name:'desktop', width:1280, height:900 }]) {
  test(`received payment returns to My Shiloh on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/iframe.html?id=client-payment-status--payment-received&viewMode=story', { waitUntil:'networkidle' });
    const card = page.locator('[data-payment-status-story] .card');
    const link = card.getByRole('link', { name:'Back to My Shiloh', exact:true });
    await expect(card.getByRole('heading', { name:'Payment received', exact:true })).toBeVisible();
    await expect(card).toContainText('You do not need to pay again.');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/my-shiloh/');
    const size = await link.boundingBox();
    expect(size.height).toBeGreaterThanOrEqual(44);
    expect(size.x).toBeGreaterThanOrEqual(0);
    expect(size.x + size.width).toBeLessThanOrEqual(viewport.width);
    await link.focus();
    expect(await link.evaluate(node => getComputedStyle(node).outlineStyle)).toBe('solid');
    const axe = await new AxeBuilder({ page }).include('[data-payment-status-story]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    expect(axe.violations).toEqual([]);
    await page.screenshot({ path:testInfo.outputPath(`payment-received-${viewport.name}.png`), fullPage:true });

    // Exercise the production-rendered route; destination is read-only synthetic client content.
    const reference = 'private_request_123';
    await page.route('**/pay/status/private_request_123', route => route.fulfill({ contentType:'text/html', body:renderPaymentStatusPage({ requestKey:reference, request:{ amount:'125.00', state:'paid' } }) }));
    await page.route('**/my-shiloh/', route => {
      expect(route.request().method()).toBe('GET');
      expect(route.request().url()).not.toContain(reference);
      return route.fulfill({ contentType:'text/html', body:'<!doctype html><html lang="en"><title>My Shiloh</title><main><h1>My Shiloh</h1></main></html>' });
    });
    await page.goto('/pay/status/private_request_123');
    const returned = page.getByRole('link', { name:'Back to My Shiloh', exact:true });
    await returned.focus();
    await returned.press('Enter');
    await expect(page).toHaveURL(new URL('/my-shiloh/', testInfo.project.use.baseURL).toString());
    await expect(page.getByRole('heading', { name:'My Shiloh' })).toBeVisible();
    expect(page.context().pages()).toHaveLength(1);
  });
}
