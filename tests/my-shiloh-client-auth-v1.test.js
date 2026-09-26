const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const sessionService = require('../src/services/clientBrowserSession');
const sessionMiddleware = require('../src/middleware/clientBrowserSession');
const whatsappMiddleware = require('../src/middleware/myShilohWhatsAppAuth');
const { renderMyShilohPage } = require('../src/presentation/myShilohPwa');
const { defaultAuthUrlBuilder, normalizeAuthHandoff } = require('../src/routes/myShiloh');

test('client session cookies are separate from staff authority and hardened in production', () => {
  const env = { NODE_ENV: 'production' };
  const sessionCookie = sessionMiddleware.serializeClientSessionCookie('opaque', { env, maxAgeSeconds: 3600 });
  const authCookie = sessionMiddleware.serializeClientAuthCookie('challenge', { env, maxAgeSeconds: 600 });
  assert.match(sessionCookie, /^__Host-shiloh_client_session=opaque;/);
  assert.match(authCookie, /^__Host-shiloh_client_auth=challenge;/);
  for (const cookie of [sessionCookie, authCookie]) {
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Strict/);
    assert.doesNotMatch(cookie, /Domain=/);
  }
  assert.doesNotMatch(sessionCookie, /shiloh_staff_session/);
});

test('client auth tokens are opaque, bounded and first-name presentation is minimal', () => {
  const token = sessionService.randomOpaqueToken(() => Buffer.alloc(32, 7));
  assert.equal(token.length, 43);
  assert.equal(sessionService.isValidOpaqueToken(token), true);
  assert.equal(sessionService.isValidOpaqueToken('too-short'), false);
  const code = sessionService.randomCompletionCode(() => Buffer.from([0, 0, 0, 42]));
  assert.equal(code, '000042');
  assert.equal(sessionService.isValidCompletionCode(code), true);
  assert.equal(sessionService.isValidCompletionCode('12 34'), false);
  assert.equal(sessionService.firstName('Christel Botha'), 'Christel');
});

test('WhatsApp sign-in middleware only captures the exact My Shiloh contract', () => {
  const token = 'A'.repeat(43);
  assert.equal(
    whatsappMiddleware.extractMyShilohLoginToken({ type: 'text', text: { body: `MY SHILOH SIGN IN ${token}` } }),
    token,
  );
  assert.equal(
    whatsappMiddleware.extractMyShilohLoginToken({ type: 'text', text: { body: `hello ${token}` } }),
    null,
  );
  assert.equal(
    whatsappMiddleware.extractMyShilohLoginToken({ type: 'interactive' }),
    null,
  );
});

