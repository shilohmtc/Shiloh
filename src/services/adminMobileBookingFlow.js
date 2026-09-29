const { pool } = require('../db/pool');
const { normalizePhone } = require('./clientIdentityOnboarding');
const { listAvailableSlots } = require('./availabilityService');
const { findClients } = require('./adminClientLookup');
const { prepareAdminBooking, confirmAdminBooking, cancelPendingBooking } = require('./adminBooking');
const { prepareHistoricalAdminBooking, confirmHistoricalAdminBooking } = require('./adminHistoricalBooking');
const { parseClinicDateInput, johannesburgToday } = require('./adminClinicDateInput');
const { adminBookingEntitlement } = require('./adminBookingEntitlement');
const { compactListTitle, fullLabelDescription } = require('../presentation/whatsappListRowPresentation');
const {
  loadAdminMobileBookingSession,
  saveAdminMobileBookingSession,
  clearAdminMobileBookingSession,
} = require('./adminMobileBookingSession');

const sessions = new Map();
const PAGE_SIZE = 7;
const NEXT_AVAILABLE_DAYS = 30;

function key(sender) { return normalizePhone(sender); }
function clean(v = '') { return String(v || '').trim().replace(/\s+/g, ' '); }
function norm(v = '') { return clean(v).toLowerCase(); }
function isGreeting(v = '') { return /^(hi|hello|hey|howzit|hiya|good morning|good afternoon|good evening)[!. ]*$/i.test(clean(v)); }
function isNavigationEscape(v = '') { const n = norm(v); return ['menu', 'admin menu', 'home', 'admin'].includes(n) || isGreeting(v); }
function has(admin, p) { return admin?.permissions?.[p] === true; }
function short(v = '', max = 24) { const s = clean(v); return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1)).trim()}…`; }
function parseManualTime(v = '') {
  const m = clean(v).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
async function getSession(k) { const cached = sessions.get(k); if (cached) return cached; const durable = await loadAdminMobileBookingSession(k); if (durable) sessions.set(k, durable); return durable; }
async function setSession(k, state) { sessions.set(k, state); await saveAdminMobileBookingSession(k, state); return state; }
async function deleteSession(k) { sessions.delete(k); await clearAdminMobileBookingSession(k); }
async function getAdmin(sender) {
  const r = await pool.query(
    `SELECT id,staff_id,display_name,role,permissions,service_scope,business_role,calendar_scope
       FROM staff_admin_accounts
      WHERE normalized_whatsapp=$1 AND active=TRUE`,
    [key(sender)]
  );
  return r.rows[0] || null;
}
async function audit(id, action, metadata = {}) { await pool.query(`INSERT INTO crm_audit_events (actor_admin_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,'admin_mobile_booking',NULL,$3::jsonb)`, [id, action, JSON.stringify(metadata)]); }
function fmtDate(v) { return new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${v}T12:00:00+02:00`)); }
function fmtTime(v) { return new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(v)); }
function localDateTime(date, instant) { return `${date.split('-').reverse().join('/')} ${fmtTime(instant)}`; }
function displayServiceName(name = '') { return clean(name).replace(/^\d+\.\s*/, '').replace(/^[-–—]\s*/, ''); }
function addDays(iso, days) { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }

const bookingScope = adminBookingEntitlement;

async function scopedActiveServiceRows(admin) {
  const scope = bookingScope(admin);
  if (scope.staffIds?.length) {
    const r = await pool.query(
      `SELECT DISTINCT s.id,s.name,s.duration_minutes,s.processing_time_minutes,s.extra_time_minutes
         FROM services s
         JOIN staff_services ss ON ss.service_id=s.id
         JOIN staff st ON st.id=ss.staff_id
        WHERE s.status='active' AND st.status='active' AND st.client_bookable=TRUE
          AND st.id=ANY($1::bigint[])
        ORDER BY s.name,s.id`,
      [scope.staffIds]
    );
    return r.rows;
  }
  if (scope.staffNames?.length) {
    const r = await pool.query(
      `SELECT DISTINCT s.id,s.name,s.duration_minutes,s.processing_time_minutes,s.extra_time_minutes
         FROM services s
         JOIN staff_services ss ON ss.service_id=s.id
         JOIN staff st ON st.id=ss.staff_id
        WHERE s.status='active' AND st.status='active' AND st.client_bookable=TRUE
          AND LOWER(st.display_name)=ANY($1::text[])
        ORDER BY s.name,s.id`,
      [scope.staffNames]
    );
    return r.rows;
  }
  return [];
}

