const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const express=require('express');
test.beforeEach(async({page})=>{await page.route('**/calendar/pwa/icon-192.png?*',route=>route.fulfill({contentType:'image/png',path:require.resolve('../public/assets/pwa/shiloh-pwa-192.png')}));});
const {createClientConsultationFormsRouter}=require('../src/routes/clientConsultationForms');
const {myShilohFormReturnProof}=require('../src/services/consultationFormReturn');
const env={CONSULTATION_FORM_DATA_KEY:Buffer.alloc(32,21).toString('base64url')};
const token=Buffer.alloc(32,22).toString('base64url');
for(const width of [320,390,1440]){
 test(`consultation return stays contextual through submit, reload and Back at ${width}`,async({page},testInfo)=>{
  let completed=false,posts=0;
  const app=express();
  app.use('/forms',createClientConsultationFormsRouter({env,service:{isClientConsultationFormsEnabled:()=>true,parseDataKey:()=>Buffer.alloc(32,21),async openForm(){return{completed,form:{sections:[]}};},async submitForm(){posts++;completed=true;}}}));
  app.get('/my-shiloh/',(_q,r)=>r.send('<html lang="en"><title>Synthetic bookings</title><main><h1>Synthetic My Shiloh bookings</h1></main></html>'));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
   await page.setViewportSize({width,height:900});
   const proof=myShilohFormReturnProof(token,env);
   const url=`${base}/forms/f/${token}?myShilohReturn=${proof}`;
   await page.goto(url);await page.getByLabel('Full name as signature').fill('Synthetic Example');
   await page.locator('#consent_acknowledged').check();await page.locator('#signature_confirm').check();
   await page.getByRole('button',{name:'Sign & submit securely'}).click();
   const back=page.getByRole('link',{name:'Back to My Shiloh'});await expect(back).toHaveAttribute('href','/my-shiloh/#bookings');
   expect(posts).toBe(1);await page.reload();await expect(back).toBeVisible();expect(posts).toBe(1);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   const axe=await new AxeBuilder({page}).analyze();expect(axe.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
   await page.screenshot({path:testInfo.outputPath(`return-${width}.png`),fullPage:true});
   await back.click();await expect(page).toHaveURL(`${base}/my-shiloh/#bookings`);
   await page.goBack();await expect(page.getByRole('heading')).toContainText('your form is complete');expect(posts).toBe(1);
   await page.goto(`${base}/forms/f/${token}`);await expect(page.locator('[data-my-shiloh-form-return]')).toHaveCount(0);
   await page.goto(`${base}/forms/f/${token}?myShilohReturn=https://example.com`);await expect(page.locator('[data-my-shiloh-form-return]')).toHaveCount(0);
  }finally{await new Promise(r=>server.close(r));}
 });
 test(`client search labels and return preview are clear at ${width}`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:900});
  await page.goto('/iframe.html?id=workspace-clients--marietjie-client-base&viewMode=story',{waitUntil:'networkidle'});
  await expect(page.getByLabel('Name or mobile number',{exact:true})).toHaveAttribute('name','q');
  await expect(page.getByLabel('Client status',{exact:true})).toHaveAttribute('name','status');
  await expect(page.getByLabel('Full name',{exact:true})).toHaveAttribute('name','name');
  await expect(page.getByLabel('Mobile number',{exact:true})).toHaveAttribute('name','mobile');
  await page.screenshot({path:testInfo.outputPath(`search-${width}.png`),fullPage:true});
  const axe=await new AxeBuilder({page}).analyze();expect(axe.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
  await page.goto('/iframe.html?id=workspace-required-forms--reviewer-history&viewMode=story',{waitUntil:'networkidle'});
  await expect(page.getByLabel('Search forms by client name')).toHaveValue('Client');
  await expect(page.locator('.form-history-search')).toHaveAttribute('action','/calendar/forms/history');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`form-search-${width}.png`),fullPage:true});
  await page.goto('/iframe.html?id=my-shiloh-consultation-completion--received-from-my-shiloh&viewMode=story',{waitUntil:'networkidle'});
  await expect(page.getByRole('link',{name:'Back to My Shiloh'})).toBeVisible();
 });
}
