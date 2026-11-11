'use strict';
const {createClinicTabletBookedAuthority}=require('./clinicTabletBookedAuthority');
const {createClinicTabletGrantStore}=require('./clinicTabletGrantStore');
const {createClinicTabletOtpProof}=require('./clinicTabletOtpProof');
const {createClinicTabletBookedJourney}=require('./clinicTabletBookedJourney');
const {createClinicTabletBookedRouter}=require('../routes/clinicTabletBooked');
const {createWorkspaceWhatsAppWorker}=require('./workspaceWhatsAppRuntime');
// Private runtime composition only. No app mount, environment switch, worker
// start or migration occurs on import/construction without explicit approval.
function buildClinicTabletBookedPreparation({approved=false,db,delivery,hmacKey,budget,whatsappCodeTtlSeconds,
  checkin,formService,env={},now=()=>new Date(),onDiagnostic,workerOptions={}}={}){
  if(approved!==true)throw new Error('Tablet authentication and migration approval required');
  const authority=createClinicTabletBookedAuthority({db,formService,checkin,now});
  const store=createClinicTabletGrantStore({db,hmacKey,closeForm:authority.forms.close,now});
  const proofs=createClinicTabletOtpProof({db,delivery,hmacKey,budget,whatsappCodeTtlSeconds,now,onDiagnostic});
  const service=createClinicTabletBookedJourney({store,otp:proofs,...authority,now});
  let lastCleanup=0,controller=null,pending=null;
  const worker=createWorkspaceWhatsAppWorker({enabled:true,service:{enabled:proofs.enabled,dispatchOne:async()=>{
    if(now().getTime()-lastCleanup>=60000){await store.pruneBatch();lastCleanup=now().getTime();}
    return proofs.dispatchOne();
  }},...workerOptions});
  return {service,router:createClinicTabletBookedRouter({enabled:true,approvedForProduction:true,service,env,codeAvailable:()=>proofs.enabled()&&worker.status().state==='running'}),
    async start(){if(controller||!proofs.enabled())return {ok:false};controller=new AbortController();pending=worker.run({signal:controller.signal});return {ok:true};},
    async stop(){controller?.abort();if(pending)await pending;controller=null;pending=null;},
    status:()=>({running:!!controller,worker:worker.status()})};
}
module.exports={buildClinicTabletBookedPreparation};