async function staffRowsForService(serviceId, admin) {
  const scope = bookingScope(admin);
  if (scope.staffIds?.length) {
    const r = await pool.query(
      `SELECT st.id,st.display_name,st.scheduling_type
         FROM staff_services ss JOIN staff st ON st.id=ss.staff_id
        WHERE ss.service_id=$1 AND st.status='active' AND st.client_bookable=TRUE
          AND st.id=ANY($2::bigint[])
        ORDER BY st.display_name,st.id`,
      [serviceId, scope.staffIds]
    );
    return r.rows;
  }
  if (scope.staffNames?.length) {
    const r = await pool.query(
      `SELECT st.id,st.display_name,st.scheduling_type
         FROM staff_services ss JOIN staff st ON st.id=ss.staff_id
        WHERE ss.service_id=$1 AND st.status='active' AND st.client_bookable=TRUE
          AND LOWER(st.display_name)=ANY($2::text[])
        ORDER BY st.display_name,st.id`,
      [serviceId, scope.staffNames]
    );
    return r.rows;
  }
  return [];
}

function clientLabel(c) {
  const contact = (c.contacts || []).find(x => x.isPrimary) || (c.contacts || [])[0];
  const digits = normalizePhone(contact?.normalizedValue || contact?.value || '');
  return `CRM #${c.id}${digits.length >= 4 ? ` · …${digits.slice(-4)}` : ''}`;
}

const CATEGORY_ORDER = ['Massage & Body', 'Facials & Skin', 'Needling & Aesthetics', 'Permanent Makeup', 'Feet & Pedicure', 'Other'];
const GROUP_ORDER = {
  'Massage & Body': ['Relaxation & Swedish', 'Sports & Therapeutic', 'Cupping & Targeted', 'Lymphatic & Recovery', 'Body Technology', 'Other Massage & Body'],
  'Facials & Skin': ['Facials', 'Peels & Resurfacing', 'Skin Programs', 'Other Skin'],
  'Needling & Aesthetics': ['Needling & Regeneration', 'HIFU & Plasma', 'Other Aesthetics'],
  'Permanent Makeup': ['Brows', 'Eyeliner', 'Areola & Other PMU'],
  'Feet & Pedicure': ['Pedicure & Foot Care'],
  'Other': ['Other Treatments'],
};

function categoryForService(name = '') {
  const n = displayServiceName(name).toLowerCase();
  if (/massage|lymphatic|cupping|psoas|back & neck|back, neck|upper back|sports|pregnancy|pressotherapy|ozone|infrared|sculp|renew & revive|body/.test(n)) return 'Massage & Body';
  if (/facial|peel|derma|brightening|hydrate|acne|pigmentation|clarity|glow|firm & lift|contour|hybrid|skin/.test(n)) return 'Facials & Skin';
  if (/microneedl|needling|plasma|profosma|hifu|growth factor|lip plump|sqt|stretch mark|aesthetic/.test(n)) return 'Needling & Aesthetics';
  if (/permanent makeup|permanant makeup|brows|eyeliner|areola/.test(n)) return 'Permanent Makeup';
  if (/pedicure|heel|foot massage|feet|toe gel/.test(n)) return 'Feet & Pedicure';
  return 'Other';
}

