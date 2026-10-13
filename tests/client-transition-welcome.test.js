const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const transition = require('../src/services/clientTransitionWelcome');
const {
  PREMIUM_GREETING,
  HUMAN_VERIFICATION_REPLY,
  IDENTITY_CONFLICT_REPLY,
} = require('../src/services/clientIdentityOnboarding');
const { commandForAdminButton } = require('../src/services/adminEarningsButtons');

const serviceSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'services', 'clientTransitionWelcome.js'),
  'utf8'
);

const resolverSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'services', 'clientVerifiedIdentity.js'),
  'utf8'
);

test('legacy universal welcome derives its booking link from the deployed origin', () => {
  const reply = transition.buildUniversalWelcome({ RENDER_EXTERNAL_URL: 'https://shiloh.example.test' });
  assert.match(reply, /you’re in the right place/i);
  assert.match(reply, /Shiloh, our AI Assistant/i);
  assert.match(reply, /Choosing the right treatment/i);
  assert.match(reply, /browse our treatments, descriptions and prices here/i);
  assert.match(reply, /https:\/\/shiloh\.example\.test\/book/i);
  assert.match(reply, /start your booking directly from the treatment page/i);
  assert.match(reply, /come back here and chat with me/i);
  assert.match(reply, /Checking availability/i);
  assert.match(reply, /Making or managing your appointment/i);
  assert.match(reply, /Calls & SMS: 066 239 9138/i);
  assert.match(reply, /right here on WhatsApp/i);
});

test('public booking URL follows a safe explicit or Render origin without a hostname dependency', () => {
  assert.equal(transition.publicBookingUrl({ RENDER_EXTERNAL_URL: 'https://old.example.test' }), 'https://old.example.test/book');
  assert.equal(transition.publicBookingUrl({ SHILOH_PUBLIC_BASE_URL: 'https://new.example.test/' }), 'https://new.example.test/book');
  assert.equal(transition.publicBookingUrl({ SHILOH_PUBLIC_BASE_URL: 'http://unsafe.example.test' }), null);
  assert.equal(transition.publicBookingUrl({}), null);
  assert.doesNotMatch(transition.buildUniversalWelcome({}), /onrender\.com/i);
});

test('first-contact presentation uses the exact canonical PREMIUM_GREETING', () => {
  assert.equal(transition.buildPremiumGreeting(), PREMIUM_GREETING);
  assert.equal(transition.prependPremiumGreeting('Identity-specific reply'), `${PREMIUM_GREETING}\n\nIdentity-specific reply`);
  assert.equal(transition.prependPremiumGreeting(`${PREMIUM_GREETING}\n\nIdentity-specific reply`), `${PREMIUM_GREETING}\n\nIdentity-specific reply`);
});

test('registered clients receive a clear already-registered branch and guided actions', () => {
  const reply = transition.buildTransitionWelcome();
  const interactive = transition.registeredClientInteractive();
  assert.ok(reply.startsWith(PREMIUM_GREETING));
  assert.match(reply, /already registered with Shiloh/i);
  assert.match(reply, /no need to register again/i);
  assert.match(reply, /How would you like to proceed/i);
  assert.equal(interactive.type, 'list');
  assert.deepEqual(
    interactive.rows.map((row) => row.id),
    ['services', 'client_browse_services', 'client_practitioners', 'main menu']
  );
});

test('Book appointment enters deterministic service discovery instead of stale booking intent handling', () => {
  const interactive = transition.registeredClientInteractive();
  const book = interactive.rows.find((row) => row.title === 'Book appointment');
  assert.ok(book, 'Book appointment action must exist');
  assert.equal(book.id, 'services');
  assert.notEqual(book.id, 'client_book_now');
});

test('already-delivered legacy Book appointment payload remains compatible', () => {
  const { commandForClientBookingButton } = require('../src/services/clientBookingInteractive');
  assert.equal(commandForClientBookingButton('client_book_now'), 'services');
});

test('registered-client interactive body stays within Meta limit and excludes the greeting', () => {
  const interactive = transition.registeredClientInteractive();
  assert.equal(transition.WHATSAPP_INTERACTIVE_BODY_MAX, 1024);
  assert.ok(interactive.body.length <= transition.WHATSAPP_INTERACTIVE_BODY_MAX);
  assert.equal(interactive.body, transition.buildRegisteredClientPrompt());
  assert.doesNotMatch(interactive.body, /Welcome to \*Shiloh Massage Therapy/i);
});

