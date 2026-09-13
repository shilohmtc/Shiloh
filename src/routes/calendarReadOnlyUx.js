const express = require('express');
const { pool } = require('../db/pool');
const calendarReadOnlyUx = require('../services/calendarReadOnlyUx');
const { renderCalendarPage, renderUnavailablePage } = require('../presentation/calendarReadOnlyUx');
const { calendarEventToneCss } = require('../presentation/calendarEventVisuals');
const {
  calendarPhoneCompactV2ClientScript,
  decoratePhoneCalendarV2,
} = require('../presentation/calendarPhoneCompactV2');
const { isCalendarBridgeEnabled } = require('../middleware/staffBrowserSession');
const { createCalendarCreateBookingService } = require('../services/calendarCreateBooking');
const { createCalendarRetrospectiveBookingService } = require('../services/calendarRetrospectiveBooking');
const { createCalendarOperationalMutationService } = require('../services/calendarOperationalMutations');
const workspaceClients = require('../services/workspaceClients');

const CALENDAR_VIEWER_CONTEXT = Symbol.for('shiloh.calendar.server.viewer');
const CALENDAR_TIMEZONE = calendarReadOnlyUx.BUSINESS_TIMEZONE || 'Africa/Johannesburg';

function isFeatureEnabled(env = process.env) {
  return String(env.SHILOH_CALENDAR_READONLY_UX_ENABLED || '').trim().toLowerCase() === 'true';
}

function resolveServerViewer(req) {
  const context = req?.[CALENDAR_VIEWER_CONTEXT];
  if (!context || context.authenticated !== true || context.source !== 'server_staff_session') return null;
  if (!context.viewer || typeof context.viewer !== 'object') return null;
  return context.viewer;
}

function setCalendarSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
}

function statusForError(error) {
  if (error?.code === 'CALENDAR_UX_AUTH_REQUIRED' || error?.code === 'SCHEDULING_TIMELINE_FORBIDDEN') return 403;
  if (error?.code === 'CALENDAR_UX_STAFF_FILTER_FORBIDDEN') return 403;
  if (String(error?.code || '').startsWith('CALENDAR_UX_INVALID_') || String(error?.code || '').startsWith('SCHEDULING_TIMELINE_INVALID_')) return 400;
  return 503;
}

function safeUnavailableMessage(error) {
  if (error?.code === 'CALENDAR_UX_STAFF_FILTER_FORBIDDEN') return 'That practitioner is outside your Calendar access.';
  if (statusForError(error) === 400) return 'The requested Calendar view or filter is invalid.';
  if (statusForError(error) === 403) return 'Your Shiloh access does not permit this Calendar view.';
  return 'Calendar is temporarily unavailable.';
}

function decorateUnavailableContract(html, error) {
  const scopeContract = error?.code === 'CALENDAR_UX_STAFF_FILTER_FORBIDDEN'
    ? ' data-calendar-scope-contract="outside your authenticated Calendar scope"'
    : '';
  return String(html).replace(
    '<body>',
    `<body data-calendar-safety-contract="failing closed"${scopeContract}>`,
  );
}

function bookingOperationalActions(
  dateKey,
  bookingPath = '/calendar/book',
  retrospectiveAllowed = false,
  retrospectiveBookingPath = '/calendar/book/past',
) {
  const date = encodeURIComponent(String(dateKey || ''));
  const actions = [{ label: '+ New appointment', ariaLabel: 'Create booking', href: `${bookingPath}?date=${date}`, tone: 'primary' }];
  if (retrospectiveAllowed) {
    actions.push({
      label: 'Record past appointment',
      ariaLabel: 'Record past appointment',
      href: `${retrospectiveBookingPath}?date=${date}`,
      tone: 'secondary',
    });
  }
  return actions;
}

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
    timeZone: CALENDAR_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: CALENDAR_TIMEZONE,
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function eventStaffIds(item) {
  if (Array.isArray(item?.staffIds)) return item.staffIds.map(Number).filter(Number.isSafeInteger);
  if (Number.isSafeInteger(Number(item?.staffId))) return [Number(item.staffId)];
  return [];
}

