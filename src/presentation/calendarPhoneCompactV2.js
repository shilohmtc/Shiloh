const { allowsStaffTarget } = require('../services/calendarAuthorization');
const { normalizeOperationalDateKey } = require('../services/calendarReadOnlyUx');
const { renderLucideIcon } = require('./lucideIcons');

const BUSINESS_TIMEZONE = 'Africa/Johannesburg';
const PHONE_GRID_PIXELS_PER_HOUR = 60;
const DESKTOP_GRID_PIXELS_PER_HOUR = 72;
const GRID_START_MINUTES = 7 * 60;
const GRID_END_MINUTES = 18 * 60;

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function localDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
}

function dateKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function businessToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return normalizeOperationalDateKey(`${values.year}-${values.month}-${values.day}`);
}

function monthLabel(value, long = false) {
  const date = localDate(value);
  if (!date) return 'Calendar';
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: BUSINESS_TIMEZONE,
    month: long ? 'long' : 'short',
    year: 'numeric',
  }).format(date);
}

function operationalMonthAnchor(year, monthIndex) {
  const date = new Date(Date.UTC(year, monthIndex, 1, 12));
  if (date.getUTCDay() === 0) date.setUTCDate(2);
  return dateKey(date);
}

function calendarHref(basePath, { view = 'week', date = '', staffId = null } = {}) {
  const params = new URLSearchParams({ view, date });
  const id = positiveId(staffId);
  if (id) {
    params.set('staff', String(id));
    params.set('activeStaff', String(id));
  }
  return `${basePath}?${params.toString()}`;
}

function bookingHref(bookingPath, { date = '', staffId = null } = {}) {
  const params = new URLSearchParams();
  if (date) params.set('date', String(date));
  const id = positiveId(staffId);
  if (id) params.set('staff', String(id));
  const query = params.toString();
  return `${bookingPath}${query ? `?${query}` : ''}`;
}

function resolveActiveStaff(model) {
  const permitted = Array.isArray(model?.permittedStaff) ? model.permittedStaff : [];
  const requested = positiveId(model?.activeStaffId);
  return permitted.find(person => positiveId(person.id) === requested)
    || permitted.find(person => (model?.timeline?.staff || []).some(item => positiveId(item.id) === positiveId(person.id)))
    || permitted[0]
    || null;
}

function visibleStaffIdsForPhone(model) {
  const ids = Array.isArray(model?.visibleStaffIds)
    ? model.visibleStaffIds.map(positiveId).filter(Boolean)
    : [];
  if (ids.length) return [...new Set(ids)];
  return [...new Set((model?.timeline?.staff || []).map(person => positiveId(person.id)).filter(Boolean))];
}

function calendarStaffHref(basePath, { view = 'week', date = '', staffIds = [], activeStaffId = null } = {}) {
  const params = new URLSearchParams({ view, date });
  for (const id of [...new Set((staffIds || []).map(positiveId).filter(Boolean))]) params.append('staff', String(id));
  const active = positiveId(activeStaffId);
  if (active) params.set('activeStaff', String(active));
  return `${basePath}?${params.toString()}`;
}

function publicHolidayCalendar(model) {
  const direct = Array.isArray(model?.publicHolidays) ? model.publicHolidays : [];
  const fallback = (model?.timeline?.closures || [])
    .filter(item => item?.source === 'public_holidays' || item?.closureType === 'public_holiday')
    .map(item => ({ date: item.date, name: item.reason, observed: item.observed }));
  const holidays = direct.length ? direct : fallback;
  const map = new Map();
  for (const holiday of holidays) {
    const key = String(holiday?.date || holiday?.holidayDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    map.set(key, {
      name: String(holiday?.name || holiday?.reason || 'Public holiday'),
      observed: holiday?.observed === true,
    });
  }
  return map;
}

function activePlannerDate(model) {
  const days = (model?.period?.dateKeys || []).filter(day => localDate(day)?.getUTCDay() !== 0);
  const requested = String(model?.dateKey || '');
  return days.includes(requested) ? requested : (days[0] || requested);
}

function phoneWeekDayLabel(value) {
  const date = localDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: BUSINESS_TIMEZONE,
    weekday: 'short',
    day: 'numeric',
  }).format(date).replace(',', '');
}

function renderPhoneWeekPlannerHeader(model, { basePath = '/calendar/read-only' } = {}) {
  const days = (model?.period?.dateKeys || []).filter(day => localDate(day)?.getUTCDay() !== 0);
  const activeDate = activePlannerDate(model);
  const visibleIds = visibleStaffIdsForPhone(model);
  const active = positiveId(model?.activeStaffId) || visibleIds[0] || null;
  const rendered = new Set(visibleIds);
  const permitted = Array.isArray(model?.permittedStaff) ? model.permittedStaff : (model?.timeline?.staff || []);
  const dayLinks = days.map(day => `<a class="phone-week-date${day === activeDate ? ' active' : ''}" data-phone-week-date="${escapeHtml(day)}" href="${escapeHtml(calendarStaffHref(basePath, { view: 'week', date: day, staffIds: visibleIds, activeStaffId: active }))}"${day === activeDate ? ' aria-current="date"' : ''}>${escapeHtml(phoneWeekDayLabel(day))}</a>`).join('');
  const staffButtons = permitted.map(person => {
    const id = positiveId(person.id);
    if (!id) return '';
    const isRendered = rendered.has(id);
    const isActive = id === active;
    return `<button type="button" class="phone-week-staff-toggle${isActive ? ' active' : ''}" data-phone-week-staff-id="${id}" data-phone-week-staff-rendered="${isRendered ? 'true' : 'false'}" aria-pressed="${isActive ? 'true' : 'false'}">${escapeHtml(person.displayName || `Staff ${id}`)}</button>`;
  }).join('');
  return `<section class="phone-week-planner-header" data-phone-week-planner aria-label="Week planner"><nav class="phone-week-date-strip" aria-label="Week dates">${dayLinks}</nav><div class="phone-week-staff-strip" aria-label="Active practitioner">${staffButtons}</div></section>`;
}

function clockMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return Number.isFinite(minutes) ? minutes : null;
}

function instantDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function instantMinutes(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIMEZONE,
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .filter(interval => Array.isArray(interval) && Number.isFinite(interval[0]) && Number.isFinite(interval[1]) && interval[1] > interval[0])
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (!last || interval[0] > last[1]) merged.push([...interval]);
    else last[1] = Math.max(last[1], interval[1]);
  }
  return merged;
}

function subtractInterval(intervals, removed) {
  if (!removed || removed[1] <= removed[0]) return intervals;
  const next = [];
  for (const interval of intervals) {
    if (removed[1] <= interval[0] || removed[0] >= interval[1]) {
      next.push(interval);
      continue;
    }
    if (removed[0] > interval[0]) next.push([interval[0], Math.min(removed[0], interval[1])]);
    if (removed[1] < interval[1]) next.push([Math.max(removed[1], interval[0]), interval[1]]);
  }
  return next;
}

function overlapMinutes(a, b) {
  return Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
}

function itemStaffIds(item) {
  if (Array.isArray(item?.staffIds)) return item.staffIds.map(positiveId).filter(Boolean);
  const id = positiveId(item?.staffId);
  return id ? [id] : [];
}

function phoneDayCapacity(model, day) {
  const timeline = model?.timeline || {};
  const staff = timeline.staff || [];
  const weekday = localDate(day)?.getUTCDay();
  const closed = (timeline.closures || []).some(item => String(item?.date || '').slice(0, 10) === day);
  if (closed || !Number.isInteger(weekday)) return { band: 'closed', ratio: null, label: 'Closed' };

  let nominalMinutes = 0;
  let freeMinutes = 0;
  for (const person of staff) {
    const staffId = positiveId(person.id);
    if (!staffId) continue;
    const base = (timeline.workingWindows || [])
      .filter(item => positiveId(item.staffId) === staffId && Number(item.dayOfWeek) === weekday)
      .map(item => [clockMinutes(item.startsLocal), clockMinutes(item.endsLocal)]);
    const exceptions = (timeline.scheduleExceptions || [])
      .filter(item => positiveId(item.staffId) === staffId && String(item.date || '').slice(0, 10) === day);
    const available = exceptions
      .filter(item => item.exceptionType === 'available' && item.startsLocal && item.endsLocal)
      .map(item => [clockMinutes(item.startsLocal), clockMinutes(item.endsLocal)]);
    let nominal = mergeIntervals([...base, ...available]);
    if (!nominal.length) continue;
    nominalMinutes += nominal.reduce((sum, interval) => sum + interval[1] - interval[0], 0);

    const allDayUnavailable = exceptions.some(item => item.exceptionType === 'unavailable' && !item.startsLocal && !item.endsLocal);
    let usable = allDayUnavailable ? mergeIntervals(available) : nominal.map(interval => [...interval]);
    for (const item of exceptions.filter(item => item.exceptionType === 'unavailable' && item.startsLocal && item.endsLocal)) {
      usable = subtractInterval(usable, [clockMinutes(item.startsLocal), clockMinutes(item.endsLocal)]);
    }
    for (const block of (timeline.blocks || []).filter(item => itemStaffIds(item).includes(staffId) && instantDateKey(item.startsAt) === day)) {
      usable = subtractInterval(usable, [instantMinutes(block.startsAt), instantMinutes(block.endsAt)]);
    }
    usable = mergeIntervals(usable);
    const usableMinutes = usable.reduce((sum, interval) => sum + interval[1] - interval[0], 0);
    let booked = 0;
    for (const appointment of (timeline.appointments || []).filter(item => itemStaffIds(item).includes(staffId) && instantDateKey(item.startsAt) === day)) {
      const appointmentInterval = [instantMinutes(appointment.startsAt), instantMinutes(appointment.endsAt)];
      booked += usable.reduce((sum, interval) => sum + overlapMinutes(interval, appointmentInterval), 0);
    }
    freeMinutes += Math.max(0, usableMinutes - booked);
  }

  if (nominalMinutes <= 0) return { band: 'closed', ratio: null, label: 'No scheduled capacity' };
  const ratio = Math.max(0, Math.min(1, 1 - (freeMinutes / nominalMinutes)));
  const band = ratio < 0.35 ? 'light' : ratio < 0.7 ? 'medium' : 'busy';
  const label = `${Math.round(ratio * 100)}% capacity used or unavailable`;
  return { band, ratio, label };
}

function decoratePhoneMonthCapacity(html, model) {
  if (model?.view !== 'month') return String(html || '');
  let output = String(html || '');
  const holidays = publicHolidayCalendar(model);
  for (const day of model?.period?.dateKeys || []) {
    const capacity = phoneDayCapacity(model, day);
    const holiday = holidays.get(day);
    const marker = `data-date="${escapeHtml(day)}" data-item-count="`;
    const holidayAttrs = holiday
      ? ` data-phone-public-holiday="${escapeHtml(holiday.name)}" data-phone-public-holiday-observed="${holiday.observed ? 'true' : 'false'}"`
      : '';
    output = output.replace(marker, `data-date="${escapeHtml(day)}" data-phone-capacity-band="${capacity.band}" data-phone-capacity-label="${escapeHtml(capacity.label)}"${holidayAttrs} data-item-count="`);
  }
  return output;
}

