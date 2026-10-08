const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { workspaceNavigationClientScript, workspaceShellStyles, renderWorkspaceNavigation: workspaceNavigation } = require('../src/presentation/workspaceShell');
const { BOOKING_ACTION_PALETTE, bookingActionStyles, calendarBookingsMenuPolishClientScript } = require('../src/presentation/calendarBookingsMenuPolish');
const fs = require('node:fs');
const path = require('node:path');
const evidence = path.resolve('artifacts/workspace-polish');

for (const viewport of [{name:'phone',width:390,height:844},{name:'compact-tablet',width:700,height:960},{name:'narrow-phone',width:320,height:640},{name:'large-text',width:320,height:740,large:true}]) {
  test(`Calendar Bookings menu keeps action colours with production compact styles on ${viewport.name}`,async({page})=>{
    const {phoneCalendarV2Styles,renderPhoneCalendarUtilityBar}=require('../src/presentation/calendarPhoneCompactV2');
    const model={view:'week',dateKey:'2026-10-07',activeStaffId:12,permittedStaff:[{id:12,displayName:'Synthetic Practitioner'}],timeline:{staff:[{id:12,displayName:'Synthetic Practitioner'}]},mutationCapability:{enabled:true,operations:['calendar_block:manage','operational_leave:manage'],calendarScope:'all_business'}};
    const bar=renderPhoneCalendarUtilityBar(model,{basePath:'/calendar',bookingAllowed:true,retrospectiveAllowed:true,todayDate:'2026-10-07'});
    expect(fs.readFileSync(path.resolve('stories/fixtures/calendarBookingsMenu.html'),'utf8')).toBe(`<!-- Synthetic production renderPhoneCalendarUtilityBar and phoneCalendarV2Styles. -->\n<style>${phoneCalendarV2Styles()}</style>\n${bar}\n`);
    await page.setViewportSize(viewport);
    await page.goto('/iframe.html?id=calendar-reference-implementation--compact-bookings-menu&viewMode=story',{waitUntil:'networkidle'});
    if(viewport.large)await page.addStyleTag({content:'html{font-size:200%}'});
    const menu=page.locator('.phone-plus-menu'),summary=menu.locator('summary');
    await expect(summary).toHaveAttribute('aria-label','Bookings');
    await summary.focus();await page.keyboard.press('Enter');
    const controls=menu.locator('.phone-plus-popover>a,.phone-plus-popover button');
    await expect(controls).toHaveCount(7);
    const before=await controls.evaluateAll(nodes=>nodes.map(n=>({html:n.innerHTML,href:n.getAttribute('href'),staff:n.dataset.staffId,operation:n.dataset.calendarOperation})));
    for(let i=0;i<7;i++){
      const control=controls.nth(i),tone=['new','new','couples','group','past','block','leave'][i],colour=BOOKING_ACTION_PALETTE[tone];
      await expect(control).toHaveAttribute('data-calendar-action-tone',tone);
      expect(await control.evaluate(n=>getComputedStyle(n).backgroundColor)).toBe(rgb(colour.background));
      expect(await control.evaluate(n=>getComputedStyle(n).color)).toBe(rgb(colour.ink));
      await control.hover();expect(await control.evaluate(n=>getComputedStyle(n).backgroundColor)).toBe(rgb(colour.hover));
      await control.focus();await expect(control).toBeFocused();
      const bounds=await control.boundingBox();expect(bounds.height).toBeGreaterThanOrEqual(44);expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(viewport.width);
      expect(await control.evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);
    }
    await page.mouse.move(0,0);
    const axe=await new AxeBuilder({page}).include('.phone-plus-menu').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(axe.violations).toEqual([]);
    fs.mkdirSync(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,`calendar-bookings-menu-${viewport.name}.png`)});
    await page.addScriptTag({content:calendarBookingsMenuPolishClientScript()});
    expect(await controls.evaluateAll(nodes=>nodes.map(n=>({html:n.innerHTML,href:n.getAttribute('href'),staff:n.dataset.staffId,operation:n.dataset.calendarOperation})))).toEqual(before);
    // Calendar can replace availability controls when staff selection changes.
    await controls.last().evaluate(n=>{const replacement=n.cloneNode(true);replacement.removeAttribute('data-calendar-action-tone');n.replaceWith(replacement);});
    await expect(controls.last()).toHaveAttribute('data-calendar-action-tone','leave');
    expect(await controls.last().evaluate(n=>getComputedStyle(n).backgroundColor)).toBe(rgb(BOOKING_ACTION_PALETTE.leave.background));
    await summary.focus();await page.keyboard.press('Enter');await expect(menu).not.toHaveAttribute('open','');
    const restricted=renderPhoneCalendarUtilityBar({...model,mutationCapability:{enabled:false,operations:[]}},{bookingAllowed:false,retrospectiveAllowed:false,todayDate:'2026-10-07'});
    expect(restricted).not.toContain('phone-plus-menu');
  });
}