function eventsForStaffOnDay(model, staffId, day) {
  return (model?.timeline?.events || [])
    .filter(item => item?.canonical !== false && item?.kind !== 'external_busy')
    .filter(item => dateKey(item.startsAt || item.date) === day)
    .filter(item => eventStaffIds(item).includes(Number(staffId)))
    .sort((a, b) => {
      const aTime = a.startsAt ? new Date(a.startsAt).getTime() : Number.POSITIVE_INFINITY;
      const bTime = b.startsAt ? new Date(b.startsAt).getTime() : Number.POSITIVE_INFINITY;
      return aTime - bTime || String(a.kind || '').localeCompare(String(b.kind || ''));
    });
}

function staffWorkingContext(model, staffId, day) {
  const noon = new Date(`${day}T12:00:00+02:00`);
  const weekday = noon.getUTCDay();
  const exceptions = (model?.timeline?.scheduleExceptions || [])
    .filter(item => Number(item.staffId) === Number(staffId) && dateKey(item.date) === day);
  if (exceptions.length) {
    return exceptions.map(item => {
      const label = String(item.exceptionType || 'exception').replace(/_/g, ' ');
      const hours = item.startsLocal && item.endsLocal
        ? ` ${String(item.startsLocal).slice(0, 5)}–${String(item.endsLocal).slice(0, 5)}`
        : '';
      return `${label}${hours}`;
    }).join(' • ');
  }
  const recurringClosed = (model?.timeline?.recurringClosures || [])
    .some(item => Number(item.staffId) === Number(staffId) && Number(item.dayOfWeek) === weekday);
  if (recurringClosed) return 'Not scheduled';
  const windows = (model?.timeline?.workingWindows || [])
    .filter(item => Number(item.staffId) === Number(staffId) && Number(item.dayOfWeek) === weekday);
  if (!windows.length) return 'No working window';
  return windows
    .map(item => `${String(item.startsLocal || '').slice(0, 5)}–${String(item.endsLocal || '').slice(0, 5)}`)
    .join(' • ');
}

function mobileEventSummary(item) {
  if (!item) return { primary: 'No visible items', secondary: 'Clear in this Calendar view' };
  const time = item.startsAt ? formatTime(item.startsAt) : '';
  if (item.kind === 'appointment') {
    return {
      primary: `${time ? `${time} • ` : ''}${item.clientName || 'Client'}`,
      secondary: item.serviceName || 'Appointment',
    };
  }
  if (item.kind === 'calendar_block') {
    return {
      primary: `${time ? `${time} • ` : ''}${item.title || item.blockType || 'Blocked time'}`,
      secondary: 'Calendar block',
    };
  }
  if (item.kind === 'approved_leave' || item.kind === 'operational_leave') {
    return { primary: 'Leave', secondary: item.reason || 'Unavailable' };
  }
  return {
    primary: `${time ? `${time} • ` : ''}${String(item.kind || 'Calendar item').replace(/_/g, ' ')}`,
    secondary: 'Shiloh scheduling item',
  };
}

function staffFilterHref(basePath, model, staffId) {
  const params = new URLSearchParams({ view: 'day', date: String(model?.dateKey || '') });
  params.set('staff', String(staffId));
  return `${basePath}?${params.toString()}`;
}

