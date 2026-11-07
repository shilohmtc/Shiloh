'use strict';
const crypto = require('node:crypto');
const { normalizeMobile } = require('./crmV2ClientService');
const { isOrganiserContactGuest } = require('./crmV2GuestProfile');
const PURPOSES = new Set(['booking_confirmation','booking_changed','booking_cancelled','appointment_reminder']);
const ROUTING_SQL = `SELECT a.id,a.client_id,a.crm_v2_client_id,a.status AS appointment_status,
 to_char(a.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS starts_at,
 to_char(a.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at,
 c.name AS guest_name,c.status AS guest_status,c.normalized_mobile,c.profile_status,c.mobile_verified_at,
 to_jsonb(c)->>'contact_mode' AS contact_mode,gm.group_id,g.source AS group_source,g.status AS group_status,
 to_char(g.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS group_starts_at,
 to_char(g.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS group_revision,
 (SELECT COUNT(*)::int FROM appointment_group_members all_members WHERE all_members.group_id=gm.group_id) AS guest_count,
 (SELECT COUNT(*)::int FROM appointment_group_members memberships WHERE memberships.appointment_id=a.id) AS membership_count,
 bc.organiser_crm_v2_client_id,bc.revision AS contact_revision,o.status AS organiser_status,o.normalized_mobile AS organiser_mobile,
 to_jsonb(o)->>'contact_mode' AS organiser_contact_mode,
 EXISTS(SELECT 1 FROM crm_v2_client_relationships r WHERE r.client_id=c.id AND r.relationship_type='clinic' AND r.owner_staff_id IS NULL AND r.status='active') AS guest_clinic,
 EXISTS(SELECT 1 FROM crm_v2_client_relationships r WHERE r.client_id=o.id AND r.relationship_type='clinic' AND r.owner_staff_id IS NULL AND r.status='active') AS organiser_clinic,
 EXISTS(SELECT 1 FROM appointment_services s JOIN service_visibility_policies v ON v.service_id=s.service_id WHERE s.appointment_id=a.id AND v.visibility_scope='tenant_private') AS private_service
 FROM appointments a JOIN crm_v2_clients c ON c.id=a.crm_v2_client_id
 LEFT JOIN appointment_group_members gm ON gm.appointment_id=a.id LEFT JOIN appointment_groups g ON g.id=gm.group_id
 LEFT JOIN appointment_group_booking_contacts bc ON bc.appointment_group_id=g.id LEFT JOIN crm_v2_clients o ON o.id=bc.organiser_crm_v2_client_id
 WHERE a.id=$1 LIMIT 2`;
