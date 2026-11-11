'use strict';
const {createClientCodeAuth}=require('./clientCodeAuth');
const {createClientCodeStore}=require('./clientCodeStore');
const {validClientBudget}=require('./clientCodeReleasePolicy');
// Receives the SAME private provider, HMAC key and reviewed budget as the
// approved client runtime. No independent template, credential or allowance.
function createClinicTabletOtpProof({db,delivery,hmacKey,budget,now,whatsappCodeTtlSeconds=300,onDiagnostic}={}){
  if(!db?.connect||!Buffer.isBuffer(hmacKey)||hmacKey.length!==32||!validClientBudget(budget)||delivery?.audience!=='client')throw new Error('The reviewed client provider, key and budget are required');
  const noSessions={issueVerifiedPhoneCodeSession:()=>{throw new Error('Tablet cannot issue client sessions');}};
  const make=transactionClient=>createClientCodeAuth({enabled:true,phoneProofOnly:true,
    store:createClientCodeStore({db,sessions:noSessions,transactionClient}),delivery,hmacKey,budget,
    tabletProofAllowed:(row,tx,current)=>tx.tabletAllowed(row.tabletDeviceId,row.tabletGrantHash,current),
    onDiagnostic,whatsappCodeTtlSeconds,...(now?{now}:{})});
  const worker=make();
  async function action(name,input,tx){
    if(!tx?.query)throw new Error('Tablet proof must share the grant transaction');
    const auth=make(tx);
    if(!await auth.admitRequest(input))return {ok:false};
    return auth[name]({...input,purpose:'tablet_forms'});
  }
  return {proofOnly:true,sharedAllowance:true,atomic:true,
    begin:(input,tx)=>action('begin',input,tx),verify:(input,tx)=>action('verify',input,tx),
    dispatchOne:()=>worker.dispatchOne(),enabled:()=>worker.enabled()};
}
module.exports={createClinicTabletOtpProof};
