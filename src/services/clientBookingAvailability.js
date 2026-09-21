const { pool } = require('../db/pool');
const { listAvailableSlots } = require('./availabilityService');
const { getIntent, extractDate, extractTime, processBookingMessage, displayDate, verifyService } = require('./bookingIntent');
const { decorateClientBookingResult } = require('./clientBookingInteractive');
const { getClinicDateStatus, getNextOpenClinicDates } = require('./clinicDateChoices');
const { fullLabelDescription } = require('../presentation/whatsappListRowPresentation');

const SLOT_PAGE_SIZE = 9;
const TZ = 'Africa/Johannesburg';

function clean(value = '') { return String(value || '').trim().replace(/\s+/g, ' '); }
function localTimeParts(value) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { hh: map.hour, mm: map.minute, text: `${map.hour}:${map.minute}` };
}
function localDateKey(value) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}${map.month}${map.day}`;
}
function slotId(slot) { const time = localTimeParts(slot.starts_at); return `client_slot_${slot.staff_id}_${localDateKey(slot.starts_at)}_${time.hh}${time.mm}`; }
function isFutureSlot(slot, now = new Date()) { return new Date(slot.starts_at).getTime() > now.getTime(); }
function daypartForSlot(slot) { const hour = Number(localTimeParts(slot.starts_at).hh); if (hour < 12) return 'morning'; if (hour < 17) return 'afternoon'; return 'evening'; }
function explicitBookingDate(value = '') { const match=clean(value).toLowerCase().match(/^client_date_(\d{4}-\d{2}-\d{2})$/);return match?.[1]||null; }
function isAnyPractitionerPreference(value = '') { return ['any available therapist', 'any available welcome-voucher practitioner'].includes(clean(value).toLowerCase()); }
function isWelcomeVoucherPreference(value = '') { return clean(value).toLowerCase() === 'any available welcome-voucher practitioner'; }

async function resolveService(intent) {
  const verification = await verifyService(clean(intent.service_text));
  if (!verification.verified || !verification.canonicalName) return null;
  const result = await pool.query(`SELECT id, name FROM services WHERE status = 'active' AND LOWER(name) = LOWER($1) ORDER BY id LIMIT 2`, [verification.canonicalName]);
  return result.rows.length === 1 ? result.rows[0] : null;
}

async function resolveEligibleStaff(serviceId, therapistText) {
  const therapist = clean(therapistText); const params = [Number(serviceId)]; let therapistClause = '';
  if (therapist && !isAnyPractitionerPreference(therapist)) { params.push(therapist); therapistClause = 'AND LOWER(st.display_name) = LOWER($2)'; }
  const voucherClause = isWelcomeVoucherPreference(therapist) ? "AND st.business_role <> 'tenant_practitioner' AND LOWER(BTRIM(st.display_name)) <> 'marietjie'" : '';
  const result = await pool.query(`
    SELECT st.id, st.display_name FROM staff st JOIN staff_services ss ON ss.staff_id = st.id
     WHERE ss.service_id = $1 AND st.status = 'active' AND st.resource_type = 'practitioner' AND st.client_bookable = TRUE ${therapistClause} ${voucherClause}
     GROUP BY st.id, st.display_name
     ORDER BY CASE LOWER(st.display_name) WHEN 'christel' THEN 1 WHEN 'abigail' THEN 2 WHEN 'marietjie' THEN 3 ELSE 9 END, st.display_name, st.id
  `, params);
  return result.rows;
}

async function authoritativeSlotsForIntent(intent, { daypart = null, now = new Date() } = {}) {
  if (!intent?.service_text || !intent?.preferred_date || intent.service_verified === false) return { status: 'incomplete', slots: [] };
  const service = await resolveService(intent); if (!service) return { status: 'service_unresolved', slots: [] };
  const staff = await resolveEligibleStaff(service.id, intent.therapist_text); if (!staff.length) return { status: 'no_eligible_staff', service, slots: [] };
  const combined = [];
  for (const practitioner of staff) {
    const result = await listAvailableSlots({ staffId: practitioner.id, serviceId: service.id, date: intent.preferred_date, intervalMinutes: 15 });
    if (result.status === 'not_eligible' || result.status === 'inactive_or_missing') continue;
    for (const slot of result.slots || []) {
      const enriched = { ...slot, staff_id: Number(practitioner.id), staff_name: practitioner.display_name, service_id: Number(service.id), service_name: service.name };
      if (!isFutureSlot(enriched, now)) continue; if (daypart && daypartForSlot(enriched) !== daypart) continue; combined.push(enriched);
    }
  }
  combined.sort((a, b) => { const time = new Date(a.starts_at) - new Date(b.starts_at); return time || Number(a.staff_id) - Number(b.staff_id); });
  return { status: combined.length ? 'available' : 'no_slots', service, staff, slots: combined };
}

function slotsInteractive(intent, slots = [], page = 1, options = {}) {
  const totalPages = Math.max(1, Math.ceil(slots.length / SLOT_PAGE_SIZE)); const safePage = Math.min(Math.max(Number(page) || 1, 1), totalPages); const start = (safePage - 1) * SLOT_PAGE_SIZE;
  const rows = slots.slice(start, start + SLOT_PAGE_SIZE).map((slot) => ({ id: slotId(slot), title: `${localTimeParts(slot.starts_at).text} · ${slot.staff_name}`.slice(0, 24), description: fullLabelDescription(slot.service_name) }));
  if (safePage < totalPages) rows.push({ id: `client_slots_page_${safePage + 1}${options.daypart ? `_${options.daypart}` : ''}`, title: 'More times →', description: `Go to page ${safePage + 1} of ${totalPages}` });
  else if (safePage > 1) rows.push({ id: `client_slots_page_1${options.daypart ? `_${options.daypart}` : ''}`, title: '← First page', description: `Go to page 1 of ${totalPages}` });
  const practitioner = clean(intent.therapist_text) || 'Any eligible practitioner'; const daypartLine = options.daypart ? ` · ${options.daypart}` : '';
  return { type: 'list', body: [`*Available times for ${intent.service_text}*`, `${displayDate(intent.preferred_date)}${daypartLine}`, `Practitioner: ${practitioner}`, '', 'Choose an available time below. Your choice will be checked again before your booking is confirmed. 🌿'].join('\n'), buttonText: 'Available times', rows, sectionTitle: 'Available times' };
}

function noSlotsReply(intent, daypart = null) { const qualifier = daypart ? ` in the ${daypart}` : ''; return [`I couldn't find an available time${qualifier} for *${intent.service_text}* on ${displayDate(intent.preferred_date)}.`, '', 'Nothing has been booked. Choose another date, practitioner, or time preference and I’ll check again.'].join('\n'); }
function parseSlotSelection(value = '') { const match = clean(value).toLowerCase().match(/^client_slot_(\d+)_(\d{8})_(\d{4})$/); return match ? { staffId: Number(match[1]), dateKey: match[2], hhmm: match[3] } : null; }
function parseSlotPage(value = '') { const match = clean(value).toLowerCase().match(/^client_slots_page_(\d+)(?:_(morning|afternoon|evening))?$/); return match ? { page: Number(match[1]), daypart: match[2] || null } : null; }