// Booking delivery only. This is not guest identity, financial or private-form authority.
async function resolveGuestBookingNotice(db, { appointmentId, purpose, auditEventId, now = new Date() } = {}) {
 if (!PURPOSES.has(purpose)) return { state: 'unsupported_purpose' };
 if (!['string','number'].includes(typeof appointmentId) || !/^[1-9][0-9]*$/.test(String(appointmentId)) || !Number.isSafeInteger(Number(appointmentId))) return { state: 'unavailable' };
 try {
  let changeAudit = null;
  if (auditEventId != null) {
   if (!['booking_changed','booking_cancelled'].includes(purpose)) return {state:'unavailable'};
   changeAudit = await require('./guestBookingChangeAudit').guestBookingChangeAudit(db,{auditEventId,appointmentId,purpose});
   if(!changeAudit)return {state:'unavailable'};
  }
  const rows=(await db.query(ROUTING_SQL,[Number(appointmentId)])).rows;
  if(rows.length!==1)return {state:'unavailable'};
  const r=rows[0],count=Number(r.guest_count),organiserId=Number(r.organiser_crm_v2_client_id);
  const directClient=Boolean(r.normalized_mobile)&&normalizeMobile(r.normalized_mobile)===r.normalized_mobile&&(r.contact_mode==null||r.contact_mode==='direct');
  if(r.client_id!=null||r.guest_status!=='active'||!r.guest_clinic||(!isOrganiserContactGuest(r)&&!directClient))return {state:'unavailable'};
  if(r.group_source!=='shiloh_calendar_group'||Number(r.membership_count)!==1||!Number.isSafeInteger(count)||count<3||count>10||r.private_service)return {state:'unavailable'};
  if(!directClient&&(!Number.isSafeInteger(organiserId)||organiserId<=0||r.organiser_status!=='active'||!r.organiser_clinic||!normalizeMobile(r.organiser_mobile)||normalizeMobile(r.organiser_mobile)!==r.organiser_mobile||(r.organiser_contact_mode!=null&&r.organiser_contact_mode!=='direct')))return {state:'unavailable'};
  const groupStatuses=purpose==='booking_cancelled'?['scheduled','confirmed','cancelled']:['scheduled','confirmed'];
  if(!groupStatuses.includes(r.group_status)||!r.contact_revision||!Number.isSafeInteger(Number(r.contact_revision))||Number(r.contact_revision)<=0)return {state:'unavailable'};
  const statusAllowed=purpose==='booking_cancelled'?r.appointment_status==='cancelled':['scheduled','confirmed'].includes(r.appointment_status);
  const at=new Date(purpose==='booking_confirmation'?r.group_starts_at:r.starts_at),clock=new Date(now);
  if(!statusAllowed||!Number.isFinite(at.getTime())||!Number.isFinite(clock.getTime())||at<=clock)return {state:'unavailable'};
  if(directClient)return {state:'direct_client_required'};
  const date=new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',day:'2-digit',month:'short',year:'numeric'}).format(at);
  const time=new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',hour:'2-digit',minute:'2-digit',hour12:false}).format(at);
  const chars=Array.from(String(r.guest_name||''));if(!chars.length)return {state:'unavailable'};
  const name=chars.slice(0,60).join('')+(chars.length>60?'…':'');
  const titles={booking_confirmation:'Group booking confirmed',booking_changed:'Group booking updated',booking_cancelled:'Group booking cancelled',appointment_reminder:'Group appointment reminder'};
  const changeLabels={time:'Appointment time updated',service:'Treatment selection updated',practitioner:'Practitioner updated',price:'Booking details updated'};
  const body=purpose==='booking_confirmation'?`Your group booking for ${count} guests starts on ${date} at ${time}.`:
    purpose==='booking_changed'?`${changeLabels[changeAudit?.kind]||'Booking updated'} for ${name}: ${date} at ${time}.`:
    purpose==='booking_cancelled'?`Booking cancelled for ${name}: ${date} at ${time}.`:
    `Appointment reminder for ${name}: ${date} at ${time}.`;
  if(!(purpose==='booking_confirmation'?r.group_revision:r.updated_at))return {state:'unavailable'};
  const sourceRevision=String(purpose==='booking_confirmation'?r.group_revision:r.updated_at);
  if(!Number.isFinite(Date.parse(sourceRevision)))return {state:'unavailable'};
  const subject=purpose==='booking_confirmation'?`group:${r.group_id}`:`appointment:${r.id}`;
  const canonicalStart=String(purpose==='booking_confirmation'?r.group_starts_at:r.starts_at);
  const digest=crypto.createHash('sha256').update(JSON.stringify([subject,purpose,sourceRevision,organiserId,String(r.contact_revision),canonicalStart,body,...(changeAudit?[changeAudit.auditEventId]:[])])).digest('hex');
  return {state:'ready',notification:{crmV2ClientId:organiserId,eventKey:`guest-booking:${purpose}:${digest}`,category:'appointment',title:titles[purpose],body,targetPath:'/my-shiloh/'}};
 }catch(_error){return {state:'unavailable'};}
}
module.exports={resolveGuestBookingNotice,ROUTING_SQL};
