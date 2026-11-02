const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const client=require('../src/presentation/clientCodeUx');
const staff=require('../src/presentation/workspaceWhatsAppUx');
for(const width of [320,390,1440])for(const audience of ['client','staff'])test(`${audience} fifteen-minute request and verification at ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});
 const base=audience==='client'?'/my-shiloh/code-auth':'/calendar/staff-auth/whatsapp';
 const script=audience==='client'?client.clientCodeScript({base,whatsappCodeTtlSeconds:900}):staff.workspaceWhatsAppScript({whatsappSigninCodeTtlSeconds:900});
 const html=audience==='client'?client.clientCodePage({base}):staff.workspaceWhatsAppPage({recoveryEnabled:false});
 let verifies=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**'+base+'/**',async r=>{
  const path=new URL(r.request().url()).pathname;
  if(path===base+'/')return r.fulfill({contentType:'text/html',body:html});
  if(path===base+'/app.js')return r.fulfill({contentType:'application/javascript',body:script});
  if(path===base+'/start')return r.fulfill({json:{ok:true,accepted:true,request:'synthetic-request'}});
  if(path===base+'/verify'){verifies++;return r.fulfill({status:401,json:{error:'Check the code or request a fresh one.'}});}
  return r.fulfill({contentType:'application/javascript',body:''});
 });
 await page.goto(base+'/');await page.getByLabel(audience==='client'?'Mobile number':'Staff mobile number',{exact:true}).fill('0820000001');
 await page.getByRole('button',{name:audience==='client'?'Continue with WhatsApp':'Send WhatsApp code',exact:true}).click();
 await expect(page.locator('#status')).toContainText('expire after 15 minutes');
 await expect(page.getByLabel('Verification code',{exact:true})).toBeFocused();
 await page.getByLabel('Verification code',{exact:true}).fill('123456');await page.getByRole('button',{name:'Verify code',exact:true}).click();
 await expect(page.locator('#status')).toContainText('Check the code');expect(verifies).toBe(1);expect(errors).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const axe=await new AxeBuilder({page}).include('main').analyze();expect(axe.violations).toEqual([]);
 await page.screenshot({path:info.outputPath(`${audience}-otp-${width}.png`),fullPage:true});
});
