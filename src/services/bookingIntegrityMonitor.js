const { pool } = require('../db/pool');
const { checkCalendarAvailabilityOnCalendar, calendarEnabled } = require('./googleBookingCalendar');
const { normalizePhone } = require('./clientIdentityOnboarding');
const logger = require('../lib/logger');
const observability = require('../lib/observability');

const PRACTITIONER_CALENDARS = Object.freeze([
  { name: 'Christel', env: 'GOOGLE_CHRISTEL_CALENDAR_ID' },
  { name: 'Abigail', env: 'GOOGLE_ABIGAIL_CALENDAR_ID' },
  { name: 'Marietjie', env: 'GOOGLE_MARIETJIE_CALENDAR_ID' },
]);
const SCAN_INTERVAL_MS = 15 * 60 * 1000;
const SCAN_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const SCAN_LOOKAHEAD_MS = 90 * 24 * 60 * 60 * 1000;
let running = false;
let timer = null;
let tableReady = false;

function clean(value = '') { return String(value || '').trim().replace(/\s+/g, ' '); }
function normalize(value = '') { return clean(value).toLowerCase(); }
function eventStart(event) { return event?.start?.dateTime || event?.start?.date || null; }
function eventEnd(event) { return event?.end?.dateTime || event?.end?.date || null; }
function isLinked(event) { return Boolean(clean(event?.extendedProperties?.private?.shilohAppointmentId)); }