for (const viewport of [{ name:'phone',width:390,height:844 },{ name:'desktop',width:1440,height:960 },{ name:'narrow-large-text',width:320,height:640,large:true }]) {
  test(`Refresh retains drafts, keyboard, interruption and offline behavior on ${viewport.name}`, async ({page,context}) => {
    await page.setViewportSize(viewport);
    let loads=0;
    await page.route('**/calendar/pwa/icon-192.png*',r=>r.fulfill({path:path.resolve('public/assets/pwa/shiloh-pwa-192.png')}));
    const errors=[];page.on('pageerror', e=>errors.push(e.message));
    await page.route('**/calendar/workspace/navigation',r=>r.fulfill({json:{}}));
    await page.route('**/polish-fixture',r=>{loads++;return r.fulfill({contentType:'text/html',body:`<!doctype html><html lang="en"><head><title>Synthetic Workspace</title><style>body{font-family:system-ui;background:#f4f3ed}${workspaceShellStyles()}${viewport.large?'html{font-size:200%}':''}</style></head><body><div class="workspace-frame">${workspaceNavigation({displayName:'Synthetic reviewer',active:'dashboard'})}<main class="workspace-main"><h1>Workspace</h1><label>Draft note<input value="Synthetic unsaved draft"></label><button data-other>Other action</button><p data-workspace-refresh-status role="status"></p></main></div></body></html>`});});
    await page.goto('/polish-fixture');
    // Stop deferred fixture nav requests: install the production script explicitly.
    await page.addScriptTag({content:workspaceNavigationClientScript()});
    if(viewport.width<=700)await page.locator('[data-workspace-drawer-toggle]').click();
    const refresh=page.locator('[data-workspace-refresh]');
    await refresh.scrollIntoViewIfNeeded();await refresh.focus();await page.keyboard.press('Enter');
    const dialog=page.locator('[data-shiloh-confirm]');
    await expect(dialog).toBeVisible();await expect(dialog.locator('.eyebrow')).toBeHidden();
    await expect(dialog).toContainText('Unsaved changes will be lost.');
    const cancel=dialog.getByRole('button',{name:'Keep working'}),action=dialog.getByRole('button',{name:'Refresh',exact:true});
    await expect(cancel).toBeFocused();
    const sizes=await dialog.evaluate(d=>({width:d.getBoundingClientRect().width,height:d.getBoundingClientRect().height,buttons:[...d.querySelectorAll('button')].map(b=>({height:b.getBoundingClientRect().height,top:b.getBoundingClientRect().top,width:b.getBoundingClientRect().width,scroll:b.scrollWidth,client:b.clientWidth}))}));
    expect(sizes.width).toBeLessThan(viewport.width);expect(sizes.height).toBeLessThan(viewport.height);
    for(const b of sizes.buttons){expect(b.height).toBeGreaterThanOrEqual(48);expect(b.scroll).toBeLessThanOrEqual(b.client);}
    if(!viewport.large)expect(sizes.buttons[0].top).toBe(sizes.buttons[1].top);
    const axe=await new AxeBuilder({page}).include('[data-shiloh-confirm]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(axe.violations).toEqual([]);
    fs.mkdirSync(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,`refresh-${viewport.name}.png`)});
    expect(await dialog.locator('h2').evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);
    if(viewport.large){await action.scrollIntoViewIfNeeded();const rect=await action.boundingBox();expect(rect.y+rect.height).toBeLessThanOrEqual(viewport.height);await page.screenshot({path:path.join(evidence,`refresh-${viewport.name}-actions.png`)});await cancel.focus();}
    await page.keyboard.press('Tab');await expect(action).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(cancel).toBeFocused();
    await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(refresh).toBeFocused();await expect(page.getByLabel('Draft note')).toHaveValue('Synthetic unsaved draft');expect(loads).toBe(1);
    if(viewport.width<=700)await page.locator('[data-workspace-drawer-toggle]').click();
    // Re-entrant caller must not replace the open refresh request.
    await refresh.click();expect(await page.evaluate(()=>window.ShilohConfirm({title:'Repeated action'}))).toBe(false);await expect(dialog).toContainText('Refresh Workspace?');
    await cancel.click();await expect(refresh).toBeFocused();
    // An interrupted close settles once, restores focus and permits the next use.
    await refresh.click();await dialog.evaluate(d=>d.close());await expect(refresh).toBeFocused();await refresh.click();await expect(dialog).toBeVisible();
    await context.setOffline(true);await action.click();await expect(dialog).toBeHidden();await expect(page.locator('[data-workspace-refresh-status]').first()).toContainText('You are offline.');expect(loads).toBe(1);await expect(page.getByLabel('Draft note')).toHaveValue('Synthetic unsaved draft');
    await refresh.click();await expect(dialog).toBeHidden();await context.setOffline(false);
    // A destructive confirmation after refresh restores the original eyebrow/layout.
    await page.locator('[data-other]').evaluate(b=>b.focus());await page.evaluate(()=>{window.ShilohConfirm({title:'Delete synthetic item?',copy:'Synthetic irreversible consequence.',cancel:'Keep item',action:'Delete item'});});
    await expect(dialog.locator('.eyebrow')).toBeVisible();await expect(dialog).not.toHaveClass(/refresh/);await expect(dialog.locator('[data-shiloh-confirm-action]')).toHaveClass(/danger/);await page.keyboard.press('Escape');await expect(page.locator('[data-other]')).toBeFocused();
    if(viewport.width<=700)await page.locator('[data-workspace-drawer-toggle]').click();
    await refresh.click();await Promise.all([page.waitForEvent('load'),action.click()]);expect(loads).toBe(2);expect(errors).toEqual([]);
  });
}

