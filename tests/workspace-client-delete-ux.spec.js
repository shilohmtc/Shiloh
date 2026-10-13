const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { workspaceClientsManageClientScript } = require('../src/presentation/workspaceClientsManageUx');
for (const [name,width,height] of [['phone',390,844],['desktop',1280,900]]) {
  test(`permanent client deletion has safe cancellation, linked-record error and exact retry on ${name}`,async({page},testInfo)=>{
    await page.setViewportSize({width,height});
    await page.route('**/calendar/pwa/icon-192.png*',r=>r.fulfill({path:require('node:path').resolve('public/assets/brand/shiloh-mark-192.png')}));
    let calls=[];
    await page.route('**/calendar/staff-auth/csrf',r=>r.fulfill({json:{csrfToken:'synthetic-csrf'}}));
    await page.route('**/calendar/clients/*/delete',r=>{
      expect(r.request().headers()['x-shiloh-csrf-token']).toBe('synthetic-csrf');
      const body=r.request().postDataJSON(); calls.push(body);
      expect(body.confirmation).toBe('DELETE');
      return r.fulfill({status:409,json:{code:'WORKSPACE_CLIENT_DELETE_LINKED',error:'This profile cannot be permanently deleted because it is linked to appointments, payments, an app account, or other clinic records. No records were deleted.'}});
    });
    await page.goto('/iframe.html?id=workspace-clients--clinic-client-deletion&viewMode=story');
    const button=page.getByRole('button',{name:'Delete client',exact:true});
    await expect(button).toBeVisible();
    await expect(page.getByRole('button',{name:'Archive client',exact:true})).toHaveCount(0);
    await page.addScriptTag({content:workspaceClientsManageClientScript()});
    await button.scrollIntoViewIfNeeded();
    await button.click();
    const dialog=page.getByRole('dialog',{name:'Permanently delete client?'});
    await expect(dialog.getByRole('button',{name:'Keep client'})).toBeFocused();
    await expect(dialog).toContainText('cannot be undone');
    expect((await new AxeBuilder({page}).include('[data-shiloh-confirm]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({path:testInfo.outputPath(`client-delete-confirm-${name}.png`),fullPage:false});
    await page.keyboard.press('Escape');
    await expect(button).toBeFocused(); expect(calls).toHaveLength(0);
    await button.click(); await dialog.getByRole('button',{name:'Keep client'}).click(); expect(calls).toHaveLength(0);
    await button.click(); await dialog.getByRole('button',{name:'Delete permanently'}).click();
    await expect(page.locator('[data-client-operation-status]')).toContainText('No records were deleted.');
    await expect(button).toBeEnabled(); expect(calls).toHaveLength(1);
    await button.click(); await dialog.getByRole('button',{name:'Delete permanently'}).click();
    await expect.poll(()=>calls.length).toBe(2); expect(calls[1]).toEqual(calls[0]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).include('[data-client-management]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({path:testInfo.outputPath(`client-delete-blocked-${name}.png`),fullPage:false});
    await page.route('**/calendar/clients',r=>r.fulfill({contentType:'text/html',body:'<h1>Clients</h1>'}));
    await page.unroute('**/calendar/clients/*/delete');
    await page.route('**/calendar/clients/*/delete',r=>r.fulfill({json:{status:'deleted'}}));
    await button.click(); await dialog.getByRole('button',{name:'Delete permanently'}).click();
    await expect(page).toHaveURL(/\/calendar\/clients$/);
    await expect(page.getByRole('heading',{name:'Clients'})).toBeVisible();
  });
}
