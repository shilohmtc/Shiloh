'use strict';
const {createWorkspaceMetaProvider,createWorkspaceSmsProvider}=require('./workspaceWhatsAppProviders');
const {createWorkspaceWhatsAppWorker}=require('./workspaceWhatsAppRuntime');
const {createClientCodeAuth}=require('./clientCodeAuth');
const {createClientCodeStore}=require('./clientCodeStore');
const {createClientCodeRouter}=require('../routes/clientCodeAuth');
const {createAuthInvitations}=require('./authInvitations');
const {validClientBudget}=require('./clientCodeReleasePolicy');
function createClientCodeRuntime({enabled=false,config={},db,sessions,hmacKey,metaCredentials={},smsCredentials={},fetchImpl,env={},now}={}){
  // The staff template must never silently become a client template. The owner
  // must supply a distinct reviewed client contract; no default is fabricated.
  const name=config.template?.name;
  const clientContract=config.reviewedForClients===true&&typeof name==='string'&&/^[a-z][a-z0-9_]{1,511}$/.test(name)&&name!=='shiloh_workspace_verification';
  let ready=false,preparing=false;
  const gatedFetch=typeof fetchImpl==='function'? (...args)=>{
    if(!ready&&!(preparing&&args[1]?.method==='GET'))return Promise.reject(Error('Client channel unavailable'));
    return fetchImpl(...args);
  }:fetchImpl;
  const meta={audience:'client',...createWorkspaceMetaProvider({enabled:enabled&&clientContract,reviewed:config.template,
    expectedName:name,wabaId:config.wabaId,phoneNumberId:config.phoneNumberId,apiVersion:config.apiVersion,accessToken:metaCredentials.accessToken,fetchImpl:gatedFetch})};
  const sms={audience:'client',...createWorkspaceSmsProvider({enabled:enabled&&config.smsFallbackEnabled===true,
    accountEmail:smsCredentials.accountEmail,apiToken:smsCredentials.apiToken,fetchImpl,audience:'client'})};
  const configured=enabled===true&&validClientBudget(config.budget)&&clientContract&&meta.configured()&&db?.connect&&sessions?.issueVerifiedPhoneCodeSession&&
    sessions?.validateSessionToken&&sessions?.validateCsrfToken&&Buffer.isBuffer(hmacKey)&&hmacKey.length>=32&&
    (config.smsFallbackEnabled!==true||sms.configured());
  const service=createClientCodeAuth({enabled:!!configured,store:configured?createClientCodeStore({db,sessions}):null,
    delivery:{...meta,configured:()=>ready&&meta.configured()},smsDelivery:sms,hmacKey,budget:config.budget,...(now?{now}:{})});
  async function prepare(){ready=false;if(!configured)return {ok:false,code:'CLIENT_RUNTIME_UNCONFIGURED'};
    preparing=true;
    try{const r=(await db.query(`SELECT to_regclass('client_code_records') AS records,to_regclass('client_code_rates') AS rates,
      to_regclass('code_auth_invitation_visits') AS invitations,
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='client_browser_sessions' AND column_name='code_identity_revision') AS revision`)).rows[0];
      const schema=!!r?.records&&!!r.rates&&!!r.invitations&&r.revision===true;
      if(!schema)return {ok:false,code:'CLIENT_RUNTIME_SCHEMA_UNREADY'};
      const inventory=await meta.readiness();ready=inventory?.ready===true&&inventory.codeTtlSeconds===300;
      return ready?{ok:true}:{ok:false,code:'CLIENT_TEMPLATE_UNREADY'};
    }catch(_){return {ok:false,code:'CLIENT_RUNTIME_UNAVAILABLE'};}finally{preparing=false;}}
  return {prepare,stop:()=>{ready=false;preparing=false;},status:()=>({configured:!!configured,enabled:service.enabled()}),service,worker:createWorkspaceWhatsAppWorker({service,enabled}),
    router:createClientCodeRouter({enabled,service,sessions,env,invitations:configured?createAuthInvitations({db,audience:'client'}):null})};
}
module.exports={createClientCodeRuntime};