test('new registration first contact gets premium greeting exactly once', () => {
  const identity = {
    handled: true,
    identityStatus: 'unknown',
    reply: 'legacy registration response',
  };
  const result = transition.identityBranchWithPremiumWelcome('27820000001', identity);
  assert.equal(result.identityStatus, 'unknown');
  assert.ok(result.reply.startsWith(`${PREMIUM_GREETING}\n\n`));
  assert.equal(result.reply.split(PREMIUM_GREETING).length - 1, 1);
  assert.match(result.reply, /first name, surname, date of birth and gender/i);
});

test('claim_required gets premium greeting once without changing identity status', () => {
  const identity = {
    handled: true,
    identityStatus: 'claim_required',
    client: { id: 48 },
    reply: 'This number matches one imported Shiloh contact, but imported contact details are not identity proof.',
  };
  const result = transition.identityBranchWithPremiumWelcome('27820000002', identity);
  assert.equal(result.identityStatus, 'claim_required');
  assert.equal(result.client.id, 48);
  assert.equal(result.reply.split(PREMIUM_GREETING).length - 1, 1);
  assert.match(result.reply, /imported contact details are not identity proof/i);
});

test('historical_unverified gets greeting plus unchanged human-verification response', () => {
  const identity = {
    handled: true,
    identityStatus: 'historical_unverified',
    client: { id: 473 },
    reply: HUMAN_VERIFICATION_REPLY,
  };
  const result = transition.identityBranchWithPremiumWelcome('27820000003', identity);
  assert.equal(result.identityStatus, 'historical_unverified');
  assert.equal(result.reply, `${PREMIUM_GREETING}\n\n${HUMAN_VERIFICATION_REPLY}`);
});

test('ambiguous gets greeting plus unchanged fail-closed conflict response', () => {
  const identity = {
    handled: true,
    identityStatus: 'ambiguous',
    reply: IDENTITY_CONFLICT_REPLY,
  };
  const result = transition.identityBranchWithPremiumWelcome('27820000004', identity);
  assert.equal(result.identityStatus, 'ambiguous');
  assert.equal(result.reply, `${PREMIUM_GREETING}\n\n${IDENTITY_CONFLICT_REPLY}`);
});

test('provisional and manual-review identity statuses are preserved by presentation wrapper', () => {
  for (const identityStatus of ['provisional', 'registration_required', 'manual_review']) {
    const identity = { handled: true, identityStatus, reply: `safe ${identityStatus} response` };
    const result = transition.identityBranchWithPremiumWelcome('27820000005', identity);
    assert.equal(result.identityStatus, identityStatus);
    assert.equal(result.reply, `${PREMIUM_GREETING}\n\nsafe ${identityStatus} response`);
  }
});

test('verified returning welcome starts with premium greeting and keeps registered-client actions', () => {
  const reply = transition.buildTransitionWelcome();
  const interactive = transition.registeredClientInteractive();
  assert.ok(reply.startsWith(PREMIUM_GREETING));
  assert.match(reply, /already registered with Shiloh/i);
  assert.equal(interactive.rows[0].id, 'services');
});

test('subsequent onboarding messages do not repeat premium greeting', () => {
  assert.match(serviceSource, /if \(await welcomeAlreadyDelivered\(phone\)\)/);
  assert.match(serviceSource, /return \{ handled: false \};/);
  assert.match(serviceSource, /isGreetingOnly\(text\).*pendingOnboardingSession\(phone\)/s);
  assert.doesNotMatch(serviceSource, /if \(!isGreetingOnly\(text\)\) return \{ handled: false \};/);
});

test('legacy welcome helper centralizes first-contact presentation', () => {
  assert.match(serviceSource, /async function processClientTransitionWelcome\(phone, text\)/);
  assert.doesNotMatch(serviceSource, /async function processClientTransitionWelcome\(phone, text\) \{\n  if \(!isGreetingOnly\(text\)\)/);
});

test('presentation change does not alter centralized verified-client resolver semantics', () => {
  assert.doesNotMatch(serviceSource, /INSERT INTO client_identity_verifications/);
  assert.doesNotMatch(serviceSource, /UPDATE client_contacts SET contact_type/);
  assert.doesNotMatch(serviceSource, /controlled_demo_identities/);
  assert.match(resolverSource, /status: 'historical_unverified'|status: "historical_unverified"/);
  assert.match(resolverSource, /status: 'ambiguous'|status: "ambiguous"/);
});

test('v2 phone-level delivery ledger remains unchanged so already-welcomed clients are not re-greeted', () => {
  assert.equal(transition.UNIVERSAL_WELCOME_VERSION, 'v2');
  assert.match(serviceSource, /client_whatsapp_welcome_deliveries/);
  assert.match(serviceSource, /whatsapp_universal_welcome_v2_sent_at/);
  assert.match(serviceSource, /ON CONFLICT \(phone, welcome_version\) DO NOTHING/);
});
