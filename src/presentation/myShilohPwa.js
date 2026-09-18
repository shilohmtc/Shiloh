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

function renderMyShilohPage({ whatsappNumber = null, catalogue = [] } = {}) {
  const askShiloh = whatsappUrl(whatsappNumber);
  const manageBooking = whatsappUrl(
    whatsappNumber,
    'Hi Shiloh, I am in My Shiloh and would like help with an appointment.',
  );

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
  <div class="app-frame" data-app-frame>
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
        <div class="hero">
          <p class="eyebrow">Your Shiloh space</p>
          <h1 id="home-title">A calmer way to care for you.</h1>
          <p class="hero-copy">Bookings, forms, payments and Shiloh support are coming together in one private, beautifully simple place.</p>
          <div class="hero-actions">
            <a class="button button--primary" href="/book">Book an appointment</a>
            <a class="button button--soft" href="${escapeHtml(askShiloh)}" rel="noopener noreferrer">Ask Shiloh</a>
          </div>
        </div>

        <section class="focus-card" aria-labelledby="next-visit-title">
          <div class="focus-card__top">
            <div>
              <p class="eyebrow">Next visit</p>
              <h2 id="next-visit-title">Your appointment will live here.</h2>
            </div>
            <span class="status-pill">Private</span>
          </div>
          <p>Once secure client sign-in is switched on, this card will show your next appointment, practitioner, forms and payment status automatically.</p>
          <div class="focus-grid" aria-label="My Shiloh client features">
            <div><span>Appointment</span><strong>One glance</strong></div>
            <div><span>Forms</span><strong>Only when needed</strong></div>
            <div><span>Payment</span><strong>Clear status</strong></div>
          </div>
        </section>

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
          <p>My Shiloh will bring upcoming and previous appointments into one timeline. For now, booking and changes continue through Shiloh's existing live booking journey.</p>
        </div>
        <div class="stack">
          <article class="action-card action-card--accent">
            <span class="action-number">01</span>
            <div><h2>Book something new</h2><p>Browse the live service catalogue, then continue with Shiloh to check real availability.</p></div>
            <a class="button button--primary" href="/book">Start booking</a>
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
          <p>Choose a service, manage an appointment, prepare for your visit, or simply ask a question. Your conversation continues securely on WhatsApp while the in-app assistant layer is prepared.</p>
          <a class="button button--primary button--wide" href="${escapeHtml(askShiloh)}" rel="noopener noreferrer">Chat with Shiloh</a>
        </div>
        <div class="prompt-grid" aria-label="Things Shiloh can help with">
          <article><span>Choose</span><strong>What would suit me?</strong></article>
          <article><span>Manage</span><strong>Move my appointment</strong></article>
          <article><span>Prepare</span><strong>What do I need before I arrive?</strong></article>
          <article><span>Visit</span><strong>Help me plan my visit</strong></article>
        </div>
      </section>

      <section class="view" id="profile" data-view="profile" aria-labelledby="profile-title" hidden>
        <div class="page-intro">
          <p class="eyebrow">Profile</p>
          <h1 id="profile-title">Your Shiloh, remembered.</h1>
          <p>Personal details will only appear after the dedicated client-session layer is active. Until then, My Shiloh intentionally keeps this surface free of client information.</p>
        </div>
        <div class="profile-list" aria-label="Future secure profile areas">
          <div><span>Personal details</span><strong>Secure access</strong></div>
          <div><span>Consultation forms</span><strong>When required</strong></div>
          <div><span>Packages &amp; vouchers</span><strong>One balance</strong></div>
          <div><span>Receipts &amp; payments</span><strong>Clear history</strong></div>
          <div><span>Preferences</span><strong>Your choices</strong></div>
        </div>
        <aside class="privacy-note">
          <span aria-hidden="true">✓</span>
          <div><strong>Privacy first.</strong><p>No admin credential, staff session or client health data is exposed to this PWA shell.</p></div>
        </aside>
      </section>
    </main>

    <nav class="bottom-nav" aria-label="My Shiloh">
      <a href="#home" data-view-target="home" aria-current="page"><span class="nav-icon" aria-hidden="true">⌂</span><span>Home</span></a>
      <a href="#bookings" data-view-target="bookings"><span class="nav-icon" aria-hidden="true">□</span><span>Bookings</span></a>
      <a class="nav-shiloh" href="#shiloh" data-view-target="shiloh"><span class="nav-orb" aria-hidden="true">S</span><span>Shiloh</span></a>
      <a href="#profile" data-view-target="profile"><span class="nav-icon" aria-hidden="true">○</span><span>Profile</span></a>
    </nav>
  </div>

  <div class="install-sheet" data-install-trigger hidden>
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
  renderMyShilohPage,
  PUBLIC_BRAND_NAME,
  PUBLIC_TAGLINE,
};