function buildMonthCells({ model, date, activeStaffId, basePath }) {
  const target = localDate(date);
  if (!target) return '';
  const year = target.getUTCFullYear();
  const month = target.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0, 12)).getUTCDate();
  const visibleIds = visibleStaffIdsForPhone(model);
  const holidays = publicHolidayCalendar(model);
  const cells = [];
  let started = false;
  for (let day = 1; day <= lastDay; day += 1) {
    const current = new Date(Date.UTC(year, month, day, 12));
    const weekday = current.getUTCDay();
    if (weekday === 0) continue;
    if (!started) {
      for (let blank = 1; blank < weekday; blank += 1) cells.push('<span class="phone-date-blank" aria-hidden="true"></span>');
      started = true;
    }
    const key = dateKey(current);
    const holiday = holidays.get(key);
    const href = calendarStaffHref(basePath, { view: 'week', date: key, staffIds: visibleIds, activeStaffId });
    const currentClass = key === date ? ' current' : '';
    const holidayLabel = holiday ? `, ${holiday.name}${holiday.observed ? ' observed' : ''}, public holiday` : '';
    cells.push(`<a class="phone-date-cell${currentClass}" href="${escapeHtml(href)}" aria-label="${escapeHtml(`${day}${holidayLabel}`)}"${key === date ? ' aria-current="date"' : ''}><span>${day}</span>${holiday ? `<span class="phone-date-holiday-dot" title="${escapeHtml(`Public holiday — ${holiday.name}${holiday.observed ? ' observed' : ''}`)}" aria-hidden="true"></span>` : ''}</a>`);
  }
  return cells.join('');
}

function renderPhoneCalendarControls(model, { basePath = '/calendar/read-only' } = {}) {
  const active = resolveActiveStaff(model);
  const activeStaffId = positiveId(active?.id);
  const date = String(model?.dateKey || '');
  const view = ['week', 'agenda', 'month'].includes(model?.view) ? model.view : 'week';
  const visibleIds = visibleStaffIdsForPhone(model);
  const target = localDate(date) || new Date();
  const previousMonth = operationalMonthAnchor(target.getUTCFullYear(), target.getUTCMonth() - 1);
  const nextMonth = operationalMonthAnchor(target.getUTCFullYear(), target.getUTCMonth() + 1);
  const viewOptions = ['week', 'agenda', 'month'].map(option => {
    const label = option[0].toUpperCase() + option.slice(1);
    const href = calendarStaffHref(basePath, { view: option, date, staffIds: visibleIds, activeStaffId });
    return `<a class="phone-view-option${view === option ? ' active' : ''}" data-phone-calendar-view="${option}" href="${escapeHtml(href)}"${view === option ? ' aria-current="page"' : ''}>${label}</a>`;
  }).join('');
  const staffOptions = (model?.permittedStaff || []).map(person => {
    const id = positiveId(person.id);
    if (!id) return '';
    const href = calendarStaffHref(basePath, { view, date, staffIds: visibleIds, activeStaffId: id });
    return `<a class="phone-staff-option${id === activeStaffId ? ' active' : ''}" data-phone-staff-id="${id}" href="${escapeHtml(href)}"${id === activeStaffId ? ' aria-current="true"' : ''}>${escapeHtml(person.displayName || `Staff ${id}`)}</a>`;
  }).join('');
  const previousHref = calendarStaffHref(basePath, { view, date: previousMonth, staffIds: visibleIds, activeStaffId });
  const nextHref = calendarStaffHref(basePath, { view, date: nextMonth, staffIds: visibleIds, activeStaffId });
  const monthCells = buildMonthCells({ model, date, activeStaffId, basePath });
  return `<section class="phone-calendar-v2-controls" data-phone-calendar-v2-controls aria-label="Phone Calendar controls">
    <details class="phone-date-menu" data-phone-calendar-menu>
      <summary aria-label="Choose date"><strong>${escapeHtml(monthLabel(date))}</strong><span aria-hidden="true">⌄</span></summary>
      <div class="phone-date-popover"><header><a href="${escapeHtml(previousHref)}" aria-label="Previous month">‹</a><strong>${escapeHtml(monthLabel(date, true))}</strong><a href="${escapeHtml(nextHref)}" aria-label="Next month">›</a></header><div class="phone-date-weekdays" aria-hidden="true"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div><div class="phone-date-grid">${monthCells}</div></div>
    </details>
    <details class="phone-view-menu" data-phone-calendar-menu><summary aria-label="Choose Calendar view"><strong>${escapeHtml(view[0].toUpperCase() + view.slice(1))}</strong><span aria-hidden="true">⌄</span></summary><nav>${viewOptions}</nav></details>
    ${active ? `<details class="phone-staff-menu" data-phone-calendar-menu><summary aria-label="Choose action practitioner"><span class="status-dot" aria-hidden="true"></span><strong data-phone-active-staff="${activeStaffId}">${escapeHtml(active.displayName || `Staff ${activeStaffId}`)}</strong><span aria-hidden="true">⌄</span></summary><nav>${staffOptions}</nav></details>` : ''}
  </section>`;
}

function mutationEnabled(model) {
  return model?.mutationCapability?.enabled === true
    && Array.isArray(model.mutationCapability.operations);
}

function staffOperationEnabled(model, operation, staffId) {
  return mutationEnabled(model)
    && model.mutationCapability.operations.includes(operation)
    && allowsStaffTarget(model.mutationCapability, staffId);
}

