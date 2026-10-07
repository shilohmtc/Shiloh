import confirmationPresentation from '../src/presentation/workspaceConfirmation.js';
import operationalPresentation from '../src/presentation/calendarOperationalMutationsUx.js';
import dashboardPresentation from '../src/presentation/workspaceDashboardUx.js';
import clientPresentation from '../src/presentation/workspaceCommunicationEvidenceUx.js';
import messagesPresentation from '../src/presentation/workspaceMessagesUx.js';
import editorPresentation from '../src/presentation/calendarAppointmentCompactEditorUx.js';
import createBookingPresentation from '../src/presentation/calendarCreateBookingUx.js';
import couplesBookingPresentation from '../src/presentation/calendarCouplesBookingUx.js';
import groupBookingPresentation from '../src/presentation/calendarGroupBookingUx.js';
import multiServiceBookingPresentation from '../src/presentation/calendarMultiServiceBookingUx.js';
import paymentPresentation from '../src/presentation/calendarPaymentsUx.js';
import passkeyPresentation from '../src/presentation/staffPasskeyUx.js';
import pwaPresentation from '../src/presentation/workspacePwa.js';
import clinicHoursPresentation from '../src/presentation/workspaceClinicHoursUx.js';

const { renderDashboardPage, dashboardClientScript } = dashboardPresentation;
const { renderClinicHoursPage } = clinicHoursPresentation;
const { renderClientDetailPageWithCommunications } = clientPresentation;
const { renderMessagesPage } = messagesPresentation;
const { calendarAppointmentCompactEditorClientScript } = editorPresentation;
const { renderCalendarCreateBookingPage, calendarCreateBookingClientScript } = createBookingPresentation;
const {
  managePage: renderPasskeyManagePage,
  manageScript: passkeyManageScript,
} = passkeyPresentation;
const { renderCalendarCouplesBookingPage, calendarCouplesBookingClientScript } = couplesBookingPresentation;
const { renderCalendarGroupBookingPage, calendarGroupBookingClientScript } = groupBookingPresentation;
const { renderCalendarMultiServiceBookingPage, calendarMultiServiceBookingClientScript } = multiServiceBookingPresentation;
const { renderCalendarPaymentPage } = paymentPresentation;
const {
  workspacePwaIconSvg,
  workspaceIosInstallGuideStyles,
  workspaceIosInstallGuideMarkup,
} = pwaPresentation;

function productionSurface(pageHtml) {
  const styles = [...String(pageHtml).matchAll(/<style>([\s\S]*?)<\/style>/g)]
    .map((match) => match[1])
    .join('\n');
  const body = String(pageHtml).match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || '';
  return `<style>${styles}.workspace-surface-story{min-height:100vh}.workspace-surface-story script{display:none}</style><div class="workspace-surface-story" data-story-surface>${body.replace(/<script[\s\S]*?<\/script>/g, '')}</div>`;
}

function workspaceNavigationOpenStory(notificationState = null) {
  const root = document.createElement('div');
  root.innerHTML = productionSurface(renderDashboardPage(dashboardModel(), {
    navigation: {
      clientsHref: '/calendar/clients',
      messagesHref: '/calendar/messages',
      staffHref: '/calendar/team',
      servicesHref: '/calendar/services',
      reportsHref: '/calendar/reports',
      clinicHoursHref: '/calendar/clinic-hours',
      vouchersHref: '/calendar/gift-vouchers',
      rewardsHref: '/calendar/rewards',
      formsHref: '/calendar/forms',
      problemReportsHref: '/calendar/problem-reports',
    },
  }));
  const drawer = root.querySelector('[data-workspace-navigation-drawer]');
  const backdrop = root.querySelector('[data-workspace-nav-backdrop]');
  const toggle = root.querySelector('[data-workspace-drawer-toggle]');
  if (notificationState !== null) {
    const panel = root.querySelector('[data-workspace-notifications]');
    panel.hidden = false;
    const button = panel.querySelector('[data-workspace-push-toggle]');
    button.disabled = notificationState === 'blocked';
    button.setAttribute('aria-checked', String(notificationState === 'on'));
    button.dataset.enabled = String(notificationState === 'on');
    panel.querySelector('[data-workspace-push-state]').textContent = notificationState === 'on' ? 'On' : 'Off';
    if (notificationState === 'blocked') panel.querySelector('[data-workspace-push-status]').textContent = 'Allow Shiloh notifications in your phone settings.';
    const link = document.createElement('a');
    link.className = 'workspace-account-signout';
    link.href = '/calendar/staff-auth/passkeys/manage';
    link.dataset.workspacePasskeySecurity = 'true';
    link.textContent = 'Devices & sign-in';
    root.querySelector('[data-workspace-account-footer]').insertBefore(link, root.querySelector('[data-shiloh-logout]'));
  }
  drawer?.classList.add('open');
  backdrop?.classList.add('open');
  toggle?.setAttribute('aria-expanded', 'true');
  return root;
}

const staff = [
  { id: 11, displayName: 'Abigail' },
  { id: 12, displayName: 'Christel' },
  { id: 13, displayName: 'Marietjie' },
];

function appointment({ id, clientName, serviceName, staffId, startsAt, endsAt, status = 'confirmed', canFinalize = false, operationalDateKey = '2026-09-12' }) {
  const person = staff.find((item) => item.id === staffId);
  return {
    id,
    clientName,
    serviceName,
    startsAt,
    endsAt,
    status,
    canFinalize,
    operationalDateKey,
    revision: `${startsAt}-revision`,
    staffIds: [staffId],
    staff: [{ staffId, nameSnapshot: person.displayName }],
  };
}

