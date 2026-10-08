const express = require('express');
const { pool } = require('../db/pool');
const { requireStaffSession, sameOriginGuard, csrfGuard } = require('../middleware/staffBrowserSession');
const { createBookingPaymentService } = require('../services/bookingPayments');
const { createShilohRewardsService, ShilohRewardsError } = require('../services/shilohRewards');
const { renderCalendarPaymentPage, calendarPaymentsClientScript } = require('../presentation/calendarPaymentsUx');
const { createClientTreatmentCreditService } = require('../services/clientTreatmentCredit');
const { createBookingNoncashSettlementService } = require('../services/bookingNoncashSettlement');
const { consultationRecovery } = require('../services/bookingRecovery');

function sendError(error, req, res, next) {
  const status = Number.isInteger(error?.httpStatus) ? error.httpStatus : 503;
  if (status === 503) return next(error);
  return res.status(status).json({ error:error.message, code:error.code, requestId:req.id });
}

function createCalendarPaymentsRouter({ env=process.env, sessionService, service=createBookingPaymentService({db:pool}), rewardsService=createShilohRewardsService({db:pool}), creditService=createClientTreatmentCreditService({db:pool}), giftSettlementService=createBookingNoncashSettlementService({db:pool}), renderPage=renderCalendarPaymentPage, renderClient=calendarPaymentsClientScript }={}) {
  if (!sessionService) throw new Error('Payment routes require the staff session service.');
  const router=express.Router(), requireSession=requireStaffSession({service:sessionService,env}), sameOrigin=sameOriginGuard({env}), requireCsrf=csrfGuard({service:sessionService});
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');next();});
  async function withNoncash(model,adminId) {
    if(!model.subject.crmV2ClientId)return model;
    const eligible=model.subject.status==='completed'&&!model.subject.final&&model.deposit?.requirement?.state!=='awaiting';
    model.noncash={eligible,message:'Available for completed treatment balances. Linked treatments must belong to this same client and all be completed. Booking deposits still need payment.'};
    if(!eligible)return model;
    for(const [name,load] of [['credit',()=>creditService.getClientModel({adminId,clientId:model.subject.crmV2ClientId})],['gift',()=>giftSettlementService.getAvailable({adminId,clientId:model.subject.crmV2ClientId})]]) {
      try {const value=await load();model.noncash[name]=name==='credit'?{balance:value.balance,canApply:value.authority.canApply}:value;}
      catch(error){if(error.httpStatus!==403)throw error;}
    }
    return model;
  }
  router.get('/client.js',requireSession,(_req,res)=>res.status(200).type('application/javascript').send(renderClient()));
  router.get('/appointments/:appointmentId',requireSession,async(req,res,next)=>{try{const model=await withNoncash(await service.get({adminId:req.staffBrowserSession.adminId,appointmentId:req.params.appointmentId}),req.staffBrowserSession.adminId);model.consultationRecovery=await consultationRecovery(pool,model.subject.appointmentId);const rotated=await sessionService.rotateCsrfToken(req.staffBrowserSession.sessionId);if(!rotated.ok)return res.status(401).type('text/plain').send('Unauthorized');return res.status(200).type('html').send(renderPage({model,csrfToken:rotated.csrfToken,clientScriptPath:`${req.baseUrl}/client.js`}));}catch(error){if(Number.isInteger(error?.httpStatus)&&error.httpStatus!==503)return res.status(error.httpStatus).type('text/plain').send(error.message);return next(error);}});
  router.get('/appointments/:appointmentId/state',requireSession,async(req,res,next)=>{try{return res.status(200).json(await withNoncash(await service.get({adminId:req.staffBrowserSession.adminId,appointmentId:req.params.appointmentId}),req.staffBrowserSession.adminId));}catch(error){return sendError(error,req,res,next);}});
  for(const [path,action] of [['client-credit',input=>creditService.apply(input)],['gift-voucher',input=>giftSettlementService.applyGift(input)]])router.post(`/appointments/:appointmentId/${path}`,sameOrigin,requireSession,requireCsrf,async(req,res,next)=>{try{await service.get({adminId:req.staffBrowserSession.adminId,appointmentId:req.params.appointmentId});return res.status(200).json(await action({...req.body,adminId:req.staffBrowserSession.adminId,appointmentId:req.params.appointmentId}));}catch(error){return sendError(error,req,res,next);}});
  router.post('/appointments/:appointmentId/manual',sameOrigin,requireSession,requireCsrf,async(req,res,next)=>{try{return res.status(201).json(await service.recordManual({adminId:req.staffBrowserSession.adminId,appointmentId:req.params.appointmentId,...req.body}));}catch(error){return sendError(error,req,res,next);}});
  router.post('/appointments/:appointmentId/refund',sameOrigin,requireSession,requireCsrf,async(req,res,next)=>{try{return res.status(201).json(await service.recordRefund({adminId:req.staffBrowserSession.adminId,appointmentId:req.params.appointmentId,...req.body}));}catch(error){return sendError(error,req,res,next);}});
  router.post('/appointments/:appointmentId/ozow',sameOrigin,requireSession,requireCsrf,async(req,res,next)=>{try{return res.status(201).json(await service.createOzowRequest({adminId:req.staffBrowserSession.adminId,appointmentId:req.params.appointmentId,...req.body}));}catch(error){return sendError(error,req,res,next);}});
  router.post('/appointments/:appointmentId/deposit/retry',sameOrigin,requireSession,requireCsrf,async(req,res,next)=>{try{const result=await service.retryDepositRequest({adminId:req.staffBrowserSession.adminId,appointmentId:req.params.appointmentId});return res.status(200).json({status:result.status,linksReady:(result.requests||[]).some(request=>Boolean(request.provider_payment_url)&&['link_issued','pending'].includes(request.state))});}catch(error){return sendError(error,req,res,next);}});
  router.post('/appointments/:appointmentId/rewards',sameOrigin,requireSession,requireCsrf,async(req,res,next)=>{try{return res.status(200).json(await rewardsService.applyStaffCredit({adminId:req.staffBrowserSession.adminId,appointmentId:req.params.appointmentId,...req.body}));}catch(error){if(error instanceof ShilohRewardsError)return res.status(error.httpStatus).json({error:error.message,code:error.code,requestId:req.id});return next(error);}});
  return router;
}
module.exports={createCalendarPaymentsRouter};
