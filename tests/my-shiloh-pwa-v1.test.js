const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  renderMyShilohPage,
  whatsappUrl,
  johannesburgGreeting,
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

test('My Shiloh renders the approved five-tab PWA shell with public-safe service data', () => {
  const html = renderMyShilohPage({ whatsappNumber: '27830000000', catalogue });
  assert.match(html, /<title>My Shiloh<\/title>/);
  assert.match(html, /rel="manifest" href="\/my-shiloh\/manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="\/my-shiloh\/assets\/apple-touch-icon-180\.png/);
  assert.match(html, new RegExp(`app\\.css\\?v=${MY_SHILOH_ASSET_VERSION}`));
  assert.match(html, new RegExp(`app\\.js\\?v=${MY_SHILOH_ASSET_VERSION}`));
  assert.match(html, /brand-mark--header/);
  assert.match(html, /<strong>Shiloh<\/strong><small>My Shiloh<\/small>/);
  assert.doesNotMatch(html, /class="brand-logo"/);
  assert.match(html, /data-view-target="home"/);
  assert.match(html, /data-view-target="bookings"/);
  assert.match(html, /data-view-target="shiloh"/);
  assert.match(html, /data-view-target="wallet"/);
  assert.match(html, /data-view-target="profile"/);
  assert.doesNotMatch(html, /data-notification-badge|nav-icon--badged/);
  assert.match(html, /id="wallet" data-view="wallet"/);
  assert.match(html, /Your Shiloh value, together/);
  assert.match(html, /Full Body Swedish/);
  assert.match(html, /R720/);
  assert.match(html, /Pedicures &amp; Foot Care/);
  assert.doesNotMatch(html, /Clinical therapeutic claim/);
  assert.doesNotMatch(html, /\btherapy\b/i);
  assert.doesNotMatch(html, /ADMIN_API_KEY|x-admin-key/i);
});

test('authenticated My Shiloh Home exposes tappable summary cards without duplicating authority', () => {
  const html = renderMyShilohPage({
    whatsappNumber: '27830000000',
    catalogue: [],
    client: { id: '912', name: 'Test Client', firstName: 'Test' },
  });
  assert.match(html, /data-client-experience-fact[^>]*data-fact-key="appointment"/);
  assert.match(html, /data-client-experience-fact[^>]*data-fact-key="forms"/);
  assert.match(html, /data-client-experience-fact[^>]*data-fact-key="payment"/);
  assert.match(html, /data-client-experience-fact-status/);
  assert.doesNotMatch(html, /onclick=/i);
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
  assert.match(route, /\['app\.css', 'app\.js', 'booking\.js'\][\s\S]*Cache-Control', 'public, max-age=0, must-revalidate'/);
  assert.match(route, /X-Robots-Tag', 'noindex, nofollow, noarchive'/);
  assert.match(route, /Content-Security-Policy/);
  assert.match(route, /getPublicServiceCatalogue/);
  assert.match(route, /resolveWhatsAppNumber/);
  assert.doesNotMatch(route, /ADMIN_API_KEY|x-admin-key|staffSession/i);
  assert.match(app, /myShilohRoutes/);
});

test('PWA manifest is standalone and scoped to My Shiloh', () => {
  const manifest = JSON.parse(read('public/my-shiloh/manifest.webmanifest'));
  assert.equal(manifest.name, 'My Shiloh');
  assert.equal(manifest.short_name, 'My Shiloh');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.scope, '/my-shiloh/');
  assert.equal(manifest.start_url, '/my-shiloh/');
  assert.equal(manifest.background_color, '#fffcf7');
  assert.ok(manifest.icons.some((icon) => icon.src === '/my-shiloh/assets/icon-192.png' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some((icon) => icon.src === '/my-shiloh/assets/icon-maskable-512.png' && icon.purpose === 'maskable'));
});

test('My Shiloh greeting uses Johannesburg time boundaries', () => {
  assert.equal(johannesburgGreeting(new Date('2026-09-26T04:41:00.000Z')), 'Good morning');
  assert.equal(johannesburgGreeting(new Date('2026-09-26T11:30:00.000Z')), 'Good afternoon');
  assert.equal(johannesburgGreeting(new Date('2026-09-26T17:30:00.000Z')), 'Good evening');

  const html = renderMyShilohPage({
    whatsappNumber: '27830000000',
    catalogue: [],
    client: { id:'912', name:'Jean-Pierre Botha', firstName:'Jean-Pierre' },
    now: new Date('2026-09-26T04:41:00.000Z'),
  });
  assert.match(html, /data-client-greeting/);
  assert.match(html, /data-first-name="Jean-Pierre"/);
  assert.match(html, /Good morning, Jean-Pierre\./);
});

test('My Shiloh install client distinguishes iPhone Safari, iPhone Chrome and Android', () => {
  const client = read('public/my-shiloh/assets/app.js');
  const styles = read('public/my-shiloh/assets/app.css');
  assert.match(client, /function isIosChrome\(\)/);
  assert.match(client, /function isIosSafari\(\)/);
  assert.match(client, /crios\|fxios\|edgios\|opios/i);
  assert.match(client, /You’re in Chrome\. Use Share to add My Shiloh to your Home Screen\./);
  assert.match(client, /You can add My Shiloh straight from Chrome/);
  assert.match(client, /deferredInstallPrompt \? 'Install My Shiloh' : 'Show Android steps'/);
  assert.match(styles, /max-height:calc\(100dvh - 12px\)/);
});

test('service worker caches the shell only and leaves authentication and personal APIs network-only', () => {
  const worker = read('public/my-shiloh/sw.js');
  assert.match(worker, /my-shiloh-shell-v24/);
  assert.match(worker, /app\.css\?v=\$\{ASSET_VERSION\}/);
  assert.match(worker, /app\.js\?v=\$\{ASSET_VERSION\}/);
  assert.match(worker, /booking\.js/);
  assert.match(worker, /url\.pathname === '\/my-shiloh\/assets\/app\.css'[\s\S]*booking\.js'[\s\S]*fetch\(request\)[\s\S]*catch\(\(\) => caches\.match\(request\)\)/);
  assert.match(worker, /\/my-shiloh\/auth\//);
  assert.match(worker, /\/my-shiloh\/api\//);
  assert.match(worker, /addEventListener\('push'/);
  assert.match(worker, /addEventListener\('notificationclick'/);
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


test('Wallet navigation keeps Shiloh in the exact centre and preserves welcome-voucher deep links', () => {
  const html = renderMyShilohPage({
    whatsappNumber: '27830000000',
    catalogue: [],
    client: { id:'912', name:'Test Client', firstName:'Test' },
  });
  assert.match(html, /Open your Shiloh voucher wallet/);
  assert.match(html, /View Shiloh Rewards/);
  assert.match(html, /Open booking payments/);
  const styles = read('public/my-shiloh/assets/app.css');
  const client = read('public/my-shiloh/assets/app.js');
  assert.match(styles, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.nav-shiloh\{position:relative;grid-column:3\}/);
  assert.match(client, /new Set\(\['home', 'bookings', 'shiloh', 'wallet', 'profile'\]\)/);
  assert.match(client, /fromHash === 'welcome-voucher'\) return 'wallet'/);
  assert.match(html, /href="#wallet" data-view-target="wallet"/);
});