function dashboardModel() {
  const appointments = [
    appointment({ id: 667, clientName: 'Rozel Janse van Rensburg', serviceName: 'Sports Massage Full Body', staffId: 11, startsAt: '2026-09-12T06:00:00.000Z', endsAt: '2026-09-12T07:00:00.000Z' }),
    appointment({ id: 668, clientName: 'Michelle Sardinha', serviceName: 'Full Body Swedish', staffId: 12, startsAt: '2026-09-12T08:00:00.000Z', endsAt: '2026-09-12T09:00:00.000Z', canFinalize: true }),
    appointment({ id: 669, clientName: 'Naomi Jacobs', serviceName: 'Deep Tissue Massage', staffId: 13, startsAt: '2026-09-12T09:30:00.000Z', endsAt: '2026-09-12T10:30:00.000Z' }),
  ];
  return {
    requestedDateKey: '2026-09-12',
    operationalDateKey: '2026-09-12',
    displayName: 'Jean-Pierre',
    mode: 'owner_overview',
    canFinalizeAllBusiness: true,
    calendar: { timeline: { staff, appointments: [], closures: [] } },
    closures: [],
    appointments,
    teamGroups: staff.map((person) => ({
      key: String(person.id),
      label: person.displayName,
      appointments: appointments.filter((item) => item.staffIds.includes(person.id)),
    })),
    carryOver: [appointment({ id: 650, clientName: 'Previous-day client', serviceName: 'Quick Relief: Back & Neck', staffId: 12, startsAt: '2026-09-11T13:00:00.000Z', endsAt: '2026-09-11T13:45:00.000Z', canFinalize: true, operationalDateKey: '2026-09-11' })],
    awaitingFinalization: [appointments[1]],
    bookingRequests: [],
    communications: {
      attentionUnavailable: false,
      attention: [{ client: { name: 'Michelle Sardinha' }, appointment: { id: 668 } }],
    },
    communicationsUnavailable: false,
    recentActivity: [appointment({ id: 645, clientName: 'Completed client', serviceName: 'Full Body Swedish', staffId: 11, startsAt: '2026-09-12T05:00:00.000Z', endsAt: '2026-09-12T06:00:00.000Z', status: 'completed' })],
  };
}

function activeNoShowDashboardModel() {
  const model = dashboardModel();
  model.appointments = model.appointments.map((item, index) => index === 0
    ? { ...item, canFinalize: false, canMarkNoShow: true }
    : item);
  model.teamGroups = staff.map((person) => ({
    key: String(person.id),
    label: person.displayName,
    appointments: model.appointments.filter((item) => item.staffIds.includes(person.id)),
  }));
  return model;
}

function clientModel() {
  return {
    authority: { displayName: 'Jean-Pierre' },
    client: {
      id: 912,
      name: 'Rozel Janse van Rensburg',
      normalized_mobile: '27823042241',
      date_of_birth: '1991-05-14',
      gender: 'female',
      profile_status: 'registered',
      mobile_verified_at: '2026-09-10T10:00:00.000Z',
      status: 'active',
    },
    appointments: [
      { id: 667, starts_at: '2026-10-24T08:00:00.000Z', ends_at: '2026-10-24T09:30:00.000Z', status: 'scheduled', services: [{ name: 'Full Body Swedish' }], staff: [{ name: 'Christel' }] },
      { id: 640, starts_at: '2026-09-12T08:00:00.000Z', ends_at: '2026-09-12T08:45:00.000Z', status: 'completed', services: [{ name: 'Quick Relief: Back & Neck (45 min)' }], staff: [{ name: 'Christel' }] },
      { id: 620, starts_at: '2026-09-05T07:00:00.000Z', ends_at: '2026-09-05T07:45:00.000Z', status: 'cancelled', services: [{ name: 'Quick Relief: Back & Neck (45 min)' }], staff: [{ name: 'Christel' }] },
    ],
    communications: [{ intent: 'booking_confirmation', label: 'Booking confirmation', statusLabel: 'Available in My Shiloh', occurredAt: '2026-09-10T11:56:00.000Z', appointmentId: 667, templateName: null }],
    communicationsUnavailable: false,
    hasMore: false,
    historyOffset: 0,
    pageSize: 20,
  };
}

function messagesModel() {
  return {
    authority: { displayName: 'Jean-Pierre' },
    selectedView: 'all',
    notificationAuthority: { allowed: true },
    attentionUnavailable: false,
    activityUnavailable: false,
    attention: [{
      canRecover: false,
      actionLabel: 'Re-send confirmation',
      appointment: { id: 668, serviceName: 'Full Body Swedish', startsAt: '2026-09-12T08:00:00.000Z' },
      client: { id: 912, name: 'Michelle Sardinha', mobileLast4: '4567' },
      confirmation: {
        statusLabel: 'App update unavailable',
        deliveryExplanation: 'No current confirmation update is available in My Shiloh. The booking remains available in Bookings.',
      },
      recoveryExplanation: 'Review the booking and contact the client directly if timely notice matters.',
    }],
    activity: [
      { clientName: 'Rozel Janse van Rensburg', mobileLast4: '2241', label: 'Booking confirmation', appointmentId: 667, occurredAt: '2026-09-10T11:56:00.000Z', status: 'available', statusLabel: 'Available in My Shiloh' },
      { clientName: 'Naomi Jacobs', mobileLast4: '8172', label: 'Appointment reminder', appointmentId: 669, occurredAt: '2026-09-11T07:15:00.000Z', status: 'available', statusLabel: 'Available in My Shiloh' },
    ],
  };
}

