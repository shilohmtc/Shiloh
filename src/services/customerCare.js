const { pool } = require('../db/pool');
const { sendWhatsAppTemplate } = require('./whatsapp');
const { processAppointmentReminderConfirmationMessage } = require('./appointmentReminderConfirmation');
const { processBookingConfirmationV2Action } = require('./bookingConfirmationV2Actions');
const { resolveClientFacingName } = require('./clientFacingNameAuthority');
const logger = require('../lib/logger');
const { createShilohRewardsService } = require('./shilohRewards');
const { CANONICAL_ORIGIN } = require('../middleware/canonicalHostRedirect');

const LANGUAGE_CODE = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en';
let careTimer = null;
let careRunning = false;
const rewardsService = createShilohRewardsService({ db: pool });

function normalizePhone(value=''){return String(value||'').replace(/[^0-9]/g,'');}
function clean(value=''){return String(value||'').trim().toLowerCase().replace(/\s+/g,' ');}
function fmtDate(v){return new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',weekday:'short',day:'2-digit',month:'short',year:'numeric'}).format(new Date(v));}
function fmtTime(v){return new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v));}
function isMyAppointmentsIntent(text=''){
  const n=clean(text);
  return /^(my appointments|appointments|my bookings|my booking|show my appointments|show my bookings|what appointments do i have|what bookings do i have|when is my appointment|when is my next appointment|next appointment|upcoming appointments|upcoming bookings)$/.test(n);
}
function isPersonalDetailsIntent(text=''){
  const n=clean(text).replace(/[.!?]+$/,'');
  return /^(?:i (?:want|would like|need) to )?(?:view|see|check|change|edit|correct|update|manage)(?: my)? (?:personal details|profile details|personal information|profile|details)$/.test(n)
    || /^(?:my )?(?:personal details|profile details)$/.test(n);
}
function isMobileIdentityChangeIntent(text=''){
  const n=clean(text).replace(/[.!?]+$/,'');
  return /^(?:i (?:want|would like|need) to )?(?:change|edit|correct|update)(?: my)? (?:phone|mobile|cellphone|whatsapp)(?: number)?$/.test(n);
}
function myShilohProfileUrl(origin=CANONICAL_ORIGIN){return `${String(origin||CANONICAL_ORIGIN).replace(/\/$/,'')}/my-shiloh/#profile`;}

async function clientForPhone(phone){
  const r=await pool.query(`SELECT DISTINCT c.id,c.date_of_birth FROM clients c JOIN client_contacts cc ON cc.client_id=c.id WHERE cc.normalized_value=$1 AND cc.contact_type IN ('whatsapp','mobile','phone') AND c.status='active' ORDER BY c.id LIMIT 2`,[normalizePhone(phone)]);
  if(r.rowCount!==1)return null;
  const client=r.rows[0];
  const name=await resolveClientFacingName(client.id);
  return{...client,client_facing_name:name.name||null,name_authority_id:name.authorityId||null};
}
async function setBirthdayOptIn(clientId,enabled){await pool.query(`INSERT INTO client_customer_care_preferences(client_id,birthday_opt_in,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(client_id) DO UPDATE SET birthday_opt_in=EXCLUDED.birthday_opt_in,updated_at=NOW()`,[clientId,enabled]);}

async function listUpcomingAppointments(clientId){
  const r=await pool.query(`
    SELECT a.id,a.starts_at,a.ends_at,a.status,
           COALESCE((SELECT string_agg(service_name_snapshot,' + ' ORDER BY position) FROM appointment_services WHERE appointment_id=a.id),a.title,'Shiloh appointment') AS service_name,
           COALESCE((SELECT string_agg(staff_name_snapshot,' + ' ORDER BY position) FROM appointment_staff WHERE appointment_id=a.id),'Shiloh practitioner') AS staff_name
      FROM appointments a
     WHERE a.client_id=$1
       AND a.status IN ('scheduled','confirmed')
       AND a.ends_at >= NOW()
     ORDER BY a.starts_at,a.id
     LIMIT 10`,[clientId]);
  return r.rows;
}