function renderMobileStaffOverview(model, basePath = '/calendar/read-only') {
  if (model?.view !== 'day') return '';
  const usesImplicitDesktopFocus = model?.visibleStaffSelectionExplicit === false;
  if (!usesImplicitDesktopFocus && model?.selectedStaffId != null) return '';
  const sourceTimeline = usesImplicitDesktopFocus && model?.authorizedTimeline
    ? model.authorizedTimeline
    : model?.timeline;
  const staff = Array.isArray(sourceTimeline?.staff) ? sourceTimeline.staff : [];
  if (staff.length <= 1) return '';
  const mobileModel = { ...model, timeline: sourceTimeline };
  const day = model.period?.dateKeys?.[0] || model.dateKey;
  const cards = staff.map(person => {
    const items = eventsForStaffOnDay(mobileModel, person.id, day);
    const context = staffWorkingContext(mobileModel, person.id, day);
    const unavailable = context === 'Not scheduled' || context === 'No working window';
    const next = mobileEventSummary(items[0]);
    const countLabel = `${items.length} item${items.length === 1 ? '' : 's'}`;
    return `<a class="mobile-staff-card" data-mobile-staff-id="${escapeHtml(person.id)}" href="${escapeHtml(staffFilterHref(basePath, model, person.id))}">
      <div class="mobile-staff-card-head"><strong>${escapeHtml(person.displayName || `Staff ${person.id}`)}</strong><span class="mobile-staff-count">${escapeHtml(items.length)}</span></div>
      <div class="mobile-staff-schedule"><span class="status-dot${unavailable ? ' off' : ''}"></span><span>${escapeHtml(context)}</span></div>
      <div class="mobile-staff-next"><span class="mobile-staff-next-label">${escapeHtml(countLabel)} • next</span><strong>${escapeHtml(next.primary)}</strong><small>${escapeHtml(next.secondary)}</small></div>
    </a>`;
  }).join('');
  return `<section class="mobile-staff-overview" data-mobile-staff-overview aria-label="Staff day overview">
    <header class="mobile-staff-overview-head"><div><span class="eyebrow">Team overview</span><h3>All staff today</h3></div><span>Tap a person for the full timeline</span></header>
    <div class="mobile-staff-grid">${cards}</div>
  </section>`;
}

function mobileStaffOverviewStyles() {
  return `.mobile-staff-overview{display:none}@media(max-width:700px){.mobile-staff-overview{display:grid;gap:9px;margin-top:2px}.mobile-staff-overview-head{display:flex;align-items:end;justify-content:space-between;gap:10px}.mobile-staff-overview-head h3{margin:2px 0 0;font-size:1rem}.mobile-staff-overview-head>span{max-width:130px;text-align:right;color:var(--muted);font-size:.68rem;line-height:1.25}.mobile-staff-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.mobile-staff-card{display:grid;align-content:start;gap:7px;min-width:0;min-height:118px;padding:11px;border:1px solid var(--line);border-radius:13px;background:#fff;box-shadow:0 3px 12px rgba(32,50,43,.04)}.mobile-staff-card:active{background:var(--leaf-soft)}.mobile-staff-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:6px;min-width:0}.mobile-staff-card-head strong{min-width:0;font-size:.88rem;line-height:1.2;overflow-wrap:anywhere}.mobile-staff-count{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;min-width:27px;height:27px;border-radius:999px;background:var(--leaf-soft);color:var(--leaf);font-size:.72rem;font-weight:850}.mobile-staff-schedule{display:flex;align-items:flex-start;gap:6px;min-width:0;color:var(--muted);font-size:.68rem;line-height:1.3}.mobile-staff-schedule .status-dot{flex:0 0 8px;margin-top:2px}.mobile-staff-next{display:grid;gap:2px;min-width:0;padding-top:7px;border-top:1px solid var(--line)}.mobile-staff-next-label{color:var(--muted);font-size:.62rem;text-transform:uppercase;letter-spacing:.06em;font-weight:800}.mobile-staff-next strong{min-width:0;font-size:.74rem;line-height:1.28;overflow-wrap:anywhere}.mobile-staff-next small{min-width:0;color:var(--muted);font-size:.66rem;line-height:1.25;overflow-wrap:anywhere}.day-view.mobile-all-staff-overview .day-time-grid{position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;clip-path:inset(50%)!important;visibility:hidden!important;pointer-events:none!important}.day-view:not(.mobile-all-staff-overview) .day-time-grid{overflow:hidden}.day-view:not(.mobile-all-staff-overview) .day-time-grid .lanes{grid-template-columns:minmax(0,1fr)!important;min-width:0!important;width:100%}.day-view:not(.mobile-all-staff-overview) .day-time-grid .lane{min-width:0!important;width:100%;border-right:0}}`;
}

