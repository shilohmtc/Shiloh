const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { WORKSPACE_ACTION_PALETTE } = require('../src/presentation/shilohUxTokens');
const { workspaceNavigationClientScript } = require('../src/presentation/workspaceShell');
const path = require('node:path');
const fs = require('node:fs');
const evidence = path.resolve('artifacts/workspace-action-standard');
const rgb = hex => `rgb(${parseInt(hex.slice(1,3),16)}, ${parseInt(hex.slice(3,5),16)}, ${parseInt(hex.slice(5,7),16)})`;

test.beforeEach(async({page})=>{
  await page.route('**/calendar/pwa/icon-192.png*',r=>r.fulfill({path:path.resolve('public/assets/pwa/shiloh-pwa-192.png')}));
});

const surfaces = [
  ['deposits','workspace-production-surfaces--dashboard-awaiting-deposits'],
  ['forms','workspace-required-forms--appointment-context'],
  ['clients','workspace-clients--marietjie-client-base'],
  ['client-management','workspace-clients--marietjie-client-management'],
  ['staff','workspace-staff-access--staff-detail'],
  ['services','workspace-services--marietjie-service-management'],
  ['categories','workspace-services--christel-category-management'],
  ['create-service','workspace-services--create-service'],
  ['packages','workspace-packages--management'],
  ['reports','workspace-reports--focused-workspace-reports'],
  ['messages','workspace-production-surfaces--messages-attention'],
  ['clinic-hours','workspace-production-surfaces--clinic-and-assistant-hours'],
  ['payments','workspace-production-surfaces--booking-deposit-awaiting'],
  ['payment-review','workspace-production-surfaces--cancelled-booking-payment-review'],
  ['vouchers','shiloh-gift-vouchers--workspace-balances'],
  ['rewards','shiloh-shiloh-rewards--workspace-balances'],
  ['problem-reports','workspace-problem-reports--jp-inbox'],
  ['staff-access','workspace-staff-access--administrator-access'],
  ['access-off','workspace-staff-access--access-off'],
];

for(const viewport of [{name:'phone',width:390,height:844},{name:'desktop',width:1440,height:960}]) {
  test(`Workspace action roles retain meaning, focus and touch geometry on ${viewport.name}`,async({page})=>{
    test.setTimeout(240000);
    await page.setViewportSize(viewport);
    for(const [name,story] of surfaces){
      await page.goto(`/iframe.html?id=${story}&viewMode=story`,{waitUntil:'networkidle'});
      await expect(page.locator('.workspace-main,[data-workspace-payment]').first()).toBeVisible();
      const controls=page.locator(':is(.workspace-main,[data-workspace-payment]) [data-workspace-action]');
      expect(await controls.count(),name).toBeGreaterThan(0);
      for(const control of await controls.all()){
        if(!await control.isVisible())continue;
        const role=await control.getAttribute('data-workspace-action'),colour=WORKSPACE_ACTION_PALETTE[role];
        expect(colour,`${name}: ${role}`).toBeTruthy();
        await page.mouse.move(0,0);
        expect(await control.evaluate(n=>getComputedStyle(n).backgroundColor),`${name}: ${await control.textContent()}`).toBe(rgb(colour.background));
        expect(await control.evaluate(n=>getComputedStyle(n).color)).toBe(rgb(colour.ink));
        const size=await control.boundingBox();expect(size.height).toBeGreaterThanOrEqual(44);
        if(!await control.isDisabled()){
          await control.focus();await expect(control).toBeFocused();
          const focus=await control.evaluate(n=>({width:getComputedStyle(n).outlineWidth,style:getComputedStyle(n).outlineStyle}));
          expect(parseFloat(focus.width)).toBeGreaterThanOrEqual(3);expect(focus.style).toBe('solid');
          await control.hover();expect(await control.evaluate(n=>getComputedStyle(n).backgroundColor)).toBe(rgb(colour.hover));
        }
      }
      const axe=await new AxeBuilder({page}).include('.workspace-main,[data-workspace-payment]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
      fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,`axe-${name}-${viewport.name}.json`),JSON.stringify(axe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.html)})),null,2));
      expect(axe.violations.filter(v=>['serious','critical'].includes(v.impact)),name).toEqual([]);
      if(['deposits','forms','client-management','services','payments'].includes(name)){
        await page.mouse.move(0,0);await page.evaluate(()=>document.activeElement?.blur());fs.mkdirSync(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,`${name}-${viewport.name}.png`),fullPage:true});
      }
      if(name==='deposits'){
        await expect(page.locator('[data-dashboard-deposits]')).toContainText('Part of the deposit is recorded.');
        await expect(page.locator('[data-dashboard-deposits]')).toContainText('Payment evidence needs review');
        await expect(page.locator('[data-dashboard-deposits] [data-workspace-action="create"]')).toHaveCount(0);
      }
      if(name==='forms')await expect(page.getByRole('link',{name:'Back to Calendar',exact:true})).toHaveAttribute('href','/calendar?view=week&date=2026-10-07&appointment=901');
    }
  });
}

