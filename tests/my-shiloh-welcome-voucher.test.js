const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registrationProgress, WELCOME_VOUCHER_TERMS } = require('../src/services/myShilohWelcomeVoucher');
const { renderMyShilohPage } = require('../src/presentation/myShilohPwa');
const { renderHome } = require('../src/services/publicWebsite');
const transition = require('../src/services/clientTransitionWelcome');
const {
  qualifyingServices,
  welcomeVoucherBookingUrl,
  renderMyShilohWelcomeVoucherBooking,
} = require('../src/presentation/myShilohWelcomeVoucherBooking');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('welcome voucher unlock follows verified full registration only', () => {
  const minimal = registrationProgress({ name:'Dinah Harris', mobile_verified_at:new Date(), profile_status:'minimal' });
  assert.equal(minimal.complete, false);
  assert.deepEqual(minimal.steps.map((step) => step.complete), [true, false, false]);
  const registered = registrationProgress({ name:'Dinah Harris', date_of_birth:'1980-01-02', gender:'female', mobile_verified_at:new Date(), profile_status:'registered' });
  assert.equal(registered.complete, true);
  assert.deepEqual(registered.steps.map((step) => step.complete), [true, true, true]);
});

test('voucher schema is once per canonical client and separate from Rewards and payment truth', () => {
  const migration = read('migrations/143_my_shiloh_welcome_voucher.sql');
  assert.match(migration, /crm_v2_client_id BIGINT NOT NULL UNIQUE/);
  assert.match(migration, /booking_welcome_voucher_allocations/);
  assert.match(migration, /minimum_booking_value[^\n]*450\.00/);
  assert.match(migration, /validity_days[^\n]*60/);
  assert.doesNotMatch(migration, /INSERT INTO loyalty_wallet_entries/);
  assert.doesNotMatch(migration, /INSERT INTO payment_ledger_entries/);
});

test('website, My Shiloh and contextual WhatsApp invite clients into the same offer', () => {
  const website = renderHome([]);
  const guest = renderMyShilohPage({ whatsappNumber:'27830000000' });
  const signedIn = renderMyShilohPage({ client:{ id:1, firstName:'Dinah', name:'Dinah Harris' } });
  assert.match(website, /R100 welcome voucher/);
  assert.match(website, /href="\/my-shiloh\/#welcome-voucher"[^>]*>Claim my R100/);
  assert.match(guest, /Complete your registration\. Unlock R100\./);
  assert.match(guest, /data-client-auth-start>Claim my R100/);
  assert.match(signedIn, /data-welcome-voucher/);
  assert.match(transition.buildRegisteredClientPrompt(), /R100 welcome voucher/);
  assert.match(transition.buildRegisteredClientPrompt(), /my-shiloh\/#welcome-voucher/);
});

test('redemption is guarded, client-confirmed and gives recovery steps', () => {
  const service = read('src/services/myShilohWelcomeVoucher.js');
  const routes = read('src/routes/myShiloh.js');
  const app = read('public/my-shiloh/assets/app.js');
  assert.match(service, /profile_status === 'registered'/);
  assert.match(service, /eligibleVoucher = synced\.progress\.complete \? synced\.voucher : null/);
  assert.match(service, /loadAuthority\(client, clientId, \{ lock: true \}\)/);
  assert.match(service, /!registrationProgress\(authority\)\.complete/);
  assert.match(service, /package_session_redemptions/);
  assert.match(service, /appointment_group_members/);
  assert.match(service, /WELCOME_VOUCHER_BALANCE_TOO_LOW/);
  assert.match(routes, /requireSession, requireCsrf/);
  assert.match(routes, /resolution:error\.resolution/);
  assert.match(app, /What to do:/);
  assert.ok(WELCOME_VOUCHER_TERMS.some((term) => /amount actually paid/i.test(term)));
});

test('booking balance calculations include welcome value while reward accrual remains payment-ledger based', () => {
  const payments = read('src/services/bookingPayments.js');
  const context = read('src/services/myShilohClientContext.js');
  const rewards = read('src/services/shilohRewards.js');
  assert.match(payments, /welcomeVoucherApplied/);
  assert.match(context, /welcome_voucher_applied/);
  assert.match(rewards, /booking_welcome_voucher_allocations/);
  assert.match(rewards, /FROM payment_ledger_entries/);
});

test('welcome voucher treatment discovery stays inside the installed My Shiloh scope', () => {
  const app = read('public/my-shiloh/assets/app.js');
  const routes = read('src/routes/myShiloh.js');
  assert.match(app, /link\.href = '\/my-shiloh\/book'/);
  assert.doesNotMatch(app, /Find a qualifying treatment'[\s\S]{0,100}href = '\/book'/);
  assert.match(app, /refreshAuthenticatedClientState/);
  assert.match(app, /visibilityState === 'visible'[\s\S]*refreshAuthenticatedClientState/);
  assert.match(routes, /router\.get\('\/my-shiloh\/book', requireSession/);
  assert.match(routes, /voucher\?\.state !== 'available'/);
});

test('qualifying treatment page explains the complete application path and filters prices', () => {
  const catalogue = [
    { id:1, name:'Short treatment', category:'Massage', duration:'30 min', price:'R400' },
    { id:2, name:'Qualifying treatment', category:'Massage', duration:'60 min', price:'R450' },
    { id:3, name:'Premium treatment', category:'Facials', duration:'75 min', price:'R650' },
    { id:4, name:'Variable treatment', category:'Facials', duration:'60 min', price:'Price on request' },
  ];
  assert.deepEqual(qualifyingServices(catalogue, 450).map((service) => service.id), [2, 3]);
  const html = renderMyShilohWelcomeVoucherBooking({ number:'27820000000', catalogue, minimumBookingValue:450 });
  assert.match(html, /Choose a qualifying treatment/);
  assert.match(html, /Confirm the booking/);
  assert.match(html, /Apply the R100/);
  assert.match(html, /Apply R100 to this booking/);
  assert.match(html, /href="\/my-shiloh\/#welcome-voucher"/);
  assert.match(html, /Qualifying treatment/);
  assert.doesNotMatch(html, /Short treatment/);
  assert.doesNotMatch(html, /Variable treatment/);
});

test('qualifying treatment WhatsApp handoff carries explicit voucher intent', () => {
  const url = welcomeVoucherBookingUrl('+27 82 000 0000', 'Full-Body Sports Massage');
  assert.match(url, /^https:\/\/wa\.me\/27820000000\?text=/);
  const message = decodeURIComponent(new URL(url).searchParams.get('text'));
  assert.match(message, /Full-Body Sports Massage/);
  assert.match(message, /Full-Body Sports Massage\./);
  assert.match(message, /R100 My Shiloh welcome voucher/);
});