function visibleStaffIdsForCalendarModel(model) {
  if (Array.isArray(model?.visibleStaffIds)) return model.visibleStaffIds.map(Number).filter(id => Number.isSafeInteger(id) && id > 0);
  if (model?.selectedStaffId != null) {
    const id = Number(model.selectedStaffId);
    return Number.isSafeInteger(id) && id > 0 ? [id] : [];
  }
  return (model?.timeline?.staff || [])
    .map(person => Number(person.id))
    .filter(id => Number.isSafeInteger(id) && id > 0);
}

function calendarVisibilityHref(basePath, model, selection) {
  const params = new URLSearchParams({
    view: String(model?.view || 'week'),
    date: String(model?.dateKey || ''),
  });
  if (selection === 'all') {
    params.set('staff', 'all');
  } else {
    for (const id of selection || []) params.append('staff', String(id));
  }
  const activeStaffId = Number(model?.activeStaffId);
  if (Number.isSafeInteger(activeStaffId) && activeStaffId > 0) params.set('activeStaff', String(activeStaffId));
  return `${basePath}?${params.toString()}`;
}

function renderDesktopPractitionerChips(model, basePath) {
  const permittedStaff = Array.isArray(model?.permittedStaff) ? model.permittedStaff : [];
  if (permittedStaff.length <= 1) return '';
  const permittedIds = permittedStaff
    .map(person => Number(person.id))
    .filter(id => Number.isSafeInteger(id) && id > 0);
  const visibleIds = visibleStaffIdsForCalendarModel(model).filter(id => permittedIds.includes(id));
  const visible = new Set(visibleIds);
  const allSelected = permittedIds.length > 0 && permittedIds.every(id => visible.has(id));
  const allHref = calendarVisibilityHref(basePath, model, 'all');
  const chips = permittedStaff.map(person => {
    const id = Number(person.id);
    const selected = visible.has(id);
    let nextSelection;
    if (allSelected) {
      nextSelection = [id];
    } else if (selected) {
      nextSelection = visibleIds.length > 1 ? visibleIds.filter(value => value !== id) : 'all';
    } else {
      const selectedSet = new Set([...visibleIds, id]);
      nextSelection = permittedIds.filter(value => selectedSet.has(value));
    }
    const href = nextSelection === 'all' ? allHref : calendarVisibilityHref(basePath, model, nextSelection);
    const active = !allSelected && selected;
    return `<a class="staff-chip${active ? ' active' : ''}" data-calendar-staff-chip="${escapeHtml(id)}"${active ? ' aria-current="true"' : ''} href="${escapeHtml(href)}">${escapeHtml(person.displayName || `Staff ${id}`)}</a>`;
  }).join('');
  return `<div class="desktop-practitioner-chips" data-desktop-practitioner-chips><span class="control-label">People</span><nav class="people-chip-row" aria-label="Practitioners in view"><a class="staff-chip all-staff${allSelected ? ' active' : ''}" data-calendar-staff-chip="all"${allSelected ? ' aria-current="true"' : ''} href="${escapeHtml(allHref)}">All staff</a>${chips}</nav></div>`;
}

