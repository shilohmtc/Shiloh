'use strict';
// Synthetic browser-only submission. No client data, database or provider access.
const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const express=require('express');
const {createClientConsultationFormsRouter}=require('../src/routes/clientConsultationForms');
for(const viewport of [{width:390,height:844},{width:1280,height:900}]) {
  test(`native consultation POST confirms once and restored pending page rechecks completion at ${viewport.width}`, async ({page})=>{
    let completed=false, submissions=0;
    const token=Buffer.alloc(32,8).toString('base64url');
    const app=express();
    app.get('/forms/assets/client-consultation.js',(_req,res)=>res.type('js').send(fs.readFileSync('public/assets/forms/client-consultation.js','utf8')));
    app.use('/forms',createClientConsultationFormsRouter({
      env: {NODE_ENV: 'test', CONSULTATION_FORM_DATA_KEY: Buffer.alloc(32,9).toString('base64url')},
      service:{isClientConsultationFormsEnabled:()=>true,parseDataKey:()=>Buffer.alloc(32,9),async openForm(){return {completed,form:{}};},async submitForm(){submissions++;completed=true;}},
      renderForm:({submissionProof})=>`<!doctype html><html lang="en"><body><form method="post" action="/forms/f/${token}" data-client-consultation-form data-clinic-checkin><input type="hidden" name="submission_proof" value="${submissionProof}"><label>Signature<input name="signature_name" id="signature_name" required></label><button data-submit-form>Sign &amp; submit securely</button></form><script src="/forms/assets/client-consultation.js" defer></script></body></html>`,
      renderCompleted:()=>renderCompletedPage(),
    }));
    const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    try {
      await page.setViewportSize(viewport);
      const url=`http://127.0.0.1:${server.address().port}/forms/f/${token}`;
      await page.goto(url);
      await page.getByLabel('Signature').fill('Synthetic Example');
      const redirects=[];page.on('response',response=>{if(response.request().method()==='POST')redirects.push(response.status());});
      await page.getByRole('button',{name:'Sign & submit securely'}).click();
      await expect(page.getByRole('heading')).toHaveText('Thank you — your form is complete.');
      expect(redirects).toEqual([303]);expect(submissions).toBe(1);
      // Simulate the stale DOM delivered by a browser history cache; pageshow must GET server truth.
      await page.setContent(`<form action="${url}" data-client-consultation-form data-submitting="true"><button disabled data-submit-form>Submitting securely…</button></form>`);
      await page.addScriptTag({url: url.replace('/f/'+token, '/assets/client-consultation.js')});
      await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
      await expect(page.getByRole('heading')).toHaveText('Thank you — your form is complete.');
      expect(submissions).toBe(1);
    } finally {await new Promise(resolve=>server.close(resolve));}
  });
}

const AxeBuilder = require('@axe-core/playwright').default;
const { renderClientConsultationFormPage, renderCompletedPage } = require('../src/presentation/clientConsultationFormUx');
for (const viewport of [{width:390,height:844}, {width:1280,height:900}]) {
  for (const scenario of ['saved', 'pending', 'offline', 'timeout']) {
    test(`stalled consultation ${scenario} recovers without another POST at ${viewport.width}`, async ({page}, testInfo) => {
      let completed = false, submissions = 0, opens = 0;
      let releasePost, releaseCheck;
      const checkHeld = new Promise(resolve => { releaseCheck = resolve; });
      const postHeld = new Promise(resolve => { releasePost = resolve; });
      const token = Buffer.alloc(32, 11).toString('base64url');
      const model = {form:{title:'Synthetic consultation',consentText:'Synthetic demonstration declaration.',sections:[]},appointment:{},prefill:{}};
      const app = express();
      app.use('/forms', createClientConsultationFormsRouter({
        env:{NODE_ENV:'test',CONSULTATION_FORM_DATA_KEY:Buffer.alloc(32,12).toString('base64url')},
        monitor:{captureException(){}},
        service:{isClientConsultationFormsEnabled:()=>true,parseDataKey:()=>Buffer.alloc(32,12),
          async openForm(){opens++;if(scenario==='timeout' && opens>1) await checkHeld;if(scenario==='offline' && opens>1) throw Object.assign(new Error('Synthetic unavailable'),{httpStatus:503});return {completed,...model};},
          async submitForm(){submissions++;completed=scenario==='saved';await postHeld;},
        },
      }));
      const server = app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
      try {
        await page.setViewportSize(viewport);
        await page.clock.install();
        await page.goto(`http://127.0.0.1:${server.address().port}/forms/f/${token}`);
        await page.getByLabel('Full name as signature').fill('Synthetic Example');
        await page.getByLabel('I have read and agree').check();
        await page.getByLabel('I confirm that the name typed').check();
        await page.evaluate(()=>document.querySelector('form').requestSubmit());
        await expect.poll(()=>submissions).toBe(1);
        // An extra Enter/programmatic submission must be blocked while saving is uncertain.
        await page.evaluate(()=>document.querySelector('form').requestSubmit());
        await page.clock.fastForward(15000);
        if(scenario==='timeout') {
          await expect(page.getByRole('status')).toContainText('Checking whether');
          await expect.poll(()=>opens).toBe(2);
          await page.clock.fastForward(10000);
        }
        if (scenario==='saved') {
          await expect(page.locator('[data-client-consultation-completed]')).toBeVisible();
          await expect(page.getByRole('heading',{name:'Thank you — your form is complete.'})).toBeFocused();
          await expect(page.locator('form')).toHaveCount(0);
        } else {
          await expect(page.getByRole('status')).toContainText(scenario==='pending'?'not confirmed yet':'could not check');
          await expect(page.getByRole('button',{name:'Awaiting confirmation'})).toBeDisabled();
          await page.screenshot({path:testInfo.outputPath(`consultation-unconfirmed-${scenario}-${viewport.width===390?'phone':'desktop'}.png`),fullPage:true});
          // Foreground restoration also checks server truth without a pageshow.persisted event.
          if (scenario==='pending') completed=true;
          if(scenario!=='timeout') await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
          if(scenario==='pending') await expect(page.locator('[data-client-consultation-completed]')).toBeVisible();
          else if(scenario==='offline') {
            await page.getByRole('button',{name:'Check my submission'}).click();
            await expect(page.getByRole('status')).toContainText('could not check');
            await expect(page.getByLabel('Full name as signature')).toHaveValue('Synthetic Example');
          }
        }
        expect(submissions).toBe(1);
        expect(opens).toBeGreaterThan(1);
        const accessibility=await new AxeBuilder({page}).analyze();
        expect(accessibility.violations).toEqual([]);
        await page.screenshot({path:testInfo.outputPath(`consultation-${scenario}-${viewport.width===390?'phone':'desktop'}.png`),fullPage:true});
        releaseCheck();
        releasePost();
        await expect(page.locator('h1')).toBeVisible();
      } finally {releaseCheck();releasePost();await page.close();await new Promise(resolve=>server.close(resolve));}
    });
  }
}

