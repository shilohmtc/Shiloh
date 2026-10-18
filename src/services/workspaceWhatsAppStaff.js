'use strict';
const {createWorkspaceWhatsAppChannel}=require('./workspaceWhatsAppChannel');

// Ongoing access changes only channel eligibility. Canonical active status,
// linked Staff, unique recorded mobile and persisted permissions are checked
// again by the authentication service before dispatch and completion.
function createWorkspaceWhatsAppStaffPolicy(input={}) {
  input=input && typeof input==='object' && !Array.isArray(input)?input:{};
  const {scopeId,startsAt,audience}=input;
  const start=typeof startsAt==='string'?Date.parse(startsAt):NaN;
  const valid=Object.keys(input).every(k=>['scopeId','startsAt','audience'].includes(k)) &&
    audience==='active_workspace_accounts' && typeof scopeId==='string' && /^[A-Za-z0-9_-]{16,80}$/.test(scopeId) &&
    Number.isFinite(start) && /(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(startsAt);
  const withinWindow=current=>valid && Number.isFinite(+new Date(current)) && +new Date(current)>=start;
  return Object.freeze({valid,scopeId,withinWindow,recoveryEnabled:false,
    dispatchScope:Object.freeze({id:scopeId,allowLegacy:false}),
    acceptsRecord:row=>valid && row?.accessScope===scopeId,
    allowsSubject:(id,purpose,current)=>withinWindow(current) && (typeof id==='number' || typeof id==='string' && /^[1-9][0-9]*$/.test(id)) && Number.isSafeInteger(Number(id)) && Number(id)>0 &&
      ['signin','enroll'].includes(purpose),
    allowsOperator:()=>false,
    reservationBuckets:({channel,digest})=>channel==='whatsapp'?[]:
      [{key:digest('staff-sms-disabled',scopeId),limit:1,amount:2,windowMs:60000}],
  });
}
function createWorkspaceWhatsAppStaff({staff={},...options}={}) {
  return createWorkspaceWhatsAppChannel({...options,policy:createWorkspaceWhatsAppStaffPolicy(staff),codePrefix:'STAFF'});
}
module.exports={createWorkspaceWhatsAppStaff,createWorkspaceWhatsAppStaffPolicy};
