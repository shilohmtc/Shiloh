'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const express=require('express');const {PGlite}=require('@electric-sql/pglite');
const {install,serviceFor,SESSION}=require('./helpers/clientPaymentChoiceFixture');
const {createClientBrowserSessionService}=require('../src/services/clientBrowserSession');
const {createMyShilohRouter}=require('../src/routes/myShiloh');
test('actual remembered-session middleware, CSRF/origin and owned-account payment route: no GET issuance, no caller amount/payer authority',async t=>{
 const pg=new PGlite();const query=async(sql,args)=>{const r=args?await pg.query(sql,args):(await pg.exec(sql)).at(-1);return {...r,rowCount:r.rows?.length||r.affectedRows||0};};
 const db={query,connect:async()=>({query,release(){}})};await install(db);
 const token='S'.repeat(43),hash=x=>crypto.createHash('sha256').update(x).digest('hex');
 await db.query(`ALTER TABLE client_browser_sessions ADD COLUMN token_hash TEXT,ADD COLUMN csrf_hash TEXT,ADD COLUMN issued_at TIMESTAMPTZ,
   ADD COLUMN auth_method TEXT,ADD COLUMN reauthenticated_at TIMESTAMPTZ,ADD COLUMN last_used_at TIMESTAMPTZ;
   UPDATE client_browser_sessions SET issued_at='2026-10-16T09:00Z',auth_method='crm_details';`);
 await db.query('UPDATE client_browser_sessions SET token_hash=$1 WHERE id=$2',[hash(token),SESSION]);
 let calls=0;const paymentService=serviceFor(db,{createPaymentLink:async()=>{calls++;return {providerRequestId:'SYNTHETIC_ROUTE',paymentUrl:'https://pay.ozow.com/SYNTHETIC_ROUTE'};}});
 const sessionService=createClientBrowserSessionService({db,now:()=>new Date('2026-10-16T09:00Z')});
 const app=express();app.use(express.json());app.use(createMyShilohRouter({env:{NODE_ENV:'test'},sessionService,paymentService}));app.use((err,req,res,next)=>{res.status(500).json({error:err.message});});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{await new Promise(r=>server.close(r));await pg.close();});
 const base=`http://127.0.0.1:${server.address().port}`,cookie=`shiloh_client_session=${token}`;
 assert.equal((await fetch(`${base}/my-shiloh/payment?appointment=201`)).status,401);
 const page=await fetch(`${base}/my-shiloh/payment?appointment=201`,{headers:{cookie}});assert.equal(page.status,200);const html=await page.text();
 assert.equal(calls,0);assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM payment_requests')).rows[0].n,0);
 const csrf=html.match(/data-csrf="([^"]+)"/)[1],review=html.match(/data-review="([^"]+)"/)[1];
 const body={appointmentId:201,choice:'full',review,operationId:'synthetic_http_operation',confirmed:true,amount:'0.01',crmV2ClientId:102,payer_crm_v2_client_id:102};
 const post=headers=>fetch(`${base}/my-shiloh/api/payments/collect`,{method:'POST',headers:{cookie,'content-type':'application/json',origin:base,...headers},body:JSON.stringify(body)});
 assert.equal((await post({})).status,403);assert.equal((await post({'x-shiloh-csrf-token':csrf,origin:'https://foreign.invalid'})).status,403);assert.equal(calls,0);
 body.appointmentId=204;assert.equal((await post({'x-shiloh-csrf-token':csrf})).status,404);assert.equal(calls,0);
 body.appointmentId=201;const paid=await post({'x-shiloh-csrf-token':csrf});assert.equal(paid.status,200);const result=await paid.json();assert.equal(result.status,'ready');assert.equal(result.amount,'1000.00');assert.equal(calls,1);
 assert.equal((await db.query('SELECT payer_crm_v2_client_id FROM payment_requests')).rows[0].payer_crm_v2_client_id,101);
 await db.query('UPDATE client_browser_sessions SET revoked_at=NOW()');assert.equal((await post({'x-shiloh-csrf-token':csrf})).status,401);assert.equal(calls,1);
});

