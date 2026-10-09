const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { workspacePwaClientScript } = require('../src/presentation/workspacePwa');
const { workspaceIconClientScript } = require('../src/presentation/workspaceIconClient');

for (const viewport of [{name:'phone',width:390,height:844},{name:'short-phone',width:360,height:9040},{name:'desktop',width:1440,height:1000}]) {
  test(`Compact Workspace controls keep navigation accessible and toggle this device on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const posts = [];
    await page.route('**/calendar/workspace/navigation', route => route.fulfill({json:{}}));
    await page.route('**/calendar/pwa/push/config', route => route.fulfill({json:{allowed:true,configured:true,publicKey:'AQID'}}));
    await page.route('**/calendar/staff-auth/csrf', route => route.fulfill({json:{csrfToken:'fixture-csrf'}}));
    await page.route('**/calendar/pwa/push/subscribe', route => { posts.push({path:'subscribe',body:route.request().postDataJSON(),csrf:route.request().headers()['x-shiloh-csrf-token']}); return route.fulfill({json:{enabled:true}}); });
    await page.route('**/calendar/pwa/push/unsubscribe', route => { posts.push({path:'unsubscribe',body:route.request().postDataJSON()}); return route.fulfill({json:{enabled:false}}); });
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