function renderPhoneCalendarDock(model, {
  basePath = '/calendar/read-only',
  bookingPath = '/calendar/book',
  couplesBookingPath = '/calendar/book/couples',
  bookingAllowed = false,
  retrospectiveBookingPath = '/calendar/book/past',
  retrospectiveAllowed = false,
} = {}) {
  const active = resolveActiveStaff(model);
  const visibleStaffIds = visibleStaffIdsForPhone(model);
  const staffId = positiveId(active?.id);
  const date = String(model?.dateKey || '');
  const view = ['week', 'agenda', 'month'].includes(model?.view) ? model.view : 'week';
  const todayHref = calendarStaffHref(basePath, { view, date: businessToday(), staffIds: visibleStaffIds, activeStaffId: staffId });
  const bookingActions = [];
  const availabilityActions = [];
  if (bookingAllowed) {
    bookingActions.push(`<a data-phone-appointment-action href="${escapeHtml(bookingHref(bookingPath, { date, staffId }))}" aria-label="Create appointment">${renderLucideIcon('calendarPlus', { size: 17 })}<span>New appointment</span></a>`);
    bookingActions.push(`<a data-phone-appointment-action data-calendar-booking-kind="couples" href="${escapeHtml(bookingHref(couplesBookingPath, { date }))}" aria-label="Book a Couples booking for two guests">${renderLucideIcon('couples', { size: 17 })}<span>Couples booking</span><small>2 guests</small></a>`);
  }
  if (retrospectiveAllowed) {
    bookingActions.push(`<a data-phone-appointment-action href="${escapeHtml(bookingHref(retrospectiveBookingPath, { date, staffId }))}" aria-label="Record past appointment">${renderLucideIcon('history', { size: 17 })}<span>Record past appointment</span></a>`);
  }
  if (staffId && staffOperationEnabled(model, 'calendar_block:manage', staffId)) {
    availabilityActions.push(`<span class="phone-plus-lane-context lane"><h3 class="sr-only">${escapeHtml(active.displayName || `Staff ${staffId}`)}</h3><button type="button" data-calendar-operation="add-block" data-staff-id="${staffId}" data-date="${escapeHtml(date)}">${renderLucideIcon('block', { size: 17 })}<span>Block time</span></button></span>`);
  }
  if (staffId && staffOperationEnabled(model, 'operational_leave:manage', staffId)) {
    availabilityActions.push(`<span class="phone-plus-lane-context lane"><h3 class="sr-only">${escapeHtml(active.displayName || `Staff ${staffId}`)}</h3><button type="button" data-calendar-operation="add-leave" data-staff-id="${staffId}" data-date="${escapeHtml(date)}">${renderLucideIcon('leave', { size: 17 })}<span>Leave</span></button></span>`);
  }
  const actions = [
    ...bookingActions,
    ...(bookingActions.length && availabilityActions.length ? ['<div class="phone-plus-divider" role="separator" aria-label="Availability controls"></div>'] : []),
    ...availabilityActions,
  ];
  return `<div class="phone-calendar-v2-actions" data-phone-calendar-v2-actions>
    <a class="phone-today-action" href="${escapeHtml(todayHref)}">${renderLucideIcon('today', { size: 15 })}<span>Today</span></a>
    ${actions.length ? `<details class="phone-plus-menu" data-phone-calendar-menu><summary aria-label="Booking actions">${renderLucideIcon('plus', { size: 18 })}<span>+ Booking</span></summary><div class="phone-plus-popover">${actions.join('')}</div></details>` : ''}
  </div>`;
}

