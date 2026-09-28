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
  assert.doesNotMatch(html, /class="topbar"|brand-mark--header|brand-copy/);
  assert.match(html, /data-view-target="shiloh"/);
  assert.doesNotMatch(html, /class="brand-logo"/);
  assert.match(html, /data-view-target="home"/);
  assert.match(html, /data-view-target="bookings"/);
  assert.match(html, /data-view-target="shiloh"/);
  assert.match(html, /data-view-target="wallet"/);
  assert.match(html, /data-view-target="profile"/);
  for (const icon of ['home', 'calendar', 'wallet', 'person']) {
    assert.match(html, new RegExp(`data-shiloh-icon="${icon}"`));
  }
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
  assert.match(html, /welcome drink on arrival.*coffee bar.*variety of teas/);
  assert.match(html, /data-client-experience-primary href="\/my-shiloh\/book"/);
  assert.match(html, /data-client-notification-centre hidden/);
  assert.match(html, /data-profile-help/);
  assert.match(html, /href="#profile-notifications">Set up notifications/);
  assert.doesNotMatch(html, /onclick=/i);
});

test('Home choosing help opens in-app Shiloh for clients and keeps guest and Reception paths honest', () => {
  const guest = renderMyShilohPage({ whatsappNumber:'27830000000' });
  const client = { id:'912', name:'Christel Botha', firstName:'Christel' };
  const signed = renderMyShilohPage({ whatsappNumber:'27830000000', client });
  const reception = renderMyShilohPage({
    whatsappNumber:'27830000000', humanWhatsAppNumber:'0662399138',
    humanHandoffActive:true, client,
  });
  const card = (html) => html.match(/<section class="quiet-card">\s*<div class="quiet-icon"[^>]*>S<\/div>[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(card(signed), /chat here in My Shiloh/);
  assert.match(card(signed), /href="#shiloh" aria-label="Open Shiloh in My Shiloh"/);
  assert.doesNotMatch(card(signed), /wa\.me|WhatsApp/);
  assert.match(card(reception), /Reception is helping you/);
  assert.match(card(reception), /href="#shiloh" aria-label="Open Shiloh in My Shiloh"/);
  assert.match(reception, /Reception is handling your request/);
  assert.match(card(guest), /Sign in for personal help inside My Shiloh/);
  assert.match(card(guest), /href="https:\/\/wa\.me\/27830000000\?text=/);
});

test('Bookings help stays in My Shiloh for clients and names the guest and Reception boundaries', () => {
  const client = { id:'912', name:'Christel Botha', firstName:'Christel' };
  const signed = renderMyShilohPage({ whatsappNumber:'27830000000', client });
  const guest = renderMyShilohPage({ whatsappNumber:'27830000000' });
  const reception = renderMyShilohPage({
    whatsappNumber:'27830000000', humanWhatsAppNumber:'0662399138',
    humanHandoffActive:true, client,
  });
  const bookings = (html) => html.match(/<section class="view" id="bookings"[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(bookings(signed), /Ask Shiloh here to help/);
  assert.match(bookings(signed), /href="#shiloh">Ask Shiloh<\/a>/);
  assert.doesNotMatch(bookings(signed), /wa\.me/);
  assert.match(bookings(guest), /href="https:\/\/wa\.me\/[^"]+" rel="noopener noreferrer">Ask Shiloh on WhatsApp/);
  assert.match(bookings(reception), /href="https:\/\/wa\.me\/27662399138[^"]*" rel="noopener noreferrer">Ask Reception/);
});

test('My Shiloh uses WhatsApp only as an explicit client handoff in the guest shell', () => {
  const url = whatsappUrl('+27 83 000 0000', 'Hello Shiloh');
  assert.equal(url, 'https://wa.me/27830000000?text=Hello%20Shiloh');
  assert.equal(whatsappUrl(null), '/contact');
  const html = renderMyShilohPage({ whatsappNumber: '27830000000', catalogue: [] });
  assert.match(html, /https:\/\/wa\.me\/27830000000\?text=/);
  assert.match(html, /Sign in to book/);
});

test('My Shiloh route is no-store, no-index and mounted without reusing staff authentication', () => {
  const route = read('src/routes/myShiloh.js');
  const app = read('app.js');
  assert.match(route, /Cache-Control', 'private, no-store, max-age=0'/);
  assert.match(route, /\['app\.css', 'app\.js', 'booking\.js', 'planning-request\.js'\][\s\S]*Cache-Control', 'public, max-age=0, must-revalidate'/);
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
  assert.match(html, /Good morning, <span>Jean-Pierre\.<\/span>/);
  assert.match(html, /data-push-invite hidden/);
  assert.match(html, /profile-auth-card__identity/);
  assert.match(read('public/my-shiloh/assets/app.css'), /\.hero-greeting span\{[^}]*overflow-wrap:anywhere/);
  assert.match(read('public/my-shiloh/assets/app.css'), /\.profile-auth-card strong\{overflow-wrap:anywhere\}/);
});

test('My Shiloh install client distinguishes iPhone Safari, iPhone Chrome and Android', () => {
  const client = read('public/my-shiloh/assets/app.js');
  const styles = read('public/my-shiloh/assets/app.css');
  assert.match(client, /function isIosChrome\(\)/);
  assert.match(client, /function isIosSafari\(\)/);
  assert.match(client, /function isIosGoogleApp\(\)/);
  assert.match(client, /Open My Shiloh in Safari before adding it to your Home Screen/);
  assert.match(client, /share\.google, do not add that link/);
  assert.match(client, /crios\|fxios\|edgios\|opios/i);
  assert.match(client, /You’re in Chrome\. Use Share to add My Shiloh to your Home Screen\./);
  assert.match(client, /You can add My Shiloh straight from Chrome/);
  assert.match(client, /deferredInstallPrompt \? 'Install My Shiloh' : 'Show Android steps'/);
  assert.match(styles, /max-height:calc\(100dvh - 12px\)/);
});

test('an authenticated installation uses its server session without another verification gate', () => {
  const html = renderMyShilohPage({ whatsappNumber: '27830000000', passkeysAvailable: true });
  const client = read('public/my-shiloh/assets/app.js');
  assert.doesNotMatch(html, /data-install-verification-gate/);
  assert.match(client, /appFrame\.hidden = browserGated/);
  assert.doesNotMatch(client, /INSTALL_VERIFIED_KEY|installationVerificationRequired/);
  assert.match(client, /finish\.status === 401[\s\S]*request a mobile code first, then save one under Profile/);
});

test('the browser install doorway leaves sign-in inside the installed app', () => {
  const html = renderMyShilohPage({ passkeysAvailable: true });
  const installDoorway = html.match(/<main class="install-gate" data-install-gate[\s\S]*?<\/main>/)?.[0] || '';
  assert.doesNotMatch(installDoorway, /data-passkey-sign-in|data-passkey-recovery-form|data-client-sms-start/);
  assert.match(installDoorway, /Open the My Shiloh icon · Sign in there/);
  assert.match(html, /data-passkey-sign-in/);
  const signedIn = renderMyShilohPage({ passkeysAvailable: true, client: { id: 1, name:'Christel', firstName:'Christel' } });
  const signedInDoorway = signedIn.match(/<main class="install-gate" data-install-gate[\s\S]*?<\/main>/)?.[0] || '';
  assert.doesNotMatch(signedInDoorway, /data-passkey-sign-in/);
});

test('SMS enrollment appears in the installed guest app only when enabled', () => {
  const inactive = renderMyShilohPage({ passkeysAvailable: true, smsAvailable: false });
  assert.doesNotMatch(inactive, /data-client-sms-start/);
  const page = renderMyShilohPage({ passkeysAvailable: true, smsAvailable: true });
  const doorway = page.match(/<main class="install-gate" data-install-gate[\s\S]*?<\/main>/)?.[0] || '';
  assert.doesNotMatch(doorway, /data-passkey-sign-in|data-client-sms-start|data-client-sms-complete/);
  assert.match(page, /data-client-sms-start/);
  assert.match(page, /data-client-sms-complete hidden/);
  assert.match(page, /6-digit code/);
  assert.doesNotMatch(page, /Use WhatsApp temporarily|Open WhatsApp to verify|use WhatsApp|Verified with WhatsApp|data-client-auth-code-disclosure/);
  const signedIn = renderMyShilohPage({ smsAvailable: true, client: { id: 1, name: 'Christel', firstName: 'Christel' } });
  assert.doesNotMatch(signedIn, /data-client-sms-start/);
});

test('service worker caches the shell only and leaves authentication and personal APIs network-only', () => {
  const worker = read('public/my-shiloh/sw.js');
  assert.match(worker, /my-shiloh-shell-v34/);
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
