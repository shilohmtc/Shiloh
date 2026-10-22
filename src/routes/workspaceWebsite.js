'use strict';
const express = require('express');
const multer = require('multer');
const path = require('node:path');
const { requireStaffSession, sameOriginGuard, csrfGuard, expectedOrigin } = require('../middleware/staffBrowserSession');
const { createWebsiteContentService } = require('../services/websiteContent');
const { WebsiteContentError } = require('../domain/websiteContent');
const { renderWorkspaceWebsite } = require('../presentation/workspaceWebsite');
const { renderEditorialArticle } = require('../services/publicWebsite');

function createWorkspaceWebsiteRouter({ env = process.env, sessionService, service = createWebsiteContentService() } = {}) {
  if (!sessionService) throw new Error('Website publishing requires the existing staff session service.');
  const router = express.Router();
  const session = requireStaffSession({ service:sessionService, env });
  const origin = sameOriginGuard({env}), csrf = csrfGuard({service:sessionService});
  function imageOrigin(req,res,next) {
    const expected=expectedOrigin(req);
    let actual;
    try { actual=new URL(req.get('origin')).origin; } catch(_error) { return res.sendStatus(403); }
    if (!expected || actual!==expected || (env.NODE_ENV==='production' && !expected.startsWith('https://'))
      || (req.get('sec-fetch-site') && req.get('sec-fetch-site')!=='same-origin')) return res.sendStatus(403);
    if (!req.is('multipart/form-data')) return res.status(415).json({error:'Choose an image file.'});
    return next();
  }
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Robots-Tag','noindex, nofollow');res.setHeader('X-Content-Type-Options','nosniff');next();});
  async function owner(req,res,next) {
    try { if (!await service.resolveAccess(req.staffBrowserSession.adminId)) return res.status(403).send('Website publishing is available to clinic administrators.'); return next(); }
    catch(error){return next(error);}
  }
  function handle(handler) {
    return async(req,res,next)=>{try{return await handler(req,res);}catch(error){if(error instanceof WebsiteContentError)return res.status(error.httpStatus).json({error:error.message,code:error.code});return next(error);}};
  }
  router.get('/client.js',session,owner,(_req,res)=>res.type('application/javascript').sendFile(path.join(__dirname,'../../public/workspace/website.js')));
  router.get('/',session,owner,handle(async(req,res)=>{
    const model=await service.model({adminId:req.staffBrowserSession.adminId});
    const rotated=await sessionService.rotateCsrfToken(req.staffBrowserSession.sessionId);
    if(!rotated.ok)return res.sendStatus(401);
    return res.type('html').send(renderWorkspaceWebsite({model,csrfToken:rotated.csrfToken,displayName:req.staffBrowserSession.viewer?.displayName || ''}));
  }));
  router.get('/:postId/history',session,owner,handle(async(req,res)=>res.json(await service.history({adminId:req.staffBrowserSession.adminId,postId:req.params.postId}))));
  router.get('/:postId/preview',session,owner,handle(async(req,res)=>{
    const model=await service.model({adminId:req.staffBrowserSession.adminId});
    const post=model.posts.find(p=>p.id===req.params.postId);
    if(!post)return res.sendStatus(404);
    if(req.query.revision && Number(req.query.revision)!==post.revision)return res.status(409).send('This draft changed. Open a fresh preview from Website.');
    return res.type('html').send(renderEditorialArticle({id:post.id,slug:post.slug,kind:post.kind,ruleCode:post.rule_code,...post.draft},{preview:true,mediaPrefix:'/calendar/website/media/'}));
  }));
  router.get('/media/:id',session,owner,handle(async(req,res)=>{
    const media=await service.media({id:req.params.id,adminId:req.staffBrowserSession.adminId});
    return media ? res.type(media.mime_type).send(media.bytes) : res.sendStatus(404);
  }));
  router.post('/create',origin,session,csrf,owner,handle(async(req,res)=>res.status(201).json(await service.createEpisode({adminId:req.staffBrowserSession.adminId,document:req.body?.document}))));
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024,files:1,fields:0,parts:1}}).single('image');
  router.post('/image',imageOrigin,session,csrf,owner,(req,res,next)=>upload(req,res,error=>{
    if(error)return res.status(error.code==='LIMIT_FILE_SIZE'?413:422).json({error:'Choose one JPEG, PNG or WebP image no larger than 2 MB.'});
    return next();
  }),handle(async(req,res)=>res.status(201).json(await service.uploadImage({adminId:req.staffBrowserSession.adminId,bytes:req.file?.buffer}))));
  for(const action of ['save','publish','unpublish','restore'])router.post(`/:postId/${action}`,origin,session,csrf,owner,handle(async(req,res)=>{
    const allowed=new Set(['revision','document','restoreRevision']);
    if(!req.body || Object.keys(req.body).some(key=>!allowed.has(key)))throw new WebsiteContentError('WEBSITE_REQUEST_INVALID','Reload the editor and try again.');
    return res.json(await service.edit({adminId:req.staffBrowserSession.adminId,postId:req.params.postId,action,revision:req.body.revision,document:req.body.document,restoreRevision:req.body.restoreRevision}));
  }));
  return router;
}
module.exports={createWorkspaceWebsiteRouter};
