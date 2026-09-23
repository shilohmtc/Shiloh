const { pool } = require('../db/pool');
const { listAvailableSlots } = require('./availabilityService');
const { getIntent, processAppointmentChangeMessage } = require('./appointmentChange');
const { rescheduleDateChoice } = require('./rescheduleDateChoice');
const { extractDate, displayDate } = require('./bookingIntent');
const { getClinicDateStatus } = require('./clinicDateChoices');
const { sendCustomerAppointmentActionsForAppointment } = require('./customerAppointmentActions');
const { fullLabelDescription } = require('../presentation/whatsappListRowPresentation');

const TZ = 'Africa/Johannesburg';
const SLOT_PAGE_SIZE = 9;
// Internal availability is backed only by Shiloh's canonical scheduling records.
function clean(value = '') { return String(value || '').trim().replace(/\s+/g, ' '); }
function normalizePhone(value = '') { return String(value || '').replace(/[^0-9]/g, ''); }
function localTimeParts(value) { const parts=new Intl.DateTimeFormat('en-GB',{timeZone:TZ,hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(value));const map=Object.fromEntries(parts.map(p=>[p.type,p.value]));return{hh:map.hour,mm:map.minute,text:`${map.hour}:${map.minute}`}; }
function daypartForSlot(slot){const h=Number(localTimeParts(slot.starts_at).hh);return h<12?'morning':h<17?'afternoon':'evening';}
async function appointmentContext(phone, appointmentId){const r=await pool.query(`SELECT a.id,a.location_id,a.starts_at,a.ends_at,a.status,c.display_name client_name,COALESCE((SELECT service_id FROM appointment_services WHERE appointment_id=a.id ORDER BY position LIMIT 1),0) service_id,COALESCE((SELECT service_name_snapshot FROM appointment_services WHERE appointment_id=a.id ORDER BY position LIMIT 1),a.title,'Appointment') service_name,COALESCE((SELECT staff_id FROM appointment_staff WHERE appointment_id=a.id ORDER BY position LIMIT 1),0) staff_id,COALESCE((SELECT staff_name_snapshot FROM appointment_staff WHERE appointment_id=a.id ORDER BY position LIMIT 1),'Shiloh practitioner') staff_name,(SELECT COUNT(*) FROM appointment_staff WHERE appointment_id=a.id) staff_count FROM appointments a JOIN clients c ON c.id=a.client_id JOIN client_contacts cc ON cc.client_id=c.id WHERE a.id=$2 AND cc.normalized_value=$1 AND cc.contact_type IN ('whatsapp','mobile','phone') AND a.status NOT IN ('cancelled','no_show') AND a.ends_at>NOW() LIMIT 1`,[normalizePhone(phone),Number(appointmentId)]);return r.rows[0]||null;}
async function updateIntent(phone,patch={}){const fields=[],params=[normalizePhone(phone)];let n=2;for(const [column,value] of Object.entries(patch)){fields.push(`${column}=$${n++}`);params.push(value);}if(!fields.length)return;fields.push('updated_at=NOW()');await pool.query(`UPDATE appointment_change_intents SET ${fields.join(',')} WHERE phone=$1 AND action='reschedule'`,params);}
function daypartInteractive(a,date){return{type:'button',body:[`*${a.service_name}*`,`New date: ${displayDate(date)}`,`Practitioner: ${a.staff_name}`,'','What time of day would you prefer?'].join('\n'),buttons:[{id:'reschedule_daypart_morning',title:'Morning'},{id:'reschedule_daypart_afternoon',title:'Afternoon'},{id:'reschedule_daypart_evening',title:'Evening'}]};}
function noSlotsInteractive(a,date,daypart){return{type:'button',body:[`I couldn't find an authoritative available ${daypart} time for *${a.service_name}* on ${displayDate(date)}.`,`Your current appointment is unchanged.`,'','What would you like to do next?'].join('\n'),buttons:[{id:'reschedule_change_daypart',title:'Another time'},{id:'reschedule_date_other',title:'Another date'},{id:'stop',title:'Keep appointment'}]};}
async function authoritativeSlots(a,date,daypart){if(Number(a.staff_count)!==1||!Number(a.staff_id)||!Number(a.service_id))return[];const result=await listAvailableSlots({staffId:Number(a.staff_id),serviceId:Number(a.service_id),date,locationId:a.location_id?Number(a.location_id):null,intervalMinutes:15,excludeAppointmentId:Number(a.id)});return(result.slots||[]).filter(slot=>new Date(slot.starts_at).getTime()>Date.now()&&daypartForSlot(slot)===daypart);}
function slotsInteractive(a,date,daypart,slots,page=1){const totalPages=Math.max(1,Math.ceil(slots.length/SLOT_PAGE_SIZE));const safePage=Math.min(Math.max(Number(page)||1,1),totalPages);const start=(safePage-1)*SLOT_PAGE_SIZE;const rows=slots.slice(start,start+SLOT_PAGE_SIZE).map(slot=>{const t=localTimeParts(slot.starts_at);return{id:`reschedule_slot_${t.hh}${t.mm}`,title:`${t.text} · ${a.staff_name}`.slice(0,24),description:fullLabelDescription(a.service_name)};});if(safePage<totalPages)rows.push({id:`reschedule_slots_page_${safePage+1}_${daypart}`,title:'More times →',description:`Go to page ${safePage+1} of ${totalPages}`});else if(safePage>1)rows.push({id:`reschedule_slots_page_1_${daypart}`,title:'← First page',description:`Go to page 1 of ${totalPages}`});return{type:'list',body:[`*Available times for ${a.service_name}*`,`${displayDate(date)} · ${daypart}`,`Practitioner: ${a.staff_name}`,'','Choose an available time below. 🌿'].join('\n'),buttonText:'Available times',rows,sectionTitle:'Available times'};}
function confirmationInteractive(a,date,time){return{type:'button',body:['Please confirm this reschedule:',`✨ ${a.service_name}`,`👤 ${a.staff_name}`,'','Current appointment',`📅 ${new Intl.DateTimeFormat('en-ZA',{timeZone:TZ,weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(new Date(a.starts_at))}`,`🕐 ${localTimeParts(a.starts_at).text}`,'','New appointment',`📅 ${displayDate(date)}`,`🕐 ${time}`,'','Nothing has changed yet.'].join('\n'),buttons:[{id:'yes',title:'Confirm reschedule'},{id:'stop',title:'Keep appointment'}]};}
function keepAppointmentReply(a){const name=clean(a.client_name);return[`${name?`No problem, ${name}`:'No problem'} 🌿`,'Your appointment is unchanged and remains booked for:','',`✨ ${a.service_name}`,`👤 ${a.staff_name}`,`📅 ${new Intl.DateTimeFormat('en-ZA',{timeZone:TZ,weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(new Date(a.starts_at))}`,`🕐 ${localTimeParts(a.starts_at).text}`,'','We look forward to seeing you. 🌿'].join('\n');}
function polishAppointmentChangeResult(result){if(!result?.reply)return result;return{...result,reply:String(result.reply).replace('✅ Your appointment has been rescheduled.','✅ Appointment rescheduled').replace('Your Shiloh appointment is updated. 🌿','We look forward to seeing you. 🌿')};}
function explicitRescheduleDate(value=''){const match=clean(value).toLowerCase().match(/^reschedule_date_(\d{4}-\d{2}-\d{2})$/);return match?.[1]||null;}
function closedDateMessage(date,status){const reason=status?.holidayName?` (${status.holidayName})`:'';return `Shiloh is closed on ${displayDate(date)}${reason}. Your current appointment is unchanged. Please choose another date.`;}
async function clinicAwareStartResult(phone,result){
  const startedIntent=await getIntent(phone);
  if(result?.handled&&startedIntent?.action==='reschedule'&&startedIntent?.status==='collecting'&&startedIntent?.appointment_id){
    const startedAppointment=await appointmentContext(phone,startedIntent.appointment_id);
    if(startedAppointment)return rescheduleDateChoice(startedAppointment);
  }
  return result;
}
async function processClientRescheduleAvailabilityMessage(phone,text){
  const command=clean(text).toLowerCase();
  if(/^(?:reschedule)(?:\s+appointment)?$/.test(command)){
    return clinicAwareStartResult(phone,await processAppointmentChangeMessage(phone,'reschedule appointment'));
  }
  if(/^(?:cancel)(?:\s+appointment)?$/.test(command))return{handled:false};
  let intent=await getIntent(phone);
  if(intent?.action==='reschedule'&&intent?.status==='selecting_appointment'){
    const selected=await processAppointmentChangeMessage(phone,text);
    return clinicAwareStartResult(phone,selected);
  }
  if(!intent||intent.action!=='reschedule'||!intent.appointment_id)return{handled:false};
  if(intent.status==='awaiting_confirmation'){
    const a=await appointmentContext(phone,intent.appointment_id);
    const value=clean(text).toLowerCase();
    const result=await processAppointmentChangeMessage(phone,text);
    if((value==='stop'||value==='no')&&a)return{...result,reply:keepAppointmentReply(a)};
    const polished=polishAppointmentChangeResult(result);
    if(a&&String(polished?.reply||'').includes('✅ Appointment rescheduled'))return{...polished,appointmentId:a.id,postSend:()=>sendCustomerAppointmentActionsForAppointment(a.id,phone)};
    return polished;
  }
  if(intent.status!=='collecting')return{handled:false};
  const a=await appointmentContext(phone,intent.appointment_id);
  if(!a)return{handled:false};
  const value=clean(text);
  const lower=value.toLowerCase();

  if(lower==='stop'||lower==='no'){
    const result=await processAppointmentChangeMessage(phone,'stop');
    return{...result,reply:keepAppointmentReply(a)};
  }
  if(lower==='reschedule_date_other'){
    await updateIntent(phone,{preferred_date:null,preferred_time:null});
    return rescheduleDateChoice(a,'Please type another date, or choose one of the next open clinic days below.');
  }
  if(lower==='reschedule_change_daypart'){
    if(!intent.preferred_date)return rescheduleDateChoice(a);
    return{handled:true,interactive:daypartInteractive(a,intent.preferred_date)};
  }

  const date=explicitRescheduleDate(value)||extractDate(value);
  if(date){
    const clinicDate=await getClinicDateStatus({locationId:a.location_id?Number(a.location_id):null,date});
    if(!clinicDate.covered){
      await updateIntent(phone,{preferred_date:null,preferred_time:null});
      return rescheduleDateChoice(a,closedDateMessage(date,clinicDate));
    }
    await updateIntent(phone,{preferred_date:date,preferred_time:null});
    return{handled:true,interactive:daypartInteractive(a,date)};
  }
  if(!intent.preferred_date)return{handled:false};

  const pageMatch=lower.match(/^reschedule_slots_page_(\d+)_(morning|afternoon|evening)$/);
  if(pageMatch){
    const daypart=pageMatch[2],slots=await authoritativeSlots(a,intent.preferred_date,daypart);
    if(!slots.length)return{handled:true,interactive:noSlotsInteractive(a,intent.preferred_date,daypart)};
    return{handled:true,interactive:slotsInteractive(a,intent.preferred_date,daypart,slots,Number(pageMatch[1]))};
  }
  const daypartMatch=lower.match(/^(?:reschedule_daypart_)?(morning|afternoon|evening)$/);
  if(daypartMatch){
    const daypart=daypartMatch[1],slots=await authoritativeSlots(a,intent.preferred_date,daypart);
    if(!slots.length)return{handled:true,interactive:noSlotsInteractive(a,intent.preferred_date,daypart)};
    return{handled:true,interactive:slotsInteractive(a,intent.preferred_date,daypart,slots,1)};
  }
  const slotMatch=lower.match(/^reschedule_slot_(\d{4})$/);
  if(slotMatch){
    const hhmm=slotMatch[1];let selected=null;
    for(const daypart of ['morning','afternoon','evening']){
      const slots=await authoritativeSlots(a,intent.preferred_date,daypart);
      selected=slots.find(slot=>{const t=localTimeParts(slot.starts_at);return`${t.hh}${t.mm}`===hhmm;});if(selected)break;
    }
    if(!selected)return{handled:true,reply:'That time is no longer available. Your current appointment is unchanged. Please choose an available time again.'};
    const time=`${hhmm.slice(0,2)}:${hhmm.slice(2)}`;
    await updateIntent(phone,{preferred_time:time,status:'awaiting_confirmation'});
    return{handled:true,interactive:confirmationInteractive(a,intent.preferred_date,time)};
  }
  return{handled:true,interactive:daypartInteractive(a,intent.preferred_date)};
}
module.exports={processClientRescheduleAvailabilityMessage};
