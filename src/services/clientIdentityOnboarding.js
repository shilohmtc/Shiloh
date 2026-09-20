const { pool } = require("../db/pool");
const { registrationStatus, assertRegistrationComplete } = require("./clientRegistrationPolicy");
const {
  resolveVerifiedClientByWhatsApp,
  isVerifiedRegistration,
  controlledAuthorityForPhone,
} = require("./clientVerifiedIdentity");
const {
  EVIDENCE_TYPES,
  resolveClientFacingName,
  promoteClientFacingNameInTransaction,
} = require("./clientFacingNameAuthority");
const {
  IDENTITY_MODELS,
  createLegacyIdentity,
  createCrmV2Identity,
  identityFromSession,
  sessionIdentityColumns,
  identityAuditMetadata,
  createWhatsAppCrmV2IdentityCompatService,
} = require("./whatsappCrmV2IdentityCompat");
const { registerWhatsAppClient } = require("./crmV2ClientService");

const AUTHORITY_VERSION = "verified_client_v3_crm_v2_fresh_registration";
const whatsappCrmV2IdentityCompat = createWhatsAppCrmV2IdentityCompatService();

function normalizePhone(value = "") { return String(value).replace(/[^0-9]/g, ""); }
function normalizeRegistrationMobile(value = "") {
  const digits = normalizePhone(value);
  if (/^0\d{9}$/.test(digits)) return `27${digits.slice(1)}`;
  if (/^27\d{9}$/.test(digits)) return digits;
  if (/^0027\d{9}$/.test(digits)) return digits.slice(2);
  return null;
}
function looksLikeRegistrationMobileInput(value = "") {
  return /^(?:\+?27|0027|0)[\d\s-]+$/.test(String(value).trim());
}
function isGreetingOnly(text = "") { return /^(hi|hello|hey|good morning|good afternoon|good evening|howzit|hiya)[!. ]*$/i.test(String(text).trim()); }
function isBookingRequest(text = "") { return /\b(book|booking|appointment|schedule|reserve)\b/i.test(String(text)); }
function isWalkinRegistrationRequest(text = "") { return /\b(register|registration|walk[- ]?in|visiting the clinic)\b/i.test(String(text)); }
function cleanName(text = "") {
  const value = String(text).trim()
    .replace(/^my name is\s+/i, "")
    .replace(/^i am\s+/i, "")
    .replace(/^i'm\s+/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
  if (!/^[A-Za-z][A-Za-z' -]{0,79}$/.test(value)) return null;
  return value.replace(/\s+/g, " ");
}
function parseDateOfBirth(text = "") {
  const value = String(text).trim();
  let year, month, day;
  let m = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) { year = +m[1]; month = +m[2]; day = +m[3]; }
  else {
    m = value.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (m) { day = +m[1]; month = +m[2]; year = +m[3]; }
    else {
      m = value.match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/);
      if (!m) return null;
      const months = { jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12 };
      day = +m[1]; month = months[m[2].toLowerCase()]; year = +m[3];
      if (!month) return null;
    }
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  const today = new Date();
  const oldest = new Date(Date.UTC(today.getUTCFullYear() - 120, today.getUTCMonth(), today.getUTCDate()));
  if (date > today || date < oldest) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function normalizeGender(value = "") {
  const raw = String(value).trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (["female", "woman"].includes(raw)) return "female";
  if (["male", "man"].includes(raw)) return "male";
  if (["non binary", "nonbinary"].includes(raw)) return "non-binary";
  if (raw === "other") return "other";
  if (["prefer not to say", "prefer not to answer"].includes(raw)) return "prefer_not_to_say";
  return null;
}
function extractWhatsAppRegistration(text = "") {
  const source = String(text || "").trim();
  if (!source) return {};
  const result = {};
  const dobMatch = source.match(/\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[\/-]\d{1,2}[\/-]\d{4}\b|\b\d{1,2}\s+[A-Za-z]+,?\s+\d{4}\b/);
  if (dobMatch) {
    const dob = parseDateOfBirth(dobMatch[0]);
    if (dob) result.dateOfBirth = dob;
  }
  const genderMatch = source.match(/\b(prefer not to (?:say|answer)|non[- ]?binary|female|woman|male|man|other)\b/i);
  if (genderMatch) {
    const gender = normalizeGender(genderMatch[0]);
    if (gender) result.gender = gender;
  }
  let nameText = source;
  if (dobMatch) nameText = nameText.replace(dobMatch[0], " ");
  if (genderMatch) nameText = nameText.replace(genderMatch[0], " ");
  nameText = nameText
    .replace(/\b(?:my\s+name\s+is|full\s+name|first\s+name|surname|name|dob|date\s+of\s+birth|gender)\b\s*[:=-]?/gi, " ")
    .replace(/[\n\r,;|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const fullName = nameText ? cleanName(nameText) : null;
  if (fullName) result.fullName = fullName;
  return result;
}
function extractBundledRegistration(text = "") {
  const parsed = extractWhatsAppRegistration(text);
  if (!parsed.fullName || !parsed.dateOfBirth) return null;
  return { fullName: parsed.fullName, mobileNumber: null, dateOfBirth: parsed.dateOfBirth, gender: parsed.gender || null };
}
function hasSurname(name = "") { return String(name).trim().split(/\s+/).filter(Boolean).length >= 2; }
function mergeName(existing, incoming) {
  const current = cleanName(existing || "");
  const next = cleanName(incoming || "");
  if (!next) return current;
  if (!current) return next;
  if (hasSurname(next)) return next;
  if (!hasSurname(current) && current.toLowerCase() !== next.toLowerCase()) return `${current} ${next}`;
  return current;
}
function firstName(name = "") { return String(name).trim().split(/\s+/)[0] || "there"; }

const PREMIUM_GREETING = [
  "Hi 👋 Welcome to *Shiloh Massage Therapy & Aesthetic Clinic*. 🌿",
  "",
  "I’m *Shiloh*, your smart booking assistant.",
  "",
  "I can help you find the right treatment, check availability, make or manage a booking, and keep everything quick and easy.",
].join("\n");

const REGISTRATION_START_PROMPT = [
  "It looks like you’re not registered with us yet. 🌿",
  "Let’s get you registered first — it will only take a moment.",
  "",
  "Please send me your *first name, surname, date of birth and gender*.",
  "You can send everything in one message, for example:",
  "*Sarah Smith, 14 May 1990, Female*",
].join("\n");

const HUMAN_VERIFICATION_REPLY = "I found an existing Shiloh profile linked to this number, but I can’t safely treat the phone, imported details or appointment history as identity proof. Please contact the clinic team so we can verify the correct profile before continuing.";
const IDENTITY_CONFLICT_REPLY = "I found an identity conflict with this WhatsApp number, so I won’t merge, select or update a client profile automatically. Please contact the clinic team so we can verify the correct profile safely.";
const CRM_V2_STALE_AUTHORITY_REPLY = "Your saved WhatsApp client identity no longer matches the exact current CRM V2 mobile owner. I won’t guess, rebind or create another client profile. Please contact the clinic team so we can verify it safely.";

let onboardingSchemaPromise = null;
async function ensureOnboardingSchema() {
  if (!onboardingSchemaPromise) {
    onboardingSchemaPromise = (async () => {
      await pool.query(`ALTER TABLE client_onboarding_sessions ADD COLUMN IF NOT EXISTS pending_gender TEXT`);
      await pool.query(`ALTER TABLE client_onboarding_sessions ADD COLUMN IF NOT EXISTS authority_version TEXT`);
      await pool.query(`ALTER TABLE client_onboarding_sessions DROP CONSTRAINT IF EXISTS client_onboarding_state_check`);
      await pool.query(`ALTER TABLE client_onboarding_sessions ADD CONSTRAINT client_onboarding_state_check CHECK (state IN ('collect_name','confirm_whatsapp','collect_contact','collect_dob','collect_gender','complete'))`);
    })().catch((error) => { onboardingSchemaPromise = null; throw error; });
  }
  return onboardingSchemaPromise;
}

// Compatibility entry point used by existing Booking/Admin consumers. "unique"
// is now emitted ONLY for an explicitly verified client. All authority comes
// from resolveVerifiedClientByWhatsApp; profile completeness remains an
// orthogonal registration requirement, not identity proof.
async function resolveClientByWhatsApp(phone) {
  const authority = await resolveVerifiedClientByWhatsApp(phone);
  const clientIdentity = authority.status === "verified_client" && authority.client?.id
    ? createLegacyIdentity(authority.client.id, { provenance: "legacy_whatsapp_resolver" })
    : null;
  if (authority.status === "verified_client") {
    return { ...authority, status: "unique", authorityStatus: "verified_client", clientIdentity };
  }
  return { ...authority, authorityStatus: authority.status, clientIdentity };
}
function profileComplete(client) {
  return registrationStatus({ fullName: client?.display_name, mobileNumber: client?.normalized_value, dateOfBirth: client?.date_of_birth }).complete;
}

function persistedDateOfBirthError() {
  const error = new Error("Persisted onboarding date of birth is not a canonical date-only value");
  error.code = "ONBOARDING_PERSISTED_DATE_OF_BIRTH_INVALID";
  return error;
}

function normalizePersistedDateOfBirth(value) {
  if (value === null) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value) return value;
  }
  throw persistedDateOfBirthError();
}

function normalizeOnboardingSessionRow(row) {
  if (!row) return null;
  return {
    ...row,
    pending_date_of_birth: normalizePersistedDateOfBirth(row.pending_date_of_birth),
  };
}

const ONBOARDING_SESSION_PROJECTION = `phone,client_id,crm_v2_client_id,identity_model,state,pending_name,pending_contact,TO_CHAR(pending_date_of_birth, 'YYYY-MM-DD') AS pending_date_of_birth,pending_gender,booking_requested,authority_version,created_at,updated_at`;

async function getSession(phone) {
  await ensureOnboardingSchema();
  const r = await pool.query(`SELECT ${ONBOARDING_SESSION_PROJECTION} FROM client_onboarding_sessions WHERE phone=$1`, [normalizePhone(phone)]);
  return normalizeOnboardingSessionRow(r.rows[0]);
}
function patchValue(patch, key, current, fallback = null) {
  return Object.prototype.hasOwnProperty.call(patch, key) ? patch[key] : (current ?? fallback);
}
async function saveSession(phone, patch = {}) {
  await ensureOnboardingSchema();
  const key = normalizePhone(phone);
  const c = (await getSession(key)) || {};
  const hasClientPatch = Object.prototype.hasOwnProperty.call(patch, "clientId");
  const hasCrmV2Patch = Object.prototype.hasOwnProperty.call(patch, "crmV2ClientId");
  let candidateClientId = patchValue(patch, "clientId", c.client_id);
  let candidateCrmV2ClientId = patchValue(patch, "crmV2ClientId", c.crm_v2_client_id);
  if (hasClientPatch && candidateClientId !== null && candidateClientId !== undefined && String(candidateClientId) !== "") {
    if (hasCrmV2Patch && candidateCrmV2ClientId !== null && candidateCrmV2ClientId !== undefined && String(candidateCrmV2ClientId) !== "") {
      identityFromSession({ client_id: candidateClientId, crm_v2_client_id: candidateCrmV2ClientId });
    }
    candidateCrmV2ClientId = null;
  } else if (hasCrmV2Patch && candidateCrmV2ClientId !== null && candidateCrmV2ClientId !== undefined && String(candidateCrmV2ClientId) !== "") {
    candidateClientId = null;
  }
  const identityFieldsChanged = hasClientPatch || hasCrmV2Patch;
  const candidateModel = Object.prototype.hasOwnProperty.call(patch, "identityModel")
    ? patch.identityModel
    : identityFieldsChanged
      ? (candidateClientId ? IDENTITY_MODELS.LEGACY : candidateCrmV2ClientId ? IDENTITY_MODELS.CRM_V2 : null)
      : c.identity_model;
  const durableIdentity = identityFromSession({
    client_id: candidateClientId,
    crm_v2_client_id: candidateCrmV2ClientId,
    identity_model: candidateModel,
  });
  const identityColumns = sessionIdentityColumns(durableIdentity);
  const values = {
    ...identityColumns,
    state: patchValue(patch, "state", c.state, "collect_name"),
    pendingName: patchValue(patch, "pendingName", c.pending_name),
    pendingContact: patchValue(patch, "pendingContact", c.pending_contact, key),
    pendingDateOfBirth: patchValue(patch, "pendingDateOfBirth", c.pending_date_of_birth),
    pendingGender: patchValue(patch, "pendingGender", c.pending_gender),
    bookingRequested: patchValue(patch, "bookingRequested", c.booking_requested, false),
    authorityVersion: patchValue(patch, "authorityVersion", c.authority_version, AUTHORITY_VERSION),
  };
  const r = await pool.query(`INSERT INTO client_onboarding_sessions (phone,client_id,crm_v2_client_id,identity_model,state,pending_name,pending_contact,pending_date_of_birth,pending_gender,booking_requested,authority_version,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW()) ON CONFLICT (phone) DO UPDATE SET client_id=EXCLUDED.client_id,crm_v2_client_id=EXCLUDED.crm_v2_client_id,identity_model=EXCLUDED.identity_model,state=EXCLUDED.state,pending_name=EXCLUDED.pending_name,pending_contact=EXCLUDED.pending_contact,pending_date_of_birth=EXCLUDED.pending_date_of_birth,pending_gender=EXCLUDED.pending_gender,booking_requested=EXCLUDED.booking_requested,authority_version=EXCLUDED.authority_version,updated_at=NOW() RETURNING ${ONBOARDING_SESSION_PROJECTION}`, [key,values.clientId,values.crmV2ClientId,values.identityModel,values.state,values.pendingName,values.pendingContact,values.pendingDateOfBirth,values.pendingGender,values.bookingRequested,values.authorityVersion]);
  return normalizeOnboardingSessionRow(r.rows[0]);
}
function nextState(session = {}) {
  if (!session.pending_name || !hasSurname(session.pending_name)) return "collect_name";
  if (!session.pending_date_of_birth) return "collect_dob";
  if (!session.pending_gender) return "collect_gender";
  return "complete";
}
function promptForMissing(session = {}) {
  const name = session.pending_name || "";
  const missing = [];
  if (!name) missing.push("your first name and surname");
  else if (!hasSurname(name)) missing.push("your surname");
  if (!session.pending_date_of_birth) missing.push("your date of birth");
  if (!session.pending_gender) missing.push("your gender");
  if (!missing.length) return null;
  const prefix = name ? `Thanks, ${firstName(name)}. ` : "";
  return `${prefix}Please send ${missing.join(missing.length > 1 ? ", " : "")}. You can send the remaining details together in one message.`;
}

function ambiguousContactError(message) {
  const e = new Error(message);
  e.code = "AMBIGUOUS_CONTACT";
  return e;
}

async function completeLegacyOnboarding(phone, session) {
  const key = normalizePhone(phone);
  const durableIdentity = identityFromSession(session);
  if (durableIdentity?.identityModel !== IDENTITY_MODELS.LEGACY) {
    const error = new Error("Legacy WhatsApp completion requires a retained legacy identity");
    error.code = "LEGACY_ONBOARDING_IDENTITY_REQUIRED";
    throw error;
  }
  if (!session.pending_gender) {
    const e = new Error("Client registration is incomplete: missing gender");
    e.code = "CLIENT_REGISTRATION_INCOMPLETE";
    throw e;
  }
  assertRegistrationComplete({ fullName: session.pending_name, mobileNumber: key, dateOfBirth: session.pending_date_of_birth });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const clientId = durableIdentity.legacyClientId;
    let clientSource = "whatsapp_onboarding";
    let reactivatedFromStatus = null;

    // Lock exact-phone ownership before writing any canonical identity data. This
    // keeps the retained verified legacy path fail closed if another client owns
    // the phone before the registration completion commits.
    const contacts = await db.query(`SELECT id,client_id,contact_type FROM client_contacts WHERE normalized_value=$1 AND contact_type IN ('whatsapp','mobile') ORDER BY CASE WHEN contact_type='whatsapp' THEN 0 ELSE 1 END,id FOR UPDATE`, [key]);

    const lockedClient = await db.query(`SELECT id,source,status FROM clients WHERE id=$1 FOR UPDATE`, [clientId]);
    if (lockedClient.rowCount !== 1) {
      throw ambiguousContactError("Existing onboarding client is not a canonical client");
    }
    const canonicalClient = lockedClient.rows[0];
    clientSource = canonicalClient.source;

    if (contacts.rows.some((row) => String(row.client_id) !== String(clientId))) {
      throw ambiguousContactError("WhatsApp number belongs to another canonical client");
    }

    const controlled = await controlledAuthorityForPhone(key, db);
    if (controlled && !(controlled.status === "bound" && String(controlled.client?.id || "") === String(clientId))) {
      throw ambiguousContactError("Controlled demo identity is not safely bound to this canonical client");
    }

    if (canonicalClient.status === "archived") {
      if (clientSource !== "goldie_import") {
        throw ambiguousContactError("Archived canonical client is not eligible for imported-contact reclaim");
      }
      const activeVerification = await db.query(`SELECT id FROM client_identity_verifications WHERE client_id=$1 AND status='active' ORDER BY verified_at DESC,id DESC LIMIT 1`, [clientId]);
      if (activeVerification.rowCount) {
        throw ambiguousContactError("Archived canonical client already has active durable verification authority");
      }
      reactivatedFromStatus = canonicalClient.status;
      await db.query(`UPDATE clients SET status='active',date_of_birth=$2::date,custom_attributes=COALESCE(custom_attributes,'{}'::jsonb) || jsonb_build_object('gender',$3::text),updated_at=NOW() WHERE id=$1`, [clientId, session.pending_date_of_birth, session.pending_gender]);
    } else if (canonicalClient.status === "active") {
      await db.query(`UPDATE clients SET date_of_birth=$2::date,custom_attributes=COALESCE(custom_attributes,'{}'::jsonb) || jsonb_build_object('gender',$3::text),updated_at=NOW() WHERE id=$1`, [clientId, session.pending_date_of_birth, session.pending_gender]);
    } else {
      throw ambiguousContactError("Existing onboarding client status is not eligible for automatic identity completion");
    }

    let contactId;
    const existing = contacts.rows.find((row) => String(row.client_id) === String(clientId));
    if (existing) {
      const updated = await db.query(`UPDATE client_contacts SET contact_type='whatsapp',verified_at=COALESCE(verified_at,NOW()),updated_at=NOW() WHERE id=$1 RETURNING id`, [existing.id]);
      contactId = updated.rows[0].id;
    } else {
      const inserted = await db.query(`INSERT INTO client_contacts (client_id,contact_type,value,normalized_value,is_primary,verified_at) VALUES ($1,'whatsapp',$2,$3,TRUE,NOW()) RETURNING id`, [clientId, phone, key]);
      contactId = inserted.rows[0].id;
    }

    const verificationMethod = clientSource === "goldie_import" ? "imported_claim_registration" : "whatsapp_registration";
    const verification = await db.query(`INSERT INTO client_identity_verifications (client_id,client_contact_id,verification_method,status,verified_at,evidence_reference) VALUES ($1,$2,$3,'active',NOW(),$4::jsonb) ON CONFLICT DO NOTHING RETURNING id`, [clientId, contactId, verificationMethod, JSON.stringify({ authorityVersion: AUTHORITY_VERSION, channel: "whatsapp", reactivatedFromStatus })]);
    const verificationId = verification.rows[0]?.id || null;
    const nameAuthority = await promoteClientFacingNameInTransaction(db, {
      clientId,
      name: session.pending_name,
      evidenceType: EVIDENCE_TYPES.VERIFIED_REGISTRATION_INTAKE,
      evidenceReference: {
        verificationId,
        verificationMethod,
        authorityVersion: AUTHORITY_VERSION,
        channel: "whatsapp",
        reactivatedFromStatus,
      },
      actorType: "client",
      actorReference: "whatsapp_registration",
    });

    const completedIdentity = createLegacyIdentity(clientId, { provenance: "legacy_whatsapp_registration" });
    await db.query(`INSERT INTO crm_audit_events (action,entity_type,entity_id,metadata) VALUES ('client.identity_verified','client',$1,$2::jsonb)`, [clientId, JSON.stringify({ verificationMethod, verificationId, nameAuthorityId: nameAuthority.authorityId, authorityVersion: AUTHORITY_VERSION, reactivatedFromStatus, identity: identityAuditMetadata(completedIdentity, { resolution: "legacy_whatsapp_registration" }) })]);
    await db.query(`UPDATE client_onboarding_sessions SET client_id=$2,state='complete',authority_version=$3,crm_v2_client_id=NULL,identity_model='legacy',updated_at=NOW() WHERE phone=$1`, [key, clientId, AUTHORITY_VERSION]);
    await db.query("COMMIT");
    const client = await pool.query(`SELECT c.id,c.display_name,c.date_of_birth,c.custom_attributes->>'gender' AS gender,cc.normalized_value,cc.verified_at FROM clients c JOIN client_contacts cc ON cc.client_id=c.id AND cc.normalized_value=$2 WHERE c.id=$1 ORDER BY CASE WHEN cc.contact_type='whatsapp' THEN 0 ELSE 1 END LIMIT 1`, [clientId, key]);
    return client.rows[0];
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { db.release(); }
}

function crmV2AuthorityError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function completeCrmV2Onboarding(phone, session, {
  registrationBoundary = registerWhatsAppClient,
  persistSession = saveSession,
  revalidateSessionIdentity = whatsappCrmV2IdentityCompat.revalidateSessionIdentity,
  occurredAt = new Date(),
} = {}) {
  const durableIdentity = identityFromSession(session);
  if (durableIdentity?.identityModel === IDENTITY_MODELS.LEGACY) {
    throw crmV2AuthorityError("CRM_V2_ONBOARDING_LEGACY_IDENTITY", "A retained legacy identity cannot be converted during CRM V2 registration");
  }
  if (!session.pending_gender) {
    const error = new Error("Client registration is incomplete: missing gender");
    error.code = "CLIENT_REGISTRATION_INCOMPLETE";
    throw error;
  }
  assertRegistrationComplete({
    fullName: session.pending_name,
    mobileNumber: normalizePhone(phone),
    dateOfBirth: session.pending_date_of_birth,
  });

  if (durableIdentity) {
    const before = await revalidateSessionIdentity({ phone, session });
    if (before.status !== "crm_v2_current") {
      throw crmV2AuthorityError("CRM_V2_AUTHORITY_STALE", "Durable CRM V2 authority is no longer current before registration");
    }
  }

  const registration = await registrationBoundary({
    senderMobile: phone,
    name: session.pending_name,
    dateOfBirth: session.pending_date_of_birth,
    gender: session.pending_gender,
    occurredAt,
  });
  if (registration.status === "conflict") {
    throw crmV2AuthorityError("CRM_V2_IDENTITY_CONFLICT", "Exact CRM V2 mobile authority is ambiguous");
  }
  if (!registration.client?.id) {
    throw crmV2AuthorityError("CRM_V2_AUTHORITY_STALE", "CRM V2 registration did not return a canonical client");
  }

  const canonicalIdentity = createCrmV2Identity(registration.client.id, { provenance: "crm_v2_whatsapp_registration" });
  if (durableIdentity && durableIdentity.crmV2ClientId !== canonicalIdentity.crmV2ClientId) {
    throw crmV2AuthorityError("CRM_V2_AUTHORITY_STALE", "CRM V2 registration resolved a different canonical client");
  }
  const persisted = await persistSession(phone, {
    clientId: null,
    crmV2ClientId: canonicalIdentity.crmV2ClientId,
    identityModel: IDENTITY_MODELS.CRM_V2,
    state: "complete",
    authorityVersion: AUTHORITY_VERSION,
  });
  const persistedIdentity = identityFromSession(persisted);
  if (persistedIdentity?.identityModel !== IDENTITY_MODELS.CRM_V2 || persistedIdentity.crmV2ClientId !== canonicalIdentity.crmV2ClientId) {
    throw crmV2AuthorityError("CRM_V2_AUTHORITY_STALE", "Durable onboarding identity did not preserve the canonical CRM V2 client");
  }
  const after = await revalidateSessionIdentity({ phone, session: persisted });
  if (after.status !== "crm_v2_current" || after.identity.crmV2ClientId !== canonicalIdentity.crmV2ClientId) {
    throw crmV2AuthorityError("CRM_V2_AUTHORITY_STALE", "Durable CRM V2 authority changed before booking continuation");
  }
  return {
    status: registration.status,
    client: after.client || registration.client,
    clientIdentity: persistedIdentity,
    identityAudit: after.audit,
    session: persisted,
  };
}

async function processActiveSession(phone, text, session) {
  const parsed = extractWhatsAppRegistration(text);
  const pendingName = mergeName(session.pending_name, parsed.fullName);
  const pendingDateOfBirth = parsed.dateOfBirth || session.pending_date_of_birth || null;
  const pendingGender = parsed.gender || session.pending_gender || null;
  const candidate = { ...session, pending_name: pendingName, pending_date_of_birth: pendingDateOfBirth, pending_gender: pendingGender };
  const state = nextState(candidate);
  session = await saveSession(phone, { pendingName, pendingDateOfBirth, pendingGender, state, authorityVersion: AUTHORITY_VERSION });
  if (state !== "complete") return { handled: true, reply: promptForMissing(session) };
  try {
    const durableIdentity = identityFromSession(session);
    if (durableIdentity?.identityModel === IDENTITY_MODELS.LEGACY) {
      const client = await completeLegacyOnboarding(phone, session);
      return { handled: true, onboardingComplete: true, resumeBooking: session.booking_requested === true, identityStatus: "verified_complete", clientIdentity: createLegacyIdentity(client.id, { provenance: "legacy_whatsapp_registration" }), client, reply: `Thank you, ${client.display_name}. 🌿 Your Shiloh client registration is complete.` };
    }
    const completed = await completeCrmV2Onboarding(phone, session);
    return { handled: true, onboardingComplete: true, resumeBooking: completed.session.booking_requested === true, identityStatus: "verified_complete", clientIdentity: completed.clientIdentity, identityAudit: completed.identityAudit, client: completed.client, reply: `Thank you, ${completed.client.name}. 🌿 Your Shiloh client registration is complete.\n\n🎁 Your once-off R100 My Shiloh welcome voucher is ready to unlock:\nhttps://app.shilohmtc.co.za/my-shiloh/#welcome-voucher` };
  } catch (error) {
    if (error.code === "AMBIGUOUS_CONTACT" || error.code === "23505" || error.code === "CRM_V2_IDENTITY_CONFLICT") return { handled: true, identityStatus: "ambiguous", resumeBooking: false, reply: IDENTITY_CONFLICT_REPLY };
    if (error.code === "CRM_V2_AUTHORITY_STALE") return { handled: true, identityStatus: "crm_v2_stale", resumeBooking: false, reply: CRM_V2_STALE_AUTHORITY_REPLY };
    throw error;
  }
}

function manualReviewIdentity(identity) {
  return ["ambiguous", "manual_review"].includes(identity?.status);
}

function verifiedLegacyClient(identity) {
  return identity?.status === "verified_client" && identity.client?.id ? identity.client : null;
}

function crmV2RegistrationRequiresContinuation(session, client) {
  return session?.state !== "complete" || client?.profileStatus !== "registered";
}

async function resetSessionForCurrentAuthority(phone, identity, existingSession) {
  if (manualReviewIdentity(identity)) return null;
  const verifiedClient = verifiedLegacyClient(identity);
  if (verifiedClient) {
    if (existingSession.client_id && String(verifiedClient.id) !== String(existingSession.client_id)) return null;
    return saveSession(phone, {
      clientId: verifiedClient.id,
      crmV2ClientId: null,
      identityModel: IDENTITY_MODELS.LEGACY,
      authorityVersion: AUTHORITY_VERSION,
    });
  }
  return saveSession(phone, {
    clientId: null,
    crmV2ClientId: null,
    identityModel: null,
    state: "collect_name",
    pendingName: null,
    pendingContact: normalizePhone(phone),
    pendingDateOfBirth: null,
    pendingGender: null,
    bookingRequested: existingSession.booking_requested ?? true,
    authorityVersion: AUTHORITY_VERSION,
  });
}

async function processClientIdentityMessage(phone, text) {
  let existingSession = await getSession(phone);
  if (existingSession) {
    let durableIdentity;
    try {
      durableIdentity = identityFromSession(existingSession);
    } catch (_error) {
      return { handled: true, identityStatus: "identity_contract_invalid", resumeBooking: false, reply: HUMAN_VERIFICATION_REPLY };
    }
    if (durableIdentity?.identityModel === IDENTITY_MODELS.CRM_V2) {
      const revalidated = await whatsappCrmV2IdentityCompat.revalidateSessionIdentity({ phone, session: existingSession });
      if (revalidated.status === "crm_v2_current") {
        if (crmV2RegistrationRequiresContinuation(existingSession, revalidated.client)) {
          return processActiveSession(phone, text, existingSession);
        }
        if (isWalkinRegistrationRequest(text)) {
          if (revalidated.client.profileStatus !== "registered") {
            const collectionSession = await saveSession(phone, {
              clientId: null,
              crmV2ClientId: durableIdentity.crmV2ClientId,
              identityModel: IDENTITY_MODELS.CRM_V2,
              state: "collect_name",
              pendingName: null,
              pendingContact: normalizePhone(phone),
              pendingDateOfBirth: null,
              pendingGender: null,
              bookingRequested: false,
              authorityVersion: AUTHORITY_VERSION,
            });
            return processActiveSession(phone, text, collectionSession);
          }
          return { handled: true, identityStatus: "matched_complete", onboardingComplete: true, resumeBooking: false, clientIdentity: durableIdentity, client: revalidated.client, identityAudit: revalidated.audit, reply: `${PREMIUM_GREETING}\n\nWelcome back, *${firstName(revalidated.client.name)}* 🌿` };
        }
        if (isGreetingOnly(text)) {
          return { handled: true, identityStatus: "matched_complete", onboardingComplete: true, resumeBooking: false, clientIdentity: durableIdentity, client: revalidated.client, identityAudit: revalidated.audit, reply: `${PREMIUM_GREETING}\n\nWelcome back, *${firstName(revalidated.client.name)}* 🌿` };
        }
        return { handled: false, identityStatus: "matched_complete", resumeBooking: false, clientIdentity: durableIdentity, client: revalidated.client, identityAudit: revalidated.audit };
      }
      return { handled: true, identityStatus: revalidated.status, resumeBooking: false, clientIdentity: durableIdentity, client: null, identityAudit: revalidated.audit, recovery: revalidated.recovery || "manual_rebind_required", reply: CRM_V2_STALE_AUTHORITY_REPLY };
    }
  }
  if (existingSession && existingSession.state !== "complete") {
    if (existingSession.authority_version !== AUTHORITY_VERSION) {
      const authority = await resolveVerifiedClientByWhatsApp(phone);
      if (manualReviewIdentity(authority)) {
        return { handled: true, identityStatus: authority.status, client: authority.client || null, reply: authority.status === "ambiguous" ? IDENTITY_CONFLICT_REPLY : HUMAN_VERIFICATION_REPLY };
      }
      existingSession = await resetSessionForCurrentAuthority(phone, authority, existingSession);
      if (!existingSession) return { handled: true, identityStatus: "manual_review", reply: HUMAN_VERIFICATION_REPLY };
    }
    return processActiveSession(phone, text, existingSession);
  }

  const identity = await resolveVerifiedClientByWhatsApp(phone);
  const bookingRequest = isBookingRequest(text);
  const walkinRequest = isWalkinRegistrationRequest(text);

  if (isVerifiedRegistration(identity)) {
    const clientIdentity = createLegacyIdentity(identity.client.id, { provenance: "legacy_verified_whatsapp" });
    if (isGreetingOnly(text) || walkinRequest) {
      const facingName = await resolveClientFacingName(identity.client.id);
      const welcomeBack = facingName.name ? `Welcome back, *${firstName(facingName.name)}* 🌿` : "Welcome back 🌿";
      return { handled: true, identityStatus: "matched_complete", onboardingComplete: true, resumeBooking: true, clientIdentity, client: identity.client, reply: `${PREMIUM_GREETING}\n\n${welcomeBack}` };
    }
    return { handled: false, identityStatus: "matched_complete", clientIdentity, client: identity.client };
  }

  // A retained verified legacy identity remains legacy even when its profile is
  // incomplete. Every unverified historical/imported/provisional match is only
  // discovery evidence: canonical CRM V2 exact-mobile ownership takes precedence,
  // otherwise the sender starts a fresh CRM V2 registration with no legacy bind.
  if (identity.status !== "verified_client") {
    const crmV2Authority = await whatsappCrmV2IdentityCompat.resolveCrmV2ByExactMobile(phone);
    if (crmV2Authority.status === "conflict") {
      return { handled: true, identityStatus: "crm_v2_conflict", resumeBooking: false, identityAudit: crmV2Authority.audit, reply: IDENTITY_CONFLICT_REPLY };
    }
    if (crmV2Authority.status === "resolved") {
      const registered = crmV2Authority.client.profileStatus === "registered";
      const session = await saveSession(phone, {
        clientId: null,
        crmV2ClientId: crmV2Authority.identity.crmV2ClientId,
        identityModel: IDENTITY_MODELS.CRM_V2,
        state: registered ? "complete" : "collect_name",
        pendingName: null,
        pendingContact: normalizePhone(phone),
        pendingDateOfBirth: null,
        pendingGender: null,
        bookingRequested: bookingRequest,
        authorityVersion: AUTHORITY_VERSION,
      });
      const revalidated = await whatsappCrmV2IdentityCompat.revalidateSessionIdentity({ phone, session });
      if (revalidated.status !== "crm_v2_current") {
        return { handled: true, identityStatus: revalidated.status, resumeBooking: false, clientIdentity: crmV2Authority.identity, identityAudit: revalidated.audit, recovery: revalidated.recovery || "manual_rebind_required", reply: CRM_V2_STALE_AUTHORITY_REPLY };
      }
      if (!registered) {
        const parsed = extractWhatsAppRegistration(text);
        if (!isGreetingOnly(text) && !bookingRequest && !walkinRequest && (parsed.fullName || parsed.dateOfBirth || parsed.gender)) {
          return processActiveSession(phone, text, session);
        }
        return { handled: true, identityStatus: "registration_required", resumeBooking: false, clientIdentity: crmV2Authority.identity, client: revalidated.client, identityAudit: revalidated.audit, reply: `${PREMIUM_GREETING}\n\nI need to complete your Shiloh client registration before continuing.\n\n${REGISTRATION_START_PROMPT}` };
      }
      if (isGreetingOnly(text) || walkinRequest) {
        return { handled: true, identityStatus: "matched_complete", onboardingComplete: true, resumeBooking: false, clientIdentity: crmV2Authority.identity, client: revalidated.client, identityAudit: revalidated.audit, reply: `${PREMIUM_GREETING}\n\nWelcome back, *${firstName(revalidated.client.name)}* 🌿` };
      }
      return { handled: false, identityStatus: "matched_complete", resumeBooking: false, clientIdentity: crmV2Authority.identity, client: revalidated.client, identityAudit: revalidated.audit };
    }
  }

  if (manualReviewIdentity(identity)) {
    return {
      handled: true,
      identityStatus: identity.status,
      client: identity.client || null,
      reply: identity.status === "ambiguous" ? IDENTITY_CONFLICT_REPLY : HUMAN_VERIFICATION_REPLY,
    };
  }

  const known = verifiedLegacyClient(identity);
  const session = await saveSession(phone, {
    clientId: known?.id || null,
    crmV2ClientId: null,
    identityModel: known ? IDENTITY_MODELS.LEGACY : null,
    state: "collect_name",
    pendingName: null,
    pendingContact: normalizePhone(phone),
    pendingDateOfBirth: null,
    pendingGender: null,
    bookingRequested: bookingRequest,
    authorityVersion: AUTHORITY_VERSION,
  });

  const parsed = extractWhatsAppRegistration(text);
  if (!isGreetingOnly(text) && !bookingRequest && !walkinRequest && (parsed.fullName || parsed.dateOfBirth || parsed.gender)) {
    return processActiveSession(phone, text, session);
  }

  if (["claim_required", "provisional", "unverified_client", "historical_unverified"].includes(identity.status)) {
    return { handled: true, identityStatus: "registration_required", client: null, reply: `${PREMIUM_GREETING}\n\n${REGISTRATION_START_PROMPT}` };
  }
  if (identity.status === "verified_client") {
    return { handled: true, identityStatus: "verified_incomplete", client: known, reply: `${PREMIUM_GREETING}\n\nI need to complete your Shiloh client registration before I can treat this number as booking-ready.\n\n${REGISTRATION_START_PROMPT}` };
  }
  return { handled: true, identityStatus: "unknown", reply: `${PREMIUM_GREETING}\n\n${REGISTRATION_START_PROMPT}` };
}

module.exports = {
  AUTHORITY_VERSION,
  normalizePhone,
  normalizeRegistrationMobile,
  looksLikeRegistrationMobileInput,
  parseDateOfBirth,
  normalizeGender,
  extractWhatsAppRegistration,
  extractBundledRegistration,
  normalizePersistedDateOfBirth,
  normalizeOnboardingSessionRow,
  getSession,
  saveSession,
  resolveClientByWhatsApp,
  resolveVerifiedClientByWhatsApp,
  profileComplete,
  completeCrmV2Onboarding,
  processClientIdentityMessage,
  manualReviewIdentity,
  verifiedLegacyClient,
  crmV2RegistrationRequiresContinuation,
  PREMIUM_GREETING,
  REGISTRATION_START_PROMPT,
  HUMAN_VERIFICATION_REPLY,
  IDENTITY_CONFLICT_REPLY,
  CRM_V2_STALE_AUTHORITY_REPLY,
};
