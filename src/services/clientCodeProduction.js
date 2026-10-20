'use strict';
const {Pool}=require('pg');
const logger=require('../lib/logger');
const {pool:canonicalPool}=require('../db/pool');
const {createClientBrowserSessionService}=require('./clientBrowserSession');
const {createClientCodeRelease,TOKEN}=require('./clientCodeRelease');

// An explicit same-business credential reference avoids copying or exposing the
// existing Meta token. Client proof keys, template, budget and records stay separate.
function productionClientEnv(env) {
  const result={...env};
  if(env.MY_SHILOH_CLIENT_WHATSAPP_CREDENTIAL_SOURCE==='workspace_business') {
    let staff,client;
    try {staff=JSON.parse(env.SHILOH_WORKSPACE_WHATSAPP_STAFF_MANIFEST);client=JSON.parse(env.MY_SHILOH_CLIENT_CODE_AUTH_MANIFEST);}catch(_){}
    const sameBusiness=typeof staff?.wabaId==='string'&&typeof staff?.phoneNumberId==='string'&&typeof staff?.apiVersion==='string'&&client&&staff.wabaId===client.wabaId&&staff.phoneNumberId===client.phoneNumberId&&staff.apiVersion===client.apiVersion;
    result[TOKEN]=sameBusiness?env.SHILOH_WORKSPACE_WHATSAPP_META_ACCESS_TOKEN:undefined;
  }
  return result;
}
function createProductionClientCode({env,canonicalDb,PoolClass=Pool,fetchImpl,log=logger,now}) {
  let clientPool,closed=false;
  function connection() {
    if(!clientPool) {
      clientPool=new PoolClass({connectionString:env.DATABASE_URL,max:2,
        connectionTimeoutMillis:5000,statement_timeout:5000,query_timeout:6000,
        application_name:'shiloh_client_code_auth',
        ssl:env.DATABASE_URL?.includes('render.com')?{rejectUnauthorized:false}:undefined});
      clientPool.on('error',()=>log.warn('My Shiloh WhatsApp database connection unavailable'));
    }
    return clientPool;
  }
  const db={query:(...args)=>connection().query(...args),connect:()=>connection().connect()};
  const release=createClientCodeRelease({env:productionClientEnv(env),db,
    sessions:createClientBrowserSessionService({db:canonicalDb}),fetchImpl,...(now?{now}:{})});
  return {...release,async stop(){await release.stop();if(clientPool&&!closed){closed=true;await clientPool.end();}}};
}
const production=createProductionClientCode({env:process.env,canonicalDb:canonicalPool,fetchImpl:globalThis.fetch});
module.exports=production;
module.exports.createProductionClientCode=createProductionClientCode;
module.exports.productionClientEnv=productionClientEnv;
