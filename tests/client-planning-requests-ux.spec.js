const { test,expect }=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const { planningRequestClientScript }=require('../src/presentation/workspaceDashboardUx');

for(const viewport of [{ name:'phone',width:390,height:844 },{ name:'desktop',width:1280,height:900 }]) {
  test(`flexible request refresh, selection, recovery and confirmation on ${viewport.name}`,async({ page },testInfo)=>{
    await page.setViewportSize({ width:viewport.width,height:viewport.height });
    let available=false,attempts=0;
    const submissions=[];
    await page.route('**/calendar/workspace/planning-requests/81/appointments',route=>route.fulfill({ json:{ appointments:available?[
      { id:801,startsAt:'2030-12-16T08:00:00Z',serviceName:'Couples Massage',staffNames:'Synthetic practitioner A' },
      { id:802,startsAt:'2030-12-16T10:00:00Z',serviceName:'Sports Massage',staffNames:'Synthetic practitioner B' },
    ]:[] } }));
    await page.route('**/calendar/staff-auth/csrf',route=>route.fulfill({ json:{ csrfToken:'valid-csrf' } }));
    await page.route('**/calendar/workspace/planning-requests/81/arranged',async route=>{
      attempts++;submissions.push(route.request().postDataJSON());
      expect(route.request().headers()['x-shiloh-csrf-token']).toBe('valid-csrf');
      await route.fulfill(attempts===1?{ status:409,json:{ code:'PLANNING_APPOINTMENT_MISMATCH',error:'That appointment changed. Refresh appointments and choose an approved upcoming booking for this client.' } }:{ json:{ id:81,status:'arranged' } });
    });
    await page.goto('/iframe.html?id=client-planning-requests--reception-attention&viewMode=story',{ waitUntil:'networkidle' });
    await page.addScriptTag({ content:planningRequestClientScript() });
    const card=page.locator('[data-dashboard-planning-request="81"]');
    const select=card.getByLabel('Arranged appointment');
    const confirm=card.getByRole('button',{ name:'Confirm arranged appointment' });
    const refresh=card.getByRole('button',{ name:'Refresh appointments' });
    await expect(card).not.toContainText('Start planning');await expect(card).not.toContainText('Cannot accommodate');
    await expect(select).toBeDisabled();await expect(confirm).toBeDisabled();
    await expect(card.locator('[data-planning-empty]')).toBeVisible();
    await expect(card.getByRole('link',{ name:'Arrange appointment in Calendar' })).toHaveAttribute('href',/\/calendar\/read-only/);
    await refresh.click();await expect(card.locator('[data-planning-status]')).toContainText('No approved upcoming appointment');
    await page.screenshot({ path:testInfo.outputPath(`planning-empty-${viewport.name}.png`),fullPage:true,animations:'disabled' });
    available=true;await refresh.click();await expect(select).toBeEnabled();await expect(confirm).toBeDisabled();
    await expect(select.locator('option')).toHaveCount(3);await expect(select).toContainText('Couples Massage');
    await expect(select).toContainText('Synthetic practitioner A');await expect(card.locator('[data-planning-empty]')).toBeHidden();
    await select.selectOption('801');await expect(confirm).toBeEnabled();
    await select.selectOption('');await expect(confirm).toBeDisabled();
    await select.selectOption('802');await confirm.click();
    await expect(card.locator('[data-planning-status]')).toContainText('That appointment changed');await expect(confirm).toBeEnabled();
    await refresh.click();await expect(select).toHaveValue('802');await expect(confirm).toBeEnabled();
    await expect(card.locator('[data-planning-status]')).toHaveAttribute('data-tone','ready');
    await expect(card.locator('[data-planning-selected]')).toContainText('Synthetic practitioner B');
    expect((await new AxeBuilder({ page }).include('[data-dashboard-attention-panel]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({ path:testInfo.outputPath(`planning-arranged-${viewport.name}.png`),fullPage:true,animations:'disabled' });
    await confirm.click();await expect(card.locator('[data-planning-status]')).toContainText('Arranged appointment confirmed');
    expect(submissions).toEqual([{ appointmentId:802 },{ appointmentId:802 }]);
    await expect(select).toBeDisabled();await expect(confirm).toBeDisabled();
  });

  test(`historical planning request shows the same arrangement controls on ${viewport.name}`,async({ page })=>{
    await page.setViewportSize({ width:viewport.width,height:viewport.height });
    await page.goto('/iframe.html?id=client-planning-requests--reception-appointments&viewMode=story',{ waitUntil:'networkidle' });
    await page.addScriptTag({ content:planningRequestClientScript() });
    const card=page.locator('[data-dashboard-planning-request="81"]');
    await expect(card).toContainText('Awaiting appointment');await expect(card).not.toContainText('Start planning');
    await expect(card).not.toContainText('Cannot accommodate');
    await expect(card.getByRole('button',{ name:'Confirm arranged appointment' })).toBeDisabled();
    await card.getByLabel('Arranged appointment').selectOption('801');
    await expect(card.getByRole('button',{ name:'Confirm arranged appointment' })).toBeEnabled();
  });
}