async function ensureIntegrityTable() {
  if (tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS booking_integrity_exceptions (
      id BIGSERIAL PRIMARY KEY,
      calendar_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      practitioner TEXT NOT NULL,
      summary TEXT,
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      classification TEXT NOT NULL CHECK (classification IN ('booking_like','calendar_block')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','observed','resolved')),
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      UNIQUE (calendar_id, event_id)
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_booking_integrity_open ON booking_integrity_exceptions(status, starts_at) WHERE status='open'`);
  tableReady = true;
}

async function activeServiceNames() {
  const result = await pool.query(`SELECT name FROM services WHERE status='active' ORDER BY id`);
  return result.rows.map(row => normalize(row.name)).filter(Boolean);
}

function classifyEvent(event, serviceNames = []) {
  const text = normalize(`${event?.summary || ''} ${event?.description || ''}`);
  const explicitBookingFields = /\b(client|service|practitioner)\s*:/i.test(String(event?.description || ''));
  const serviceMatch = serviceNames.some(name => name.length >= 5 && text.includes(name));
  const treatmentLanguage = /\b(massage|facial|pedicure|microneedl|needling|plasma|hifu|peel|lymphatic|swedish|cupping|brows?|eyeliner|ozone|pressotherapy|treatment|appointment|booking)\b/i.test(text);
  return explicitBookingFields || serviceMatch || treatmentLanguage ? 'booking_like' : 'calendar_block';
}

async function upsertObserved({ calendarId, practitioner, event, classification }) {
  const status = classification === 'booking_like' ? 'open' : 'observed';
  await pool.query(`
    INSERT INTO booking_integrity_exceptions
      (calendar_id,event_id,practitioner,summary,starts_at,ends_at,classification,status,last_seen_at,resolved_at,metadata)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NULL,$9::jsonb)
    ON CONFLICT (calendar_id,event_id) DO UPDATE SET
      practitioner=EXCLUDED.practitioner,
      summary=EXCLUDED.summary,
      starts_at=EXCLUDED.starts_at,
      ends_at=EXCLUDED.ends_at,
      classification=EXCLUDED.classification,
      status=EXCLUDED.status,
      last_seen_at=NOW(),
      resolved_at=NULL,
      metadata=EXCLUDED.metadata`,
    [calendarId, event.id, practitioner, clean(event.summary) || null, eventStart(event), eventEnd(event), classification, status,
      JSON.stringify({ source: 'google_practitioner_calendar', automaticImport: false, outboundMessagingAuthorized: false })]
  );
}

async function resolveMissing(calendarId, from, to, seenIds) {
  const ids = Array.from(seenIds);
  await pool.query(`
    UPDATE booking_integrity_exceptions
       SET status='resolved', resolved_at=NOW(), last_seen_at=NOW()
     WHERE calendar_id=$1
       AND starts_at >= $2 AND starts_at < $3
       AND status IN ('open','observed')
       AND NOT (event_id = ANY($4::text[]))`, [calendarId, from, to, ids.length ? ids : ['__none__']]);
}

async function scanBookingIntegrity() {
  if (!calendarEnabled()) return { enabled: false, scanned: 0, bookingLike: 0, blocks: 0, issues: [] };
  if (running) return { enabled: true, skipped: 'already_running' };
  running = true;
  try {
    await ensureIntegrityTable();
    const from = new Date(Date.now() - SCAN_LOOKBACK_MS);
    const to = new Date(Date.now() + SCAN_LOOKAHEAD_MS);
    const serviceNames = await activeServiceNames();
    let scanned = 0, bookingLike = 0, blocks = 0;
    for (const practitioner of PRACTITIONER_CALENDARS) {
      const calendarId = clean(process.env[practitioner.env]);
      if (!calendarId) throw new Error(`${practitioner.env} is required for booking-integrity monitoring.`);
      const result = await checkCalendarAvailabilityOnCalendar(calendarId, { startsAt: from, endsAt: to, staffName: null });
      const seen = new Set();
      for (const event of result.conflicts || []) {
        if (!event?.id || event.status === 'cancelled' || event.transparency === 'transparent') continue;
        if (isLinked(event)) {
          await pool.query(`UPDATE booking_integrity_exceptions SET status='resolved',resolved_at=NOW(),last_seen_at=NOW() WHERE calendar_id=$1 AND event_id=$2 AND status<>'resolved'`, [calendarId, event.id]);
          continue;
        }
        scanned += 1;
        seen.add(event.id);
        const classification = classifyEvent(event, serviceNames);
        if (classification === 'booking_like') bookingLike += 1; else blocks += 1;
        await upsertObserved({ calendarId, practitioner: practitioner.name, event, classification });
      }
      await resolveMissing(calendarId, from, to, seen);
    }
    const issues = (await pool.query(`
      SELECT practitioner,summary,starts_at,ends_at,event_id
        FROM booking_integrity_exceptions
       WHERE status='open' AND classification='booking_like'
       ORDER BY starts_at NULLS LAST, practitioner, id
       LIMIT 25`)).rows;
    return { enabled: true, scanned, bookingLike, blocks, issues };
  } finally {
    running = false;
  }
}

function formatDateTime(value) {
  if (!value) return 'time unavailable';
  return new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

function renderIntegrity(result) {
  if (!result.enabled) return '*Calendar integrity*\n\nGoogle Calendar enforcement is currently disabled.';
  const lines = ['*Calendar integrity — Shiloh*', '', `Booking-like unlinked events: *${result.issues.length}*`];
  if (!result.issues.length) {
    lines.push('✅ No unlinked booking-like events currently need review.');
  } else {
    lines.push('', '*Needs review*');
    for (const issue of result.issues.slice(0, 10)) lines.push(`⚠️ ${issue.practitioner} · ${formatDateTime(issue.starts_at)} · ${clean(issue.summary) || 'Untitled event'}`);
    if (result.issues.length > 10) lines.push(`…and ${result.issues.length - 10} more.`);
  }
  lines.push('', 'These events are *not* CRM bookings. Shiloh never auto-imports them and never messages a client from them.');
  return lines.join('\n');
}

async function getChristelAdmin(sender) {
  const result = await pool.query(`SELECT id,display_name,business_role,calendar_scope,permissions FROM staff_admin_accounts WHERE normalized_whatsapp=$1 AND active=TRUE`, [normalizePhone(sender)]);
  const admin = result.rows[0] || null;
  if (!admin) return null;
  const businessWide = ['owner','business_admin'].includes(admin.business_role) || admin.calendar_scope === 'all_business';
  return businessWide && /^christel\b/i.test(clean(admin.display_name)) ? admin : null;
}

async function processAdminCalendarIntegrityMessage(sender, text) {
  const raw = normalize(text);
  if (!['calendar integrity scan','calendar integrity issues','calendar integrity'].includes(raw)) return { handled: false };
  const admin = await getChristelAdmin(sender);
  if (!admin) return { handled: true, reply: 'Calendar integrity review is restricted to Christel’s business-wide admin account.' };
  const result = await scanBookingIntegrity();
  await pool.query(`INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata) VALUES($1,'admin.calendar_integrity_review','calendar_integrity',NULL,$2::jsonb)`, [admin.id, JSON.stringify({ bookingLike: result.issues?.length || 0, automaticImport: false })]);
  return { handled: true, admin, reply: renderIntegrity(result) };
}

function startBookingIntegrityScheduler() {
  if (timer) return timer;
  const run = async () => {
    try {
      const result = await scanBookingIntegrity();
      logger.info({ bookingLike: result.issues?.length || 0, scanned: result.scanned || 0 }, 'Booking integrity scan completed');
    } catch (error) {
      logger.error({ err: error }, 'Booking integrity scan failed');
      observability.captureException(error, { 'error.kind': 'booking_integrity_scan', 'error.code': error?.code });
    }
  };
  setTimeout(run, 20000).unref();
  timer = setInterval(run, SCAN_INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = { scanBookingIntegrity, processAdminCalendarIntegrityMessage, startBookingIntegrityScheduler, classifyEvent, renderIntegrity, ensureIntegrityTable };
