const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

for (const viewport of [
  { name: 'desktop', width: 1440, height: 960 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test(`Reports Storybook surface is clear and accessible on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/iframe.html?id=workspace-reports--clinic-overview&viewMode=story', { waitUntil: 'networkidle' });

    const surface = page.locator('.workspace-report-story');
    await expect(surface).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Clinic reports', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Financial overview', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Today', exact: true })).toHaveAttribute('href', /range=today/);
    await expect(page.getByRole('link', { name: 'This week', exact: true })).toHaveAttribute('href', /range=week/);
    await expect(page.getByRole('link', { name: 'Export finances', exact: true })).toHaveAttribute('href', /financial.csv/);
    expect(await page.locator('[data-financial-reports]').innerText()).toContain('Completed treatment value');
    await expect(page.getByRole('heading', { name: 'Team booking time' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Team treatment value & commission' })).toBeVisible();
    await expect(page.locator('details[data-report-section][open]')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Commission structure' })).toBeHidden();
    expect(await page.locator('.metrics').evaluate(node=>Boolean(node.compareDocumentPosition(document.querySelector('#staff-earnings')) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`reports-compact-${viewport.name}.png`),fullPage:true});
    await page.addScriptTag({content:require('../src/presentation/workspaceReportsUx').reportSectionsClientScript()});
    await page.getByRole('link', {name:'Receipts',exact:true}).click();
    await expect(page.locator('#financial-receipts')).toHaveAttribute('open','');
    const methodTable = page.locator('#financial-receipts .financial-table-scroll').first();
    await expect(methodTable).toHaveAttribute('tabindex', '0');
    await methodTable.focus();
    await expect(methodTable).toBeFocused();
    await expect(page.getByText('Gift-voucher order #10', {exact:true})).toBeVisible();
    await page.getByRole('link', {name:'Balances',exact:true}).click();
    await expect(page.getByRole('link',{name:'Linked booking #14',exact:true})).toHaveAttribute('href', '/calendar/payments/appointments/738');
    await page.getByRole('link', {name:'Expenses',exact:true}).click();
    await expect(page.getByLabel('Amount paid (R)',{exact:true})).toBeVisible();
    await expect(page.getByText('Massage oils · R125,50',{exact:true})).toBeVisible();
    await page.getByRole('link', {name:'Cash-up',exact:true}).click();
    await expect(page.getByRole('button',{name:'Review this day',exact:true})).toBeVisible();
    if (viewport.name === 'phone') {
      expect(await page.evaluate(() => document.querySelector('#financial-cashup > summary').getBoundingClientRect().top >= document.querySelector('.jump-row').getBoundingClientRect().bottom + 2), 'Cash-up heading must clear the sticky section menu').toBe(true);
    }
    await expect(page.getByLabel('Cash counted, including float (R)',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Save daily close',exact:true})).toBeDisabled();
    await page.getByRole('link', {name:'Earnings',exact:true}).click();
    await expect(page.locator('#staff-earnings')).toHaveAttribute('open','');
    await expect(page.getByRole('heading', { name: 'Commission structure' })).toBeVisible();
    await page.getByRole('link', {name:'Team',exact:true}).click();
    await expect(page.locator('#team-time')).toHaveAttribute('open','');
    await page.locator('#treatments > summary').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#treatments .service-list')).toBeVisible();
    await page.locator('#clients > summary').click();
    await expect(page.locator('#clients .client-grid')).toBeVisible();
    await expect(page.locator('#staff-earnings').getByRole('link', { name: 'Appointment #732', exact: true })).toHaveAttribute('href', /appointment=732/);
    await expect(page.getByText('Shared appointment — review allocation')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Treatments booked' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'New and returning clients' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'View report' })).toBeVisible();

    const text = await surface.innerText();
    expect(text).not.toMatch(/canonical|business-wide operational|practitioner authority|service snapshot|aggregate identity|utilisation|fail closed/i);

    const geometry = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      targets: [...document.querySelectorAll('.workspace-report-story button,.workspace-report-story input,.workspace-report-story select,.workspace-report-story a,.workspace-report-story summary')]
        .filter(node => node.getClientRects().length > 0)
        .map(node => ({
          label: node.textContent.trim() || node.getAttribute('aria-label') || node.id,
          width: node.getBoundingClientRect().width,
          height: node.getBoundingClientRect().height,
        })),
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    if (viewport.name === 'phone') {
      expect(geometry.targets.filter(target => target.height < 43 || target.width < 43), 'Phone controls must retain 44px touch targets').toEqual([]);
    }

    const accessibility = await new AxeBuilder({ page })
      .include('.workspace-report-story')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(accessibility.violations.filter(item => ['serious', 'critical'].includes(item.impact))).toEqual([]);

    await page.screenshot({
      path: testInfo.outputPath(`reports-${viewport.name}.png`),
      fullPage: true,
    });
  });
}