function calendarDesktopUsabilityStyles() {
  return `.desktop-practitioner-chips{display:none}@media(min-width:701px){.shell{max-width:none!important}.desktop-practitioner-chips{display:grid;grid-column:1/-1;gap:4px;min-width:0;padding-top:1px}.people-chip-row{display:flex;align-items:center;gap:6px;min-width:0;overflow-x:auto;padding:1px 1px 2px;scrollbar-width:thin}.staff-chip{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;min-height:34px;padding:5px 10px;border:1px solid var(--line-strong);border-radius:999px;background:#fff;color:var(--ink);font-size:.77rem;font-weight:780;transition:border-color .12s ease,background .12s ease,box-shadow .12s ease,color .12s ease}.staff-chip:hover,.staff-chip:focus-visible{border-color:var(--leaf);outline:none;box-shadow:0 0 0 2px var(--leaf-soft)}.staff-chip.active{background:var(--leaf-deep);border-color:var(--leaf-deep);color:#fff;box-shadow:0 3px 8px rgba(41,76,60,.16)}.staff-chip.all-staff{font-weight:850}.practitioner-control{display:none!important}.controls{gap:8px 12px!important;padding:10px 12px!important;border-radius:14px!important;box-shadow:0 3px 13px rgba(32,50,43,.045)!important}.controls .control-label{font-size:.63rem!important;letter-spacing:.09em!important}.period-nav,.view-actions,.view-tabs{gap:5px!important}.period-context{padding:0 4px!important;font-size:.84rem!important}.nav-button,.view-tab{min-height:34px!important;padding:6px 10px!important}.operational-actions{gap:6px!important}.operational-actions .action-link{min-height:34px!important;padding:6px 10px!important}.calendar-view{box-shadow:0 6px 18px rgba(32,50,43,.055)!important;border-color:#d9e1db!important}.view-heading{margin-bottom:8px!important}.view-heading h2{font-size:1.3rem!important;letter-spacing:-.018em!important}.read-only-badge{padding:5px 9px!important}.scan-summary{padding:8px 11px!important;margin-bottom:8px!important}.day-time-grid,.week-time-grid{border-color:#e0e6e1!important;background:#fbfcfa!important}.time-rail{background:#f7f9f6!important;border-right:1px solid #e2e7e3!important}.time-rail span{color:#65766d!important;font-weight:700!important;letter-spacing:.01em}.day-time-grid .lane,.week-day{background:#fcfdfb!important}.day-time-grid .lane>header,.week-day>header{background:#f6f8f5!important;border-bottom-color:#dfe6e0!important}.day-time-grid .lane h3,.week-practitioner-name{color:#263b31!important;font-weight:850!important;letter-spacing:-.01em!important}.day-time-grid .lane header p,.week-practitioner-hours{color:#607168!important}.day-time-grid .lane-count{font-weight:760!important}.day-time-grid .lane:has(.positioned-event),.week-day:has(.positioned-event){background:#fff!important}.day-time-grid .lane:has(.positioned-event)>header,.week-day:has(.positioned-event)>header{background:#f2f6f2!important}.positioned-event .event-card{border-color:#cbd7cf!important;background:#fff!important;box-shadow:0 2px 8px rgba(32,50,43,.09)!important;padding:5px 7px!important}.positioned-event .event-time{font-size:.7rem!important;font-weight:850!important;color:var(--leaf-deep)!important}.positioned-event .event-card h4{margin-top:2px!important;font-size:.8rem!important;font-weight:850!important;line-height:1.12!important;color:#17271f!important}.positioned-event .event-meta{margin-top:2px!important;color:#586a61!important}.positioned-event .event-service-context{font-weight:720!important}.positioned-event .event-practitioners,.positioned-event .event-state{color:#596b62!important}.view-practitioner-context{margin-bottom:7px!important;padding:6px 8px!important;background:#f7f9f6!important}.agenda-view>.view-practitioner-context,.month-view>.view-practitioner-context{display:none!important}.week-grid{gap:0!important}.week-day{border-color:#e1e7e2!important}.month-grid{max-width:1320px;margin:0 auto}.agenda-view{max-width:none!important}.agenda-day{display:grid;grid-template-columns:145px minmax(0,1fr);gap:0 12px;margin:0!important;border-top:1px solid var(--line)}.agenda-day>header{position:static!important;grid-row:1/-1;border:0!important;padding:12px 8px!important;background:transparent!important}.agenda-day .event-card{grid-column:2;display:grid;grid-template-columns:96px minmax(170px,.8fr) minmax(260px,1.8fr) auto;align-items:center;gap:10px;margin:0!important;padding:9px 10px!important;border-width:0 0 1px 3px!important;border-radius:0!important;box-shadow:none!important}.agenda-day .event-card-top{display:block}.agenda-day .kind-pill,.agenda-day .event-client-mobile,.agenda-day .appointment-reference{display:none!important}.agenda-day .event-card h4{margin:0!important}.agenda-day .event-meta{margin:0!important}.agenda-day .event-card-actions{justify-self:end}}@media(min-width:1100px){.shell{max-width:none!important;padding-left:24px!important;padding-right:24px!important}.calendar-view{padding:13px!important}.day-time-grid .lanes{grid-template-columns:repeat(var(--lane-count),minmax(300px,1fr))!important}.day-time-grid .lane{min-width:300px!important;width:auto!important}.week-grid{grid-template-columns:repeat(var(--week-lane-count),minmax(200px,1fr))!important;min-width:0!important}.week-day{min-width:200px!important;width:auto!important;max-width:none!important}}@media(min-width:1500px){.shell{max-width:none!important}.day-time-grid .lanes{grid-template-columns:repeat(var(--lane-count),minmax(300px,1fr))!important}.day-time-grid .lane{min-width:300px!important;width:auto!important}.week-grid{grid-template-columns:repeat(var(--week-lane-count),minmax(220px,1fr))!important}.week-day{min-width:220px!important;width:auto!important}}@media(max-width:900px) and (min-width:701px){.agenda-day{grid-template-columns:1fr}.agenda-day>header,.agenda-day .event-card{grid-column:1}.agenda-day .event-card{grid-template-columns:90px minmax(150px,1fr) minmax(220px,1.5fr) auto}}@media(max-width:700px){.desktop-practitioner-chips{display:none!important}}`;
}