function editorStory(interactive = false) {
  const root = document.createElement('div');
  root.className = 'appointment-editor-story';
  root.innerHTML = `<style>:root{--ink:#20322b;--muted:#56685f;--panel:#fffdf9;--line:#dce3dd;--line-strong:#c8d3cb;--leaf-soft:#e7eee9;--leaf-deep:#294c3c}*{box-sizing:border-box}body{margin:0;background:#f4f3ed;color:var(--ink);font-family:Inter,system-ui,sans-serif}.appointment-editor-story{min-height:100vh}.management-panel{display:block;border:0;padding:0;background:transparent;width:100%;height:100vh}.management-card{height:100%;width:min(520px,100%);margin-left:auto;overflow:auto;background:var(--panel);padding:22px;box-shadow:-12px 0 40px rgba(20,45,35,.2)}.panel-head{display:flex;justify-content:space-between;gap:12px;align-items:start;border-bottom:1px solid var(--line);padding-bottom:14px}.panel-head h2{margin:3px 0;font-size:1.25rem}.panel-close{border:1px solid var(--line);background:#fff;border-radius:999px;width:44px;height:44px}.panel-summary{margin:16px 0;padding:12px;border-radius:12px;background:var(--leaf-soft);display:grid;gap:4px}.panel-actions{display:grid;gap:14px}.panel-action{display:none}.panel-action.visible{display:grid;gap:9px}.panel-action label{display:grid;gap:5px;font-size:.76rem;font-weight:750}.panel-action input,.panel-action select,.panel-action textarea{width:100%;min-height:44px;border:1px solid var(--line-strong);border-radius:9px;padding:9px;font:inherit;background:#fff}.panel-action button{min-height:44px;border:0;border-radius:9px;padding:10px 13px;background:var(--leaf-deep);color:#fff;font:inherit;font-weight:800}.panel-action.danger button{background:#843f35}.eyebrow{font-size:.66rem;text-transform:uppercase;letter-spacing:.11em;font-weight:850;color:var(--muted)}h3,p{margin:0}.end-time-state,.treatment-price-current{padding:11px;border-radius:10px;background:var(--leaf-soft);display:grid;gap:4px}@media(max-width:700px){.management-card{height:min(92vh,780px);margin-top:8vh;border-radius:18px 18px 0 0}}</style>
    <div class="management-panel" data-calendar-management-panel><section class="management-card"><header class="panel-head"><div><span class="eyebrow">Appointment</span><h2>Rozel Janse van Rensburg</h2></div><button class="panel-close" type="button" aria-label="Close">×</button></header><div class="panel-summary"><strong data-panel-client>Appointment #667</strong><span data-panel-service>Sports Massage Full Body</span><span data-panel-practitioners>Abigail</span><span data-panel-time>Sat, 12 Sept 2026 · 08:00</span><span>Completed</span></div><section class="panel-summary app-availability" data-panel-confirmation><span class="eyebrow">My Shiloh</span><strong>Not currently shown in My Shiloh</strong><span>My Shiloh shows upcoming scheduled and confirmed bookings.</span></section><form class="panel-action visible appointment-notes-manage" data-appointment-notes-form><span class="eyebrow">Internal notes</span><textarea aria-label="Internal notes" placeholder="Internal context for staff only"></textarea><span class="panel-hint">Internal only — not included in client confirmations or reminders.</span><button type="button">Save notes</button></form><div class="panel-actions"><form class="panel-action visible" data-treatment-price-form><span class="eyebrow">Treatment &amp; price</span><h3>Correct this appointment</h3><div class="treatment-price-current"><strong>Sports Massage Full Body</strong><span>Charged: R750.00</span></div><label>Treatment<select><option>Sports Massage Full Body</option></select></label><label>Charged price (R)<input value="750.00"></label><button type="button">Save treatment &amp; price</button></form><form class="panel-action visible" data-end-time-form><span class="eyebrow">Appointment timing</span><h3>Adjust end time</h3><div class="end-time-state"><strong>Appointment #667</strong><span>Current end: 10:00</span></div><label>Effective end time<input type="datetime-local" value="2026-09-12T10:00"></label><button type="button">Save end time</button></form><form class="panel-action visible" data-panel-action="appointment:reschedule"><label>Date<input type="date" value="2026-09-12"></label><label>Start time<input type="time" value="08:00"></label><button type="button">Save new time</button></form><form class="panel-action visible" data-panel-action="appointment:reassign"><label>Practitioner<select><option>Abigail</option></select></label><button type="button">Reassign</button></form><form class="panel-action visible danger" data-panel-action="appointment:cancel"><label><input type="checkbox"> I confirm this exact appointment should be cancelled.</label><button type="button">Cancel appointment</button></form></div></section></div>`;
  if (interactive) {
    const existing = root.querySelector('[data-calendar-management-panel]');
    const dialog = document.createElement('dialog');
    dialog.className = existing.className;
    dialog.dataset.calendarManagementPanel = 'true';
    dialog.setAttribute('aria-labelledby', 'story-appointment-title');
    dialog.innerHTML = existing.innerHTML;
    dialog.querySelector('h2').id = 'story-appointment-title';
    dialog.querySelector('h2').dataset.panelTitle = 'true';
    dialog.querySelector('[aria-label="Close"]').dataset.panelClose = 'true';
    const summary = dialog.querySelector('.panel-summary');
    [...summary.querySelectorAll('span:not([data-panel-service]):not([data-panel-practitioners]):not([data-panel-time])')].forEach(node => node.remove());
    summary.insertAdjacentHTML('beforeend', '<span data-panel-mobile></span><span data-panel-status></span>');
    dialog.querySelector('[data-panel-confirmation]').remove();
    dialog.querySelector('[data-panel-action="appointment:reschedule"] input[type="date"]').name = 'date';
    dialog.querySelector('[data-panel-action="appointment:reschedule"] input[type="time"]').name = 'time';
    dialog.querySelector('[data-panel-action="appointment:reassign"] select').name = 'destinationStaffId';
    dialog.querySelector('[data-panel-action="appointment:cancel"] input').name = 'confirmed';
    existing.replaceWith(dialog);
    root.insertAdjacentHTML('beforeend', '<style>.management-panel:not([open]){display:none}.management-panel[open]{position:fixed;inset:0;margin:0;max-width:100%;max-height:100%;height:100dvh}</style><button type="button" data-appointment-id="667" data-revision="2026-09-30T10:00:00.000Z" data-starts-at="2099-10-01T10:00:00.000Z" data-staff-ids="1" data-client-name="Synthetic client" data-client-mobile="082 123 4567" data-service-name="Sports Massage Full Body" data-practitioner-names="Synthetic practitioner" data-appointment-status="scheduled" data-allowed-operations="appointment:reschedule,appointment:cancel,appointment:reassign" data-calendar-operation="manage-appointment">Open appointment</button>');
  }
  window.setTimeout(() => {
    if (interactive) new Function(operationalPresentation.calendarOperationalMutationsClientScript())();
    new Function(calendarAppointmentCompactEditorClientScript())();
    root.querySelector('[data-calendar-management-panel]').dispatchEvent(new CustomEvent('shiloh:appointment-panel-open', { bubbles: true }));
  }, 0);
  return root;
}

