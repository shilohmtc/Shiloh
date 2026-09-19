const { pool } = require("../db/pool");
const { extractDate, extractTime, displayDate } = require("./bookingIntent");
const { checkClinicHours } = require("./clinicHours");
const { checkAuthoritativeSchedule } = require("./adminAvailability");
const logger = require("../lib/logger");
const { fullLabelDescription } = require('../presentation/whatsappListRowPresentation');
const { CRM_V2_LEGACY_ONLY_BOUNDARY_REPLY, resolveFinalBookingIdentity, identityFromAppointment } = require('./whatsappBookingIdentity');
const { cancelOwnedAppointmentInTransaction } = require('./clientAppointmentCancellation');

let initialized = false;
const APPOINTMENT_CHOICE_PAGE_SIZE = 8;

async function ensureTable() {
  if (initialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointment_change_intents (
      phone VARCHAR(32) PRIMARY KEY,
      action TEXT NOT NULL,
      appointment_id BIGINT,
      existing_appointment_date TEXT,
      preferred_date TEXT,
      preferred_time TEXT,
      status TEXT NOT NULL DEFAULT 'collecting',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE appointment_change_intents ADD COLUMN IF NOT EXISTS appointment_id BIGINT`);
  await pool.query(`ALTER TABLE appointment_change_intents ADD COLUMN IF NOT EXISTS existing_appointment_date TEXT`);
  initialized = true;
}

function normalizePhone(value = "") { return String(value || "").replace(/[^0-9]/g, ""); }
function practitionerApprovalEnabled(){return process.env.WHATSAPP_RESCHEDULE_APPROVAL_ENABLED==='true';}
function detectAction(text = "") { const v=String(text).toLowerCase(); if(/\b(cancel|cancellation)\b.*\b(appointment|booking)\b|\b(cancel my appointment|cancel my booking)\b/.test(v))return"cancel"; if(/\b(reschedule|move)\b.*\b(appointment|booking)\b|\b(change|move) my (appointment|booking)\b/.test(v))return"reschedule"; return null; }
function isAbort(text = "") { return /^(stop|never mind|nevermind|forget it|exit|0)$/i.test(String(text).trim()); }
function isConfirmation(text = "") { return /^(yes|y|confirm|confirmed|correct|proceed|continue|ok|okay)$/i.test(String(text).trim()); }
function fmtDateTime(v){return new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',weekday:'short',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v));}
function fmtTimeOnly(v){return new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v));}
function fmtDateOnly(v){return new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',weekday:'short',day:'2-digit',month:'short',year:'numeric'}).format(new Date(v));}
function localDateOf(v){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Johannesburg',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(v));const m=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${m.year}-${m.month}-${m.day}`;}
function latePolicy(startsAt){const hours=(new Date(startsAt).getTime()-Date.now())/3600000;return hours<24?"This change is within 24 hours of the appointment. Shiloh's late-cancellation policy may apply a 50% fee.":"Shiloh's 24-hour cancellation policy applies.";}
function parseClock(value=''){const v=String(value).trim().toLowerCase();if(/^(morning|afternoon|evening)$/.test(v))return null;let m=v.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);if(m){let h=+m[1],min=+m[2];if(min>59)return null;if(m[3]){if(h<1||h>12)return null;if(m[3]==='pm'&&h!==12)h+=12;if(m[3]==='am'&&h===12)h=0;}if(h>23)return null;return{h,min};}m=v.match(/^(\d{1,2})\s*(am|pm)$/);if(m){let h=+m[1];if(h<1||h>12)return null;if(m[2]==='pm'&&h!==12)h+=12;if(m[2]==='am'&&h===12)h=0;return{h,min:0};}if(/^\d{1,2}$/.test(v)){const h=+v;return h<=23?{h,min:0}:null;}return null;}
function localDateTime(date,time){const c=parseClock(time);if(!c||!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))return null;const iso=`${date}T${String(c.h).padStart(2,'0')}:${String(c.min).padStart(2,'0')}:00+02:00`;const d=new Date(iso);return Number.isNaN(d.getTime())?null:d;}