test('validation retry, response error and back/forward preserve server truth', async ({page},testInfo) => {
  let completed=false, posts=0, opens=0, unavailable=false;
  const token=Buffer.alloc(32,13).toString('base64url');
  const app=express();
  app.get('/my-shiloh/',(_req,res)=>res.send('<h1>Synthetic My Shiloh</h1>'));
  app.use('/forms',createClientConsultationFormsRouter({
    env:{NODE_ENV:'test',CONSULTATION_FORM_DATA_KEY:Buffer.alloc(32,14).toString('base64url')},monitor:{captureException(){}},
    service:{isClientConsultationFormsEnabled:()=>true,parseDataKey:()=>Buffer.alloc(32,14),
      async openForm(){opens++;return {completed,form:{title:'Synthetic consultation',consentText:'Synthetic declaration.',sections:[]},appointment:{}};},
      async submitForm(_token,values){posts++;if(unavailable)throw Object.assign(new Error('Synthetic unavailable'),{httpStatus:503});
        if(posts===1)throw Object.assign(new Error('Please check your signature.'),{httpStatus:422,values,fieldErrors:{signature_name:'Synthetic validation error.'}});
        completed=true;
      },
    },
  }));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const url=`http://127.0.0.1:${server.address().port}/forms/f/${token}`;
  try {
    await page.setViewportSize({width:320,height:800});
    await page.goto(url);
    await page.getByLabel('Full name as signature').fill('Synthetic Example');
    await page.getByLabel('I have read and agree').check();
    await page.getByLabel('I confirm that the name typed').check();
    await page.getByRole('button',{name:'Sign & submit securely'}).click();
    await expect(page.locator('.summary-error')).toHaveText('Please check your signature.');
    await expect(page.getByLabel('Full name as signature')).toHaveValue('Synthetic Example');
    await expect(page.getByRole('button',{name:'Sign & submit securely'})).toBeEnabled();
    await page.getByRole('button',{name:'Sign & submit securely'}).click();
    await expect(page.locator('[data-client-consultation-completed]')).toBeVisible();
    expect(posts).toBe(2);
    await page.goto(url.replace(`/forms/f/${token}`,'/my-shiloh/'));
    await page.goBack();
    await expect(page.locator('[data-client-consultation-completed]')).toBeVisible();
    await page.goForward();
    await expect(page.getByRole('heading')).toHaveText('Synthetic My Shiloh');
    expect(posts).toBe(2);
    completed=false;unavailable=true;
    await page.goto(url);
    await page.getByLabel('Full name as signature').fill('Synthetic Example');
    await page.getByLabel('I have read and agree').check();
    await page.getByLabel('I confirm that the name typed').check();
    await page.getByRole('button',{name:'Sign & submit securely'}).click();
    await expect(page.locator('.unavailable')).toContainText('temporarily unavailable');
    expect(posts).toBe(3);
    await page.screenshot({path:testInfo.outputPath('consultation-unavailable-narrow.png'),fullPage:true});
    expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
    expect(opens).toBeGreaterThan(2);
  } finally {await page.close();await new Promise(resolve=>server.close(resolve));}
});

