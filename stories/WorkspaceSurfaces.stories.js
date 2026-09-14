import dashboardPresentation from '../src/presentation/workspaceDashboardUx.js';
import clientPresentation from '../src/presentation/workspaceCommunicationEvidenceUx.js';
import messagesPresentation from '../src/presentation/workspaceMessagesUx.js';
import editorPresentation from '../src/presentation/calendarAppointmentCompactEditorUx.js';
import createBookingPresentation from '../src/presentation/calendarCreateBookingUx.js';
import couplesBookingPresentation from '../src/presentation/calendarCouplesBookingUx.js';
import groupBookingPresentation from '../src/presentation/calendarGroupBookingUx.js';
import passkeyPresentation from '../src/presentation/staffPasskeyUx.js';
import pwaPresentation from '../src/presentation/workspacePwa.js';

const { renderDashboardPage } = dashboardPresentation;
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
    communications: [{ intent: 'booking_confirmation', label: 'Booking confirmation', statusLabel: 'Read on WhatsApp', occurredAt: '2026-09-10T11:56:00.000Z', appointmentId: 667, templateName: 'shiloh_booking_confirmation_v2' }],
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
      canRecover: true,
      actionLabel: 'Re-send confirmation',
      appointment: { id: 668, serviceName: 'Full Body Swedish', startsAt: '2026-09-12T08:00:00.000Z' },
      client: { id: 912, name: 'Michelle Sardinha', mobileLast4: '4567' },
      confirmation: {
        statusLabel: 'Delivery failed',
        deliveryExplanation: 'WhatsApp could not deliver this message to the recipient.',
      },
      recoveryExplanation: 'Retry is available through Shiloh’s existing booking-confirmation channel.',
    }],
    activity: [
      { clientName: 'Rozel Janse van Rensburg', mobileLast4: '2241', label: 'Booking confirmation', appointmentId: 667, occurredAt: '2026-09-10T11:56:00.000Z', status: 'read', statusLabel: 'Read on WhatsApp' },
      { clientName: 'Naomi Jacobs', mobileLast4: '8172', label: 'Appointment reminder', appointmentId: 669, occurredAt: '2026-09-11T07:15:00.000Z', status: 'delivered', statusLabel: 'Delivered on WhatsApp' },
    ],
  };
}