function subgroupForService(category, name = '') {
  const n = displayServiceName(name).toLowerCase();
  if (category === 'Massage & Body') {
    if (/swedish|relax|pregnancy|hot stone/.test(n)) return 'Relaxation & Swedish';
    if (/sports|deep tissue|therapeutic|psoas|back & neck|back, neck|upper back/.test(n)) return 'Sports & Therapeutic';
    if (/cupping|area specific|target/.test(n)) return 'Cupping & Targeted';
    if (/lymphatic|drainage|recovery/.test(n)) return 'Lymphatic & Recovery';
    if (/pressotherapy|ozone|infrared|sculp|renew & revive/.test(n)) return 'Body Technology';
    return 'Other Massage & Body';
  }
  if (category === 'Facials & Skin') {
    if (/peel|derma|resurfac/.test(n)) return 'Peels & Resurfacing';
    if (/acne|pigmentation|clarity|brightening|hydrate|glow|firm & lift|contour|program/.test(n)) return 'Skin Programs';
    if (/facial|skin/.test(n)) return 'Facials';
    return 'Other Skin';
  }
  if (category === 'Needling & Aesthetics') {
    if (/microneedl|needling|growth factor|sqt|stretch mark/.test(n)) return 'Needling & Regeneration';
    if (/hifu|plasma/.test(n)) return 'HIFU & Plasma';
    return 'Other Aesthetics';
  }
  if (category === 'Permanent Makeup') {
    if (/brow/.test(n)) return 'Brows';
    if (/eyeliner/.test(n)) return 'Eyeliner';
    return 'Areola & Other PMU';
  }
  if (category === 'Feet & Pedicure') return 'Pedicure & Foot Care';
  return 'Other Treatments';
}

function groupServices(services) {
  const categoryMap = new Map(CATEGORY_ORDER.map(c => [c, []]));
  for (const service of services) categoryMap.get(categoryForService(service.name)).push(service);
  return CATEGORY_ORDER.filter(c => categoryMap.get(c).length).map(name => {
    const categoryServices = categoryMap.get(name);
    const groupMap = new Map((GROUP_ORDER[name] || []).map(group => [group, []]));
    for (const service of categoryServices) {
      const group = subgroupForService(name, service.name);
      if (!groupMap.has(group)) groupMap.set(group, []);
      groupMap.get(group).push(service);
    }
    const groups = [...groupMap.entries()].filter(([, grouped]) => grouped.length).map(([groupName, grouped]) => ({ name: groupName, services: grouped }));
    return { name, services: categoryServices, groups };
  });
}

