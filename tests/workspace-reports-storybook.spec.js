const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

for (const viewport of [
  { name: 'desktop', width: 1440, height: 960 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'narrow-phone', width: 320, height: 720 },
  { name: 'large-text-phone', width: 320, height: 720, largeText: true },
]) {
  test(`Reports Storybook surface is clear and accessible on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/iframe.html?id=workspace-reports--clinic-overview&viewMode=story', { waitUntil: 'networkidle' });

    if (viewport.largeText) await page.addStyleTag({content:'html{font-size:200%}'});
    const surface = page.locator('.workspace-report-story');
    await expect(surface).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Clinic reports', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Clinic summary', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Today', exact: true })).toHaveAttribute('href', /range=today/);
    await expect(page.getByRole('link', { name: 'This week', exact: true })).toHaveAttribute('href', /range=week/);
    await expect(page.getByRole('link', { name: 'Export finances', exact: true })).toHaveAttribute('href', /financial.csv/);
    expect(await page.locator('[data-financial-reports]').innerText()).toContain('Completed treatment value');
    await expect(page.getByRole('heading', { name: 'Team', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Team booking time' })).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Calculated commission & treatment value' })).toBeHidden();
    await expect(page.locator('.financial-card')).toHaveCount(3);
    await expect(page.getByRole('navigation', {name:'Report sections'}).getByRole('link')).toHaveCount(3);
    await expect(page.getByRole('link', {name:'This month',exact:true})).toBeVisible();
    await expect(page.getByLabel('From',{exact:true})).toBeHidden();
    await page.locator('.custom-period > summary').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('From',{exact:true})).toBeVisible();
    await expect(page.getByLabel('To',{exact:true})).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('From',{exact:true})).toBeHidden();
    await expect(page.locator('details[data-report-section][open]')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Commission structure' })).toBeHidden();
    expect(await page.locator('#team .metrics').evaluate(node=>Boolean(node.compareDocumentPosition(document.querySelector('#staff-earnings')) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`reports-compact-${viewport.name}.png`),fullPage:true});
    await page.addScriptTag({content:require('../src/presentation/workspaceReportsUx').reportSectionsClientScript()});
    await page.locator('.financial-card[href="#financial-receipts"]').click();
    await expect(page.locator('#money')).toHaveAttribute('open','');
    await expect(page.locator('#financial-receipts')).toHaveAttribute('open','');
    const methodTable = page.locator('#financial-receipts .financial-table-scroll').first();
    await expect(methodTable).toHaveAttribute('tabindex', '0');
    await methodTable.focus();
    await expect(methodTable).toBeFocused();
    await expect(page.getByText('Gift-voucher order #10', {exact:true})).toBeVisible();
    await page.locator('.financial-card[href="#financial-balances"]').click();
    await expect(page.getByRole('link',{name:'Linked booking #14',exact:true})).toHaveAttribute('href', '/calendar/payments/appointments/738');
    await page.getByRole('link', {name:'Record expense',exact:true}).click();
    await expect(page.getByLabel('Amount paid (R)',{exact:true})).toBeVisible();
    await expect(page.getByText('Massage oils · R125,50',{exact:true})).toBeVisible();
    await page.getByRole('link', {name:'Review / close cash-up',exact:true}).click();
    await expect(page.getByRole('button',{name:'Review this day',exact:true})).toBeVisible();
    if (viewport.width <= 700) {
      expect(await page.evaluate(() => document.querySelector('#financial-cashup > summary').getBoundingClientRect().top >= document.querySelector('.jump-row').getBoundingClientRect().bottom + 2), 'Cash-up heading must clear the sticky section menu').toBe(true);
    }
    await expect(page.getByLabel('Cash counted, including float (R)',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Save daily close',exact:true})).toBeDisabled();
    await page.getByRole('navigation',{name:'Report sections'}).getByRole('link', {name:'Team',exact:true}).click();
    await page.locator('#staff-earnings > summary').click();
    await expect(page.locator('#staff-earnings')).toHaveAttribute('open','');
    await expect(page.getByRole('heading', { name: 'Commission structure' })).toBeHidden();
    await page.locator('#commission-rules > summary').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Commission structure' })).toBeVisible();
    await page.locator('#team-time > summary').click();
    await expect(page.locator('#team-time')).toHaveAttribute('open','');
    if (viewport.width <= 380) {
      const labels=await page.locator('.capacity-table td[data-label]').evaluateAll(cells=>cells.map(cell=>{
        const style=getComputedStyle(cell,'::before');
        const canvas=document.createElement('canvas');const context=canvas.getContext('2d');
        context.font=`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const longest=Math.max(...cell.dataset.label.toUpperCase().split(/\s+/).map(word=>context.measureText(word).width + Math.max(0,word.length-1)*(parseFloat(style.letterSpacing)||0)));
        const available=cell.clientWidth-parseFloat(getComputedStyle(cell).paddingLeft)-parseFloat(getComputedStyle(cell).paddingRight);
        return {label:cell.dataset.label,longest,available};
      }));
      expect(labels.filter(label=>label.longest>label.available+1),'Team time labels must fit without fragmented words on narrow phones').toEqual([]);
      await page.locator('.capacity-table').screenshot({path:testInfo.outputPath(`reports-team-time-${viewport.name}.png`)});
    }
    await page.getByRole('navigation',{name:'Report sections'}).getByRole('link', {name:'Activity',exact:true}).click();
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
      scrollX: window.scrollX,
      overflowing: [...document.querySelectorAll('.workspace-report-story *')].filter(node=>node.getClientRects().length && node.getBoundingClientRect().right + scrollX > innerWidth + 1 && !node.closest('.financial-table-scroll')).map(node=>({tag:node.tagName,classes:node.className,right:node.getBoundingClientRect().right + scrollX,text:node.textContent.slice(0,100)})).slice(0,12),
      targets: [...document.querySelectorAll('.workspace-report-story button,.workspace-report-story input,.workspace-report-story select,.workspace-report-story a,.workspace-report-story summary')]
        .filter(node => node.getClientRects().length > 0)
        .map(node => ({
          label: node.textContent.trim() || node.getAttribute('aria-label') || node.id,
          width: node.getBoundingClientRect().width,
          height: node.getBoundingClientRect().height,
        })),
    }));
    expect(geometry.documentWidth,JSON.stringify({scrollX:geometry.scrollX,overflowing:geometry.overflowing})).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    if (viewport.width <= 700) {
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


test('Reports scope, empty periods and existing deep links stay clear', async ({ page }, testInfo) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/iframe.html?id=workspace-reports--selected-team-member&viewMode=story', {waitUntil:'networkidle'});
  await expect(page.getByLabel('Team member · Team & Activity')).toHaveValue('11');
  await expect(page.getByRole('link',{name:'This month',exact:true})).toHaveAttribute('href', /range=month&staff=11/);
  await expect(page.locator('[data-financial-reports]')).toContainText('Whole clinic');
  const finance = await page.locator('.financial-cards').innerText();
  await page.addScriptTag({content:require('../src/presentation/workspaceReportsUx').reportSectionsClientScript()});
  await page.locator('.financial-card[href="#financial-balances"]').click();
  await expect(page.locator('#money')).toHaveAttribute('open','');
  await expect(page.locator('#financial-balances')).toHaveAttribute('open','');
  await expect(page.locator('#financial-balances')).toContainText('have no booking allocation yet');
  await page.getByRole('navigation',{name:'Report sections'}).getByRole('link',{name:'Team',exact:true}).click();
  await expect(page.locator('#team')).toContainText('23h');
  await page.screenshot({path:testInfo.outputPath('reports-selected-team-phone.png'),fullPage:true});
  await page.goto('/iframe.html?id=workspace-reports--clinic-overview&viewMode=story', {waitUntil:'networkidle'});
  expect(await page.locator('.financial-cards').innerText()).toBe(finance);
  await page.goto('/iframe.html?id=workspace-reports--own-appointments&viewMode=story', {waitUntil:'networkidle'});
  await expect(page.locator('#money')).toHaveCount(0);
  await expect(page.locator('[data-financial-reports],#staff-earnings,[data-expense-form]')).toHaveCount(0);
  await expect(page.getByLabel('Team member · Team & Activity').locator('option')).toHaveCount(1);
  await expect(page.getByRole('navigation',{name:'Report sections'}).getByRole('link')).toHaveCount(2);
  await page.screenshot({path:testInfo.outputPath('reports-own-scope-phone.png'),fullPage:true});
  await page.goto('/iframe.html?id=workspace-reports--empty-period&viewMode=story', {waitUntil:'networkidle'});
  await page.addScriptTag({content:require('../src/presentation/workspaceReportsUx').reportSectionsClientScript()});
  await page.getByRole('navigation',{name:'Report sections'}).getByRole('link',{name:'Activity',exact:true}).click();
  await expect(page.getByText('No appointments were recorded in this period.',{exact:true})).toBeVisible();
  await page.getByRole('navigation',{name:'Report sections'}).getByRole('link',{name:'Money',exact:true}).click();
  await expect(page.getByRole('link',{name:'Record expense',exact:true})).toBeVisible();
  await expect(page.locator('#money')).toContainText('Profit and commission still payable are not calculated');
  await page.screenshot({path:testInfo.outputPath('reports-empty-period-phone.png'),fullPage:true});
});