function applyCalendarResponsivePolish(html, model = null, basePath = '/calendar/read-only') {
  let polished = String(html)
    .replace(
      '.controls{position:sticky;top:0;z-index:5;grid-template-columns:1fr 1fr;',
      '.controls{position:sticky;top:0;z-index:5;grid-template-columns:1fr;',
    )
    .replace('aria-label="Scheduling authority"', 'aria-label="Schedule source"')
    .replace(
      'Shared appointments appear once as one canonical booking and retain all assigned practitioners.',
      'Shared appointments appear once and retain all assigned practitioners.',
    );

  const chips = renderDesktopPractitionerChips(model, basePath);
  if (chips) {
    polished = polished.replace(
      '<div class="control-group practitioner-control">',
      `${chips}<div class="control-group practitioner-control">`,
    );
  }
  polished = polished.replace('</style>', `${calendarDesktopUsabilityStyles()}${calendarEventToneCss()}</style>`);
  polished = polished.replace(
    '<span class="workspace-link active" data-workspace-destination="calendar" aria-current="page">Calendar</span>',
    `<a class="workspace-link active" data-workspace-destination="calendar" aria-current="page" href="${escapeHtml(basePath)}">Calendar</a>`,
  );
  return polished;
}

// Compatibility fallback for renderers that do not yet consume operationalActions.
// Authority is resolved server-side before this decoration is ever used.
function decorateBookingEntry(html, dateKey, bookingPath = '/calendar/book') {
  const href = `${bookingPath}?date=${encodeURIComponent(String(dateKey || ''))}`;
  return String(html)
    .replace('<div class="access-controls">', `<div class="access-controls"><a class="nav-button" aria-label="Create booking" href="${href}">+ Appointment</a>`)
    .replace('Read-only operational view. Booking, reschedule, cancellation, block, leave and schedule mutations are not available here.', 'Timeline remains read-only. Use Create booking to add an appointment. Reschedule, cancellation, drag/drop, reassignment, block, leave and schedule changes are not available here.');
}