function listInteractive(body, buttonText, rows, sectionTitle = 'Choose') { return { type: 'list', body, buttonText, rows, sectionTitle }; }
function buttonInteractive(body, buttons) { return { type: 'button', body, buttons }; }
function cancelRow() { return { id: 'admin_booking_cancel_flow', title: 'Cancel booking', description: 'Exit without creating anything' }; }
function pageRows(items, page, rowFor) {
  const start = page * PAGE_SIZE;
  const slice = items.slice(start, start + PAGE_SIZE);
  const rows = slice.map(rowFor);
  if (page > 0) rows.push({ id: `admin_booking_page:${page - 1}`, title: '← Previous', description: 'Show the previous choices' });
  if (start + PAGE_SIZE < items.length) rows.push({ id: `admin_booking_page:${page + 1}`, title: 'Next →', description: 'Show more choices' });
  rows.push(cancelRow());
  return rows;
}
function categoryInteractive(scope, categories) {
  return listInteractive(
    `*Find & book an appointment*\n\nAvailable catalogue: *${scope.label}*.\nChoose a service category.`,
    'Choose category',
    [...categories.map((c, i) => ({ id: `admin_booking_category:${i}`, title: short(c.name), description: `${c.services.length} service${c.services.length === 1 ? '' : 's'}` })), cancelRow()],
    'Service category'
  );
}
function groupInteractive(scope, category) {
  return listInteractive(
    `*${scope.label} — ${category.name}*\n\nChoose a treatment group.`,
    'Choose group',
    [...category.groups.map((g, i) => ({ id: `admin_booking_group:${i}`, title: short(g.name), description: `${g.services.length} service${g.services.length === 1 ? '' : 's'}` })), cancelRow()],
    short(category.name)
  );
}
function serviceInteractive(scope, category, group, page = 0) {
  const heading = group && group.name !== category.name ? `${category.name} — ${group.name}` : category.name;
  return listInteractive(
    `*${scope.label} — ${heading}*\n\nChoose the treatment.`,
    'Choose service',
    pageRows(group.services, page, (s) => {
      const name = displayServiceName(s.name);
      return { id: `admin_booking_service:${s.id}`, title: compactListTitle(name), description: fullLabelDescription(name) };
    }),
    short(group.name || category.name)
  );
}
function staffInteractive(service, staff) {
  return listInteractive(`*${displayServiceName(service.name)}*\n\nChoose the eligible practitioner.`, 'Practitioner', [...staff.slice(0, 9).map(s => ({ id: `admin_booking_staff:${s.id}`, title: short(s.display_name), description: 'Eligible for this service' })), cancelRow()], 'Eligible practitioner');
}
function slotsInteractive(session, page = 0) {
  const rows = pageRows(session.slots, page, (s, i) => ({
    id: `admin_booking_slot:${page * PAGE_SIZE + i}`,
    title: fmtTime(s.starts_at),
    description: `Ends ${fmtTime(s.ends_at)} · available start`,
  }));
  const body = `*${fmtDate(session.date)} — Choose a time*\n\n${session.staff.display_name} · ${displayServiceName(session.service.name)}`;
  const guidance = 'Choose any available 15-minute start time. The full treatment must fit the practitioner diary and clinic schedule.';
  return listInteractive(rows.some((row) => /^admin_booking_slot:\d+$/i.test(row.id)) ? `${body}\n\n${guidance}` : body, 'Choose time', rows, 'Available times');
}
function clientsInteractive(clients) {
  return listInteractive('*Choose client*\n\nSelect the matching CRM client.', 'Choose client', [...clients.slice(0, 9).map((c) => {
    const name = c.display_name || 'Unnamed client';
    return { id: `admin_booking_client:${c.id}`, title: compactListTitle(name), description: fullLabelDescription(name, clientLabel(c)) };
  }), cancelRow()], 'CRM clients');
}
function noSlotsInteractive(session, exhausted = false) {
  const body = exhausted
    ? `*No nearby slots found*\n\nI checked the next ${NEXT_AVAILABLE_DAYS} days after ${fmtDate(session.date)} using the authoritative diary for ${session.staff.display_name} — ${displayServiceName(session.service.name)}.\n\nChoose another date or cancel.`
    : `*No slots — ${fmtDate(session.date)}*\n\nNo authoritative bookable slots were found for ${session.staff.display_name} — ${displayServiceName(session.service.name)}.\n\nWould you like me to find the next available date?`;
  const buttons = exhausted
    ? [{ id: 'admin_booking_choose_date', title: 'Choose another date' }, { id: 'admin_booking_cancel_flow', title: 'Cancel' }]
    : [{ id: 'admin_booking_next_available', title: 'Check next available' }, { id: 'admin_booking_choose_date', title: 'Choose another date' }, { id: 'admin_booking_cancel_flow', title: 'Cancel' }];
  return buttonInteractive(body, buttons);
}
async function findNextAvailable(session) {
  for (let offset = 1; offset <= NEXT_AVAILABLE_DAYS; offset += 1) {
    const date = addDays(session.date, offset);
    const result = await listAvailableSlots({ staffId: session.staff.id, serviceId: session.service.id, date, intervalMinutes: 15 });
    if (result.slots.length) return { date, slots: result.slots };
  }
  return null;
}