async function getIntent(phone){await ensureTable();const r=await pool.query(`SELECT phone,action,appointment_id,existing_appointment_date,preferred_date,preferred_time,status,created_at,updated_at FROM appointment_change_intents WHERE phone=$1`,[normalizePhone(phone)]);return r.rows[0]||null;}
async function saveIntent(phone,patch={}){await ensureTable();const key=normalizePhone(phone),c=(await getIntent(key))||{};const action=patch.action??c.action;if(!action)throw new Error('Appointment change action is required');const r=await pool.query(`INSERT INTO appointment_change_intents(phone,action,appointment_id,existing_appointment_date,preferred_date,preferred_time,status,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT(phone) DO UPDATE SET action=EXCLUDED.action,appointment_id=EXCLUDED.appointment_id,existing_appointment_date=EXCLUDED.existing_appointment_date,preferred_date=EXCLUDED.preferred_date,preferred_time=EXCLUDED.preferred_time,status=EXCLUDED.status,updated_at=NOW() RETURNING *`,[key,action,patch.appointmentId??c.appointment_id??null,patch.currentDate??c.existing_appointment_date??null,patch.preferredDate??c.preferred_date??null,patch.preferredTime??c.preferred_time??null,patch.status??c.status??'collecting']);return r.rows[0];}
async function clearIntent(phone){await ensureTable();await pool.query(`DELETE FROM appointment_change_intents WHERE phone=$1`,[normalizePhone(phone)]);}

async function upcomingForPhone(phone){const key=normalizePhone(phone);const r=await pool.query(`
 SELECT DISTINCT a.id,a.client_id,a.crm_v2_client_id,a.location_id,a.starts_at,a.ends_at,a.status,a.source,
   CASE WHEN a.crm_v2_client_id IS NOT NULL THEN 'crm_v2' ELSE 'legacy' END identity_model,
   COALESCE(v2.name,c.display_name,a.source_client_name,'Client') client_name,
   COALESCE((SELECT string_agg(service_name_snapshot,' + ' ORDER BY position) FROM appointment_services WHERE appointment_id=a.id),a.title,'Appointment') service_name,
   COALESCE((SELECT string_agg(staff_name_snapshot,' + ' ORDER BY position) FROM appointment_staff WHERE appointment_id=a.id),'Shiloh practitioner') staff_name,
   COALESCE((SELECT staff_id FROM appointment_staff WHERE appointment_id=a.id ORDER BY position LIMIT 1),0) staff_id,
   (SELECT COUNT(*) FROM appointment_staff WHERE appointment_id=a.id) staff_count
 FROM appointments a
 LEFT JOIN clients c ON c.id=a.client_id
 LEFT JOIN crm_v2_clients v2 ON v2.id=a.crm_v2_client_id AND v2.status='active'
 WHERE ((a.client_id IS NOT NULL AND a.crm_v2_client_id IS NULL AND EXISTS (SELECT 1 FROM client_contacts cc WHERE cc.client_id=a.client_id AND cc.normalized_value=$1 AND cc.contact_type IN ('whatsapp','mobile','phone')))
    OR (a.client_id IS NULL AND a.crm_v2_client_id IS NOT NULL AND v2.normalized_mobile=$1))
   AND a.status<>'cancelled' AND a.ends_at>NOW()
 ORDER BY a.starts_at`,[key]);return r.rows;}
async function appointmentForPhone(phone,id){const rows=await upcomingForPhone(phone);return rows.find(x=>Number(x.id)===Number(id))||null;}
function summary(a){return [`*${a.service_name}*`,`📅 ${fmtDateTime(a.starts_at)}`,`👤 ${a.staff_name}`,`Booking #${a.id}`].join('\n');}
function concise(value='',max=40){const text=String(value||'').trim().replace(/\s+/g,' ');return text.length<=max?text:`${text.slice(0,Math.max(1,max-1))}…`;}

