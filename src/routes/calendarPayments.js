const express = require('express');
const { pool } = require('../db/pool');
const { requireStaffSession, sameOriginGuard, csrfGuard } = require('../middleware/staffBrowserSession');
const { createBookingPaymentService } = require('../services/bookingPayments');
const { renderCalendarPaymentPage, calendarPaymentsClientScript } = require('../presentation/calendarPaymentsUx');

function sendError(error, req, res, next) {
  const status = Number.isInteger(error?.httpStatus) ? error.httpStatus : 503;
  if (status === 503) return next(error);
  return res.status(status).json({ error:error.message, code:error.code, requestId:req.id });
}

function createCalendarPaymentsRouter({ env=process.env, sessionService, service=createBookingPaymentService({db:pool}), renderPage=renderCalendarPaymentPage, renderClient=calendarPaymentsClientScript }={}) {
  if (!sessionService) throw new Error('Payment routes require the staff session service.');
  const router=express.Router(), requireSession=requireStaffSession({service:sessionService,env}), sameOrigin=sameOriginGuard({env}), requireCsrf=csrfGuard({service:sessionService});
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');next();});
  router.get('/client.js',requireSession,(_req,res)=>res.status(200).type('application/javascript').send(renderClient()));
  router.get('/appointments/:appointmentId',requireSession,async(req,res,next)=>{try{const model=await service.get({adminId:req.staffBrowserSession.adminId,appointmentId:req.params.appointmentId});const rotated=await sessionService.rotateCsrfToken(req.staffBrowserSession.sessionId);if(!rotated.ok)return res.status(401).type('text/plain').send('Unauthorized');return res.status(200).type('html').send(renderPage({model,csrfToken:rotated.csrfToken,clientScriptPath:`${req.baseUrl}/client.js`}));}catch(error){if(Number.isInteger(error?.httpStatus)&&error.httpStatus!==503)return res.status(error.httpStatus).type('text/plain').send(error.message);return next(error);}});
  router.get('/appointments/:appointmentId/state',requireSession,async(req,res,next)=>{try{return res.status(200).json(await service.get({adminId:req.staffBrowserSession.adminId,appointmentId:req.params.appointmentId}));}catch(error){return sendError(error,req,res,next);}});
  router.post('/appointments/:appointmentId/manual',sameOrigin,requireSession,requireCsrf,async(req,res,next)=>{try{return res.status(201).json(await service.recordManual({adminId:req.staffBrowserSession.adminId,appointmentId:req.params.appointmentId,...req.body}));}catch(error){return sendError(error,req,res,next);}});
  router.post('/appointments/:appointmentId/refund',sameOrigin,requireSession,requireCsrf,async(req,res,next)=>{try{return res.status(201).json(await service.recordRefund({adminId:req.staffBrowserSession.adminId,appointmentId:req.params.appointmentId,...req.body}));}catch(error){return sendError(error,req,res,next);}});
  router.post('/appointments/:appointmentId/ozow',sameOrigin,requireSession,requireCsrf,async(req,res,next)=>{try{return res.status(201).json(await service.createOzowRequest({adminId:req.staffBrowserSession.adminId,appointmentId:req.params.appointmentId,...req.body}));}catch(error){return sendError(error,req,res,next);}});
  return router;
}
module.exports={createCalendarPaymentsRouter};
