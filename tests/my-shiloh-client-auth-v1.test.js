const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const sessionService = require('../src/services/clientBrowserSession');
const sessionMiddleware = require('../src/middleware/clientBrowserSession');
const { renderMyShilohPage } = require('../src/presentation/myShilohPwa');

test('client sessions and SMS challenge cookies remain separate from staff authority', () => {
  const env = { NODE_ENV: 'production' };
  const session = sessionMiddleware.serializeClientSessionCookie('opaque', { env, maxAgeSeconds: 3600 });
  const sms = sessionMiddleware.serializeClientSmsAuthCookie('challenge', { env, maxAgeSeconds: 600 });
  for (const cookie of [session, sms]) {
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Strict/);
    assert.doesNotMatch(cookie, /Domain=|shiloh_staff_session/);
  }
  assert.match(session, /^__Host-shiloh_client_session=opaque;/);
  assert.match(sms, /^__Host-shiloh_client_sms_auth=challenge;/);
});

test('SMS and passkey session methods remain while WhatsApp cannot issue a new session', () => {
  const source = read('src/services/clientBrowserSession.js');
  assert.match(source, /issueVerifiedSmsSession/);
  assert.match(source, /issueVerifiedPasskeySession/);
  assert.match(source, /FROM crm_v2_clients/);
  assert.doesNotMatch(source, /beginChallenge|verifyWhatsAppChallenge|completeVerifiedChallenge/);
  assert.doesNotMatch(source, /staff_admin_accounts|staff_browser_sessions|ADMIN_API_KEY/i);
});

