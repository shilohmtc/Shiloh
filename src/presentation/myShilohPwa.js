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

function authFinishForm(inputId = 'my-shiloh-code') {
  return `<form class="auth-code-form" data-client-auth-code-form>
    <div class="auth-code-heading">
      <span>Back from WhatsApp?</span>
      <strong>Enter your 6-digit code</strong>
      <p>Use the code Shiloh sent in your WhatsApp reply.</p>
    </div>
    <label class="sr-only" for="${escapeHtml(inputId)}">6-digit code from Shiloh</label>
    <div class="auth-code-row">
      <input id="${escapeHtml(inputId)}" data-client-auth-code inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" placeholder="123 456" aria-label="6-digit code from Shiloh">
      <button class="button button--primary" type="submit">Open My Shiloh</button>
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
        <p class="hero-copy">You’re safely signed in. Your appointments, forms, payments and rewards are ready whenever you need them.</p>
        <div class="hero-actions">
          <a class="button button--primary" href="/book">Book an appointment</a>
          <a class="button button--soft" href="${escapeHtml(askShiloh)}" rel="noopener noreferrer">Ask Shiloh</a>
        </div>
      </div>`
    : `<div class="hero">
        <p class="eyebrow">Welcome to My Shiloh</p>
        <h1 id="home-title">Your Shiloh, all in one place.</h1>
        <p class="hero-copy">Use WhatsApp to confirm it’s you and open your personal Shiloh space. No password or email needed.</p>
        <div class="hero-actions">
          <button class="button button--primary" type="button" data-client-auth-start>Continue with WhatsApp</button>
          <a class="button button--soft" href="/book">Book an appointment</a>
        </div>
        <div class="auth-status" data-auth-status role="status" aria-live="polite"></div>
        ${authFinishForm('my-shiloh-home-code')}
      </div>`;

  const focus = authenticated
    ? `<section class="focus-card" aria-labelledby="next-visit-title" data-client-experience-home>
        <div class="focus-card__top">
          <div><p class="eyebrow">Your Shiloh</p><h2 id="next-visit-title">Bringing your next step into focus.</h2></div>
          <span class="status-pill">Secure</span>
        </div>
        <p>Shiloh is bringing together what matters for your next visit.</p>
        <div class="focus-grid" aria-label="Your Shiloh details">
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
        <p>WhatsApp confirms your number and brings you safely back to My Shiloh.</p>
        <div class="focus-grid" aria-label="My Shiloh sign-in">
          <div><span>Sign-in</span><strong>WhatsApp</strong></div>
          <div><span>Password</span><strong>Not needed</strong></div>
          <div><span>Your choice</span><strong>Sign out anytime</strong></div>
        </div>
      </section>`;

  const giftVoucher = authenticated
    ? `<section class="quiet-card">
        <div class="quiet-icon" aria-hidden="true">♥</div>
        <div><p class="eyebrow">Gift vouchers</p><h2>Give someone a little Shiloh.</h2><p>Create a personal English or Afrikaans voucher and pay securely.</p></div>
        <a class="circle-link" href="/my-shiloh/gift-vouchers" aria-label="Create a Shiloh gift voucher">→</a>
      </section>`
    : '';

  const rewards = authenticated
    ? `<section class="quiet-card">
        <div class="quiet-icon" aria-hidden="true">R</div>
        <div><p class="eyebrow">Shiloh Rewards</p><h2>Your care gives a little back.</h2><p>See your 5% reward balance and choose when to use it.</p></div>
        <a class="circle-link" href="/my-shiloh/rewards" aria-label="View Shiloh Rewards">→</a>
      </section>`
    : '';

  const profile = authenticated
    ? `<div class="page-intro">
        <p class="eyebrow">Profile</p>
        <h1 id="profile-title">Your Shiloh, remembered.</h1>
        <p>Your personal Shiloh space is open and ready.</p>
      </div>
      <div class="profile-auth-card">
        <div class="profile-avatar" aria-hidden="true">${firstName.charAt(0).toUpperCase()}</div>
        <div><span>Signed in as</span><strong>${clientName}</strong><small>Verified with WhatsApp</small></div>
      </div>
      <section class="profile-editor" aria-labelledby="personal-details-title">
        <div class="profile-editor__heading">
          <div><p class="eyebrow">Personal details</p><h2 id="personal-details-title">Keep your details up to date.</h2></div>
          <span class="status-pill">Private</span>
        </div>
        <form data-client-profile-form>
          <div class="profile-fields">
            <label class="profile-field profile-field--wide" for="profile-name">
              <span>Full name</span>
              <input id="profile-name" name="name" maxlength="120" autocomplete="name" required disabled>
            </label>
            <label class="profile-field" for="profile-date-of-birth">
              <span>Date of birth</span>
              <input id="profile-date-of-birth" name="dateOfBirth" type="date" min="1900-01-01" autocomplete="bday" disabled>
            </label>
            <label class="profile-field" for="profile-gender">
              <span>Gender</span>
              <select id="profile-gender" name="gender" disabled>
                <option value="">Choose an option</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="non_binary">Non-binary</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>
          <div class="profile-mobile">
            <div><span>Verified WhatsApp number</span><strong data-client-profile-mobile>Checking…</strong></div>
            <p>Your sign-in number cannot be changed here. Please ask the clinic team if it needs to be updated.</p>
          </div>
          <p class="profile-editor__status" data-client-profile-status role="status" aria-live="polite">Loading your details…</p>
          <button class="button button--primary button--wide" type="submit" disabled>Save personal details</button>
        </form>
      </section>
      <section class="profile-editor" aria-labelledby="report-problem-title">
        <div class="profile-editor__heading">
          <div><p class="eyebrow">Help</p><h2 id="report-problem-title">Report a problem.</h2></div>
          <span class="status-pill">Private</span>
        </div>
        <p class="problem-report-copy">Tell us if something in My Shiloh looks wrong or does not work as expected. JP will see your report privately.</p>
        <div class="problem-report-list" data-client-problem-report-list aria-live="polite"><p class="problem-report-copy">Loading your reports…</p></div>
        <form data-client-problem-report-form>
          <div class="profile-fields">
            <label class="profile-field profile-field--wide" for="client-problem-category"><span>What does it relate to?</span><select id="client-problem-category" name="category" required><option value="">Choose one</option><option value="booking">Booking</option><option value="messages">Messages</option><option value="profile">Personal details</option><option value="payments">Payments</option><option value="other">Something else</option></select></label>
            <label class="profile-field profile-field--wide" for="client-problem-description"><span>What happened?</span><textarea id="client-problem-description" name="description" minlength="10" maxlength="2000" required></textarea></label>
            <label class="profile-field profile-field--wide" for="client-problem-expected"><span>What did you expect? (optional)</span><textarea id="client-problem-expected" name="expectedBehavior" maxlength="1000"></textarea></label>
            <label class="profile-field" for="client-problem-booking"><span>Booking number (optional)</span><input id="client-problem-booking" name="relatedAppointmentId" inputmode="numeric"></label>
            <label class="profile-field" for="client-problem-screenshot"><span>Screenshot (optional)</span><input id="client-problem-screenshot" name="screenshot" type="file" accept="image/jpeg,image/png,image/webp"></label>
          </div>
          <p class="problem-report-copy">JPG, PNG or WebP under 1 MB. Please do not include passwords, sign-in codes, card details or private medical information.</p>
          <p class="profile-editor__status" data-client-problem-report-status role="status" aria-live="polite"></p>
          <button class="button button--soft button--wide" type="submit">Send report</button>
        </form>
      </section>
      <div class="profile-list" aria-label="Secure profile areas">
        <div><span>Consultation forms</span><strong>When required</strong></div>
        <div><span>Gift vouchers</span><strong><a href="/my-shiloh/gift-vouchers">Create or view</a></strong></div>
        <div><span>Shiloh Rewards</span><strong><a href="/my-shiloh/rewards">View balance</a></strong></div>
        <div><span>Receipts &amp; payments</span><strong>Private</strong></div>
      </div>
      <button class="button button--soft button--wide profile-signout" type="button" data-client-auth-logout>Sign out</button>
      <div class="auth-status" data-auth-status role="status" aria-live="polite"></div>`
    : `<div class="page-intro">
        <p class="eyebrow">Profile</p>
        <h1 id="profile-title">Your Shiloh, remembered.</h1>
        <p>Use WhatsApp to confirm it’s you. You’ll never need a password.</p>
      </div>
      <button class="button button--primary button--wide" type="button" data-client-auth-start>Continue with WhatsApp</button>
      <div class="auth-status" data-auth-status role="status" aria-live="polite"></div>
      ${authFinishForm('my-shiloh-profile-code')}
      <aside class="privacy-note">
        <span aria-hidden="true">✓</span>
        <div><strong>Privacy first.</strong><p>Your My Shiloh information stays private and appears only after you sign in.</p></div>
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
  <link rel="icon" href="/my-shiloh/assets/icon-192.png" type="image/png" sizes="192x192">
  <link rel="apple-touch-icon" href="/my-shiloh/assets/icon-192.png">
  <link rel="stylesheet" href="/my-shiloh/assets/app.css">
  <title>My Shiloh</title>
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to content</a>
  <div class="app-frame" data-app-frame data-client-authenticated="${authenticated ? 'true' : 'false'}">
    <header class="topbar">
      <a class="brand" href="#home" aria-label="My Shiloh home">
        <img class="brand-logo" src="/my-shiloh/assets/logo-compact.webp" alt="My Shiloh" width="858" height="336">
      </a>
      <button class="install-button" type="button" data-install-trigger hidden>Install app</button>
    </header>

    <div class="network-banner" data-offline-banner hidden role="status">You are offline. My Shiloh will reconnect automatically.</div>

    <main id="main-content" class="app-main">
      <section class="view is-active" id="home" data-view="home" aria-labelledby="home-title">
        ${hero}
        ${focus}
        ${rewards}
        ${giftVoucher}
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
          <p>${authenticated ? 'Your appointments and visit details will appear here.' : 'Sign in to see your appointments, or continue with Shiloh on WhatsApp.'}</p>
        </div>
        <div class="stack" data-client-experience-bookings>
          <article class="action-card action-card--accent">
            <span class="action-number">01</span>
            <div><h2>${authenticated ? 'Loading your next booking…' : 'Book something new'}</h2><p>${authenticated ? 'We’re bringing your next appointment into view.' : 'Browse the live service list, then ask Shiloh to find a time that suits you.'}</p></div>
            <a class="button button--primary" href="/book">Book an appointment</a>
          </article>
          <article class="action-card">
            <span class="action-number">02</span>
            <div><h2>Change an appointment</h2><p>Ask Shiloh to help you reschedule or cancel your appointment.</p></div>
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
            ? 'Ask naturally about your appointments, forms, payments or rewards.'
            : 'Sign in for personal help, or continue the conversation on WhatsApp.'}</p>
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
          <p class="assistant-chat__note">For any change, Shiloh will show you what will happen and ask you to confirm.</p>
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
      <span class="brand-mark brand-mark--large" aria-hidden="true"><img src="/my-shiloh/assets/icon-192.png" alt=""></span>
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
