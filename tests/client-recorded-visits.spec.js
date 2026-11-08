'use strict';
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const express = require('express');
const { clientRecordedVisitsFixture } = require('./helpers/clientRecordedVisitsFixture');
const { createWorkspaceClientsRouter } = require('../src/routes/workspaceClients');

for (const width of [390,1440]) {
  test(`recorded client summaries preserve search and guest context at ${width}`, async ({ page }, info) => {
    const begun=Date.now();
    const f = await clientRecordedVisitsFixture();
    for (const [id,date] of [[1,'2026-08-01'],[2,'2026-08-22'],[3,'2026-09-12'],[4,'2026-10-03']]) await f.add({ id,date });
    await f.add({ id:5,client:2,status:'no_charge',services:[{id:11,name:'Facial'}] });
    const app=express();
    app.use('/calendar/clients',createWorkspaceClientsRouter({
      env:{SHILOH_CALENDAR_READONLY_UX_ENABLED:'true',SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED:'true'},
      sessionService:{validateSessionToken:async()=>({ok:true,adminId:41})},service:f.service,
      paymentService:{getDirectoryReviews:async()=>({'1':{state:'restricted'},'2':{state:'restricted'}})},
      notificationService:{resolveAccess:async()=>null},creditService:{canView:async()=>{throw Error('Synthetic denied');}},
    }));
    const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const origin=`http://127.0.0.1:${server.address().port}`;
    const requests=[];page.on('request',request=>requests.push(request.method()));
    await page.route('**/calendar/pwa/icon-192.png*',route=>route.fulfill({path:require('node:path').resolve('public/assets/brand/shiloh-mark-192.png')}));
    await page.setViewportSize({width,height:950});
    try {
      await page.goto(origin+'/calendar/clients?status=active');
      await expect(page.locator('.client-row').first()).toContainText('4 recorded visits · past 12 months');
      await expect(page.locator('.client-row').nth(1)).toContainText('1 recorded visit · past 12 months');
      await expect(page.locator('.client-row').first()).toContainText('Back massage · 4 visits');
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
      await page.screenshot({path:info.outputPath(`recorded-directory-${width}.png`),fullPage:true});
      const input=page.getByLabel('Name or mobile number');await input.fill('Alpha');
      await expect(page.locator('.client-row')).toHaveCount(1);
      await page.getByRole('link',{name:'Synthetic Alpha',exact:true}).click();
      const summary=page.getByRole('region',{name:'Recorded visits'});
      await expect(summary).toContainText('About every 3 weeks');
      await expect(summary).toContainText('Older records may be incomplete');
      await expect(summary).toContainText('Back massage · 4 visits');
      await expect(summary.getByRole('link',{name:'View appointments'})).toHaveAttribute('href',/services=appointments.*returnTo=/);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      expect((await new AxeBuilder({page}).include('[data-client-detail-view]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
      await page.screenshot({path:info.outputPath(`recorded-overview-${width}.png`),fullPage:true});
      await summary.getByRole('link',{name:'View appointments'}).click();
      await expect(page.locator('[data-client-home-section]')).toHaveAttribute('data-client-home-section','appointments');
      await expect(page.getByRole('region',{name:'Recorded visits'})).toHaveCount(0);
      await page.getByRole('link',{name:'Back to Clients',exact:true}).click();
      await expect(page.getByLabel('Name or mobile number')).toHaveValue('Alpha');
      await expect(page.locator('.client-row')).toHaveCount(1);
      expect(requests.every(method=>method==='GET')).toBe(true);
      expect((await f.db.query('SELECT COUNT(*)::int n FROM appointments')).rows[0].n).toBe(5);
      console.log(JSON.stringify({proof:'recorded-visits-browser',width,phase:'assertions passed',elapsedMs:Date.now()-begun}));
    } finally {
      // Close this fixture's browser connections before awaiting its HTTP server.
      // Otherwise an idle/aborted background read can hold teardown until timeout.
      await page.close();
      await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
      await f.close();
      console.log(JSON.stringify({proof:'recorded-visits-browser',width,phase:'isolated fixture closed',elapsedMs:Date.now()-begun}));
    }
  });
}
