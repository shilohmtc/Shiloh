'use strict';
const crypto=require('node:crypto');
const {PostgresCrmV2ClientRepository}=require('../repositories/crmV2ClientRepository');
const {createCrmV2ClientService}=require('./crmV2ClientService');
const revision=row=>crypto.createHash('sha256').update(JSON.stringify([String(row.id),row.normalized_mobile,
  new Date(row.mobile_verified_at).toISOString(),row.name,row.date_of_birth,row.gender,row.profile_status])).digest('hex');
function createClientCodeStore({db,sessions}={}){
  if(!db?.connect||!sessions?.issueVerifiedPhoneCodeSession)throw Error('Explicit client database and sessions required');
  async function transaction(fn){
    const c=await db.connect();
    try{
      await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtextextended('my-shiloh-code-auth',0))");
      const tx={
        async insert(row){await c.query('INSERT INTO client_code_records(record_hash,expires_at,payload) VALUES($1,$2,$3::jsonb)',[row.hash,row.expiresAt,JSON.stringify(row)]);},
        async get(hash){return (await c.query('SELECT payload FROM client_code_records WHERE record_hash=$1 FOR UPDATE',[hash])).rows[0]?.payload||null;},
        async save(row){await c.query('UPDATE client_code_records SET expires_at=$2,payload=$3::jsonb WHERE record_hash=$1',[row.hash,row.expiresAt,JSON.stringify(row)]);},
        async claim(current){
          await c.query('DELETE FROM client_code_records WHERE record_hash IN (SELECT record_hash FROM client_code_records WHERE expires_at<=$1 ORDER BY expires_at LIMIT 100)',[current]);
          const r=(await c.query(`SELECT payload FROM client_code_records WHERE payload->>'state'='queued' AND expires_at>$1
            AND (payload->>'notBefore' IS NULL OR (payload->>'notBefore')::timestamptz<=$1)
            ORDER BY queued_at,record_hash LIMIT 1 FOR UPDATE`,[current])).rows[0]?.payload;
          if(!r)return null;await tx.save({...r,state:'claimed'});return r;
        },
        async uncertain(personKey,current){return (await c.query(`SELECT 1 FROM client_code_records WHERE payload->>'personKey'=$1
          AND payload->>'state' IN ('claimed','uncertain') AND payload->>'deliveryStarted'='true'
          AND (payload->>'codeExpiresAt')::timestamptz>$2 LIMIT 1`,[personKey,current])).rows.length>0;},
        async revokeOthers(personKey,hash){await c.query(`UPDATE client_code_records SET payload=jsonb_set(payload,'{state}','"revoked"')
          WHERE payload->>'personKey'=$1 AND record_hash<>$2 AND payload->>'state'='ready'`,[personKey,hash]);},
        async rateUntil(key,current){const r=(await c.query('SELECT expires_at FROM client_code_rates WHERE bucket_key=$1 AND expires_at>$2 FOR UPDATE',[key,current])).rows[0];return r?new Date(r.expires_at):null;},
        async takeRate(buckets,current){
          const rows=(await c.query('SELECT * FROM client_code_rates WHERE bucket_key=ANY($1::text[]) FOR UPDATE',[buckets.map(b=>b.key)])).rows;
          const states=new Map(rows.map(r=>[r.bucket_key,r]));
          if(buckets.some(b=>{const s=states.get(b.key);return s&&new Date(s.expires_at)>current&&s.attempts+1>b.limit;}))return false;
          for(const b of buckets){const s=states.get(b.key),fresh=s&&new Date(s.expires_at)>current;
            await c.query(`INSERT INTO client_code_rates(bucket_key,attempts,expires_at) VALUES($1,$2,$3)
              ON CONFLICT(bucket_key) DO UPDATE SET attempts=$2,expires_at=$3`,[b.key,fresh?s.attempts+1:1,fresh?s.expires_at:new Date(current.getTime()+b.windowMs)]);}
          await c.query('DELETE FROM client_code_rates WHERE bucket_key IN (SELECT bucket_key FROM client_code_rates WHERE expires_at<$1 LIMIT 100)',[current]);return true;
        },
        async identity(mobile){
          await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`crm-v2-mobile:${mobile}`]);
          const rows=(await c.query('SELECT * FROM crm_v2_clients WHERE normalized_mobile=$1 ORDER BY id FOR UPDATE',[mobile])).rows;
          // Historical/shared contacts must be reconciled by Reception. This
          // flow never upgrades an imported record or claims a legacy profile.
          const historical=(await c.query("SELECT id FROM client_contacts WHERE normalized_value=$1 AND contact_type IN ('whatsapp','mobile') LIMIT 1",[mobile])).rows;
          const owner=rows.length===1?rows[0]:null;
          const verified=!historical.length&&owner?.status==='active'&&owner.profile_status==='registered'&&!!owner.mobile_verified_at;
          return {empty:rows.length===0&&historical.length===0,verified,owner,revision:verified?revision(owner):null};
        },
        async register({profile,mobile,current}){
          const repository=new PostgresCrmV2ClientRepository(c);
          const crm=createCrmV2ClientService({repository,clock:()=>current});
          const result=await crm.registerWhatsAppClient({senderMobile:mobile,name:profile.name,dateOfBirth:profile.dateOfBirth,gender:profile.gender,occurredAt:current});
          if(result.status!=='created')return null;
          // Canonical registration owns creation; retain explicitly supplied
          // first/surname fields without guessing splits of historical names.
          return (await c.query('UPDATE crm_v2_clients SET first_name=$2,surname=$3 WHERE id=$1 RETURNING *',[result.client.id,profile.firstName,profile.surname])).rows[0];
        },
        async issueSession({owner,mobile,channel}){
          const result=await sessions.issueVerifiedPhoneCodeSession({transaction:c,crmV2ClientId:owner.id,normalizedMobile:mobile,channel});
          if(result.ok)await c.query('UPDATE client_browser_sessions SET code_identity_revision=$2 WHERE id=$1',[result.sessionId,revision(owner)]);
          return result;
        },
      };
      const result=await fn(tx);await c.query('COMMIT');return result;
    }catch(error){try{await c.query('ROLLBACK');}catch(_){}throw error;}finally{c.release();}
  }
  return {transaction};
}
module.exports={createClientCodeStore,clientCodeRevision:revision};
