import primitives from '../src/presentation/shilohUiPrimitives.js';
import calendarReference from '../src/presentation/calendarUxReference.js';
import eventVisuals from '../src/presentation/calendarEventVisuals.js';
import serviceVisuals from '../src/presentation/calendarServiceFamilyVisuals.js';

const {
  renderButton,
  renderIconButton,
  renderChip,
  renderBadge,
} = primitives;
const { calendarReferenceUxCss } = calendarReference;
const { calendarEventStatusLabel, calendarEventVisualAttributes, calendarEventToneCss } = eventVisuals;
const { renderServiceFamilyIcon, serviceFamilyAccentCss } = serviceVisuals;

const frame = (body, width = '960px') => `
  <style>
    ${calendarReferenceUxCss()}
    ${serviceFamilyAccentCss()}
    ${calendarEventToneCss()}
    body{margin:0;background:#f4f3ed;color:#20322b;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
    .calendar-reference{box-sizing:border-box;width:${width};max-width:100%;padding:20px;display:grid;gap:18px;background:#fffdf9;border:1px solid var(--shiloh-border);border-radius:var(--shiloh-radius-lg);}
    .calendar-reference__toolbar,.calendar-reference__row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
    .calendar-reference__toolbar{justify-content:space-between;padding:10px;border:1px solid var(--shiloh-border);border-radius:var(--shiloh-radius-lg);background:var(--shiloh-surface);}
    .calendar-reference__group{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
    .calendar-reference__label{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--shiloh-ink-muted);}
    .calendar-reference__card{display:grid;gap:8px;padding:14px;border:1px solid var(--shiloh-border);border-left:4px solid var(--shiloh-focus);border-radius:var(--shiloh-radius-md);background:var(--shiloh-surface);}
    .calendar-reference__card strong{font-size:15px;}
    .calendar-reference__card small{color:var(--shiloh-ink-muted);}
    .calendar-language{display:grid;gap:14px;}
    .calendar-language__intro{display:grid;gap:4px;}
    .calendar-language__intro h2,.calendar-language__intro p{margin:0;}
    .calendar-language__intro p{color:var(--shiloh-ink-muted);font-size:14px;line-height:1.45;}
    .calendar-language__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}
    .calendar-language__sample{display:grid;gap:5px;min-width:0;}
    .calendar-language__sample>span{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--shiloh-ink-muted);}
    .calendar-language .event-card{min-width:0;padding:10px 11px;border:1px solid var(--shiloh-border);border-left:4px solid var(--shiloh-focus);border-radius:var(--shiloh-radius-md);background:#fff;box-shadow:var(--shiloh-shadow-soft);}
    .calendar-language .event-card-top{display:flex;align-items:center;justify-content:space-between;gap:8px;}
    .calendar-language .event-time,.calendar-language .kind-pill{font-size:11px;font-weight:800;color:var(--shiloh-ink-muted);}
    .calendar-language .kind-pill{text-transform:uppercase;letter-spacing:.05em;}
    .calendar-language .event-card h4{margin:4px 0 2px;font-size:15px;}
    .calendar-language .event-client-mobile,.calendar-language .event-meta{margin:0;color:var(--shiloh-ink-muted);font-size:12px;line-height:1.4;}
    .calendar-language .event-meta{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:6px;}
    .calendar-language .event-practitioners,.calendar-language .event-service-context{display:inline-flex;align-items:center;gap:5px;}
    .calendar-language .event-practitioner-compact,.calendar-language .appointment-reference,.calendar-language .provenance{display:none;}
    .calendar-language .status-dot{width:7px;height:7px;border-radius:999px;background:var(--shiloh-focus);}
    .calendar-language .service-family-icon{width:17px;height:17px;flex:0 0 17px;}
    .calendar-language .event-detail-separator{color:var(--shiloh-ink-muted);}
    .calendar-language .event-card-actions{display:none;}
    @media(max-width:700px){.calendar-reference{padding:12px}.calendar-reference__toolbar{display:grid;gap:10px}.calendar-reference__group{width:100%}.calendar-reference__group .shiloh-button{flex:1 1 auto}.calendar-reference__card{min-height:44px}.calendar-language__grid{grid-template-columns:1fr}.calendar-language .event-card{min-height:74px}}
  </style>
  <div class="calendar-reference">${body}</div>`;

