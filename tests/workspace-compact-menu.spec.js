const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { workspacePwaClientScript } = require('../src/presentation/workspacePwa');
const { workspaceIconClientScript } = require('../src/presentation/workspaceIconClient');

test.beforeEach(async({page})=>{await page.route('**/calendar/pwa/icon-192.png*',route=>route.fulfill({path:require('node:path').join(__dirname,'../public/assets/pwa/shiloh-pwa-192.png'),contentType:'image/png'}));});

for (const viewport of [{name:'phone',width:390,height:844},{name:'short-phone',width:360,height:9040},{name:'desktop',width:1440,height:1000}]) {
  test(`Compact Workspace controls keep navigation accessible and toggle this device on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const posts = [];
    let enabled=true;
    await page.route('**/calendar/pwa/push/status', route => route.fulfill({json:{enabled}}));
    await page.route('**/calendar/workspace/navigation', route => route.fulfill({json:{}}));
    await page.route('**/calendar/pwa/push/config', route => route.fulfill({json:{allowed:true,configured:true,publicKey:'AQID'}}));
    await page.route('**/calendar/staff-auth/csrf', route => route.fulfill({json:{csrfToken:'fixture-csrf'}}));
    await page.route('**/calendar/pwa/push/subscribe', route => { enabled=true; posts.push({path:'subscribe',body:route.request().postDataJSON(),csrf:route.request().headers()['x-shiloh-csrf-token']}); return route.fulfill({json:{enabled:true}}); });
    await page.route('**/calendar/pwa/push/unsubscribe', route => { enabled=false; posts.push({path:'unsubscribe',body:route.request().postDataJSON()}); return route.fulfill({json:{enabled:false}}); });
    await page.goto('/iframe.html?id=workspace-production-surfaces--compact-menu-notifications-on&viewMode=story', {waitUntil:'networkidle'});
    await page.evaluate(() => {
      Object.defineProperty(navigator,'standalone',{value:true,configurable:true});
      window.PushManager = function() {};
      window.Notification = {permission:'granted'};
      let subscription = {endpoint:'https://push.example/device',toJSON(){return {endpoint:this.endpoint};},async unsubscribe(){subscription=null;return true;}};
      Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{async register(){return {addEventListener(){}};},addEventListener(){},ready:Promise.resolve({pushManager:{async getSubscription(){return subscription;},async subscribe(){subscription={endpoint:'https://push.example/device',toJSON(){return {endpoint:this.endpoint};},async unsubscribe(){subscription=null;return true;}};return subscription;}}})}});
    });
    await page.addScriptTag({content:workspaceIconClientScript()});
    await page.addScriptTag({content:workspacePwaClientScript()});
    const toggle = page.getByRole('switch',{name:'Notifications on this device'});
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveAttribute('aria-checked','true');
    const metrics = await page.evaluate(() => {
      const links=document.querySelector('.workspace-links'),account=document.querySelector('[data-workspace-account-footer]');
      return {links:links.getBoundingClientRect().height,account:account.getBoundingClientRect().height,bottom:account.getBoundingClientRect().bottom,short:[...account.querySelectorAll('button,a')].filter(n=>n.getBoundingClientRect().height<44).map(n=>n.textContent),width:document.documentElement.scrollWidth};
    });
    expect(metrics.short).toEqual([]);
    expect(metrics.width).toBeLessThanOrEqual(viewport.width);
    expect(metrics.account).toBeLessThan(225);
    if(viewport.name!=='desktop') {
      expect(metrics.bottom).toBeLessThanOrEqual(viewport.height);
      expect(metrics.links).toBeGreaterThan(viewport.height-310);
    }
    // The final destination remains reachable inside the links scroller.
    const report=page.locator('[data-workspace-destination="problemReports"]');
    await report.scrollIntoViewIfNeeded();
    expect(await report.evaluate(n=>{const r=n.getBoundingClientRect(),p=n.closest('.workspace-links').getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom;})).toBe(true);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked','false');
    await expect(toggle).toContainText('Off');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked','true');
    expect(posts.map(p=>p.path)).toEqual(['unsubscribe','subscribe']);
    expect(posts[1].csrf).toBe('fixture-csrf');
    expect(posts[1].body.subscription.endpoint).toBe('https://push.example/device');
    const axe=await new AxeBuilder({page}).include('[data-workspace-navigation-drawer]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    expect(axe.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
    await page.locator('.workspace-links').evaluate(n=>n.scrollTop=0);
    await page.screenshot({path:testInfo.outputPath(`compact-menu-${viewport.name}.png`),animations:'disabled'});
    await page.evaluate(()=>{Notification.permission='denied';dispatchEvent(new Event('pageshow'));});
    await expect(toggle).toBeDisabled();
    await expect(page.locator('[data-workspace-push-status]')).toContainText('phone settings');
    await page.screenshot({path:testInfo.outputPath(`compact-menu-blocked-${viewport.name}.png`),animations:'disabled'});
  });
}

for (const device of ['iPhone','Android']) for (const scenario of ['default','denied','missing','disabled','account-mismatch','on','expired-session','network-failure','not-installed','revoked-role']) {
  test(`Device notification status: ${device} ${scenario}`,async({page},testInfo)=>{
    await page.setViewportSize({width:390,height:844});
    let enabled=scenario==='on',requests=0,subscriptions=0;const writes=[];
    await page.route('**/calendar/workspace/navigation',route=>route.fulfill({json:{}}));
    await page.route('**/calendar/pwa/push/config',route=>scenario==='expired-session'?route.fulfill({status:401,json:{}}):scenario==='network-failure'?route.abort():route.fulfill({json:{allowed:scenario!=='revoked-role',configured:true,publicKey:'AQID'}}));
    await page.route('**/calendar/pwa/push/status',route=>{requests++;return route.fulfill({json:{enabled}});});
    await page.route('**/calendar/staff-auth/csrf',route=>route.fulfill({json:{csrfToken:'synthetic-csrf'}}));
    await page.route('**/calendar/pwa/push/subscribe',route=>{writes.push(route.request().postDataJSON());enabled=true;return route.fulfill({json:{enabled:true}});});
    await page.goto('/iframe.html?id=workspace-production-surfaces--compact-menu-notifications-off&viewMode=story',{waitUntil:'networkidle'});
    await page.evaluate(({scenario,device})=>{
      Object.defineProperty(navigator,'standalone',{value:scenario!=='not-installed',configurable:true});
      Object.defineProperty(navigator,'userAgent',{value:device==='iPhone'?'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X)':'Mozilla/5.0 (Linux; Android 14)',configurable:true});
      window.PushManager=function(){};window.__permissionPrompts=0;window.__subscriptions=0;
      window.Notification={permission:['denied','default'].includes(scenario)?scenario:'granted',async requestPermission(){window.__permissionPrompts++;this.permission='granted';return 'granted';}};
      let subscription=scenario==='missing'?null:{endpoint:'https://push.example/device',toJSON(){return {endpoint:this.endpoint};},async unsubscribe(){subscription=null;return true;}};
      Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{async register(){return {addEventListener(){}};},addEventListener(){},ready:Promise.resolve({pushManager:{async getSubscription(){return subscription;},async subscribe(){window.__subscriptions++;subscription={endpoint:'https://push.example/device',toJSON(){return {endpoint:this.endpoint};},async unsubscribe(){subscription=null;return true;}};return subscription;}}})}});
    },{scenario,device});
    await page.addScriptTag({content:workspacePwaClientScript()});
    const panel=page.locator('[data-workspace-notifications]'),toggle=page.getByRole('switch',{name:'Notifications on this device'}),status=page.locator('[data-workspace-push-status]');
    if(scenario==='revoked-role'){await expect(panel).toBeHidden();expect(requests).toBe(0);return;}
    await expect(panel).toBeVisible();
    if(scenario==='on'){await expect(toggle).toHaveAttribute('aria-checked','true');await expect(toggle).toHaveAttribute('aria-description',/Delivery depends/);}
    else if(['expired-session','network-failure'].includes(scenario)){await expect(toggle).toContainText('Unknown');await expect(toggle).toBeDisabled();await expect(status).toContainText(scenario==='expired-session'?'Sign in':'when connected');}
    else {await expect(toggle).toHaveAttribute('aria-checked','false');await expect(toggle).toContainText('Off');}
    expect(writes).toEqual([]);expect(await page.evaluate(()=>window.__permissionPrompts)).toBe(0);expect(await page.evaluate(()=>window.__subscriptions)).toBe(0);
    if(['denied','not-installed'].includes(scenario)){await expect(toggle).toBeDisabled();await expect(status).toContainText(scenario==='denied'?'phone settings':'Home Screen');}
    if(['disabled','account-mismatch'].includes(scenario))await expect(status).toContainText('reconnect');
    if(['default','missing','disabled','account-mismatch'].includes(scenario)){
      await expect(toggle).toBeEnabled();await toggle.click();await expect(toggle).toHaveAttribute('aria-checked','true');
      expect(writes).toEqual([{subscription:{endpoint:'https://push.example/device'}}]);
      expect(await page.evaluate(()=>window.__permissionPrompts)).toBe(scenario==='default'?1:0);
      subscriptions=await page.evaluate(()=>window.__subscriptions);expect(subscriptions).toBe(scenario==='missing'?1:0);
    }
    const axe=await new AxeBuilder({page}).include('[data-workspace-navigation-drawer]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    expect(axe.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({path:testInfo.outputPath(`notifications-${device}-${scenario}.png`),animations:'disabled'});
  });
}

for(const width of [390,1440]) for(const state of ['on','off','blocked','stale','unknown']) {
  test(`Notification guidance Storybook ${state} at ${width}`,async({page},testInfo)=>{
    await page.setViewportSize({width,height:width===390?844:1000});
    await page.goto(`/iframe.html?id=workspace-production-surfaces--compact-menu-notifications-${state}&viewMode=story`,{waitUntil:'networkidle'});
    await expect(page.locator('[data-workspace-notifications]')).toBeVisible();
    const axe=await new AxeBuilder({page}).include('[data-workspace-navigation-drawer]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    expect(axe.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const fits=await page.locator('[data-workspace-push-toggle]').evaluate(button=>{const parent=button.closest('.workspace-nav').getBoundingClientRect();return [...button.children].filter(n=>!n.hidden).every(n=>n.getBoundingClientRect().right<=parent.right);});
    expect(fits).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`guidance-${state}-${width}.png`),animations:'disabled'});
  });
}