function appointmentActionButtons(rows=[]){
  if(!rows.length){
    return [
      { id:'client_postbook_book_another', title:'Book another' },
      { id:'client_postbook_main_menu', title:'Main menu' },
    ];
  }
  return [
    { id:'client_reschedule_booking', title:'Reschedule' },
    { id:'client_cancel_booking', title:'Cancel' },
    { id:'client_postbook_book_another', title:'Book another' },
  ];
}

function appointmentsReply(client,rows=[]){
  if(!rows.length){
    const neutral=client?.client_facing_name
      ? `${client.client_facing_name}, you don't currently have any upcoming scheduled or confirmed appointments in Shiloh.`
      : `You don't currently have any upcoming scheduled or confirmed appointments in Shiloh.`;
    return [`📅 *My appointments*`,'',neutral,'','Choose an option below whenever you’re ready.'].join('\n');
  }
  const lines=[`📅 *My appointments*`,''];
  rows.forEach((a,index)=>{
    lines.push(`*${index+1}. ${a.service_name}*`,`📅 ${fmtDate(a.starts_at)} at ${fmtTime(a.starts_at)}`,`👤 ${a.staff_name}`,`Status: ${a.status==='confirmed'?'Confirmed':'Scheduled'}`,'');
  });
  lines.push('Choose an option below to manage or make another booking.');
  return lines.join('\n');
}

async function syncCompletedLoyaltyVisits(){const earned=await rewardsService.syncEligibleEarnings();const cancelled=await rewardsService.syncCancelledRedemptions();return{newVisits:earned.recorded,clientsUpdated:earned.recorded,reversed:cancelled.reversed};}

async function loyaltyStatus(clientId){return rewardsService.getClientBalance(clientId);}

async function loyaltyStatusForPhone(phone){const row=(await pool.query(`SELECT id,name FROM crm_v2_clients WHERE normalized_mobile=$1 AND status='active' LIMIT 2`,[normalizePhone(phone)])).rows;if(row.length!==1)return null;return{client:row[0],status:await loyaltyStatus(row[0].id)};}

async function processCustomerCareMessage(phone,text){
  const bookingConfirmationV2=await processBookingConfirmationV2Action(phone,text);
  if(bookingConfirmationV2.handled)return bookingConfirmationV2;
  const reminderConfirmation=await processAppointmentReminderConfirmationMessage(phone,text);
  if(reminderConfirmation.handled)return reminderConfirmation;
  const n=clean(text);const birthdayOn=/^(birthday (messages|wishes) on|enable birthday (messages|wishes)|birthday on)$/.test(n);const birthdayOff=/^(birthday (messages|wishes) off|disable birthday (messages|wishes)|birthday off)$/.test(n);const loyalty=/^(loyalty|my loyalty|loyalty status|rewards|my rewards)$/.test(n);const myAppointments=isMyAppointmentsIntent(n);const personalDetails=isPersonalDetailsIntent(n);const mobileIdentityChange=isMobileIdentityChangeIntent(n);if(!birthdayOn&&!birthdayOff&&!loyalty&&!myAppointments&&!personalDetails&&!mobileIdentityChange)return{handled:false};if(mobileIdentityChange)return{handled:true,reply:'Your WhatsApp number protects access to My Shiloh, so it cannot be changed in your profile. Please ask the clinic team to verify and update it safely. 🌿'};if(personalDetails)return{handled:true,reply:[`You can update your personal details securely in *My Shiloh* 🌿`,'',myShilohProfileUrl(),'','Sign in with WhatsApp, open *Profile*, and review your full name, date of birth and gender. Your verified WhatsApp number can only be changed with help from the clinic team.'].join('\n')};if(loyalty){const result=await loyaltyStatusForPhone(phone);if(!result)return{handled:true,reply:'I could not safely match this WhatsApp number to exactly one active Shiloh client profile. Please ask the clinic team to verify your profile.'};const {client:rewardClient,status}=result;const balance=new Intl.NumberFormat('en-ZA',{style:'currency',currency:'ZAR'}).format(status.balance);const threshold=new Intl.NumberFormat('en-ZA',{style:'currency',currency:'ZAR'}).format(status.unlockThreshold);return{handled:true,reply:[`🌿 *Shiloh Rewards*`,'',`${rewardClient.name}, your current balance is *${balance}*.`,'',status.unlocked?'Your rewards are unlocked and you can choose when to use them in My Shiloh.':`Rewards unlock when your balance reaches *${threshold}*.`,'','You earn 5% after an eligible treatment is completed and paid. Rewards do not expire.'].join('\n')};}const client=await clientForPhone(phone);if(!client)return{handled:true,reply:'I could not safely match this WhatsApp number to exactly one active Shiloh client profile. Please ask the clinic team to verify your profile.'};if(myAppointments){const rows=await listUpcomingAppointments(client.id);return{handled:true,reply:appointmentsReply(client,rows),appointments:rows,interactive:{type:'button',body:appointmentsReply(client,rows),buttons:appointmentActionButtons(rows)}};}if(birthdayOn){await setBirthdayOptIn(client.id,true);const reply=client.client_facing_name?`🎂 Birthday wishes are now *on* for ${client.client_facing_name}. You can switch them off any time by sending *BIRTHDAY OFF*.`:'🎂 Birthday wishes are now *on*. You can switch them off any time by sending *BIRTHDAY OFF*.';return{handled:true,reply};}if(birthdayOff){await setBirthdayOptIn(client.id,false);return{handled:true,reply:'Birthday wishes are now *off*. 🌿'};}return{handled:false};}

