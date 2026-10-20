'use strict';
const {Pool}=require('pg');
const {inspectClientAuthReadiness,FLAG}=require('./clientAuthReadiness');
module.exports=async function clientAuthReadinessProduction(){
  if(process.env[FLAG]!=='true')return {enabled:false};
  const db=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,
    statement_timeout:5000,query_timeout:6000,application_name:'shiloh_client_auth_readonly_preflight',
    ssl:process.env.DATABASE_URL?.includes('render.com')?{rejectUnauthorized:false}:undefined});
  db.on('error',()=>{});
  try{return await inspectClientAuthReadiness({env:process.env,db,fetchImpl:globalThis.fetch});}
  finally{await db.end().catch(()=>{});}
};
