import dashboardPresentation from '../src/presentation/workspaceDashboardUx.js';
import clientPresentation from '../src/presentation/workspaceCommunicationEvidenceUx.js';
import messagesPresentation from '../src/presentation/workspaceMessagesUx.js';
import editorPresentation from '../src/presentation/calendarAppointmentCompactEditorUx.js';
import createBookingPresentation from '../src/presentation/calendarCreateBookingUx.js';
import calendarPresentation from '../src/presentation/calendarReadOnlyUx.js';

const { renderDashboardPage } = dashboardPresentation;
const { renderClientDetailPageWithCommunications } = clientPresentation;
const { renderMessagesPage } = messagesPresentation;
const { calendarAppointmentCompactEditorClientScript } = editorPresentation;
const { renderCalendarCreateBookingPage } = createBookingPresentation;
const { renderCalendarPage } = calendarPresentation;

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

function monthCalendarModel() {
  const dateKeys = [];
  for (let cursor = new Date('2026-08-31T12:00:00Z'); cursor <= new Date('2026-10-03T12:00:00Z'); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    if (cursor.getUTCDay() !== 0) dateKeys.push(cursor.toISOString().slice(0, 10));
  }
  const heritageAppointment = {
    id: 680,
    kind: 'appointment',
    canonical: true,
    revision: 'heritage-revision',
    status: 'confirmed',
    clientName: 'Month view client',
    serviceName: 'Full Body Swedish',
    startsAt: '2026-09-24T08:00:00.000Z',
    endsAt: '2026-09-24T09:00:00.000Z',
    staffIds: [12],
    staff: [{ staffId: 12, nameSnapshot: 'Christel' }],
    serviceContexts: [{ serviceId: 82, categoryName: 'Massage' }],
  };
  return {
    view: 'month',
    dateKey: '2026-09-14',
    period: {
      startKey: '2026-09-01',
      endKey: '2026-10-01',
      displayStartKey: '2026-08-31',
      displayEndKey: '2026-10-05',
      previousAnchor: '2026-08-01',
      nextAnchor: '2026-10-01',
      dateKeys,
    },
    selectedStaffId: null,
    visibleStaffIds: staff.map(person => person.id),
    visibleStaffSelectionExplicit: true,
    permittedStaff: staff,
    publicHolidays: [{ date: '2026-09-24', name: 'Heritage Day', observed: false, countryCode: 'ZA' }],
    timeline: {
      staff,
      workingWindows: [],
      scheduleExceptions: [],
      recurringClosures: [],
      closures: [],
      appointments: [heritageAppointment],
      blocks: [],
      leave: [],
      externalBusy: [],
      events: [heritageAppointment],
    },
    mutationCapability: { enabled: false, operations: [] },
  };
}

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

export default {
  title: 'Workspace/Production surfaces',
  parameters: { layout: 'fullscreen' },
};

export const DashboardOperational = { render: () => productionSurface(renderDashboardPage(dashboardModel())) };
export const ClientAppointmentHistory = { render: () => productionSurface(renderClientDetailPageWithCommunications(clientModel(), { calendarNavigationAllowed: true, notificationActionAllowed: true })) };
export const MessagesAttention = { render: () => productionSurface(renderMessagesPage(messagesModel())) };
export const CompactAppointmentEditor = { render: editorStory };
export const MonthWithSouthAfricanHoliday = { render: () => productionSurface(renderCalendarPage(monthCalendarModel())) };
export const CreateBooking = {
  render: () => productionSurface(renderCalendarCreateBookingPage({
    options: {
      staff,
      services: [
        { id: 81, name: 'Quick Relief: Back & Neck (45 min)', durationMinutes: 45, staffIds: [11, 12] },
        { id: 82, name: 'Full Body Swedish', durationMinutes: 60, staffIds: [12, 13] },
      ],
    },
    prefill: { date: '2026-09-14', time: '10:30', staffId: 11 },
  })),
};