function editorStory() {
  const root = document.createElement('div');
  root.className = 'appointment-editor-story';
  root.innerHTML = `<style>:root{--ink:#20322b;--muted:#56685f;--panel:#fffdf9;--line:#dce3dd;--line-strong:#c8d3cb;--leaf-soft:#e7eee9;--leaf-deep:#294c3c}*{box-sizing:border-box}body{margin:0;background:#f4f3ed;color:var(--ink);font-family:Inter,system-ui,sans-serif}.appointment-editor-story{min-height:100vh}.management-panel{display:block;border:0;padding:0;background:transparent;width:100%;height:100vh}.management-card{height:100%;width:min(520px,100%);margin-left:auto;overflow:auto;background:var(--panel);padding:22px;box-shadow:-12px 0 40px rgba(20,45,35,.2)}.panel-head{display:flex;justify-content:space-between;gap:12px;align-items:start;border-bottom:1px solid var(--line);padding-bottom:14px}.panel-head h2{margin:3px 0;font-size:1.25rem}.panel-close{border:1px solid var(--line);background:#fff;border-radius:999px;width:44px;height:44px}.panel-summary{margin:16px 0;padding:12px;border-radius:12px;background:var(--leaf-soft);display:grid;gap:4px}.panel-actions{display:grid;gap:14px}.panel-action{display:none}.panel-action.visible{display:grid;gap:9px}.panel-action label{display:grid;gap:5px;font-size:.76rem;font-weight:750}.panel-action input,.panel-action select,.panel-action textarea{width:100%;min-height:44px;border:1px solid var(--line-strong);border-radius:9px;padding:9px;font:inherit;background:#fff}.panel-action button{min-height:44px;border:0;border-radius:9px;padding:10px 13px;background:var(--leaf-deep);color:#fff;font:inherit;font-weight:800}.panel-action.danger button{background:#843f35}.eyebrow{font-size:.66rem;text-transform:uppercase;letter-spacing:.11em;font-weight:850;color:var(--muted)}h3,p{margin:0}.end-time-state,.treatment-price-current{padding:11px;border-radius:10px;background:var(--leaf-soft);display:grid;gap:4px}@media(max-width:700px){.management-card{height:min(92vh,780px);margin-top:8vh;border-radius:18px 18px 0 0}}</style>
    <div class="management-panel" data-calendar-management-panel><section class="management-card"><header class="panel-head"><div><span class="eyebrow">Appointment</span><h2>Appointment #667</h2></div><button class="panel-close" type="button" aria-label="Close">×</button></header><div class="panel-summary"><strong data-panel-client>Rozel Janse van Rensburg</strong><span data-panel-service>Sports Massage Full Body</span><span data-panel-practitioners>Abigail</span><span data-panel-time>12 September at 08:00</span><span>Completed</span></div><form class="panel-action visible appointment-notes-manage" data-appointment-notes-form><span class="eyebrow">Internal notes</span><textarea aria-label="Internal notes" placeholder="Internal context for staff only"></textarea><span class="panel-hint">Internal only — not included in client confirmations or reminders.</span><button type="button">Save notes</button></form><div class="panel-actions"><form class="panel-action visible" data-treatment-price-form><span class="eyebrow">Treatment &amp; price</span><h3>Correct this appointment</h3><div class="treatment-price-current"><strong>Sports Massage Full Body</strong><span>Charged: R750.00</span></div><label>Treatment<select><option>Sports Massage Full Body</option></select></label><label>Charged price (R)<input value="750.00"></label><button type="button">Save treatment &amp; price</button></form><form class="panel-action visible" data-end-time-form><span class="eyebrow">Appointment timing</span><h3>Adjust end time</h3><div class="end-time-state"><strong>Appointment #667</strong><span>Current end: 10:00</span></div><label>Effective end time<input type="datetime-local" value="2026-09-12T10:00"></label><button type="button">Save end time</button></form><form class="panel-action visible" data-panel-action="appointment:reschedule"><label>Date<input type="date" value="2026-09-12"></label><label>Start time<input type="time" value="08:00"></label><button type="button">Save new time</button></form><form class="panel-action visible" data-panel-action="appointment:reassign"><label>Practitioner<select><option>Abigail</option></select></label><button type="button">Reassign</button></form><form class="panel-action visible danger" data-panel-action="appointment:cancel"><label><input type="checkbox"> I confirm this exact appointment should be cancelled.</label><button type="button">Cancel appointment</button></form></div></section></div>`;
  window.setTimeout(() => {
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

export const DashboardOperational = { render: () => productionSurface(renderDashboardPage(dashboardModel())) };
export const ClientAppointmentHistory = { render: () => productionSurface(renderClientDetailPageWithCommunications(clientModel(), { calendarNavigationAllowed: true, notificationActionAllowed: true })) };
export const MessagesAttention = { render: () => productionSurface(renderMessagesPage(messagesModel())) };
export const CompactAppointmentEditor = { render: editorStory };
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

export const PhonePasskeyDevices = {
  render: () => productionSurface(renderPasskeyManagePage({
    credentials: [
      { id: 1, createdAt: '2026-09-13T15:05:00.000Z', lastUsedAt: '2026-09-13T15:42:00.000Z', backedUp: true },
      { id: 2, createdAt: '2026-09-12T06:30:00.000Z', lastUsedAt: null, backedUp: true },
    ],
  })),
};
export const DeviceManagementDialogs = {
  render: deviceManagementDialogStory,
};
export const PwaIconOpticalScale = { render: pwaIconStory };
export const IosInstallGuidance = { render: iosInstallGuidanceStory };