async function sendBirthdayMessages(){const template=process.env.WHATSAPP_BIRTHDAY_TEMPLATE;if(!template)return{enabled:false,sent:0};const now=new Date();const year=Number(new Intl.DateTimeFormat('en',{timeZone:'Africa/Johannesburg',year:'numeric'}).format(now));const md=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Johannesburg',month:'2-digit',day:'2-digit'}).formatToParts(now);const m=Object.fromEntries(md.map(p=>[p.type,p.value]));const rows=await pool.query(`SELECT c.id,cc.normalized_value FROM clients c JOIN client_customer_care_preferences p ON p.client_id=c.id AND p.birthday_opt_in=TRUE JOIN LATERAL (SELECT normalized_value FROM client_contacts WHERE client_id=c.id AND contact_type IN ('whatsapp','mobile','phone') ORDER BY is_primary DESC,id LIMIT 1) cc ON TRUE LEFT JOIN birthday_message_deliveries d ON d.client_id=c.id AND d.birthday_year=$1 WHERE c.status='active' AND c.date_of_birth IS NOT NULL AND EXTRACT(MONTH FROM c.date_of_birth)=$2 AND EXTRACT(DAY FROM c.date_of_birth)=$3 AND d.id IS NULL`,[year,Number(m.month),Number(m.day)]);let sent=0;for(const row of rows.rows){try{const name=await resolveClientFacingName(row.id);await sendWhatsAppTemplate(row.normalized_value,template,[name.name||'there'],LANGUAGE_CODE);await pool.query(`INSERT INTO birthday_message_deliveries(client_id,birthday_year) VALUES($1,$2) ON CONFLICT DO NOTHING`,[row.id,year]);sent++;}catch(error){logger.error({err:error,clientId:row.id},'Birthday customer-care message failed');}}return{enabled:true,sent};}

async function runCustomerCareScan(){if(careRunning)return;careRunning=true;try{const loyalty=await syncCompletedLoyaltyVisits();const birthdays=await sendBirthdayMessages();if(loyalty.newVisits||birthdays.sent)logger.info({loyalty,birthdays},'Customer care maintenance completed');}catch(error){logger.error({err:error},'Customer care maintenance failed');}finally{careRunning=false;}}
function startCustomerCareScheduler(){if(careTimer)return;logger.info({birthdayTemplateConfigured:Boolean(process.env.WHATSAPP_BIRTHDAY_TEMPLATE),intervalHours:6},'Customer care scheduler started');setTimeout(runCustomerCareScan,15000).unref();careTimer=setInterval(runCustomerCareScan,6*60*60*1000);careTimer.unref();}

module.exports={processCustomerCareMessage,syncCompletedLoyaltyVisits,sendBirthdayMessages,loyaltyStatus,startCustomerCareScheduler,isMyAppointmentsIntent,isPersonalDetailsIntent,isMobileIdentityChangeIntent,myShilohProfileUrl,listUpcomingAppointments,appointmentsReply,appointmentActionButtons,clientForPhone};