test('public terms GET and acceptance POST revalidate actual canonical amounts after a manual receipt',async t=>{
 const {createPaymentLinkRouter}=require('../src/routes/paymentLinks');const pg=new PGlite();
 const query=async(sql,args)=>{const r=args?await pg.query(sql,args):(await pg.exec(sql)).at(-1);return {...r,rowCount:r.rows?.length||r.affectedRows||0};};const db={query,connect:async()=>({query,release(){}})};await install(db);
 await db.query('CREATE TABLE booking_policy_acceptances(appointment_id BIGINT,policy_version TEXT)');
 const service=serviceFor(db),i=inputFor();i.review=(await service.getClientPaymentChoices(i)).review;
 const prepared=await service.collectClientPayment(i);
 const app=express();app.use(express.urlencoded({extended:false}));app.use('/pay',createPaymentLinkRouter({db,paymentService:service,policySchema:async()=>{}}));app.use((err,req,res,next)=>res.status(500).send(err.message));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{await new Promise(r=>server.close(r));await pg.close();});
 const url=`http://127.0.0.1:${server.address().port}${prepared.paymentPath}`;
 assert.equal((await fetch(url)).status,200);
 await service.recordManual({adminId:2,appointmentId:201,amount:'100',method:'cash',operationId:'synthetic_route_manual'});
 assert.equal((await fetch(url)).status,409);
 const accept=await fetch(`${url}/accept`,{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded'},body:'accept=yes'});assert.equal(accept.status,409);assert.equal(accept.headers.get('location'),null);
 assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM booking_policy_acceptances')).rows[0].n,0);
 function inputFor(){return require('./helpers/clientPaymentChoiceFixture').input();}
});

test('recognized payment/rewards reservation conflicts retain domain409 through actual route handlers',async t=>{
 const {BookingPaymentError}=require('../src/services/bookingPayments'),{ShilohRewardsError}=require('../src/services/shilohRewards');
 const {assertNoClientCollection}=require('../src/services/paymentCollectionGuard');
 const queryable={query:async()=>({rows:[{request_key:'cpc_SYNTHETIC_UNCERTAIN',state:'pending',created_by_admin_id:null}]})};
 const app=express();app.use(express.json());app.use(createMyShilohRouter({env:{NODE_ENV:'test'},sessionService:{validateSessionToken:async()=>({ok:true,sessionId:1001,crmV2ClientId:101}),validateCsrfToken:()=>true},
  paymentService:{collectClientPayment:async()=>assertNoClientCollection(queryable,80,BookingPaymentError)},
  rewardsService:{applyCredit:async()=>assertNoClientCollection(queryable,80,ShilohRewardsError)}}));app.use((err,req,res,next)=>res.status(500).json({error:err.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}`;
 for(const suffix of ['payments/collect','rewards/redeem']){
  const result=await fetch(`${base}/my-shiloh/api/${suffix}`,{method:'POST',headers:{origin:base,cookie:`shiloh_client_session=${'S'.repeat(43)}`,'content-type':'application/json','x-shiloh-csrf-token':'synthetic'},body:JSON.stringify({appointmentId:201,amount:'100',operationId:'synthetic_guard_route'})});
  assert.equal(result.status,409);assert.equal((await result.json()).code,'PAYMENT_CLIENT_ATTEMPT_UNRESOLVED');
 }
});

test('actual authenticated shared review preserves only existing explicit payer continuation; public checkout revalidates exact fixed amount',async t=>{
 const pg=new PGlite();const query=async(sql,args)=>{const r=args?await pg.query(sql,args):(await pg.exec(sql)).at(-1);return {...r,rowCount:r.rows?.length||r.affectedRows||0};};const db={query,connect:async()=>({query,release(){}})};await install(db);await require('./helpers/clientPaymentChoiceFixture').mixedPayer(db);
 const service=serviceFor(db);await db.query('CREATE TABLE booking_policy_acceptances(appointment_id BIGINT,policy_version TEXT)');
 const app=express();let identity={ok:true,sessionId:1001,crmV2ClientId:101};
 app.use(createMyShilohRouter({env:{NODE_ENV:'test'},sessionService:{validateSessionToken:async()=>identity,rotateCsrfToken:async()=>({ok:true,csrfToken:'synthetic'}),validateCsrfToken:()=>true},paymentService:service}));
 app.use('/pay',require('../src/routes/paymentLinks').createPaymentLinkRouter({db,paymentService:service,policySchema:async()=>{}}));app.use((err,req,res,next)=>res.status(500).send(err.message));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{await new Promise(r=>server.close(r));await pg.close();});const base=`http://127.0.0.1:${server.address().port}`,headers={cookie:`shiloh_client_session=${'S'.repeat(43)}`};
 const page=await fetch(`${base}/my-shiloh/payment?appointment=201`,{headers});assert.equal(page.status,200);const html=await page.text();assert.match(html,/href="\/pay\/synthetic_mixed_payer_fixed"/);assert.match(html,/R500\.00/);assert.doesNotMatch(html,/R1500|Synthetic Other|type="radio"|Remaining treatment amount/);
 assert.equal((await fetch(`${base}/pay/synthetic_mixed_payer_fixed`)).status,200);
 identity={ok:true,sessionId:1002,crmV2ClientId:102};const other=await fetch(`${base}/my-shiloh/payment?appointment=203`,{headers});assert.equal(other.status,200);assert.doesNotMatch(await other.text(),/synthetic_mixed_payer_fixed|R1500|R500|type="radio"/);
 await service.recordManual({adminId:2,appointmentId:201,amount:'100',method:'cash',payerMobile:'27810000101',operationId:'synthetic_mixed_changed'});
 assert.equal((await fetch(`${base}/pay/synthetic_mixed_payer_fixed`)).status,409);
 const post=await fetch(`${base}/pay/synthetic_mixed_payer_fixed/accept`,{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded'},body:'accept=yes'});assert.equal(post.status,409);assert.equal(post.headers.get('location'),null);
});

test('public deferred redirect requires every projected provenance field and the preparation audit; staff-shaped historic prefix never redirects',async t=>{
 const pg=new PGlite();const query=async(sql,args)=>{const r=args?await pg.query(sql,args):(await pg.exec(sql)).at(-1);return {...r,rowCount:r.rows?.length||r.affectedRows||0};};const db={query,connect:async()=>({query,release(){}})};await install(db);
 let calls=0;const service=serviceFor(db,{createPaymentLink:async()=>{calls++;throw Error('No external call');}},{deposits:{ensureRequirement:async()=>({applicable:true,requirement:{id:90,payment_account_id:80,state:'awaiting',required_amount:'500.00'},members:[{appointment_id:201,required_amount:'500.00'}],scope:{appointmentId:201,members:[{appointmentId:201,crmV2ClientId:101,clientName:'Synthetic',clientMobile:'27810000101'}]}})}});
 const prepared=await service.ensureDepositRequest({appointmentId:201}),key=prepared.requests[0].request_key;
 const app=express();app.use('/pay',require('../src/routes/paymentLinks').createPaymentLinkRouter({db,paymentService:service,policySchema:async()=>{}}));app.use((err,req,res,next)=>res.status(500).send(err.message));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{await new Promise(r=>server.close(r));await pg.close();});const url=`http://127.0.0.1:${server.address().port}/pay/${key}`;
 const fresh=await fetch(url,{redirect:'manual'});assert.equal(fresh.status,303);assert.equal(fresh.headers.get('location'),'/my-shiloh/payment?appointment=201');
 await db.query('UPDATE payment_requests SET created_by_admin_id=2 WHERE request_key=$1',[key]);assert.equal((await fetch(url,{redirect:'manual'})).status,409);assert.equal(calls,0);
});