async function closedDateInteractive(intent,date,status){
  const openDates=await getNextOpenClinicDates({count:2});
  const reason=status?.holidayName?` (${status.holidayName})`:'';
  const buttons=openDates.map((choice)=>({id:`client_date_${choice.date}`,title:choice.title.slice(0,20)}));
  buttons.push({id:'client_date_other',title:'Choose another date'});
  return{type:'button',body:[`Shiloh is closed on ${displayDate(date)}${reason}.`,'Nothing has been booked.','',`Please choose another open clinic day for *${intent.service_text}*, or type a different date.`].join('\n'),buttons:buttons.slice(0,3)};
}

async function revalidateSelectedSlot(intent, selection) {
  const service = await resolveService(intent); if (!service) return null; const staff = await resolveEligibleStaff(service.id, intent.therapist_text); const practitioner = staff.find((row) => Number(row.id) === Number(selection.staffId)); if (!practitioner) return null;
  if (clean(intent.therapist_text) && !isAnyPractitionerPreference(intent.therapist_text) && clean(practitioner.display_name).toLowerCase() !== clean(intent.therapist_text).toLowerCase()) return null;
  const result = await listAvailableSlots({ staffId: practitioner.id, serviceId: service.id, date: intent.preferred_date, intervalMinutes: 15 });
  return (result.slots || []).find((slot) => isFutureSlot(slot) && localDateKey(slot.starts_at) === selection.dateKey && `${localTimeParts(slot.starts_at).hh}${localTimeParts(slot.starts_at).mm}` === selection.hhmm) ? practitioner : null;
}

