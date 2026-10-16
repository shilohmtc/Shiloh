const test=require('node:test');
const assert=require('node:assert/strict');
const {myShilohFormReturnProof,validMyShilohFormReturn}=require('../src/services/consultationFormReturn');
const {renderCompletedPage}=require('../src/presentation/clientConsultationFormUx');
const env={CONSULTATION_FORM_DATA_KEY:Buffer.alloc(32,19).toString('base64url')};
const token=Buffer.alloc(32,18).toString('base64url');
test('presentation return marker is bound to its form and cannot select a destination',()=>{
 const proof=myShilohFormReturnProof(token,env);
 assert.equal(validMyShilohFormReturn(token,proof,env),true);
 for(const input of [undefined,[],{},'https://example.com',proof.slice(1),proof.replace(/^./,proof[0]==='A'?'B':'A')])assert.equal(validMyShilohFormReturn(token,input,env),false);
 assert.equal(validMyShilohFormReturn(Buffer.alloc(32,17).toString('base64url'),proof,env),false);
 assert.equal(validMyShilohFormReturn(token,proof,{CONSULTATION_FORM_DATA_KEY:Buffer.alloc(32,20).toString('base64url')}),false);
 assert.doesNotMatch(renderCompletedPage(),/data-my-shiloh-form-return/);
 assert.match(renderCompletedPage({returnToMyShiloh:true}),/href="\/my-shiloh\/#bookings"/);
 assert.doesNotMatch(renderCompletedPage({returnToMyShiloh:true}),new RegExp(token+'|'+proof));
});

test('return marker never substitutes for the existing submission proof',()=>{
 const {validSubmissionProof}=require('../src/routes/clientConsultationForms');
 assert.equal(validSubmissionProof(token,myShilohFormReturnProof(token,env),env),false);
});

test('clinic iPad completion ignores an otherwise valid app return marker',async()=>{
 const express=require('express');
 const {createClientConsultationFormsRouter}=require('../src/routes/clientConsultationForms');
 const app=express();let finished=0;
 app.use('/forms',createClientConsultationFormsRouter({env:{...env,SHILOH_CLINIC_IPAD_CHECKIN_ENABLED:'true'},service:{isClientConsultationFormsEnabled:()=>true,parseDataKey:()=>Buffer.alloc(32,19),async openForm(){return{completed:true};}},clinicCheckin:{async formAccess(){return{kiosk:true,allowed:true};},async finishForm(){finished++;}}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{
  const result=await fetch(`http://127.0.0.1:${server.address().port}/forms/f/${token}?myShilohReturn=${myShilohFormReturnProof(token,env)}`,{redirect:'manual'});
  assert.equal(result.status,303);assert.equal(result.headers.get('location'),'/check-in/thank-you');assert.equal(finished,1);assert.match(result.headers.get('set-cookie'),/Max-Age=0/);
 }finally{await new Promise(r=>server.close(r));}
});