function appointmentChoiceInteractive(rows=[],action='reschedule',page=1){
  const verb=action==='cancel'?'cancel':'reschedule';
  const question=`Which booking would you like to ${verb}?`;
  if(rows.length<=3){
    return{
      type:'button',
      body:[question,'',...rows.map(a=>summary(a)), '', 'Your other bookings will remain unchanged.', `You can also type the booking number, for example *${rows[0]?.id||'123'}*.`].join('\n\n'),
      buttons:rows.map(a=>({id:`client_change_${verb}_${a.id}`,title:`${fmtTimeOnly(a.starts_at)} · #${a.id}`.slice(0,20)})),
    };
  }
  const totalPages=Math.max(1,Math.ceil(rows.length/APPOINTMENT_CHOICE_PAGE_SIZE));
  const safePage=Math.min(Math.max(Number(page)||1,1),totalPages);
  const start=(safePage-1)*APPOINTMENT_CHOICE_PAGE_SIZE;
  const pageRows=rows.slice(start,start+APPOINTMENT_CHOICE_PAGE_SIZE).map(a=>({
    id:`client_change_${verb}_${a.id}`,
    title:`${fmtTimeOnly(a.starts_at)} · #${a.id}`.slice(0,24),
    description:fullLabelDescription(a.service_name, `${fmtDateOnly(a.starts_at)} • ${a.staff_name}`),
  }));
  if(safePage<totalPages)pageRows.push({id:`client_change_${verb}_page_${safePage+1}`,title:'More bookings →',description:`Page ${safePage+1} of ${totalPages}`});
  else if(safePage>1)pageRows.push({id:`client_change_${verb}_page_1`,title:'← First page',description:`Page 1 of ${totalPages}`});
  return{
    type:'list',
    body:`${question}\nChoose the correct appointment. Your other bookings will remain unchanged. You can also type its booking number.`,
    buttonText:'Choose booking',
    rows:pageRows,
    sectionTitle:'Upcoming bookings',
  };
}

