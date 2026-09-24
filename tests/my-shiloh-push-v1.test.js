'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  validEndpoint,
  isUnsafeNetworkAddress,
  boundedPushTimeoutMs,
  resolveSafePushEndpoint,
  createPinnedLookup,
  parseVapid,
  vapidAuthorization,
} = require('../src/services/myShilohPush');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function vapidFixture() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.alloc(32, 7));
  return {
    MY_SHILOH_VAPID_PUBLIC_KEY: ecdh.getPublicKey(null, 'uncompressed').toString('base64url'),
    MY_SHILOH_VAPID_PRIVATE_KEY: ecdh.getPrivateKey().toString('base64url'),
    MY_SHILOH_VAPID_SUBJECT: 'mailto:notifications@example.test',
  };
}

test('My Shiloh VAPID authorization is bounded to the push-service origin', () => {
  const env = vapidFixture();
  const vapid = parseVapid(env);
  assert.equal(vapid.publicKey, env.MY_SHILOH_VAPID_PUBLIC_KEY);
  const authorization = vapidAuthorization(
    'https://push.example.test/send/device-id',
    vapid,
    () => new Date('2026-09-23T06:00:00.000Z'),
  );
  assert.match(authorization, /^vapid t=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+, k=[A-Za-z0-9_-]+$/);
  const token = authorization.match(/^vapid t=([^,]+)/)[1];
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  assert.equal(payload.aud, 'https://push.example.test');
  assert.equal(payload.sub, 'mailto:notifications@example.test');
});

test('push endpoints reject local, literal-IP, credentialed and non-standard-port destinations', () => {
  assert.equal(validEndpoint('https://push.example.test/send/device-id'), 'https://push.example.test/send/device-id');
  assert.equal(validEndpoint('http://push.example.test/send/device-id'), null);
  assert.equal(validEndpoint('https://localhost/send/device-id'), null);
  assert.equal(validEndpoint('https://127.0.0.1/send/device-id'), null);
  assert.equal(validEndpoint('https://user:pass@push.example.test/send/device-id'), null);
  assert.equal(validEndpoint('https://push.example.test:8443/send/device-id'), null);
});

test('push endpoint resolution rejects private or mixed network destinations before any request', async () => {
  await assert.rejects(
    resolveSafePushEndpoint('https://push.example.test/send/device-id', async () => [{ address: '10.0.0.8', family: 4 }]),
    error => error.code === 'PUSH_ENDPOINT_UNSAFE',
  );
  await assert.rejects(
    resolveSafePushEndpoint('https://push.example.test/send/device-id', async () => [
      { address: '142.250.74.78', family: 4 },
      { address: '192.168.1.8', family: 4 },
    ]),
    error => error.code === 'PUSH_ENDPOINT_UNSAFE',
  );
  const resolved = await resolveSafePushEndpoint(
    'https://push.example.test/send/device-id',
    async () => [{ address: '142.250.74.78', family: 4 }],
  );
  assert.equal(resolved.address, '142.250.74.78');
  assert.equal(resolved.family, 4);
});

test('pinned push lookup supports Node 24 single-address and all-address lookup shapes', async () => {
  const lookup = createPinnedLookup('142.250.74.78', 4);
  await new Promise((resolve, reject) => {
    lookup('push.example.test', { all: true }, (error, addresses) => {
      if (error) return reject(error);
      assert.deepEqual(addresses, [{ address: '142.250.74.78', family: 4 }]);
      resolve();
    });
  });
  await new Promise((resolve, reject) => {
    lookup('push.example.test', { all: false }, (error, address, family) => {
      if (error) return reject(error);
      assert.equal(address, '142.250.74.78');
      assert.equal(family, 4);
      resolve();
    });
  });
});

