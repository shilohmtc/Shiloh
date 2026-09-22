'use strict';

const path = require('path');
const express = require('express');
const { pool } = require('../db/pool');
const { requireStaffSession, sameOriginGuard, csrfGuard } = require('../middleware/staffBrowserSession');
const { createGiftVoucherService, GiftVoucherError } = require('../services/giftVouchers');
const { renderWorkspaceVoucherPage } = require('../presentation/giftVoucherUx');

function createWorkspaceGiftVoucherRouter({ env=process.env, sessionService, service=createGiftVoucherService({db:pool}) }={}) {
  if (!sessionService) throw new Error('Voucher routes require the staff session service.');
  const router=express.Router();
  const requireSession=requireStaffSession({service:sessionService,env});
  const sameOrigin=sameOriginGuard({env});
  const requireCsrf=csrfGuard({service:sessionService});
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');next();});
  router.get('/client.js',requireSession,(_req,res)=>res.status(200).type('application/javascript').sendFile(path.join(__dirname,'..','..','public','workspace','gift-vouchers.js')));
  router.get('/',requireSession,async(req,res,next)=>{try{const model=await service.getWorkspaceModel({adminId:req.staffBrowserSession.adminId});const rotated=await sessionService.rotateCsrfToken(req.staffBrowserSession.sessionId);if(!rotated.ok)return res.status(401).type('text/plain').send('Unauthorized');return res.status(200).type('html').send(renderWorkspaceVoucherPage({model,csrfToken:rotated.csrfToken,displayName:req.staffBrowserSession.viewer?.displayName || '',clientScriptPath:`${req.baseUrl}/client.js`}));}catch(error){if(error instanceof GiftVoucherError)return res.status(error.httpStatus).type('text/plain').send(error.message);return next(error);}});
  const respond=(handler)=>async(req,res,next)=>{try{return res.status(200).json(await handler(req));}catch(error){if(error instanceof GiftVoucherError)return res.status(error.httpStatus).json({error:error.message,code:error.code,requestId:req.id});return next(error);}};
  router.post('/policy',sameOrigin,requireSession,requireCsrf,respond((req)=>service.updatePolicy({adminId:req.staffBrowserSession.adminId,...req.body})));
  router.post('/walk-in',sameOrigin,requireSession,requireCsrf,respond((req)=>service.createWalkInVoucher({adminId:req.staffBrowserSession.adminId,...req.body})));
  router.post('/redeem',sameOrigin,requireSession,requireCsrf,respond((req)=>service.redeem({adminId:req.staffBrowserSession.adminId,...req.body})));
  return router;
}

module.exports={createWorkspaceGiftVoucherRouter};
