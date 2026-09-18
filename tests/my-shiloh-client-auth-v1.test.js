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
  assert.match(source, /\/my-shiloh\/auth\/status/);
  assert.match(source, /\/my-shiloh\/auth\/logout/);
  assert.doesNotMatch(source, /requireStaffSession|ADMIN_API_KEY|x-admin-key/i);
});

test('webhook gives My Shiloh verification an isolated pre-controller boundary', () => {
  const source = read('src/routes/webhook.js');
  const myShilohIndex = source.indexOf('myShilohWhatsAppAuthMiddleware');
  const receiveIndex = source.indexOf('receiveWebhook');
  assert.ok(myShilohIndex >= 0);
  assert.ok(receiveIndex >= 0);
  assert.match(source, /router\.post\("\/webhook",[\s\S]*myShilohWhatsAppAuthMiddleware[\s\S]*receiveWebhook/);
});

test('PWA service worker keeps all authentication and future personal APIs network-only', () => {
  const source = read('public/my-shiloh/sw.js');
  assert.match(source, /\/my-shiloh\/auth\//);
  assert.match(source, /\/my-shiloh\/api\//);
  assert.doesNotMatch(source, /cache\.put\([^\n]*auth/);
});

test('guest and authenticated My Shiloh renders are clearly distinct without exposing phone or health data', () => {
  const guest = renderMyShilohPage({ whatsappNumber: '27830000000', catalogue: [] });
  assert.match(guest, /Continue with WhatsApp/);
  assert.match(guest, /data-client-authenticated="false"/);
  const signed = renderMyShilohPage({
    whatsappNumber: '27830000000',
    catalogue: [],
    client: { id: '912', name: 'Christel Botha', firstName: 'Christel' },
    now: new Date('2026-09-18T18:00:00.000Z'),
  });
  assert.match(signed, /Good evening, Christel/);
  assert.match(signed, /data-client-authenticated="true"/);
  assert.match(signed, /Signed in securely via WhatsApp/);
  assert.match(signed, /Sign out/);
  assert.doesNotMatch(signed, /27830000000/);
  assert.doesNotMatch(signed, /normalized_mobile|date_of_birth|gender|health answer/i);
});