test('Contextual Back keeps filters and history pages, and rejects foreign or wrong list destinations',async({page})=>{
  await page.goto('/iframe.html?id=workspace-clients--marietjie-client-base&viewMode=story',{waitUntil:'networkidle'});
  const list=await page.content();
  await page.goto('/iframe.html?id=workspace-production-surfaces--client-appointment-history&viewMode=story',{waitUntil:'networkidle'});
  const detail=await page.content();
  await page.route('**/calendar/pwa/icon-192.png*',r=>r.fulfill({path:path.resolve('public/assets/pwa/shiloh-pwa-192.png')}));
  await page.route('**/calendar/workspace/navigation',r=>r.fulfill({json:{}}));
  await page.route('**/calendar/clients**',r=>r.fulfill({contentType:'text/html',body:new URL(r.request().url()).pathname==='/calendar/clients'?list:detail}));
  const context='/calendar/clients?q=synthetic&status=active&offset=24';
  await page.goto(context);await page.addScriptTag({content:workspaceNavigationClientScript()});
  const row=page.locator('.client-row').first();
  expect(new URL(await row.getAttribute('href'),'http://127.0.0.1:6006').searchParams.get('returnTo')).toBe(context);
  await row.click();await page.addScriptTag({content:workspaceNavigationClientScript()});
  const back=page.locator('[data-workspace-back-context]');await expect(back).toHaveAttribute('href',context);
  await back.focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(/q=synthetic&status=active&offset=24$/);
  for(const rejected of ['https://evil.example/calendar/clients','//evil.example/calendar/clients','/calendar/services?q=other','/calendar/clients/9012','javascript:alert(1)']){
    await page.goto(`/calendar/clients/9012?returnTo=${encodeURIComponent(rejected)}`);await page.addScriptTag({content:workspaceNavigationClientScript()});
    await expect(page.locator('[data-workspace-back-context]')).toHaveAttribute('href','/calendar/clients');
  }
});

test('Enlarged compact Calendar toolbar does not overlap its Bookings action',async({page})=>{
  await page.setViewportSize({width:320,height:740});
  await page.goto('/iframe.html?id=calendar-reference-implementation--compact-bookings-menu&viewMode=story',{waitUntil:'networkidle'});
  await page.addStyleTag({content:'html{font-size:200%}'});
  const summary=page.locator('.phone-plus-menu>summary'),view=page.locator('.phone-calendar-view-nav');
  const a=await summary.boundingBox(),b=await view.boundingBox();
  expect(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y>=b.y+b.height||b.y>=a.y+a.height).toBe(true);
  await summary.focus();await page.keyboard.press('Enter');
  await expect(page.locator('.phone-plus-popover')).toBeVisible();
  for(const control of await page.locator('.phone-plus-popover>a,.phone-plus-popover button').all())expect(await control.evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);
  fs.mkdirSync(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,'calendar-200-percent.png')});
});

