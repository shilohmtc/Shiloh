'use strict';
const fs=require('node:fs'),path=require('node:path');
const {fixtureModel,DATE}=require('../../scripts/calendar-phone-working-day-fixture');
const {renderCalendarPage}=require('../../src/presentation/calendarReadOnlyUx');
const {decoratePhoneCalendarV2,calendarPhoneCompactV2ClientScript}=require('../../src/presentation/calendarPhoneCompactV2');
const {calendarPhoneAllStaffClientScript}=require('../../src/presentation/calendarPhoneAllStaffUx');
const {calendarAppointmentDetailsClientScript}=require('../../src/presentation/calendarAppointmentDetailsUx');
const {calendarDesktopApprovedClientScript}=require('../../src/presentation/calendarDesktopApprovedUx');
const {calendarDesktopFitCanvasClientScript}=require('../../src/presentation/calendarDesktopFitCanvasUx');
const {calendarPaymentLinkClientScript}=require('../../src/presentation/calendarPaymentsUx');
function detailsHtml({readOnly=false,pending=false,view='week',closure=false}={}){
 const staff=['Synthetic North','Synthetic South','Synthetic East','Synthetic West'].map((displayName,i)=>({id:51+i,displayName}));
 const model=fixtureModel({staff});if(closure)model.timeline.closures=[{date:DATE,reason:'Synthetic clinic closure'}];model.view=view;if(view==='day')model.period.dateKeys=[DATE];
 model.timeline.appointments[0].clientName='Synthetic Client One';model.timeline.appointments[0].clientMobile='27810000101';
 if(pending)model.timeline.appointments[0].bookingRequestState='pending';if(readOnly)model.mutationCapability.enabled=false;
 let html=decoratePhoneCalendarV2(renderCalendarPage(model,{approvedPhonePresentation:true,desktopEnhancementEnabled:true}),{model});
 const logo='data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'../../public/assets/pwa/shiloh-pwa-192.png')).toString('base64');html=html.replaceAll('/calendar/pwa/icon-192.png?v=official-brand-v4',logo);
 html=html.replace(/<script\b[^>]*\bsrc="[^"]+"[^>]*><\/script>/gi,'');
 return html.replace('</body>',`<script>${calendarDesktopApprovedClientScript()+calendarDesktopFitCanvasClientScript()+calendarPhoneCompactV2ClientScript()+calendarPhoneAllStaffClientScript()+calendarAppointmentDetailsClientScript()+calendarPaymentLinkClientScript()}</script></body>`);
}
module.exports={detailsHtml};