for(const viewport of [{name:'phone',width:390,height:844},{name:'desktop',width:1440,height:960}]) {
  test(`Equivalent booking controls share Calendar tones and preserve state on ${viewport.name}`,async({page})=>{
    await page.setViewportSize(viewport);
    const cases=[
      ['create-booking','[data-couples-booking-entry]','couples'],
      ['create-booking','[data-group-booking-entry]','group'],
      ['create-booking','[data-review-booking]','new'],
      ['couples-booking-treatments-and-discount','[data-review-couples]','couples'],
      ['group-booking-multiple-guests-and-discount','[data-review-group]','group'],
      ['multi-service-client-booking','[data-review-multiple]','new'],
    ];
    for(const [story,selector,tone] of cases){
      await page.goto(`/iframe.html?id=workspace-production-surfaces--${story}&viewMode=story`,{waitUntil:'networkidle'});
      const control=page.locator(selector);await expect(control).toBeVisible();
      const colour=BOOKING_ACTION_PALETTE[tone];expect(await control.evaluate(n=>getComputedStyle(n).backgroundColor)).toBe(rgb(colour.background));expect(await control.evaluate(n=>getComputedStyle(n).color)).toBe(rgb(colour.ink));
      const before=await control.evaluate(n=>({text:n.textContent,disabled:n.disabled,html:n.innerHTML,pressed:n.getAttribute('aria-pressed')}));
      await page.addScriptTag({content:calendarBookingsMenuPolishClientScript()});expect(await control.evaluate(n=>({text:n.textContent,disabled:n.disabled,html:n.innerHTML,pressed:n.getAttribute('aria-pressed')}))).toEqual(before);
      if(!before.disabled){await control.hover();expect(await control.evaluate(n=>getComputedStyle(n).backgroundColor)).toBe(rgb(colour.hover));await control.focus();await expect(control).toBeFocused();}
      const axe=await new AxeBuilder({page}).include(selector).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(axe.violations).toEqual([]);
      fs.mkdirSync(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,`${story}-${tone}-${viewport.name}.png`)});
    }
    // Dynamic block/leave editor controls, existing selected state, and every tone's contrast.
    await page.setContent(`<html lang="en"><title>Synthetic actions</title><style>${bookingActionStyles()}</style><main>${Object.keys(BOOKING_ACTION_PALETTE).map(t=>`<button data-calendar-action-tone="${t}" aria-pressed="true">${t}</button>`).join('')}<form data-availability-form="block"><button class="availability-submit">Save block</button></form><form data-availability-form="leave"><button class="availability-submit">Save leave</button></form></main></html>`);
    for(const [tone,c] of Object.entries(BOOKING_ACTION_PALETTE)){const b=page.locator(`[data-calendar-action-tone="${tone}"]`);await expect(b).toHaveAttribute('aria-pressed','true');expect(await b.evaluate(n=>getComputedStyle(n).backgroundColor)).toBe(rgb(c.background));expect(contrast(c.ink,c.background)).toBeGreaterThanOrEqual(4.5);expect(contrast(c.ink,c.hover)).toBeGreaterThanOrEqual(4.5);}
    for(const tone of ['block','leave'])expect(await page.locator(`[data-availability-form="${tone}"] button`).evaluate(n=>getComputedStyle(n).backgroundColor)).toBe(rgb(BOOKING_ACTION_PALETTE[tone].background));
  });
}
function rgb(hex){return `rgb(${parseInt(hex.slice(1,3),16)}, ${parseInt(hex.slice(3,5),16)}, ${parseInt(hex.slice(5,7),16)})`;}
function contrast(a,b){function l(h){const c=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;}return (Math.max(l(a),l(b))+.05)/(Math.min(l(a),l(b))+.05);}