function interactiveProductionSurface(pageHtml, clientScript) {
  const root = document.createElement('div');
  root.innerHTML = productionSurface(pageHtml);
  const data = String(pageHtml).match(/<script type="application\/json"[\s\S]*?<\/script>/)?.[0];
  if (data) root.insertAdjacentHTML('beforeend', data);
  window.setTimeout(() => new Function(clientScript)(), 0);
  return root;
}

function deviceManagementDialogStory() {
  const credentials = [
    { id: 1, label: 'Jean-Pierre\u2019s Windows PC', current: true, createdAt: '2026-09-13T15:05:00.000Z', lastUsedAt: '2026-09-13T15:42:00.000Z', backedUp: true },
    { id: 2, label: 'JP\u2019s iPhone', current: false, createdAt: '2026-09-12T06:30:00.000Z', lastUsedAt: null, backedUp: true },
  ];
  const root = document.createElement('div');
  root.innerHTML = productionSurface(renderPasskeyManagePage({ credentials }));
  window.setTimeout(() => {
    const originalFetch = window.fetch;
    window.fetch = async (input, options = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/calendar/staff-auth/passkeys' && (!options.method || options.method === 'GET')) {
        return new Response(JSON.stringify({ credentials }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input, options);
    };
    new Function(passkeyManageScript())();
  }, 0);
  return root;
}

function pwaIconStory() {
  const root = document.createElement('div');
  root.innerHTML = `<style>*{box-sizing:border-box}body{margin:0;background:#eef1ed;font-family:Inter,system-ui,sans-serif}.pwa-icon-story{min-height:100vh;display:grid;place-items:center;padding:28px}.pwa-icon-card{display:grid;gap:14px;justify-items:center;padding:24px;border-radius:24px;background:#fffdf9;box-shadow:0 16px 44px rgba(23,56,45,.14)}.pwa-icon{display:block;width:192px;height:192px;border-radius:22%;box-shadow:0 8px 20px rgba(23,56,45,.18)}strong{color:#20322b;font-size:1rem}</style><div class="pwa-icon-story"><div class="pwa-icon-card">${workspacePwaIconSvg(192).replace('<svg ', '<svg class="pwa-icon" ')}<strong>Shiloh</strong></div></div>`;
  return root;
}

function iosInstallGuidanceStory() {
  const root = document.createElement('div');
  root.className = 'ios-install-story';
  root.innerHTML = `<style>*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#eef4ef,#f7f5ef);font-family:Inter,system-ui,sans-serif}.ios-install-story{min-height:100vh}${workspaceIosInstallGuideStyles()}</style><main style="min-height:100vh;padding:24px 18px"><p style="margin:0;color:#496b5a;font-size:.72rem;font-weight:850;letter-spacing:.1em">CALENDAR</p><h1 style="margin:6px 0;color:#20322b;font-size:1.55rem">Your week</h1><p style="margin:0;color:#61736a">Appointments stay visible behind the install help.</p></main>${workspaceIosInstallGuideMarkup()}`;
  const host = root.querySelector('[data-shiloh-ios-install]');
  const layer = host.querySelector('[data-shiloh-ios-install-layer]');
  const opener = host.querySelector('[data-shiloh-ios-install-open]');
  const setOpen = (open) => {
    layer.hidden = !open;
    opener.setAttribute('aria-expanded', String(open));
    if (open) host.querySelector('.shiloh-ios-close').focus();
    else opener.focus();
  };
  opener.addEventListener('click', () => setOpen(true));
  host.querySelectorAll('[data-shiloh-ios-install-close]').forEach((button) => button.addEventListener('click', () => setOpen(false)));
  host.querySelectorAll('[data-shiloh-ios-install-dismiss]').forEach((button) => button.addEventListener('click', () => host.remove()));
  host.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !layer.hidden) setOpen(false);
  });
  return root;
}

export default {
  title: 'Workspace/Production surfaces',
  parameters: { layout: 'fullscreen' },
};