test('historical client session schema remains intact for existing sessions', () => {
  const sql = read('migrations/136_my_shiloh_client_browser_sessions.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS client_browser_sessions/);
  assert.match(sql, /REFERENCES crm_v2_clients\(id\)/);
  assert.match(sql, /csrf_hash TEXT NOT NULL/);
});

test('My Shiloh routes retire WhatsApp challenges and preserve SMS, passkey, session, CSRF', () => {
  const source = read('src/routes/myShiloh.js');
  assert.match(source, /sameOriginGuard|requireClientSession|clientCsrfGuard/);
  assert.match(source, /\/my-shiloh\/auth\/sms\/start/);
  assert.match(source, /\/my-shiloh\/auth\/sms\/complete/);
  assert.match(source, /\/my-shiloh\/auth\/passkeys\/sign-in\/finish/);
  assert.match(source, /\/my-shiloh\/auth\/logout/);
  assert.doesNotMatch(source, /router\.post\('\/my-shiloh\/auth\/(?:start|complete|status)'/);
  assert.doesNotMatch(source, /requireStaffSession|ADMIN_API_KEY|x-admin-key/i);
});

test('webhook keeps delivery receipts and ordinary conversation without client sign-in interception', () => {
  const source = read('src/routes/webhook.js');
  assert.match(source, /processWhatsAppStatusWebhook/);
  assert.match(source, /res\.sendStatus\(200\)/);
  assert.doesNotMatch(source, /myShilohWhatsAppAuthMiddleware|staffWhatsAppPasskeyBootstrapMiddleware/);
});

test('My Shiloh shows SMS and passkey, with separate human Reception contact', () => {
  const guest = renderMyShilohPage({ whatsappNumber: '27830000000', humanWhatsAppNumber: '27662399138', smsAvailable: true, passkeysAvailable: true });
  assert.match(guest, /data-client-sms-start|data-passkey-sign-in/);
  assert.match(guest, /WhatsApp Reception/);
  assert.doesNotMatch(guest, /data-client-auth-start|data-client-auth-code-disclosure|MY SHILOH SIGN IN/);
  const signed = renderMyShilohPage({ client: { id: 912, name: 'Christel Botha', firstName: 'Christel' }, now: new Date('2026-09-18T18:00:00Z') });
  assert.match(signed, /Good evening, <span>Christel\.<\/span>/);
  assert.match(signed, /data-client-authenticated="true"/);
});

test('installed app has no WhatsApp authentication handoff or polling', () => {
  const source = read('public/my-shiloh/assets/app.js');
  assert.match(source, /\/my-shiloh\/auth\/sms\/start/);
  assert.match(source, /\/my-shiloh\/auth\/sms\/complete/);
  assert.doesNotMatch(source, /welcomeBackFromWhatsApp|whatsappHandoffStarted|openWhatsAppDirect|\/my-shiloh\/auth\/(?:start|complete|status)/);
  assert.doesNotMatch(source, /sessionStorage|indexedDB/);
});

test('PWA service worker keeps authentication and private APIs network-only', () => {
  const source = read('public/my-shiloh/sw.js');
  assert.match(source, /\/my-shiloh\/auth\//);
  assert.match(source, /\/my-shiloh\/api\//);
  assert.doesNotMatch(source, /cache\.put\([^\n]*auth/);
});

test('every normal browser is an installation doorway while standalone mode keeps client authority unchanged', () => {
  const presentation = read('src/presentation/myShilohPwa.js');
  const client = read('public/my-shiloh/assets/app.js');
  const styles = read('public/my-shiloh/assets/app.css');

  assert.match(presentation, /data-install-gate/);
  assert.match(presentation, /Keep My Shiloh one tap away/);
  assert.match(presentation, /Already installed\? Open My Shiloh from your Home Screen/);
  assert.match(presentation, /Already installed\? Open My Shiloh from your Home Screen\./);
  assert.doesNotMatch(presentation, /data-install-verification-gate/);
  assert.match(presentation, /data-client-sms-start/);
  assert.match(presentation, /data-app-frame[^>]*hidden/);
  assert.match(client, /function browserNeedsInstall\(\)/);
  assert.match(client, /return !standalone\(\)/);
  assert.match(client, /appFrame\.hidden = browserGated/);
  assert.doesNotMatch(presentation, /data-install-gate-instructions/);
  assert.doesNotMatch(client, /On iPhone: tap Share, choose Add to Home Screen, then tap Add/);
  assert.match(presentation, /data-install-gate-action>Install My Shiloh<\/button>/);
  assert.match(client, /deferredInstallPrompt && isAndroid\(\)/);
  assert.match(client, /installGateAction\.textContent = 'Install My Shiloh'/);
  assert.match(client, /function isIosChrome\(\)/);
  assert.match(client, /You’re in Chrome\. Use Share to add My Shiloh to your Home Screen\./);
  assert.match(client, /function shareIcon\(\)/);
  assert.match(client, /install-share-icon/);
  assert.match(client, /Tap Share/);
  assert.match(client, /Choose Add to Home Screen/);
  assert.match(client, /Open as Web App, then tap Add/);
  assert.match(client, /appinstalled[\s\S]*deferredInstallPrompt = null/);
  assert.match(client, /if \(!standalone\(\) \|\| appFrame\?\.dataset\.clientAuthenticated !== 'true'/);
  assert.doesNotMatch(client, /document\.cookie|sessionStorage|indexedDB/);
  assert.match(styles, /\.install-gate\{/);
});


test('My Shiloh is the canonical installed-app display name', () => {
  const manifest = JSON.parse(read('public/my-shiloh/manifest.webmanifest'));
  const presentation = read('src/presentation/myShilohPwa.js');
  assert.equal(manifest.name, 'My Shiloh');
  assert.equal(manifest.short_name, 'My Shiloh');
  assert.match(presentation, /apple-mobile-web-app-title" content="My Shiloh"/);
  assert.match(presentation, /data-install-gate-action>Install My Shiloh<\/button>/);
});

test('website treatment handoff only exposes a canonical catalogue code and keeps the booking session-bound', () => {
  const catalogue = [{ id: 103, name: 'Toe Gel Only' }];
  const selected = renderMyShilohPage({ catalogue, selectedServiceId: '103' });
  assert.match(selected, /data-website-treatment-handoff data-service-code="103" hidden/);
  assert.match(selected, /Your website choice: <strong>Toe Gel Only<\/strong>/);
  const guestBookings = selected.match(/<section class="view" id="bookings"[\s\S]*?<\/section>/)?.[0] || '';
  assert.doesNotMatch(guestBookings, /data-website-treatment-form/);
  const signedIn = renderMyShilohPage({ catalogue, client: { id: 5, firstName: 'Jean' } });
  assert.match(signedIn, /data-website-treatment-form/);
  assert.doesNotMatch(renderMyShilohPage({ catalogue, selectedServiceId: '999' }), /data-website-treatment-handoff/);
  assert.doesNotMatch(renderMyShilohPage({ catalogue, selectedServiceId: '103"><script>' }), /data-website-treatment-handoff/);
});

test('installed app stores only bounded update archive IDs and notification setup choice; the server session remains authority', () => {
  const client = read('public/my-shiloh/assets/app.js');
  const presentation = read('src/presentation/myShilohPwa.js');

  const writes = [...client.matchAll(/localStorage\.setItem\(([^,]+),\s*([^\)]+)\)/g)]
    .map((match) => [match[1].trim(), match[2].trim()]);
  assert.deepEqual(writes, [
    ['notificationSetupKey', "'1'"],
    ['notificationArchiveKey', 'JSON.stringify([...archivedUpdateIds].slice(-100'],
  ]);
  assert.match(client, /my-shiloh-notification-setup-later-v1:\$\{appFrame\.dataset\.notificationClientId\}/);
  assert.match(client, /my-shiloh-archived-updates-v1:\$\{appFrame\.dataset\.notificationClientId\}/);
  assert.match(client, /archivedUpdateIds\.add\(id\)/);
  assert.doesNotMatch(client, /localStorage\.setItem\([^\n]*(?:title|body|targetPath|auth)/i);
  assert.doesNotMatch(client, /markInstallationVerified|resetInstallationVerification/);
  assert.doesNotMatch(client, /localStorage\.setItem\([^\n]*(?:token|mobile|name|voucher|csrf|session)/i);
  assert.doesNotMatch(client, /sessionStorage|indexedDB|document\.cookie/i);
  assert.doesNotMatch(presentation, /Verify with WhatsApp once on this installation/);
});
