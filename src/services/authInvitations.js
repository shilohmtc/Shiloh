'use strict';
// Explicit database only; no production route imports this staging service.
function createAuthInvitations({db,audience}={}) {
  if(!db?.query || !['staff','client'].includes(audience)) throw Error('Explicit invitation context required');
  async function visit(session) {
    const id=Number(session?.sessionId),owner=Number(audience==='staff'?session?.adminId:session?.crmV2ClientId);
    if(!session?.ok || !Number.isSafeInteger(id) || id<=0 || !Number.isSafeInteger(owner) || owner<=0) return {ok:false};
    // The session comes from canonical authenticated middleware. The caller
    // cannot choose an owner/session through JSON or a URL.
    const credentialTable=audience==='staff'?'staff_auth_passkey_credentials':'client_auth_passkey_credentials';
    const ownerColumn=audience==='staff'?'admin_id':'crm_v2_client_id';
    const credentials=await db.query(`SELECT id FROM ${credentialTable} WHERE ${ownerColumn}=$1 AND revoked_at IS NULL LIMIT 1`,[owner]);
    const inserted=await db.query(`INSERT INTO code_auth_invitation_visits(audience,session_id,expires_at)
      VALUES($1,$2,NOW()+INTERVAL '31 days') ON CONFLICT DO NOTHING RETURNING session_id`,[audience,id]);
    await db.query(`DELETE FROM code_auth_invitation_visits WHERE (audience,session_id) IN
      (SELECT audience,session_id FROM code_auth_invitation_visits WHERE expires_at<NOW() LIMIT 100)`);
    return {ok:true,show:inserted.rows.length===1,passkey:credentials.rows.length===0,...(audience==='staff'?{accountId:owner}:{})};
  }
  async function notificationStatus(session,endpoint) {
    if(!session?.ok || typeof endpoint!=='string' || endpoint.length>2048 || !endpoint.startsWith('https://'))return {ok:false};
    const table=audience==='staff'?'workspace_push_subscriptions':'my_shiloh_push_subscriptions';
    const column=audience==='staff'?'admin_id':'crm_v2_client_id',id=audience==='staff'?session.adminId:session.crmV2ClientId;
    const result=await db.query(`SELECT id FROM ${table} WHERE ${column}=$1 AND endpoint=$2 AND enabled=TRUE ${audience==='client'?'AND revoked_at IS NULL':''} LIMIT 1`,[id,endpoint]);
    return {ok:true,enabled:result.rows.length===1};
  }
  return {visit,notificationStatus};
}
module.exports={createAuthInvitations};