function resolveActiveWeekStaffId(requested, model) {
  const visibleStaffIds = (model?.timeline?.staff || [])
    .map(person => Number(person.id))
    .filter(id => Number.isSafeInteger(id) && id > 0);
  const fallback = visibleStaffIds[0] || null;
  if (Array.isArray(requested) || !/^\d+$/.test(String(requested || ''))) return fallback;
  const requestedId = Number(requested);
  return visibleStaffIds.includes(requestedId) ? requestedId : fallback;
}

function createCalendarReadOnlyHandler({
  env = process.env,
  buildModel = calendarReadOnlyUx.buildModel,
  renderPage = renderCalendarPage,
  renderUnavailable = renderUnavailablePage,
  resolveViewer = resolveServerViewer,
  staffAccessPath = '/calendar/staff',
  bookingPath = '/calendar/book',
  retrospectiveBookingPath = '/calendar/book/past',
  bookingService = createCalendarCreateBookingService({ db: pool, env }),
  retrospectiveBookingService = createCalendarRetrospectiveBookingService({ db: pool }),
  mutationService = createCalendarOperationalMutationService({ db: pool }),
  clientAccessService = workspaceClients,
  clientsPath = '/calendar/clients',
  operationalMutationsScriptPath = '/calendar/operations/client.js',
} = {}) {
  return async function calendarReadOnlyHandler(req, res, next) {
    try {
      setCalendarSecurityHeaders(res);
      if (!isFeatureEnabled(env)) return res.status(404).type('text/plain').send('Not Found');

      const viewer = resolveViewer(req);
      if (!viewer) {
        if (isCalendarBridgeEnabled(env)) {
          res.setHeader('Location', `${staffAccessPath}?reason=session`);
          return res.status(302).type('text/plain').send('Staff sign-in required');
        }
        return res.status(503).type('html').send(renderUnavailable({
          code: 'CALENDAR_SECURE_ACCESS_NOT_CONFIGURED',
          message: 'Secure browser staff sign-in is not configured for this Calendar surface yet.',
        }));
      }

      const model = await buildModel({
        view: req.query?.view,
        date: req.query?.date,
        staff: req.query?.staff,
        viewer,
      });

      let bookingAllowed = false;
      try {
        await bookingService.resolveOperator(req.staffBrowserSession?.adminId);
        bookingAllowed = true;
      } catch (_bookingAuthorityError) {
        // Timeline remains safe. Booking entry fails closed while /calendar/book
        // independently revalidates current operator capability and scope.
      }

      let retrospectiveBookingAllowed = false;
      if (req.staffBrowserSession?.adminId != null) {
        try {
          await retrospectiveBookingService.resolveOperator(req.staffBrowserSession.adminId);
          retrospectiveBookingAllowed = true;
        } catch (_retrospectiveAuthorityError) {
          // Retrospective entry remains absent unless canonical appointment:record_past
          // authority resolves; /calendar/book/past revalidates independently.
        }
      }

      let mutationCapability = null;
      if (req.staffBrowserSession?.adminId != null) {
        try {
          const operator = await mutationService.resolveOperator(req.staffBrowserSession.adminId);
          mutationCapability = operator.mutationCapability || null;
        } catch (_mutationAuthorityError) {
          // The timeline remains readable within its existing viewer scope. Mutation
          // controls fail closed and the operations endpoints revalidate independently.
        }
      }

      let clientNavigationAllowed = false;
      if (req.staffBrowserSession?.adminId != null) {
        try {
          clientNavigationAllowed = Boolean(await clientAccessService.resolveAccess(req.staffBrowserSession.adminId));
        } catch (_clientAuthorityError) {
          // Calendar remains available under its own authority. Clients navigation
          // fails closed unless current canonical client:lookup authority resolves.
        }
      }

      const renderedModel = {
        ...model,
        activeStaffId: resolveActiveWeekStaffId(req.query?.activeStaff, model),
        mutationCapability: mutationCapability ? { ...mutationCapability, enabled: true } : { enabled: false },
      };
      const basePath = req.baseUrl || '/calendar/read-only';

      let html = renderPage(renderedModel, {
        basePath,
        staffAccessPath,
        staffAccessScriptPath: `${staffAccessPath}/client.js`,
        operationalMutationsScriptPath,
        clientNavigationAllowed,
        clientsPath,
        bookingEnabled: bookingAllowed,
        bookingPath,
        desktopEnhancementEnabled: true,
        operationalActions: [
          ...(bookingAllowed ? bookingOperationalActions(model.dateKey, bookingPath, retrospectiveBookingAllowed, retrospectiveBookingPath) : []),
        ],
        timelineReadOnlyMessage: mutationCapability
          ? 'Calendar changes are checked again against the current appointment, schedule and conflicts before saving. These controls do not send client messages.'
          : bookingAllowed
            ? 'Timeline remains read-only. Use Create booking to add an appointment. Reschedule, cancellation, drag/drop, reassignment, block, leave and schedule changes are not available here.'
            : 'Read-only Calendar view. Booking, reschedule, cancellation, block, leave and schedule changes are not available here.',
      });
      html = applyCalendarResponsivePolish(html, renderedModel, basePath);

      if (bookingAllowed && !String(html).includes('aria-label="Calendar actions"')) {
        html = decorateBookingEntry(html, model.dateKey, bookingPath);
      }
      html = decoratePhoneCalendarV2(html, {
        model: renderedModel,
        basePath,
        bookingPath,
        bookingAllowed,
        retrospectiveBookingPath,
        retrospectiveAllowed: retrospectiveBookingAllowed,
      });
      return res.status(200).type('html').send(html);
    } catch (error) {
      if (res.headersSent) return next(error);
      const status = statusForError(error);
      const unavailable = renderUnavailable({
        code: error?.code || 'CALENDAR_UNAVAILABLE',
        message: safeUnavailableMessage(error),
      });
      return res.status(status).type('html').send(decorateUnavailableContract(unavailable, error));
    }
  };
}

