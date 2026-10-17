'use strict';
const crypto=require('node:crypto');
const {normalizeMobile}=require('./crmV2ClientService');
const {details}=require('./clientCrmDetailAuth');
const {codeReservationBuckets}=require('./codeSignInPolicy');
const token=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const INVALID=Object.freeze({ok:false,code:'CLIENT_CODE_INVALID'});
const DISABLED=Object.freeze({ok:false,code:'CLIENT_CODE_DISABLED'});
const equalHash=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
// A separate client namespace, store and provider approval are mandatory.
// Construction/import has no effects. Public intake never looks up an account.
function createClientCodeAuth({enabled=false,store,delivery,smsDelivery,hmacKey,now=()=>new Date(),randomBytes=crypto.randomBytes,randomInt=crypto.randomInt}={}) {
  const key=Buffer.isBuffer(hmacKey)?Buffer.from(hmacKey):null;
  const operational=()=>enabled===true&&key?.length>=32&&store?.transaction&&delivery?.audience==='client'&&delivery.configured?.()===true;
  const smsEnabled=()=>operational()&&smsDelivery?.audience==='client'&&smsDelivery.configured?.()===true;
  const hash=(...parts)=>crypto.createHmac('sha256',key).update(JSON.stringify(['my-shiloh-code',...parts])).digest('hex');
  const crypt=(mobile,id)=>{const nonce=randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',Buffer.from(hash('encryption'),'hex'),nonce);c.setAAD(Buffer.from(id));const body=Buffer.concat([c.update(mobile),c.final()]);return Buffer.concat([nonce,c.getAuthTag(),body]).toString('base64');};
  const decrypt=row=>{const p=Buffer.from(row.mobile,'base64'),c=crypto.createDecipheriv('aes-256-gcm',Buffer.from(hash('encryption'),'hex'),p.subarray(0,12));c.setAAD(Buffer.from(row.hash));c.setAuthTag(p.subarray(12,28));return Buffer.concat([c.update(p.subarray(28)),c.final()]).toString('utf8');};
  function context(input){return token(input.browserToken)&&typeof input.network==='string'&&input.network.length>0&&input.network.length<=120;}
  async function admitRequest(input={}){
    if(!operational()||!context(input))return false;
    return store.transaction(tx=>tx.takeRate([{key:hash('http-network',input.network),limit:60,windowMs:600000},
      {key:hash('http-browser',input.browserToken),limit:30,windowMs:600000},
      {key:hash('http-clinic'),limit:500,windowMs:600000}],now()));
  }
  async function begin(input={}) {
    if(!operational())return DISABLED;
    if(!context(input)||!['signin','register'].includes(input.purpose))return INVALID;
    const request=randomBytes(32).toString('base64url'),mobile=typeof input.mobile==='string'&&input.mobile.length<=30?normalizeMobile(input.mobile):null;
    await store.transaction(async tx=>{
      const current=now();
      if(!await tx.takeRate([{key:hash('intake-phone',mobile||'invalid'),limit:6,windowMs:600000},
        {key:hash('intake-network',input.network),limit:30,windowMs:600000},
        {key:hash('intake-clinic'),limit:300,windowMs:600000}],current))return;
      const id=hash('request',request);
      await tx.insert({hash:id,browserHash:hash('browser',input.browserToken),personKey:hash('phone',mobile||'invalid'),
        purpose:input.purpose,mobile:crypt(mobile||'',id),state:'queued',channel:'whatsapp',issuedAt:current,
        expiresAt:new Date(current.getTime()+900000),sendBy:new Date(current.getTime()+300000),attempts:0});
    });
    return {ok:true,accepted:true,request};
  }
  async function requestSmsFallback(input={}) {
    if(!smsEnabled())return DISABLED;
    if(!context(input)||!token(input.request))return INVALID;
    await store.transaction(async tx=>{
      const current=now(),row=await tx.get(hash('request',input.request));
      if(!row||row.browserHash!==hash('browser',input.browserToken)||row.purpose!==input.purpose||row.channel!=='whatsapp'||row.fallbackUsed||row.fallbackRequested||!row.mobile||new Date(row.expiresAt)<=current)return;
      const expired=row.codeExpiresAt&&new Date(row.codeExpiresAt)<=current;
      if(!['not_sent','claimed'].includes(row.state)&&!(expired&&['ready','uncertain'].includes(row.state)))return;
      row.fallbackRequested=true;
      if(row.state!=='claimed'){row.state='queued';row.channel='sms';row.fallbackUsed=true;row.codeHash=null;row.sendBy=new Date(current.getTime()+300000);}
      await tx.save(row);
    });
    return {ok:true,accepted:true,request:input.request};
  }
  async function dispatchOne(){
    if(!operational())return DISABLED;
    const row=await store.transaction(tx=>tx.claim(now()));
    if(!row)return {ok:true,processed:false};
    const done={ok:true,processed:true},provider=row.channel==='sms'?smsDelivery:delivery;
    async function settle(outcome){await store.transaction(async tx=>{const r=await tx.get(row.hash);if(r?.state!=='claimed')return;r.state=outcome;
      if(outcome==='not_sent'&&r.channel==='whatsapp'&&r.fallbackRequested&&!r.fallbackUsed){r.state='queued';r.channel='sms';r.fallbackUsed=true;r.sendBy=new Date(now().getTime()+300000);}
      await tx.save(r);});}
    let mobile,ready;
    try{mobile=decrypt(row);ready=await provider?.readiness();}catch(_){await settle('not_sent');return done;}
    if(!ready?.ready||ready.codeTtlSeconds!==300){await settle('not_sent');return done;}
    const prepared=await store.transaction(async tx=>{
      const current=now(),r=await tx.get(row.hash);
      if(!r||r.state!=='claimed'||!mobile||new Date(r.sendBy)-current<60000)return null;
      const identity=await tx.identity(mobile);
      if(row.purpose==='signin'?!identity.verified:!identity.empty)return null;
      if(await tx.uncertain(row.personKey,current))return null;
      const until=await tx.rateUntil(hash('code-resend','client',row.personKey),current);
      if(until){r.state='queued';r.notBefore=until;await tx.save(r);return {deferred:true};}
      if(!await tx.takeRate(codeReservationBuckets({audience:'client',personKey:row.personKey,channel:row.channel,digest:hash,current}),current))return null;
      const code=String(randomInt(0,1000000)).padStart(6,'0');
      r.codeHash=hash('code',r.hash,r.purpose,code);r.codeExpiresAt=new Date(current.getTime()+300000);
      r.clientId=identity.owner?.id||null;r.identityRevision=identity.revision||null;
      r.attempts=0;r.deliveryStarted=true;
      await tx.revokeOthers(r.personKey,r.hash);await tx.save(r);
      return {code,mobile};
    });
    if(prepared?.deferred)return done;
    if(!prepared){await settle('not_sent');return done;}
    let sent;try{sent=await provider.deliver({...prepared,codeTtlSeconds:300});}catch(_){sent={};}
    await store.transaction(async tx=>{const r=await tx.get(row.hash);if(r?.state!=='claimed')return;
      const accepted=sent?.ok===true&&typeof sent.providerMessageId==='string'&&sent.providerMessageId.startsWith(row.channel==='sms'?'sms.':'wamid.');
      r.state=accepted?'ready':sent?.outcome==='not_sent'?'not_sent':'uncertain';
      if(['ready','uncertain'].includes(r.state))r.fallbackRequested=false;
      if(r.state==='not_sent'&&r.channel==='whatsapp'&&r.fallbackRequested&&!r.fallbackUsed){r.state='queued';r.channel='sms';r.fallbackUsed=true;r.codeHash=null;r.sendBy=new Date(now().getTime()+300000);}
      await tx.save(r);
    });return done;
  }
  async function verify(input={}){
    if(!operational())return DISABLED;
    if(!context(input)||!token(input.request))return INVALID;
    return store.transaction(async tx=>{
      const current=now();
      if(!await tx.takeRate([{key:hash('verify-network',input.network),limit:100,windowMs:600000}],current))return INVALID;
      const r=await tx.get(hash('request',input.request));
      if(!r||r.state!=='ready'||r.purpose!==input.purpose||r.browserHash!==hash('browser',input.browserToken))return INVALID;
      if(new Date(r.codeExpiresAt)<=current||r.attempts>=5){r.state='revoked';await tx.save(r);return INVALID;}
      r.attempts++;
      if(typeof input.code!=='string'||!/^\d{6}$/.test(input.code)||!equalHash(r.codeHash,hash('code',r.hash,r.purpose,input.code))){
        if(r.attempts>=5)r.state='revoked';await tx.save(r);return INVALID;
      }
      const mobile=decrypt(r);
      const identity=await tx.identity(mobile);
      if(r.purpose==='signin'&&(!identity.verified||Number(identity.owner.id)!==Number(r.clientId)||identity.revision!==r.identityRevision)||r.purpose==='register'&&!identity.empty){r.state='revoked';await tx.save(r);return INVALID;}
      r.state='consumed';await tx.save(r);
      if(r.purpose==='register'){
        const grant=randomBytes(32).toString('base64url');
        await tx.insert({...r,hash:hash('registration',grant),state:'profile',mobile:crypt(mobile,hash('registration',grant)),expiresAt:new Date(current.getTime()+300000)});
        return {ok:true,grant,profileRequired:true};
      }
      const result=await tx.issueSession({owner:identity.owner,mobile,channel:r.channel,current});
      if(!result?.ok)throw Error('Client continuation unavailable');return result;
    });
  }
  async function completeRegistration(input={}){
    if(!operational())return DISABLED;
    if(!context(input)||!token(input.grant))return INVALID;
    return store.transaction(async tx=>{
      const current=now(),r=await tx.get(hash('registration',input.grant));
      if(!r||r.state!=='profile'||r.browserHash!==hash('browser',input.browserToken)||new Date(r.expiresAt)<=current)return INVALID;
      const mobile=decrypt(r),profile=details({...input.profile,mobile},true);
      if(!profile)return INVALID;
      if(!(await tx.identity(mobile)).empty){r.state='revoked';await tx.save(r);return INVALID;}
      r.state='consumed';await tx.save(r);
      const owner=await tx.register({profile,mobile,current});
      if(!owner)throw Error('Client registration unavailable');
      const result=await tx.issueSession({owner,mobile,channel:r.channel,current});
      if(!result?.ok)throw Error('Client continuation unavailable');return result;
    });
  }
  return {enabled:operational,smsEnabled,admitRequest,begin,requestSmsFallback,dispatchOne,verify,completeRegistration};
}
module.exports={createClientCodeAuth};
