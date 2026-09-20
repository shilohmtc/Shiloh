const { pool } = require('../db/pool');
const {
  processClientIdentityMessage,
  REGISTRATION_START_PROMPT,
  PREMIUM_GREETING,
} = require('./clientIdentityOnboarding');
const {
  resolveWhatsAppBookingIdentity,
  bookingProfileComplete,
} = require('./whatsappBookingIdentity');
const { IDENTITY_MODELS } = require('./whatsappCrmV2IdentityCompat');
const { sendWhatsAppList } = require('./whatsapp');

const UNIVERSAL_WELCOME_VERSION = 'v2';
const UNIVERSAL_WELCOME_ATTRIBUTE = 'whatsapp_universal_welcome_v2_sent_at';
const WHATSAPP_INTERACTIVE_BODY_MAX = 1024;

function normalizePhone(value = '') {
  return String(value).replace(/[^0-9]/g, '');
}

function isGreetingOnly(text = '') {
  return /^(hi|hello|hey|good morning|good afternoon|good evening|howzit|hiya)[!. ]*$/i.test(String(text).trim());
}

function profileComplete(client = {}) {
  return Boolean(
    String(client.display_name || '').trim().split(/\s+/).filter(Boolean).length >= 2 &&
    client.date_of_birth &&
    client.gender
  );
}

// Historical long-form welcome retained as an exported compatibility surface.
// First-contact identity presentation below deliberately uses the canonical
// clientIdentityOnboarding PREMIUM_GREETING instead.
function publicBookingUrl(env = process.env) {
  const rawOrigin = String(env.SHILOH_PUBLIC_BASE_URL || env.RENDER_EXTERNAL_URL || '').trim();
  if (!rawOrigin) return null;
  try {
    const origin = new URL(rawOrigin);
    if (origin.protocol !== 'https:' || origin.username || origin.password) return null;
    return new URL('/book', origin).toString();
  } catch (_) {
    return null;
  }
}

function buildUniversalWelcome(env = process.env) {
  const bookingUrl = publicBookingUrl(env);
  return [
    '🌿 *Welcome to Shiloh*',
    '',
    'Hello! You’ve reached *Shiloh Massage Therapy & Aesthetic Clinic*.',
    '',
    'If you’ve contacted us on this WhatsApp number before, *you’re in the right place*. 😊',
    '',
    'We’ve made a few changes to the way we assist our clients. This WhatsApp is now looked after by *Shiloh, our AI Assistant*, designed to make booking and getting assistance quicker and easier.',
    '',
    '*I’m Shiloh 👋 and I can help you with:*',
    '',
    '✨ *Choosing the right treatment*',
    'Not sure what to book? Tell me what you’d like help with and I can guide you, or browse our treatments, descriptions and prices here:',
    bookingUrl || 'Reply *services* to browse treatments here in WhatsApp.',
    '',
    'Found the right treatment? You can start your booking directly from the treatment page, or come back here and chat with me — I’ll be happy to help. 🌿',
    '',
    '📅 *Checking availability* — I’ll check the clinic’s live schedule and available appointments for you.',
    '',
    '✅ *Making or managing your appointment* — book an appointment, manage an existing booking, and receive your appointment details right here on WhatsApp.',
    '',
    '*And don’t worry — Christel and the Shiloh team are still here. 🌿*',
    'If you need personal assistance or would prefer to speak to someone directly:',
    '',
    '📞 *Calls & SMS: 066 239 9138*',
    '',
    'Otherwise, simply continue chatting with me *right here on WhatsApp*, and I’ll be happy to assist you.',
  ].join('\n');
}

function buildPremiumGreeting() {
  return PREMIUM_GREETING;
}

function prependPremiumGreeting(reply = '') {
  const body = String(reply || '').trim();
  if (!body) return PREMIUM_GREETING;
  if (body === PREMIUM_GREETING || body.startsWith(`${PREMIUM_GREETING}\n\n`)) return body;
  return `${PREMIUM_GREETING}\n\n${body}`;
}

function buildRegisteredClientPrompt() {
  return [
    '✅ *You’re already registered with Shiloh.*',
    '',
    'There’s no need to register again. 😊',
    '',
    '🎁 Open My Shiloh to unlock your once-off *R100 welcome voucher* by confirming your full profile:',
    'https://app.shilohmtc.co.za/my-shiloh/#welcome-voucher',
    '',
    '*How would you like to proceed?*',
  ].join('\n');
}

function buildNewClientPrompt() {
  return [
    '🌿 *It looks like you’re new to Shiloh.*',
    '',
    'Before I can make or manage appointments for you, I’ll help you complete a quick registration.',
    '',
    '🎁 Complete it in My Shiloh to unlock a once-off *R100 welcome voucher* for a qualifying treatment.',
    '',
    '*Let’s get you registered.*',
    '',
    REGISTRATION_START_PROMPT,
  ].join('\n');
}

function buildTransitionWelcome() {
  return `${PREMIUM_GREETING}\n\n${buildRegisteredClientPrompt()}`;
}

function registeredClientInteractive() {
  const body = buildRegisteredClientPrompt();
  if (body.length > WHATSAPP_INTERACTIVE_BODY_MAX) {
    throw new Error(`Registered-client interactive body exceeds WhatsApp ${WHATSAPP_INTERACTIVE_BODY_MAX}-character limit`);
  }
  return {
    type: 'list',
    body,
    buttonText: 'Choose an option',
    rows: [
      { id: 'services', title: 'Book appointment', description: 'Start a new appointment booking' },
      { id: 'client_browse_services', title: 'Browse treatments', description: 'View Shiloh treatments and services' },
      { id: 'client_practitioners', title: 'Our practitioners', description: 'View client-bookable practitioners' },
      { id: 'main menu', title: 'Main menu', description: 'Open the standard Shiloh client menu' },
    ],
    sectionTitle: 'How would you like to proceed?',
  };
}