export default {
  title: 'Calendar/Reference implementation',
  parameters: { layout: 'centered' },
};

export const DesktopToolbarAndIdentity = {
  render: () => frame(`
    <div class="calendar-reference__toolbar">
      <div class="calendar-reference__group">
        ${renderIconButton({ label: 'Previous period', icon: 'previous', density: 'compact' })}
        ${renderButton({ label: 'Today', icon: 'calendar', density: 'compact' })}
        ${renderIconButton({ label: 'Next period', icon: 'next', density: 'compact' })}
      </div>
      <div class="calendar-reference__group">
        ${renderChip({ label: 'Week', selected: true, density: 'compact' })}
        ${renderChip({ label: 'Month', density: 'compact' })}
      </div>
      <div class="calendar-reference__group">
        ${renderChip({ label: 'All practitioners', icon: 'people', density: 'compact' })}
      </div>
    </div>
    <div class="calendar-reference__row">
      <span class="calendar-reference__label">Practitioner identity</span>
      ${renderChip({ label: 'Practitioner A', icon: 'person', selected: true, density: 'compact' })}
      ${renderChip({ label: 'Practitioner B', icon: 'person', density: 'compact' })}
    </div>
    <div class="calendar-reference__row">
      <span class="calendar-reference__label">Appointment state</span>
      ${renderBadge({ label: 'Confirmed', tone: 'success', icon: 'confirm' })}
      ${renderBadge({ label: 'Needs attention', tone: 'warning', icon: 'alert' })}
      ${renderBadge({ label: 'Cancelled', tone: 'danger', icon: 'alert' })}
    </div>
    <article class="calendar-reference__card">
      <small>09:00–10:00</small><strong>Client name</strong><small>Service • Practitioner A</small>
      <div>${renderBadge({ label: 'Confirmed', tone: 'success', icon: 'confirm' })}</div>
    </article>
  `),
};

