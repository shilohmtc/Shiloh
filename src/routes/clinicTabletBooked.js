'use strict';
const express=require('express');
const {randomBytes,createHmac,timingSafeEqual}=require('node:crypto');
const {parseCookieValue,serializeExpiredSessionCookie}=require('../middleware/staffBrowserSession');
const {serializeExpiredClientSessionCookie,serializeExpiredClientAuthCookie}=require('../middleware/clientBrowserSession');
const {originMatches}=require('./clinicIpadCheckin');
const {networkGroup}=require('../services/clientCrmDetailAuth');
const {tabletBookedPage,tabletBookedResetScript,BASE}=require('../presentation/clinicTabletBookedUx');
const {TabletJourneyError}=require('../services/clinicTabletBookedJourney');
const VISIT='shiloh_tablet_visit',ENTRY='shiloh_tablet_entry',VALID=/^[A-Za-z0-9_-]{43}$/;
const proof=value=>createHmac('sha256',value).update('clinic-tablet-entry-v1').digest('base64url');
// Inactive in app.js by default. Production construction requires a separately reviewed
// activation plus the durable transactional adapter; UI standing approval alone
// must never enable this new client authentication/access surface.
function createClinicTabletBookedRouter({enabled=false,approvedForProduction=false,service,env={},codeAvailable=()=>true}={}){
  const router=express.Router(),secure=env.NODE_ENV==='production';
  const cookie=(name,value)=>`${name}=${value}; Path=${BASE}; HttpOnly; SameSite=Strict${secure?'; Secure':''}${value?'':'; Max-Age=0'}`;
  router.use(async(req,res,next)=>{
    res.set({'Cache-Control':'private, no-store, max-age=0','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','X-Robots-Tag':'noindex, nofollow, noarchive','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; form-action 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'"});
    if(!enabled||!service||(secure&&!approvedForProduction))return res.sendStatus(404);
    req.tabletDevice=parseCookieValue(req.headers.cookie,'shiloh_checkin_device');
    req.tabletGrant=parseCookieValue(req.headers.cookie,VISIT);
    req.tabletEntry=parseCookieValue(req.headers.cookie,ENTRY);
    if(req.path==='/reset.js')return next();
    try {await service.ready(req.tabletDevice);} catch(error){return next(error);}
    // Clear personal cookies only on a freshly authorised paired clinic tablet.
    res.append('Set-Cookie',serializeExpiredSessionCookie({env}));
    res.append('Set-Cookie',serializeExpiredClientSessionCookie({env}));
    res.append('Set-Cookie',serializeExpiredClientAuthCookie({env}));
    next();
  });
  const csrf=req=>VALID.test(req.tabletEntry||'')?proof(req.tabletEntry):'';
  const clear=res=>res.append('Set-Cookie',cookie(VISIT,''));
  const show=(req,res,state,extra={})=>res.type('html').send(tabletBookedPage({...state,csrf:csrf(req),...extra}));
  router.get('/reset.js',(_req,res)=>res.type('application/javascript').send(tabletBookedResetScript()));
  router.get('/',async(req,res,next)=>{try{
    if(req.tabletGrant)await service.cancel(req.tabletDevice,req.tabletGrant);
    clear(res);req.tabletEntry=randomBytes(32).toString('base64url');res.append('Set-Cookie',cookie(ENTRY,req.tabletEntry));
    return show(req,res,{state:'start'});
  }catch(error){next(error);}});
  router.get('/current',async(req,res,next)=>{try{
    const state=await service.resume(req.tabletDevice,req.tabletGrant);
    if(['help','finished'].includes(state.state))clear(res);
    return show(req,res,state);
  }catch(error){next(error);}});
  router.use(express.urlencoded({extended:false,limit:'96kb',parameterLimit:250}));
  router.use((req,res,next)=>{
    const supplied=req.body?.tablet_csrf,expected=csrf(req);
    const origin=req.get('origin'),site=req.get('sec-fetch-site');
    const same=originMatches(req)||((!origin||origin==='null')&&site!=='cross-site');
    if(!same||!expected||typeof supplied!=='string'||supplied.length!==expected.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))return res.sendStatus(403);
    next();
  });
  router.post('/start',async(req,res,next)=>{try{
    if(!codeAvailable())throw new TabletJourneyError('Codes are unavailable. Please ask Reception for help.',503);
    const result=await service.begin(req.tabletDevice,{mobile:req.body.mobile,entryGrantToken:createHmac('sha256',req.tabletEntry).update('clinic-tablet-visit-v1').digest('base64url'),network:networkGroup(req.ip||req.socket.remoteAddress)});
    res.append('Set-Cookie',cookie(VISIT,result.token));return res.redirect(303,`${BASE}/current`);
  }catch(error){next(error);}});
  router.post('/verify',async(req,res,next)=>{try{
    const state=await service.verify(req.tabletDevice,req.tabletGrant,{code:req.body.code,network:networkGroup(req.ip||req.socket.remoteAddress)});
    if(state.state==='help'){await service.cancel(req.tabletDevice,req.tabletGrant);clear(res);return show(req,res,state);}
    return res.redirect(303,`${BASE}/current`);
  }catch(error){
    if(error instanceof TabletJourneyError&&error.httpStatus===422)return res.status(422).type('html').send(tabletBookedPage({state:'code',csrf:csrf(req),error:error.message}));
    next(error);
  }});
  router.post('/choose',async(req,res,next)=>{try{
    const state=await service.choose(req.tabletDevice,req.tabletGrant,req.body.appointment_id);
    if(state.state==='help'){await service.cancel(req.tabletDevice,req.tabletGrant);clear(res);return show(req,res,state);}
    if(state.state==='finished'){clear(res);return show(req,res,state);}
    return res.redirect(303,`${BASE}/current`);
  }catch(error){next(error);}});
  router.post('/form',async(req,res,next)=>{try{
    const {tablet_csrf:_csrf,assignment_id:assignmentId,submission_proof:_proof,...answers}=req.body||{};
    const state=await service.submit(req.tabletDevice,req.tabletGrant,assignmentId,answers);
    if(state.state==='finished'){clear(res);return show(req,res,state);}
    if(state.state==='help'){await service.cancel(req.tabletDevice,req.tabletGrant);clear(res);return show(req,res,state);}
    return res.redirect(303,`${BASE}/current`);
  }catch(error){
    if(error.httpStatus===422){try{
      const state=await service.resume(req.tabletDevice,req.tabletGrant);
      if(state.state==='form')return res.status(422).type('html').send(tabletBookedPage({...state,csrf:csrf(req),error:'Please check the highlighted fields.',model:{...state.model,values:error.values||{},fieldErrors:error.fieldErrors||{}}}));
    }catch(_){/* Fail closed below. */}}
    next(error);
  }});
  router.post('/touch',async(req,res,next)=>{try{await service.touch(req.tabletDevice,req.tabletGrant);return res.sendStatus(204);}catch(error){next(error);}});
  router.post('/cancel',async(req,res,next)=>{try{await service.cancel(req.tabletDevice,req.tabletGrant);clear(res);return res.redirect(303,`${BASE}/`);}catch(error){next(error);}});
  router.use((_req,res)=>res.sendStatus(404));
  router.use((error,req,res,_next)=>{
    const status=error instanceof TabletJourneyError?error.httpStatus:503;
    if(status!==422)clear(res);
    return res.status(status).type('html').send(tabletBookedPage({state:'help',csrf:csrf(req),error:status===503?'Forms are temporarily unavailable. Please ask Reception for help.':error instanceof TabletJourneyError?error.message:'Please ask Reception for help.'}));
  });
  return router;
}
module.exports={createClinicTabletBookedRouter,VISIT,ENTRY};
