'use strict';
// Bounded loopback GETs prove the mounted production routes without a client
// identity, cookie, challenge, provider send or external network dependency.
async function inspectClientCodeHttp({port,requested=false,retired=false,fetchImpl=globalThis.fetch}={}) {
  if(!requested&&!retired)return {enabled:false};
  if(!Number.isInteger(Number(port))||Number(port)<1||Number(port)>65535)return {enabled:true,ok:false};
  async function read(path){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);let reader;
    try {
      const r=await fetchImpl(`http://127.0.0.1:${Number(port)}${path}`,{method:'GET',redirect:'error',headers:{Host:'app.shilohmtc.co.za'},signal:controller.signal});
      reader=r.body?.getReader();if(!reader)throw Error();let size=0;const chunks=[];
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144)throw Error();chunks.push(Buffer.from(value));}
      return {status:r.status,private:/private/.test(r.headers.get('cache-control')||'')&&/no-store/.test(r.headers.get('cache-control')||''),html:Buffer.concat(chunks).toString('utf8')};
    }finally{clearTimeout(timer);controller.abort();if(reader)void reader.cancel().catch(()=>{});}
  }
  try {
    const entry=await read('/my-shiloh/'),details=await read('/my-shiloh/auth/crm/sign-in'),code=await read('/my-shiloh/code-auth/');
    const result={enabled:true,entryStatus:entry.status,codeStatus:code.status,detailsStatus:details.status,
      detailsClosed:details.status===410&&details.private,detailsFormAbsent:!entry.html.includes('data-client-crm-form'),
      passkeyOffered:entry.html.includes('data-passkey-sign-in'),whatsappOffered:entry.html.includes('data-client-code-sign-in'),codePrivate:code.private,
      clientSupportRoleCopy:code.html.includes('Please contact Reception.')&&!/Christel|\bJP\b/.test(code.html),
      clientRegistrationExplained:code.html.includes('Already a Shiloh client? Choose Sign in, even if this is your first time using My Shiloh. Register only if you are new to Shiloh.')};
    return {...result,ok:entry.status===200&&(!retired||result.detailsClosed&&result.detailsFormAbsent)&&(!requested||code.status===200&&result.whatsappOffered&&result.codePrivate)&&result.passkeyOffered};
  }catch(_){return {enabled:true,ok:false,code:'CLIENT_HTTP_PROOF_UNAVAILABLE'};}
}
module.exports={inspectClientCodeHttp};
