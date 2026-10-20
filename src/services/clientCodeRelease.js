'use strict';
const {createClientCodeRuntime}=require('./clientCodeRuntime');
const {clientDetailsRetired,validClientBudget}=require('./clientCodeReleasePolicy');

const ENABLED='MY_SHILOH_CLIENT_CODE_AUTH_ENABLED';
const MANIFEST='MY_SHILOH_CLIENT_CODE_AUTH_MANIFEST';
const KEY='MY_SHILOH_CLIENT_CODE_AUTH_KEY';
const TOKEN='MY_SHILOH_CLIENT_WHATSAPP_META_ACCESS_TOKEN';
function parseClientManifest(value) {
  if(typeof value!=='string'||value.length>32768)return null;
  try {
    const m=JSON.parse(value);
    if(!m||Array.isArray(m)||Object.keys(m).some(k=>!['reviewedForClients','template','wabaId','phoneNumberId','apiVersion','budget','smsFallbackEnabled'].includes(k))||
      m.reviewedForClients!==true||m.smsFallbackEnabled!==false||!validClientBudget(m.budget))return null;
    return m;
  }catch(_){return null;}
}

// Prepared composition only: no default DB, process.env, timers or provider I/O.
// Production mounting/activation waits for reviewed client Meta and eligibility.
function createClientCodeRelease({env={},db,sessions,fetchImpl,now}={}) {
  const requested=env[ENABLED]==='true',manifest=parseClientManifest(env[MANIFEST]);
  const key=typeof env[KEY]==='string'&&/^[a-f0-9]{64}$/i.test(env[KEY])?Buffer.from(env[KEY],'hex'):null;
  const credential=typeof env[TOKEN]==='string'&&env[TOKEN].length>0;
  const missing=[...(!manifest?[MANIFEST]:[]),...(!key?[KEY]:[]),...(!credential?[TOKEN]:[])];
  const runtime=createClientCodeRuntime({enabled:requested&&missing.length===0,config:manifest||{},db,sessions,
    hmacKey:key,metaCredentials:{accessToken:credential?env[TOKEN]:undefined},fetchImpl,env,...(now?{now}:{})});
  let controller=null,pending=null,state=requested?'unready':'disabled';
  const status=()=>({requested,state,enabled:state==='running'&&runtime.service.enabled(),
    detailsSigninRetired:clientDetailsRetired(env),smsEnabled:false,missing:[...missing]});
  async function start() {
    if(controller||state==='starting')return {ok:false,code:'CLIENT_ALREADY_STARTED',...status()};
    if(!requested||missing.length)return {ok:false,code:'CLIENT_RELEASE_UNCONFIGURED',...status()};
    state='starting';const result=await runtime.prepare();
    if(state!=='starting'){runtime.stop();return {ok:false,code:'CLIENT_RELEASE_STOPPED',...status()};}
    if(!result.ok){state='unready';return {...result,...status()};}
    controller=new AbortController();state='running';
    pending=runtime.worker.run({signal:controller.signal}).then(result=>{
      if(!result.ok&&state==='running'){state='unready';runtime.stop();}
      return result;
    }).catch(()=>{state='unready';runtime.stop();});
    return {ok:true,...status()};
  }
  async function stop(){state='stopped';runtime.stop();controller?.abort();if(pending)await pending;}
  return {status,start,stop,mount:app=>app.use('/my-shiloh/code-auth',runtime.router)};
}
module.exports={createClientCodeRelease,parseClientManifest,ENABLED,MANIFEST,KEY,TOKEN};
