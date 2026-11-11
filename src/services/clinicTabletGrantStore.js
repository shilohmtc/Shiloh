'use strict';
const crypto=require('node:crypto');
const {TabletJourneyError,IDLE_MS,LIFE_MS}=require('./clinicTabletBookedJourney');
function createClinicTabletGrantStore({db,hmacKey,closeForm,now=()=>new Date(),randomBytes=crypto.randomBytes}={}){
  if(!db?.connect||!Buffer.isBuffer(hmacKey)||hmacKey.length<32||typeof closeForm!=='function')throw new Error('Explicit durable tablet store and key required');
  const key=Buffer.from(crypto.hkdfSync('sha256',hmacKey,'shiloh-tablet-grants','encrypted-visit-v1',32));
  const aad=(deviceId,hash)=>Buffer.from(JSON.stringify([String(deviceId),hash]));
  function encrypt(deviceId,hash,state){
    const iv=randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad(deviceId,hash));
    const bytes=Buffer.from(JSON.stringify(state));if(bytes.length>32768)throw new Error('Tablet state too large');
    return Buffer.concat([iv,cipher.update(bytes),cipher.final(),cipher.getAuthTag()]).toString('base64');
  }
  function decrypt(row){
    const bytes=Buffer.from(row.payload_ciphertext,'base64');
    const cipher=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAAD(aad(row.device_id,row.token_hash));cipher.setAuthTag(bytes.subarray(-16));
    const state=JSON.parse(Buffer.concat([cipher.update(bytes.subarray(12,-16)),cipher.final()]).toString());
    if(state.state!==row.state||String(state.form?.assignmentId||'')!==String(row.assignment_id||''))throw new Error('Tablet grant state mismatch');
    return state;
  }
  async function transaction(deviceId,fn,{allowRevoked=false}={}){
    const client=await db.connect();try{
      await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='3s'");await client.query("SET LOCAL statement_timeout='10s'");
      // Legacy contact writers do not share the canonical phone advisory key.
      // A bounded shared predicate lock prevents a new/changed legacy match
      // between the ownership snapshot check and the form transaction commit.
      await client.query('LOCK TABLE client_contacts IN SHARE MODE');
      const d=(await client.query('SELECT id FROM clinic_checkin_devices WHERE id=$1 AND ($2 OR revoked_at IS NULL) FOR UPDATE',[deviceId,allowRevoked])).rows[0];
      if(!d)throw new TabletJourneyError('This tablet is not available.',401);
      const result=await fn(client);await client.query('COMMIT');return result;
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
  }
  async function audit(tx,deviceId,from,to){
    if(from===to)return;
    await tx.query(`INSERT INTO staff_auth_security_events(event_type,metadata) VALUES('clinic_tablet_grant_transition',$1::jsonb)`,[JSON.stringify({deviceId:String(deviceId),from:from||null,to})]);
  }
  async function create(deviceId,hash,build){
    if(!/^[0-9a-f]{64}$/.test(hash))throw new Error('Invalid tablet grant key');
    return transaction(deviceId,async tx=>{
      const old=(await tx.query('SELECT * FROM clinic_tablet_visit_grants WHERE device_id=$1 FOR UPDATE',[deviceId])).rows;
      const same=old.find(row=>row.token_hash===hash);
      if(same){
        const state=decrypt(same);
        if(['cancelled','finished'].includes(state.state)||new Date(same.expires_at)<=now()||now()-new Date(same.last_activity_at)>=IDLE_MS)throw new TabletJourneyError();
        return {state:state.state,reused:true};
      }
      for(const row of old){const s=decrypt(row);if(s.form)await closeForm(s.form,tx);}
      await tx.query('DELETE FROM clinic_tablet_visit_grants WHERE device_id=$1',[deviceId]);
      const state=await build(tx);
      if(!Number.isFinite(state.expiresAt)||state.expiresAt-state.createdAt>LIFE_MS)throw new Error('Invalid tablet lifetime');
      await tx.query(`INSERT INTO clinic_tablet_visit_grants(token_hash,device_id,state,payload_ciphertext,created_at,last_activity_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [hash,deviceId,state.state,encrypt(deviceId,hash,state),new Date(state.createdAt),new Date(state.touchedAt),new Date(state.expiresAt)]);
      await audit(tx,deviceId,null,state.state);
      return {state:state.state,reused:false};
    });
  }
  async function withGrant(deviceId,hash,fn){return transaction(deviceId,async tx=>{
    const row=(await tx.query('SELECT * FROM clinic_tablet_visit_grants WHERE device_id=$1 AND token_hash=$2 FOR UPDATE',[deviceId,hash])).rows[0];
    if(!row)return fn(null,tx);
    const state=decrypt(row),from=state.state;
    const result=await fn(state,tx);
    // No form answers are stored here; the canonical encrypted submission is
    // the only record of clinical input.
    const expiresAt=Math.min(state.expiresAt||Infinity,new Date(row.expires_at).getTime());
    state.expiresAt=expiresAt;
    const touchedAt=state.touchedAt||new Date(row.last_activity_at).getTime();
    await tx.query(`UPDATE clinic_tablet_visit_grants SET state=$3,payload_ciphertext=$4,last_activity_at=$5,expires_at=$6,assignment_id=$7 WHERE device_id=$1 AND token_hash=$2`,
      [deviceId,hash,state.state,encrypt(deviceId,hash,state),new Date(touchedAt),new Date(expiresAt),state.state==='form'?state.form?.assignmentId:null]);
    await audit(tx,deviceId,from,state.state);return result;
  });}
  // Invoke from the reviewed feature lifecycle, not a new paid service. The
  // bounded per-device cleanup uses the same lock order and revokes live form
  // tokens before deleting expired encrypted grants.
  async function prune(deviceId){return transaction(deviceId,async tx=>{
    const rows=(await tx.query('SELECT * FROM clinic_tablet_visit_grants WHERE device_id=$1 FOR UPDATE',[deviceId])).rows;
    for(const row of rows){if(new Date(row.expires_at)>now()&&now()-new Date(row.last_activity_at)<IDLE_MS)continue;
      const s=decrypt(row);if(s.form)await closeForm(s.form,tx);
      await tx.query('DELETE FROM clinic_tablet_visit_grants WHERE token_hash=$1',[row.token_hash]);await audit(tx,deviceId,row.state,'expired');
    }
  },{allowRevoked:true});}
  async function pruneBatch(){
    const client=await db.connect();let ids;try{ids=(await client.query('SELECT DISTINCT device_id FROM clinic_tablet_visit_grants WHERE expires_at<=$1 OR last_activity_at<=$2 ORDER BY device_id LIMIT 50',[now(),new Date(now().getTime()-IDLE_MS)])).rows;}finally{client.release();}
    for(const row of ids)await prune(row.device_id);return ids.length;
  }
  return {create,withGrant,prune,pruneBatch};
}
module.exports={createClinicTabletGrantStore};