const { createMyShilohRouter } = require('../src/routes/myShiloh');
const { createMyShilohConsultationFormActionService } = require('../src/services/myShilohConsultationFormActions');
for(const viewport of [{width:390,height:844},{width:1280,height:900}]) {
  test(`authenticated app entry with active service worker confirms stalled form at ${viewport.width}`, async ({page},testInfo)=>{
    let completed=false,posts=0,issued=0,releasePost;
    const heldPost=new Promise(resolve=>{releasePost=resolve;});
    const token=Buffer.alloc(32,17).toString('base64url');
    const sessionToken=Buffer.alloc(32,18).toString('base64url');
    const env={NODE_ENV:'test',CONSULTATION_FORM_DATA_KEY:Buffer.alloc(32,19).toString('base64url')};
    const reads=[];
    const formService={isClientConsultationFormsEnabled:()=>true,parseDataKey:()=>Buffer.alloc(32,19),
      async issueAccessToken({assignmentId}){expect(assignmentId).toBe(44);issued++;return {token,expiresAt:new Date(Date.now()+600000)};},
      async openForm(accessToken){expect(accessToken).toBe(token);return {completed,assignmentId:44,form:{title:'Synthetic consultation',consentText:'Synthetic declaration.',sections:[]},appointment:{}};},
      async submitForm(accessToken){expect(accessToken).toBe(token);posts++;completed=true;await heldPost;},
    };
    const db={async query(sql,params){
      if(sql.includes('myShilohConsultationFormActions:session')){expect(params.slice(0,2)).toEqual([100,200]);return {rowCount:1,rows:[{'?column?':1}]};}
      if(sql.includes('myShilohConsultationFormActions:pending')){expect(params[0]).toBe(200);expect(params[2]).toBe(44);return {rows:completed?[]:[{id:44,status:'opened'}]};}
      throw new Error('Unexpected synthetic form authority query');
    }};
    const formActionService=createMyShilohConsultationFormActionService({db,formService});
    const sessionService={async validateSessionToken(value){return value===sessionToken?{ok:true,sessionId:100,crmV2ClientId:200}:{ok:false};}};
    const app=express();
    app.use((req,_res,next)=>{if(req.method==='GET')reads.push(req.path);next();});
    app.use(createMyShilohRouter({env,sessionService,formService,formActionService}));
    app.use('/forms',createClientConsultationFormsRouter({env,service:formService,monitor:{captureException(){}}}));
    const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const origin=`http://127.0.0.1:${server.address().port}`;
    const entry=origin+'/my-shiloh/forms/complete?assignmentId=44';
    try {
      await page.setViewportSize(viewport);
      await page.context().addCookies([{name:'shiloh_client_session',value:sessionToken,url:origin,httpOnly:true,sameSite:'Strict'}]);
      await page.goto(entry);
      await page.evaluate(async()=>{await navigator.serviceWorker.register('/my-shiloh/sw.js',{scope:'/my-shiloh/'});await navigator.serviceWorker.ready;});
      await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true);
      const manifest=await (await page.request.get(origin+'/my-shiloh/manifest.webmanifest')).json();
      expect(new URL(entry).pathname.startsWith(manifest.scope)).toBe(true);
      expect(new URL(await page.locator('form').getAttribute('action'),origin).pathname.startsWith(manifest.scope)).toBe(false);
      await page.getByLabel('Full name as signature').fill('Synthetic Example');
      await page.getByLabel('I have read and agree').check();
      await page.getByLabel('I confirm that the name typed').check();
      await page.getByRole('button',{name:'Sign & submit securely'}).click();
      await expect.poll(()=>posts).toBe(1);
      // Simulated foreground return while the POST's response remains interrupted.
      await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
      await expect(page.locator('[data-client-consultation-completed]')).toBeVisible();
      expect(page.url()).toBe(entry);
      expect(issued).toBe(1);
      expect(posts).toBe(1);
      expect(reads.filter(path=>path===`/forms/f/${token}`).length).toBeGreaterThan(0);
      expect(reads.filter(path=>path==='/my-shiloh/forms/complete')).toHaveLength(1);
      const reopened=await page.request.get(entry);
      expect(reopened.status()).toBe(404); // Pending selection is not the recovery authority.
      expect(await reopened.text()).toContain('Consultation form unavailable');
      expect(await reopened.text()).not.toContain('ReferenceError');
      const canonical=await page.request.get(origin+'/forms/f/'+token);
      expect(canonical.status()).toBe(200);
      expect(await canonical.text()).toContain('data-client-consultation-completed');
      expect(posts).toBe(1);
      expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
      await page.screenshot({path:testInfo.outputPath(`consultation-app-entry-${viewport.width===390?'phone':'desktop'}.png`),fullPage:true});
    } finally {releasePost();await page.close();await new Promise(resolve=>server.close(resolve));}
  });
}
