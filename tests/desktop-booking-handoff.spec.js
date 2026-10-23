const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
async function open(page,{mobile='',standalone=false,selected=true,copyFails=false}={}) {
 await page.addInitScript(({mobile,standalone,copyFails})=>{
  if(mobile)Object.defineProperty(navigator,'userAgent',{value:mobile==='ios'?'iPhone Safari':mobile==='ipad-desktop'?'Macintosh Safari':'Android Chrome',configurable:true});
  if(mobile==='ipad-desktop'){Object.defineProperty(navigator,'platform',{value:'MacIntel',configurable:true});Object.defineProperty(navigator,'maxTouchPoints',{value:5,configurable:true});}
  Object.defineProperty(navigator,'standalone',{value:standalone,configurable:true});
  Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{if(copyFails)throw Error('clipboard unavailable');window.copiedPhoneLink=value;}},configurable:true});
 },{mobile,standalone,copyFails});
 await page.route('**/my-shiloh/api/**',r=>r.fulfill({json:{}}));
 await page.goto(`/iframe.html?id=client-my-shiloh-pwa--${selected?'desktop-booking-handoff':'browser-install-doorway'}&viewMode=story#book-online`,{waitUntil:'networkidle'});
 await page.locator('[data-install-gate]').waitFor({state:'attached'});
 await page.addScriptTag({url:'/my-shiloh/assets/app.js'});
}
for(const width of [390,1440])test(`desktop booking handoff at ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});await open(page);
 await expect(page.getByRole('heading',{name:'Continue your booking on your phone.',exact:true})).toBeVisible();
 await expect(page.locator('[data-app-frame]')).toBeHidden();await expect(page.locator('[data-install-gate-action]')).toBeHidden();
 const handoff=page.locator('[data-install-desktop-handoff]');await expect(handoff).toBeVisible();
 await expect(handoff.getByRole('link',{name:'Message Reception on WhatsApp'})).toHaveAttribute('href',/^https:\/\/wa.me\/27662399138\?text=/);
 await handoff.getByRole('button',{name:'Copy phone link'}).click();
 expect(await page.evaluate(()=>window.copiedPhoneLink)).toBe('https://app.shilohmtc.co.za/my-shiloh/?service=101#book-online');
 await expect(page.locator('[data-copy-phone-link-status]')).toContainText('Phone link copied');
 const a11y=await new AxeBuilder({page}).include('[data-install-gate]').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();expect(a11y.violations.filter(x=>['serious','critical'].includes(x.impact))).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`desktop-handoff-${width}.png`),fullPage:true});
});
test('desktop clipboard refusal retains a usable phone link',async({page})=>{await open(page,{copyFails:true,selected:false});await page.getByRole('button',{name:'Copy phone link'}).click();await expect(page.locator('[data-copy-phone-link-status]')).toContainText('Copy the phone link shown above');await expect(page.locator('[data-desktop-phone-link]')).toHaveAttribute('href','https://app.shilohmtc.co.za/my-shiloh/#book-online');});
for(const mobile of ['ios','android','ipad-desktop'])test(`${mobile} keeps phone installation policy`,async({page})=>{await open(page,{mobile,selected:false});await expect(page.locator('[data-install-desktop-handoff]')).toBeHidden();await expect(page.locator('[data-install-gate-action]')).toBeVisible();await expect(page.locator('[data-app-frame]')).toBeHidden();await page.locator('[data-install-gate-action]').click();await expect(page.locator('[data-install-sheet]')).toBeVisible();});
test('installed app keeps existing entry',async({page})=>{await open(page,{standalone:true});await expect(page.locator('[data-install-gate]')).toBeHidden();await expect(page.locator('[data-install-desktop-handoff]')).toBeHidden();await expect(page.locator('[data-app-frame]')).toBeVisible();});
