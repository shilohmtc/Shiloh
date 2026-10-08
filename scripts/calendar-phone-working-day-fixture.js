const { calendarOperationalMutationsClientScript } = require('../src/presentation/calendarOperationalMutationsUx');
const { calendarManageAppointmentNotesClientScript } = require('../src/presentation/calendarAppointmentNotesUx');
const { calendarAppointmentCompactEditorClientScript } = require('../src/presentation/calendarAppointmentCompactEditorUx');
// Synthetic production-renderer fixture; no client records or runtime database.
const { renderCalendarPage } = require('../src/presentation/calendarReadOnlyUx');
const { decoratePhoneCalendarV2, calendarPhoneCompactV2ClientScript } = require('../src/presentation/calendarPhoneCompactV2');
const { calendarPhoneAllStaffClientScript } = require('../src/presentation/calendarPhoneAllStaffUx');
const { calendarAppointmentDetailsClientScript } = require('../src/presentation/calendarAppointmentDetailsUx');
const DATE = '2026-10-07';
const STAFF = ['Abigail','Christel','Ilince','Naomi','Pieter','Savanna'].map((displayName,index)=>({id:51+index,displayName}));
function instant(minutes) { return `${DATE}T${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}:00+02:00`; }
function fixtureModel({ staff = STAFF, empty = false, noOutliers = false, straddlers = false, denseNotes = false } = {}) {
  const appointment = (id,start,duration,ids=[51],extra={}) => ({kind:'appointment',id,staffIds:ids,startsAt:instant(start),endsAt:instant(start+duration),clientName:`Synthetic Client ${id} with a long surname`,serviceName:'Synthetic secondary treatment',status:'scheduled',revision:'2026-10-07T06:00:00Z',serviceContexts:[],bookingNotesPresent:denseNotes&&[1,3,4].includes(id),...extra});
  const allowed = new Set(staff.map(p=>p.id));
  const appointments = empty ? [] : [appointment(1,480,15),appointment(2,495,30),appointment(3,540,60),appointment(4,570,90),appointment(5,720,90,[52],{bookingNotesPresent:true}),appointment(6,810,90,[51,52],{appointmentGroupType:'couples_massage',appointmentGroupId:901,appointmentGroupPosition:1}),appointment(7,990,30,[53]),appointment(8,660,60,[54],{status:'no_show'}),appointment(9,420,30,[51]),appointment(10,1020,60,[51]),appointment(11,610,60,[55]),appointment(12,880,60,[56]),appointment(13,930,60,[54],{appointmentGroupType:'group_booking',appointmentGroupId:903,appointmentGroupPosition:2})].filter(a=>a.staffIds.some(id=>allowed.has(id))&&(!noOutliers||![9,10].includes(a.id)));
  if(straddlers&&!empty){appointments.push(...[appointment(14,390,60,[51]),appointment(15,990,60,[53])].filter(a=>a.staffIds.some(id=>allowed.has(id))));}
  const leave = empty||!allowed.has(54)?[]:[{kind:'operational_leave',id:30,staffId:54,date:DATE,allDay:true,reason:'Synthetic leave'}];
  const blocks = empty||!allowed.has(53)?[]:[{kind:'calendar_block',id:31,staffId:53,startsAt:instant(600),endsAt:instant(660),blockType:'other',title:'Synthetic block'}];
  if(straddlers&&!empty&&allowed.has(52)){blocks.push({kind:'calendar_block',id:32,staffId:52,startsAt:instant(390),endsAt:instant(450),blockType:'other',title:'Synthetic early straddling block'},{kind:'operational_leave',id:33,staffId:52,startsAt:instant(990),endsAt:instant(1050),allDay:false,reason:'Synthetic late timed leave'});}
  const timeline = {staff,appointments,blocks,leave,closures:[],workingWindows:[],scheduleExceptions:[],recurringClosures:[],externalBusy:[],events:[...appointments,...blocks,...leave]};
  return {view:'week',dateKey:DATE,activeStaffId:staff[0]?.id,visibleStaffIds:staff.map(p=>p.id),permittedStaff:staff,timeline,authorizedTimeline:timeline,period:{startKey:'2026-10-05',previousAnchor:'2026-09-28',nextAnchor:'2026-10-12',dateKeys:['2026-10-05','2026-10-06',DATE,'2026-10-08','2026-10-09','2026-10-10']},mutationCapability:{enabled:true,calendarScope:'all_business',serviceScope:'all_services',allowedServiceIds:null,operations:['appointment:reschedule','appointment:cancel','appointment:reassign','calendar_block:manage','operational_leave:manage']}};
}
function fixtureHtml(options = {}) {
  const model=fixtureModel(options);
  let html=decoratePhoneCalendarV2(renderCalendarPage(model,{approvedPhonePresentation:true,bookingEnabled:true}),{model,bookingAllowed:true});
  html=html.replace(/<script\b[^>]*\bsrc="[^"]+"[^>]*><\/script>/gi,'');
  const script=calendarOperationalMutationsClientScript()+calendarManageAppointmentNotesClientScript()+calendarAppointmentCompactEditorClientScript()+calendarPhoneCompactV2ClientScript()+calendarPhoneAllStaffClientScript()+calendarAppointmentDetailsClientScript();
  return html.replace('</body>',`<script>${script}</script></body>`);
}
module.exports={fixtureModel,fixtureHtml,STAFF,DATE};