export const DashboardOperational = { render: () => interactiveProductionSurface(renderDashboardPage(dashboardModel()), dashboardClientScript()) };
export const ReceptionPlanningQueue = {
  render: () => interactiveProductionSurface(renderDashboardPage({
    ...dashboardModel(),
    displayName: 'Shiloh Reception',
    bookingRequests: [
      { appointmentId: 801, currentStaffId:11, canChangePractitioner:true, eligiblePractitioners:[staff[0],staff[1]], status: 'pending', clientName: 'Client A', serviceName: 'Massage', staffName: 'Abigail', occasionNote: 'Birthday treat for two', requestedStartsAt: '2026-09-28T08:00:00.000Z', requestedRevision: '2026-09-26T09:00:00.000Z' },
      { appointmentId: 802, currentStaffId:12, canChangePractitioner:true, eligiblePractitioners:[staff[1]], status: 'pending', planningStartedAt: '2026-09-26T10:00:00.000Z', clientName: 'Client B', serviceName: 'Facial', staffName: 'Christel', requestedStartsAt: '2026-09-28T10:00:00.000Z', requestedRevision: '2026-09-26T09:30:00.000Z' },
    ],
  }), dashboardClientScript()),
};
export const ReceptionPractitionerAssignments = {
  render: () => interactiveProductionSurface(renderDashboardPage({
    ...dashboardModel(), displayName:'Shiloh Reception', bookingRequests:[
      { appointmentId:803,currentStaffId:11,canChangePractitioner:true,eligiblePractitioners:[],status:'pending',clientName:'Client C',serviceName:'Toe Gel Only',staffName:'Abigail',requestedStartsAt:'2026-10-06T06:00:00.000Z',requestedRevision:'2026-10-05T09:00:00.000Z' },
      { appointmentId:804,currentStaffId:11,canChangePractitioner:true,eligiblePractitioners:[staff[1]],status:'pending',clientName:'Client D',serviceName:'Toe Gel Only',staffName:'Abigail',requestedStartsAt:'2026-10-06T06:30:00.000Z',requestedRevision:'2026-10-05T09:00:00.000Z' },
      { appointmentId:805,canChangePractitioner:false,eligiblePractitioners:[],status:'pending',clientName:'Client E',serviceName:'Couples Massage',staffName:'Shiloh team',requestedStartsAt:'2026-10-06T07:00:00.000Z',requestedRevision:'2026-10-05T09:00:00.000Z' },
    ],
  }), dashboardClientScript()),
};
export const ReceptionTimeChangeAttention = {
  render: () => interactiveProductionSurface(renderDashboardPage({
    ...dashboardModel(),
    displayName: 'Christel',
    bookingRequests: [],
    rescheduleRequests: [
      { requestId: 901, appointmentId: 801, decisionOwner: 'reception', clientName: 'Client A', serviceName: 'Hot Stone Massage', staffName: 'Abigail', originalStartsAt: '2026-09-27T08:00:00.000Z', proposedStartsAt: '2026-09-30T08:00:00.000Z' },
    ],
  }), dashboardClientScript()),
};
export const DashboardActiveNoShow = { render: () => interactiveProductionSurface(renderDashboardPage(activeNoShowDashboardModel()), dashboardClientScript()) };
export const NavigationDrawerOpen = { render: () => workspaceNavigationOpenStory() };
export const CompactMenuNotificationsOn = { render: () => workspaceNavigationOpenStory('on') };
export const CompactMenuNotificationsOff = { render: () => workspaceNavigationOpenStory('off') };
export const CompactMenuNotificationsBlocked = { render: () => workspaceNavigationOpenStory('blocked') };
export const ClientAppointmentHistory = { render: () => productionSurface(renderClientDetailPageWithCommunications(clientModel(), { calendarNavigationAllowed: true, notificationActionAllowed: true })) };
export const MessagesAttention = { render: () => productionSurface(renderMessagesPage(messagesModel())) };
export const MessagesChangeDeliveryAttention = {
  render: () => productionSurface(renderMessagesPage({
    ...messagesModel(), selectedView:'attention', attention:[],
    changeAttention:[{ id:701,appointmentId:668,clientId:912,clientName:'Michelle Sardinha',
      label:'Appointment update',status:'uncertain',statusLabel:'Send status uncertain',
      updatedAt:'2026-09-27T07:00:00.000Z',
      nextAction:'Review the booking in My Shiloh. The phone-alert outcome is uncertain; app availability does not confirm that the client has read it.' }],
  })),
};
export const CompactAppointmentEditor = { render: () => editorStory() };
export const AppointmentAppAvailability = { render: () => editorStory(true) };
function appointmentRecoveryStory(kind) {
  const root = editorStory(true);
  window.setTimeout(() => {
    root.querySelector('[data-calendar-operation="manage-appointment"]').click();
    window.setTimeout(() => {
      const panel = root.querySelector('[data-calendar-management-panel]');
      const form = panel.querySelector('[data-panel-action="appointment:reassign"]');
      const status = document.createElement('p');
      status.dataset.calendarPanelStatus = 'true';
      panel.querySelector('.panel-head').after(status);
      const error = new Error(kind === 'mapping' || kind === 'restricted' ? 'The destination practitioner is not eligible for every booked service.' : kind === 'stale' ? 'This appointment changed.' : 'Workspace is temporarily unavailable.');
      error.code = kind === 'mapping' || kind === 'restricted' ? 'CALENDAR_OPERATION_SERVICE_MAPPING' : kind === 'stale' ? 'CALENDAR_OPERATION_STALE_REVISION' : '';
      error.status = kind === 'session' ? 401 : kind === 'temporary' ? 503 : 409;
      error.recovery = { kind: 'service_mapping', ...(kind === 'mapping' ? { serviceHref: '/calendar/services/901#service-practitioners' } : {}) };
      error.source = form;
      window.ShilohErrorRecovery.render(status, error, 'error');
    }, 0);
  }, 0);
  return root;
}
export const AppointmentServiceRecovery = { render: () => appointmentRecoveryStory('mapping') };
export const AppointmentRestrictedRecovery = { render: () => appointmentRecoveryStory('restricted') };
export const WorkspaceSessionRecovery = { render: () => appointmentRecoveryStory('session') };
export const WorkspaceStaleRecovery = { render: () => appointmentRecoveryStory('stale') };
export const WorkspaceTemporaryRecovery = { render: () => appointmentRecoveryStory('temporary') };

export const CreateBooking = {
  render: () => {
    const page = renderCalendarCreateBookingPage({
      options: {
        staff,
        services: [
          { id: 81, name: 'Quick Relief: Back & Neck (45 min)', durationMinutes: 45, staffIds: [11, 12] },
          { id: 82, name: 'Full Body Swedish', durationMinutes: 60, staffIds: [12, 13] },
        ],
      },
      prefill: { date: '2026-09-14', time: '10:30', staffId: 11 },
    });
    return interactiveProductionSurface(page, calendarCreateBookingClientScript());
  },
};