function createCalendarReadOnlyRouter(options = {}) {
  const router = express.Router();
  router.get('/phone-v2.js', (_req, res) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).type('application/javascript').send(calendarPhoneCompactV2ClientScript());
  });
  router.get('/', createCalendarReadOnlyHandler(options));
  return router;
}

module.exports = createCalendarReadOnlyRouter();
module.exports.CALENDAR_VIEWER_CONTEXT = CALENDAR_VIEWER_CONTEXT;
module.exports.createCalendarReadOnlyHandler = createCalendarReadOnlyHandler;
module.exports.createCalendarReadOnlyRouter = createCalendarReadOnlyRouter;
module.exports.isFeatureEnabled = isFeatureEnabled;
module.exports.resolveServerViewer = resolveServerViewer;
module.exports.setCalendarSecurityHeaders = setCalendarSecurityHeaders;
module.exports.decorateBookingEntry = decorateBookingEntry;
module.exports.bookingOperationalActions = bookingOperationalActions;
module.exports.renderMobileStaffOverview = renderMobileStaffOverview;
module.exports.mobileStaffOverviewStyles = mobileStaffOverviewStyles;
module.exports.visibleStaffIdsForCalendarModel = visibleStaffIdsForCalendarModel;
module.exports.calendarVisibilityHref = calendarVisibilityHref;
module.exports.renderDesktopPractitionerChips = renderDesktopPractitionerChips;
module.exports.calendarDesktopUsabilityStyles = calendarDesktopUsabilityStyles;
module.exports.applyCalendarResponsivePolish = applyCalendarResponsivePolish;
module.exports.resolveActiveWeekStaffId = resolveActiveWeekStaffId;
module.exports.decorateUnavailableContract = decorateUnavailableContract;
