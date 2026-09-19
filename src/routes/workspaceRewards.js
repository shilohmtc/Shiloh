'use strict';

const express=require('express');
const {pool}=require('../db/pool');
const {requireStaffSession,sameOriginGuard,csrfGuard}=require('../middleware/staffBrowserSession');
const {createShilohRewardsService,ShilohRewardsError}=require('../services/shilohRewards');
const {renderWorkspaceRewardsPage,workspaceRewardsScript}=require('../presentation/shilohRewardsUx');

function createWorkspaceRewardsRouter({env=process.env,sessionService,service=createShilohRewardsService({db:pool})}={}){
  if(!sessionService)throw new Error('Rewards routes require the staff session service.');
  const router=express.Router(),requireSession=requireStaffSession({service:sessionService,env}),sameOrigin=sameOriginGuard({env}),requireCsrf=csrfGuard({service:sessionService});
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');next();});
  router.get('/client.js',requireSession,(_req,res)=>res.status(200).type('application/javascript').send(workspaceRewardsScript()));
  router.get('/',requireSession,async(req,res,next)=>{try{const [model,rotated]=await Promise.all([service.getWorkspaceModel({adminId:req.staffBrowserSession.adminId}),sessionService.rotateCsrfToken(req.staffBrowserSession.sessionId)]);if(!rotated.ok)return res.status(401).type('text/plain').send('Unauthorized');return res.status(200).type('html').send(renderWorkspaceRewardsPage({model,csrfToken:rotated.csrfToken,displayName:req.staffBrowserSession.viewer?.displayName||'',clientScriptPath:`${req.baseUrl}/client.js`}));}catch(error){if(error instanceof ShilohRewardsError)return res.status(error.httpStatus).type('text/plain').send(error.message);return next(error);}});
  router.post('/adjust',sameOrigin,requireSession,requireCsrf,async(req,res,next)=>{try{return res.status(200).json(await service.adjust({adminId:req.staffBrowserSession.adminId,...req.body}));}catch(error){if(error instanceof ShilohRewardsError)return res.status(error.httpStatus).json({error:error.message,code:error.code,requestId:req.id});return next(error);}});
  return router;
}

module.exports={createWorkspaceRewardsRouter};
