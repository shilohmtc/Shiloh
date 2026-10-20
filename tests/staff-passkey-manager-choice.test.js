'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {harness}=require('./helpers/workspaceWhatsAppHarness');
const {fixture,RP_ID,ORIGIN}=require('./helpers/workspaceWhatsAppWebauthn');
const {createStaffPasskeyAuthService}=require('../src/services/staffPasskeyAuth');
async function key(h,adminId){
  const f=fixture(),id=f.credentialId.toString('base64url');
  await h.db.query(`INSERT INTO staff_auth_passkey_credentials(admin_id,credential_id,public_key_spki,algorithm,sign_count,transports,device_label)
    VALUES($1,$2,$3,-7,0,'["internal"]','Synthetic password manager')`,[adminId,id,f.publicKey.export({type:'spki',format:'der'})]);
  return {...f,id};
}
function assertion(k,challenge){
  const clientData=Buffer.from(JSON.stringify({type:'webauthn.get',challenge,origin:ORIGIN,crossOrigin:false}));
  const auth=Buffer.alloc(37);crypto.createHash('sha256').update(RP_ID).digest().copy(auth);auth[32]=5;auth.writeUInt32BE(1,33);
  const signature=crypto.sign('sha256',Buffer.concat([auth,crypto.createHash('sha256').update(clientData).digest()]),k.privateKey);
  return {id:k.id,rawId:k.id,type:'public-key',response:{clientDataJSON:clientData.toString('base64url'),authenticatorData:auth.toString('base64url'),signature:signature.toString('base64url'),userHandle:null}};
}
test('remembered staff account accepts either active password-manager key, never a foreign or revoked key',async t=>{
  const h=await harness(t),s=createStaffPasskeyAuthService({db:h.db,env:h.env,now:h.now});
  const samsung=await key(h,1),google=await key(h,1),foreign=await key(h,2),revoked=await key(h,1);
  await h.db.query('UPDATE staff_auth_passkey_credentials SET revoked_at=NOW() WHERE credential_id=$1',[revoked.id]);
  for(const selected of [samsung,google,foreign,revoked]){
    const start=await s.beginAuthentication({credentialIdHint:samsung.id});assert.equal(start.ok,true);
    assert.deepEqual(start.options.allowCredentials.map(x=>x.id),[samsung.id,google.id]);
    const result=await s.finishAuthentication({response:assertion(selected,start.options.challenge)});
    assert.equal(result.ok,[samsung,google].includes(selected));
    if(result.ok){assert.equal(result.credentialHint,selected.id);assert.equal(Number((await h.sessions.validateSessionToken(result.sessionToken)).adminId),1);}
  }
  const free=await s.beginAuthentication();assert.deepEqual(free.options.allowCredentials,[]);assert.equal(free.discoverable,true);
});
