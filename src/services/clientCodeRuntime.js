'use strict';
const {createWorkspaceMetaProvider,createWorkspaceSmsProvider}=require('./workspaceWhatsAppProviders');
const {createWorkspaceWhatsAppWorker}=require('./workspaceWhatsAppRuntime');
const {createClientCodeAuth}=require('./clientCodeAuth');
const {createClientCodeStore}=require('./clientCodeStore');
const {createClientCodeRouter}=require('../routes/clientCodeAuth');
const {createAuthInvitations}=require('./authInvitations');
function createClientCodeRuntime({enabled=false,config={},db,sessions,hmacKey,metaCredentials={},smsCredentials={},fetchImpl,env={}}={}){
  // The staff template must never silently become a client template. The owner
  // must supply a distinct reviewed client contract; no default is fabricated.
  const name=config.template?.name;
  const clientContract=config.reviewedForClients===true&&typeof name==='string'&&/^[a-z][a-z0-9_]{1,511}$/.test(name)&&name!=='shiloh_workspace_verification';
  const meta={audience:'client',...createWorkspaceMetaProvider({enabled:enabled&&clientContract,reviewed:config.template,
    expectedName:name,wabaId:config.wabaId,phoneNumberId:config.phoneNumberId,apiVersion:config.apiVersion,accessToken:metaCredentials.accessToken,fetchImpl})};
  const sms={audience:'client',...createWorkspaceSmsProvider({enabled:enabled&&config.smsFallbackEnabled===true,
    accountEmail:smsCredentials.accountEmail,apiToken:smsCredentials.apiToken,fetchImpl,audience:'client'})};
  const configured=enabled===true&&clientContract&&meta.configured()&&db?.connect&&sessions?.issueVerifiedPhoneCodeSession&&
    sessions?.validateSessionToken&&sessions?.validateCsrfToken&&Buffer.isBuffer(hmacKey)&&hmacKey.length>=32&&
    (config.smsFallbackEnabled!==true||sms.configured());
  let ready=false;
  const service=createClientCodeAuth({enabled:!!configured,store:configured?createClientCodeStore({db,sessions}):null,
    delivery:{...meta,configured:()=>ready&&meta.configured()},smsDelivery:sms,hmacKey});
  async function prepare(){ready=false;if(!configured)return {ok:false,code:'CLIENT_RUNTIME_UNCONFIGURED'};
    try{const r=(await db.query(`SELECT to_regclass('client_code_records') AS records,to_regclass('client_code_rates') AS rates,
      to_regclass('code_auth_invitation_visits') AS invitations,
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='client_browser_sessions' AND column_name='code_identity_revision') AS revision`)).rows[0];
      ready=!!r?.records&&!!r.rates&&!!r.invitations&&r.revision===true;return {ok:ready};
    }catch(_){return {ok:false,code:'CLIENT_RUNTIME_SCHEMA_UNREADY'};}}
  return {prepare,service,worker:createWorkspaceWhatsAppWorker({service,enabled}),
    router:createClientCodeRouter({enabled,service,sessions,env,invitations:configured?createAuthInvitations({db,audience:'client'}):null})};
}
module.exports={createClientCodeRuntime};
