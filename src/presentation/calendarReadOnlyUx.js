const {
  resolveServiceFamily,
  renderServiceFamilyIcon,
  serviceFamilyAccentCss,
} = require('./calendarServiceFamilyVisuals');
const {
  calendarEventStatusLabel,
  calendarEventVisualAttributes,
  calendarEventToneCss,
} = require('./calendarEventVisuals');
const {
  allowsAppointmentTarget,
  allowsStaffTarget,
} = require('../services/calendarAuthorization');
const {
  workspaceShellStyles,
  renderWorkspaceNavigation,
} = require('./workspaceShell');
const { normalizeOperationalDateKey } = require('../services/calendarReadOnlyUx');
const { desktopFirstPaintStyles } = require('./calendarDesktopApprovedUx');

const BUSINESS_TIMEZONE = 'Africa/Johannesburg';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dateKey(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatDay(value, options = {}) {
  const date = new Date(`${value}T12:00:00+02:00`);
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: BUSINESS_TIMEZONE,
    weekday: options.weekday || 'short',
    day: '2-digit',
    month: options.month || 'short',
    year: options.year || undefined,
  }).format(date);
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: BUSINESS_TIMEZONE,
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function formatRange(item) {
  if (item.allDay) return 'All day';
  if (item.startsAt && item.endsAt) return `${formatTime(item.startsAt)}–${formatTime(item.endsAt)}`;
  return '';
}

