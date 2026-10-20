'use strict';
const {createBoundedJsonRequest}=require('./workspaceWhatsAppProviders');
const FLAG='MY_SHILOH_CLIENT_AUTH_PREFLIGHT';
const NAME='shiloh_client_verification';
async function inspectClientAuthReadiness({env={},db,fetchImpl}={}) {
  if(env[FLAG]!=='true')return {enabled:false};
  let source;
  try {source=JSON.parse(env.SHILOH_WORKSPACE_WHATSAPP_STAFF_MANIFEST||'');}catch(_){return {enabled:true,code:'CLIENT_PREFLIGHT_UNCONFIGURED'};}
  if(!source||Array.isArray(source)||typeof source!=='object')return {enabled:true,code:'CLIENT_PREFLIGHT_UNCONFIGURED'};
  const token=env.SHILOH_WORKSPACE_WHATSAPP_META_ACCESS_TOKEN;
  if(!/^\d{5,30}$/.test(source.wabaId||'')||!/^v\d{1,3}\.\d{1,2}$/.test(source.apiVersion||'')||typeof token!=='string'||!token.length)
    return {enabled:true,code:'CLIENT_PREFLIGHT_UNCONFIGURED'};
  try {
    // Existing sender credential is used only for this explicit GET. It is
    // neither copied into client send configuration nor returned/logged.
    const request=createBoundedJsonRequest({fetchImpl,timeoutMs:8000,maxBytes:32768});
    const result=await request(`https://graph.facebook.com/${source.apiVersion}/${source.wabaId}/message_templates?name=${NAME}&fields=id,name,language,status,category,components,message_send_ttl_seconds&limit=100`,
      {method:'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}});
    const data=result.body?.data;
    if(!result.ok||!Array.isArray(data)||result.body.error||result.body.paging?.next)return {enabled:true,code:'CLIENT_TEMPLATE_READBACK_UNAVAILABLE'};
    const templates=data.filter(t=>t.name===NAME).map(t=>({id:t.id,name:t.name,language:t.language,status:t.status,category:t.category,
      components:t.components,message_send_ttl_seconds:t.message_send_ttl_seconds,wabaId:source.wabaId}));
    // Aggregate only: no client names, phones, dates, account IDs, sessions,
    // public keys or permissions are emitted. No UPDATE or verification claim.
    const coverage=(await db.query(`WITH accounts AS (
      SELECT c.status,
        c.profile_status='registered' AND c.mobile_verified_at IS NOT NULL
        AND c.normalized_mobile ~ '^27[6-8][0-9]{8}$'
        AND (SELECT count(*) FROM crm_v2_clients o WHERE o.normalized_mobile=c.normalized_mobile)=1
        AND NOT EXISTS(SELECT 1 FROM client_contacts h WHERE h.normalized_value=c.normalized_mobile AND h.contact_type IN ('whatsapp','mobile')) AS code_eligible,
        EXISTS(SELECT 1 FROM client_auth_passkey_credentials k WHERE k.crm_v2_client_id=c.id AND k.revoked_at IS NULL) AS has_passkey
      FROM crm_v2_clients c)
      SELECT count(*) FILTER(WHERE status='active')::integer AS active_clients,
        count(*) FILTER(WHERE status='active' AND code_eligible)::integer AS code_eligible_clients,
        count(*) FILTER(WHERE status='active' AND has_passkey)::integer AS saved_passkey_clients,
        count(*) FILTER(WHERE status='active' AND NOT COALESCE(code_eligible,false) AND NOT has_passkey)::integer AS needs_reception_or_enrollment
      FROM accounts`)).rows[0];
    return {enabled:true,templates,coverage};
  }catch(_){return {enabled:true,code:'CLIENT_PREFLIGHT_UNAVAILABLE'};}
}
module.exports={inspectClientAuthReadiness,FLAG,NAME};
