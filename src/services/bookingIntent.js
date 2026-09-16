const { pool } = require("../db/pool");
const logger = require("../lib/logger");

const BOOKING_URL =
  process.env.GOLDIE_BOOKING_URL ||
  "https://book.heygoldie.com/Shiloh-Massage-Therapy-Clinic";

const CLINIC_TIME_ZONE = "Africa/Johannesburg";

let initialized = false;

async function ensureTable() {
  if (initialized) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS booking_intents (
      phone VARCHAR(32) PRIMARY KEY,
      service_text TEXT,
      preferred_date TEXT,
      preferred_time TEXT,
      therapist_text TEXT,
      service_verified BOOLEAN,
      status TEXT NOT NULL DEFAULT 'collecting',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE booking_intents ADD COLUMN IF NOT EXISTS therapist_text TEXT`);
  await pool.query(`ALTER TABLE booking_intents ADD COLUMN IF NOT EXISTS service_verified BOOLEAN`);

  initialized = true;
}

function isBookingStart(text = "") {
  return /\b(book|booking|appointment|schedule|reserve)\b/i.test(String(text));
}

function isBookingCancel(text = "") {
  return /\b(cancel|stop|never mind|nevermind)\b/i.test(String(text));
}

function isConfirmation(text = "") {
  return /^(yes|y|confirm|confirmed|correct|looks good|that works|proceed|continue|ok|okay)$/i.test(
    String(text).trim()
  );
}

function isEditRequest(text = "") {
  return /\b(change|edit|update|different|instead|wrong)\b/i.test(String(text));
}

function localDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
  };
}

function dateFromLocalParts({ year, month, day }) {
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function formatIsoDate(date) {
  const parts = localDateParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function addDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function currentClinicDate(now = new Date()) {
  return dateFromLocalParts(localDateParts(now));
}

function resolveWeekday(targetDay, { next = false } = {}, now = new Date()) {
  const weekdays = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const target = weekdays.indexOf(targetDay.toLowerCase());
  if (target < 0) return null;

  const base = currentClinicDate(now);
  const current = base.getUTCDay();
  let delta = (target - current + 7) % 7;
  if (next || delta === 0) delta += 7;
  return formatIsoDate(addDays(base, delta));
}

function validIsoFromParts(day, month, year) {
  const candidate = dateFromLocalParts({ year, month, day });
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() + 1 !== month ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function resolveWrittenDate(day, monthName, yearText, now = new Date()) {
  const months = {
    january: 1,
    jan: 1,
    february: 2,
    feb: 2,
    march: 3,
    mar: 3,
    april: 4,
    apr: 4,
    may: 5,
    june: 6,
    jun: 6,
    july: 7,
    jul: 7,
    august: 8,
    aug: 8,
    september: 9,
    sep: 9,
    sept: 9,
    october: 10,
    oct: 10,
    november: 11,
    nov: 11,
    december: 12,
    dec: 12,
  };

  const month = months[String(monthName).toLowerCase()];
  if (!month) return null;

  const today = localDateParts(now);
  let year = yearText ? Number(yearText) : today.year;
  if (year < 100) year += 2000;

  // A yearless written date is anchored to the current clinic calendar year.
  // Never silently roll an already-passed date into next year; callers that
  // require a future date must reject the past date or ask for an explicit year.
  return validIsoFromParts(Number(day), month, year);
}

function extractDate(text = "", now = new Date()) {
  const value = String(text).trim();
  const base = currentClinicDate(now);

  if (/\btoday\b/i.test(value)) return formatIsoDate(base);
  if (/\btomorrow\b/i.test(value)) return formatIsoDate(addDays(base, 1));

  const weekday = value.match(
    /\b(?:(next)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
  );
  if (weekday) {
    return resolveWeekday(weekday[2], { next: Boolean(weekday[1]) }, now);
  }

  const monthPattern =
    "january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec";

  const dayFirst = value.match(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})(?:\\s+(\\d{2,4}))?\\b`, "i")
  );
  if (dayFirst) {
    const resolved = resolveWrittenDate(dayFirst[1], dayFirst[2], dayFirst[3], now);
    if (resolved) return resolved;
  }

  const monthFirst = value.match(
    new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{2,4}))?\\b`, "i")
  );
  if (monthFirst) {
    const resolved = resolveWrittenDate(monthFirst[2], monthFirst[1], monthFirst[3], now);
    if (resolved) return resolved;
  }

  const numeric = value.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    let year = numeric[3] ? Number(numeric[3]) : localDateParts(now).year;
    if (year < 100) year += 2000;

    return validIsoFromParts(day, month, year);
  }

  return null;
}

function displayDate(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ""))) return isoDate;
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: CLINIC_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function extractTime(text = "") {
  const value = String(text).trim();

  const explicit = value.match(
    /\b(?:at\s+)?((?:[01]?\d|2[0-3]):[0-5]\d\s*(?:am|pm)?|(?:1[0-2]|0?[1-9])\s*(?:am|pm))\b/i
  );
  if (explicit) return explicit[1].trim().toLowerCase();

  const atHour = value.match(/\bat\s+((?:[01]?\d|2[0-3]))\b/i);
  if (atHour) return atHour[1].trim();

  if (/^(?:[01]?\d|2[0-3])$/.test(value)) return value;

  const daypart = value.match(/\b(morning|afternoon|evening)\b/i);
  return daypart ? daypart[1].toLowerCase() : null;
}

function extractTherapist(text = "") {
  const value = String(text).trim();
  if (/\b(any therapist|anyone|whoever is available|no preference)\b/i.test(value)) {
    return "Any available therapist";
  }

  const match = value.match(/\b(?:with|therapist)\s+([A-Za-z][A-Za-z' -]{1,60})\b/i);
  if (!match?.[1]) return null;

  return match[1]
    .trim()
    .replace(/\b(?:on|at|tomorrow|today|next)\b.*$/i, "")
    .trim()
    .replace(/[.!?]+$/, "");
}

function extractService(text = "") {
  const value = String(text).trim();
  const patterns = [
    /\b(?:book|schedule|reserve)\s+(?:me\s+)?(?:an?\s+)?(.+?)(?=\s+(?:for|on|at|with|tomorrow|today|next\s+|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening)\b|$)/i,
    /\b(?:i(?:'d| would)? like|i want)\s+(?:to book\s+)?(?:an?\s+)?(.+?)(?=\s+(?:for|on|at|with|tomorrow|today|next\s+|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening)\b|$)/i,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) {
      const service = match[1].trim().replace(/[.!?]+$/, "");
      // “Appointment” describes the booking action, not a treatment. Leaving
      // it here makes the verifier reject an otherwise valid generic booking
      // request before the client has chosen a service.
      if (/^(?:an?\s+)?appointments?$/i.test(service)) return null;
      return service;
    }
  }

  return null;
}

function normalizeServiceName(service = "") {
  const clean = String(service).trim().replace(/\s+/g, " ");
  const aliases = new Map([
    ["swedish massage", "Swedish Massage"],
    ["swedish", "Swedish Massage"],
    ["hot stone massage", "Hot Stone Massage"],
    ["hot stone", "Hot Stone Massage"],
    ["deep tissue massage", "Deep Tissue Massage"],
    ["deep tissue", "Deep Tissue Massage"],
  ]);

  const alias = aliases.get(clean.toLowerCase());
  if (alias) return alias;

  return clean.replace(/\b\w/g, (char) => char.toUpperCase());
}

function significantServiceTokens(service = "") {
  const ignored = new Set([
    "massage",
    "treatment",
    "therapy",
    "service",
    "session",
    "full",
    "body",
    "minute",
    "minutes",
  ]);

  return String(service)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !ignored.has(token));
}

function comparableServiceName(service = "") {
  return String(service || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchActiveServiceName(requestedService, activeNames = []) {
  const requested = normalizeServiceName(requestedService);
  const requestedComparable = comparableServiceName(requested);
  if (!requestedComparable) return { matched: false, reason: "missing" };

  const names = [...new Set((activeNames || []).map((name) => String(name || "").trim()).filter(Boolean))];
  const exact = names.filter((name) => comparableServiceName(name) === requestedComparable);
  if (exact.length === 1) return { matched: true, name: exact[0], reason: "exact_active_crm_match" };
  if (exact.length > 1) return { matched: false, reason: "ambiguous_active_crm_match" };

  const requestedTokens = significantServiceTokens(requested);
  if (!requestedTokens.length) return { matched: false, reason: "not_active_in_crm" };

  const tokenMatches = names.filter((name) => {
    const candidateTokens = new Set(significantServiceTokens(name));
    return requestedTokens.every((token) => candidateTokens.has(token));
  });

  if (tokenMatches.length === 1) {
    return { matched: true, name: tokenMatches[0], reason: "unique_active_crm_token_match" };
  }
  if (tokenMatches.length > 1) return { matched: false, reason: "ambiguous_active_crm_match" };
  return { matched: false, reason: "not_active_in_crm" };
}

async function verifyService(service) {
  if (!service?.trim()) return { verified: false, reason: "missing" };

  try {
    const result = await pool.query(
      `SELECT name FROM services WHERE status = 'active' ORDER BY name`
    );
    const match = matchActiveServiceName(service, result.rows.map((row) => row.name));
    return {
      verified: match.matched,
      reason: match.reason,
      canonicalName: match.name || null,
    };
  } catch (error) {
    logger.warn({ err: error }, "Could not verify requested booking service against active CRM catalogue");
    return { verified: false, reason: "verification_unavailable", canonicalName: null };
  }
}

async function getIntent(phone) {
  await ensureTable();
  const result = await pool.query(
    `SELECT phone, service_text, preferred_date, preferred_time, therapist_text,
            service_verified, status, created_at, updated_at
     FROM booking_intents WHERE phone = $1`,
    [phone]
  );
  return result.rows[0] || null;
}

async function saveIntent(phone, patch = {}) {
  await ensureTable();
  const current = (await getIntent(phone)) || {};

  const service = patch.serviceText ?? current.service_text ?? null;
  const date = patch.preferredDate ?? current.preferred_date ?? null;
  const time = patch.preferredTime ?? current.preferred_time ?? null;
  const therapist = patch.therapistText ?? current.therapist_text ?? null;
  const serviceVerified = patch.serviceVerified ?? current.service_verified ?? null;
  const status = patch.status ?? current.status ?? "collecting";

  const result = await pool.query(
    `INSERT INTO booking_intents (
       phone, service_text, preferred_date, preferred_time, therapist_text,
       service_verified, status, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (phone) DO UPDATE SET
       service_text = EXCLUDED.service_text,
       preferred_date = EXCLUDED.preferred_date,
       preferred_time = EXCLUDED.preferred_time,
       therapist_text = EXCLUDED.therapist_text,
       service_verified = EXCLUDED.service_verified,
       status = EXCLUDED.status,
       updated_at = NOW()
     RETURNING phone, service_text, preferred_date, preferred_time, therapist_text,
               service_verified, status, created_at, updated_at`,
    [phone, service, date, time, therapist, serviceVerified, status]
  );

  return result.rows[0];
}

async function clearIntent(phone) {
  await ensureTable();
  await pool.query("DELETE FROM booking_intents WHERE phone = $1", [phone]);
}

function nextQuestion(intent) {
  if (!intent.service_text) {
    return "Which Shiloh treatment or service would you like to book?";
  }
  if (intent.service_verified === false) {
    return `I can't verify “${intent.service_text}” in Shiloh's current service information. Please choose one of Shiloh's listed treatments or tell me the treatment name again.`;
  }
  if (!intent.preferred_date) {
    return "What day or date would you prefer? You can say something like ‘tomorrow’ or ‘next Friday’.";
  }
  if (!intent.preferred_time) {
    return "What time would you prefer? You can also say morning, afternoon or evening.";
  }
  return null;
}

