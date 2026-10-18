'use strict';
const {createWorkspaceWhatsAppRuntime} = require('./workspaceWhatsAppRuntime');
const {passkeyPolicy} = require('./staffPasskeyAuth');
const {BASE} = require('../routes/workspaceWhatsAppAuth');

const positive = value => Number.isSafeInteger(value) && value > 0;
const accountId = value => (typeof value === 'number' || typeof value === 'string' && /^[1-9][0-9]*$/.test(value)) && positive(Number(value)) ? Number(value) : null;

// Operator-supplied canonical IDs only. Names and request bodies cannot select
// participants. No default window, budget, identifiers or recovery permission.
function createWorkspaceWhatsAppPilotPolicy(input = {}, whatsappCostMinor) {
  input=input && typeof input==='object' && !Array.isArray(input)?input:{};
  const subjectId=accountId(input.subjectId),operatorId=accountId(input.operatorId);
  const start=typeof input.startsAt==='string'?Date.parse(input.startsAt):NaN;
  const end=typeof input.endsAt==='string'?Date.parse(input.endsAt):NaN;
  const scopeId=input.scopeId,maxMessages=input.maxMessages,maxSpendMinor=input.maxSpendMinor;
  const recoveryEnabled=input.recoveryEnabled===true;
  const valid=!!subjectId && !!operatorId && subjectId!==operatorId &&
    typeof scopeId==='string' && /^[A-Za-z0-9_-]{16,80}$/.test(scopeId) &&
    Number.isFinite(start) && Number.isFinite(end) && end>start &&
    /(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(input.startsAt) && /(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(input.endsAt) &&
    positive(maxMessages) && maxMessages<=3 && positive(maxSpendMinor) && positive(whatsappCostMinor) &&
    maxSpendMinor>=whatsappCostMinor;
  const withinWindow=current=>valid && Number.isFinite(new Date(current).getTime()) && +new Date(current)>=start && +new Date(current)<end;
  return Object.freeze({valid,withinWindow,
    allowsSubject:(id,purpose,current)=>withinWindow(current) && accountId(id)===subjectId &&
      (purpose==='signin' || purpose==='enroll' || purpose==='recover' && recoveryEnabled),
    allowsOperator:(id,current)=>withinWindow(current) && accountId(id)===operatorId,
    reservationBuckets:({digest,current,channel})=>[
      {key:digest('pilot-messages',scopeId),limit:maxMessages,amount:channel==='whatsapp'?1:maxMessages+1,windowMs:end-(+current)},
      {key:digest('pilot-spend',scopeId),limit:maxSpendMinor,amount:whatsappCostMinor,windowMs:end-(+current)},
    ],
  });
}

// Default-off application adapter. The production release composition injects
// all authorities and explicitly owns mount/start/stop.
// Constructing it performs no DB/provider I/O and installs no process listeners.
function createWorkspaceWhatsAppPilot({enabled=false,pilot={},config={},env={},now=()=>new Date(),...dependencies}={}) {
  config=config && typeof config==='object' && !Array.isArray(config)?config:{};
  env=env && typeof env==='object' && !Array.isArray(env)?env:{};
  const policy=createWorkspaceWhatsAppPilotPolicy(pilot,config.budgets?.whatsappCostMinor);
  const configured=enabled===true && policy.valid && passkeyPolicy(env).operational;
  let active=false,closed=false,mounted=false,preflight=false,state=configured?'idle':'disabled';
  let controller,task,startPromise;
  const runtime=createWorkspaceWhatsAppRuntime({...dependencies,enabled:configured,
    config:{...config,smsFallbackEnabled:false},smsCredentials:{},env,now,accessPolicy:policy,
    isEnabled:()=>active && !closed && policy.withinWindow(now()),
    allowProviderRead:()=>preflight && !closed && policy.withinWindow(now())});
  const status=()=>({state:active && !policy.withinWindow(now())?'expired':state,
    enabled:runtime.service.enabled(),smsEnabled:false});
  function mount(app) {
    if(mounted || typeof app?.use!=='function') return {ok:false,code:'PILOT_MOUNT_INVALID'};
    app.use(BASE,runtime.router);mounted=true;return {ok:true};
  }
  function start() {
    if(closed) return Promise.resolve({ok:false,code:'PILOT_STOPPED'});
    if(state==='unavailable' || state==='expired') return Promise.resolve({ok:false,code:'PILOT_UNAVAILABLE'});
    if(startPromise) return startPromise;
    startPromise=(async()=>{
      if(!configured) return {ok:false,code:'PILOT_UNCONFIGURED'};
      if(!policy.withinWindow(now())) return {ok:false,code:'PILOT_OUTSIDE_WINDOW'};
      state='preparing';
      const result=await runtime.prepare();
      if(!result.ok || closed) {state=closed?'stopped':'unavailable';return closed?{ok:false,code:'PILOT_STOPPED'}:result;}
      if(!policy.withinWindow(now())) {state='expired';return {ok:false,code:'PILOT_OUTSIDE_WINDOW'};}
      preflight=true;
      let provider;
      try {provider=await runtime.checkProvider();} catch (_) {provider=null;}
      finally {preflight=false;}
      if(closed){state='stopped';return {ok:false,code:'PILOT_STOPPED'};}
      if(!policy.withinWindow(now())) {state='expired';return {ok:false,code:'PILOT_OUTSIDE_WINDOW'};}
      if(!provider?.ready){state='unavailable';return {ok:false,code:'PILOT_PROVIDER_UNREADY'};}
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
        policy.allowsSubject(session.adminId,'signin',now()) ? `${BASE}/welcome` : '/calendar';
    } catch (_) {return '/calendar';}
  }
  return {mount,start,stop,status,passkeySuccessDestination};
}
module.exports={createWorkspaceWhatsAppPilot,createWorkspaceWhatsAppPilotPolicy};
