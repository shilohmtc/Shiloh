'use strict';
// Synthetic browser-only submission. No client data, database or provider access.
const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const express=require('express');
const {createClientConsultationFormsRouter}=require('../src/routes/clientConsultationForms');
for(const viewport of [{width:390,height:844},{width:1280,height:900}]) {
  test(`consultation POST confirms once and restored pending page rechecks completion at ${viewport.width}`, async ({page})=>{
    let completed=false, submissions=0;
    const token=Buffer.alloc(32,8).toString('base64url');
    const app=express();
    app.get('/forms/assets/client-consultation.js',(_req,res)=>res.type('js').send(fs.readFileSync('public/assets/forms/client-consultation.js','utf8')));
    app.use('/forms',createClientConsultationFormsRouter({
      env: {NODE_ENV: 'test', CONSULTATION_FORM_DATA_KEY: Buffer.alloc(32,9).toString('base64url')},
      service:{isClientConsultationFormsEnabled:()=>true,parseDataKey:()=>Buffer.alloc(32,9),async openForm(){return {completed,form:{}};},async submitForm(){submissions++;completed=true;}},
      renderForm:({submissionProof})=>`<!doctype html><html lang="en"><body><form method="post" action="/forms/f/${token}" data-client-consultation-form><input type="hidden" name="submission_proof" value="${submissionProof}"><label>Signature<input name="signature_name" id="signature_name" required></label><button data-submit-form>Sign &amp; submit securely</button></form><script src="/forms/assets/client-consultation.js" defer></script></body></html>`,
      renderCompleted:()=>'<h1>Thank you — your form is complete.</h1>',
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
