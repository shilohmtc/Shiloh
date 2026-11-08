'use strict';
const {calendarReturnHref}=require('./calendarReturnContext');
const {appointmentDetailHref,businessDateKey}=require('./calendarAppointmentDetailLinks');
function validDate(value) { if(!value)return null;const date=new Date(value);return Number.isNaN(date.getTime())?null:date; }
function paymentVisitContext(subject) {
 const start=validDate(subject.startsAt),end=validDate(subject.endsAt);
 const options={timeZone:'Africa/Johannesburg',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'};
 const parts=[];
 if(start)parts.push(new Intl.DateTimeFormat('en-GB',options).format(start)+(end&&end>start?' – '+new Intl.DateTimeFormat('en-GB',businessDateKey(start)===businessDateKey(end)?{timeZone:'Africa/Johannesburg',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}:options).format(end):'')+' SAST');
 const names=Array.isArray(subject.practitionerNames)?subject.practitionerNames.filter(name=>typeof name==='string'&&name.trim()):[];
 if(names.length)parts.push(names.join(' + '));
 return parts.join(' · ');
}
function paymentVisitReturnHref(subject,raw) {
 const fallback=subject.startsAt?appointmentDetailHref({appointmentId:subject.appointmentId,startsAt:subject.startsAt}):null;
 const safe=calendarReturnHref(raw||fallback,subject.appointmentId);
 const url=new URL(safe,'https://calendar.invalid');
 if(!url.searchParams.has('date')&&fallback){
  const defaults=new URL(fallback,'https://calendar.invalid').searchParams;
  for(const key of ['date','view','staff'])if(!url.searchParams.has(key)&&defaults.has(key))url.searchParams.set(key,defaults.get(key));
 }
 return url.pathname+url.search;
}
module.exports={paymentVisitContext,paymentVisitReturnHref};