function formatClientMobile(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  if (/^27\d{9}$/.test(digits)) return `+27 ${digits.slice(2, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  return 'Contact unavailable';
}

function eventStaffIds(item) {
  if (Array.isArray(item?.staffIds)) return item.staffIds.map(Number).filter(Number.isSafeInteger);
  if (Number.isSafeInteger(Number(item?.staffId))) return [Number(item.staffId)];
  return [];
}

function staffMap(model) {
  return new Map((model.permittedStaff || []).map(person => [Number(person.id), person.displayName || `Staff ${person.id}`]));
}

function staffNamesFor(item, model) {
  const names = staffMap(model);
  if (Array.isArray(item.staff) && item.staff.length) {
    return item.staff
      .filter(entry => names.has(Number(entry.staffId)))
      .map(entry => entry.nameSnapshot || names.get(Number(entry.staffId)) || `Staff ${entry.staffId}`);
  }
  return eventStaffIds(item).filter(id => names.has(id)).map(id => names.get(id));
}

function eventTitle(item) {
  switch (item.kind) {
    case 'appointment': return item.clientName || 'Client';
    case 'calendar_block': return item.title || item.blockType || 'Blocked time';
    case 'approved_leave': return 'Approved leave';
    case 'operational_leave': return 'Operational leave';
    case 'clinic_closure': return item.reason ? `Closed — ${item.reason}` : 'Clinic closed';
    default: return String(item.kind || 'Calendar item').replace(/_/g, ' ');
  }
}

function eventKindLabel(item) {
  if (item.kind === 'appointment' && item.appointmentGroupType === 'couples_massage') return 'Couples';
  if (item.kind === 'appointment' && item.appointmentGroupType === 'group_booking') return 'Group';
  if (item.kind === 'appointment' && ['pending', 'awaiting_client_confirmation'].includes(String(item.bookingRequestState || ''))) return 'Booking request';
  const statusLabel = calendarEventStatusLabel(item);
  if (statusLabel) return statusLabel;
  switch (item.kind) {
    case 'appointment': return 'Appointment';
    case 'calendar_block': return 'Block';
    case 'approved_leave': return 'Leave';
    case 'operational_leave': return 'Operational leave';
    case 'clinic_closure': return 'Closure';
    default: return String(item.kind || 'Calendar item').replace(/_/g, ' ');
  }
}

function eventDetailPieces(item, model) {
  const pieces = [];
  if (item.kind === 'appointment' && item.bookingRequestState === 'pending') pieces.push('Needs staff resolution');
  else if (item.kind === 'appointment' && item.bookingRequestState === 'awaiting_client_confirmation') pieces.push('Awaiting client confirmation');
  else if (item.kind === 'appointment' && item.status) pieces.push(String(item.status).replace(/_/g, ' '));
  if (item.kind === 'calendar_block' && item.blockType) pieces.push(String(item.blockType).replace(/_/g, ' '));
  if ((item.kind === 'approved_leave' || item.kind === 'operational_leave') && item.reason) pieces.push(item.reason);
  return pieces.join(' • ');
}

function renderStaffOwnership(item, model) {
  const names = staffNamesFor(item, model);
  if (!names.length) return '';
  const label = names.join(' + ');
  const compactLabel = names.map(practitionerInitials).join('+');
  return `<span class="event-practitioners" data-practitioner-count="${names.length}" aria-label="Practitioners: ${escapeHtml(label)}"><span class="status-dot" aria-hidden="true"></span><span class="event-practitioner-full">${escapeHtml(label)}</span><span class="event-practitioner-compact" aria-hidden="true">${escapeHtml(compactLabel)}</span></span>`;
}

function renderEventMeta(item, model) {
  const details = eventDetailPieces(item, model);
  const ownership = renderStaffOwnership(item, model);
  if (item.kind !== 'appointment') return details ? escapeHtml(details) : '';
  const contexts = Array.isArray(item.serviceContexts) ? item.serviceContexts : [];
  const families = [];
  const seen = new Set();
  for (const context of contexts) {
    const family = resolveServiceFamily(context);
    if (!family || seen.has(family.key)) continue;
    seen.add(family.key);
    families.push(family.key);
  }
  const icons = families.map((familyKey) => renderServiceFamilyIcon(familyKey)).join('');
  const service = item.serviceName
    ? `<span class="event-service-context">${icons}<span>${escapeHtml(item.serviceName)}</span></span>`
    : '';
  const parts = [ownership, service, details ? `<span class="event-state">${escapeHtml(details)}</span>` : ''].filter(Boolean);
  return parts.join('<span class="event-detail-separator" aria-hidden="true">•</span>');
}

function renderProvenance(item) {
  return `<span class="provenance canonical">${item.kind === 'appointment' ? 'Shiloh appointment' : 'Shiloh schedule'}</span>`;
}

function mutationEnabled(model) {
  return model?.mutationCapability?.enabled === true
    && Array.isArray(model.mutationCapability.operations)
    && model.mutationCapability.operations.length > 0;
}

function operationEnabled(model, operation) {
  return mutationEnabled(model) && model.mutationCapability.operations.includes(operation);
}

function appointmentOperationScope(item, model) {
  const serviceIds = (item.serviceContexts || [])
    .map((service) => Number(service.serviceId || service.service_id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  return allowsAppointmentTarget(model?.mutationCapability, {
    staffIds: eventStaffIds(item),
    serviceIds,
  });
}

function appointmentOperations(item, model) {
  if (['couples_massage', 'group_booking'].includes(item.appointmentGroupType)) return [];
  if (['pending', 'awaiting_client_confirmation'].includes(String(item.bookingRequestState || ''))) return [];
  if (!appointmentOperationScope(item, model)) return [];
  return ['appointment:reschedule', 'appointment:cancel', 'appointment:reassign']
    .filter((operation) => operationEnabled(model, operation));
}

function staffOperationEnabled(model, operation, staffId) {
  return operationEnabled(model, operation) && allowsStaffTarget(model.mutationCapability, staffId);
}

function mutationAttributes(item, model) {
  if (!mutationEnabled(model)) return '';
  const revision = escapeHtml(item.revision || '');
  if (item.kind === 'appointment') {
    const operations = appointmentOperations(item, model);
    if (!operations.length) return '';
    const draggable = operations.includes('appointment:reschedule') ? ' draggable="true"' : '';
    return ` data-appointment-id="${escapeHtml(item.id)}" data-appointment-management-target="true" role="button" tabindex="0" aria-label="Manage appointment for ${escapeHtml(item.clientName || 'Client')}" data-revision="${revision}" data-staff-ids="${escapeHtml(eventStaffIds(item).join(','))}" data-starts-at="${escapeHtml(item.startsAt || '')}" data-ends-at="${escapeHtml(item.endsAt || '')}" data-client-name="${escapeHtml(item.clientName || 'Client')}" data-client-mobile="${escapeHtml(formatClientMobile(item.clientMobile))}" data-service-name="${escapeHtml(item.serviceName || '')}" data-practitioner-names="${escapeHtml(staffNamesFor(item, model).join(' + '))}" data-appointment-status="${escapeHtml(eventDetailPieces(item, model) || 'Scheduled')}" data-allowed-operations="${escapeHtml(operations.join(','))}"${draggable}`;
  }
  if (item.kind === 'calendar_block' && staffOperationEnabled(model, 'calendar_block:manage', eventStaffIds(item)[0])) {
    return ` data-block-id="${escapeHtml(item.id)}" data-revision="${revision}" data-staff-ids="${escapeHtml(eventStaffIds(item)[0] || '')}" data-location-id="${escapeHtml(item.locationId || '')}" data-starts-at="${escapeHtml(item.startsAt || '')}" data-ends-at="${escapeHtml(item.endsAt || '')}" data-block-type="${escapeHtml(item.blockType || 'other')}" data-title="${escapeHtml(item.title || 'Operational block')}"`;
  }
  if (item.kind === 'operational_leave' && staffOperationEnabled(model, 'operational_leave:manage', eventStaffIds(item)[0])) {
    return ` data-leave-id="${escapeHtml(item.id)}" data-revision="${revision}" data-staff-ids="${escapeHtml(eventStaffIds(item)[0] || '')}" data-location-id="${escapeHtml(item.locationId || '')}" data-date="${escapeHtml(dateKey(item.date || item.startsAt) || '')}" data-reason="${escapeHtml(item.reason || 'Operational leave')}"`;
  }
  return '';
}

function renderMutationButton(item, model) {
  if (item.kind === 'appointment' && ['pending', 'awaiting_client_confirmation'].includes(String(item.bookingRequestState || ''))) {
    return `<a class="event-operation" href="/calendar/workspace#booking-request-${escapeHtml(item.id)}">Resolve request</a>`;
  }
  if (!mutationEnabled(model)) return '';
  const action = item.kind === 'calendar_block' && staffOperationEnabled(model, 'calendar_block:manage', eventStaffIds(item)[0])
      ? 'manage-block'
      : item.kind === 'operational_leave' && staffOperationEnabled(model, 'operational_leave:manage', eventStaffIds(item)[0])
        ? 'manage-leave'
        : null;
  if (!action) return '';
  return `<button class="event-operation" type="button" data-calendar-operation="${action}">Manage</button>`;
}

function renderEventCard(item, model) {
  const shared = item.kind === 'appointment' && eventStaffIds(item).length > 1;
  const couples = item.kind === 'appointment' && item.appointmentGroupType === 'couples_massage';
  const group = item.kind === 'appointment' && item.appointmentGroupType === 'group_booking';
  const id = `${item.kind || 'event'}-${item.id || 'unknown'}`;
  const meta = renderEventMeta(item, model);
  return `<article class="event-card event-canonical ${shared ? 'event-shared' : ''} ${couples ? 'event-couples' : ''} ${group ? 'event-group' : ''}" data-event-id="${escapeHtml(id)}" data-kind="${escapeHtml(item.kind || '')}" data-canonical="true" data-event-staff-ids="${escapeHtml(eventStaffIds(item).join(','))}"${couples || group ? ` data-appointment-group-id="${escapeHtml(item.appointmentGroupId)}" data-appointment-group-position="${escapeHtml(item.appointmentGroupPosition)}"` : ''}${calendarEventVisualAttributes(item)}${mutationAttributes(item, model)}>
    <div class="event-card-top"><div class="event-time"><span class="event-time-range">${escapeHtml(formatRange(item))}</span><span class="event-time-start" aria-hidden="true">${escapeHtml(item.allDay ? 'All day' : formatTime(item.startsAt))}</span></div><span class="kind-pill">${escapeHtml(eventKindLabel(item))}</span></div>
    <h4>${escapeHtml(eventTitle(item))}</h4>
    ${item.kind === 'appointment' ? `<p class="event-client-mobile">${escapeHtml(formatClientMobile(item.clientMobile))}</p>` : ''}
    ${meta ? `<p class="event-meta">${meta}</p>` : ''}
    ${item.kind === 'appointment' ? `<div class="appointment-reference">Appointment #${escapeHtml(item.id)}</div>` : ''}
    <div class="event-card-actions">${renderProvenance(item)}${renderMutationButton(item, model)}</div>
  </article>`;
}

function sortEvents(events) {
  return [...events].sort((a, b) => {
    const aKey = a.startsAt ? new Date(a.startsAt).getTime() : new Date(`${a.date || '9999-12-31'}T00:00:00+02:00`).getTime();
    const bKey = b.startsAt ? new Date(b.startsAt).getTime() : new Date(`${b.date || '9999-12-31'}T00:00:00+02:00`).getTime();
    return aKey - bKey || String(a.kind).localeCompare(String(b.kind));
  });
}

function eventsForDate(model, day) {
  return sortEvents((model.timeline.events || []).filter(item => item.canonical !== false && item.kind !== 'external_busy' && dateKey(item.startsAt || item.date) === day));
}

function workingContext(model, staffId, day) {
  const noon = new Date(`${day}T12:00:00+02:00`);
  const weekday = noon.getUTCDay();
  const exceptions = (model.timeline.scheduleExceptions || []).filter(item => Number(item.staffId) === Number(staffId) && dateKey(item.date) === day);
  if (exceptions.length) {
    return exceptions.map(item => {
      const label = String(item.exceptionType || 'exception').replace(/_/g, ' ');
      const hours = item.startsLocal && item.endsLocal ? ` ${String(item.startsLocal).slice(0, 5)}–${String(item.endsLocal).slice(0, 5)}` : '';
      return `${label}${hours}`;
    }).join(' • ');
  }
  const recurringClosed = (model.timeline.recurringClosures || []).some(item => Number(item.staffId) === Number(staffId) && Number(item.dayOfWeek) === weekday);
  if (recurringClosed) return 'Not scheduled';
  const windows = (model.timeline.workingWindows || []).filter(item => Number(item.staffId) === Number(staffId) && Number(item.dayOfWeek) === weekday);
  if (!windows.length) return 'No working window';
  return windows.map(item => `${String(item.startsLocal || '').slice(0, 5)}–${String(item.endsLocal || '').slice(0, 5)}`).join(' • ');
}

function visibleStaffIdsForModel(model) {
  if (Array.isArray(model?.visibleStaffIds)) return model.visibleStaffIds.map(Number).filter(Number.isSafeInteger);
  if (model?.selectedStaffId != null) return [Number(model.selectedStaffId)].filter(Number.isSafeInteger);
  return (model?.timeline?.staff || []).map(person => Number(person.id)).filter(Number.isSafeInteger);
}

function queryHref(basePath, view, date, staffIds, { activeStaffId = null } = {}) {
  const params = new URLSearchParams({ view, date });
  for (const staffId of staffIds || []) params.append('staff', String(staffId));
  const normalizedActiveStaffId = Number(activeStaffId);
  if (Number.isSafeInteger(normalizedActiveStaffId) && normalizedActiveStaffId > 0) params.set('activeStaff', String(normalizedActiveStaffId));
  return `${basePath}?${params.toString()}`;
}

function bookingHref(bookingPath, { date, time, staffId } = {}) {
  const params = new URLSearchParams();
  if (date) params.set('date', String(date));
  if (time) params.set('time', String(time));
  const normalizedStaffId = staffId == null ? null : Number(staffId);
  if (Number.isSafeInteger(normalizedStaffId) && normalizedStaffId > 0) params.set('staff', String(normalizedStaffId));
  const query = params.toString();
  return `${bookingPath}${query ? `?${query}` : ''}`;
}

function renderControls(model, basePath, operationalActions = []) {
  const today = normalizeOperationalDateKey(dateKey(new Date()));
  const permittedStaff = model.permittedStaff || [];
  const visibleStaffIds = visibleStaffIdsForModel(model);
  const visible = new Set(visibleStaffIds);
  const selectedPermittedStaff = permittedStaff.filter(person => visible.has(Number(person.id)));
  const peopleSummary = selectedPermittedStaff.length === permittedStaff.length
    ? 'All staff'
    : selectedPermittedStaff.length === 1
      ? selectedPermittedStaff[0].displayName
      : selectedPermittedStaff.length > 1
        ? `${selectedPermittedStaff.length} staff`
        : 'No staff';
  const canSwitchPractitioner = permittedStaff.length > 1;
  const filterContent = canSwitchPractitioner
    ? `<details class="people-picker" data-people-picker><summary><span>People</span><strong data-people-selection-summary>${escapeHtml(peopleSummary)}</strong></summary><form class="people-form" method="get" action="${escapeHtml(basePath)}" data-practitioner-visibility-form><input type="hidden" name="view" value="${escapeHtml(model.view)}"><input type="hidden" name="date" value="${escapeHtml(model.dateKey)}">${model.activeStaffId ? `<input type="hidden" name="activeStaff" value="${escapeHtml(model.activeStaffId)}">` : ''}<fieldset><legend class="sr-only">Visible practitioners</legend>${permittedStaff.map(person => `<label><input type="checkbox" name="staff" value="${escapeHtml(person.id)}"${visible.has(Number(person.id)) ? ' checked' : ''}><span>${escapeHtml(person.displayName)}</span></label>`).join('')}</fieldset><div class="people-actions"><button class="filter" type="submit">Apply</button><a class="filter" href="${escapeHtml(queryHref(basePath, model.view, model.dateKey, permittedStaff.map(person => person.id), { activeStaffId: model.activeStaffId }))}">Show all</a></div><p data-people-selection-status>${selectedPermittedStaff.length} of ${permittedStaff.length} visible</p></form></details>`
    : `<span class="scope-pill">${escapeHtml(permittedStaff[0]?.displayName || 'Permitted practitioner')} • your permitted timeline</span>`;
  const viewLinks = ['week', 'agenda', 'month'].map(view => `<a class="view-tab ${model.view === view ? 'active' : ''}" data-calendar-view-option="${view}" ${model.view === view ? 'aria-current="page"' : ''} href="${escapeHtml(queryHref(basePath, view, model.dateKey, visibleStaffIds, { activeStaffId: model.activeStaffId }))}">${view[0].toUpperCase()}${view.slice(1)}</a>`).join('');
  const periodContext = model.view === 'month'
    ? formatMonth(model.period.startKey)
    : `${formatDay(model.period.dateKeys[0] || model.dateKey, { weekday: 'short', month: 'short' })} – ${formatDay(model.period.dateKeys.at(-1) || model.dateKey, { weekday: 'short', month: 'short', year: 'numeric' })}`;
  return `<section class="controls" aria-label="Calendar controls">
    <div class="control-group period-control"><span class="control-label">Date</span><div class="period-nav">
      <a class="nav-button period-arrow" href="${escapeHtml(queryHref(basePath, model.view, model.period.previousAnchor, visibleStaffIds, { activeStaffId: model.activeStaffId }))}" aria-label="Previous period"><span aria-hidden="true">←</span></a>
      <strong class="period-context">${escapeHtml(periodContext)}</strong>
      <a class="nav-button period-arrow" href="${escapeHtml(queryHref(basePath, model.view, model.period.nextAnchor, visibleStaffIds, { activeStaffId: model.activeStaffId }))}" aria-label="Next period"><span aria-hidden="true">→</span></a>
    </div></div>
    <div class="control-group view-control"><span class="control-label">View</span><div class="view-actions"><nav class="view-tabs" aria-label="Calendar view">${viewLinks}</nav><a class="nav-button today" href="${escapeHtml(queryHref(basePath, model.view, today, visibleStaffIds, { activeStaffId: model.activeStaffId }))}">Today</a>${renderOperationalActions(operationalActions)}</div></div>
    <div class="control-group practitioner-control"><span class="control-label">Practitioners</span><div class="filters" style="overflow:visible" aria-label="Practitioner visibility">${filterContent}</div></div>
  </section>`;
}

function countFor(model, key) {
  return Array.isArray(model.timeline?.[key]) ? model.timeline[key].length : 0;
}

function renderOperationalSummary(model) {
  const unavailable = countFor(model, 'blocks') + countFor(model, 'leave');
  const items = [
    ['Appointments', countFor(model, 'appointments')],
    ['Blocks + leave', unavailable],
    ['Closures', countFor(model, 'closures')],
  ];
  return `<section class="scan-summary" aria-label="Visible period summary">
    <div class="summary-context"><span class="eyebrow">At a glance</span><strong>${model.timeline?.staff?.length || 0} practitioner${model.timeline?.staff?.length === 1 ? '' : 's'} in view</strong></div>
    <div class="summary-metrics">${items.map(([label, value]) => `<div class="summary-metric"><strong>${value}</strong><span>${escapeHtml(label)}</span></div>`).join('')}</div>
    <div class="provenance-key" aria-label="Scheduling authority"><span class="key-dot canonical"></span>Shiloh schedule</div>
  </section>`;
}

function renderClosureStrip(model, day) {
  const closures = (model.timeline.closures || []).filter(item => dateKey(item.date) === day);
  if (!closures.length) return '';
  return `<div class="closure-strip">${closures.map(item => `<span>Closed • ${escapeHtml(item.reason || 'Clinic closure')}</span>`).join('')}</div>`;
}

const GRID_START_MINUTES = 7 * 60;
const GRID_END_MINUTES = 20 * 60;
const GRID_PIXELS_PER_HOUR = 72;

function localMinutes(value) {
  const time = formatTime(value);
  const [hour, minute] = time.split(':').map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? (hour * 60) + minute : GRID_START_MINUTES;
}

function renderTimeRail() {
  const ticks = [];
  for (let minute = GRID_START_MINUTES; minute <= GRID_END_MINUTES; minute += 60) {
    ticks.push(`<span style="--grid-top:${((minute - GRID_START_MINUTES) / 60) * GRID_PIXELS_PER_HOUR}px">${String(Math.floor(minute / 60)).padStart(2, '0')}:00</span>`);
  }
  return `<div class="time-rail" aria-hidden="true">${ticks.join('')}</div>`;
}

function renderBookingSlotLayer({ date, staffId = null, staffName = '', bookingPath = '/calendar/book', enabled = false } = {}) {
  if (!enabled || !date) return '';
  const normalizedStaffId = staffId == null ? null : Number(staffId);
  const hasStaffPrefill = Number.isSafeInteger(normalizedStaffId) && normalizedStaffId > 0;
  const slots = [];
  for (let minute = GRID_START_MINUTES; minute < GRID_END_MINUTES; minute += 60) {
    const hour = String(Math.floor(minute / 60)).padStart(2, '0');
    const minutes = String(minute % 60).padStart(2, '0');
    const time = `${hour}:${minutes}`;
    const top = ((minute - GRID_START_MINUTES) / 60) * GRID_PIXELS_PER_HOUR;
    const height = GRID_PIXELS_PER_HOUR;
    const href = bookingHref(bookingPath, { date, time, staffId: normalizedStaffId });
    const practitioner = hasStaffPrefill ? ` for ${staffName || 'the selected practitioner'}` : '';
    const ariaLabel = `Create booking on ${formatDay(date, { weekday: 'long', month: 'long', year: 'numeric' })} at ${time}${practitioner}`;
    slots.push(`<a class="calendar-booking-slot" data-calendar-booking-slot data-date="${escapeHtml(date)}" data-time="${time}"${hasStaffPrefill ? ` data-staff-id="${escapeHtml(normalizedStaffId)}"` : ''} style="--slot-top:${top}px;--slot-height:${height}px" href="${escapeHtml(href)}" aria-label="${escapeHtml(ariaLabel)}"><span aria-hidden="true">+</span></a>`);
  }
  return `<div class="calendar-booking-slots" data-calendar-booking-slots>${slots.join('')}</div>`;
}

function eventBelongsInStaffLane(item, staffId, visibleStaffIds) {
  const assignedStaffIds = eventStaffIds(item);
  if (!assignedStaffIds.length) return false;
  if (item.kind === 'appointment' && assignedStaffIds.length > 1) {
    const firstVisibleAssignedStaffId = visibleStaffIds.find(id => assignedStaffIds.includes(id));
    return Number(staffId) === firstVisibleAssignedStaffId;
  }
  return assignedStaffIds.includes(Number(staffId));
}

function renderPositionedEvent(item, model) {
  if (item.allDay || !item.startsAt || !item.endsAt) return renderEventCard(item, model);
  const start = Math.max(GRID_START_MINUTES, localMinutes(item.startsAt));
  const end = Math.min(GRID_END_MINUTES, Math.max(start + 15, localMinutes(item.endsAt)));
  const top = ((start - GRID_START_MINUTES) / 60) * GRID_PIXELS_PER_HOUR;
  const height = Math.max(34, ((end - start) / 60) * GRID_PIXELS_PER_HOUR - 3);
  return `<div class="positioned-event" style="--event-top:${top}px;--event-height:${height}px">${renderEventCard(item, model)}</div>`;
}

function renderDay(model, booking = {}) {
  const day = model.period.dateKeys[0];
  const sharedAppointments = (model.timeline.appointments || []).filter(item => dateKey(item.startsAt) === day && eventStaffIds(item).length > 1);
  const staff = model.timeline.staff || [];
  const visibleStaffIds = staff.map(person => Number(person.id));
  const lanes = staff.map((person, index) => {
    const items = eventsForDate(model, day).filter(item => item.kind !== 'clinic_closure' && eventBelongsInStaffLane(item, person.id, visibleStaffIds));
    const context = workingContext(model, person.id, day);
    const unavailable = context === 'Not scheduled' || context === 'No working window';
    const laneOperations = [
      staffOperationEnabled(model, 'calendar_block:manage', person.id) ? `<button type="button" data-calendar-operation="add-block" data-staff-id="${escapeHtml(person.id)}" data-date="${escapeHtml(day)}">Add block</button>` : '',
      staffOperationEnabled(model, 'operational_leave:manage', person.id) ? `<button type="button" data-calendar-operation="add-leave" data-staff-id="${escapeHtml(person.id)}" data-date="${escapeHtml(day)}">Add leave</button>` : '',
      person.schedulingType !== 'regular' && staffOperationEnabled(model, 'working_schedule:manage', person.id) ? `<button type="button" data-calendar-operation="manage-schedule" data-staff-id="${escapeHtml(person.id)}" data-date="${escapeHtml(day)}">Schedule</button>` : '',
    ].filter(Boolean).join('');
    const mutationActions = laneOperations ? `<div class="lane-actions">${laneOperations}</div>` : '';
    return `<section class="lane" style="overflow:visible" data-staff-id="${escapeHtml(person.id)}" data-lane-index="${index}" data-date="${escapeHtml(day)}" ${operationEnabled(model, 'appointment:reschedule') ? 'data-calendar-drop-target="true"' : ''}>
      <header><div><h3>${escapeHtml(person.displayName)}</h3><p><span class="status-dot ${unavailable ? 'off' : ''}"></span>${escapeHtml(context)}</p></div><div class="lane-heading-actions"><span class="lane-count">${items.length} item${items.length === 1 ? '' : 's'}</span>${mutationActions}</div></header>
      <div class="time-column">${renderBookingSlotLayer({ date: day, staffId: person.id, staffName: person.displayName, bookingPath: booking.path, enabled: booking.enabled })}${items.map(item => renderPositionedEvent(item, model)).join('')}</div>
    </section>`;
  }).join('');

  return `<main class="calendar-view day-view" data-view="day">
    <div class="view-heading"><div><span class="eyebrow">Day</span><h2>${escapeHtml(formatDay(day, { weekday: 'long', month: 'long', year: 'numeric' }))}</h2></div><span class="read-only-badge">${mutationEnabled(model) ? 'Calendar actions' : 'Read-only'}</span></div>
    ${renderClosureStrip(model, day)}
    ${sharedAppointments.length ? '<div class="shared-note">Shared appointments appear once as one canonical booking and retain all assigned practitioners.</div>' : ''}
    ${booking.enabled ? '<p class="calendar-booking-hint">Tap an empty time to start an appointment.</p>' : ''}
    <div class="time-grid day-time-grid" data-visible-lane-count="${staff.length}">${renderTimeRail()}<div class="lanes" style="--lane-count:${Math.max(staff.length, 1)}">${lanes || '<div class="empty large">No permitted practitioner lanes</div>'}</div></div>
  </main>`;
}

function renderViewPractitionerContext(model) {
  const staff = model.timeline?.staff || [];
  if (!staff.length) return '';
  return `<section class="view-practitioner-context" data-view-practitioner-context aria-label="Practitioners in this ${escapeHtml(model.view)} view"><span class="section-label">People in view</span><div class="view-practitioner-list">${staff.map(person => `<span class="view-practitioner" data-staff-id="${escapeHtml(person.id)}"><span class="status-dot" aria-hidden="true"></span>${escapeHtml(person.displayName || `Staff ${person.id}`)}</span>`).join('')}</div></section>`;
}

function renderPhoneWeekPractitionerPicker(model, basePath = '/calendar/read-only') {
  const staff = model.timeline?.staff || [];
  if (!staff.length) return '';
  const activeStaffId = staff.some(person => Number(person.id) === Number(model.activeStaffId))
    ? Number(model.activeStaffId)
    : Number(staff[0].id);
  const active = staff.find(person => Number(person.id) === activeStaffId) || staff[0];
  if (staff.length === 1) return `<span class="compact-week-active-practitioner" data-compact-week-active-staff="${escapeHtml(active.id)}"><span class="status-dot" aria-hidden="true"></span>${escapeHtml(active.displayName)}</span>`;
  const visibleStaffIds = staff.map(person => Number(person.id));
  const options = staff.map(person => `<a class="compact-week-practitioner-option${Number(person.id) === activeStaffId ? ' active' : ''}" data-compact-week-practitioner-option="${escapeHtml(person.id)}" ${Number(person.id) === activeStaffId ? 'aria-current="true"' : ''} href="${escapeHtml(queryHref(basePath, 'week', model.dateKey, visibleStaffIds, { activeStaffId: person.id }))}">${escapeHtml(person.displayName)}</a>`).join('');
  return `<details class="compact-week-practitioner-picker" data-compact-week-practitioner-picker><summary><span class="status-dot" aria-hidden="true"></span><span>Practitioner</span><strong data-compact-week-active-staff="${escapeHtml(active.id)}">${escapeHtml(active.displayName)}</strong></summary><div class="compact-week-practitioner-options">${options}</div></details>`;
}

function renderDesktopAvailabilitySources(model, staff = [], date = '') {
  const lanes = staff.map((person) => {
    const actions = [
      staffOperationEnabled(model, 'calendar_block:manage', person.id)
        ? `<button type="button" data-calendar-operation="add-block" data-staff-id="${escapeHtml(person.id)}" data-date="${escapeHtml(date)}">Add block</button>`
        : '',
      staffOperationEnabled(model, 'operational_leave:manage', person.id)
        ? `<button type="button" data-calendar-operation="add-leave" data-staff-id="${escapeHtml(person.id)}" data-date="${escapeHtml(date)}">Add leave</button>`
        : '',
    ].filter(Boolean).join('');
    if (!actions) return '';
    return `<span class="desktop-availability-source lane" data-staff-id="${escapeHtml(person.id)}" data-date="${escapeHtml(date)}"><h3>${escapeHtml(person.displayName || `Staff ${person.id}`)}</h3>${actions}</span>`;
  }).filter(Boolean).join('');
  return lanes ? `<div hidden data-desktop-availability-sources>${lanes}</div>` : '';
}

function renderWeek(model, booking = {}, basePath = '/calendar/read-only') {
  const sourceStaff = model.timeline.staff || [];
  const activeStaffId = sourceStaff.some(person => Number(person.id) === Number(model.activeStaffId))
    ? Number(model.activeStaffId)
    : Number(sourceStaff[0]?.id);
  const staff = sourceStaff;
  const operationalDays = model.period.dateKeys.filter(day => new Date(`${day}T12:00:00+02:00`).getUTCDay() !== 0);
  const selectedDate = operationalDays.includes(model.dateKey) ? model.dateKey : operationalDays[0] || model.dateKey;
  const unambiguousStaff = staff.length === 1 ? staff[0] : null;
  const lanes = operationalDays.map((day, dayIndex) => {
    const items = eventsForDate(model, day).filter(item => item.kind !== 'clinic_closure');
    const month = new Intl.DateTimeFormat('en-ZA', { timeZone: BUSINESS_TIMEZONE, month: 'short' }).format(new Date(`${day}T12:00:00+02:00`));
    return `<section class="week-day week-date-lane" data-week-date-lane data-date="${escapeHtml(day)}" data-day-index="${dayIndex}"${unambiguousStaff ? ` data-booking-staff-id="${escapeHtml(unambiguousStaff.id)}"` : ''} ${operationEnabled(model, 'appointment:reschedule') ? 'data-calendar-drop-target="true"' : ''}>
      <header><div class="week-lane-heading"><span class="week-day-date"><span class="week-day-weekday">${escapeHtml(formatDay(day, { weekday: 'short', month: undefined }).split(',')[0])}</span><strong class="week-day-number">${Number(day.slice(-2))}</strong><span class="week-day-month">${escapeHtml(month)}</span></span></div><small>${items.length} item${items.length === 1 ? '' : 's'}</small></header>
      ${renderClosureStrip(model, day)}
      <div class="time-column">${renderBookingSlotLayer({ date: day, staffId: unambiguousStaff?.id, staffName: unambiguousStaff?.displayName, bookingPath: booking.path, enabled: booking.enabled })}${items.map(item => renderPositionedEvent(item, model)).join('')}</div>
    </section>`;
  }).join('');
  const laneCount = operationalDays.length;
  return `<main class="calendar-view week-view" data-view="week" data-spatial-week="true" data-date-first-week="true">
    <div class="view-heading"><div><span class="eyebrow">Week</span><h2>${escapeHtml(formatDay(operationalDays[0] || model.period.startKey, { weekday: 'short', month: 'long' }))} – ${escapeHtml(formatDay(operationalDays.at(-1) || model.period.startKey, { weekday: 'short', month: 'long', year: 'numeric' }))}</h2></div>${renderPhoneWeekPractitionerPicker({ ...model, timeline: { ...model.timeline, staff } }, basePath)}<span class="read-only-badge">${mutationEnabled(model) ? 'Calendar actions' : 'Read-only'}</span></div>
    ${renderViewPractitionerContext(model)}
    ${booking.enabled ? '<p class="calendar-booking-hint">Tap an empty time to start an appointment.</p>' : ''}
    ${renderDesktopAvailabilitySources(model, staff, selectedDate)}
    <div class="time-grid week-time-grid">${renderTimeRail()}<div class="week-grid" data-week-date-lane-count="${laneCount}" style="--week-lane-count:${Math.max(laneCount, 1)}">${lanes || '<div class="empty large">No operational dates</div>'}</div></div>
  </main>`;
}

function renderAgenda(model) {
  const sections = model.period.dateKeys.map(day => {
    const items = eventsForDate(model, day);
    if (!items.length) return '';
    return `<section class="agenda-day"><header><h3>${escapeHtml(formatDay(day, { weekday: 'long', month: 'long' }))}</h3></header>${items.map(item => renderEventCard(item, model)).join('')}</section>`;
  }).filter(Boolean).join('');
  return `<main class="calendar-view agenda-view" data-view="agenda">
    <div class="view-heading"><div><span class="eyebrow">Agenda</span><h2>Next 7 operational days from ${escapeHtml(formatDay(model.dateKey, { weekday: 'long', month: 'long' }))}</h2></div><span class="read-only-badge">${mutationEnabled(model) ? 'Calendar actions' : 'Read-only'}</span></div>
    ${renderViewPractitionerContext(model)}
    ${sections || '<div class="empty large">No scheduled items in this period</div>'}
  </main>`;
}

function formatMonth(value) {
  const date = new Date(`${value}T12:00:00+02:00`);
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: BUSINESS_TIMEZONE,
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function practitionerInitials(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() || '')
    .join('') || 'P';
}

function monthOwnershipSummary(items, model) {
  const names = [];
  for (const item of items) {
    for (const name of staffNamesFor(item, model)) {
      if (!names.includes(name)) names.push(name);
    }
  }
  if (!names.length) return '';
  const visible = names.slice(0, 2).map(practitionerInitials).join(' · ');
  const remainder = names.length > 2 ? ` +${names.length - 2}` : '';
  return `<span class="month-day-owners" aria-label="Practitioners: ${escapeHtml(names.join(' + '))}">${escapeHtml(visible)}${remainder}</span>`;
}

function monthPublicHoliday(model, day) {
  const holiday = (model.publicHolidays || []).find(item => String(item.date || '') === String(day));
  if (!holiday) return null;
  const name = String(holiday.name || holiday.reason || 'South African public holiday').trim();
  return {
    ...holiday,
    label: holiday.observed === true && !/observed/i.test(name) ? `${name} (observed)` : name,
  };
}

function renderMonth(model, basePath) {
  const targetMonth = String(model.period.startKey).slice(0, 7);
  const visibleStaffIds = visibleStaffIdsForModel(model);
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const cells = model.period.dateKeys.map(day => {
    const items = eventsForDate(model, day);
    const outside = !day.startsWith(targetMonth);
    const visibleItems = items.slice(0, 3);
    const remaining = items.length - visibleItems.length;
    const dayHref = queryHref(basePath, 'week', day, visibleStaffIds, { activeStaffId: model.activeStaffId });
    const publicHoliday = monthPublicHoliday(model, day);
    const holidayLabel = publicHoliday?.label || '';
    const accessibleHoliday = holidayLabel ? `. South African public holiday: ${holidayLabel}` : '';
    return `<section class="month-day${outside ? ' outside-month' : ''}${holidayLabel ? ' public-holiday' : ''}" data-date="${escapeHtml(day)}" data-item-count="${items.length}"${holidayLabel ? ` data-public-holiday="${escapeHtml(holidayLabel)}"` : ''}>
      <a class="month-day-link" href="${escapeHtml(dayHref)}" aria-label="Open ${escapeHtml(formatDay(day, { weekday: 'long', month: 'long', year: 'numeric' }))}, ${items.length} item${items.length === 1 ? '' : 's'}${escapeHtml(accessibleHoliday)}"></a>
      <header class="month-day-head" aria-hidden="true"><div class="month-day-summary"><span>${Number(day.slice(-2))}</span><small>${items.length || ''}</small>${monthOwnershipSummary(items, model)}</div>${holidayLabel ? `<span class="month-holiday"><span class="month-holiday-dot"></span><span>${escapeHtml(holidayLabel)}</span></span>` : ''}</header>
      <div class="month-events">${visibleItems.map(item => `<div class="month-event">${renderEventCard(item, model)}</div>`).join('')}</div>
      ${remaining > 0 ? `<a class="month-more" href="${escapeHtml(dayHref)}">+${remaining} more</a>` : ''}
    </section>`;
  }).join('');
  return `<main class="calendar-view month-view" data-view="month" data-month="${escapeHtml(targetMonth)}">
    <div class="view-heading"><div><span class="eyebrow">Month</span><h2>${escapeHtml(formatMonth(model.period.startKey))}</h2></div><span class="read-only-badge">${mutationEnabled(model) ? 'Calendar actions' : 'Read-only'}</span></div>
    ${renderViewPractitionerContext(model)}
    <div class="month-grid" aria-label="${escapeHtml(formatMonth(model.period.startKey))}"><div class="month-weekdays">${weekdays.map(day => `<span>${day}</span>`).join('')}</div><div class="month-days">${cells}</div></div>
  </main>`;
}

function renderOperationalActions(actions = []) {
  if (!Array.isArray(actions) || !actions.length) return '';
  return `<nav class="operational-actions" aria-label="Calendar actions">${actions.map(action => {
    const tone = action?.tone === 'primary' ? ' primary' : '';
    const ariaLabel = action?.ariaLabel ? ` aria-label="${escapeHtml(action.ariaLabel)}"` : '';
    return `<a class="action-link${tone}" href="${escapeHtml(action?.href || '#')}"${ariaLabel}>${escapeHtml(action?.label || 'Action')}</a>`;
  }).join('')}</nav>`;
}

function styles() {
  return `:root{color-scheme:light;--ink:#20322b;--muted:#66776f;--paper:#f4f3ed;--panel:#fffdf9;--line:#dce3dd;--line-strong:#c9d4cc;--leaf:#3f6653;--leaf-deep:#294c3c;--leaf-soft:#e7eee9;--clay:#8b6f5f;--danger-soft:#f5ebe6;--shadow:0 8px 28px rgba(32,50,43,.07)}*{box-sizing:border-box}.sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{max-width:1500px;margin:0 auto;padding:22px}.topbar{display:flex;justify-content:space-between;gap:18px;align-items:end;margin-bottom:14px}.topbar-side{display:grid;gap:8px;justify-items:end}.brand h1{font-size:1.55rem;line-height:1.15;margin:0}.brand p{margin:5px 0 0;color:var(--muted);font-size:.9rem}.truth-note{font-size:.78rem;color:var(--muted);text-align:right}.access-controls,.operational-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}.action-link,.signout-button{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:999px;min-height:38px;padding:7px 12px;background:#fff;color:var(--ink);font:inherit;font-size:.78rem;font-weight:750}.action-link.primary{background:var(--leaf-deep);border-color:var(--leaf-deep);color:#fff}.action-link:hover,.signout-button:hover{border-color:var(--leaf)}.signout-button{cursor:pointer}.signout-button:disabled{opacity:.55;cursor:not-allowed}.access-status{font-size:.74rem;color:var(--muted);min-height:1em}.controls{display:grid;grid-template-columns:auto auto minmax(260px,1fr);gap:14px;align-items:end;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:11px 13px;margin-bottom:10px;box-shadow:0 4px 18px rgba(32,50,43,.04)}a{text-decoration:none;color:inherit}.control-group{display:grid;gap:5px;min-width:0}.control-label{font-size:.67rem;text-transform:uppercase;letter-spacing:.1em;font-weight:800;color:var(--muted);padding-left:3px}.period-nav,.view-tabs,.filters{display:flex;gap:6px;align-items:center}.filters{overflow:auto;justify-content:flex-end;scrollbar-width:thin}.nav-button,.view-tab,.filter,.scope-pill{display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;border:1px solid var(--line);border-radius:999px;min-height:38px;padding:7px 11px;font-size:.84rem;background:#fff;font-weight:700}.scope-pill{color:var(--muted);background:var(--leaf-soft)}.view-tab.active,.filter.active{background:var(--leaf);color:#fff;border-color:var(--leaf)}.nav-button:hover,.view-tab:hover,.filter:hover{border-color:var(--leaf)}.scan-summary{display:grid;grid-template-columns:auto 1fr auto;gap:16px;align-items:center;background:#eef2ee;border:1px solid var(--line);border-radius:14px;padding:10px 13px;margin-bottom:10px}.summary-context{display:grid;gap:2px;min-width:150px}.summary-context strong{font-size:.85rem}.summary-metrics{display:grid;grid-template-columns:repeat(3,minmax(92px,1fr));gap:6px}.summary-metric{display:flex;gap:7px;align-items:baseline;border-left:1px solid var(--line-strong);padding-left:10px}.summary-metric strong{font-size:1.05rem}.summary-metric span{font-size:.72rem;color:var(--muted)}.provenance-key{display:flex;align-items:center;gap:6px;white-space:nowrap;font-size:.72rem;color:var(--muted)}.key-dot,.status-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--leaf)}.calendar-view{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:15px;box-shadow:var(--shadow)}.view-heading{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:12px}.view-heading h2{margin:2px 0 0;font-size:1.25rem;line-height:1.2}.eyebrow{font-size:.68rem;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);font-weight:800}.read-only-badge{background:var(--leaf-soft);color:var(--leaf);border-radius:999px;padding:6px 10px;font-size:.76rem;font-weight:750}.closure-strip{display:flex;gap:8px;flex-wrap:wrap;background:var(--danger-soft);border:1px solid #ead6cc;border-radius:10px;padding:8px 10px;margin:0 0 10px;font-size:.82rem;font-weight:700}.shared-band{border:1px dashed var(--leaf);background:var(--leaf-soft);border-radius:14px;padding:10px;margin-bottom:10px}.section-label{font-size:.72rem;color:var(--leaf);font-weight:800;margin-bottom:7px;text-transform:uppercase;letter-spacing:.08em}.lanes{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:9px}.lane{border:1px solid var(--line);border-radius:14px;min-width:0;background:#fff;overflow:hidden}.lane>header{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;padding:10px 11px;border-bottom:1px solid var(--line);background:#fafbf8}.lane h3{margin:0;font-size:.98rem}.lane header p{display:flex;align-items:center;gap:5px;margin:3px 0 0;color:var(--muted);font-size:.76rem}.status-dot.off{background:#b79886}.lane-count{font-size:.68rem;color:var(--muted);white-space:nowrap}.lane-events,.week-events{padding:8px;display:grid;gap:7px}.event-card{border:1px solid var(--line);border-left:4px solid var(--leaf);border-radius:10px;padding:8px 9px;background:#fff;min-width:0}.event-card.event-shared{border-left-color:var(--clay)}.event-card-top{display:flex;align-items:center;justify-content:space-between;gap:8px}.event-time{font-size:.75rem;color:var(--muted);font-weight:750}.kind-pill{font-size:.63rem;text-transform:uppercase;letter-spacing:.055em;font-weight:800;color:var(--muted)}.event-card h4{margin:2px 0 3px;font-size:.88rem;line-height:1.25}.event-card p{margin:0 0 5px;color:var(--muted);font-size:.76rem;line-height:1.35}.event-meta{display:flex;align-items:center;gap:5px;flex-wrap:wrap}.event-service-context{display:inline-flex;align-items:center;gap:5px;min-width:0}.service-family-icon{width:16px;height:16px;flex:0 0 16px}.event-detail-separator{color:var(--line-strong)}.appointment-reference{color:var(--muted);font-size:.68rem;margin:0 0 5px}.provenance{display:inline-block;font-size:.65rem;border-radius:999px;padding:3px 6px}.provenance.canonical{background:var(--leaf-soft);color:var(--leaf)}.week-grid{display:grid;grid-template-columns:repeat(var(--week-lane-count),minmax(168px,1fr));gap:7px;overflow:auto;padding-bottom:4px;scroll-snap-type:x proximity}.week-day{border:1px solid var(--line);border-radius:12px;min-width:168px;background:#fff;overflow:hidden;scroll-snap-align:start}.week-day>header{position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;gap:6px;padding:8px 9px;border-bottom:1px solid var(--line);font-size:.8rem;font-weight:800;background:#fafbf8}.week-day>header small{font-size:.65rem;color:var(--muted);font-weight:650}.agenda-view{max-width:920px;margin:0 auto}.agenda-day{margin:0 0 16px}.agenda-day>header{position:sticky;top:0;background:var(--panel);padding:6px 0;z-index:2;border-bottom:1px solid var(--line)}.agenda-day h3{font-size:.9rem;margin:0;color:var(--muted)}.agenda-day .event-card{margin-top:7px}.empty{color:var(--muted);font-size:.8rem;padding:13px;text-align:center}.empty.large{padding:40px}.footer-note{margin-top:14px;color:var(--muted);font-size:.74rem;text-align:center;line-height:1.45}@media(max-width:1050px){.controls{grid-template-columns:auto auto}.practitioner-control{grid-column:1/-1}.filters{justify-content:flex-start}.scan-summary{grid-template-columns:1fr auto}.summary-context{display:none}.summary-metrics{grid-template-columns:repeat(3,minmax(80px,1fr))}}@media(max-width:700px){.shell{padding:10px 10px 28px}.topbar{align-items:start;flex-direction:column;margin-bottom:10px}.topbar-side{justify-items:start;width:100%}.truth-note{text-align:left}.access-controls,.operational-actions{justify-content:flex-start;width:100%}.action-link,.signout-button{min-height:44px}.operational-actions{display:grid;grid-template-columns:1fr}.action-link{width:100%}.controls{position:sticky;top:0;z-index:5;grid-template-columns:1fr 1fr;gap:9px;padding:9px}.practitioner-control{grid-column:1/-1}.control-label{font-size:.62rem}.nav-button,.view-tab,.filter,.scope-pill{min-height:44px;padding:8px 12px}.nav-word{display:none}.period-nav,.view-tabs{display:grid;grid-template-columns:repeat(3,1fr)}.scan-summary{grid-template-columns:1fr;margin-bottom:8px;padding:9px;overflow:auto}.summary-metrics{grid-template-columns:repeat(3,minmax(105px,1fr));min-width:350px}.provenance-key{display:none}.calendar-view{border-radius:14px;padding:12px}.view-heading{align-items:flex-start}.view-heading h2{font-size:1.08rem}.read-only-badge{font-size:.7rem}.lanes{grid-template-columns:1fr}.event-card{padding:10px;min-height:44px}.week-grid{grid-template-columns:repeat(var(--week-lane-count),minmax(82vw,1fr));margin:0 -2px}.week-day{min-width:82vw}.agenda-day>header{top:99px}.footer-note{text-align:left}}`;
}

function calendarViewParityStyles() {
  return `.view-practitioner-context{display:flex;align-items:center;gap:10px;margin:-2px 0 11px;padding:8px 10px;border:1px solid var(--line);border-radius:11px;background:#fafbf8}.view-practitioner-context .section-label{flex:0 0 auto;margin:0}.view-practitioner-list{display:flex;align-items:center;gap:5px;min-width:0;overflow:auto;scrollbar-width:thin}.view-practitioner{display:inline-flex;align-items:center;gap:5px;flex:0 0 auto;padding:5px 8px;border:1px solid var(--line);border-radius:999px;background:#fff;font-size:.7rem;font-weight:800}.event-practitioners{display:inline-flex;align-items:center;gap:5px;max-width:100%;padding:2px 6px;border-radius:999px;background:var(--leaf-soft);color:var(--leaf-deep);font-size:.68rem;font-weight:800}.event-practitioners>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.event-practitioner-compact,.event-time-start{display:none}.event-practitioners .status-dot{flex:0 0 7px;width:7px;height:7px}.month-grid{overflow:hidden;border:1px solid var(--line);border-radius:13px;background:#fff}.month-weekdays,.month-days{display:grid;grid-template-columns:repeat(6,minmax(0,1fr))}.month-weekdays{border-bottom:1px solid var(--line);background:#fafbf8}.month-weekdays span{padding:7px 8px;text-align:right;color:var(--muted);font-size:.66rem;font-weight:850;text-transform:uppercase;letter-spacing:.07em}.month-day{position:relative;isolation:isolate;min-width:0;min-height:154px;padding:7px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);background:#fff}.month-day:nth-child(6n){border-right:0}.month-day.outside-month{background:#f8f8f4;color:var(--muted)}.month-day-link{position:absolute;inset:0;z-index:1;border-radius:7px}.month-day-link:hover{background:var(--leaf-soft)}.month-day-link:focus-visible{outline:3px solid var(--leaf);outline-offset:-3px;background:var(--leaf-soft)}.month-day-head{position:relative;z-index:2;pointer-events:none;margin:-3px -3px 5px}.month-day-summary{display:flex;align-items:center;justify-content:flex-end;gap:5px;min-height:30px;padding:3px 5px;font-size:.76rem;font-weight:850}.month-day-summary small{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;border-radius:999px;background:var(--leaf-soft);color:var(--leaf);font-size:.6rem}.month-day-owners{display:none}.month-holiday{display:flex;align-items:flex-start;gap:5px;margin:1px 3px 6px;padding:4px 6px;border:1px solid #ead6cc;border-radius:7px;background:#f8eee8;color:#704f3f;font-size:.64rem;font-weight:800;line-height:1.2}.month-holiday-dot{flex:0 0 7px;width:7px;height:7px;margin-top:2px;border-radius:50%;background:var(--clay)}.month-events{position:relative;z-index:3;display:grid;gap:4px}.month-event{min-width:0}.month-event .event-card{padding:5px 6px;border-left-width:3px;border-radius:7px}.month-event .event-card-top{gap:4px}.month-event .event-time{font-size:.62rem}.month-event .kind-pill,.month-event .event-client-mobile,.month-event .appointment-reference,.month-event .provenance{display:none}.month-event .event-card h4{margin:1px 0;font-size:.7rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.month-event .event-meta{display:grid;gap:2px;margin-top:3px}.month-event .event-service-context,.month-event .event-state,.month-event .event-detail-separator{display:none}.month-event .event-practitioners{max-width:100%;font-size:.58rem}.month-event .event-card-actions{justify-content:flex-end}.month-event .event-operation{min-width:32px;min-height:30px;padding:4px 7px;font-size:.6rem}.month-more{position:relative;z-index:3;display:block;margin-top:4px;padding:4px;color:var(--leaf-deep);font-size:.65rem;font-weight:850;text-align:right}.month-more:hover,.month-more:focus-visible{text-decoration:underline}.month-view .view-heading{margin-bottom:10px}@media(max-width:700px){.view-practitioner-context{display:grid;gap:6px;padding:8px}.view-practitioner-list{padding-bottom:2px}.view-practitioner{min-height:32px}.event-practitioners{white-space:normal}.month-view{padding:9px!important}.month-view .view-practitioner-context{margin-bottom:9px}.month-grid{border-radius:10px}.month-weekdays span{padding:6px 1px;text-align:center;font-size:.58rem}.month-days{gap:0}.month-day{min-height:124px;padding:0}.month-day-link{border-radius:0;touch-action:manipulation}.month-day-head{display:grid;align-content:start;min-height:54px;margin:0}.month-day-summary{position:relative;display:grid;place-items:center;align-content:center;gap:1px;min-height:48px;padding:3px 1px;font-size:.74rem}.month-day-summary small{position:absolute;right:3px;top:3px;min-width:16px;height:16px;font-size:.54rem}.month-day-owners{display:block;max-width:100%;overflow:hidden;color:var(--muted);font-size:.5rem;font-weight:850;line-height:1;white-space:nowrap;text-overflow:ellipsis}.month-holiday{gap:3px;margin:0 2px 4px;padding:3px;border-radius:5px;font-size:.5rem;line-height:1.1;overflow-wrap:anywhere}.month-holiday-dot{flex-basis:5px;width:5px;height:5px;margin-top:1px}.month-events{display:grid;padding:0 2px 3px;gap:2px}.month-event .event-card{min-height:0;padding:3px 2px;border-left-width:3px;border-radius:4px}.month-event .event-card-top{display:block}.month-event .event-time{font-size:.5rem;line-height:1}.month-event .event-time-range{display:none}.month-event .event-time-start{display:inline}.month-event .event-card h4{margin:2px 0 0;font-size:.52rem;line-height:1.05}.month-event .event-meta,.month-event .event-card-actions{display:none}.month-more{display:block;margin:1px 2px 3px;padding:2px;font-size:.52rem;line-height:1;text-align:left}.month-day.outside-month .month-day-head,.month-day.outside-month .month-events{opacity:.48}}`;
}

function operationalStyles() {
  return `.event-card-actions{display:flex;align-items:center;justify-content:space-between;gap:8px}.event-operation,.lane-actions button{border:1px solid var(--line-strong);background:#fff;color:var(--leaf-deep);border-radius:999px;min-height:32px;padding:5px 9px;font:inherit;font-size:.68rem;font-weight:800;cursor:pointer}.event-operation:hover,.lane-actions button:hover{border-color:var(--leaf);background:var(--leaf-soft)}.lane-heading-actions{display:grid;justify-items:end;gap:7px}.lane-actions{display:flex;justify-content:flex-end;gap:5px;flex-wrap:wrap}.lane[data-calendar-drop-target="true"],.week-day[data-calendar-drop-target="true"]{outline:2px solid transparent;outline-offset:-2px}.event-card[draggable="true"]{cursor:grab}.event-card[draggable="true"]:active{cursor:grabbing}.operation-status{display:block;min-height:1.2em;margin:5px 0 10px;color:var(--muted);font-size:.78rem}.operation-status:empty{display:none}.operation-status[data-tone="working"]{color:var(--leaf-deep);font-weight:750}.operation-status[data-tone="error"]{color:#8a3128;font-weight:750}@media(max-width:700px){.event-operation,.lane-actions button{min-height:44px;padding:8px 11px}.lane-heading-actions{justify-items:stretch}.lane-actions{display:grid;grid-template-columns:repeat(3,1fr)}.lane-actions button{padding:5px;font-size:.63rem}.event-card-actions{margin-top:7px}}`;
}

function calendarViewParityResponsiveStyles() {
  return `@media(max-width:700px){.period-nav{grid-template-columns:repeat(3,1fr)}.view-tabs{grid-template-columns:repeat(4,minmax(0,1fr))}.view-tab{padding-left:5px;padding-right:5px;font-size:.73rem}}`;
}

function spatialPhoneWeekStyles() {
  return `.week-day-date{display:flex;align-items:baseline;gap:4px;min-width:0}.week-day-number{font-size:.9em}.week-day-month{color:var(--muted);font-weight:700}
@media(max-width:700px){
body[data-calendar-view="week"] .workspace-main .shell{padding-top:8px!important}
body[data-calendar-view="week"] .workspace-main .brand p,body[data-calendar-view="week"] .workspace-main .truth-note,body[data-calendar-view="week"] .workspace-main .scan-summary{display:none!important}
body[data-calendar-view="week"] .workspace-main .topbar{margin-bottom:7px!important}
body[data-calendar-view="week"] .workspace-main .operational-actions{display:flex!important;width:auto!important}
body[data-calendar-view="week"] .workspace-main .operational-actions .action-link{width:auto!important}
body[data-calendar-view="week"] .workspace-main .controls{grid-template-columns:minmax(0,1fr) auto!important;gap:7px!important;padding:8px!important;margin-bottom:7px!important}
body[data-calendar-view="week"] .workspace-main .controls .control-label{display:none!important}
body[data-calendar-view="week"] .workspace-main .controls .control-group:nth-child(1){grid-column:1;grid-row:1}
body[data-calendar-view="week"] .workspace-main .controls .control-group:nth-child(2){grid-column:1/-1;grid-row:2}
body[data-calendar-view="week"] .workspace-main .controls .practitioner-control{grid-column:2!important;grid-row:1}
body[data-calendar-view="week"] .workspace-main .period-nav,body[data-calendar-view="week"] .workspace-main .view-tabs{gap:4px!important}
body[data-calendar-view="week"] .workspace-main .nav-button,body[data-calendar-view="week"] .workspace-main .view-tab{padding-left:7px!important;padding-right:7px!important}
body[data-calendar-view="week"] .workspace-main .filters{width:auto!important;padding:0!important}
body[data-calendar-view="week"] .workspace-main .people-picker>summary{max-width:130px;padding:7px 9px!important}
body[data-calendar-view="week"] .workspace-main .people-picker>summary strong{min-width:0;max-width:78px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
body[data-calendar-view="week"] .workspace-main .people-form{position:absolute;right:0;top:calc(100% + 7px);width:min(300px,calc(100vw - 28px));box-shadow:0 16px 34px rgba(32,50,43,.18)}
body[data-calendar-view="week"] .workspace-main .week-view{padding:5px!important;overflow:visible!important}
body[data-calendar-view="week"] .workspace-main .week-view .view-heading{min-height:35px;margin:0 3px 5px!important;align-items:center!important}
body[data-calendar-view="week"] .workspace-main .week-view .view-heading .eyebrow,body[data-calendar-view="week"] .workspace-main .week-view .read-only-badge{display:none!important}
body[data-calendar-view="week"] .workspace-main .week-view .view-heading h2{margin:0!important;font-size:.92rem!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
body[data-calendar-view="week"] .workspace-main .week-view .week-time-grid{display:grid!important;grid-template-columns:38px minmax(0,1fr)!important;overflow:visible!important;border:1px solid var(--line)!important;border-radius:10px!important;background:#fff!important;margin:0!important}
body[data-calendar-view="week"] .workspace-main .week-view .time-rail{display:block!important;width:auto!important;margin-top:43px!important;height:${((GRID_END_MINUTES - GRID_START_MINUTES) / 60) * GRID_PIXELS_PER_HOUR}px!important;border-right:1px solid var(--line)!important;background:#fafbf8!important}
body[data-calendar-view="week"] .workspace-main .week-view .time-rail span{right:4px!important;font-size:.53rem!important;letter-spacing:-.02em}
body[data-calendar-view="week"] .workspace-main .week-view .week-grid{display:grid!important;grid-template-columns:repeat(6,minmax(0,1fr))!important;min-width:0!important;width:100%!important;gap:0!important;overflow:visible!important;margin:0!important;padding:0!important;scroll-snap-type:none!important}
body[data-calendar-view="week"] .workspace-main .week-view .week-day{position:relative!important;display:block!important;min-width:0!important;width:auto!important;border:0!important;border-right:1px solid var(--line)!important;border-radius:0!important;overflow:visible!important;background:#fff!important;scroll-snap-align:none!important}
body[data-calendar-view="week"] .workspace-main .week-view .week-day:last-child{border-right:0!important}
body[data-calendar-view="week"] .workspace-main .week-view .week-day>header{position:sticky!important;top:0!important;z-index:5!important;display:grid!important;place-items:center!important;height:43px!important;min-height:43px!important;padding:3px 1px!important;border-bottom:1px solid var(--line)!important;background:#fafbf8!important;text-align:center!important}
body[data-calendar-view="week"] .workspace-main .week-view .week-day-date{display:grid!important;gap:0!important;place-items:center!important;line-height:1!important}
body[data-calendar-view="week"] .workspace-main .week-view .week-day-weekday{font-size:.53rem!important;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
body[data-calendar-view="week"] .workspace-main .week-view .week-day-number{font-size:.77rem!important;line-height:1.15!important}
body[data-calendar-view="week"] .workspace-main .week-view .week-day-month,body[data-calendar-view="week"] .workspace-main .week-view .week-day>header small{display:none!important}
body[data-calendar-view="week"] .workspace-main .week-view .week-day>.closure-strip{position:absolute!important;top:43px!important;left:0!important;right:0!important;z-index:4!important;max-height:32px!important;margin:0!important;padding:3px 1px!important;border-radius:0!important;overflow:hidden!important;font-size:.48rem!important;line-height:1.05!important;text-align:center!important}
body[data-calendar-view="week"] .workspace-main .week-view .time-column{position:relative!important;display:block!important;height:${((GRID_END_MINUTES - GRID_START_MINUTES) / 60) * GRID_PIXELS_PER_HOUR}px!important;min-height:${((GRID_END_MINUTES - GRID_START_MINUTES) / 60) * GRID_PIXELS_PER_HOUR}px!important;padding:0!important;background:repeating-linear-gradient(to bottom,transparent 0,transparent ${GRID_PIXELS_PER_HOUR - 1}px,var(--line) ${GRID_PIXELS_PER_HOUR - 1}px,var(--line) ${GRID_PIXELS_PER_HOUR}px)!important}
body[data-calendar-view="week"] .workspace-main .week-view .positioned-event{position:absolute!important;z-index:2!important;top:var(--event-top)!important;left:var(--week-event-left,2px)!important;right:auto!important;width:var(--week-event-width,calc(100% - 4px))!important;height:var(--event-height)!important;min-height:44px!important;overflow:visible!important;container-type:size!important}
body[data-calendar-view="week"] .workspace-main .week-view .positioned-event .event-card{position:relative!important;height:100%!important;min-height:44px!important;padding:3px 2px!important;border-left-width:2px!important;border-radius:5px!important;overflow:hidden!important;box-shadow:none!important}
body[data-calendar-view="week"] .workspace-main .week-view .positioned-event .event-card:focus-within{outline:2px solid var(--leaf-deep)!important;outline-offset:1px!important;z-index:4!important}
body[data-calendar-view="week"] .workspace-main .week-view .positioned-event .event-card-top{display:block!important;min-height:0!important;padding:0!important}
body[data-calendar-view="week"] .workspace-main .week-view .positioned-event .event-time{display:block!important;font-size:.5rem!important;line-height:1!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:clip!important;color:var(--leaf-deep)!important}
body[data-calendar-view="week"] .workspace-main .week-view .positioned-event .event-time-range{display:none!important}
body[data-calendar-view="week"] .workspace-main .week-view .positioned-event .event-time-start{display:inline!important}
body[data-calendar-view="week"] .workspace-main .week-view .positioned-event .kind-pill,body[data-calendar-view="week"] .workspace-main .week-view .positioned-event .event-client-mobile,body[data-calendar-view="week"] .workspace-main .week-view .positioned-event .appointment-reference,body[data-calendar-view="week"] .workspace-main .week-view .positioned-event .provenance{display:none!important}
body[data-calendar-view="week"] .workspace-main .week-view .positioned-event .event-card h4{display:-webkit-box!important;margin:2px 0 0!important;padding:0!important;font-size:.57rem!important;line-height:1.05!important;white-space:normal!important;overflow:hidden!important;text-overflow:ellipsis!important;-webkit-box-orient:vertical!important;-webkit-line-clamp:2!important;overflow-wrap:anywhere!important}
body[data-calendar-view="week"] .workspace-main .week-view .positioned-event .event-meta{display:block!important;margin:2px 0 0!important;padding:0!important;font-size:.5rem!important;line-height:1!important;white-space:nowrap!important;overflow:hidden!important}
body[data-calendar-view="week"] .workspace-main .week-view .positioned-event .event-practitioners{display:block!important;max-width:100%!important;padding:0!important;border-radius:0!important;background:transparent!important;font-size:.5rem!important;line-height:1!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
body[data-calendar-view="week"] .workspace-main .week-view .positioned-event .event-practitioners .status-dot,body[data-calendar-view="week"] .workspace-main .week-view .positioned-event .event-practitioner-full,body[data-calendar-view="week"] .workspace-main .week-view .positioned-event .event-service-context,body[data-calendar-view="week"] .workspace-main .week-view .positioned-event .event-state,body[data-calendar-view="week"] .workspace-main .week-view .positioned-event .event-detail-separator{display:none!important}
body[data-calendar-view="week"] .workspace-main .week-view .positioned-event .event-practitioner-compact{display:block!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}
body[data-calendar-view="week"] .workspace-main .week-view .positioned-event .event-card-actions{position:static!important;display:block!important;margin:0!important}
body[data-calendar-view="week"] .workspace-main .week-view .positioned-event .event-operation{position:absolute!important;inset:0!important;z-index:3!important;width:100%!important;height:100%!important;min-width:44px!important;min-height:44px!important;margin:0!important;padding:0!important;border:0!important;border-radius:5px!important;opacity:0!important;cursor:pointer!important}
body[data-calendar-view="week"] .workspace-main .footer-note{margin-top:8px!important}
@container (min-height:84px){body[data-calendar-view="week"] .workspace-main .week-view .positioned-event .event-service-context{display:flex!important;align-items:center!important;gap:2px!important;margin-top:2px!important;min-width:0!important}body[data-calendar-view="week"] .workspace-main .week-view .positioned-event .event-service-context .service-family-icon{display:none!important}body[data-calendar-view="week"] .workspace-main .week-view .positioned-event .event-service-context>span:last-child{display:block!important;min-width:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}}
}`;
}

function calendarFirstPhoneStyles() {
  const gridHeight = ((GRID_END_MINUTES - GRID_START_MINUTES) / 60) * GRID_PIXELS_PER_HOUR;
  return `.calendar-booking-hint{margin:0 0 7px;color:var(--muted);font-size:.72rem;font-weight:700}.calendar-booking-slots{position:absolute;inset:0;z-index:1;pointer-events:none}.calendar-booking-slot{position:absolute;top:var(--slot-top);left:0;right:0;height:var(--slot-height);pointer-events:auto;border-top:1px dashed transparent;color:var(--leaf-deep);outline-offset:-2px}.calendar-booking-slot>span{position:absolute;right:7px;top:50%;transform:translateY(-50%);display:grid;place-items:center;width:20px;height:20px;border-radius:999px;background:var(--leaf-soft);font-size:.8rem;font-weight:900;opacity:0}.calendar-booking-slot:hover,.calendar-booking-slot:focus-visible{background:rgba(231,238,233,.58);border-top-color:rgba(63,102,83,.22);outline:2px solid var(--leaf)}.calendar-booking-slot:hover>span,.calendar-booking-slot:focus-visible>span{opacity:1}
@media(max-width:700px){
body[data-calendar-view="day"] .workspace-main .shell,body[data-calendar-view="week"] .workspace-main .shell,body[data-calendar-view="month"] .workspace-main .shell{padding:8px 8px 20px!important}
body[data-calendar-view="day"] .workspace-main .brand p,body[data-calendar-view="week"] .workspace-main .brand p,body[data-calendar-view="month"] .workspace-main .brand p,body[data-calendar-view="day"] .workspace-main .truth-note,body[data-calendar-view="week"] .workspace-main .truth-note,body[data-calendar-view="month"] .workspace-main .truth-note,body[data-calendar-view="day"] .workspace-main .scan-summary,body[data-calendar-view="week"] .workspace-main .scan-summary,body[data-calendar-view="month"] .workspace-main .scan-summary{display:none!important}
body[data-calendar-view="day"] .workspace-main .topbar,body[data-calendar-view="week"] .workspace-main .topbar,body[data-calendar-view="month"] .workspace-main .topbar{display:flex!important;flex-direction:row!important;align-items:center!important;justify-content:space-between!important;gap:8px!important;margin:0 2px 7px!important}
body[data-calendar-view="day"] .workspace-main .brand h1,body[data-calendar-view="week"] .workspace-main .brand h1,body[data-calendar-view="month"] .workspace-main .brand h1{font-size:1.22rem!important}
body[data-calendar-view="day"] .workspace-main .topbar-side,body[data-calendar-view="week"] .workspace-main .topbar-side,body[data-calendar-view="month"] .workspace-main .topbar-side{display:flex!important;width:auto!important;justify-items:auto!important;align-items:center!important;gap:5px!important}
body[data-calendar-view="day"] .workspace-main .operational-actions,body[data-calendar-view="week"] .workspace-main .operational-actions,body[data-calendar-view="month"] .workspace-main .operational-actions{display:flex!important;width:auto!important}
body[data-calendar-view="day"] .workspace-main .operational-actions .action-link,body[data-calendar-view="week"] .workspace-main .operational-actions .action-link,body[data-calendar-view="month"] .workspace-main .operational-actions .action-link{width:auto!important;min-height:44px!important;padding:8px 13px!important}
body[data-calendar-view="day"] .workspace-main .access-controls,body[data-calendar-view="week"] .workspace-main .access-controls,body[data-calendar-view="month"] .workspace-main .access-controls{display:flex!important;gap:0!important}
body[data-calendar-view="day"] .workspace-main .access-status,body[data-calendar-view="week"] .workspace-main .access-status,body[data-calendar-view="month"] .workspace-main .access-status{display:none!important}
body[data-calendar-view="day"] .workspace-main .controls,body[data-calendar-view="week"] .workspace-main .controls,body[data-calendar-view="month"] .workspace-main .controls{position:relative!important;top:auto!important;z-index:12!important;grid-template-columns:minmax(0,1fr) auto!important;gap:6px!important;padding:7px!important;margin-bottom:7px!important;border-radius:12px!important}
body[data-calendar-view="day"] .workspace-main .controls .control-label,body[data-calendar-view="week"] .workspace-main .controls .control-label,body[data-calendar-view="month"] .workspace-main .controls .control-label{display:none!important}
body[data-calendar-view="day"] .workspace-main .controls .control-group:nth-child(1),body[data-calendar-view="week"] .workspace-main .controls .control-group:nth-child(1),body[data-calendar-view="month"] .workspace-main .controls .control-group:nth-child(1){grid-column:1;grid-row:1}
body[data-calendar-view="day"] .workspace-main .controls .control-group:nth-child(2),body[data-calendar-view="week"] .workspace-main .controls .control-group:nth-child(2),body[data-calendar-view="month"] .workspace-main .controls .control-group:nth-child(2){grid-column:1/-1;grid-row:2}
body[data-calendar-view="day"] .workspace-main .controls .practitioner-control,body[data-calendar-view="week"] .workspace-main .controls .practitioner-control,body[data-calendar-view="month"] .workspace-main .controls .practitioner-control{grid-column:2!important;grid-row:1!important}
body[data-calendar-view="day"] .workspace-main .period-nav,body[data-calendar-view="week"] .workspace-main .period-nav,body[data-calendar-view="month"] .workspace-main .period-nav{display:grid!important;grid-template-columns:44px minmax(74px,1fr) 44px!important;gap:4px!important}
body[data-calendar-view="day"] .workspace-main .view-tabs,body[data-calendar-view="week"] .workspace-main .view-tabs,body[data-calendar-view="month"] .workspace-main .view-tabs{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:4px!important}
body[data-calendar-view="day"] [data-calendar-view-option="agenda"],body[data-calendar-view="week"] [data-calendar-view-option="agenda"],body[data-calendar-view="month"] [data-calendar-view-option="agenda"]{display:none!important}
body[data-calendar-view="day"] .workspace-main .nav-button,body[data-calendar-view="week"] .workspace-main .nav-button,body[data-calendar-view="month"] .workspace-main .nav-button,body[data-calendar-view="day"] .workspace-main .view-tab,body[data-calendar-view="week"] .workspace-main .view-tab,body[data-calendar-view="month"] .workspace-main .view-tab{min-height:44px!important;padding:7px 5px!important;font-size:.75rem!important}
body[data-calendar-view="day"] .workspace-main .filters,body[data-calendar-view="week"] .workspace-main .filters,body[data-calendar-view="month"] .workspace-main .filters{width:auto!important;padding:0!important;overflow:visible!important}
body[data-calendar-view="day"] .workspace-main .people-picker>summary,body[data-calendar-view="week"] .workspace-main .people-picker>summary,body[data-calendar-view="month"] .workspace-main .people-picker>summary{max-width:136px;min-height:44px!important;padding:7px 9px!important}
body[data-calendar-view="day"] .workspace-main .people-picker>summary strong,body[data-calendar-view="week"] .workspace-main .people-picker>summary strong,body[data-calendar-view="month"] .workspace-main .people-picker>summary strong{min-width:0;max-width:82px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
body[data-calendar-view="day"] .workspace-main .people-form,body[data-calendar-view="week"] .workspace-main .people-form,body[data-calendar-view="month"] .workspace-main .people-form{position:absolute!important;right:0!important;top:calc(100% + 7px)!important;width:min(310px,calc(100vw - 24px))!important;margin:0!important;box-shadow:0 16px 34px rgba(32,50,43,.18)!important}
body[data-calendar-view="day"] .workspace-main .operation-status,body[data-calendar-view="week"] .workspace-main .operation-status,body[data-calendar-view="month"] .workspace-main .operation-status{margin:0 2px 5px!important;min-height:0!important;font-size:.66rem!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
body[data-calendar-view="day"] .workspace-main .calendar-view,body[data-calendar-view="week"] .workspace-main .calendar-view,body[data-calendar-view="month"] .workspace-main .calendar-view{padding:6px!important;border-radius:12px!important}
body[data-calendar-view="day"] .workspace-main .view-heading,body[data-calendar-view="week"] .workspace-main .view-heading,body[data-calendar-view="month"] .workspace-main .view-heading{min-height:34px;margin:0 3px 5px!important;align-items:center!important;flex-wrap:nowrap!important}
body[data-calendar-view="day"] .workspace-main .view-heading .eyebrow,body[data-calendar-view="week"] .workspace-main .view-heading .eyebrow,body[data-calendar-view="month"] .workspace-main .view-heading .eyebrow,body[data-calendar-view="day"] .workspace-main .read-only-badge,body[data-calendar-view="week"] .workspace-main .read-only-badge,body[data-calendar-view="month"] .workspace-main .read-only-badge{display:none!important}
body[data-calendar-view="day"] .workspace-main .view-heading h2,body[data-calendar-view="week"] .workspace-main .view-heading h2,body[data-calendar-view="month"] .workspace-main .view-heading h2{margin:0!important;font-size:.94rem!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
body[data-calendar-view="day"] .workspace-main .calendar-booking-hint,body[data-calendar-view="week"] .workspace-main .calendar-booking-hint{margin:0 3px 6px!important;font-size:.66rem!important}
body[data-calendar-view="week"] .workspace-main .view-practitioner-context{display:flex!important;gap:6px!important;min-height:38px!important;margin:0 3px 6px!important;padding:4px 6px!important;overflow:hidden!important}
body[data-calendar-view="week"] .workspace-main .view-practitioner-context .section-label{display:none!important}
body[data-calendar-view="week"] .workspace-main .view-practitioner-list{gap:4px!important;padding:0!important;overflow-x:auto!important}
body[data-calendar-view="week"] .workspace-main .view-practitioner{min-height:30px!important;padding:4px 7px!important;font-size:.65rem!important}
body[data-calendar-view="day"] .workspace-main .time-grid,body[data-calendar-view="week"] .workspace-main .time-grid{margin:0!important;border-radius:9px!important;overscroll-behavior-inline:contain;-webkit-overflow-scrolling:touch;scrollbar-width:thin}
body[data-calendar-view="day"] .workspace-main .day-time-grid{grid-template-columns:44px max-content!important;overflow-x:auto!important;overflow-y:auto!important;max-height:calc(100vh - 258px)!important}
body[data-calendar-view="day"] .workspace-main .day-time-grid .time-rail{position:sticky!important;left:0!important;z-index:7!important;width:44px!important;margin-top:58px!important;height:${gridHeight}px!important}
body[data-calendar-view="day"] .workspace-main .day-time-grid .time-rail span,body[data-calendar-view="week"] .workspace-main .week-time-grid .time-rail span{right:5px!important;font-size:.57rem!important}
body[data-calendar-view="day"] .workspace-main .day-time-grid .lanes{display:grid!important;grid-template-columns:repeat(var(--lane-count),210px)!important;min-width:max-content!important;width:auto!important;gap:0!important}
body[data-calendar-view="day"] .workspace-main .day-time-grid .lane{min-width:210px!important;width:210px!important;border-right:1px solid var(--line)!important}
body[data-calendar-view="day"] .workspace-main .day-time-grid .lane>header{height:58px!important;min-height:58px!important;padding:7px 9px!important}
body[data-calendar-view="day"] .workspace-main .day-time-grid .lane h3{font-size:.86rem!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
body[data-calendar-view="day"] .workspace-main .day-time-grid .lane header p{font-size:.62rem!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
body[data-calendar-view="week"] .workspace-main .week-time-grid{display:grid!important;grid-template-columns:44px max-content!important;overflow-x:auto!important;overflow-y:auto!important;max-height:calc(100vh - 258px)!important;background:#fff!important}
body[data-calendar-view="week"] .workspace-main .week-time-grid .time-rail{position:sticky!important;left:0!important;z-index:7!important;width:44px!important;margin-top:72px!important;height:${gridHeight}px!important}
body[data-calendar-view="week"] .workspace-main .week-grid{display:grid!important;grid-template-columns:repeat(var(--week-lane-count),220px)!important;min-width:calc(var(--week-lane-count) * 220px)!important;width:max-content!important;gap:0!important;overflow:visible!important;margin:0!important;padding:0!important;scroll-snap-type:none!important}
body[data-calendar-view="week"] .workspace-main .week-day{position:relative!important;display:block!important;min-width:220px!important;width:220px!important;border:0!important;border-right:1px solid var(--line)!important;border-radius:0!important;overflow:visible!important;background:#fff!important}
body[data-calendar-view="week"] .workspace-main .week-day>header{position:sticky!important;top:0!important;z-index:5!important;align-items:flex-start!important;height:72px!important;min-height:72px!important;padding:6px 8px!important;background:#fafbf8!important}
body[data-calendar-view="week"] .workspace-main .week-day-date{display:flex!important;align-items:baseline!important;gap:4px!important;line-height:1!important}
body[data-calendar-view="week"] .workspace-main .week-day-weekday{font-size:.66rem!important;text-transform:uppercase;color:var(--muted)}
body[data-calendar-view="week"] .workspace-main .week-day-number{font-size:.9rem!important}
body[data-calendar-view="week"] .workspace-main .week-day-month{font-size:.62rem!important}
body[data-calendar-view="week"] .workspace-main .week-day>header small{font-size:.59rem!important}
body[data-calendar-view="week"] .workspace-main .week-lane-heading{display:grid!important;gap:3px!important;min-width:0!important}
body[data-calendar-view="week"] .workspace-main .week-practitioner-name{display:block!important;max-width:160px!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;font-size:.82rem!important;line-height:1.1!important}
body[data-calendar-view="week"] .workspace-main .week-practitioner-hours{display:flex!important;align-items:center!important;gap:4px!important;max-width:160px!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;color:var(--muted)!important;font-size:.58rem!important;font-weight:650!important}
body[data-calendar-view="week"] .workspace-main .week-practitioner-hours .status-dot{flex:0 0 7px!important;width:7px!important;height:7px!important}
body[data-calendar-view="week"] .workspace-main .week-day>.closure-strip{position:absolute!important;top:72px!important;left:0!important;right:0!important;z-index:4!important;max-height:34px!important;margin:0!important;padding:4px!important;border-radius:0!important;overflow:hidden!important;font-size:.55rem!important}
body[data-calendar-view="week"] .workspace-main .time-column{height:${gridHeight}px!important;min-height:${gridHeight}px!important}
body[data-calendar-view="day"] .workspace-main .positioned-event,body[data-calendar-view="week"] .workspace-main .positioned-event{position:absolute!important;z-index:3!important;top:var(--event-top)!important;left:var(--week-event-left,4px)!important;right:auto!important;width:var(--week-event-width,calc(100% - 8px))!important;height:var(--event-height)!important;min-height:44px!important;overflow:visible!important;container-type:size!important}
body[data-calendar-view="day"] .workspace-main .positioned-event .event-card,body[data-calendar-view="week"] .workspace-main .positioned-event .event-card{position:relative!important;height:100%!important;min-height:44px!important;padding:5px 7px!important;border-left-width:3px!important;border-radius:7px!important;overflow:hidden!important;box-shadow:0 2px 7px rgba(32,50,43,.08)!important}
body[data-calendar-view="day"] .workspace-main .positioned-event .event-card:focus-within,body[data-calendar-view="week"] .workspace-main .positioned-event .event-card:focus-within{outline:2px solid var(--leaf-deep)!important;outline-offset:1px!important;z-index:4!important}
body[data-calendar-view="day"] .workspace-main .positioned-event .event-card-top,body[data-calendar-view="week"] .workspace-main .positioned-event .event-card-top{display:block!important;min-height:0!important;padding:0!important}
body[data-calendar-view="day"] .workspace-main .positioned-event .event-time,body[data-calendar-view="week"] .workspace-main .positioned-event .event-time{display:block!important;font-size:.65rem!important;line-height:1.05!important;color:var(--leaf-deep)!important;white-space:nowrap!important}
body[data-calendar-view="day"] .workspace-main .positioned-event .kind-pill,body[data-calendar-view="week"] .workspace-main .positioned-event .kind-pill,body[data-calendar-view="day"] .workspace-main .positioned-event .event-client-mobile,body[data-calendar-view="week"] .workspace-main .positioned-event .event-client-mobile,body[data-calendar-view="day"] .workspace-main .positioned-event .appointment-reference,body[data-calendar-view="week"] .workspace-main .positioned-event .appointment-reference,body[data-calendar-view="day"] .workspace-main .positioned-event .provenance,body[data-calendar-view="week"] .workspace-main .positioned-event .provenance{display:none!important}
body[data-calendar-view="day"] .workspace-main .positioned-event .event-card h4,body[data-calendar-view="week"] .workspace-main .positioned-event .event-card h4{display:block!important;margin:2px 0 0!important;padding:0!important;font-size:.75rem!important;line-height:1.08!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;overflow-wrap:normal!important;word-break:normal!important}
body[data-calendar-view="day"] .workspace-main .positioned-event .event-meta,body[data-calendar-view="week"] .workspace-main .positioned-event .event-meta{display:block!important;margin:3px 0 0!important;padding:0!important;font-size:.61rem!important;line-height:1.05!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
body[data-calendar-view="day"] .workspace-main .positioned-event .event-practitioners,body[data-calendar-view="week"] .workspace-main .positioned-event .event-practitioners{display:block!important;max-width:100%!important;padding:0!important;border-radius:0!important;background:transparent!important;font-size:.61rem!important;line-height:1.05!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
body[data-calendar-view="day"] .workspace-main .positioned-event .event-practitioners .status-dot,body[data-calendar-view="week"] .workspace-main .positioned-event .event-practitioners .status-dot,body[data-calendar-view="day"] .workspace-main .positioned-event .event-practitioner-full,body[data-calendar-view="week"] .workspace-main .positioned-event .event-practitioner-full,body[data-calendar-view="day"] .workspace-main .positioned-event .event-service-context,body[data-calendar-view="week"] .workspace-main .positioned-event .event-service-context,body[data-calendar-view="day"] .workspace-main .positioned-event .event-state,body[data-calendar-view="week"] .workspace-main .positioned-event .event-state,body[data-calendar-view="day"] .workspace-main .positioned-event .event-detail-separator,body[data-calendar-view="week"] .workspace-main .positioned-event .event-detail-separator{display:none!important}
body[data-calendar-view="day"] .workspace-main .positioned-event .event-practitioner-compact,body[data-calendar-view="week"] .workspace-main .positioned-event .event-practitioner-compact{display:block!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}
body[data-calendar-view="day"] .workspace-main .positioned-event .event-card-actions,body[data-calendar-view="week"] .workspace-main .positioned-event .event-card-actions{position:static!important;display:block!important;margin:0!important}
body[data-calendar-view="day"] .workspace-main .positioned-event .event-operation,body[data-calendar-view="week"] .workspace-main .positioned-event .event-operation{position:absolute!important;inset:0!important;z-index:4!important;width:100%!important;height:100%!important;min-width:44px!important;min-height:44px!important;margin:0!important;padding:0!important;border:0!important;border-radius:7px!important;opacity:0!important;cursor:pointer!important}
body[data-calendar-view="day"] .workspace-main .calendar-booking-slot,body[data-calendar-view="week"] .workspace-main .calendar-booking-slot{min-height:44px;touch-action:manipulation}
body[data-calendar-view="month"] .workspace-main .view-practitioner-context{display:none!important}
body[data-calendar-view="month"] .workspace-main .month-events,body[data-calendar-view="month"] .workspace-main .month-more{display:none!important}
body[data-calendar-view="month"] .workspace-main .month-day{min-height:58px!important}
body[data-calendar-view="month"] .workspace-main .month-day-link{min-height:58px!important}
body[data-calendar-view="day"] .workspace-main .footer-note,body[data-calendar-view="week"] .workspace-main .footer-note,body[data-calendar-view="month"] .workspace-main .footer-note{margin-top:7px!important;font-size:.65rem!important}
@container (min-height:84px){body[data-calendar-view="day"] .workspace-main .positioned-event .event-service-context,body[data-calendar-view="week"] .workspace-main .positioned-event .event-service-context{display:flex!important;align-items:center!important;gap:3px!important;margin-top:3px!important;min-width:0!important}body[data-calendar-view="day"] .workspace-main .positioned-event .event-service-context .service-family-icon,body[data-calendar-view="week"] .workspace-main .positioned-event .event-service-context .service-family-icon{display:none!important}body[data-calendar-view="day"] .workspace-main .positioned-event .event-service-context>span:last-child,body[data-calendar-view="week"] .workspace-main .positioned-event .event-service-context>span:last-child{display:block!important;min-width:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}}
}`;
}

function goldieDensityPhoneStyles() {
  const gridHeight = ((GRID_END_MINUTES - GRID_START_MINUTES) / 60) * GRID_PIXELS_PER_HOUR;
  return `.compact-week-practitioner-picker,.compact-week-active-practitioner{display:none}
@media(max-width:700px){
body[data-calendar-view="day"] .workspace-main .shell,body[data-calendar-view="week"] .workspace-main .shell,body[data-calendar-view="month"] .workspace-main .shell{padding:6px 6px 10px!important}
body[data-calendar-view="day"] .workspace-main .topbar,body[data-calendar-view="week"] .workspace-main .topbar,body[data-calendar-view="month"] .workspace-main .topbar{min-height:44px!important;margin:0 2px 4px!important;padding-left:52px!important}
body[data-calendar-view="day"] .workspace-main .brand h1,body[data-calendar-view="week"] .workspace-main .brand h1,body[data-calendar-view="month"] .workspace-main .brand h1{font-size:1rem!important;letter-spacing:-.01em}
body[data-calendar-view="day"] .workspace-main .topbar-side,body[data-calendar-view="week"] .workspace-main .topbar-side,body[data-calendar-view="month"] .workspace-main .topbar-side{margin-left:auto!important}
body[data-calendar-view="day"] .workspace-main .access-controls,body[data-calendar-view="week"] .workspace-main .access-controls,body[data-calendar-view="month"] .workspace-main .access-controls{display:none!important}
body[data-calendar-view="day"] .workspace-main .operational-actions .action-link,body[data-calendar-view="week"] .workspace-main .operational-actions .action-link,body[data-calendar-view="month"] .workspace-main .operational-actions .action-link{min-height:44px!important;padding:7px 11px!important;font-size:.75rem!important}
body[data-calendar-view="day"] .workspace-main .controls,body[data-calendar-view="week"] .workspace-main .controls,body[data-calendar-view="month"] .workspace-main .controls{gap:4px!important;padding:4px!important;margin-bottom:4px!important;border-radius:11px!important;box-shadow:none!important}
body[data-calendar-view="day"] .workspace-main .controls .control-group:nth-child(2),body[data-calendar-view="week"] .workspace-main .controls .control-group:nth-child(2),body[data-calendar-view="month"] .workspace-main .controls .control-group:nth-child(2){grid-column:1/-1!important}
body[data-calendar-view="day"] .workspace-main .period-nav,body[data-calendar-view="week"] .workspace-main .period-nav,body[data-calendar-view="month"] .workspace-main .period-nav{grid-template-columns:44px minmax(64px,1fr) 44px!important;gap:3px!important}
body[data-calendar-view="day"] .workspace-main .view-tabs,body[data-calendar-view="week"] .workspace-main .view-tabs,body[data-calendar-view="month"] .workspace-main .view-tabs{gap:3px!important}
body[data-calendar-view="day"] .workspace-main .nav-button,body[data-calendar-view="week"] .workspace-main .nav-button,body[data-calendar-view="month"] .workspace-main .nav-button,body[data-calendar-view="day"] .workspace-main .view-tab,body[data-calendar-view="week"] .workspace-main .view-tab,body[data-calendar-view="month"] .workspace-main .view-tab{padding:5px 4px!important;font-size:.72rem!important}
body[data-calendar-view="day"] .workspace-main .people-picker>summary,body[data-calendar-view="week"] .workspace-main .people-picker>summary,body[data-calendar-view="month"] .workspace-main .people-picker>summary{max-width:120px!important;padding:6px 8px!important;font-size:.72rem!important}
body[data-calendar-view="day"] .workspace-main .people-picker>summary strong,body[data-calendar-view="week"] .workspace-main .people-picker>summary strong,body[data-calendar-view="month"] .workspace-main .people-picker>summary strong{max-width:62px!important;font-size:.62rem!important}
body[data-calendar-view="day"] .workspace-main .calendar-view,body[data-calendar-view="week"] .workspace-main .calendar-view,body[data-calendar-view="month"] .workspace-main .calendar-view{padding:3px!important;border-radius:9px!important;box-shadow:none!important}
body[data-calendar-view="day"] .workspace-main .view-heading,body[data-calendar-view="week"] .workspace-main .view-heading,body[data-calendar-view="month"] .workspace-main .view-heading{min-height:40px!important;margin:0 2px 3px!important}
body[data-calendar-view="day"] .workspace-main .view-heading h2,body[data-calendar-view="week"] .workspace-main .view-heading h2,body[data-calendar-view="month"] .workspace-main .view-heading h2{font-size:.82rem!important}
body[data-calendar-view="day"] .workspace-main .calendar-booking-hint,body[data-calendar-view="week"] .workspace-main .calendar-booking-hint,body[data-calendar-view="day"] .workspace-main .shared-note,body[data-calendar-view="week"] .workspace-main .view-practitioner-context{display:none!important}
body[data-calendar-view="week"] .workspace-main .view-heading>div{min-width:0;flex:1 1 auto}
body[data-calendar-view="week"] .workspace-main .compact-week-practitioner-picker{position:relative;display:block;flex:0 0 auto}
body[data-calendar-view="week"] .workspace-main .compact-week-practitioner-picker>summary,body[data-calendar-view="week"] .workspace-main .compact-week-active-practitioner{display:flex;align-items:center;gap:5px;min-height:44px;max-width:154px;padding:6px 8px;border:1px solid var(--line);border-radius:10px;background:#fff;font-size:.64rem;font-weight:750;list-style:none;cursor:pointer}
body[data-calendar-view="week"] .workspace-main .compact-week-practitioner-picker>summary::-webkit-details-marker{display:none}
body[data-calendar-view="week"] .workspace-main .compact-week-practitioner-picker>summary>span:not(.status-dot){display:none}
body[data-calendar-view="week"] .workspace-main .compact-week-practitioner-picker>summary strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.72rem}
body[data-calendar-view="week"] .workspace-main .compact-week-practitioner-options{position:absolute;top:calc(100% + 4px);right:0;z-index:18;display:grid;gap:3px;width:min(250px,calc(100vw - 20px));padding:6px;border:1px solid var(--line);border-radius:11px;background:#fff;box-shadow:0 14px 30px rgba(32,50,43,.18)}
body[data-calendar-view="week"] .workspace-main .compact-week-practitioner-option{display:flex;align-items:center;min-height:44px;padding:8px 10px;border-radius:8px;font-size:.76rem;font-weight:750}
body[data-calendar-view="week"] .workspace-main .compact-week-practitioner-option.active{background:var(--leaf-soft);color:var(--leaf-deep)}
body[data-calendar-view="week"] .workspace-main .week-time-grid{grid-template-columns:42px max-content!important;max-height:calc(100dvh - 158px)!important}
body[data-calendar-view="week"] .workspace-main .week-time-grid .time-rail{width:42px!important;margin-top:44px!important;height:${gridHeight}px!important}
body[data-calendar-view="week"] .workspace-main .week-grid{grid-template-columns:repeat(6,170px)!important;min-width:1020px!important;width:1020px!important}
body[data-calendar-view="week"] .workspace-main .week-practitioner-lane[data-active-practitioner="false"]{display:none!important}
body[data-calendar-view="week"] .workspace-main .week-day{min-width:170px!important;width:170px!important}
body[data-calendar-view="week"] .workspace-main .week-day>header{height:44px!important;min-height:44px!important;padding:5px 7px!important;align-items:center!important}
body[data-calendar-view="week"] .workspace-main .week-practitioner-name,body[data-calendar-view="week"] .workspace-main .week-practitioner-hours{display:none!important}
body[data-calendar-view="week"] .workspace-main .week-day>.closure-strip{top:44px!important}
body[data-calendar-view="day"] .workspace-main .day-time-grid{max-height:calc(100dvh - 158px)!important}
body[data-calendar-view="month"] .workspace-main .view-heading{min-height:34px!important}
body[data-calendar-view="month"] .workspace-main .month-weekdays span{padding:4px 1px!important}
body[data-calendar-view="month"] .workspace-main .month-day,body[data-calendar-view="month"] .workspace-main .month-day-link{min-height:52px!important}
body[data-calendar-view="day"] .workspace-main .footer-note,body[data-calendar-view="week"] .workspace-main .footer-note,body[data-calendar-view="month"] .workspace-main .footer-note{display:none!important}
}`;
}

function workspaceV1Styles() {
  return `.time-grid{display:grid;grid-template-columns:58px minmax(0,1fr);overflow:auto;border:1px solid var(--line);border-radius:13px;background:#fff}.time-rail{position:relative;height:${((GRID_END_MINUTES - GRID_START_MINUTES) / 60) * GRID_PIXELS_PER_HOUR}px;border-right:1px solid var(--line);background:#fafbf8}.time-rail span{position:absolute;top:var(--grid-top);right:8px;transform:translateY(-50%);font-size:.66rem;color:var(--muted)}.time-column{position:relative;height:${((GRID_END_MINUTES - GRID_START_MINUTES) / 60) * GRID_PIXELS_PER_HOUR}px;background:repeating-linear-gradient(to bottom,transparent 0,transparent ${GRID_PIXELS_PER_HOUR - 1}px,var(--line) ${GRID_PIXELS_PER_HOUR - 1}px,var(--line) ${GRID_PIXELS_PER_HOUR}px)}.positioned-event{position:absolute;z-index:2;top:var(--event-top);height:var(--event-height);left:4px;right:4px;min-height:44px}.positioned-event .event-card{position:relative;height:100%;overflow:hidden;padding:6px 7px;box-shadow:0 2px 7px rgba(32,50,43,.08)}.positioned-event .appointment-reference,.positioned-event .provenance{display:none}.positioned-event .event-card-actions{position:absolute;right:3px;bottom:3px}.positioned-event .event-operation{min-width:44px;min-height:44px;background:rgba(255,255,255,.94)}.positioned-event .event-card h4{font-size:.78rem;padding-right:48px}.positioned-event .event-card p{font-size:.68rem;padding-right:48px}.day-time-grid .lanes{display:grid;grid-template-columns:repeat(var(--lane-count),minmax(210px,1fr));gap:0;min-width:max-content}.day-time-grid .lane{border:0;border-right:1px solid var(--line);border-radius:0;min-width:230px}.day-time-grid .lane>header{height:73px;position:sticky;top:0;z-index:4}.day-time-grid .time-rail{margin-top:73px}.week-grid{display:grid;grid-template-columns:repeat(var(--week-lane-count),minmax(190px,1fr));gap:0;overflow:visible;padding:0;min-width:calc(var(--week-lane-count) * 190px)}.week-day{border:0;border-right:1px solid var(--line);border-radius:0;min-width:190px}.week-day>header{height:72px}.week-lane-heading{display:grid;gap:3px;min-width:0}.week-practitioner-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.8rem}.week-practitioner-hours{display:flex;align-items:center;gap:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:.62rem}.week-time-grid .time-rail{margin-top:72px}.week-events{padding:0}.shared-note{margin:-3px 0 10px;color:var(--muted);font-size:.73rem}.management-panel{border:0;padding:0;background:transparent;max-width:none;max-height:none;width:100%;height:100%;margin:0}.management-panel::backdrop{background:rgba(13,31,24,.42)}.management-card{position:absolute;right:0;top:0;height:100%;width:min(430px,100%);overflow:auto;background:var(--panel);padding:22px;box-shadow:-12px 0 40px rgba(20,45,35,.2)}.panel-head{display:flex;justify-content:space-between;gap:12px;align-items:start;border-bottom:1px solid var(--line);padding-bottom:14px}.panel-head h2{margin:3px 0;font-size:1.25rem}.panel-close{border:1px solid var(--line);background:#fff;border-radius:999px;width:44px;height:44px;font-size:1.15rem}.panel-summary{margin:16px 0;padding:12px;border-radius:12px;background:var(--leaf-soft);display:grid;gap:4px}.panel-actions{display:grid;gap:14px}.panel-action{display:none;border-top:1px solid var(--line);padding-top:14px}.panel-action.visible{display:grid;gap:9px}.panel-action label{display:grid;gap:5px;font-size:.76rem;font-weight:750}.panel-action input,.panel-action select,.panel-action textarea{width:100%;min-height:44px;border:1px solid var(--line-strong);border-radius:9px;padding:9px;font:inherit;background:#fff}.panel-action button{min-height:44px;border:0;border-radius:9px;padding:10px 13px;background:var(--leaf-deep);color:#fff;font:inherit;font-weight:800}.panel-action.danger button{background:#843f35}@media(max-width:900px){.shell{padding-top:12px}}@media(max-width:700px){.time-grid{margin-left:-6px;margin-right:-6px;grid-template-columns:48px minmax(0,1fr)}.day-time-grid .lanes{grid-template-columns:repeat(var(--lane-count),minmax(78vw,1fr))}.day-time-grid .lane{min-width:78vw}.week-grid{grid-template-columns:repeat(6,minmax(78vw,1fr));min-width:max-content}.week-day{min-width:78vw}.positioned-event .event-card{min-height:44px}.management-card{padding:16px}}`;
}

function desktopSpatialLaneStyles() {
  return `.people-picker{position:relative;margin-left:auto}.people-picker>summary{list-style:none;display:inline-flex;align-items:center;gap:8px;min-height:38px;padding:7px 10px;border:1px solid var(--line);border-radius:999px;background:#fff;font-size:.82rem;font-weight:800;cursor:pointer}.people-picker>summary::-webkit-details-marker{display:none}.people-picker>summary strong{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 6px;border-radius:999px;background:var(--leaf-soft);color:var(--leaf);font-size:.7rem}.people-picker[open]>summary{border-color:var(--leaf);box-shadow:0 0 0 2px var(--leaf-soft)}.people-form{position:absolute;right:0;top:calc(100% + 7px);z-index:12;display:grid;gap:8px;width:min(260px,calc(100vw - 28px));padding:9px;border:1px solid var(--line);border-radius:12px;background:#fff;box-shadow:0 16px 34px rgba(32,50,43,.18)}.people-form fieldset{display:grid;gap:2px;max-height:260px;overflow:auto;margin:0;padding:0;border:0}.people-form label{display:flex;align-items:center;gap:9px;min-height:39px;padding:7px 8px;border-radius:8px;font-size:.78rem;font-weight:720;cursor:pointer}.people-form label:hover{background:var(--leaf-soft)}.people-form input[type="checkbox"]{width:17px;height:17px;accent-color:var(--leaf)}.people-actions{display:flex;align-items:center;gap:6px;padding-top:4px;border-top:1px solid var(--line)}.people-actions button,.people-actions a{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);font:inherit;font-size:.72rem;font-weight:800;cursor:pointer}.people-actions button{background:var(--leaf-deep);border-color:var(--leaf-deep);color:#fff}.people-form p{margin:0;color:var(--muted);font-size:.68rem}@media(min-width:701px){.workspace-main .shell{max-width:none}.day-time-grid{max-height:max(520px,calc(100vh - 330px));overscroll-behavior:contain;scrollbar-gutter:stable}.day-time-grid .lanes{grid-template-columns:repeat(var(--lane-count),minmax(300px,1fr));min-width:max-content;width:100%}.day-time-grid .lane{min-width:300px}.day-time-grid .lane>header{position:sticky;top:0;z-index:4;box-shadow:0 1px 0 var(--line)}}@media(max-width:700px){.people-picker{margin-left:0}.people-form{position:static;width:100%;margin-top:7px;box-shadow:none}.people-picker>summary{min-height:44px}.people-form label{min-height:44px}}`;
}

function renderManagementPanel(model) {
  if (!mutationEnabled(model)) return '';
  const options = (model.permittedStaff || []).map(person => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.displayName)}</option>`).join('');
  return `<dialog class="management-panel" data-calendar-management-panel aria-labelledby="management-title"><section class="management-card"><header class="panel-head"><div><span class="eyebrow">Appointment</span><h2 id="management-title" data-panel-title>Manage appointment</h2></div><button class="panel-close" type="button" data-panel-close aria-label="Close">×</button></header><div class="panel-summary"><strong data-panel-client></strong><span data-panel-mobile></span><span data-panel-service></span><span data-panel-practitioners></span><span data-panel-time></span><span data-panel-status></span></div><div class="panel-actions"><form class="panel-action" data-panel-action="appointment:reschedule"><label>Date<input name="date" type="date" required></label><label>Start time<input name="time" type="time" required></label><button type="submit">Save new time</button></form><form class="panel-action" data-panel-action="appointment:reassign"><label>Practitioner<select name="destinationStaffId" required>${options}</select></label><button type="submit">Reassign</button></form><form class="panel-action danger" data-panel-action="appointment:cancel"><label><input name="confirmed" type="checkbox" required> I confirm this exact appointment should be cancelled.</label><button type="submit">Cancel appointment</button></form></div></section></dialog>`;
}

function calendar823Styles() {
  return `.event-card[data-appointment-management-target="true"]{cursor:pointer}.event-card[data-appointment-management-target="true"]:focus-visible{outline:3px solid var(--leaf);outline-offset:2px}.view-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px}.period-context{display:block;min-width:0;flex:1;text-align:center;font-size:.88rem;white-space:nowrap}.period-arrow{flex:0 0 auto}.panel-summary span:empty{display:none}.panel-actions .danger{margin-top:10px;padding-top:20px;border-top:2px solid #d7b7ad}@media(min-width:701px){.controls{grid-template-columns:minmax(330px,1.25fr) auto minmax(220px,.75fr)}.period-nav{width:100%}.week-grid{grid-template-columns:repeat(var(--week-lane-count),minmax(150px,1fr))!important;min-width:calc(var(--week-lane-count) * 150px)!important;width:100%!important}.week-date-lane{min-width:150px!important}.positioned-event .event-card h4,.positioned-event .event-card p{padding-right:0}.positioned-event .event-card-actions{position:static;margin-top:4px}.management-card{width:min(460px,100%)}}@media(max-width:700px){.management-card{top:auto;bottom:0;height:min(92dvh,760px);width:100%;border-radius:18px 18px 0 0;padding:16px}.event-card[data-appointment-management-target="true"]{touch-action:manipulation}.view-actions{display:grid;grid-template-columns:1fr auto}.period-context{font-size:.72rem}}`;
}