function bookingConflictRecoveryStory() {
  const page = renderCalendarCreateBookingPage({
    options: {
      staff,
      services: [
        { id: 91, name: 'Toe Gel Only', categoryName: 'Feet', durationMinutes: 30, staffIds: [12] },
      ],
    },
    prefill: { date: '2026-10-03', time: '08:00', staffId: 12 },
  });
  const root = document.createElement('div');
  root.innerHTML = productionSurface(page);
  const status = root.querySelector('[data-booking-status]');
  status.classList.add('error');
  status.textContent = '';
  const title = document.createElement('strong');
  title.className = 'recovery-title';
  title.textContent = 'This time overlaps another booking or blocked period.';
  const copy = document.createElement('p');
  copy.className = 'recovery-copy';
  copy.textContent = 'Nothing has been booked. Choose a time where the full treatment is free.';
  const detail = document.createElement('p');
  detail.className = 'recovery-detail';
  detail.textContent = 'Christel — Toe Gel Only\nRequested: 03/10/2026, 08:00 to 03/10/2026, 08:30\n\nThat time overlaps with:\n• Existing client booking — appointment, 03/10/2026 08:00–08:30\n\nPlease choose another start time.';
  const actions = document.createElement('div');
  actions.className = 'recovery-actions';
  ['Choose another time', 'Choose another date', 'Choose another practitioner', 'Report a problem'].forEach((label) => {
    const button = document.createElement('button');
    button.className = 'button secondary';
    button.type = 'button';
    button.textContent = label;
    actions.append(button);
  });
  status.append(title, copy, detail, actions);
  return root;
}

export const BookingConflictRecovery = { render: bookingConflictRecoveryStory };

function depositMessageRetryStory() {
  const page = renderCalendarCreateBookingPage({
    options: {
      staff,
      services: [
        { id: 93, name: 'Medi-Heel Pedicure (With Gel Toes) & Foot Massage', categoryName: 'Feet', durationMinutes: 60, staffIds: [12] },
      ],
    },
    prefill: { date: '2026-09-25', time: '08:00', staffId: 12 },
  });
  const root = document.createElement('div');
  root.innerHTML = productionSurface(page);
  const status = root.querySelector('[data-booking-status]');
  status.classList.remove('error', 'ready');
  status.classList.add('warn');
  status.textContent = 'BOOKING CREATED — DEPOSIT MESSAGE NOT SENT. Appointment #761 exists in Shiloh. Automatic retry is queued. Please contact the client manually about the required deposit in the meantime.';
  return root;
}

export const DepositMessageRetry = { render: depositMessageRetryStory };
export const ReceptionistPractitionerFirstBooking = {
  render: () => {
    const page = renderCalendarCreateBookingPage({
      options: {
        authority: { serviceScope: 'all_business:all_services', bookingFlow: 'practitioner_first' },
        staff,
        services: [
          { id: 81, name: 'Quick Relief: Back & Neck (45 min)', categoryName: 'Massage', durationMinutes: 45, staffIds: [11, 12] },
          { id: 82, name: 'Full Body Swedish', categoryName: 'Massage', durationMinutes: 60, staffIds: [12, 13] },
          { id: 83, name: 'Medi-Heel Pedicure & Foot Massage', categoryName: 'Feet', durationMinutes: 60, staffIds: [13] },
          { id: 84, name: 'Hot Stone Massage', categoryName: 'Massage', durationMinutes: 75, staffIds: [11, 12] },
        ],
      },
      prefill: { date: '2026-09-14', time: '10:30' },
    });
    return interactiveProductionSurface(page, calendarCreateBookingClientScript());
  },
};
export const NormalAdminPractitionerFirstBooking = {
  render: () => {
    const page = renderCalendarCreateBookingPage({
      options: {
        authority: { serviceScope: 'all_business:all_services', bookingFlow: 'practitioner_first' },
        staff,
        services: [
          { id: 81, name: 'Quick Relief: Back & Neck (45 min)', categoryName: 'Massage', durationMinutes: 45, staffIds: [11, 12] },
          { id: 82, name: 'Full Body Swedish', categoryName: 'Massage', durationMinutes: 60, staffIds: [12, 13] },
          { id: 83, name: 'Medi-Heel Pedicure & Foot Massage', categoryName: 'Feet', durationMinutes: 60, staffIds: [13] },
          { id: 84, name: 'Hot Stone Massage', categoryName: 'Massage', durationMinutes: 75, staffIds: [11, 12] },
        ],
      },
      prefill: { date: '2026-09-14', time: '10:30' },
    });
    return interactiveProductionSurface(page, calendarCreateBookingClientScript());
  },
};
const couplesBookingOptions = {
  groupService: { id: 90, name: 'Couples Massage', externalSource: 'shiloh_special', externalId: 'couples-massage-v1' },
  services: [
    { id: 81, name: 'Quick Relief: Back & Neck (45 min)', categoryName: 'Massage', durationMinutes: 45, price: 520, variablePrice: false, staffIds: [11, 12] },
    { id: 82, name: 'Full Body Swedish', categoryName: 'Massage', durationMinutes: 60, price: 720, variablePrice: false, staffIds: [12, 13] },
    { id: 84, name: 'Hot Stone Massage', categoryName: 'Massage', durationMinutes: 75, price: 850, variablePrice: false, staffIds: [11, 12] },
  ],
  staff,
};

function couplesBookingStory(canApplyDiscount) {
  const page = renderCalendarCouplesBookingPage({
    options: {
      ...couplesBookingOptions,
      authority: { bookingFlow: 'practitioner_first', canApplyDiscount },
    },
    prefill: { date: '2026-09-14', time: '10:30' },
  });
  return interactiveProductionSurface(page, calendarCouplesBookingClientScript());
}