async function begin(sender, admin) {
  const scope = bookingScope(admin);
  const services = await scopedActiveServiceRows(admin);
  if (!services.length) {
    const reply = scope.key === 'no_practitioner_scope'
      ? 'Your admin menu is available, but this account has no practitioner booking scope. No client service can be booked from this account.'
      : `No active ${scope.label.toLowerCase()} are configured in CRM.`;
    return { handled: true, admin, reply };
  }
  const categories = groupServices(services);
  await setSession(key(sender), { step: 'category', categories, scopeKey: scope.key });
  await audit(admin.id, 'mobile_booking.started', { activeServiceCount: services.length, selectionOrder: 'service_first', bookingScope: scope.key, ux: 'whatsapp_interactive_list_grouped' });
  return { handled: true, admin, interactive: categoryInteractive(scope, categories) };
}

async function prepareCurrent(k, admin, current) {
  const historical = Boolean(current.historicalTime);
  const result = historical
    ? await prepareHistoricalAdminBooking({ adminId: admin.id, clientId: current.client.id, staffId: current.staff.id, serviceId: current.service.id, date: current.date, time: current.historicalTime })
    : await prepareAdminBooking({ adminId: admin.id, clientId: current.client.id, staffName: current.staff.display_name, serviceName: current.service.name, localDateTime: localDateTime(current.date, current.slot.starts_at) });
  await audit(admin.id, historical ? 'mobile_booking.historical_prepared' : 'mobile_booking.prepared', { status: result.status, clientId: current.client.id, staffId: current.staff.id, serviceId: current.service.id, date: current.date, time: historical ? current.historicalTime : fmtTime(current.slot.starts_at), bookingScope: bookingScope(admin).key, historicalManualEntry: historical });
  if (result.status !== 'pending_confirmation') {
    await deleteSession(k);
    return { handled: true, admin, reply: `Nothing was written.\n\n${result.reply}` };
  }
  await setSession(k, { step: historical ? 'historical-confirm' : 'confirm' });
  return { handled: true, admin, interactive: buttonInteractive(`${result.reply}\n\n*Ready to finish*\nNothing is written until you confirm.`, [{ id: 'admin_booking_confirm', title: 'Confirm booking' }, { id: 'admin_booking_cancel', title: 'Cancel booking' }]) };
}

