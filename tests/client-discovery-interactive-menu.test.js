const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const discoveryPath = path.join(__dirname, '..', 'src', 'services', 'clientDiscoveryMenu.js');
const webhookPath = path.join(__dirname, '..', 'src', 'controllers', 'webhookController.js');
const source = fs.readFileSync(discoveryPath, 'utf8');
const webhook = fs.readFileSync(webhookPath, 'utf8');
const { clientHomeInteractive, isHomeCommand, processClientDiscoveryMessage, selectClientBookableServiceByName, servicePageInteractive, welcomeVoucherReply, welcomeVoucherRequestedService, SERVICE_PAGE_SIZE } = require(discoveryPath);

test('client home uses exactly three genuine WhatsApp reply-button actions', () => {
  const home = clientHomeInteractive();
  assert.equal(home.type, 'button');
  assert.deepEqual(home.buttons.map((button) => button.id), [
    'client_welcome_voucher',
    'client_browse_services',
    'client_book_now',
  ]);
  assert.deepEqual(home.buttons.map((button) => button.title), [
    'Get R100 voucher',
    'Browse services',
    'Book now',
  ]);
  assert.match(home.body, /install \*My Shiloh\*/i);
  assert.match(home.body, /open the new My Shiloh icon/i);
  assert.match(home.body, /R100 welcome voucher/);
  assert.ok(home.buttons.every((button) => button.title.length <= 20));
});

test('R100 first action opens the canonical My Shiloh registration journey', () => {
  const reply = welcomeVoucherReply();
  assert.match(reply, /install My Shiloh/i);
  assert.match(reply, /leave the browser and open the new My Shiloh icon/i);
  assert.match(reply, /complete your registration/);
  assert.match(reply, /treatment of R450 or more/);
  assert.match(reply, /https:\/\/app\.shilohmtc\.co\.za\/my-shiloh\/#welcome-voucher/);
});

test('R100 first action is handled before catalogue or booking queries', async () => {
  const result = await processClientDiscoveryMessage('27820000000', 'client_welcome_voucher');
  assert.equal(result.handled, true);
  assert.equal(result.reply, welcomeVoucherReply());
  assert.equal(result.interactive, undefined);
});

test('My Shiloh voucher handoff preserves the selected treatment and bypasses treatment re-selection', () => {
  const message = "Hi Shiloh 👋 I'd like to book Quick Relief – Back & Neck. I also want to use my R100 My Shiloh welcome voucher. Please help me choose an available time.";
  assert.equal(welcomeVoucherRequestedService(message), 'Quick Relief – Back & Neck');
  const service = selectClientBookableServiceByName([
    { id: 7, name: 'Quick Relief: Back & Neck (45 min)' },
    { id: 8, name: 'Facial' },
  ], welcomeVoucherRequestedService(message));
  assert.equal(service?.id, 7);
  assert.match(source, /voucherTreatment[\s\S]*selectedServicePractitioners\(sender, voucherTreatment, \{ welcomeVoucher: true \}\)/);
  assert.match(source, /listEligiblePractitionersForService\(service\.id\)/);
  assert.match(source, /welcomeVoucher: true/);
  assert.match(source, /business_role !== 'tenant_practitioner'/);
  assert.match(source, /client_voucher_practitioner_any/);
  assert.match(source, /client_voucher_practitioner_/);
});

test('service-scoped practitioner recovery replaces the misleading full-team fallback', () => {
  assert.match(source, /client_selected_service_practitioners/);
  assert.match(source, /selectedServicePractitioners\(sender, existing\.service_text\)/);
  assert.doesNotMatch(source, /Shiloh’s client-facing treatment team/);
});

test('client home escape aliases include Back, Menu and Home', () => {
  assert.equal(isHomeCommand('Back'), true);
  assert.equal(isHomeCommand('Menu'), true);
  assert.equal(isHomeCommand('Home'), true);
});

test('client home escape clears stale booking intent before rendering home', () => {
  assert.match(source, /processBookingMessage, getIntent, clearIntent/);
  assert.match(source, /if \(isHomeCommand\(raw\)\) \{[\s\S]*await clearIntent\(sender\);[\s\S]*clientHomeInteractive\(\)/);
});

test('client service browsing is CRM-backed and restricted to client-bookable practitioners', () => {
  assert.match(source, /JOIN staff_services ss ON ss\.service_id = s\.id/);
  assert.match(source, /JOIN staff st ON st\.id = ss\.staff_id/);
  assert.match(source, /s\.status = 'active'/);
  assert.match(source, /st\.status = 'active'/);
  assert.match(source, /st\.resource_type = 'practitioner'/);
  const scopedBookableChecks = source.match(/st\.client_bookable = TRUE/g) || [];
  assert.ok(scopedBookableChecks.length >= 2);
  assert.match(source, /AND client_bookable = TRUE/);
});

test('service list pagination never exceeds Meta list row bounds', () => {
  assert.equal(SERVICE_PAGE_SIZE, 9);
  const rows = Array.from({ length: 22 }, (_, index) => ({
    id: index + 1,
    name: `Treatment ${index + 1}`,
    duration_minutes: 60,
    price: 500,
  }));
  const first = servicePageInteractive(rows, 1);
  const second = servicePageInteractive(rows, 2);
  const last = servicePageInteractive(rows, 3);
  assert.equal(first.type, 'list');
  assert.equal(first.rows.length, 10);
  assert.equal(second.rows.length, 10);
  assert.ok(last.rows.length <= 10);
  assert.equal(first.rows.at(-1).id, 'client_services_page_2');
  assert.equal(second.rows.at(-1).id, 'client_services_page_3');
});

test('client service and practitioner selections are revalidated before entering the same booking intent', () => {
  assert.match(source, /findClientBookableService\(serviceMatch\[1\]\)/);
  assert.match(source, /findClientBookablePractitioner\(practitionerMatch\[1\]\)/);
  assert.match(source, /processBookingMessage\(sender, `Book \$\{service\.name\}`\)/);
  assert.match(source, /processBookingMessage\(sender, `booking with \$\{practitioner\.display_name\}`\)/);
  assert.match(source, /decorateClientBookingResult\(await processBookingMessage/);
  assert.doesNotMatch(source, /Savanna|Pieter/);
});

test('non-admin interactive button IDs survive inbound normalization', () => {
  assert.match(webhook, /button_reply[\s\S]*commandForClientBookingButton\(id\)[\s\S]*\|\|id\|\|null/);
  assert.match(webhook, /list_reply[\s\S]*return id\|\|null/);
  assert.doesNotMatch(webhook, /commandForAdminButton/);
});

test('client discovery runs after identity handling but before scope and booking fallthrough', () => {
  const identity = webhook.indexOf('processClientIdentityMessage(from,text)');
  const discovery = webhook.indexOf('processClientDiscoveryMessage(from,text)');
  const scope = webhook.indexOf('evaluateClinicScope(text)');
  const policy = webhook.indexOf('processBookingPolicyMessage(from,text)');
  const booking = webhook.lastIndexOf('processBookingMessage(from,text)');
  assert.ok(identity >= 0 && discovery >= 0 && scope >= 0 && policy >= 0 && booking >= 0);
  assert.ok(identity < discovery);
  assert.ok(discovery < scope);
  assert.ok(scope < policy);
  assert.ok(policy < booking);
});