function renderCalendarPage(model, {
  basePath = '/calendar/read-only',
  staffAccessScriptPath = '/calendar/staff/client.js',
  operationalMutationsScriptPath = '/calendar/operations/client.js',
  operationalActions = [],
  bookingEnabled = false,
  bookingPath = '/calendar/book',
  desktopEnhancementEnabled = false,
  clientNavigationAllowed = false,
  clientsPath = '/calendar/clients',
  timelineReadOnlyMessage = 'Read-only operational view. Booking, reschedule, cancellation, block, leave and schedule mutations are not available here.',
} = {}) {
  const booking = { enabled: bookingEnabled === true, path: bookingPath };
  const content = model.view === 'week'
    ? renderWeek(model, booking, basePath)
    : model.view === 'agenda'
      ? renderAgenda(model)
      : model.view === 'month'
        ? renderMonth(model, basePath)
        : renderDay(model, booking);
  const canMutate = mutationEnabled(model);
  const operationScript = canMutate ? `<script src="${escapeHtml(operationalMutationsScriptPath)}" defer></script>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Calendar — Shiloh Workspace</title><style>${serviceFamilyAccentCss()}${styles()}${desktopFirstPaintStyles()}${workspaceShellStyles()}${workspaceV1Styles()}${desktopSpatialLaneStyles()}${calendarViewParityStyles()}${calendarViewParityResponsiveStyles()}${canMutate ? operationalStyles() : ''}${calendarFirstPhoneStyles()}${goldieDensityPhoneStyles()}${calendar823Styles()}${calendarEventToneCss()}</style><script src="${escapeHtml(staffAccessScriptPath)}" defer></script>${operationScript}</head><body data-calendar-view="${escapeHtml(model.view)}" data-calendar-desktop-pending="${model.view === 'week' && desktopEnhancementEnabled ? 'true' : 'false'}" data-calendar-readonly="${canMutate ? 'false' : 'true'}"><div class="workspace-frame">${renderWorkspaceNavigation({ active: 'calendar', clientsHref: clientNavigationAllowed ? clientsPath : null })}<div class="workspace-main"><div class="shell">
    <header class="topbar"><div class="brand"><h1>Calendar</h1><p>Your clinic schedule, at a glance.</p></div><div class="topbar-side"><div class="access-controls"></div></div></header>
    ${renderControls(model, basePath, operationalActions)}${canMutate ? '<span class="operation-status" role="status" aria-live="polite" data-calendar-operation-status></span>' : ''}${content}${renderOperationalSummary(model)}
    <div class="footer-note">${escapeHtml(timelineReadOnlyMessage)}</div>${renderManagementPanel(model)}
  </div></div></div></body></html>`;
}

