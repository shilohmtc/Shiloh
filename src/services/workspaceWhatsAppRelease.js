'use strict';
const {createWorkspaceWhatsAppPilot}=require('./workspaceWhatsAppPilot');
const {deriveCalendarViewer}=require('./staffBrowserSession');

const ENABLED='SHILOH_WORKSPACE_WHATSAPP_PILOT_ENABLED';
const MANIFEST='SHILOH_WORKSPACE_WHATSAPP_PILOT_MANIFEST';
const TOKEN='SHILOH_WORKSPACE_WHATSAPP_META_ACCESS_TOKEN';
const KEY='SHILOH_WORKSPACE_WHATSAPP_AUTH_KEY';
const WELCOME='/calendar/staff-auth/whatsapp/welcome';
function parseManifest(value) {
  if(typeof value!=='string' || value.length>32768)return null;
  try {
    const manifest=JSON.parse(value);
    if(!manifest || Array.isArray(manifest) || typeof manifest!=='object' ||
      Object.keys(manifest).some(k=>!['pilot','template','wabaId','phoneNumberId','apiVersion','budgets'].includes(k)) ||
      !manifest.pilot || typeof manifest.pilot!=='object' || Array.isArray(manifest.pilot))return null;
    return manifest;
  } catch (_) {return null;}
}
function createWorkspaceWhatsAppRelease({env={},db,sessions,fetchImpl,close=async()=>{},now}={}) {
  const manifest=parseManifest(env[MANIFEST]);
  const requested=env[ENABLED]==='true';
  const token=env[TOKEN];
  const key=typeof env[KEY]==='string' && /^[a-f0-9]{64}$/i.test(env[KEY])?Buffer.from(env[KEY],'hex'):null;
  const missing=[...(!manifest?[MANIFEST]:[]),...(!(typeof token==='string' && token.length>0)?[TOKEN]:[]),...(!key?[KEY]:[])];
  const pilot=createWorkspaceWhatsAppPilot({enabled:requested && missing.length===0,
    pilot:{...manifest?.pilot,recoveryEnabled:false},config:{...manifest,smsFallbackEnabled:false},
    env,db,sessions,fetchImpl,hmacKey:key,metaCredentials:{accessToken:token},...(now?{now}:{})});
  const status=()=>({...pilot.status(),requested,missing:[...missing]});
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
      if(requested && missing.length===0) {
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
      return {...await pilot.start(),...status()};
    }
    catch (_) {await pilot.stop();return {ok:false,code:'PILOT_UNAVAILABLE',...status()};}
  }
  let stopPromise;
  function stop() {
    if(!stopPromise)stopPromise=(async()=>{try {return await pilot.stop();} finally {await close();}})();
    return stopPromise;
  }
  async function passkeySuccessDestination(token) {
    let timer;
    try {
      const target=await Promise.race([pilot.passkeySuccessDestination(token),
        new Promise(resolve=>{timer=setTimeout(()=>resolve(null),1500);})]);
      return target===WELCOME?WELCOME:'/calendar/workspace';
    } catch (_) {return '/calendar/workspace';}
    finally {clearTimeout(timer);}
  }
  return {mount:pilot.mount,start,stop,status,inspectParticipants,passkeySuccessDestination};
}
module.exports={createWorkspaceWhatsAppRelease,parseManifest,ENABLED,MANIFEST,TOKEN,KEY};
