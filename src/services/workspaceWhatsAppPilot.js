'use strict';
const {createWorkspaceWhatsAppChannel}=require('./workspaceWhatsAppChannel');

const positive = value => Number.isSafeInteger(value) && value > 0;
const accountId = value => (typeof value === 'number' || typeof value === 'string' && /^[1-9][0-9]*$/.test(value)) && positive(Number(value)) ? Number(value) : null;

// Operator-supplied canonical IDs only. Names and request bodies cannot select
// participants. No default window, budget, identifiers or recovery permission.
function createWorkspaceWhatsAppPilotPolicy(input = {}, whatsappCostMinor) {
  input=input && typeof input==='object' && !Array.isArray(input)?input:{};
  const subjectId=accountId(input.subjectId),operatorId=accountId(input.operatorId);
  const start=typeof input.startsAt==='string'?Date.parse(input.startsAt):NaN;
  const end=typeof input.endsAt==='string'?Date.parse(input.endsAt):NaN;
  const scopeId=input.scopeId,maxMessages=input.maxMessages,maxSpendMinor=input.maxSpendMinor;
  const recoveryEnabled=input.recoveryEnabled===true;
  const valid=!!subjectId && !!operatorId && subjectId!==operatorId &&
    typeof scopeId==='string' && /^[A-Za-z0-9_-]{16,80}$/.test(scopeId) &&
    Number.isFinite(start) && Number.isFinite(end) && end>start &&
    /(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(input.startsAt) && /(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(input.endsAt) &&
    positive(maxMessages) && maxMessages<=3 && positive(maxSpendMinor) && positive(whatsappCostMinor) &&
    maxSpendMinor>=whatsappCostMinor;
  const withinWindow=current=>valid && Number.isFinite(new Date(current).getTime()) && +new Date(current)>=start && +new Date(current)<end;
  return Object.freeze({valid,withinWindow,recoveryEnabled,scopeId,
    dispatchScope:Object.freeze({id:scopeId,allowLegacy:true}),
    acceptsRecord:row=>valid && !!row && (row.accessScope==null || row.accessScope===scopeId),
    allowsSubject:(id,purpose,current)=>withinWindow(current) && accountId(id)===subjectId &&
      (purpose==='signin' || purpose==='enroll' || purpose==='recover' && recoveryEnabled),
    allowsOperator:(id,current)=>withinWindow(current) && accountId(id)===operatorId,
    reservationBuckets:({digest,current,channel})=>[
      {key:digest('pilot-messages',scopeId),limit:maxMessages,amount:channel==='whatsapp'?1:maxMessages+1,windowMs:end-(+current)},
      {key:digest('pilot-spend',scopeId),limit:maxSpendMinor,amount:whatsappCostMinor,windowMs:end-(+current)},
    ],
  });
}

// Default-off application adapter. The production release composition injects
// all authorities and explicitly owns mount/start/stop.
// Constructing it performs no DB/provider I/O and installs no process listeners.
function createWorkspaceWhatsAppPilot({pilot={},config={},...options}={}) {
  const policy=createWorkspaceWhatsAppPilotPolicy(pilot,config?.budgets?.whatsappCostMinor);
  return createWorkspaceWhatsAppChannel({...options,config,policy});
}

module.exports={createWorkspaceWhatsAppPilot,createWorkspaceWhatsAppPilotPolicy};