async function selectAppointment(phone,text,intent){
  const rows=await upcomingForPhone(phone);if(!rows.length)return{error:'none'};
  const raw=String(text||'').trim();
  const selectedButton=raw.match(/^client_change_(reschedule|cancel)_(\d+)$/i);
  if(selectedButton){
    if(selectedButton[1].toLowerCase()!==String(intent?.action||'').toLowerCase())return{error:'choose',matches:rows};
    const a=rows.find(x=>Number(x.id)===Number(selectedButton[2]));
    return a?{appointment:a}:{error:'choose',matches:rows};
  }
  const pageButton=raw.match(/^client_change_(reschedule|cancel)_page_(\d+)$/i);
  if(pageButton){
    if(pageButton[1].toLowerCase()!==String(intent?.action||'').toLowerCase())return{error:'choose',matches:rows};
    return{error:'page',matches:rows,page:Number(pageButton[2])};
  }
  const idMatch=raw.match(/^#?(\d+)$/);if(idMatch){const a=rows.find(x=>Number(x.id)===Number(idMatch[1]));if(a)return{appointment:a};}
  const d=extractDate(text);if(d){const matches=rows.filter(x=>localDateOf(x.starts_at)===d);if(matches.length===1)return{appointment:matches[0]};if(matches.length>1)return{error:'ambiguous_date',matches};}
  if(rows.length===1)return{appointment:rows[0]};return{error:'choose',matches:rows};
}

function rescheduleDateChoice(a){
  const body = [
    a ? summary(a) : null,
    'What new day or date would you prefer?',
    '',
    'Choose a quick option below, or type another date such as Friday or 21 August.'
  ].filter(Boolean).join('\n');

  return {
    handled: true,
    interactive: {
      type: 'button',
      body,
      buttons: [
        { id: 'today', title: 'Today' },
        { id: 'tomorrow', title: 'Tomorrow' },
        { id: 'reschedule_date_other', title: 'Choose another date' }
      ]
    }
  };
}

function cancellationSuccessInteractive(a){
  return {
    type:'button',
    body:[
      '✅ Your appointment has been cancelled.',
      summary(a),
      '',
      latePolicy(a.starts_at),
      '',
      'Would you like to book another appointment?',
      'You can also type *BOOK*. 🌿',
    ].join('\n'),
    buttons:[
      {id:'client_postbook_book_another',title:'Book another'},
    ],
  };
}

async function cancelCanonical(phone,a){const db=await pool.connect();try{
 await db.query('BEGIN');
 const identity=identityFromAppointment(a);
 const authority=await resolveFinalBookingIdentity({db,phone,identity});
 if(authority.status!=='ready'){await db.query('ROLLBACK');return{status:'identity_changed',reply:'The exact canonical client identity changed before cancellation, so the appointment was not changed.'};}
 const result=await cancelOwnedAppointmentInTransaction(db,{
   appointmentId:a.id,
   legacyClientId:identity.legacyClientId||null,
   crmV2ClientId:identity.crmV2ClientId||null,
   changedBy:`client:${normalizePhone(phone)}`,
   reason:'Client cancellation confirmed in WhatsApp',
   auditMetadata:{
     phone:normalizePhone(phone),
     identityResolution:authority.audit?.identityResolution||null,
     source:'whatsapp',
   },
 });
 if(result.status==='cancelled'){await db.query('COMMIT');return{status:'cancelled'};}
 await db.query('ROLLBACK');
 if(result.status==='ownership_changed')return{status:'identity_changed',reply:'The exact canonical client identity changed before cancellation, so the appointment was not changed.'};
 return result;
 }catch(e){try{await db.query('ROLLBACK');}catch(_){}throw e;}finally{db.release();}}

async function rescheduleCanonical(phone,a,date,time){
 if(a?.crm_v2_client_id!=null)return{status:'crm_v2_reschedule_approval_required',reply:CRM_V2_LEGACY_ONLY_BOUNDARY_REPLY};
 const starts=localDateTime(date,time);
 if(!starts)return{status:'invalid_time',reply:'Please send an exact time, for example *14:00* or *2pm*.'};
 if(starts.getTime()<=Date.now())return{status:'past',reply:'Please choose a future date and time.'};
 if(Number(a.staff_count)!==1||!Number(a.staff_id))return{status:'multi_staff',reply:'This booking has a complex practitioner setup, so the clinic team needs to help reschedule it safely.'};
 const duration=new Date(a.ends_at)-new Date(a.starts_at);
 const ends=new Date(starts.getTime()+duration);
 const clinic=await checkClinicHours({locationId:a.location_id,startsAt:starts,endsAt:ends});
 if(!clinic.covered)return{status:'clinic_hours',reply:'That time falls outside Shiloh’s clinic hours. Please choose another time.'};
 const schedule=await checkAuthoritativeSchedule({staffId:Number(a.staff_id),locationId:a.location_id,startsAt:starts,endsAt:ends});
 if(schedule.partialUnavailable||(schedule.allDayUnavailable&&!schedule.insideAvailableException)||!schedule.covered)return{status:'staff_schedule',reply:`${a.staff_name} is not available at that time. Please choose another time.`};
 const conflict=await pool.query(`SELECT 1 FROM appointments ap JOIN appointment_staff ast ON ast.appointment_id=ap.id WHERE ast.staff_id=$1 AND ap.id<>$2 AND ap.status<>'cancelled' AND ap.starts_at<$4 AND ap.ends_at>$3 LIMIT 1`,[a.staff_id,a.id,starts,ends]);
 if(conflict.rowCount)return{status:'conflict',reply:'That time has just become unavailable. Please choose another time.'};
 const db=await pool.connect();
 try{
   await db.query('BEGIN');
   const locked=await db.query(`SELECT status,starts_at,ends_at FROM appointments WHERE id=$1 FOR UPDATE`,[a.id]);
   if(!locked.rows[0]||locked.rows[0].status==='cancelled'){
     await db.query('ROLLBACK');
     return{status:'changed',reply:'That appointment changed while I was checking it. Please start the reschedule again.'};
   }
   if(new Date(locked.rows[0].starts_at).getTime()!==new Date(a.starts_at).getTime()||new Date(locked.rows[0].ends_at).getTime()!==new Date(a.ends_at).getTime()){
     await db.query('ROLLBACK');
     return{status:'changed',reply:'That appointment changed while I was checking it. Please start the reschedule again.'};
   }

   await db.query('SELECT pg_advisory_xact_lock($1::bigint)',[Number(a.staff_id)]);

   const finalClinic=await checkClinicHours({db,locationId:a.location_id,startsAt:starts,endsAt:ends});
   if(!finalClinic.covered){await db.query('ROLLBACK');return{status:'clinic_hours',reply:'That time is no longer inside Shiloh’s clinic hours. Please choose another time.'};}
   const finalSchedule=await checkAuthoritativeSchedule({db,staffId:Number(a.staff_id),locationId:a.location_id,startsAt:starts,endsAt:ends});
   if(finalSchedule.partialUnavailable||(finalSchedule.allDayUnavailable&&!finalSchedule.insideAvailableException)||!finalSchedule.covered){await db.query('ROLLBACK');return{status:'staff_schedule',reply:`${a.staff_name} is no longer available at that time. Please choose another time.`};}
   const finalConflict=await db.query(`SELECT 1 FROM appointments ap JOIN appointment_staff ast ON ast.appointment_id=ap.id WHERE ast.staff_id=$1 AND ap.id<>$2 AND ap.status<>'cancelled' AND ap.starts_at<$4 AND ap.ends_at>$3 LIMIT 1`,[a.staff_id,a.id,starts,ends]);
   if(finalConflict.rowCount){await db.query('ROLLBACK');return{status:'conflict',reply:'That time has just become unavailable. Please choose another time.'};}
   await db.query(`UPDATE appointments SET starts_at=$1,ends_at=$2,updated_at=NOW() WHERE id=$3`,[starts,ends,a.id]);
   await db.query(`UPDATE appointment_lifecycle SET appointment_at=$1,appointment_ends_at=$2,reminder_sent_at=NULL,updated_at=NOW() WHERE appointment_id=$3`,[starts,ends,a.id]);
   await db.query(`INSERT INTO appointment_status_history(appointment_id,from_status,to_status,changed_by,reason) VALUES($1,$2,$2,$3,'Client reschedule confirmed in WhatsApp')`,[a.id,locked.rows[0].status,`client:${normalizePhone(phone)}`]);
   await db.query(`INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata) VALUES('client.appointment_rescheduled','appointment',$1,$2::jsonb)`,[a.id,JSON.stringify({phone:normalizePhone(phone),fromStart:locked.rows[0].starts_at,toStart:starts.toISOString()})]);
   await db.query('COMMIT');
   return{status:'rescheduled',starts,ends};
 }catch(error){
   try{await db.query('ROLLBACK');}catch(_){}
   throw error;
 }finally{db.release();}
}

async function processAppointmentChangeMessage(phone,text){try{const action=detectAction(text);let intent=await getIntent(phone);if(intent&&isAbort(text)){await clearIntent(phone);return{handled:true,reply:'No problem — I stopped that request. Your appointment is unchanged.'};}if(action&&intent&&intent.action!==action){await clearIntent(phone);intent=null;}if(!intent&&!action)return{handled:false};if(!intent){intent=await saveIntent(phone,{action,status:'selecting_appointment'});}if(intent.status==='selecting_appointment'){const selected=await selectAppointment(phone,text,intent);if(selected.error==='none'){await clearIntent(phone);return{handled:true,reply:'I can’t find an upcoming Shiloh appointment linked to this WhatsApp number.'};}if(selected.error==='choose'||selected.error==='ambiguous_date'||selected.error==='page'){return{handled:true,interactive:appointmentChoiceInteractive(selected.matches,intent.action,selected.page||1)};}const a=selected.appointment;if(intent.action==='reschedule'&&a.identity_model==='crm_v2'&&!practitionerApprovalEnabled()){await clearIntent(phone);return{handled:true,status:'crm_v2_reschedule_legacy_boundary',reply:CRM_V2_LEGACY_ONLY_BOUNDARY_REPLY};}intent=await saveIntent(phone,{appointmentId:a.id,currentDate:localDateOf(a.starts_at),status:intent.action==='cancel'?'awaiting_confirmation':'collecting'});if(intent.action==='cancel')return{handled:true,reply:[`Please confirm the cancellation:`,summary(a),'',latePolicy(a.starts_at),'','Reply *YES* to cancel this booking, or *STOP* to leave it unchanged.'].join('\n')};const date=extractDate(text);const time=extractTime(text);if(date||time){intent=await saveIntent(phone,{preferredDate:date||null,preferredTime:time||null,status:'collecting'});}if(!intent.preferred_date)return rescheduleDateChoice(a);if(!intent.preferred_time)return{handled:true,reply:'What exact new time would you prefer? For example *14:00* or *2pm*.'};intent=await saveIntent(phone,{status:'awaiting_confirmation'});return{handled:true,reply:[`Please confirm this reschedule:`,summary(a),'',`➡️ New date: ${displayDate(intent.preferred_date)}`,`➡️ New time: ${intent.preferred_time}`,'',latePolicy(a.starts_at),'','Reply *YES* to reschedule, or *STOP* to leave it unchanged.'].join('\n')};}
 const a=await appointmentForPhone(phone,intent.appointment_id);if(!a){await clearIntent(phone);return{handled:true,reply:'That booking is no longer available to change. Please start again.'};}if(intent.action==='reschedule'&&a.identity_model==='crm_v2'&&!practitionerApprovalEnabled()){await clearIntent(phone);return{handled:true,status:'crm_v2_reschedule_legacy_boundary',reply:CRM_V2_LEGACY_ONLY_BOUNDARY_REPLY};}
 if(intent.status==='collecting'){let patch={};if(String(text || '').trim().toLowerCase()==='reschedule_date_other'){
  return{
    handled:true,
    reply:'Please type another date, for example Friday, next Monday, or 21 August.'
  };
}if(!intent.preferred_date){const d=extractDate(text);if(d)patch.preferredDate=d;}if(!intent.preferred_time){const t=extractTime(text);if(t)patch.preferredTime=t;}intent=await saveIntent(phone,patch);if(!intent.preferred_date)return rescheduleDateChoice(a);if(!intent.preferred_time)return{handled:true,reply:'What exact new time would you prefer? For example *14:00* or *2pm*.'};if(!parseClock(intent.preferred_time))return{handled:true,reply:'Please send an exact time, for example *14:00* or *2pm*.'};intent=await saveIntent(phone,{status:'awaiting_confirmation'});return{handled:true,reply:[`Please confirm this reschedule:`,summary(a),'',`➡️ New date: ${displayDate(intent.preferred_date)}`,`➡️ New time: ${intent.preferred_time}`,'',latePolicy(a.starts_at),'','Reply *YES* to reschedule, or *STOP* to leave the appointment unchanged.'].join('\n')};}
 if(intent.status==='awaiting_confirmation'){if(!isConfirmation(text))return{handled:true,reply:'Please reply *YES* to confirm this change, or *STOP* to leave the appointment unchanged.'};if(intent.action==='cancel'){const result=await cancelCanonical(phone,a);await clearIntent(phone);if(result.status==='cancelled')return{handled:true,interactive:cancellationSuccessInteractive(a)};return{handled:true,reply:result.reply||'That appointment was already cancelled or changed. No duplicate cancellation was made.'};}const result=await rescheduleCanonical(phone,a,intent.preferred_date,intent.preferred_time);if(result.status==='rescheduled'){await clearIntent(phone);return{handled:true,reply:[`✅ Your appointment has been rescheduled.`,`✨ ${a.service_name}`,`👤 ${a.staff_name}`,`📅 ${fmtDateTime(result.starts)}`,'','Your Shiloh appointment is updated. 🌿'].join('\n')};}return{handled:true,reply:result.reply||'I couldn’t safely reschedule that booking. Please choose another time.'};}
 return{handled:false};}catch(error){logger.error({err:error},'Canonical client appointment change failed');return{handled:true,reply:'I couldn’t safely complete that appointment change right now. Your current booking has not been intentionally changed. Please try again or contact the clinic team.'};}}

module.exports={processAppointmentChangeMessage,getIntent,clearIntent,ensureTable,detectAction,appointmentChoiceInteractive,cancellationSuccessInteractive};
