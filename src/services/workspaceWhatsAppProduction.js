'use strict';
const {Pool}=require('pg');
const {createStaffBrowserSessionService}=require('./staffBrowserSession');
const {pool:canonicalPool}=require('../db/pool');
const {createWorkspaceWhatsAppRelease}=require('./workspaceWhatsAppRelease');

// One production composition, shared by HTTP, passkey completion and lifecycle.
// Its small dedicated pool connects lazily and never changes canonical sessions'
// pool settings. Importing a disabled release performs no DB/provider work.
let pilotPool;
function connection() {
  if(!pilotPool)pilotPool=new Pool({connectionString:process.env.DATABASE_URL,max:2,
    connectionTimeoutMillis:5000,statement_timeout:5000,query_timeout:6000,
    application_name:'shiloh_workspace_whatsapp_pilot',
    ssl:process.env.DATABASE_URL?.includes('render.com')?{rejectUnauthorized:false}:undefined});
  return pilotPool;
}
const db={query:(...args)=>connection().query(...args),connect:()=>connection().connect()};
module.exports=createWorkspaceWhatsAppRelease({env:process.env,db,
  sessions:createStaffBrowserSessionService({db:canonicalPool}),fetchImpl:globalThis.fetch,
  close:async()=>{if(pilotPool)await pilotPool.end();}});
