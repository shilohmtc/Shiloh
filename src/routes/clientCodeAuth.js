'use strict';
const express=require('express'),crypto=require('node:crypto');
const {sameOriginGuard,parseCookieValue}=require('../middleware/staffBrowserSession');
const {requireClientSession,clientCsrfGuard,serializeClientSessionCookie}=require('../middleware/clientBrowserSession');
const {networkGroup}=require('../services/clientCrmDetailAuth');
const {clientCodePage,clientCodeScript}=require('../presentation/clientCodeUx');
const {authInvitationPage,authInvitationScript}=require('../presentation/authInvitations');
const BASE='/my-shiloh/code-auth';
function createClientCodeRouter({enabled=false,service,sessions,invitations,env={}}={}){
  const router=express.Router(),production=env.NODE_ENV==='production',cookie=production?'__Host-shiloh_client_code_browser':'shiloh_client_code_browser';
  const browser=(req,res,create=false)=>{let value=parseCookieValue(req.headers.cookie,cookie);if(!/^[A-Za-z0-9_-]{43}$/.test(value||'')&&create){value=crypto.randomBytes(32).toString('base64url');res.append('Set-Cookie',`${cookie}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=1800${production?'; Secure':''}`);}return /^[A-Za-z0-9_-]{43}$/.test(value||'')?value:null;};
  router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
    if(enabled!==true||!service?.enabled()||!sessions?.validateSessionToken||!sessions?.validateCsrfToken)return res.sendStatus(404);next();});
  if(!service||!sessions)return router;
  const requireSession=requireClientSession({service:sessions,env}),csrf=clientCsrfGuard({service:sessions});
  const page=(req,res,welcome=false)=>{browser(req,res,true);res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");res.type('html').send(welcome?authInvitationPage({audience:'client',base:BASE}):clientCodePage({base:BASE,sms:service.smsEnabled()}));};
  router.get('/',(req,res)=>page(req,res));router.get('/welcome',requireSession,(req,res)=>page(req,res,true));
  router.get('/app.js',(_req,res)=>res.type('application/javascript').send(clientCodeScript({base:BASE})));
  router.get('/invitations.js',(_req,res)=>res.type('application/javascript').send(authInvitationScript({audience:'client',base:BASE})));
  router.use(express.json({limit:'16kb',strict:true}),sameOriginGuard({env}));
  const action=(fn,sessionResult=false)=>async(req,res)=>{try{const browserToken=browser(req,res),network=networkGroup(req.ip||req.socket.remoteAddress);
    if(!browserToken||!network)return res.status(401).json({error:'Please reopen this page and try again.'});
    if(!await service.admitRequest?.({browserToken,network}))return res.status(429).json({error:'Please wait before trying again.'});
    const r=await fn(req,{browserToken,network});if(!r?.ok)return res.status(401).json({error:'We could not verify this request. Please try again or ask Reception for help.'});
    if(sessionResult&&r.sessionToken){res.append('Set-Cookie',serializeClientSessionCookie(r.sessionToken,{env,maxAgeSeconds:Math.max(1,Math.floor((new Date(r.expiresAt)-Date.now())/1000))}));return res.json({authenticated:true,client:r.client});}
    res.json(r);
  }catch(_){res.status(503).json({error:'Sign-in is temporarily unavailable. Please try again.'});}};
  router.post('/start',action((req,c)=>service.begin({...c,purpose:req.body.purpose,mobile:req.body.mobile})));
  router.post('/fallback/sms',action((req,c)=>service.requestSmsFallback({...c,request:req.body.request,purpose:req.body.purpose})));
  router.post('/verify',action((req,c)=>service.verify({...c,request:req.body.request,purpose:req.body.purpose,code:req.body.code}),true));
  router.post('/register',action((req,c)=>service.completeRegistration({...c,grant:req.body.grant,profile:req.body.profile}),true));
  router.post('/invitations/visit',requireSession,csrf,action(req=>invitations?.visit(req.myShilohClientSession)));
  router.post('/notifications/status',requireSession,csrf,action(req=>invitations?.notificationStatus(req.myShilohClientSession,req.body.endpoint)));
  router.use((_error,_req,res,_next)=>res.status(400).json({error:'Please check the request and try again.'}));return router;
}
module.exports={createClientCodeRouter,BASE};