export const CouplesBookingTreatmentsAndDiscount = {
  render: () => couplesBookingStory(true),
};

export const CouplesBookingWithoutDiscountAuthority = {
  render: () => couplesBookingStory(false),
};

export const GroupBookingMultipleGuestsAndDiscount = {
  render: () => interactiveProductionSurface(
    renderCalendarGroupBookingPage({
      options: {
        services: couplesBookingOptions.services,
        staff,
        authority: { bookingFlow: 'practitioner_first', canApplyDiscount: true },
      },
      prefill: { date: '2026-09-14', time: '10:30' },
    }),
    calendarGroupBookingClientScript()
  ),
};

export const MultiServiceClientBooking = {
  render: () => interactiveProductionSurface(
    renderCalendarMultiServiceBookingPage({
      options: {
        services: couplesBookingOptions.services,
        staff,
        authority: { bookingFlow: 'practitioner_first' },
      },
      prefill: { date: '2026-09-19' },
    }),
    calendarMultiServiceBookingClientScript()
  ),
};

export const LinkedBookingPayment = {
  render: () => productionSurface(renderCalendarPaymentPage({ model: {
    subject: { appointmentId: 701, groupId: 55 },
    payment: {
      state: 'partially_paid', amountDue: '1240.00', paid: '500.00', refunded: '0.00', netPaid: '500.00', outstanding: '740.00',
      requests: [{ amount:'740.00', state:'link_issued', provider_payment_url:'https://pay.example.test/secure', created_at:'2026-09-14T09:00:00.000Z' }],
      entries: [{ entry_type:'payment', amount:'500.00', method:'card_machine', evidence_kind:'authorized_manual', created_at:'2026-09-14T08:55:00.000Z' }],
    },
    authority: { canCollect:true, canRefund:true, ozowConfigured:true },
  } })),
};

export const BookingDepositAwaiting = {
  render: () => productionSurface(renderCalendarPaymentPage({ model: {
    subject: { appointmentId: 812, groupId: null, clientName:'Naledi', clientMobile:'27821234567', crmV2ClientId:91 },
    payment: {
      state:'unpaid', amountDue:'650.00', paid:'0.00', refunded:'0.00', netPaid:'0.00', rewardsApplied:'0.00', outstanding:'650.00',
      requests:[{ amount:'325.00', state:'link_issued', purpose:'deposit', provider_payment_url:'https://pay.example.test/deposit', created_at:'2026-09-23T17:00:00.000Z' }],
      entries:[],
    },
    deposit: {
      applicable:true,
      policy:{ rateBasisPoints:5000, freeNoticeHours:48, partialNoticeHours:24, partialForfeitBasisPoints:5000, lateForfeitBasisPoints:10000 },
      requirement:{ state:'awaiting', required_amount:'325.00', net_paid:'0.00', policy_version:'2026-09-25-v3', rate_basis_points:5000 },
      events:[],
    },
    rewards:{ balance:'75.00', unlocked:true, unlockThreshold:'100.00' },
    authority:{ canCollect:true, canRefund:true, ozowConfigured:true },
  } })),
};

export const MarietjieDepositExempt = {
  render: () => productionSurface(renderCalendarPaymentPage({ model: {
    subject: { appointmentId: 813, groupId: null, clientName:'Evelyn', clientMobile:'27831234567', crmV2ClientId:92 },
    payment: {
      state:'unpaid', amountDue:'490.00', paid:'0.00', refunded:'0.00', netPaid:'0.00', rewardsApplied:'0.00', outstanding:'490.00',
      requests:[],
      entries:[],
    },
    deposit: {
      applicable:true,
      requirement:{ state:'exempt', required_amount:'0.00', net_paid:'0.00', policy_version:'2026-09-25-v3' },
      events:[],
    },
    rewards:null,
    authority:{ canCollect:true, canRefund:true, ozowConfigured:true },
  } })),
};

export const CancelledBookingPaymentReview = {
  render: () => productionSurface(renderCalendarPaymentPage({ model: {
    subject: { appointmentId: 759, groupId: null, clientName:'Jean-Pierre Botha', clientMobile:'27716742646', crmV2ClientId:49, final:true },
    payment: {
      state:'partially_paid', amountDue:'250.00', paid:'125.00', refunded:'0.00', netPaid:'125.00', rewardsApplied:'0.00', outstanding:'125.00',
      requests:[{ id:8, amount:'125.00', state:'paid', purpose:'deposit', provider_payment_url:'https://pay.ozow.com/old', created_at:'2026-09-24T18:52:00.000Z' }],
      entries:[{ entry_type:'payment', amount:'125.00', method:'ozow', created_at:'2026-09-24T18:52:00.000Z' }],
    },
    deposit: {
      applicable:true,
      policy:{ rateBasisPoints:5000, freeNoticeHours:48, partialNoticeHours:24, partialForfeitBasisPoints:5000, lateForfeitBasisPoints:10000 },
      requirement:{ state:'awaiting', required_amount:'125.00', net_paid:'0.00', policy_version:'2026-09-25-v3', rate_basis_points:5000 },
      events:[{ event_type:'cancelled', policy_forfeit_amount:'0.00', policy_creditable_amount:'125.00' }],
    },
    rewards:null,
    paymentReview:{ kind:'cancelled_booking_payment_received', createdAt:'2026-09-24T18:52:00.000Z', metadata:{ reviewRequired:true, automaticRefundIssued:false } },
    authority:{ canCollect:true, canRefund:true, ozowConfigured:true },
  } })),
};