function renderUnavailablePage({ code = 'CALENDAR_UNAVAILABLE', message = 'Calendar is temporarily unavailable.' } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shiloh Calendar unavailable</title><style>${serviceFamilyAccentCss()}${styles()}</style></head><body data-calendar-readonly="true"><div class="shell"><header class="topbar"><div class="brand"><h1>Shiloh Calendar</h1><p>Read-only operational Calendar</p></div></header><main class="calendar-view"><div class="view-heading"><div><span class="eyebrow">Unavailable</span><h2>Calendar unavailable</h2></div><span class="read-only-badge">Fail closed</span></div><p>${escapeHtml(message)}</p><p class="footer-note">Reference: ${escapeHtml(code)}</p></main></div></body></html>`;
}

module.exports = {
  escapeHtml,
  renderCalendarPage,
  renderUnavailablePage,
  renderEventCard,
  renderOperationalActions,
  renderOperationalSummary,
  mutationEnabled,
  operationEnabled,
  appointmentOperations,
  staffOperationEnabled,
  eventsForDate,
  workingContext,
  formatClientMobile,
  visibleStaffIdsForModel,
  queryHref,
  bookingHref,
  renderBookingSlotLayer,
  desktopSpatialLaneStyles,
  spatialPhoneWeekStyles,
  calendarFirstPhoneStyles,
  goldieDensityPhoneStyles,
  calendar823Styles,
};