let welcomeSchemaPromise = null;
async function ensureWelcomeSchema() {
  if (!welcomeSchemaPromise) {
    welcomeSchemaPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS client_whatsapp_welcome_deliveries (
        phone TEXT NOT NULL,
        welcome_version TEXT NOT NULL,
        sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (phone, welcome_version)
      )
    `).catch((error) => {
      welcomeSchemaPromise = null;
      throw error;
    });
  }
  return welcomeSchemaPromise;
}

async function resolveClientState(phone) {
  const identity = await resolveWhatsAppBookingIdentity(phone);
  if (identity.status === 'unique') {
    return { status: 'unique', authorityStatus: identity.authorityStatus, clientIdentity: identity.clientIdentity, client: identity.client, clients: identity.clients || [], registrationComplete: bookingProfileComplete(identity.clientIdentity, identity.client) };
  }
  return { status: identity.status, authorityStatus: identity.status, client: identity.client || null, clients: identity.clients || [], registrationComplete: false };
}

async function welcomeAlreadyDelivered(phone) {
  await ensureWelcomeSchema();
  const result = await pool.query(
    `SELECT 1
       FROM client_whatsapp_welcome_deliveries
      WHERE phone = $1
        AND welcome_version = $2
      LIMIT 1`,
    [normalizePhone(phone), UNIVERSAL_WELCOME_VERSION]
  );
  return result.rowCount > 0;
}

async function pendingOnboardingSession(phone) {
  const result = await pool.query(
    `SELECT state
       FROM client_onboarding_sessions
      WHERE phone = $1
        AND state <> 'complete'
      LIMIT 1`,
    [normalizePhone(phone)]
  );
  return result.rowCount > 0;
}

async function markUniversalWelcomeSent(phone, clientId = null) {
  await ensureWelcomeSchema();
  const normalized = normalizePhone(phone);
  await pool.query(
    `INSERT INTO client_whatsapp_welcome_deliveries (phone, welcome_version, sent_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (phone, welcome_version) DO NOTHING`,
    [normalized, UNIVERSAL_WELCOME_VERSION]
  );
  if (clientId) {
    await pool.query(
      `UPDATE clients
          SET custom_attributes = COALESCE(custom_attributes, '{}'::jsonb)
              || jsonb_build_object('${UNIVERSAL_WELCOME_ATTRIBUTE}', NOW()::text),
              updated_at = NOW()
        WHERE id = $1
          AND COALESCE(custom_attributes->>'${UNIVERSAL_WELCOME_ATTRIBUTE}', '') = ''`,
      [clientId]
    );
  }
}

function registeredClientPostSend(phone, clientId) {
  return async () => {
    const interactive = registeredClientInteractive();
    await sendWhatsAppList(
      phone,
      interactive.body,
      interactive.buttonText,
      interactive.rows,
      interactive.sectionTitle
    );
    await markUniversalWelcomeSent(phone, clientId);
  };
}

function identityBranchWithPremiumWelcome(phone, identity) {
  if (!identity?.handled) return identity;

  if (identity.identityStatus === 'unknown') {
    return {
      ...identity,
      reply: `${PREMIUM_GREETING}\n\n${buildNewClientPrompt()}`,
      postSend: async () => markUniversalWelcomeSent(phone),
    };
  }

  return {
    ...identity,
    reply: prependPremiumGreeting(identity.reply),
    postSend: async () => markUniversalWelcomeSent(phone, identity.client?.id || null),
  };
}

async function processClientTransitionWelcome(phone, text) {
  const clientState = await resolveClientState(phone);

  if (await welcomeAlreadyDelivered(phone)) {
    // Preserve the existing repeated-greeting reminder, but never intercept
    // ordinary subsequent onboarding details after the first welcome.
    if (isGreetingOnly(text) && clientState.status === 'none' && await pendingOnboardingSession(phone)) {
      return {
        handled: true,
        reply: '🌿 We’ve already started your Shiloh registration. Please send your *first name, surname, date of birth and gender* so I can continue.',
      };
    }
    return { handled: false };
  }

  if (clientState.status === 'unique' && clientState.registrationComplete && clientState.client?.gender) {
    const client = clientState.client;
    const legacyClientId = clientState.clientIdentity?.identityModel === IDENTITY_MODELS.LEGACY ? clientState.clientIdentity.legacyClientId : null;
    return {
      handled: true,
      reply: PREMIUM_GREETING,
      client,
      postSend: registeredClientPostSend(phone, legacyClientId),
    };
  }

  const identity = await processClientIdentityMessage(phone, text);
  return identityBranchWithPremiumWelcome(phone, identity);
}

module.exports = {
  UNIVERSAL_WELCOME_VERSION,
  UNIVERSAL_WELCOME_ATTRIBUTE,
  WHATSAPP_INTERACTIVE_BODY_MAX,
  normalizePhone,
  isGreetingOnly,
  profileComplete,
  publicBookingUrl,
  buildUniversalWelcome,
  buildPremiumGreeting,
  prependPremiumGreeting,
  buildRegisteredClientPrompt,
  buildNewClientPrompt,
  buildTransitionWelcome,
  registeredClientInteractive,
  identityBranchWithPremiumWelcome,
  processClientTransitionWelcome,
};