export const OldDeviceRemoval = {
  render: () => productionSurface(renderPasskeyManagePage({ credentials: [
    { id: 1, label: 'JP current phone', current: true, createdAt: '2026-09-29T05:03:00Z' },
    { id: 2, label: 'JP old Windows PC', createdAt: '2026-09-16T11:32:00Z' },
    { id: 3, label: 'JP old Android', createdAt: '2026-09-14T15:17:00Z' },
    { id: 4, label: 'JP old iPhone', createdAt: '2026-09-14T04:42:00Z' },
    { id: 5, label: 'Unnamed old device', createdAt: '2026-09-13T15:36:00Z' },
  ] })),
};
export const PhonePasskeyDevices = {
  render: () => productionSurface(renderPasskeyManagePage({
    credentials: [
      { id: 1, createdAt: '2026-09-13T15:05:00.000Z', lastUsedAt: '2026-09-13T15:42:00.000Z', backedUp: true },
      { id: 2, createdAt: '2026-09-12T06:30:00.000Z', lastUsedAt: null, backedUp: true },
    ],
  })),
};
export const ClinicAndAssistantHours = {
  render: () => productionSurface(renderClinicHoursPage({
    authority: { displayName: 'Christel' },
    location: { id: 1, name: 'Shiloh', timezone: 'Africa/Johannesburg' },
    revision: 'a'.repeat(64),
    assistantRevision: 'b'.repeat(64),
    days: [1,2,3,4,5,6].map(dayOfWeek => ({ dayOfWeek, name: ['','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dayOfWeek], open:true, startsLocal:'08:00', endsLocal:dayOfWeek===6?'14:00':'18:00' })).concat({ dayOfWeek:0, name:'Sunday', open:false, permanent:true }),
    assistantDays: [1,2,3,4,5,6].map(dayOfWeek => ({ dayOfWeek, name: ['','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dayOfWeek], open:true, startsLocal:'09:00', endsLocal:dayOfWeek===6?'13:00':'16:30' })).concat({ dayOfWeek:0, name:'Sunday', open:false, permanent:true }),
    holidays: [{ exceptionDate:'2026-09-24', holidayName:'Heritage Day', clinicExceptionType:null, assistantExceptionType:null, decisionNeeded:true }],
    exceptions: [],
  })),
};
export const DeviceManagementDialogs = {
  render: deviceManagementDialogStory,
};
export const PwaIconOpticalScale = { render: pwaIconStory };
export const IosInstallGuidance = { render: iosInstallGuidanceStory };


const depositReviewItems = [{
  accountId: 901, appointmentId: 901, outstanding: '350.00', state: 'partial', hasLink: true,
  members: [
    { appointmentId: 901, clientName: 'Synthetic Aloe', serviceName: 'Relaxation massage', startsAt: '2026-10-08T10:00:00Z', staffNames: ['Practitioner'] },
    { appointmentId: 902, clientName: 'Synthetic Fynbos', serviceName: 'Deep tissue massage', startsAt: '2026-10-08T10:00:00Z', staffNames: ['Practitioner Two'] },
  ],
}, {
  accountId: 903, appointmentId: 903, outstanding: null, state: 'review', hasLink: false,
  members: [{ appointmentId: 903, clientName: 'Synthetic Protea', serviceName: 'Facial', startsAt: '2026-10-09T10:00:00Z', staffNames: ['Practitioner'] }],
}];
function depositStory(queue) {
  return productionSurface(renderDashboardPage({ ...dashboardModel(), displayName: 'Synthetic owner', appointments: [], teamGroups: [], carryOver: [], awaitingFinalization: [], recentActivity: [], communications: null, depositQueue: queue }));
}
export const DashboardAwaitingDeposits = { render: () => depositStory({ items: depositReviewItems }) };
export const DashboardDepositsEmpty = { render: () => depositStory({ items: [] }) };
export const DashboardDepositsLoading = { render: () => depositStory({ loading: true }) };
export const DashboardDepositsUnavailable = { render: () => depositStory({ unavailable: true }) };
export const DashboardDepositsRestricted = { render: () => depositStory(null) };

// Synthetic, production-backed refresh confirmation for Phone/Desktop review.
export const CompactRefreshConfirmation = {
  render: () => {
    const { confirmationMarkup, confirmationStyles } = confirmationPresentation;
    const root = document.createElement('div');
    root.innerHTML = `<style>body{font-family:Inter,system-ui,sans-serif;background:#f4f3ed}${confirmationStyles()}</style><main><h1>Workspace</h1><button type="button" data-refresh-preview>Refresh Workspace</button></main>${confirmationMarkup()}`;
    const dialog = root.querySelector('dialog');
    dialog.classList.add('shiloh-confirm--refresh');
    root.querySelector('[data-shiloh-confirm-title]').textContent = 'Refresh Workspace?';
    root.querySelector('[data-shiloh-confirm-copy]').textContent = 'This reloads the current page. Unsaved changes will be lost.';
    const cancel = root.querySelector('[data-shiloh-confirm-cancel]');
    cancel.textContent = 'Keep working';
    const action = root.querySelector('[data-shiloh-confirm-action]');
    action.textContent = 'Refresh';
    action.className = 'button primary';
    root.querySelector('[data-refresh-preview]').onclick = () => { dialog.showModal(); cancel.focus(); };
    cancel.onclick = action.onclick = () => dialog.close();
    setTimeout(() => { if (dialog.isConnected) { dialog.showModal(); cancel.focus(); } }, 0);
    return root;
  },
};

export const FocusedWorkspaceDashboard = {
  render: () => productionSurface(renderDashboardPage({ ...dashboardModel(), displayName: 'Synthetic owner', appointments: [], teamGroups: [], carryOver: [], awaitingFinalization: [], recentActivity: [],
    communications: { attention: [{ client: { name: 'Synthetic legacy client' }, appointment: { id: 901 } }] },
    welcomeVoucherCampaign: { vouchersUnlocked: 10, vouchersRedeemed: 4, discountsGiven: 400 }, depositQueue: { items: depositReviewItems },
  })),
};