export const PhoneTouchToolbar = {
  render: () => frame(`
    <div class="calendar-reference__toolbar">
      <div class="calendar-reference__group">
        ${renderIconButton({ label: 'Previous period', icon: 'previous', density: 'touch' })}
        ${renderButton({ label: 'Today', icon: 'calendar', density: 'touch' })}
        ${renderIconButton({ label: 'Next period', icon: 'next', density: 'touch' })}
      </div>
      <div class="calendar-reference__group">
        ${renderChip({ label: 'Week', selected: true, density: 'touch' })}
        ${renderChip({ label: 'Month', density: 'touch' })}
      </div>
      <div class="calendar-reference__group">
        ${renderChip({ label: 'Practitioner A', icon: 'person', selected: true, density: 'touch' })}
      </div>
    </div>
    <article class="calendar-reference__card">
      <small>09:00</small><strong>Client name</strong><small>Treatment</small>
      <div>${renderBadge({ label: 'Confirmed', tone: 'success' })}</div>
    </article>
  `, '390px'),
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

const languageItems = [
  {
    label: 'Scheduled', id: 9201, kind: 'appointment', status: 'confirmed', clientName: 'Tanya',
    serviceName: 'Full Body Swedish', serviceContexts: [{ categoryName: 'Massage' }],
    startsAt: '2026-09-12T07:00:00.000Z', endsAt: '2026-09-12T08:00:00.000Z', staffIds: [1],
  },
  {
    label: 'Needs attention', id: 9202, kind: 'appointment', status: 'scheduled', bookingRequestState: 'pending', clientName: 'Lerato',
    serviceName: 'Hydrate & Plump Facial', serviceContexts: [{ categoryName: 'Facials' }],
    startsAt: '2026-09-12T08:30:00.000Z', endsAt: '2026-09-12T09:30:00.000Z', staffIds: [2],
  },
  {
    label: 'Completed', id: 9203, kind: 'appointment', status: 'completed', clientName: 'Melissa',
    serviceName: 'Medi-Heel Pedicure', serviceContexts: [{ categoryName: 'Pedicures & Foot Care' }],
    startsAt: '2026-09-12T10:00:00.000Z', endsAt: '2026-09-12T11:00:00.000Z', staffIds: [1],
  },
  {
    label: 'No-show', id: 9204, kind: 'appointment', status: 'no_show', clientName: 'Sophie',
    serviceName: 'Ozone & Far Infrared Therapy', serviceContexts: [{ categoryName: 'Ozone & Far Infrared' }],
    startsAt: '2026-09-12T11:30:00.000Z', endsAt: '2026-09-12T12:30:00.000Z', staffIds: [2],
  },
  {
    label: 'Beauty treatment icon', id: 9205, kind: 'appointment', status: 'scheduled', clientName: 'Clare',
    serviceName: 'Permanent Makeup - Brows', serviceContexts: [{ categoryName: 'Permanent Makeup' }],
    startsAt: '2026-09-12T13:00:00.000Z', endsAt: '2026-09-12T14:00:00.000Z', staffIds: [1],
  },
  {
    label: 'Blocked time', id: 9206, kind: 'calendar_block', blockType: 'admin', title: 'Admin / no bookings',
    startsAt: '2026-09-12T14:30:00.000Z', endsAt: '2026-09-12T15:30:00.000Z', staffIds: [2],
  },
  {
    label: 'Staff leave', id: 9207, kind: 'operational_leave', reason: 'Annual leave',
    date: '2026-09-12', allDay: true, staffIds: [1],
  },
];

const practitionerNames = new Map([[1, 'Abigail'], [2, 'Christel']]);

const languageCard = (item) => {
  const statusLabel = calendarEventStatusLabel(item);
  const kindLabel = statusLabel
    || (item.kind === 'calendar_block' ? 'Block time' : item.kind.includes('leave') ? 'Leave' : 'Appointment');
  const title = item.kind === 'appointment' ? item.clientName : item.title || item.reason || kindLabel;
  const serviceIcons = (item.serviceContexts || []).map((context) => renderServiceFamilyIcon(context)).join('');
  const service = item.serviceName
    ? `<span class="event-service-context">${serviceIcons}<span>${item.serviceName}</span></span>`
    : '';
  const people = (item.staffIds || []).map((id) => practitionerNames.get(id)).filter(Boolean).join(' + ');
  const time = item.allDay ? 'All day' : `${item.startsAt.slice(11, 16)}–${item.endsAt.slice(11, 16)}`;
  return `<article class="event-card" data-kind="${item.kind}"${calendarEventVisualAttributes(item)}>
    <div class="event-card-top"><span class="event-time">${time}</span><span class="kind-pill">${kindLabel}</span></div>
    <h4>${title}</h4>
    <p class="event-meta">${service}${service && people ? '<span class="event-detail-separator" aria-hidden="true">•</span>' : ''}${people ? `<span class="event-practitioners"><span class="status-dot" aria-hidden="true"></span>${people}</span>` : ''}</p>
  </article>`;
};

const colourAndTreatmentLanguage = (width) => frame(`
  <section class="calendar-language" aria-labelledby="calendar-language-title">
    <div class="calendar-language__intro">
      <span class="calendar-reference__label">Shiloh calendar language</span>
      <h2 id="calendar-language-title">Treatment colour, status clarity</h2>
      <p>The card tint and existing outline icon communicate the treatment family. The labelled badge and right border communicate status, so neither meaning depends on colour alone.</p>
    </div>
    <div class="calendar-language__grid">
      ${languageItems.map((item) => `<div class="calendar-language__sample"><span>${item.label}</span>${languageCard(item)}</div>`).join('')}
    </div>
  </section>
`, width);

export const ColourAndTreatmentLanguage = {
  render: () => colourAndTreatmentLanguage('960px'),
};

export const ColourAndTreatmentLanguagePhone = {
  render: () => colourAndTreatmentLanguage('390px'),
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};


const monthReferenceDays = [
  ['2026-09-14', 14], ['2026-09-15', 15], ['2026-09-16', 16], ['2026-09-17', 17], ['2026-09-18', 18], ['2026-09-19', 19],
  ['2026-09-21', 21], ['2026-09-22', 22], ['2026-09-23', 23], ['2026-09-24', 24], ['2026-09-25', 25], ['2026-09-26', 26],
];

const monthReferenceCell = ([date, day]) => {
  const holiday = date === '2026-09-24' ? 'Heritage Day' : '';
  const appointments = date === '2026-09-24'
    ? [{ time: '10:00', client: 'Month view client' }, { time: '13:30', client: 'Second client' }]
    : date === '2026-09-18'
      ? [{ time: '09:00', client: 'Friday client' }]
      : [];
  const dayLabel = new Intl.DateTimeFormat('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Johannesburg' }).format(new Date(`${date}T12:00:00+02:00`));
  return `<section class="month-day${holiday ? ' public-holiday' : ''}" data-date="${date}" data-public-holiday="${holiday}">
    <a class="month-day-link" href="/calendar/read-only?view=week&date=${date}&staff=11&staff=12&staff=13" aria-label="Open ${dayLabel}, ${appointments.length} items${holiday ? `. South African public holiday: ${holiday}` : ''}"></a>
    <header class="month-day-head" aria-hidden="true"><strong>${day}</strong>${holiday ? `<span class="month-holiday"><i></i><span>${holiday}</span></span>` : ''}</header>
    <div class="month-events">${appointments.map(item => `<article class="month-event event-card"><span class="event-time-start">${item.time}</span><h4>${item.client}</h4></article>`).join('')}</div>
  </section>`;
};