function phoneCalendarV2Styles() {
  const gridHeight = ((GRID_END_MINUTES - GRID_START_MINUTES) / 60) * PHONE_GRID_PIXELS_PER_HOUR;
  const halfHour = PHONE_GRID_PIXELS_PER_HOUR / 2;
  return `.phone-calendar-v2-controls,.phone-calendar-v2-actions,.phone-week-planner-header{display:none}
@media(max-width:700px){
body[data-phone-calendar-v2="true"] .workspace-main .topbar,body[data-phone-calendar-v2="true"] .workspace-main .controls,body[data-phone-calendar-v2="true"] .workspace-main .scan-summary,body[data-phone-calendar-v2="true"] .workspace-main .operation-status,body[data-phone-calendar-v2="true"] .workspace-main .footer-note,body[data-phone-calendar-v2="true"] .workspace-main .calendar-booking-hint,body[data-phone-calendar-v2="true"] .workspace-main .view-practitioner-context{display:none!important}
body[data-phone-calendar-v2="true"] .workspace-main>.shell{padding:5px 4px 7px!important}
.phone-calendar-v2-controls{position:relative;z-index:55;display:grid;grid-template-columns:minmax(76px,.8fr) minmax(68px,.65fr) minmax(0,1.4fr);align-items:center;gap:4px;min-height:44px;margin:0 0 4px 49px}
.phone-calendar-v2-actions{position:relative;z-index:54;display:grid;grid-template-columns:minmax(88px,.7fr) minmax(132px,1fr);gap:4px;margin:0 0 4px 49px}
.phone-calendar-v2-controls details{position:relative;min-width:0}
.phone-calendar-v2-controls summary{display:flex;align-items:center;justify-content:center;gap:4px;min-width:0;min-height:44px;padding:5px 7px;border:1px solid var(--line);border-radius:9px;background:#fff;list-style:none;font-size:.69rem;font-weight:800;cursor:pointer;box-shadow:0 2px 7px rgba(32,50,43,.05)}
.phone-calendar-v2-controls summary::-webkit-details-marker,.phone-plus-menu>summary::-webkit-details-marker{display:none}
.phone-calendar-v2-controls summary strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.phone-calendar-v2-controls nav,.phone-date-popover{position:absolute;top:calc(100% + 4px);z-index:80;display:grid;gap:3px;padding:6px;border:1px solid var(--line);border-radius:11px;background:#fff;box-shadow:0 14px 32px rgba(20,45,35,.2)}
.phone-view-menu nav{left:0;width:146px}.phone-staff-menu nav{right:0;width:min(230px,calc(100vw - 12px));max-height:55vh;overflow:auto}
.phone-view-option,.phone-staff-option{display:flex;align-items:center;min-height:44px;padding:8px 10px;border-radius:8px;font-size:.76rem;font-weight:750}.phone-view-option.active,.phone-staff-option.active{background:var(--leaf-soft);color:var(--leaf-deep)}
.phone-date-popover{left:-50px;width:min(326px,calc(100vw - 10px));gap:6px;padding:7px}.phone-date-popover header{display:grid;grid-template-columns:44px 1fr 44px;align-items:center;text-align:center}.phone-date-popover header a{display:grid;place-items:center;min-height:44px;border-radius:8px;font-size:1.2rem}.phone-date-weekdays,.phone-date-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:2px}.phone-date-weekdays span{padding:2px 0;text-align:center;color:var(--muted);font-size:.56rem;font-weight:800}.phone-date-cell,.phone-date-blank{display:grid;place-items:center;min-height:44px;border-radius:8px;font-size:.72rem}.phone-date-cell{position:relative}.phone-date-holiday-dot{position:absolute;left:50%;bottom:4px;width:5px;height:5px;border-radius:50%;background:#b6554f;transform:translateX(-50%)}.phone-date-cell.current{background:var(--leaf-deep);color:#fff;font-weight:850}.phone-date-cell.current .phone-date-holiday-dot{background:#fff}
body[data-phone-calendar-v2="true"] .workspace-main .calendar-view{padding:0!important;border-radius:7px!important;box-shadow:none!important;overflow:hidden!important}
body[data-phone-calendar-v2="true"] .workspace-main .view-heading{display:none!important}
body[data-phone-calendar-v2="true"] .workspace-main .day-time-grid{margin:0!important;max-height:calc(100dvh - 53px)!important;border:0!important;border-radius:0!important}
body[data-phone-calendar-v2="true"] .workspace-main .week-time-grid{margin:0!important;max-height:calc(100dvh - 137px)!important;border:0!important;border-radius:0!important}
body[data-phone-calendar-v2="true"] .workspace-main .day-time-grid{grid-template-columns:34px minmax(0,1fr)!important;overflow:auto!important}
body[data-phone-calendar-v2="true"] .workspace-main .day-time-grid .time-rail{width:34px!important;margin-top:32px!important}
body[data-phone-calendar-v2="true"] .workspace-main .time-rail{height:${gridHeight}px!important}
body[data-phone-calendar-v2="true"] .workspace-main .time-rail span{top:var(--phone-grid-top,var(--grid-top))!important;right:3px!important;font-size:.49rem!important}
body[data-phone-calendar-v2="true"] .workspace-main .time-column{height:${gridHeight}px!important;min-height:${gridHeight}px!important;background:repeating-linear-gradient(to bottom,transparent 0,transparent ${halfHour - 1}px,var(--line) ${halfHour - 1}px,var(--line) ${halfHour}px)!important}
body[data-phone-calendar-v2="true"] .workspace-main .calendar-booking-slots{pointer-events:none!important}body[data-phone-calendar-v2="true"] .workspace-main .calendar-booking-slot{pointer-events:none!important}body[data-phone-calendar-v2="true"] .workspace-main .calendar-booking-slot>span{display:none!important}
body[data-phone-calendar-v2="true"] .workspace-main .day-view .day-time-grid .lanes{display:block!important;min-width:0!important;width:100%!important}
body[data-phone-calendar-v2="true"] .workspace-main .day-view .day-time-grid .lane{display:none!important;min-width:0!important;width:100%!important;border:0!important;border-radius:0!important}
body[data-phone-calendar-v2="true"] .workspace-main .day-view .day-time-grid .lane[data-phone-active-practitioner="true"]{display:block!important}
body[data-phone-calendar-v2="true"] .workspace-main .day-view .lane>header{height:32px!important;min-height:32px!important;padding:3px 7px!important;align-items:center!important}
body[data-phone-calendar-v2="true"] .workspace-main .day-view .lane h3{font-size:.72rem!important}body[data-phone-calendar-v2="true"] .workspace-main .day-view .lane header p,body[data-phone-calendar-v2="true"] .workspace-main .day-view .lane-count{display:none!important}
body[data-phone-calendar-v2="true"] .workspace-main .day-view .lane-actions{display:none!important}
.phone-week-planner-header{display:grid;gap:2px;border-bottom:1px solid var(--line);background:#fafbf8}.phone-week-date-strip{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:2px;padding:2px}.phone-week-date{display:grid;place-items:center;min-width:0;min-height:44px;padding:3px 1px;border-radius:8px;color:var(--muted);font-size:.62rem;font-weight:800}.phone-week-date.active{background:var(--leaf-deep);color:#fff}.phone-week-staff-strip{display:flex;gap:3px;min-height:46px;padding:1px 3px 3px;overflow-x:auto;scrollbar-width:none}.phone-week-staff-strip::-webkit-scrollbar{display:none}.phone-week-staff-toggle{flex:0 0 auto;min-height:44px;padding:6px 9px;border:1px solid var(--line);border-radius:9px;background:#fff;color:var(--muted);font:inherit;font-size:.66rem;font-weight:800;cursor:pointer}.phone-week-staff-toggle.active{border-color:var(--leaf);background:var(--leaf-soft);color:var(--leaf-deep)}
body[data-phone-calendar-v2="true"] .workspace-main .week-time-grid{grid-template-columns:32px minmax(0,1fr)!important;overflow:auto!important}
body[data-phone-calendar-v2="true"] .workspace-main .week-time-grid .time-rail{width:32px!important;margin-top:0!important}
body[data-phone-calendar-v2="true"] .workspace-main .week-grid{display:block!important;min-width:0!important;width:100%!important}
body[data-phone-calendar-v2="true"] .workspace-main .week-day.week-date-lane{display:none!important}body[data-phone-calendar-v2="true"] .workspace-main .week-day.week-date-lane[data-phone-active-day="true"]{display:block!important}
body[data-phone-calendar-v2="true"] .workspace-main .week-day{display:block!important;min-width:0!important;width:auto!important;border:0!important;border-right:1px solid var(--line)!important;border-radius:0!important}
body[data-phone-calendar-v2="true"] .workspace-main .week-day:last-child{border-right:0!important}
body[data-phone-calendar-v2="true"] .workspace-main .week-day>header{display:none!important}
body[data-phone-calendar-v2="true"] .workspace-main .week-practitioner-hours,body[data-phone-calendar-v2="true"] .workspace-main .week-day-date,body[data-phone-calendar-v2="true"] .workspace-main .week-day>header small,body[data-phone-calendar-v2="true"] .workspace-main .week-day-month{display:none!important}body[data-phone-calendar-v2="true"] .workspace-main .week-practitioner-name{display:block!important;max-width:100%!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;text-align:center!important;font-size:.64rem!important;line-height:1.05!important}
body[data-phone-calendar-v2="true"] .workspace-main .positioned-event{top:var(--phone-event-top,var(--event-top))!important;height:var(--phone-event-height,var(--event-height))!important;min-height:28px!important;overflow:visible!important}
body[data-phone-calendar-v2="true"] .workspace-main .week-view .positioned-event[data-phone-staff-visible="false"]{display:none!important}
body[data-phone-calendar-v2="true"] .workspace-main .day-view .positioned-event{left:2px!important;right:2px!important;width:auto!important}
body[data-phone-calendar-v2="true"] .workspace-main .positioned-event .event-card{height:100%!important;min-height:28px!important;padding:2px 4px!important;border-left-width:2px!important;border-radius:4px!important;box-shadow:none!important}
body[data-phone-calendar-v2="true"] .workspace-main .positioned-event .event-card-top{min-height:0!important;padding:0!important}body[data-phone-calendar-v2="true"] .workspace-main .positioned-event .event-time{font-size:.5rem!important;line-height:1!important}body[data-phone-calendar-v2="true"] .workspace-main .positioned-event .event-time-range{display:none!important}body[data-phone-calendar-v2="true"] .workspace-main .positioned-event .event-time-start{display:inline!important}
body[data-phone-calendar-v2="true"] .workspace-main .positioned-event .event-card h4{margin:1px 0 0!important;padding:0!important;font-size:.61rem!important;line-height:1.02!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
body[data-phone-calendar-v2="true"] .workspace-main .positioned-event .kind-pill,body[data-phone-calendar-v2="true"] .workspace-main .positioned-event .event-client-mobile,body[data-phone-calendar-v2="true"] .workspace-main .positioned-event .appointment-reference,body[data-phone-calendar-v2="true"] .workspace-main .positioned-event .provenance{display:none!important}
body[data-phone-calendar-v2="true"] .workspace-main .positioned-event .event-meta{margin:1px 0 0!important;padding:0!important;font-size:.48rem!important;line-height:1!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
body[data-phone-calendar-v2="true"] .workspace-main .positioned-event .event-card-actions{position:static!important;margin:0!important}body[data-phone-calendar-v2="true"] .workspace-main .positioned-event .event-operation{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;min-width:0!important;min-height:0!important;margin:0!important;padding:0!important;border:0!important;opacity:0!important}
body[data-phone-calendar-v2="true"] .workspace-main .lane-actions,body[data-phone-calendar-v2="true"] .workspace-main .availability-menu{display:none!important}
body[data-phone-calendar-v2="true"] .workspace-main .month-day-owners{display:none!important}
body[data-phone-calendar-v2="true"] .workspace-main .month-grid{border:0!important;border-radius:0!important;overflow:hidden!important}body[data-phone-calendar-v2="true"] .workspace-main .month-weekdays span{padding:6px 1px!important;text-align:center!important;font-size:.56rem!important}body[data-phone-calendar-v2="true"] .workspace-main .month-day{position:relative;min-height:124px!important;padding:0!important}body[data-phone-calendar-v2="true"] .workspace-main .month-day-link{position:absolute!important;inset:0!important;display:block!important;min-height:0!important;padding:0!important;border-radius:0!important}body[data-phone-calendar-v2="true"] .workspace-main .month-day-head{display:grid!important;min-height:48px!important;margin:0!important}body[data-phone-calendar-v2="true"] .workspace-main .month-day-summary{min-height:48px!important;padding:3px 1px!important}body[data-phone-calendar-v2="true"] .workspace-main .month-events{display:grid!important;gap:2px!important;padding:0 2px 3px!important}body[data-phone-calendar-v2="true"] .workspace-main .month-event .event-card{display:block!important;min-height:0!important;padding:3px 2px!important;border-left-width:3px!important;border-radius:4px!important}body[data-phone-calendar-v2="true"] .workspace-main .month-event .event-card-top{display:block!important}body[data-phone-calendar-v2="true"] .workspace-main .month-event .event-time{display:block!important;font-size:.5rem!important;line-height:1!important}body[data-phone-calendar-v2="true"] .workspace-main .month-event .event-time-range{display:none!important}body[data-phone-calendar-v2="true"] .workspace-main .month-event .event-time-start{display:inline!important}body[data-phone-calendar-v2="true"] .workspace-main .month-event .event-card h4{display:block!important;margin:2px 0 0!important;font-size:.52rem!important;line-height:1.05!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}body[data-phone-calendar-v2="true"] .workspace-main .month-event .event-meta,body[data-phone-calendar-v2="true"] .workspace-main .month-event .event-card-actions{display:none!important}body[data-phone-calendar-v2="true"] .workspace-main .month-more{display:block!important;margin:1px 2px 3px!important;padding:2px!important;font-size:.52rem!important;line-height:1!important;text-align:left!important}
.phone-today-action,.phone-plus-menu>summary{display:flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:6px 10px;border:1px solid var(--line-strong);border-radius:9px;background:#fff;color:var(--ink);font-size:.69rem;font-weight:800;list-style:none;cursor:pointer}.phone-today-action svg,.phone-plus-menu>summary svg{width:16px;height:16px;flex:0 0 16px}.phone-plus-menu{position:relative}.phone-plus-menu>summary{border-color:var(--leaf-deep);background:var(--leaf-deep);color:#fff}.phone-plus-popover{position:absolute;right:0;top:calc(100% + 4px);z-index:80;display:grid;gap:3px;width:min(210px,calc(100vw - 12px));padding:5px;border:1px solid var(--line);border-radius:11px;background:#fff;box-shadow:0 14px 30px rgba(20,45,35,.22)}.phone-plus-popover>a,.phone-plus-popover button{display:flex!important;align-items:center!important;justify-content:flex-start!important;width:100%!important;min-height:44px!important;padding:8px 10px!important;border:0!important;border-radius:8px!important;background:transparent!important;color:var(--ink)!important;font:inherit!important;font-size:.74rem!important;font-weight:800!important;text-align:left!important}.phone-plus-popover>a:hover,.phone-plus-popover button:hover{background:var(--leaf-soft)!important}.phone-plus-popover svg{flex:0 0 17px}.phone-plus-popover>a[data-calendar-booking-kind="couples"]{background:#fbf5f8!important;color:#633f55!important}.phone-plus-popover>a[data-calendar-booking-kind="couples"] small{margin-left:auto;padding:2px 6px;border-radius:999px;background:#ead9e1;font-size:.6rem}.phone-plus-divider{height:1px;margin:4px 5px;background:var(--line)}.phone-plus-lane-context{display:contents!important}
@container (max-height:44px){body[data-phone-calendar-v2="true"] .workspace-main .positioned-event .event-meta{display:none!important}body[data-phone-calendar-v2="true"] .workspace-main .positioned-event .event-time{display:none!important}body[data-phone-calendar-v2="true"] .workspace-main .positioned-event .event-card h4{margin:0!important}}
}
`;
}

