'use strict';

const {
  PUBLIC_BRAND_NAME,
  PUBLIC_TAGLINE,
  sanitizePublicCatalogue,
} = require('../services/publicPresentation');

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function whatsappUrl(number, message = 'Hi Shiloh, I am using My Shiloh and would like some help.') {
  const digits = String(number || '').replace(/[^0-9]/g, '');
  if (!digits) return '/contact';
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function serviceCards(catalogue = []) {
  const services = sanitizePublicCatalogue(catalogue).slice(0, 4);
  if (!services.length) {
    return '<article class="service-card service-card--empty"><span class="service-kicker">Services</span><h3>Explore what feels right.</h3><p>Our live service list is temporarily unavailable. Shiloh can still help you choose.</p><a class="text-link" href="/book">Open booking</a></article>';
  }

  return services
    .map((service) => `<article class="service-card">
      <span class="service-kicker">${escapeHtml(service.category || 'Service')}</span>
      <h3>${escapeHtml(service.name)}</h3>
      <div class="service-meta"><span>${escapeHtml(service.duration || '')}</span><strong>${escapeHtml(service.price || '')}</strong></div>
      <a class="service-link" href="/book">Book this service</a>
    </article>`)
    .join('');
}

function authFinishForm() {
  return `<form class="auth-code-form" data-client-auth-code-form>
    <label for="my-shiloh-code">Already verified in WhatsApp?</label>
    <div class="auth-code-row">
      <input id="my-shiloh-code" data-client-auth-code inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" placeholder="123 456" aria-label="One-time My Shiloh sign-in code">
      <button class="button button--soft" type="submit">Finish sign-in</button>
    </div>
  </form>`;
}

function johannesburgGreeting(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Johannesburg',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now));
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function renderMyShilohPage({
  whatsappNumber = null,
  catalogue = [],
  client = null,
  now = new Date(),
} = {}) {
  const askShiloh = whatsappUrl(whatsappNumber);
  const manageBooking = whatsappUrl(
    whatsappNumber,
    'Hi Shiloh, I am in My Shiloh and would like help with an appointment.',
  );
  const authenticated = Boolean(client?.id && client?.firstName);
  const greeting = authenticated ? johannesburgGreeting(now) : null;
  const clientName = authenticated ? escapeHtml(client.name || client.firstName) : '';
  const firstName = authenticated ? escapeHtml(client.firstName) : '';

  const hero = authenticated
    ? `<div class="hero">
        <p class="eyebrow">Welcome back</p>
        <h1 id="home-title">${escapeHtml(greeting)}, ${firstName}.</h1>
        <p class="hero-copy">You're securely signed in. Shiloh now uses your private client context to bring the right booking, form and payment information forward when you need it.</p>
        <div class="hero-actions">
          <a class="button button--primary" href="/book">Book an appointment</a>
          <a class="button button--soft" href="${escapeHtml(askShiloh)}" rel="noopener noreferrer">Ask Shiloh</a>
        </div>
      </div>`
    : `<div class="hero">
        <p class="eyebrow">Private client access</p>
        <h1 id="home-title">Your Shiloh, all in one place.</h1>
        <p class="hero-copy">Continue with WhatsApp to securely connect this device to your existing Shiloh client profile. No password or email address required.</p>
        <div class="hero-actions">
          <button class="button button--primary" type="button" data-client-auth-start>Continue with WhatsApp</button>
          <a class="button button--soft" href="/book">Book an appointment</a>
        </div>
        <div class="auth-status" data-auth-status role="status" aria-live="polite"></div>
        ${authFinishForm()}
      </div>`;

  const focus = authenticated
    ? `<section class="focus-card" aria-labelledby="next-visit-title" data-client-experience-home>
        <div class="focus-card__top">
          <div><p class="eyebrow">Your Shiloh</p><h2 id="next-visit-title">Bringing your next step into focus.</h2></div>
          <span class="status-pill">Secure</span>
        </div>
        <p>Shiloh is checking your authenticated booking, form and payment context now.</p>
        <div class="focus-grid" aria-label="My Shiloh client context">
          <div><span>Appointment</span><strong>Checking</strong></div>
          <div><span>Forms</span><strong>Checking</strong></div>
          <div><span>Payment</span><strong>Checking</strong></div>
        </div>
      </section>`
    : `<section class="focus-card" aria-labelledby="next-visit-title">
        <div class="focus-card__top">
          <div><p class="eyebrow">Secure sign-in</p><h2 id="next-visit-title">Sign in once. No password needed.</h2></div>
          <span class="status-pill">Private</span>
        </div>
        <p>My Shiloh sends a one-time sign-in request to WhatsApp. Shiloh verifies the sender number against the canonical CRM V2 client profile before this browser receives a private session.</p>
        <div class="focus-grid" aria-label="My Shiloh sign-in features">
          <div><span>Password</span><strong>None</strong></div>
          <div><span>Identity</span><strong>WhatsApp</strong></div>
          <div><span>Session</span><strong>Revocable</strong></div>
        </div>
      </section>`;

  const profile = authenticated
    ? `<div class="page-intro">
        <p class="eyebrow">Profile</p>
        <h1 id="profile-title">Your Shiloh, remembered.</h1>
        <p>Signed in securely via WhatsApp. Only the minimum identity needed for this screen is shown here.</p>
      </div>
      <div class="profile-auth-card">
        <div class="profile-avatar" aria-hidden="true">${firstName.charAt(0).toUpperCase()}</div>
        <div><span>Signed in as</span><strong>${clientName}</strong><small>Verified with WhatsApp</small></div>
      </div>
      <div class="profile-list" aria-label="Secure profile areas">
        <div><span>Personal details</span><strong>Coming next</strong></div>
        <div><span>Consultation forms</span><strong>When required</strong></div>
        <div><span>Packages &amp; vouchers</span><strong>Private</strong></div>
        <div><span>Receipts &amp; payments</span><strong>Private</strong></div>
      </div>
      <button class="button button--soft button--wide profile-signout" type="button" data-client-auth-logout>Sign out</button>
      <div class="auth-status" data-auth-status role="status" aria-live="polite"></div>`
    : `<div class="page-intro">
        <p class="eyebrow">Profile</p>
        <h1 id="profile-title">Your Shiloh, remembered.</h1>
        <p>Sign in with WhatsApp to connect My Shiloh to your existing client profile. Your phone number is verified by the WhatsApp sender itself — you never retype it here.</p>
      </div>
      <button class="button button--primary button--wide" type="button" data-client-auth-start>Continue with WhatsApp</button>
      <div class="auth-status" data-auth-status role="status" aria-live="polite"></div>
      ${authFinishForm()}
      <aside class="privacy-note">
        <span aria-hidden="true">✓</span>
        <div><strong>Privacy first.</strong><p>Client sessions are separate from staff/Admin authority, and personal responses are never written to the PWA cache.</p></div>
      </aside>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#465746">
  <meta name="color-scheme" content="light">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <meta name="description" content="My Shiloh is your calm client space for bookings, forms, payments and Shiloh support.">
  <meta name="application-name" content="My Shiloh">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="My Shiloh">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <link rel="manifest" href="/my-shiloh/manifest.webmanifest">
  <link rel="icon" href="/my-shiloh/assets/icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/my-shiloh/assets/icon.svg">
  <link rel="stylesheet" href="/my-shiloh/assets/app.css">
  <title>My Shiloh</title>
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to content</a>
  <div class="app-frame" data-app-frame data-client-authenticated="${authenticated ? 'true' : 'false'}">
    <header class="topbar">
      <a class="brand" href="#home" aria-label="My Shiloh home">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 44 44" role="img"><path d="M11 29c6-1 8-7 10-15 3 6 7 10 13 12-4 1-7 4-9 8-4-4-8-6-14-5Z"></path><path d="M20 14c-2 6-5 9-10 11"></path></svg>
        </span>
        <span><small>MY</small><strong>SHILOH</strong></span>
      </a>
      <button class="install-button" type="button" data-install-trigger hidden>Install app</button>
    </header>

    <div class="network-banner" data-offline-banner hidden role="status">You are offline. My Shiloh will reconnect automatically.</div>

    <main id="main-content" class="app-main">
      <section class="view is-active" id="home" data-view="home" aria-labelledby="home-title">
        ${hero}
        ${focus}
        <section class="section-block" aria-labelledby="discover-title">
          <div class="section-heading">
            <div><p class="eyebrow">Discover</p><h2 id="discover-title">Start with what you need.</h2></div>
            <a class="text-link" href="/treatments">See all services</a>
          </div>
          <div class="service-scroll">${serviceCards(catalogue)}</div>
        </section>
        <section class="quiet-card">
          <div class="quiet-icon" aria-hidden="true">S</div>
          <div><p class="eyebrow">Shiloh is close</p><h2>Need help choosing?</h2><p>Tell Shiloh what you feel like booking and continue the conversation on WhatsApp.</p></div>
          <a class="circle-link" href="${escapeHtml(askShiloh)}" aria-label="Ask Shiloh on WhatsApp" rel="noopener noreferrer">→</a>
        </section>
      </section>

      <section class="view" id="bookings" data-view="bookings" aria-labelledby="bookings-title" hidden>
        <div class="page-intro">
          <p class="eyebrow">Bookings</p>
          <h1 id="bookings-title">Your time with Shiloh.</h1>
          <p>${authenticated ? 'Shiloh keeps your booking view grounded in the same secure client context used on Home.' : 'Sign in securely to connect this area to your client profile. Booking and changes continue through Shiloh in the meantime.'}</p>
        </div>
        <div class="stack" data-client-experience-bookings>
          <article class="action-card action-card--accent">
            <span class="action-number">01</span>
            <div><h2>${authenticated ? 'Loading your next booking…' : 'Book something new'}</h2><p>${authenticated ? 'Your secure booking context is loading.' : 'Browse the live service catalogue, then continue with Shiloh to check real availability.'}</p></div>
            <a class="button button--primary" href="/book">Book an appointment</a>
          </article>
          <article class="action-card">
            <span class="action-number">02</span>
            <div><h2>Change an appointment</h2><p>Reschedule or cancel through the same Shiloh booking authority already used on WhatsApp.</p></div>
            <a class="button button--soft" href="${escapeHtml(manageBooking)}" rel="noopener noreferrer">Ask Shiloh</a>
          </article>
        </div>
      </section>

      <section class="view" id="shiloh" data-view="shiloh" aria-labelledby="shiloh-title" hidden>
        <div class="assistant-hero">
          <div class="assistant-orbit" aria-hidden="true"><span>S</span></div>
          <p class="eyebrow">Your wellness assistant</p>
          <h1 id="shiloh-title">Shiloh, right where you need it.</h1>
          <p>${authenticated
            ? 'Ask naturally. Shiloh can understand your secure booking, form and payment context while the real Shiloh systems remain in control of what is true.'
            : 'Sign in to let Shiloh understand your private client context, or continue the conversation on WhatsApp.'}</p>
        </div>
        ${authenticated ? `
        <section class="assistant-chat" aria-label="Chat with Shiloh">
          <div class="assistant-chat__messages" data-shiloh-messages aria-live="polite" aria-relevant="additions">
            <div class="chat-bubble chat-bubble--shiloh">
              <span>Shiloh</span>
              <p>Hi ${firstName} 🌿 Ask me anything about your Shiloh visit, booking, forms or payment status.</p>
            </div>
          </div>
          <div class="prompt-grid" aria-label="Suggested questions" data-client-experience-prompts>
            <button type="button" data-shiloh-prompt><span>Prepare</span><strong>What do I need before my appointment?</strong></button>
            <button type="button" data-shiloh-prompt><span>Manage</span><strong>Can I move my appointment?</strong></button>
            <button type="button" data-shiloh-prompt><span>Status</span><strong>What is my appointment status?</strong></button>
            <button type="button" data-shiloh-prompt><span>Payment</span><strong>What is my payment status?</strong></button>
          </div>
          <form class="assistant-composer" data-shiloh-chat-form>
            <label class="sr-only" for="my-shiloh-message">Message Shiloh</label>
            <textarea id="my-shiloh-message" data-shiloh-chat-input rows="2" maxlength="1000" placeholder="Ask Shiloh…" autocomplete="off"></textarea>
            <button class="button button--primary" type="submit" data-shiloh-chat-send>Send</button>
          </form>
          <p class="assistant-chat__note">Shiloh can explain and guide you here. Booking, payment and form changes still require their secure confirmed flow.</p>
          <a class="text-link assistant-whatsapp-fallback" href="${escapeHtml(askShiloh)}" rel="noopener noreferrer">Prefer WhatsApp? Continue there →</a>
        </section>` : `
        <a class="button button--primary button--wide" href="${escapeHtml(askShiloh)}" rel="noopener noreferrer">Chat with Shiloh on WhatsApp</a>
        <div class="prompt-grid" aria-label="Things Shiloh can help with">
          <article><span>Choose</span><strong>What would suit me?</strong></article>
          <article><span>Manage</span><strong>Move my appointment</strong></article>
          <article><span>Prepare</span><strong>What do I need before I arrive?</strong></article>
          <article><span>Visit</span><strong>Help me plan my visit</strong></article>
        </div>`}
      </section>

      <section class="view" id="profile" data-view="profile" aria-labelledby="profile-title" hidden>
        ${profile}
      </section>
    </main>

    <nav class="bottom-nav" aria-label="My Shiloh">
      <a href="#home" data-view-target="home" aria-current="page"><span class="nav-icon" aria-hidden="true">⌂</span><span>Home</span></a>
      <a href="#bookings" data-view-target="bookings"><span class="nav-icon" aria-hidden="true">□</span><span>Bookings</span></a>
      <a class="nav-shiloh" href="#shiloh" data-view-target="shiloh"><span class="nav-orb" aria-hidden="true">S</span><span>Shiloh</span></a>
      <a href="#profile" data-view-target="profile"><span class="nav-icon" aria-hidden="true">○</span><span>Profile</span></a>
    </nav>
  </div>

  <div class="install-sheet" data-install-sheet hidden>
    <button class="install-sheet__backdrop" type="button" data-install-close aria-label="Close install help"></button>
    <section class="install-sheet__panel" role="dialog" aria-modal="true" aria-labelledby="install-title">
      <button class="install-sheet__close" type="button" data-install-close aria-label="Close">×</button>
      <span class="brand-mark brand-mark--large" aria-hidden="true">S</span>
      <p class="eyebrow">Keep My Shiloh close</p>
      <h2 id="install-title">Add My Shiloh to your Home Screen.</h2>
      <ol data-install-steps>
        <li>Open your browser menu or Share button.</li>
        <li>Choose Add to Home Screen or Install app.</li>
        <li>Open My Shiloh from its new icon.</li>
      </ol>
      <button class="button button--primary button--wide" type="button" data-install-close>Got it</button>
    </section>
  </div>

  <script src="/my-shiloh/assets/app.js" defer></script>
</body>
</html>`;
}

module.exports = {
  escapeHtml,
  whatsappUrl,
  serviceCards,
  authFinishForm,
  johannesburgGreeting,
  renderMyShilohPage,
  PUBLIC_BRAND_NAME,
  PUBLIC_TAGLINE,
};
