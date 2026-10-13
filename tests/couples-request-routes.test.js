const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {createMyShilohRouter}=require('../src/routes/myShiloh');
test('named couples links survive sign-in and render the paired booking form; client payloads cannot invoke Reception conversion',async()=>{
  const session={ok:true,sessionId:44,crmV2ClientId:55,client:{firstName:'Synthetic Organiser'}};
  const calls=[];const app=express();app.use(express.json());
  app.use(createMyShilohRouter({env:{NODE_ENV:'test'},namedCouplesService:async id=>Number(id)===901,
    sessionService:{validateSessionToken:async token=>token==='valid'?session:{ok:false},rotateCsrfToken:async()=>({ok:true,csrfToken:'csrf'}),validateCsrfToken:(_s,token)=>token==='csrf'},
    profileService:{loadProfile:async()=>({requiresDobBeforeBooking:false})},bookingService:{policy:async()=>({rateBasisPoints:5000})},
    couplesBookingService:{catalogue:async()=>[{id:901,name:'Couples Massage',duration:'90 min',price:'R1080.00 for two',couplesService:true}],
      practitioners:async input=>{calls.push(input);return {practitioners:[{id:11,name:'Practitioner A'},{id:12,name:'Practitioner B'}]};},createRequest:async()=>{throw new Error('No untrusted write should reach booking');}}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try{
    const origin=`http://127.0.0.1:${server.address().port}`;const headers={cookie:'shiloh_client_session=valid'};
    let response=await fetch(origin+'/my-shiloh/book?for=two&service=901',{redirect:'manual'});
    assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/my-shiloh/?service=901&for=two#book-online');
    for(const path of ['/my-shiloh/request?service=901','/my-shiloh/book?service=901']){
      response=await fetch(origin+path,{headers,redirect:'manual'});assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/my-shiloh/book?for=two&service=901');
    }
    response=await fetch(origin+'/my-shiloh/book?for=two&service=901',{headers});assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
    const html=await response.text();assert.match(html,/data-my-shiloh-couples/);assert.match(html,/data-selected-service="901"/);assert.match(html,/R1080.00 for two/);
    assert.equal((await fetch(origin+'/my-shiloh/api/booking/couples/practitioners?serviceId=901')).status,401);
    response=await fetch(origin+'/my-shiloh/api/booking/couples/practitioners?serviceId=901',{headers});assert.equal(response.status,200);assert.deepEqual(calls,[{serviceId:'901'}]);
    response=await fetch(origin+'/my-shiloh/api/booking/couples/confirm',{method:'POST',headers:{...headers,origin,'content-type':'application/json','x-shiloh-csrf-token':'csrf'},body:JSON.stringify({_reception:{adminId:7},crmV2ClientId:999})});assert.equal(response.status,422);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