async function processAdminMobileBookingFlowMessage(sender, text) {
  const raw = clean(text);
  const v = raw.toLowerCase();
  const k = key(sender);
  const session = await getSession(k);
  const direct = /^(find an available time|find availability|make a booking|new booking|find & book|find and book)$/i.test(raw);
  if (!session && !direct) return { handled: false };
  const admin = await getAdmin(sender);
  if (!admin) return { handled: false };
  if (!has(admin, 'appointment:view') || !has(admin, 'appointment:create')) return { handled: true, admin, reply: 'Your admin account needs both appointment view and create permission for the guided booking flow.' };
  if (session && isNavigationEscape(raw)) {
    if (['confirm', 'historical-confirm'].includes(session.step)) await cancelPendingBooking(admin.id);
    await deleteSession(k);
    return { handled: false };
  }
  if (!session) return begin(sender, admin);

  if (v === 'admin_booking_cancel_flow') {
    if (['confirm', 'historical-confirm'].includes(session?.step)) await cancelPendingBooking(admin.id);
    await deleteSession(k);
    await audit(admin.id, 'mobile_booking.cancelled', { step: session.step, source: 'interactive' });
    return { handled: true, admin, reply: 'Booking flow cancelled. Nothing was written. Reply MENU to return to Shiloh Admin.' };
  }
  if (session.step === 'historical-confirm') {
    if (v === 'admin_booking_confirm' || v === '1' || v === 'confirm booking') {
      const result = await confirmHistoricalAdminBooking(admin);
      await deleteSession(k);
      await audit(admin.id, 'mobile_booking.historical_confirmed', { status: result.status, appointmentId: result.appointmentId || null });
      return { handled: true, admin, reply: result.reply };
    }
    if (v === 'admin_booking_cancel' || v === '2' || v === '0' || v === 'cancel booking') {
      const cancelled = await cancelPendingBooking(admin.id);
      await deleteSession(k);
      await audit(admin.id, 'mobile_booking.cancelled', { step: 'historical-confirm', hadPendingBooking: cancelled });
      return { handled: true, admin, reply: cancelled ? 'Historical booking cancelled. Nothing was written.' : 'There is no pending historical booking to cancel.' };
    }
    return { handled: true, admin, interactive: buttonInteractive('Choose whether to confirm or cancel this historical booking.', [{ id: 'admin_booking_confirm', title: 'Confirm booking' }, { id: 'admin_booking_cancel', title: 'Cancel booking' }]) };
  }
  if (session.step === 'confirm') {
    if (v === 'admin_booking_confirm' || v === '1' || v === 'confirm booking') {
      const result = await confirmAdminBooking(admin);
      await deleteSession(k);
      await audit(admin.id, 'mobile_booking.confirmed', { status: result.status, appointmentId: result.appointmentId || null });
      return { handled: true, admin, reply: result.reply };
    }
    if (v === 'admin_booking_cancel' || v === '2' || v === '0' || v === 'cancel booking') {
      const cancelled = await cancelPendingBooking(admin.id);
      await deleteSession(k);
      await audit(admin.id, 'mobile_booking.cancelled', { step: 'confirm', hadPendingBooking: cancelled });
      return { handled: true, admin, reply: cancelled ? 'Booking cancelled. Nothing was written.' : 'There is no pending booking to cancel.' };
    }
    return { handled: true, admin, interactive: buttonInteractive('Choose whether to confirm or cancel this pending booking.', [{ id: 'admin_booking_confirm', title: 'Confirm booking' }, { id: 'admin_booking_cancel', title: 'Cancel booking' }]) };
  }
  if (v === '0') {
    await deleteSession(k);
    await audit(admin.id, 'mobile_booking.cancelled', { step: session.step });
    return { handled: true, admin, reply: 'Booking flow cancelled. Nothing was written. Reply MENU to return to Shiloh Admin.' };
  }

  if (session.step === 'category') {
    const m = v.match(/^admin_booking_category:(\d+)$/);
    const n = m ? Number(m[1]) : Number(v) - 1;
    if (!Number.isInteger(n) || n < 0 || n >= session.categories.length) return { handled: true, admin, interactive: categoryInteractive(bookingScope(admin), session.categories) };
    const category = session.categories[n];
    if (category.groups?.length > 1) {
      await setSession(k, { step: 'group', category, categories: session.categories, scopeKey: session.scopeKey });
      return { handled: true, admin, interactive: groupInteractive(bookingScope(admin), category) };
    }
    const group = category.groups?.[0] || { name: category.name, services: category.services };
    await setSession(k, { step: 'service', category, group, serviceRows: group.services, categories: session.categories, scopeKey: session.scopeKey, page: 0 });
    return { handled: true, admin, interactive: serviceInteractive(bookingScope(admin), category, group, 0) };
  }

  if (session.step === 'group') {
    const m = v.match(/^admin_booking_group:(\d+)$/);
    const n = m ? Number(m[1]) : Number(v) - 1;
    if (!Number.isInteger(n) || n < 0 || n >= session.category.groups.length) return { handled: true, admin, interactive: groupInteractive(bookingScope(admin), session.category) };
    const group = session.category.groups[n];
    await setSession(k, { step: 'service', category: session.category, group, serviceRows: group.services, categories: session.categories, scopeKey: session.scopeKey, page: 0 });
    return { handled: true, admin, interactive: serviceInteractive(bookingScope(admin), session.category, group, 0) };
  }

  if (session.step === 'service') {
    const pageMatch = v.match(/^admin_booking_page:(\d+)$/);
    if (pageMatch) {
      const page = Number(pageMatch[1]);
      await setSession(k, { ...session, page });
      return { handled: true, admin, interactive: serviceInteractive(bookingScope(admin), session.category, session.group, page) };
    }
    const m = v.match(/^admin_booking_service:(\d+)$/);
    let service = m ? session.serviceRows.find(s => String(s.id) === m[1]) : null;
    if (!service && /^\d+$/.test(v)) service = session.serviceRows[Number(v) - 1];
    if (!service) return { handled: true, admin, interactive: serviceInteractive(bookingScope(admin), session.category, session.group, session.page || 0) };
    const staff = await staffRowsForService(service.id, admin);
    if (!staff.length) {
      return { handled: true, admin, reply: [`*${displayServiceName(service.name)}*`, '', 'This service is inside your booking catalogue, but no eligible practitioner in your booking scope is currently mapped to perform it.', 'Nothing has been booked. Start again from Make a booking or reply MENU.'].join('\n') };
    }
    await setSession(k, { step: 'staff', service, staffRows: staff });
    return { handled: true, admin, interactive: staffInteractive(service, staff) };
  }

  if (session.step === 'staff') {
    const m = v.match(/^admin_booking_staff:(\d+)$/);
    let staff = m ? session.staffRows.find(s => String(s.id) === m[1]) : null;
    if (!staff && /^\d+$/.test(v)) staff = session.staffRows[Number(v) - 1];
    if (!staff) return { handled: true, admin, interactive: staffInteractive(session.service, session.staffRows) };
    await setSession(k, { step: 'date', staff, service: session.service });
    return { handled: true, admin, reply: [`*${displayServiceName(session.service.name)} — ${staff.display_name}*`, '', 'What date should I check or record?', 'You can send *15 Aug*, *tomorrow*, *Friday*, or *15/08/2026*.', 'Past dates are treated as historical manual entries.', '', 'Type 0 to cancel.'].join('\n') };
  }

  if (session.step === 'date') {
    if (v === 'admin_booking_choose_date') return { handled: true, admin, reply: 'Send another date naturally, for example *15 Aug*, *Friday*, *next Friday*, or *15/08/2026*. Past dates can be entered for historical reconciliation. Type 0 to cancel.' };
    if (v === 'admin_booking_next_available') {
      if (!session.date) return { handled: true, admin, reply: 'Choose a starting date first. You can send *15 Aug*, *tomorrow*, *Friday*, or *15/08/2026*.' };
      const next = await findNextAvailable(session);
      if (!next) {
        await audit(admin.id, 'mobile_booking.next_available_none', { staffId: session.staff.id, serviceId: session.service.id, startDate: session.date, searchedDays: NEXT_AVAILABLE_DAYS });
        return { handled: true, admin, interactive: noSlotsInteractive(session, true) };
      }
      const nextSession = { step: 'slot', staff: session.staff, service: session.service, date: next.date, slots: next.slots, page: 0 };
      await setSession(k, nextSession);
      await audit(admin.id, 'mobile_booking.next_available_found', { staffId: session.staff.id, serviceId: session.service.id, startDate: session.date, foundDate: next.date });
      return { handled: true, admin, interactive: slotsInteractive(nextSession, 0) };
    }
    const date = parseClinicDateInput(raw, { futureBias: false });
    if (!date) return { handled: true, admin, reply: 'Send a valid date, for example *15 Aug*, *tomorrow*, *Friday*, or *15/08/2026*. Type 0 to cancel.' };
    if (date < johannesburgToday()) {
      const historicalSession = { step: 'historical-time', staff: session.staff, service: session.service, date };
      await setSession(k, historicalSession);
      return { handled: true, admin, reply: [`*Historical manual booking — ${fmtDate(date)}*`, '', `${session.staff.display_name} · ${displayServiceName(session.service.name)}`, '', 'Enter the actual start time, for example *14:30*.', 'This will record the past appointment in CRM for reconciliation; it will not create a past Google Calendar event or message the client.', '', 'Type 0 to cancel.'].join('\n') };
    }
    const result = await listAvailableSlots({ staffId: session.staff.id, serviceId: session.service.id, date, intervalMinutes: 15 });
    if (!result.slots.length) {
      const noSlotSession = { ...session, date };
      await setSession(k, noSlotSession);
      return { handled: true, admin, interactive: noSlotsInteractive(noSlotSession) };
    }
    const slotSession = { step: 'slot', staff: session.staff, service: session.service, date, slots: result.slots, page: 0 };
    await setSession(k, slotSession);
    return { handled: true, admin, interactive: slotsInteractive(slotSession, 0) };
  }

  if (session.step === 'historical-time') {
    const historicalTime = parseManualTime(raw);
    if (!historicalTime) return { handled: true, admin, reply: 'Enter the actual historical start time as HH:MM, for example *09:30* or *14:30*. Type 0 to cancel.' };
    const historicalSession = { step: 'client-query', staff: session.staff, service: session.service, date: session.date, historicalTime };
    await setSession(k, historicalSession);
    return { handled: true, admin, reply: [`*Historical time: ${fmtDate(session.date)} · ${historicalTime}*`, '', `Practitioner: ${session.staff.display_name}`, `Service: ${displayServiceName(session.service.name)}`, '', 'Who was the client?', 'Send a client name or mobile number.', '', 'Type 0 to cancel.'].join('\n') };
  }

  if (session.step === 'slot') {
    const pageMatch = v.match(/^admin_booking_page:(\d+)$/);
    if (pageMatch) {
      const page = Number(pageMatch[1]);
      await setSession(k, { ...session, page });
      return { handled: true, admin, interactive: slotsInteractive(session, page) };
    }
    const m = v.match(/^admin_booking_slot:(\d+)$/);
    let slot = m ? session.slots[Number(m[1])] : null;
    if (!slot && /^\d+$/.test(v)) slot = session.slots[Number(v) - 1];
    if (!slot) return { handled: true, admin, interactive: slotsInteractive(session, session.page || 0) };
    await setSession(k, { step: 'client-query', staff: session.staff, service: session.service, date: session.date, slot });
    return { handled: true, admin, reply: [`*Selected: ${fmtDate(session.date)} · ${fmtTime(slot.starts_at)}–${fmtTime(slot.ends_at)}*`, '', `Practitioner: ${session.staff.display_name}`, `Service: ${displayServiceName(session.service.name)}`, '', 'Who is the client?', 'Send a client name or mobile number.', '', 'Type 0 to cancel.'].join('\n') };
  }

  if (session.step === 'client-query') {
    const found = await findClients(raw, 10);
    if (!found.clients.length) return { handled: true, admin, reply: `I couldn't find a canonical CRM client matching “${raw}”. Send another name/mobile number, or 0 to cancel.` };
    if (found.clients.length === 1) {
      const current = { ...session, client: found.clients[0] };
      await setSession(k, { ...current, step: 'prepare' });
      return prepareCurrent(k, admin, current);
    }
    await setSession(k, { step: 'client-pick', ...session, clientRows: found.clients });
    return { handled: true, admin, interactive: clientsInteractive(found.clients) };
  }

  if (session.step === 'client-pick') {
    const m = v.match(/^admin_booking_client:(\d+)$/);
    let client = m ? session.clientRows.find(c => String(c.id) === m[1]) : null;
    if (!client && /^\d+$/.test(v)) client = session.clientRows[Number(v) - 1];
    if (!client) return { handled: true, admin, interactive: clientsInteractive(session.clientRows) };
    const current = { ...session, client };
    await setSession(k, { ...current, step: 'prepare' });
    return prepareCurrent(k, admin, current);
  }

  return { handled: false };
}

module.exports = {
  processAdminMobileBookingFlowMessage,
  bookingScope,
  scopedActiveServiceRows,
  staffRowsForService,
  groupServices,
  subgroupForService,
  categoryInteractive,
  groupInteractive,
  serviceInteractive,
  staffInteractive,
  slotsInteractive,
  clientsInteractive,
  noSlotsInteractive,
  findNextAvailable,
  parseManualTime,
  getSession,
  setSession,
  deleteSession,
  isNavigationEscape,
};
