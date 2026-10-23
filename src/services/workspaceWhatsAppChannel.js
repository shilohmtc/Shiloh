'use strict';
const {createWorkspaceWhatsAppRuntime}=require('./workspaceWhatsAppRuntime');
const {passkeyPolicy}=require('./staffPasskeyAuth');
const {BASE}=require('../routes/workspaceWhatsAppAuth');

// Shared lifecycle only. The pilot and ongoing staff adapters supply distinct
// validated eligibility and record-scope policies; neither starts on import.
function createWorkspaceWhatsAppChannel({enabled=false,policy,codePrefix='PILOT',config={},env={},now=()=>new Date(),...dependencies}={}) {
  config=config && typeof config==='object' && !Array.isArray(config)?config:{};
  env=env && typeof env==='object' && !Array.isArray(env)?env:{};
  const code=suffix=>codePrefix+'_'+suffix;
  const configured=enabled===true && policy?.valid && passkeyPolicy(env).operational;
  let active=false,closed=false,mounted=false,preflight=false,state=configured?'idle':'disabled';
  let controller,task,startPromise;
  const runtime=createWorkspaceWhatsAppRuntime({...dependencies,enabled:configured,
    config:{...config,smsFallbackEnabled:false},smsCredentials:{},env,now,accessPolicy:policy,
    isEnabled:()=>active && !closed && policy.withinWindow(now()),
    allowProviderRead:()=>preflight && !closed && policy.withinWindow(now())});
  const status=()=>({state:active && !policy.withinWindow(now())?'expired':state,
    enabled:runtime.service.enabled(),smsEnabled:false,worker:runtime.worker.status()});
  function mount(app) {
    if(mounted || typeof app?.use!=='function') return {ok:false,code:code('MOUNT_INVALID')};
    app.use(BASE,runtime.router);mounted=true;return {ok:true};
  }
  function start() {
    if(closed) return Promise.resolve({ok:false,code:code('STOPPED')});
    if(state==='unavailable' || state==='expired') return Promise.resolve({ok:false,code:code('UNAVAILABLE')});
    if(startPromise) return startPromise;
    startPromise=(async()=>{
      if(!configured) return {ok:false,code:code('UNCONFIGURED')};
      if(!policy.withinWindow(now())) return {ok:false,code:code('OUTSIDE_WINDOW')};
      state='preparing';
      const result=await runtime.prepare();
      if(!result.ok || closed) {state=closed?'stopped':'unavailable';return closed?{ok:false,code:code('STOPPED')}:result;}
      if(!policy.withinWindow(now())) {state='expired';return {ok:false,code:code('OUTSIDE_WINDOW')};}
      preflight=true;
      let provider;
      try {provider=await runtime.checkProvider();} catch (_) {provider=null;}
      finally {preflight=false;}
      if(closed){state='stopped';return {ok:false,code:code('STOPPED')};}
      if(!policy.withinWindow(now())) {state='expired';return {ok:false,code:code('OUTSIDE_WINDOW')};}
      if(!provider?.ready){state='unavailable';return {ok:false,code:code('PROVIDER_UNREADY')};}
      controller=new AbortController();active=true;state='running';
      task=runtime.worker.run({signal:controller.signal}).then(result=>{
        active=false;state=closed?'stopped':!policy.withinWindow(now())?'expired':'unavailable';
        return result;
      },()=>{active=false;state=closed?'stopped':'unavailable';return {ok:false,code:'WORKER_UNAVAILABLE'};});
      return {ok:true};
    })();
    return startPromise;
  }
  async function stop() {
    // Close intake and grant completion synchronously before awaiting any I/O.
    closed=true;active=false;state='stopped';controller?.abort();
    if(startPromise) await startPromise;
    if(task) await task;
    return {ok:true,stopped:true};
  }
  async function passkeySuccessDestination(sessionToken) {
    if(!runtime.service.enabled()) return '/calendar';
    try {
      const session=await dependencies.sessions.validateSessionToken(sessionToken);
      return session?.ok && session.authMethod==='passkey' && runtime.service.enabled() &&
        policy.allowsSubject(session.adminId,'signin',now()) ? '/calendar/workspace' : '/calendar';
    } catch (_) {return '/calendar';}
  }
  return {mount,start,stop,status,passkeySuccessDestination};
}
module.exports={createWorkspaceWhatsAppChannel};