function buildConfirmationSummary(intent) {
  return [
    "Please check these booking preferences:",
    `• Service: ${normalizeServiceName(intent.service_text)}`,
    `• Date: ${displayDate(intent.preferred_date)}`,
    `• Time: ${intent.preferred_time}`,
    `• Therapist: ${intent.therapist_text || "Any available therapist"}`,
    "",
    "Reply YES to continue to Goldie, or tell me what you'd like to change.",
  ].join("\n");
}

function buildHandoffReply(intent) {
  return [
    "Perfect — your booking preferences are ready:",
    `• Service: ${normalizeServiceName(intent.service_text)}`,
    `• Date: ${displayDate(intent.preferred_date)}`,
    `• Time: ${intent.preferred_time}`,
    `• Therapist: ${intent.therapist_text || "Any available therapist"}`,
    "",
    "Your appointment is not reserved yet. Goldie remains the live source for availability and final confirmation.",
    "Open Shiloh's secure booking page to choose an available slot and complete your booking:",
    BOOKING_URL,
  ].join("\n");
}

async function processBookingMessage(phone, text) {
  try {
    const existing = await getIntent(phone);
    const active = existing?.status === "collecting";
    const awaitingConfirmation = existing?.status === "awaiting_confirmation";

    if (!active && !awaitingConfirmation && !isBookingStart(text)) {
      return { handled: false };
    }

    if ((active || awaitingConfirmation) && isBookingCancel(text)) {
      await clearIntent(phone);
      return {
        handled: true,
        reply: "No problem — I’ve cleared that booking request. How else can I help with Shiloh?",
      };
    }

    if (awaitingConfirmation) {
      if (isConfirmation(text)) {
        const intent = await saveIntent(phone, { status: "ready_for_handoff" });
        return { handled: true, reply: buildHandoffReply(intent), intent };
      }

      if (!isEditRequest(text)) {
        return {
          handled: true,
          reply: "Please reply YES to continue to Goldie, or tell me what you'd like to change — for example, ‘change the time to 3pm’.",
          intent: existing,
        };
      }

      const patch = { status: "collecting" };
      const date = extractDate(text);
      const time = extractTime(text);
      const therapist = extractTherapist(text);
      const service = extractService(text);

      if (date) patch.preferredDate = date;
      if (time) patch.preferredTime = time;
      if (therapist) patch.therapistText = therapist;
      if (service) {
        patch.serviceText = service;
        patch.serviceVerified = null;
      }

      if (!date && !time && !therapist && !service) {
        return {
          handled: true,
          reply: "Sure — what would you like to change: the service, date, time, or therapist?",
          intent: existing,
        };
      }

      let intent = await saveIntent(phone, patch);
      if (service) {
        const verification = await verifyService(service);
        intent = await saveIntent(phone, { serviceVerified: verification.verified });
      }

      const question = nextQuestion(intent);
      if (question) return { handled: true, reply: question, intent };

      intent = await saveIntent(phone, { status: "awaiting_confirmation" });
      return { handled: true, reply: buildConfirmationSummary(intent), intent };
    }

    const extractedService = extractService(text);
    const patch = {
      serviceText: extractedService,
      preferredDate: extractDate(text),
      preferredTime: extractTime(text),
      therapistText: extractTherapist(text),
      status: "collecting",
    };

    if (active) {
      if (existing.service_verified === false && !patch.serviceText) {
        patch.serviceText = String(text).trim().replace(/[.!?]+$/, "");
        patch.serviceVerified = null;
      } else if (!existing.service_text && !patch.serviceText) {
        patch.serviceText = String(text).trim();
      }

      if (!existing.preferred_date && !patch.preferredDate) patch.preferredDate = extractDate(text) || null;
      if (!existing.preferred_time && !patch.preferredTime) patch.preferredTime = extractTime(text) || null;
    }

    const serviceChanged =
      patch.serviceText && patch.serviceText.trim() !== String(existing?.service_text || "").trim();

    if (patch.serviceText && (serviceChanged || existing?.service_verified !== true)) {
      const verification = await verifyService(patch.serviceText);
      patch.serviceVerified = verification.verified;
    }

    let intent = await saveIntent(phone, patch);
    const question = nextQuestion(intent);

    if (question) {
      return { handled: true, reply: question, intent };
    }

    intent = await saveIntent(phone, { status: "awaiting_confirmation" });
    return { handled: true, reply: buildConfirmationSummary(intent), intent };
  } catch (error) {
    logger.error({ err: error }, "Booking intent processing failed");
    return { handled: false };
  }
}

module.exports = {
  processBookingMessage,
  getIntent,
  clearIntent,
  ensureTable,
  extractDate,
  extractTime,
  extractTherapist,
  extractService,
  verifyService,
  matchActiveServiceName,
  normalizeServiceName,
  displayDate,
};