test('Staff and service Back links keep list context after reload and browser Back',async({page})=>{
  for(const [listPath,rowClass,listStory,detailStory] of [
    ['/calendar/team','staff-row','workspace-staff-access--staff-profiles','workspace-staff-access--staff-detail'],
    ['/calendar/services','service-row','workspace-services--marietjie-assigned-services','workspace-services--marietjie-service-management'],
  ]){
    await page.goto(`/iframe.html?id=${listStory}&viewMode=story`,{waitUntil:'networkidle'});const list=await page.content();
    await page.goto(`/iframe.html?id=${detailStory}&viewMode=story`,{waitUntil:'networkidle'});const detail=await page.content();
    await page.route(`**${listPath}**`,r=>r.fulfill({contentType:'text/html',body:new URL(r.request().url()).pathname===listPath?list:detail}));
    const context=`${listPath}?q=synthetic&status=inactive&offset=40`;
    await page.goto(context);await page.addScriptTag({content:workspaceNavigationClientScript()});
    await page.locator(`.${rowClass}`).first().click();await page.addScriptTag({content:workspaceNavigationClientScript()});
    await expect(page.locator('[data-workspace-back-context]')).toHaveAttribute('href',context);
    await page.reload();await page.addScriptTag({content:workspaceNavigationClientScript()});
    await expect(page.locator('[data-workspace-back-context]')).toHaveAttribute('href',context);
    await page.goBack();await expect(page).toHaveURL(new RegExp(`${listPath}\\?q=synthetic&status=inactive&offset=40$`));
    await page.addScriptTag({content:workspaceNavigationClientScript()});await page.locator(`.${rowClass}`).first().click();
    await page.addScriptTag({content:workspaceNavigationClientScript()});await page.locator('[data-workspace-back-context]').click();
    await expect(page).toHaveURL(new RegExp(`${listPath}\\?q=synthetic&status=inactive&offset=40$`));
  }
});

test('Deposit states, protected access and client surfaces retain their boundaries',async({page})=>{
  for(const state of ['empty','loading','unavailable','restricted']){
    await page.goto(`/iframe.html?id=workspace-production-surfaces--dashboard-deposits-${state}&viewMode=story`,{waitUntil:'networkidle'});
    await expect(page.locator('[data-dashboard-deposits] [data-workspace-action="create"]')).toHaveCount(0);
    if(state==='restricted')await expect(page.locator('[data-dashboard-deposits]')).toHaveCount(0);
  }
  await page.goto('/iframe.html?id=workspace-staff-access--protected-administrator&viewMode=story',{waitUntil:'networkidle'});
  await expect(page.locator('[data-workspace-action="danger"],[data-workspace-action="primary"]')).toHaveCount(0);
  for(const story of ['shiloh-gift-vouchers--client-purchase','shiloh-shiloh-rewards--ready-to-use','workspace-packages--client-balance']){
    await page.goto(`/iframe.html?id=${story}&viewMode=story`,{waitUntil:'networkidle'});
    await expect(page.locator('[data-workspace-action]')).toHaveCount(0);
    await expect(page.locator('.workspace-main,[data-workspace-payment]')).toHaveCount(0);
  }
});

test('Dense Dashboard controls preserve the shared 44px minimum on desktop and phone',async({page})=>{
  for(const viewport of [{width:1440,height:1000},{width:1280,height:900},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    await page.goto('/iframe.html?id=workspace-production-surfaces--dashboard-operational&viewMode=story',{waitUntil:'networkidle'});
    const dense=page.locator('.carryover-group [data-workspace-action],.appointment-actions>[data-workspace-action]:only-child');
    expect(await dense.count()).toBeGreaterThan(0);
    for(const control of await dense.all())if(await control.isVisible())expect((await control.boundingBox()).height,await control.textContent()).toBeGreaterThanOrEqual(44);
  }
});