function calendarPhoneCompactV2ClientScript() {
  const scale = PHONE_GRID_PIXELS_PER_HOUR / DESKTOP_GRID_PIXELS_PER_HOUR;
  return `(()=>{'use strict';
if(innerWidth>700)return;
const body=document.body;
const active=String(body.dataset.phoneActiveStaffId||'');
const bookingPath=String(body.dataset.phoneBookingPath||'');
const gridStart=${GRID_START_MINUTES},gridEnd=${GRID_END_MINUTES},pxPerHour=${PHONE_GRID_PIXELS_PER_HOUR},scale=${scale};
const all=(selector,root=document)=>Array.from(root.querySelectorAll(selector));
function px(node,name){const raw=node.style.getPropertyValue(name);const value=parseFloat(raw);return Number.isFinite(value)?value:null;}
all('.time-rail span').forEach(node=>{const value=px(node,'--grid-top');if(value!=null)node.style.setProperty('--phone-grid-top',(value*scale)+'px');});
all('.positioned-event').forEach(node=>{const top=px(node,'--event-top'),height=px(node,'--event-height');if(top!=null)node.style.setProperty('--phone-event-top',(top*scale)+'px');if(height!=null)node.style.setProperty('--phone-event-height',Math.max(28,height*scale)+'px');});
const dayLanes=all('.day-view .lane[data-staff-id]');
let activeLane=dayLanes.find(node=>String(node.dataset.staffId)===active)||dayLanes[0]||null;
dayLanes.forEach(node=>node.dataset.phoneActivePractitioner=String(node===activeLane));
const weekLanes=all('[data-week-date-lane]');
if(weekLanes.length){
  const activeDay=String(body.dataset.phoneActiveDate||weekLanes[0]?.dataset.date||'');
  const staffButtons=all('[data-phone-week-staff-id]');
  const permittedIds=staffButtons.map(button=>String(button.dataset.phoneWeekStaffId||'')).filter(Boolean);
  const renderedStaff=new Set(staffButtons.filter(button=>button.dataset.phoneWeekStaffRendered==='true').map(button=>String(button.dataset.phoneWeekStaffId||'')));
  let activeStaff=renderedStaff.has(active)?active:(Array.from(renderedStaff)[0]||'');
  const selectedIds=()=>Array.from(renderedStaff);
  function withStaff(href,ids,activeOverride){const url=new URL(href,location.origin);url.searchParams.delete('staff');ids.forEach(id=>url.searchParams.append('staff',id));if(activeOverride)url.searchParams.set('activeStaff',String(activeOverride));return url.pathname+'?'+url.searchParams.toString();}
  function syncPlannerLinks(){const ids=selectedIds();all('[data-phone-week-date],.phone-view-option,.phone-date-cell,.phone-today-action').forEach(node=>node.setAttribute('href',withStaff(node.getAttribute('href')||location.href,ids,activeStaff)));all('.phone-staff-option').forEach(node=>node.setAttribute('href',withStaff(node.getAttribute('href')||location.href,ids,node.dataset.phoneStaffId)));}
  function syncUrl(){const url=new URL(location.href);url.searchParams.delete('staff');selectedIds().forEach(id=>url.searchParams.append('staff',id));if(activeStaff)url.searchParams.set('activeStaff',activeStaff);history.replaceState(null,'',url.pathname+'?'+url.searchParams.toString());}
  function applyPlanner(){weekLanes.forEach(node=>{node.dataset.phoneActiveDay=String(node.dataset.date===activeDay);node.dataset.bookingStaffId=activeStaff;all('.positioned-event',node).forEach(eventNode=>{const card=eventNode.querySelector('[data-event-staff-ids]');const ids=String(card?.dataset.eventStaffIds||'').split(',').filter(Boolean);const visible=!ids.length||ids.includes(activeStaff);eventNode.dataset.phoneStaffVisible=String(visible);if(visible){eventNode.style.setProperty('--week-event-left','2px');eventNode.style.setProperty('--week-event-width','calc(100% - 4px)');}});});body.dataset.phoneActiveStaffId=activeStaff;staffButtons.forEach(button=>{const selected=String(button.dataset.phoneWeekStaffId)===activeStaff;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));});const activeButton=staffButtons.find(button=>String(button.dataset.phoneWeekStaffId)===activeStaff),activeLabel=document.querySelector('[data-phone-active-staff]');if(activeButton&&activeLabel){activeLabel.dataset.phoneActiveStaff=activeStaff;activeLabel.textContent=activeButton.textContent.trim();}all('.phone-staff-option').forEach(option=>{const selected=String(option.dataset.phoneStaffId)===activeStaff;option.classList.toggle('active',selected);if(selected)option.setAttribute('aria-current','true');else option.removeAttribute('aria-current');});all('[data-phone-appointment-action]').forEach(link=>{const url=new URL(link.href,location.origin);url.searchParams.set('staff',activeStaff);link.href=url.pathname+'?'+url.searchParams.toString();});all('.phone-plus-lane-context').forEach(lane=>{lane.dataset.staffId=activeStaff;const button=lane.querySelector('button[data-staff-id]');if(button)button.dataset.staffId=activeStaff;});syncUrl();syncPlannerLinks();}
  function reloadWith(ids,activeOverride){const url=new URL(location.href);url.searchParams.set('view','week');url.searchParams.set('date',activeDay);url.searchParams.delete('staff');ids.forEach(id=>url.searchParams.append('staff',id));if(activeOverride)url.searchParams.set('activeStaff',String(activeOverride));location.assign(url.pathname+'?'+url.searchParams.toString());}
  staffButtons.forEach(button=>button.addEventListener('click',()=>{const id=String(button.dataset.phoneWeekStaffId||'');if(!id)return;if(!renderedStaff.has(id)){reloadWith([...new Set([...selectedIds(),id])],id);return;}activeStaff=id;applyPlanner();}));
  applyPlanner();
}
document.addEventListener('toggle',event=>{const opened=event.target;if(!opened?.matches?.('[data-phone-calendar-menu]')||!opened.open)return;all('[data-phone-calendar-menu][open]').forEach(menu=>{if(menu!==opened)menu.open=false;});},true);
function laneContext(column){const lane=column.closest('[data-date]');if(!lane)return null;const staffId=Number(lane.dataset.staffId||lane.dataset.bookingStaffId),date=lane.dataset.date;if(!Number.isSafeInteger(staffId)||staffId<1||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(date||'')))return null;return{staffId,date};}
function formatTime(minutes){const h=Math.floor(minutes/60),m=minutes%60;return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');}
if(bookingPath){all('.day-view .time-column,.week-view .time-column').forEach(column=>{column.addEventListener('click',event=>{if(event.defaultPrevented||event.button>0||event.target.closest('a,button,.positioned-event,.event-card'))return;const context=laneContext(column);if(!context)return;const rect=column.getBoundingClientRect();if(rect.height<=0)return;const y=Math.max(0,Math.min(rect.height-1,event.clientY-rect.top));const raw=gridStart+(y/pxPerHour)*60;const snapped=Math.max(gridStart,Math.min(gridEnd-30,Math.round(raw/30)*30));const params=new URLSearchParams({date:context.date,time:formatTime(snapped),staff:String(context.staffId)});location.assign(bookingPath+'?'+params.toString());});});}
})();`;
}

