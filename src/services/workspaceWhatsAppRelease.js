'use strict';
const {createWorkspaceWhatsAppPilot}=require('./workspaceWhatsAppPilot');
const {createWorkspaceWhatsAppStaff}=require('./workspaceWhatsAppStaff');
const {deriveCalendarViewer}=require('./staffBrowserSession');
const {staffDetailsRetired}=require('./staffDetailIdentity');

const ENABLED='SHILOH_WORKSPACE_WHATSAPP_PILOT_ENABLED';
const MANIFEST='SHILOH_WORKSPACE_WHATSAPP_PILOT_MANIFEST';
const STAFF_ENABLED='SHILOH_WORKSPACE_WHATSAPP_STAFF_ENABLED';
const STAFF_MANIFEST='SHILOH_WORKSPACE_WHATSAPP_STAFF_MANIFEST';
const TOKEN='SHILOH_WORKSPACE_WHATSAPP_META_ACCESS_TOKEN';
const KEY='SHILOH_WORKSPACE_WHATSAPP_AUTH_KEY';
const WELCOME='/calendar/staff-auth/whatsapp/welcome';
function parseManifest(value,section='pilot') {
  if(typeof value!=='string' || value.length>32768)return null;
  try {
    const manifest=JSON.parse(value);
    if(!manifest || Array.isArray(manifest) || typeof manifest!=='object' ||
      !['pilot','staff'].includes(section) || Object.keys(manifest).some(k=>![section,'template','wabaId','phoneNumberId','apiVersion','budgets'].includes(k)) ||
      !manifest[section] || typeof manifest[section]!=='object' || Array.isArray(manifest[section]))return null;
    return manifest;
  } catch (_) {return null;}
}
function createWorkspaceWhatsAppRelease({env={},db,sessions,fetchImpl,close=async()=>{},now}={}) {
  const staffRequested=env[STAFF_ENABLED]==='true',pilotRequested=env[ENABLED]==='true';
  const mode=staffRequested?'staff':'pilot',manifestKey=staffRequested?STAFF_MANIFEST:MANIFEST;
  const manifest=parseManifest(env[manifestKey],mode);
  const requested=staffRequested||pilotRequested,conflict=staffRequested&&pilotRequested;
  let staffReadiness=null;
  const token=env[TOKEN];
  const key=typeof env[KEY]==='string' && /^[a-f0-9]{64}$/i.test(env[KEY])?Buffer.from(env[KEY],'hex'):null;
  const missing=[...(!manifest?[manifestKey]:[]),...(!(typeof token==='string' && token.length>0)?[TOKEN]:[]),...(!key?[KEY]:[])];
  const channel=(staffRequested?createWorkspaceWhatsAppStaff:createWorkspaceWhatsAppPilot)({enabled:requested && !conflict && missing.length===0,
    ...(staffRequested?{staff:manifest?.staff}:{pilot:{...manifest?.pilot,recoveryEnabled:false}}),config:{...manifest,smsFallbackEnabled:false},
    env,db,sessions,fetchImpl,hmacKey:key,metaCredentials:{accessToken:token},...(now?{now}:{})});
  const status=()=>({...channel.status(),mode,requested,detailsSigninRetired:staffDetailsRetired(env),missing:[...missing],...(conflict?{configurationError:'STAFF_PILOT_MODE_CONFLICT'}:{}),...(staffReadiness?{staffReadiness}: {})});
  async function inspectParticipants() {
    if(env.SHILOH_WORKSPACE_WHATSAPP_PILOT_INSPECT!=='true')return {enabled:false};
    try {
      // Read-only private deployment diagnostic. Never selects full phones,
      // authentication material or session/credential records; never grants IDs.
      const result=await db.query(`SELECT a.id,a.display_name,a.staff_id,a.role,a.business_role,a.active,s.status AS staff_status,
        a.calendar_scope,a.service_scope,a.permissions->>'staff_auth:reset' AS can_recover,
        RIGHT(a.normalized_whatsapp,4) AS phone_ending,
        (SELECT count(*)::integer FROM staff_admin_accounts other WHERE other.normalized_whatsapp=a.normalized_whatsapp) AS phone_owners
        FROM staff_admin_accounts a LEFT JOIN staff s ON s.id=a.staff_id
        WHERE LOWER(a.display_name) LIKE 'christel%' OR LOWER(a.display_name)='jp'
          OR LOWER(a.display_name) LIKE 'jean-pierre%' OR LOWER(a.display_name) LIKE 'jean pierre%'
        ORDER BY a.id LIMIT 5`);
      return {enabled:true,participants:result.rows};
    } catch (_) {return {enabled:true,code:'PILOT_INSPECTION_UNAVAILABLE'};}
  }
  async function start() {
    try {
      if(conflict)return {ok:false,code:'WORKSPACE_WHATSAPP_MODE_CONFLICT',...status()};
      if(staffRequested && requested && missing.length===0 && channel.status().state!=='disabled') {
        const rows=(await db.query(`SELECT a.id,a.display_name,a.staff_id,a.role,a.business_role,a.calendar_scope,a.service_scope,a.permissions,
          a.active AS admin_active,s.status AS staff_status,
          (a.normalized_whatsapp ~ '^27[6-8][0-9]{8}$') AS phone_valid,
          (SELECT count(*)::integer FROM staff_admin_accounts other WHERE other.normalized_whatsapp=a.normalized_whatsapp) AS phone_owners
          FROM staff_admin_accounts a LEFT JOIN staff s ON s.id=a.staff_id WHERE a.active=true ORDER BY a.id`)).rows;
        const blocked=[];let eligibleAccounts=0;
        for(const row of rows) {
          const reason=row.staff_id!=null && row.staff_status!=='active'?'inactive_staff':!row.phone_valid?'recorded_mobile_missing_or_invalid':row.phone_owners!==1?'recorded_mobile_ambiguous':!deriveCalendarViewer(row)?'workspace_authority_unavailable':null;
          if(reason)blocked.push({id:Number(row.id),displayName:row.display_name,reason});else eligibleAccounts++;
        }
        staffReadiness={eligibleAccounts,blockedAccounts:blocked};
        if(!eligibleAccounts)return {ok:false,code:'STAFF_NO_ELIGIBLE_ACCOUNTS',...status()};
      }
      if(!staffRequested && requested && missing.length===0) {
        const ids=[Number(manifest.pilot.subjectId),Number(manifest.pilot.operatorId)];
        if(ids.every(id=>Number.isSafeInteger(id)&&id>0) && ids[0]!==ids[1]) {
          const result=await db.query(`SELECT a.id,a.staff_id,a.role,a.business_role,a.calendar_scope,a.service_scope,a.permissions,
            a.active AS admin_active,s.status AS staff_status,
            (a.normalized_whatsapp ~ '^27[6-8][0-9]{8}$') AS phone_valid,
            (SELECT count(*)::integer FROM staff_admin_accounts other WHERE other.normalized_whatsapp=a.normalized_whatsapp) AS phone_owners
            FROM staff_admin_accounts a LEFT JOIN staff s ON s.id=a.staff_id WHERE a.id=ANY($1::bigint[])`,[ids]);
          const subject=result.rows.find(row=>Number(row.id)===ids[0]),operator=result.rows.find(row=>Number(row.id)===ids[1]);
          const active=row=>row?.admin_active===true && (row.staff_id==null || row.staff_status==='active');
          if(!active(subject)||!active(operator)||!subject.phone_valid||subject.phone_owners!==1||!deriveCalendarViewer(subject))
            return {ok:false,code:'PILOT_PARTICIPANTS_UNREADY',...status()};
        }
      }
      return {...await channel.start(),...status()};
    }
    catch (_) {await channel.stop();return {ok:false,code:staffRequested?'STAFF_UNAVAILABLE':'PILOT_UNAVAILABLE',...status()};}
  }
  let stopPromise;
  function stop() {
    if(!stopPromise)stopPromise=(async()=>{try {return await channel.stop();} finally {await close();}})();
    return stopPromise;
  }
  async function passkeySuccessDestination(token) {
    let timer;
    try {
      const target=await Promise.race([channel.passkeySuccessDestination(token),
        new Promise(resolve=>{timer=setTimeout(()=>resolve(null),1500);})]);
      return target===WELCOME?WELCOME:'/calendar/workspace';
    } catch (_) {return '/calendar/workspace';}
    finally {clearTimeout(timer);}
  }
  return {mount:channel.mount,start,stop,status,inspectParticipants,passkeySuccessDestination};
}
module.exports={createWorkspaceWhatsAppRelease,parseManifest,ENABLED,MANIFEST,STAFF_ENABLED,STAFF_MANIFEST,TOKEN,KEY};