test('migration creates dedicated client auth tables with CRM V2 ownership only', () => {
  const sql = read('migrations/136_my_shiloh_client_browser_sessions.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS client_browser_auth_challenges/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS client_browser_sessions/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS client_auth_security_events/);
  assert.match(sql, /REFERENCES crm_v2_clients\(id\)/);
  assert.match(sql, /browser_token_hash TEXT NOT NULL UNIQUE/);
  assert.match(sql, /whatsapp_token_hash TEXT NOT NULL UNIQUE/);
  assert.match(sql, /completion_code_hash TEXT UNIQUE/);
  assert.match(sql, /completion_attempts INTEGER NOT NULL DEFAULT 0/);
  assert.match(sql, /csrf_hash TEXT NOT NULL/);
  assert.doesNotMatch(sql, /staff_admin_accounts|staff_browser_sessions|ADMIN_API_KEY/i);
});

test('client session service exact-resolves through CRM V2 and never staff/Admin authority', () => {
  const source = read('src/services/clientBrowserSession.js');
  assert.match(source, /recordVerifiedWhatsAppInteraction/);
  assert.match(source, /FROM crm_v2_clients/);
  assert.match(source, /client_browser_sessions/);
  assert.match(source, /client_browser_auth_challenges/);
  assert.doesNotMatch(source, /staff_admin_accounts|staff_browser_sessions|ADMIN_API_KEY|x-admin-key/i);
});

test('My Shiloh route uses same-origin, client-only session and CSRF controls', () => {
  const source = read('src/routes/myShiloh.js');
  assert.match(source, /sameOriginGuard/);
  assert.match(source, /requireClientSession/);
  assert.match(source, /clientCsrfGuard/);
  assert.match(source, /serializeClientSessionCookie/);
  assert.match(source, /serializeClientAuthCookie/);
  assert.match(source, /\/my-shiloh\/auth\/start/);
  assert.match(source, /\/my-shiloh\/auth\/complete/);
  assert.match(source, /\/my-shiloh\/auth\/status/);
  assert.match(source, /\/my-shiloh\/auth\/logout/);
  assert.doesNotMatch(source, /requireStaffSession|ADMIN_API_KEY|x-admin-key/i);
});

test('WhatsApp verification returns to the originating My Shiloh context with a code fallback', () => {
  const source = read('src/middleware/myShilohWhatsAppAuth.js');
  assert.match(source, /Switch back to the My Shiloh app you opened from your Home Screen/);
  assert.match(source, /WhatsApp cannot reopen it for you/);
  assert.match(source, /finish signing you in automatically/);
  assert.match(source, /one-time code there/);
  assert.doesNotMatch(source, /app or browser screen/);
  assert.doesNotMatch(source, /#verify=|myShilohCompletionUrl/);
});

test('webhook gives My Shiloh verification an isolated pre-controller boundary', () => {
  const source = read('src/routes/webhook.js');
  const routeBlock = source.slice(source.indexOf('router.post('));
  const statusIndex = routeBlock.indexOf('processWhatsAppStatusWebhook');
  const myShilohIndex = routeBlock.indexOf('myShilohWhatsAppAuthMiddleware');
  const staffBootstrapIndex = routeBlock.indexOf('staffWhatsAppPasskeyBootstrapMiddleware');
  const receiveIndex = routeBlock.indexOf('receiveWebhook');
  assert.ok(statusIndex >= 0);
  assert.ok(myShilohIndex > statusIndex);
  assert.ok(staffBootstrapIndex > myShilohIndex);
  assert.ok(receiveIndex > staffBootstrapIndex);
});

test('PWA service worker keeps all authentication and future personal APIs network-only', () => {
  const source = read('public/my-shiloh/sw.js');
  assert.match(source, /\/my-shiloh\/auth\//);
  assert.match(source, /\/my-shiloh\/api\//);
  assert.doesNotMatch(source, /cache\.put\([^\n]*auth/);
});

test('guest and authenticated My Shiloh renders are distinct without server-rendering private profile values', () => {
  const guest = renderMyShilohPage({ whatsappNumber: '27830000000', catalogue: [] });
  assert.match(guest, /Continue with WhatsApp/);
  assert.match(guest, /Need another way\?/);
  assert.match(guest, /Enter your 6-digit fallback code/);
  assert.match(guest, /Open My Shiloh/);
  assert.doesNotMatch(guest, /canonical CRM|client context|staff\/Admin authority|PWA cache|booking authority|Revocable/i);
  assert.match(guest, /data-client-authenticated="false"/);
  const signed = renderMyShilohPage({
    whatsappNumber: '27830000000',
    catalogue: [],
    client: { id: '912', name: 'Christel Botha', firstName: 'Christel' },
    now: new Date('2026-09-18T18:00:00.000Z'),
  });
  assert.match(signed, /Good evening, Christel/);
  assert.match(signed, /data-client-authenticated="true"/);
  assert.match(signed, /Your personal Shiloh space is open and ready/);
  assert.doesNotMatch(signed, /canonical CRM|client context|staff\/Admin authority|PWA cache|booking authority|Revocable/i);
  assert.match(signed, /Sign out/);
  assert.doesNotMatch(signed, /normalized_mobile|date_of_birth|health answer|1990-05-14/i);
});

test('returning from WhatsApp auto-completes in the original context with a usable code fallback', () => {
  const client = read('public/my-shiloh/assets/app.js');
  const styles = read('public/my-shiloh/assets/app.css');
  assert.match(client, /whatsappHandoffStarted = true;[\s\S]*openWhatsAppDirect\(whatsappAppUrl, whatsappFallbackUrl\)/);
  assert.match(client, /postJson\('\/my-shiloh\/auth\/status'\)/);
  assert.match(client, /data\.authenticated === true[\s\S]*window\.location\.replace\('\/my-shiloh\/'\)/);
  assert.match(client, /window\.setTimeout\(welcomeBackFromWhatsApp, 1500\);[\s\S]*openWhatsAppDirect\(whatsappAppUrl, whatsappFallbackUrl\)/);
  assert.match(client, /data\.whatsappAppUrl \|\| data\.whatsappUrl/);
  assert.match(client, /data\.whatsappFallbackUrl \|\| data\.whatsappUrl/);
  assert.match(client, /dataset\.whatsappDirect = 'true'/);
  assert.match(client, /window\.setTimeout\([\s\S]*window\.location\.href = fallback[\s\S]*1800\)/);
  assert.match(client, /pagehide[\s\S]*markExternalOpened/);
  assert.match(client, /visibilitychange/);
  assert.match(client, /addEventListener\('focus', welcomeBackFromWhatsApp\)/);
  assert.match(client, /authStatusCheckInFlight = false/);
  assert.match(client, /Checking your WhatsApp verification/);
  assert.match(client, /open automatically/);
  assert.match(client, /updateViaCache: 'none'/);
  assert.match(client, /INSTALL_VERIFIED_KEY = 'my-shiloh-install-whatsapp-verified-v1'/);
  assert.match(client, /localStorage\.setItem\(INSTALL_VERIFIED_KEY, '1'\)/);
  assert.doesNotMatch(client, /sessionStorage|indexedDB/);
  assert.match(styles, /\.auth-code-form\.is-waiting/);
  assert.match(styles, /\.assistant-chat__messages\{display:grid;gap:10px;padding:4px 2px 10px\}/);
  assert.doesNotMatch(styles, /\.assistant-chat__messages\{[^}]*overflow-y:auto/);
  assert.doesNotMatch(styles, /\.assistant-chat__messages\{[^}]*max-height/);
});


test('every normal browser is an installation doorway while standalone mode keeps client authority unchanged', () => {
  const presentation = read('src/presentation/myShilohPwa.js');
  const client = read('public/my-shiloh/assets/app.js');
  const styles = read('public/my-shiloh/assets/app.css');

  assert.match(presentation, /data-install-gate/);
  assert.match(presentation, /Keep My Shiloh one tap away/);
  assert.match(presentation, /Already installed\? Open My Shiloh from your Home Screen/);
  assert.match(presentation, /data-install-verification-gate/);
  assert.match(presentation, /Confirm it’s you to finish setting up My Shiloh/);
  assert.match(presentation, /data-client-auth-start>Verify with WhatsApp<\/button>/);
  assert.match(presentation, /data-app-frame[^>]*hidden/);
  assert.match(client, /function browserNeedsInstall\(\)/);
  assert.match(client, /return !standalone\(\)/);
  assert.match(client, /function installationVerificationRequired\(\)/);
  assert.match(client, /INSTALL_VERIFIED_KEY = 'my-shiloh-install-whatsapp-verified-v1'/);
  assert.match(client, /appFrame\.hidden = browserGated \|\| verificationGated/);
  assert.doesNotMatch(presentation, /data-install-gate-instructions/);
  assert.doesNotMatch(client, /On iPhone: tap Share, choose Add to Home Screen, then tap Add/);
  assert.match(presentation, /data-install-gate-action>Install My Shiloh<\/button>/);
  assert.match(client, /deferredInstallPrompt && isAndroid\(\)/);
  assert.match(client, /Show iPhone steps/);
  assert.match(client, /function isIosChrome\(\)/);
  assert.match(client, /You’re in Chrome\. Use Share to add My Shiloh to your Home Screen\./);
  assert.match(client, /function shareIcon\(\)/);
  assert.match(client, /install-share-icon/);
  assert.match(client, /Tap Share/);
  assert.match(client, /Choose Add to Home Screen/);
  assert.match(client, /Open as Web App, then tap Add/);
  assert.match(client, /appinstalled[\s\S]*resetInstallationVerification\(\)/);
  assert.match(client, /if \(!standalone\(\) \|\| installationVerificationRequired\(\) \|\| appFrame\?\.dataset\.clientAuthenticated !== 'true'/);
  assert.match(client, /function welcomeBackFromWhatsApp\(\) \{[\s\S]*installationVerificationRequired\(\)/);
  assert.doesNotMatch(client, /document\.cookie|sessionStorage|indexedDB/);
  assert.match(styles, /\.install-gate\{/);
});


test('My Shiloh is the canonical installed-app display name', () => {
  const manifest = JSON.parse(read('public/my-shiloh/manifest.webmanifest'));
  const presentation = read('src/presentation/myShilohPwa.js');
  assert.equal(manifest.name, 'My Shiloh');
  assert.equal(manifest.short_name, 'My Shiloh');
  assert.match(presentation, /apple-mobile-web-app-title" content="My Shiloh"/);
  assert.match(presentation, /data-install-trigger hidden>Install My Shiloh<\/button>/);
});

test('first installed-app launch uses only a non-sensitive convenience marker and WhatsApp remains authority', () => {
  const client = read('public/my-shiloh/assets/app.js');
  const presentation = read('src/presentation/myShilohPwa.js');

  assert.match(client, /INSTALL_VERIFIED_KEY = 'my-shiloh-install-whatsapp-verified-v1'/);
  const writes = [...client.matchAll(/localStorage\.setItem\(([^,]+),\s*([^\)]+)\)/g)]
    .map((match) => [match[1].trim(), match[2].trim()]);
  assert.deepEqual(writes, [["INSTALL_VERIFIED_KEY", "'1'"]]);
  assert.match(client, /markInstallationVerified\(\)[\s\S]*window\.location\.replace\('\/my-shiloh\/'\)/);
  assert.match(client, /resetInstallationVerification\(\)/);
  assert.doesNotMatch(client, /localStorage\.setItem\([^\n]*(?:token|client|mobile|name|voucher|csrf|session)/i);
  assert.doesNotMatch(client, /sessionStorage|indexedDB|document\.cookie/i);
  assert.match(presentation, /Verify with WhatsApp once on this installation/);
});


test('My Shiloh WhatsApp auth handoff prefers the installed app and keeps wa.me only as fallback', () => {
  const token = 'A'.repeat(43);
  const handoff = defaultAuthUrlBuilder('+27 83 000 0000', token);
  assert.deepEqual(handoff, {
    appUrl: `whatsapp://send?phone=27830000000&text=${encodeURIComponent(`MY SHILOH SIGN IN ${token}`)}`,
    fallbackUrl: `https://wa.me/27830000000?text=${encodeURIComponent(`MY SHILOH SIGN IN ${token}`)}`,
  });
  assert.deepEqual(normalizeAuthHandoff('/fake-whatsapp'), {
    appUrl: '/fake-whatsapp',
    fallbackUrl: '/fake-whatsapp',
  });
  assert.equal(normalizeAuthHandoff(null), null);
});