for (const viewport of [{name:'phone',width:390,height:844},{name:'desktop',width:1440,height:960}]) {
  test(`Focused Dashboard and Reports omit retired cards while financial and Messages paths remain on ${viewport.name}`, async ({page}) => {
    await page.route('**/calendar/pwa/icon-192.png*',r=>r.fulfill({path:path.resolve('public/assets/pwa/shiloh-pwa-192.png')}));
    await page.setViewportSize(viewport);
    for (const [story,root] of [['workspace-production-surfaces--focused-workspace-dashboard','.workspace-main'],['workspace-reports--focused-workspace-reports','.workspace-main']]) {
      await page.goto(`/iframe.html?id=${story}&viewMode=story`,{waitUntil:'networkidle'});
      await expect(page.locator('[data-dashboard-communications-panel],[data-dashboard-voucher-panel],[data-welcome-voucher-campaign]')).toHaveCount(0);
      await expect(page.locator('a[href="#welcome-voucher"]')).toHaveCount(0);
      await expect(page.locator('[data-workspace-destination="messages"]')).toHaveCount(1);
      if(story.includes('dashboard')){
        await expect(page.locator('[data-dashboard-deposits]')).toContainText('Synthetic Aloe');
        await expect(page.locator('[data-dashboard-today]')).toContainText('Open calendar');
      }else{
        const sections=page.getByRole('navigation',{name:'Report sections'});
        await expect(sections.getByRole('link')).toHaveCount(3);
        await expect(sections.getByRole('link',{name:'Money',exact:true})).toHaveAttribute('href','#money');
        await page.addScriptTag({content:require('../src/presentation/workspaceReportsUx').reportSectionsClientScript()});
        await sections.getByRole('link',{name:'Money',exact:true}).click();
        await expect(page.locator('#money')).toHaveAttribute('open','');
        await page.locator('#financial-daily > summary').click();
        await expect(page.locator('#financial-daily .financial-table')).toBeVisible();
        await expect(page.locator('#financial-daily')).toHaveCount(1);
        await expect(page.locator('#financial-receipts')).toHaveCount(1);
        await expect(page.locator('#financial-balances')).toHaveCount(1);
      }
      const axe=await new AxeBuilder({page}).include(root).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(axe.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      fs.mkdirSync(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,`${story.includes('dashboard')?'dashboard':'reports'}-${viewport.name}.png`),fullPage:true});
    }
  });
}