export const MonthAppointmentsAndSouthAfricanHoliday = {
  render: () => frame(`
    <style>
      html,body,#storybook-root{width:100%;max-width:100%;margin:0;overflow-x:hidden}
      .calendar-reference{width:100%!important;max-width:100%!important;border-radius:0}
      .month-reference{width:100%;min-width:0;display:grid;gap:8px}
      .month-reference h2{margin:0;font-size:1.2rem}
      .month-weekdays,.month-days{display:grid;grid-template-columns:repeat(6,minmax(0,1fr))}
      .month-weekdays span{padding:7px;text-align:center;color:#56685f;font-size:.68rem;font-weight:800}
      .month-day{position:relative;isolation:isolate;min-height:154px;padding:7px;border:1px solid #dce3dd;background:#fff}
      .month-day-link{position:absolute;inset:0;z-index:1}
      .month-day-link:hover{background:#e7eee9}
      .month-day-link:focus-visible{outline:3px solid #3f6653;outline-offset:-3px}
      .month-day-head{position:relative;z-index:2;display:grid;justify-items:end;gap:4px;pointer-events:none}
      .month-holiday{display:flex;gap:4px;width:100%;padding:4px;border:1px solid #ead6cc;border-radius:6px;background:#f8eee8;color:#704f3f;font-size:.64rem;line-height:1.15}
      .month-holiday i{flex:0 0 7px;width:7px;height:7px;margin-top:2px;border-radius:50%;background:#8b6f5f}
      .month-events{position:relative;z-index:3;display:grid;gap:3px;margin-top:5px}
      .month-event{min-width:0;padding:5px;border-left:3px solid #3f6653;border-radius:5px;background:#f7fbf8}
      .month-event .event-time-start{font-size:.64rem;font-weight:800}
      .month-event h4{margin:2px 0 0;font-size:.68rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      @media(max-width:700px){
        .calendar-reference{padding:8px}
        .month-weekdays span{padding:5px 1px;font-size:.56rem}
        .month-day{min-height:124px;padding:3px 2px}
        .month-day-head{min-height:44px}
        .month-holiday{padding:3px 2px;font-size:.5rem;overflow-wrap:anywhere}
        .month-holiday i{flex-basis:5px;width:5px;height:5px}
        .month-events{gap:2px;margin-top:2px}
        .month-event{padding:3px 2px;border-left-width:3px}
        .month-event .event-time-start,.month-event h4{font-size:.52rem;line-height:1.05}
      }
    </style>
    <section class="month-reference" aria-label="September 2026 Month view">
      <h2>September 2026</h2>
      <div class="month-weekdays" aria-hidden="true"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div>
      <div class="month-days">${monthReferenceDays.map(monthReferenceCell).join('')}</div>
    </section>
  `, '100%'),
  parameters: { layout: 'fullscreen' },
};
