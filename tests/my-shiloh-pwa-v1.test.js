const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  renderMyShilohPage,
  whatsappUrl,
  MY_SHILOH_ASSET_VERSION,
} = require('../src/presentation/myShilohPwa');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const catalogue = [
  {
    id: 101,
    name: 'Full Body Swedish',
    category: 'Massage',
    duration: '60 min',
    price: 'R720',
    description: 'Clinical therapeutic claim must not render.',
  },
  {
    id: 202,
    name: 'Signature Pedicure',
    category: 'Pedicures & Foot Care',
    duration: '75 min',
    price: 'R620',
  },
];

test('My Shiloh renders the approved four-tab PWA shell with public-safe service data', () => {
  const html = renderMyShilohPage({ whatsappNumber: '27830000000', catalogue });
  assert.match(html, /<title>My Shiloh<\/title>/);
  assert.match(html, /rel="manifest" href="\/my-shiloh\/manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="\/my-shiloh\/assets\/apple-touch-icon-180\.png/);
  assert.match(html, new RegExp(`app\\.css\\?v=${MY_SHILOH_ASSET_VERSION}`));
  assert.match(html, new RegExp(`app\\.js\\?v=${MY_SHILOH_ASSET_VERSION}`));
  assert.match(html, /brand-mark--header/);
  assert.match(html, /<strong>Shiloh<\/strong><small>My Shiloh<\/small>/);
  assert.match(html, /data-install-gate/);
  assert.match(html, /Install My Shiloh to continue/);
  assert.match(html, /data-install-platform-intro/);
  assert.match(html, /data-install-trigger hidden>Install My Shiloh/);
  assert.match(html, /data-app-frame[^>]*hidden/);
  assert.doesNotMatch(html, /class="brand-logo"/);
  assert.match(html, /data-view-target="home"/);
  assert.match(html, /data-view-target="bookings"/);
  assert.match(html, /data-view-target="shiloh"/);
  assert.match(html, /data-view-target="profile"/);
  assert.match(html, /Full Body Swedish/);
  assert.match(html, /R720/);
  assert.match(html, /Pedicures &amp; Foot Care/);
  assert.doesNotMatch(html, /Clinical therapeutic claim/);
  assert.doesNotMatch(html, /\btherapy\b/i);
  assert.doesNotMatch(html, /ADMIN_API_KEY|x-admin-key/i);
});

test('My Shiloh uses WhatsApp only as an explicit client handoff in the guest shell', () => {
  const url = whatsappUrl('+27 83 000 0000', 'Hello Shiloh');
  assert.equal(url, 'https://wa.me/27830000000?text=Hello%20Shiloh');
  assert.equal(whatsappUrl(null), '/contact');
  const html = renderMyShilohPage({ whatsappNumber: '27830000000', catalogue: [] });
  assert.match(html, /https:\/\/wa\.me\/27830000000\?text=/);
  assert.match(html, /Book an appointment/);
});

test('My Shiloh route is no-store, no-index and mounted without reusing staff authentication', () => {
  const route = read('src/routes/myShiloh.js');
  const app = read('app.js');
  assert.match(route, /Cache-Control', 'private, no-store, max-age=0'/);
  assert.match(route, /\['app\.css', 'app\.js'\][\s\S]*Cache-Control', 'public, max-age=0, must-revalidate'/);
  assert.match(route, /X-Robots-Tag', 'noindex, nofollow, noarchive'/);
  assert.match(route, /Content-Security-Policy/);
  assert.match(route, /getPublicServiceCatalogue/);
  assert.match(route, /resolveWhatsAppNumber/);
  assert.match(route, /optionalSessionForAppLaunch/);
  assert.match(route, /req\.query\?\.launch !== 'app'/);
  assert.match(route, /req\.query\?\.launch === 'app' \? req\.myShilohClientSession\?\.client \|\| null : null/);
  assert.doesNotMatch(route, /ADMIN_API_KEY|x-admin-key|staffSession/i);
  assert.match(app, /myShilohRoutes/);
});

test('browser launch is install-only while standalone launch preserves the existing client app authority', () => {
  const client = read('public/my-shiloh/assets/app.js');
  assert.match(client, /matchMedia\?\.\('\(display-mode: standalone\)'\)/);
  assert.match(client, /window\.navigator\.standalone === true/);
  assert.match(client, /function appLaunchRequested\(\)/);
  assert.match(client, /searchParams\.get\('launch'\) === 'app'/);
  assert.match(client, /target\.searchParams\.set\('launch', 'app'\)/);
  assert.match(client, /window\.location\.replace/);
  assert.match(client, /document\.body\.dataset\.myShilohLaunch = installedLaunch \? 'app' : 'install'/);
  assert.match(client, /if \(installGate\) installGate\.hidden = installedLaunch/);
  assert.match(client, /if \(appFrame\) appFrame\.hidden = !installedLaunch/);
  assert.match(client, /if \(!installedLaunch\) return/);
  assert.match(client, /addEventListener\('beforeinstallprompt'/);
  assert.match(client, /!isAndroid\(\)/);
  assert.match(client, /Open as Web App/);
  assert.match(client, /Install app or Add to Home screen/);
  assert.match(client, /addEventListener\('appinstalled'/);
  assert.match(client, /Open the new My Shiloh icon to continue/);
  assert.match(client, /registerServiceWorker\(\)/);
});

test('PWA manifest is standalone and scoped to My Shiloh', () => {
  const manifest = JSON.parse(read('public/my-shiloh/manifest.webmanifest'));
  assert.equal(manifest.name, 'My Shiloh');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.scope, '/my-shiloh/');
  assert.equal(manifest.start_url, '/my-shiloh/?launch=app');
  assert.equal(manifest.background_color, '#fffcf7');
  assert.ok(manifest.icons.some((icon) => icon.src === '/my-shiloh/assets/icon-192.png' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some((icon) => icon.src === '/my-shiloh/assets/icon-maskable-512.png' && icon.purpose === 'maskable'));
});

test('service worker caches the shell only and leaves authentication and personal APIs network-only', () => {
  const worker = read('public/my-shiloh/sw.js');
  assert.match(worker, /my-shiloh-shell-v14/);
  assert.match(worker, /app\.css\?v=\$\{ASSET_VERSION\}/);
  assert.match(worker, /app\.js\?v=\$\{ASSET_VERSION\}/);
  assert.match(worker, /url\.pathname === '\/my-shiloh\/assets\/app\.css'[\s\S]*fetch\(request\)[\s\S]*catch\(\(\) => caches\.match\(request\)\)/);
  assert.match(worker, /\/my-shiloh\/auth\//);
  assert.match(worker, /\/my-shiloh\/api\//);
  assert.match(worker, /return;/);
  assert.doesNotMatch(worker, /cache\.put\(request, copy\)[\s\S]*api/);
  assert.match(worker, /request\.mode === 'navigate'/);
  assert.match(worker, /offline\.html/);
});

test('offline page explains privacy without technical wording', () => {
  const html = read('public/my-shiloh/offline.html');
  assert.match(html, /personal details are not shown while you’re offline/i);
  assert.doesNotMatch(html, /cache|offline shell|session|client data/i);
  assert.match(html, /Reconnect/);
});
