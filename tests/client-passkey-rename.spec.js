const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
async function open(page){
 const calls=[],devices=[{id:41,label:'Android device',createdAt:'2026-10-20T10:00:00Z',lastUsedAt:'2026-10-23T10:00:00Z',backedUp:true},{id:42,label:'Mac',createdAt:'2026-10-20T10:00:00Z',backedUp:true}];
 await page.addInitScript(()=>{Object.defineProperty(navigator,'standalone',{value:true,configurable:true});window.PublicKeyCredential=function(){};window.credentialCalls=0;Object.defineProperty(navigator,'credentials',{configurable:true,value:{create:async()=>{window.credentialCalls++;throw Error('unexpected credential creation');},get:async()=>{window.credentialCalls++;throw Error('unexpected credential sign-in');}}});});
 await page.route('**/my-shiloh/api/**',r=>r.fulfill({json:{}}));
 await page.route('**/my-shiloh/auth/**',r=>r.fulfill({json:{}}));
 await page.route('**/my-shiloh/auth/csrf',r=>r.fulfill({json:{csrfToken:'C'.repeat(43)}}));
 await page.route('**/my-shiloh/auth/passkeys/devices',r=>r.fulfill({json:{devices}}));
 await page.route('**/my-shiloh/auth/passkeys/devices/rename',async r=>{
  expect(r.request().headers()['x-shiloh-csrf-token']).toBe('C'.repeat(43));const body=r.request().postDataJSON();calls.push(body);
  if(body.label==='Fail this save')return r.fulfill({status:503,json:{error:'Please try saving again.'}});
  const device=devices.find(d=>d.id===body.credentialId);device.label=body.label.trim().replace(/\s+/g,' ');return r.fulfill({json:{renamed:true,label:device.label}});
 });
 await page.goto('/iframe.html?id=client-my-shiloh-pwa--passkey-profile&viewMode=story#profile',{waitUntil:'networkidle'});
 await page.locator('[data-app-frame]').waitFor({state:'attached'});await page.addScriptTag({url:'/my-shiloh/assets/app.js'});
 await expect(page.getByRole('button',{name:'Rename Android device passkey',exact:true})).toBeVisible();
 return {calls,devices};
}
for(const width of [390,1440])test(`own passkey name Save and Cancel at ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});const {calls,devices}=await open(page);
 const row=page.locator('.passkey-device').first();const editor=row.locator('form');
 await row.getByRole('button',{name:'Rename Android device passkey',exact:true}).click();
 await expect(editor.getByRole('textbox',{name:'Passkey name',exact:true})).toHaveValue('Android device');
 await editor.getByRole('textbox').fill('Unsaved name');await editor.getByRole('button',{name:'Cancel',exact:true}).click();
 expect(calls).toEqual([]);await expect(row.locator('strong')).toHaveText('Android device');await expect(editor).toBeHidden();
 await row.getByRole('button',{name:'Rename Android device passkey',exact:true}).click();
 await editor.getByRole('textbox').fill('Galaxy S25 Ultra');
 const axe=await new AxeBuilder({page}).include('[aria-labelledby="passkey-title"]').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();expect(axe.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
 await row.screenshot({path:info.outputPath(`rename-editor-${width}.png`)});
 await editor.getByRole('button',{name:'Save name',exact:true}).click();
 await expect(row.locator('strong')).toHaveText('Galaxy S25 Ultra');await expect(editor).toBeHidden();
 await expect(row.getByRole('button',{name:'Remove Galaxy S25 Ultra passkey',exact:true})).toBeVisible();
 expect(calls).toEqual([{credentialId:41,label:'Galaxy S25 Ultra'}]);expect(devices[1].label).toBe('Mac');
 await row.getByRole('button',{name:'Rename Galaxy S25 Ultra passkey',exact:true}).click();await editor.getByRole('button',{name:'Save name',exact:true}).click();
 await expect(editor).toBeHidden();expect(calls).toHaveLength(2);
 expect(await page.evaluate(()=>window.credentialCalls)).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('[aria-labelledby="passkey-title"]').screenshot({path:info.outputPath(`rename-saved-${width}.png`)});
});
test('rename keeps invalid/error drafts and displays markup as text',async({page})=>{
 const {calls}=await open(page);const row=page.locator('.passkey-device').first();
 await row.getByRole('button',{name:'Rename Android device passkey',exact:true}).click();const input=row.getByRole('textbox',{name:'Passkey name',exact:true});
 await input.fill('');expect(await input.evaluate(el=>el.checkValidity())).toBe(false);expect(calls).toHaveLength(0);await expect(input).toHaveAttribute('maxlength','48');
 await input.fill('Fail this save');await row.getByRole('button',{name:'Save name',exact:true}).click();await expect(row.getByRole('status')).toContainText('Please try saving again.');
 await expect(input).toHaveValue('Fail this save');await expect(input).toBeEnabled();await expect(row.locator('strong')).toHaveText('Android device');
 await input.fill('<b>My phone</b>');await row.getByRole('button',{name:'Save name',exact:true}).click();await expect(row.locator('strong')).toHaveText('<b>My phone</b>');await expect(row.locator('b')).toHaveCount(0);
});
