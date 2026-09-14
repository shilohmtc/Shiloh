const CALENDAR_EVENT_TONES = Object.freeze({
  scheduled: Object.freeze({ accent: '#2F6F5E', border: '#BDD7CD', surface: '#EEF6F2' }),
  attention: Object.freeze({ accent: '#946200', border: '#E4C46D', surface: '#FFF6D9' }),
  completed: Object.freeze({ accent: '#5F6F6B', border: '#D1DAD7', surface: '#F1F4F3' }),
  no_show: Object.freeze({ accent: '#A33F3F', border: '#E4BDBD', surface: '#FAECEC' }),
  blocked: Object.freeze({ accent: '#5E6965', border: '#CBD3D0', surface: '#F0F3F2' }),
  leave: Object.freeze({ accent: '#6E568F', border: '#D7CBE5', surface: '#F3EFF8' }),
  closure: Object.freeze({ accent: '#A33F3F', border: '#E4BDBD', surface: '#FAECEC' }),
  neutral: Object.freeze({ accent: '#5F6F6B', border: '#D1DAD7', surface: '#FFFFFF' }),
});

const ATTENTION_REQUEST_STATES = new Set(['pending', 'awaiting_client_confirmation']);
const COMPLETED_APPOINTMENT_STATES = new Set(['completed', 'no_charge']);

function calendarEventTone(item = {}) {
  const kind = String(item.kind || '').toLowerCase();
  const status = String(item.status || '').toLowerCase();
  const requestState = String(item.bookingRequestState || '').toLowerCase();

  if (kind === 'appointment') {
    if (ATTENTION_REQUEST_STATES.has(requestState)) return 'attention';
    if (status === 'no_show') return 'no_show';
    if (COMPLETED_APPOINTMENT_STATES.has(status)) return 'completed';
    return 'scheduled';
  }
  if (kind === 'calendar_block') return 'blocked';
  if (kind === 'approved_leave' || kind === 'operational_leave') return 'leave';
  if (kind === 'clinic_closure') return 'closure';
  return 'neutral';
}

function calendarEventStatusLabel(item = {}) {
  if (item.kind !== 'appointment') return null;
  if (item.bookingRequestState === 'pending') return 'Needs attention';
  if (item.bookingRequestState === 'awaiting_client_confirmation') return 'Awaiting client';
  switch (String(item.status || '').toLowerCase()) {
    case 'completed': return 'Completed';
    case 'no_charge': return 'No charge';
    case 'no_show': return 'No-show';
    default: return null;
  }
}

function calendarEventServiceFamily(item = {}) {
  if (item.kind !== 'appointment' || !Array.isArray(item.serviceContexts)) return null;
  const families = [...new Set(item.serviceContexts
    .map((service) => resolveServiceFamily(service)?.key)
    .filter(Boolean))];
  return families.length === 1 ? families[0] : null;
}

function calendarEventVisualAttributes(item = {}) {
  const tone = calendarEventTone(item);
  const statusLabel = calendarEventStatusLabel(item);
  const serviceFamily = calendarEventServiceFamily(item);
  return ` data-event-tone="${tone}"${statusLabel ? ` data-event-status-label="${statusLabel}"` : ''}${serviceFamily ? ` data-service-family-card="${serviceFamily}"` : ''}`;
}