async function acceptSlot(sender, intent, selection) {
  if (String(intent.preferred_date || '').replace(/-/g, '') !== selection.dateKey) return { handled: true, reply: 'That availability choice belongs to a different date. Nothing has been booked. Please choose an available time from the current list.' };
  const practitioner = await revalidateSelectedSlot(intent, selection);
  if (!practitioner) { const fresh = await authoritativeSlotsForIntent(intent); return fresh.slots.length ? { handled: true, reply: 'That slot is no longer available. Nothing has been booked. Please choose from the refreshed list.', interactive: slotsInteractive(intent, fresh.slots, 1) } : { handled: true, reply: noSlotsReply(intent) }; }
  const hh = selection.hhmm.slice(0, 2); const mm = selection.hhmm.slice(2); const result = await processBookingMessage(sender, `booking with ${practitioner.display_name} at ${hh}:${mm}`); return decorateClientBookingResult(result);
}

async function processClientAvailabilityMessage(sender, text) {
  const value = clean(text); const intent = await getIntent(sender); if (!intent || intent.status !== 'collecting' || !intent.service_text || intent.service_verified === false) return { handled: false };
  if(value.toLowerCase()==='client_date_other')return{handled:true,intent,reply:'Please type another date, for example next Friday or 21 August.'};
  const selection = parseSlotSelection(value); if (selection && intent.preferred_date && !intent.preferred_time) return acceptSlot(sender, intent, selection);
  const page = parseSlotPage(value); if (page && intent.preferred_date && !intent.preferred_time) { const availability = await authoritativeSlotsForIntent(intent, { daypart: page.daypart }); if (!availability.slots.length) return { handled: true, reply: noSlotsReply(intent, page.daypart) }; return { handled: true, intent, interactive: slotsInteractive(intent, availability.slots, page.page, { daypart: page.daypart }) }; }
  if (!intent.preferred_date) {
    const date = explicitBookingDate(value)||extractDate(value); if (!date) return { handled: false };
    const clinicDate=await getClinicDateStatus({date});
    if(!clinicDate.covered)return{handled:true,intent,interactive:await closedDateInteractive(intent,date,clinicDate)};
    const staged = await processBookingMessage(sender, explicitBookingDate(value)?date:value); if (!staged?.handled || !staged.intent?.preferred_date || staged.intent.preferred_time) return { handled: false };
    const availability = await authoritativeSlotsForIntent(staged.intent); if (!availability.slots.length) return { handled: true, intent: staged.intent, reply: noSlotsReply(staged.intent) }; return { handled: true, intent: staged.intent, interactive: slotsInteractive(staged.intent, availability.slots, 1) };
  }
  if (!intent.preferred_time) {
    const requestedTime = extractTime(value); if (!requestedTime) return { handled: false };
    if (/^(morning|afternoon|evening)$/.test(requestedTime)) { const availability = await authoritativeSlotsForIntent(intent, { daypart: requestedTime }); if (!availability.slots.length) return { handled: true, intent, reply: noSlotsReply(intent, requestedTime) }; return { handled: true, intent, interactive: slotsInteractive(intent, availability.slots, 1, { daypart: requestedTime }) }; }
    const availability = await authoritativeSlotsForIntent(intent); const normalized = requestedTime.toLowerCase();
    const target = (() => { let match = normalized.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/); if (match) { let hour = Number(match[1]); const minute = Number(match[2]); if (match[3] === 'pm' && hour !== 12) hour += 12; if (match[3] === 'am' && hour === 12) hour = 0; return `${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`; } match = normalized.match(/^(\d{1,2})\s*(am|pm)$/); if (match) { let hour = Number(match[1]); if (match[2] === 'pm' && hour !== 12) hour += 12; if (match[2] === 'am' && hour === 12) hour = 0; return `${String(hour).padStart(2, '0')}00`; } if (/^\d{1,2}$/.test(normalized)) return `${normalized.padStart(2, '0')}00`; return null; })();
    const matching = target ? availability.slots.filter((slot) => `${localTimeParts(slot.starts_at).hh}${localTimeParts(slot.starts_at).mm}` === target) : [];
    if (!matching.length) return availability.slots.length ? { handled: true, intent, reply: 'That exact time is not currently available. Nothing has been booked. Please choose one of the available times below.', interactive: slotsInteractive(intent, availability.slots, 1) } : { handled: true, intent, reply: noSlotsReply(intent) };
    return acceptSlot(sender, intent, parseSlotSelection(slotId(matching[0])));
  }
  return { handled: false };
}

module.exports = { SLOT_PAGE_SIZE, authoritativeSlotsForIntent, daypartForSlot, isAnyPractitionerPreference, isFutureSlot, isWelcomeVoucherPreference, localDateKey, localTimeParts, parseSlotPage, parseSlotSelection, processClientAvailabilityMessage, resolveEligibleStaff, slotId, slotsInteractive };
