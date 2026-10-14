const { renderCalendarPage } = require('../../src/presentation/calendarReadOnlyUx');
const { calendarDesktopApprovedClientScript } = require('../../src/presentation/calendarDesktopApprovedUx');
const { calendarDesktopFitCanvasClientScript } = require('../../src/presentation/calendarDesktopFitCanvasUx');
const { calendarAppointmentDetailsClientScript } = require('../../src/presentation/calendarAppointmentDetailsUx');
const { calendarPhoneCompactV2ClientScript } = require('../../src/presentation/calendarPhoneCompactV2');
const { renderMessagesPage } = require('../../src/presentation/workspaceMessagesUx');
const staff = [{ id: 41, displayName: 'Synthetic North' }, { id: 42, displayName: 'Synthetic Garden' }];
function calendarModel(empty = false) {
  const appointments = empty ? [] : [{ id: 9101, kind: 'appointment', canonical: true, status: 'completed', clientName: 'Synthetic Guest', serviceName: 'Synthetic treatment', startsAt: '2026-10-14T08:00:00Z', endsAt: '2026-10-14T09:00:00Z', staffIds: [42], serviceContexts: [{ serviceId: 81 }] }];
  return { view: 'week', dateKey: '2026-10-14', activeStaffId:42, permittedStaff: staff, visibleStaffIds: [41,42], visibleStaffSelectionExplicit: true,
    period: { startKey: '2026-10-14', previousAnchor: '2026-10-07', nextAnchor: '2026-10-21', dateKeys: ['2026-10-14'] },
    timeline: { staff, workingWindows: [], scheduleExceptions: [], recurringClosures: [], closures: [], blocks: [], leave: [], appointments, events: appointments }, mutationCapability: { enabled: false } };
}
function calendarHtml(empty = false, render = renderCalendarPage, returnTo = '/calendar/messages?view=attention') {
  let html = render(calendarModel(empty), { bookingEnabled: true, approvedPhonePresentation: true, desktopEnhancementEnabled: true, messagesReturnTo: returnTo });
  html = require('../../src/presentation/calendarPhoneCompactV2').decoratePhoneCalendarV2(html, { model:calendarModel(empty), bookingAllowed:true });
  return html.replace(/<script\b[^>]*src="[^"]+"[^>]*><\/script>/g, '').replace('</body>', `<script>${calendarDesktopApprovedClientScript()}${calendarDesktopFitCanvasClientScript()}${calendarPhoneCompactV2ClientScript()}${calendarAppointmentDetailsClientScript()}</script></body>`);
}
function messagesModel(startsAt = new Date('2026-10-14T08:00:00Z')) {
  return { selectedView: 'attention', authority: { displayName: 'Synthetic Reviewer' }, notificationAuthority: {}, attention: [{ appointment: { id: 9101, startsAt, serviceName: 'Synthetic treatment' }, client: { id: 12, name: 'Synthetic Guest' }, confirmation: { statusLabel: 'Needs review' } }], activity: [] };
}
function messagesHtml(render = renderMessagesPage) { return render(messagesModel()).replace(/<script\b[^>]*src="[^"]+"[^>]*><\/script>/g, ''); }
module.exports = { calendarModel, calendarHtml, messagesModel, messagesHtml };
const { renderDashboardPage } = require('../../src/presentation/workspaceDashboardUx');
const { renderClientListPage } = require('../../src/presentation/workspaceClientsUx');
const { injectClientListManagement } = require('../../src/presentation/workspaceClientsManageUx');
const { renderWorkspaceRewardsPage } = require('../../src/presentation/shilohRewardsUx');
function dashboardModel() {
  const appointments = calendarModel().timeline.appointments;
  return { mode:'owner_overview',displayName:'Synthetic Reviewer',requestedDateKey:'2026-10-14',operationalDateKey:'2026-10-14',calendar:{timeline:{staff}},closures:[],appointments,
    teamGroups:[{key:'42',label:'Synthetic Garden',appointments}],carryOver:[],awaitingFinalization:[],recentActivity:appointments,
    planningRequests:[1,2].map(id=>({id,request_kind:'flexible',client_name:'Synthetic Enquirer '+id,service_name:'Synthetic treatment',preferred_date:'2026-10-15',candidate_appointments:[]})),
    holidayDecisions:[{holidayName:'Synthetic holiday',exceptionDate:'2026-12-16',href:'/calendar/clinic-hours'}] };
}
function clientsModel() { return { manageAllowed:true,authority:{displayName:'Synthetic Reviewer',clientScope:{kind:'all_business'}},status:'active',query:'',offset:0,pageSize:24,hasMore:false,clients:[{id:12,name:'Synthetic Guest',normalized_mobile:'27820000010',status:'active',last_appointment_at:'2026-10-14T08:00:00Z'}] }; }
function clientsHtml(render = renderClientListPage, manage = injectClientListManagement) { return manage(render(clientsModel()), clientsModel()); }
function rewardsModel() { return {policy:{earnRate:5,unlockThreshold:100},authority:{canManage:true},wallets:[{name:'Synthetic Guest',normalized_mobile:'27820000010',balance:12.5,latest_activity:'2026-10-14T08:00:00Z'}]}; }
function rewardsHtml(render = renderWorkspaceRewardsPage) { return render({model:rewardsModel(),csrfToken:'synthetic',displayName:'Synthetic Reviewer'}); }
function dashboardHtml(render = renderDashboardPage) { return render(dashboardModel()); }
Object.assign(module.exports, { dashboardModel, dashboardHtml, clientsModel, clientsHtml, rewardsHtml });
