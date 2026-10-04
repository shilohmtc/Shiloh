const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const {manageScript}=require('../src/presentation/staffPasskeyUx');
const old=[{id:1,label:'JP current phone',current:true},{id:2,label:'JP old Windows PC'},{id:3,label:'JP old Android'},{id:4,label:'JP old iPhone'},{id:5,label:'Unnamed old device'}].map(r=>({...r,createdAt:'2026-09-14T15:17:00Z'}));
async function setup(page,mode='success') {
  let rows=old.map(r=>({...r})),verified=false,revokeCalls=0,refreshes=0;
  await page.route('**/calendar/staff-auth/csrf',r=>r.fulfill({json:{csrfToken:'fixture-csrf'}}));
  await page.route('**/calendar/staff-auth/passkeys',async r=>{refreshes++;if(refreshes>1&&mode==='list-error')return r.fulfill({status:503,json:{}});if(refreshes>1)await new Promise(resolve=>setTimeout(resolve,500));return r.fulfill({json:{credentials:rows}});});
  await page.route('**/calendar/staff-auth/passkeys/reauthentication/options',r=>{expect(r.request().headers()['x-shiloh-csrf-token']).toBe('fixture-csrf');return r.fulfill({json:{options:{challenge:'AQID',rpId:'127.0.0.1',allowCredentials:[{type:'public-key',id:'BAUG'}],userVerification:'required'}}});});
  await page.route('**/calendar/staff-auth/passkeys/reauthentication/finish',r=>{expect(r.request().postDataJSON().response.rawId).toBe('BAUG');if(mode==='verify-error')return r.fulfill({status:401,json:{}});verified=true;return r.fulfill({status:204});});
  await page.route('**/calendar/staff-auth/passkeys/*/revoke',r=>{revokeCalls++;expect(r.request().headers()['x-shiloh-csrf-token']).toBe('fixture-csrf');if(!verified)return r.fulfill({status:428,json:{}});if(mode==='only-device')return r.fulfill({status:409,json:{}});const id=Number(r.request().url().match(/\/(\d+)\/revoke/)[1]);rows=rows.map(x=>x.id===id?{...x,revokedAt:'2026-10-04T06:00:00Z'}:x);return r.fulfill({status:204});});
  await page.goto('/iframe.html?id=workspace-production-surfaces--old-device-removal&viewMode=story',{waitUntil:'networkidle'});
  await page.evaluate(cancel=>{window.PublicKeyCredential=function(){};window.__passkeyPrompts=0;Object.defineProperty(navigator,'credentials',{configurable:true,value:{async get(options){window.__passkeyPrompts++;if(options.publicKey.userVerification!=='required')throw Error('UV missing');if(cancel)throw new DOMException('Cancelled','NotAllowedError');const bytes=new Uint8Array([4,5,6]).buffer;return {id:'BAUG',rawId:bytes,type:'public-key',response:{clientDataJSON:bytes,authenticatorData:bytes,signature:bytes,userHandle:null}};}}});},mode==='cancel');
  await page.addScriptTag({content:manageScript()});
  await expect(page.locator('[data-passkey-list] .credential')).toHaveCount(5);
  return {calls:()=>revokeCalls};
}
for(const viewport of [{name:'phone',width:390,height:844},{name:'desktop',width:1280,height:900}]) {
  test(`old devices leave the active list after one inline verification on ${viewport.name}`,async({page},testInfo)=>{
    await page.setViewportSize(viewport);const f=await setup(page);
    for(const label of old.slice(1).map(r=>r.label)) {
      const card=page.locator('[data-passkey-list] .credential').filter({has:page.getByText(label,{exact:true})});
      await card.getByRole('button',{name:'Remove',exact:true}).click();
      await page.locator('[data-device-dialog]').getByRole('button',{name:'Remove device',exact:true}).click();
      await expect(card).toHaveCount(0);
      await expect(page.locator('[data-passkey-status]')).toHaveText('Device removed.');
      await expect(page.locator('[data-passkey-list]').getByRole('button',{name:'Remove',exact:true}).first()).toBeEnabled();
    }
    await expect(page.locator('[data-passkey-list] .credential')).toHaveCount(1);
    await expect(page.locator('[data-passkey-list]')).toContainText('JP current phone');
    await page.locator('[data-passkey-history] summary').click();
    await expect(page.locator('[data-passkey-history-list] .credential')).toHaveCount(4);
    expect(await page.evaluate(()=>window.__passkeyPrompts)).toBe(1);expect(f.calls()).toBe(5);
    const axe=await new AxeBuilder({page}).include('.card').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(axe.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
    await page.screenshot({path:testInfo.outputPath(`device-removal-${viewport.name}.png`),fullPage:true});
  });
  for(const mode of ['cancel','verify-error','only-device','list-error']) {
    test(`device removal handles ${mode} on ${viewport.name}`,async({page},testInfo)=>{
      await page.setViewportSize(viewport);const f=await setup(page,mode);
      const card=page.locator('[data-passkey-list] .credential').filter({hasText:'JP old Windows PC'});
      await card.getByRole('button',{name:'Remove',exact:true}).click();await page.locator('[data-device-dialog]').getByRole('button',{name:'Remove device',exact:true}).click();
      if(mode==='list-error') {await expect(card).toHaveCount(0);await expect(page.locator('[data-passkey-status]')).toContainText('Device removed. Refresh');expect(f.calls()).toBe(2);}
      else {await expect(card.getByRole('button',{name:'Remove',exact:true})).toBeEnabled();await expect(page.locator('[data-passkey-list] .credential')).toHaveCount(5);await expect(page.locator('[data-passkey-status]')).toContainText(mode==='cancel'?'cancelled':mode==='only-device'?'only active device':'could not be removed');expect(f.calls()).toBe(mode==='only-device'?2:1);}
      await page.screenshot({path:testInfo.outputPath(`device-removal-${mode}-${viewport.name}.png`),fullPage:true});
    });
  }
}
