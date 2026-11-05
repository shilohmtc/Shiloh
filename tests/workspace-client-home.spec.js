'use strict';
const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
for(const width of [390,1440]) {
  test(`client home shows one selected section at ${width}`,async({page},info)=>{
    await page.setViewportSize({width,height:900});
    await page.route('**/calendar/pwa/icon-192.png*',route=>route.fulfill({path:require('node:path').resolve('public/assets/brand/shiloh-mark-192.png')}));
    for(const [section,story] of [['overview','client-profile-services'],['forms','client-home-forms'],['rewards','client-home-rewards'],['vouchers','client-home-vouchers'],['activity','client-home-activity'],['appointments','client-appointment-history']]) {
      await page.goto(`/iframe.html?id=workspace-production-surfaces--${story}&viewMode=story`,{waitUntil:'networkidle'});
      const home=page.locator('[data-client-home-section]');
      await expect(home).toHaveAttribute('data-client-home-section',section);
      const nav=home.getByRole('navigation',{name:'Client sections'});
      await expect(nav.getByRole('link')).toHaveCount(6);
      await expect(nav.locator('[aria-current="page"]')).toHaveText(section==='activity'?'Communications':section[0].toUpperCase()+section.slice(1));
      await expect(home.locator('.profile-heading')).toBeVisible();
      if(section==='overview') await expect(home.locator('.profile-grid')).toBeVisible();
      else await expect(home.locator('.profile-grid')).toBeHidden();
      if(section==='forms') await expect(home.getByRole('link',{name:'View signed form'})).toHaveAttribute('href','/calendar/clients/9012/consultation-forms/7001');
      if(section==='rewards') await expect(home.getByText('Recorded balance: R120.00')).toBeVisible();
      if(section==='vouchers') {
        await expect(home.getByText('SV-SYNTHETIC-RECEIVED')).toBeVisible();
        await expect(home.getByText('SV-SYNTHETIC-PURCHASED')).toBeVisible();
      }
      if(section==='activity') await expect(home.getByText('Available in My Shiloh',{exact:true})).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await expect.poll(async()=>{
        try{return (await new AxeBuilder({page}).include('[data-client-detail-view]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations;}
        catch(e){if(e.message.includes('Axe is already running'))return ['retry'];throw e;}
      }).toEqual([]);
      await page.screenshot({path:info.outputPath(`client-${section}-${width}.png`),fullPage:true});
    }
  });
  test(`directory keeps search visible and opens Add client at ${width}`,async({page},info)=>{
    await page.setViewportSize({width,height:900});
    await page.route('**/calendar/pwa/icon-192.png*',route=>route.fulfill({path:require('node:path').resolve('public/assets/brand/shiloh-mark-192.png')}));
    await page.goto('/iframe.html?id=workspace-clients--marietjie-client-base&viewMode=story',{waitUntil:'networkidle'});
    await expect(page.locator('.search-panel')).toBeVisible();
    await expect(page.locator('#new-client-name')).toBeHidden();
    await expect(page.locator('.client-row')).not.toContainText(['Mobile ending']);
    await page.locator('[data-client-create-details] summary').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#new-client-name')).toBeVisible();
    await page.locator('#new-client-name').fill('Synthetic New Client');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`directory-${width}.png`),fullPage:true});
  });
}

test('client navigation keeps the booking return and legacy document links select Forms',async({page})=>{
  const {renderClientDetailPageWithCommunications}=require('../src/presentation/workspaceCommunicationEvidenceUx');
  const {clientHomeScript}=require('../src/presentation/workspaceClientHomeUx');
  const model={client:{id:42,name:'Synthetic linked client',status:'active'},appointments:[],historyOffset:0,pageSize:20,policyAcceptances:[],returnHref:'/calendar/read-only?view=week&date=2030-01-01&appointment=201'};
  await page.route('**/calendar/clients/home.js',route=>route.fulfill({contentType:'application/javascript',body:clientHomeScript()}));
  await page.route(/\/calendar\/clients\/42(?:\?|$)/,route=>{const url=new URL(route.request().url());return route.fulfill({contentType:'text/html',body:renderClientDetailPageWithCommunications({...model,services:url.searchParams.get('services')||'overview'})});});
  await page.goto('/calendar/clients/42?returnTo='+encodeURIComponent(model.returnHref));
  await page.getByRole('navigation',{name:'Client sections'}).getByRole('link',{name:'Vouchers',exact:true}).click();
  await expect(page.locator('[data-client-home-section]')).toHaveAttribute('data-client-home-section','vouchers');
  await expect(page.getByRole('link',{name:'Back to booking',exact:true})).toHaveAttribute('href',model.returnHref);
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe(model.returnHref);
  await page.goto('/calendar/clients/42?returnTo='+encodeURIComponent(model.returnHref)+'#policy-documents');
  await expect(page.locator('[data-client-home-section]')).toHaveAttribute('data-client-home-section','forms');
  await expect(page.getByRole('heading',{name:'Booking Policy & Terms'})).toBeVisible();
});
