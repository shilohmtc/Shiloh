'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),express=require('express');
const {chromium}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const {clientHarness}=require('../tests/helpers/clientCodeHarness');
const {createClientCodeRouter,BASE}=require('../src/routes/clientCodeAuth');
const {requireClientSession}=require('../src/middleware/clientBrowserSession');
async function main(){
  const executablePath=process.env.SHILOH_BROWSER_EXECUTABLE||['/usr/bin/chromium','/usr/bin/google-chrome'].find(p=>fs.existsSync(p));
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox']});
  const output='artifacts/workspace-whatsapp/legacy-registration';fs.mkdirSync(output,{recursive:true});
  try{for(const [label,width,height]of[['phone',390,844],['desktop',1280,900]]){
    const cleanup=[],h=await clientHarness({after:fn=>cleanup.push(fn)});
    let server,context;
    try{
      await h.db.query("INSERT INTO client_contacts(normalized_value,contact_type) VALUES($1,'mobile')",[h.context.mobile]);
      const legacy=(await h.db.query('SELECT * FROM client_contacts')).rows;
      const app=express();app.use(BASE,createClientCodeRouter({enabled:true,service:h.service,sessions:h.sessions,env:{}}));
      app.use('/my-shiloh/assets',express.static('public/my-shiloh/assets'));
      app.get('/my-shiloh/',requireClientSession({service:h.sessions,env:{}}),(_req,res)=>res.type('html').send('<!doctype html><html lang="en"><head><title>Synthetic account</title></head><body><main><h1>Synthetic signed-in account</h1></main></body></html>'));
      app.use('/storybook',express.static('storybook-static'));
      server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
      const origin=`http://127.0.0.1:${server.address().port}`;
      context=await browser.newContext({viewport:{width,height}});const page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto(origin+'/storybook/iframe.html?id=workspace-whatsapp-authentication-draft--legacy-only-registration&viewMode=story',{waitUntil:'networkidle'});
      await page.getByRole('heading',{name:'Your details',exact:true}).waitFor();
      assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
      await page.screenshot({path:`${output}/${label}-storybook-registration.png`,fullPage:true});
      async function verifyNumber(){
        await page.goto(origin+BASE+'/');await page.getByLabel('Mobile number',{exact:true}).fill('0820000001');
        const start=page.waitForResponse(r=>new URL(r.url()).pathname===BASE+'/start');
        await page.getByRole('button',{name:'Continue with WhatsApp',exact:true}).click();assert.equal((await start).status(),200);
        await h.service.dispatchOne();assert.ok(h.sent.length);
        await page.getByLabel('Verification code',{exact:true}).fill(h.sent.at(-1).code);
        await page.getByRole('button',{name:'Verify code',exact:true}).click();
      }
      await verifyNumber();await page.getByRole('heading',{name:'Your details',exact:true}).waitFor();
      assert.equal(await page.locator('#start').isVisible(),false);
      assert.deepEqual(await page.getByLabel('Gender',{exact:true}).locator('option').evaluateAll(options=>options.map(o=>({value:o.value,label:o.textContent}))),[{value:'',label:'Choose'},{value:'female',label:'Female'},{value:'male',label:'Male'}]);
      assert.equal(await page.getByLabel('Gender',{exact:true}).inputValue(),'');
      assert.equal(await page.getByLabel('Gender',{exact:true}).getAttribute('required'),'');
      assert.equal((await h.db.query('SELECT * FROM crm_v2_clients')).rows.length,0);
      assert.equal((await h.db.query('SELECT * FROM client_browser_sessions')).rows.length,0);
      assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
      await page.screenshot({path:`${output}/${label}-verified-registration.png`,fullPage:true});
      await page.getByLabel('First name',{exact:true}).fill('Explicit');await page.getByLabel('Surname',{exact:true}).fill('Synthetic');
      await page.getByLabel('Date of birth',{exact:true}).fill('1990-01-01');await page.getByLabel('Gender',{exact:true}).selectOption('female');
      await page.getByRole('button',{name:'Complete registration',exact:true}).click();
      await page.getByRole('heading',{name:'Synthetic signed-in account',exact:true}).waitFor();
      const owner=(await h.db.query('SELECT * FROM crm_v2_clients')).rows;assert.equal(owner.length,1);assert.equal(owner[0].first_name,'Explicit');
      assert.deepEqual((await h.db.query('SELECT * FROM client_contacts')).rows,legacy);
      await page.screenshot({path:`${output}/${label}-signed-in.png`,fullPage:true});
      await context.clearCookies();h.advance(60000);await verifyNumber();
      await page.getByRole('heading',{name:'Synthetic signed-in account',exact:true}).waitFor();
      assert.equal((await h.db.query('SELECT * FROM crm_v2_clients')).rows.length,1);
      assert.deepEqual((await h.db.query('SELECT * FROM client_contacts')).rows,legacy);assert.deepEqual(errors,[]);
      console.log(`${label}: real synthetic OTP, explicit registration, protected session and repeat sign-in passed; legacy contacts unchanged`);
    }finally{await context?.close();if(server)await new Promise(r=>server.close(r));for(const fn of cleanup.reverse())await fn();}
  }}finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