test('push network safeguards cover private IPv4 and IPv6 ranges and bound request time', () => {
  for (const address of ['10.0.0.1', '127.0.0.1', '169.254.1.1', '172.16.0.1', '192.168.1.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isUnsafeNetworkAddress(address), true, address);
  }
  assert.equal(isUnsafeNetworkAddress('142.250.74.78'), false);
  assert.equal(isUnsafeNetworkAddress('2607:f8b0:4006:81a::200e'), false);
  assert.equal(boundedPushTimeoutMs({ MY_SHILOH_PUSH_TIMEOUT_MS: '100' }), 1000);
  assert.equal(boundedPushTimeoutMs({ MY_SHILOH_PUSH_TIMEOUT_MS: '5000' }), 5000);
  assert.equal(boundedPushTimeoutMs({ MY_SHILOH_PUSH_TIMEOUT_MS: '60000' }), 15000);
  assert.equal(boundedPushTimeoutMs({ MY_SHILOH_PUSH_TIMEOUT_MS: 'not-a-number' }), 5000);
});

test('push schema is client-bound delivery state, not a second business authority', () => {
  const migration = read('migrations/149_my_shiloh_push_notifications.sql');
  assert.match(migration, /REFERENCES crm_v2_clients\(id\) ON DELETE RESTRICT/);
  assert.match(migration, /my_shiloh_push_subscriptions/);
  assert.match(migration, /my_shiloh_push_notifications/);
  assert.match(migration, /category IN \('appointment','forms','payment','voucher','rewards','system'\)/);
  assert.doesNotMatch(migration, /marketing|promotional|client_name|mobile_number|appointment_status|payment_state/i);
});

test('push subscription routes stay behind the verified My Shiloh session and CSRF boundary', () => {
  const route = read('src/routes/myShiloh.js');
  assert.match(route, /router\.get\('\/my-shiloh\/api\/push\/config', requireSession/);
  assert.match(route, /router\.post\('\/my-shiloh\/api\/push\/subscribe', sameOrigin, requireSession, requireCsrf/);
  assert.match(route, /router\.post\('\/my-shiloh\/api\/push\/unsubscribe', sameOrigin, requireSession, requireCsrf/);
  assert.match(route, /router\.post\('\/my-shiloh\/api\/push\/pending', requireSession/);
  assert.doesNotMatch(route, /req\.(?:body|query).*crmV2ClientId/);
});

test('notification permission is requested only after the client taps the notification control', () => {
  const app = read('public/my-shiloh/assets/app.js');
  const presentation = read('src/presentation/myShilohPwa.js');
  assert.match(presentation, /data-push-toggle/);
  assert.match(presentation, /Operational updates only/);
  assert.match(app, /pushToggle\?\.addEventListener\('click'/);
  assert.match(app, /async function enablePushNotifications\(\)[\s\S]*Notification\.requestPermission\(\)/);
  assert.equal((app.match(/Notification\.requestPermission\(\)/g) || []).length, 1);
  assert.doesNotMatch(presentation, /marketing notifications|promotional notifications/i);
});

test('service worker waits for client approval before applying an update', () => {
  const worker = read('public/my-shiloh/sw.js');
  const app = read('public/my-shiloh/assets/app.js');
  const presentation = read('src/presentation/myShilohPwa.js');
  assert.match(worker, /message[\s\S]*SKIP_WAITING[\s\S]*self\.skipWaiting\(\)/);
  const installBlock = worker.match(/self\.addEventListener\('install',[\s\S]*?\n\}\);/)?.[0] || '';
  assert.match(installBlock, /cache\.addAll\(SHELL\)/);
  assert.doesNotMatch(installBlock, /skipWaiting/);
  assert.match(app, /registration\.waiting\.postMessage\(\{ type: 'SKIP_WAITING' \}\)/);
  assert.match(app, /controllerchange[\s\S]*window\.location\.reload\(\)/);
  assert.match(presentation, /A new My Shiloh update is ready/);
  assert.match(presentation, /data-app-update-action>Update now/);
});

test('service worker handles push privately and opens only My Shiloh notification targets', () => {
  const worker = read('public/my-shiloh/sw.js');
  assert.match(worker, /addEventListener\('push'/);
  assert.match(worker, /\/my-shiloh\/api\/push\/pending/);
  assert.match(worker, /registration\.showNotification/);
  assert.match(worker, /addEventListener\('notificationclick'/);
  assert.match(worker, /clients\.openWindow\(target\)/);
  assert.doesNotMatch(worker, /pushEvent\.data|event\.data\.json|event\.data\.text/);
});

test('canonical Shiloh events fan out to push without replacing their existing authority', () => {
  const appointment = read('src/services/appointmentLifecycle.js');
  const forms = read('src/services/consultationFormDelivery.js');
  const payments = read('src/services/bookingPayments.js');
  const rewards = read('src/services/shilohRewards.js');
  assert.match(appointment, /Customer appointment reminder sent/);
  assert.match(appointment, /category: 'appointment'/);
  assert.match(forms, /consultation_form\.sent/);
  assert.match(forms, /category: 'forms'/);
  assert.match(payments, /PAYMENT_TEMPLATE_KEYS\.RECEIVED/);
  assert.match(payments, /category: 'payment'/);
  assert.match(payments, /category: 'voucher'/);
  assert.match(rewards, /loyalty_wallet_entries/);
  assert.match(rewards, /category:'rewards'/);
});