function decoratePhoneCalendarV2(html, {
  model = {},
  basePath = '/calendar/read-only',
  bookingPath = '/calendar/book',
  couplesBookingPath = '/calendar/book/couples',
  bookingAllowed = false,
  retrospectiveBookingPath = '/calendar/book/past',
  retrospectiveAllowed = false,
} = {}) {
  let output = String(html || '');
  if (!output.includes('<body') || !output.includes('<head')) return output;
  const active = resolveActiveStaff(model);
  const activeStaffId = positiveId(active?.id);
  const controls = renderPhoneCalendarControls(model, { basePath });
  const actions = renderPhoneCalendarDock(model, { basePath, bookingPath, couplesBookingPath, bookingAllowed, retrospectiveBookingPath, retrospectiveAllowed });
  const scriptPath = `${String(basePath || '/calendar/read-only').replace(/\/$/, '')}/phone-v2.js`;
  const plannerDate = activePlannerDate(model);
  const bodyAttrs = ` data-phone-calendar-v2="true"${activeStaffId ? ` data-phone-active-staff-id="${activeStaffId}"` : ''}${plannerDate ? ` data-phone-active-date="${escapeHtml(plannerDate)}"` : ''}${bookingAllowed ? ` data-phone-booking-path="${escapeHtml(bookingPath)}"` : ''}`;
  output = output.replace('<body ', `<body${bodyAttrs} `);
  output = output.replace('</head>', `<style>${phoneCalendarV2Styles()}</style><script src="${escapeHtml(scriptPath)}" defer></script></head>`);
  output = output.replace('<div class="shell">', `<div class="shell">${controls}${actions}`);
  if (model?.view === 'week') {
    const plannerHeader = renderPhoneWeekPlannerHeader(model, { basePath });
    output = output.replace('<div class="time-grid week-time-grid">', `${plannerHeader}<div class="time-grid week-time-grid">`);
  }
  output = decoratePhoneMonthCapacity(output, model);
  return output;
}

module.exports = {
  PHONE_GRID_PIXELS_PER_HOUR,
  GRID_END_MINUTES,
  calendarHref,
  calendarPhoneCompactV2ClientScript,
  decoratePhoneCalendarV2,
  phoneCalendarV2Styles,
  renderPhoneCalendarControls,
  renderPhoneCalendarDock,
  resolveActiveStaff,
};