function calendarEventToneCss() {
  const toneRules = Object.entries(CALENDAR_EVENT_TONES)
    .map(([tone, values]) => `.event-card[data-event-tone="${tone}"]{--calendar-status-accent:${values.accent};--calendar-status-border:${values.border};--calendar-status-surface:${values.surface};--calendar-event-accent:${values.accent};--calendar-event-border:${values.border};--calendar-event-surface:${values.surface}}`)
    .join('');
  return `${toneRules}
.event-card[data-kind="appointment"][data-service-family-card]{--calendar-event-accent:var(--calendar-family-accent);--calendar-event-border:var(--calendar-family-border);--calendar-event-surface:var(--calendar-family-surface)}
.event-card[data-event-tone]{position:relative;border-color:var(--calendar-event-border)!important;border-left-color:var(--calendar-event-accent)!important;background-color:var(--calendar-event-surface)!important;background-image:var(--calendar-event-pattern,none)!important}
.event-card[data-event-tone="blocked"]{--calendar-event-pattern:repeating-linear-gradient(135deg,rgba(94,105,101,.08) 0,rgba(94,105,101,.08) 7px,transparent 7px,transparent 14px);border-left-style:dashed}
.event-card[data-event-tone] .event-time,.event-card[data-event-tone] .kind-pill,.event-card[data-event-tone] .event-meta,.event-card[data-event-tone] .event-practitioners{color:#4B5D55!important}
.event-card[data-kind="appointment"][data-event-tone]{border-right:3px solid var(--calendar-status-accent,var(--calendar-event-accent))!important}
.event-card.event-couples{--calendar-family-accent:#76516d!important;--calendar-family-border:#cdb7c7!important;--calendar-family-surface:#f4eaf1!important;border-left-color:#76516d!important;background-color:#f4eaf1!important;background-image:linear-gradient(135deg,rgba(118,81,109,.045) 25%,transparent 25%,transparent 50%,rgba(118,81,109,.045) 50%,rgba(118,81,109,.045) 75%,transparent 75%,transparent)!important;background-size:12px 12px!important}.event-card.event-couples .kind-pill{display:inline-flex!important;color:#76516d!important;background:#fff8fc!important;border:1px solid #cdb7c7!important;border-radius:999px;padding:2px 5px}
.event-card.event-group{--calendar-family-accent:#5b557d!important;--calendar-family-border:#c4c0da!important;--calendar-family-surface:#eeedf7!important;border-left-color:#5b557d!important;background-color:#eeedf7!important;background-image:linear-gradient(135deg,rgba(91,85,125,.05) 25%,transparent 25%,transparent 50%,rgba(91,85,125,.05) 50%,rgba(91,85,125,.05) 75%,transparent 75%,transparent)!important;background-size:12px 12px!important}.event-card.event-group .kind-pill{display:inline-flex!important;color:#4f496f!important;background:#faf9ff!important;border:1px solid #c4c0da!important;border-radius:999px;padding:2px 5px}
.event-card[data-kind="appointment"][data-event-tone] .kind-pill{padding:2px 5px;border:1px solid var(--calendar-status-border,var(--calendar-event-border));border-radius:999px;background:var(--calendar-status-surface,var(--calendar-event-surface));color:var(--calendar-status-accent,var(--calendar-event-accent))!important}
.event-card[data-event-tone="attention"] .kind-pill,.event-card[data-event-tone="completed"] .kind-pill,.event-card[data-event-tone="no_show"] .kind-pill{color:var(--calendar-status-accent,var(--calendar-event-accent))!important}
.positioned-event .event-card[data-event-tone="attention"] .kind-pill,.positioned-event .event-card[data-event-tone="completed"] .kind-pill,.positioned-event .event-card[data-event-tone="no_show"] .kind-pill,.month-event .event-card[data-event-tone="attention"] .kind-pill,.month-event .event-card[data-event-tone="completed"] .kind-pill,.month-event .event-card[data-event-tone="no_show"] .kind-pill{position:absolute;top:4px;right:5px;display:inline-flex!important;max-width:calc(100% - 12px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.54rem;line-height:1.1}
.positioned-event .event-card[data-event-tone="attention"] .event-card-top,.positioned-event .event-card[data-event-tone="completed"] .event-card-top,.positioned-event .event-card[data-event-tone="no_show"] .event-card-top{padding-right:76px!important}
@media(prefers-contrast:more){.event-card[data-event-tone]{border-width:2px;border-left-width:5px}.event-card[data-event-tone="blocked"]{border-left-style:dashed}}`;
}

module.exports = {
  CALENDAR_EVENT_TONES,
  calendarEventTone,
  calendarEventStatusLabel,
  calendarEventServiceFamily,
  calendarEventVisualAttributes,
  calendarEventToneCss,
};
const { resolveServiceFamily } = require('./calendarServiceFamilyVisuals');
