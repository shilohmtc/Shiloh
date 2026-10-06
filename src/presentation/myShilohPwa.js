'use strict';

const {
  PUBLIC_BRAND_NAME,
  PUBLIC_TAGLINE,
  sanitizePublicCatalogue,
} = require('../services/publicPresentation');
const { STANDARD_HOSPITALITY } = require('../config/clinicFaqPolicy');
const { renderShilohIcon } = require('./shilohIcon');

const MY_SHILOH_ASSET_VERSION = '20261006-booking-readiness-v1';

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

function serviceCards(catalogue = [], authenticated = false) {
  const bookingHref = authenticated ? '/my-shiloh/book' : '#home';
  const services = sanitizePublicCatalogue(catalogue).slice(0, 4);
  if (!services.length) {
    return `<article class="service-card service-card--empty"><span class="service-kicker">Services</span><h3>Explore what feels right.</h3><p>Our live service list is temporarily unavailable. Shiloh can still help you choose.</p><a class="text-link" href="${bookingHref}">${authenticated ? 'Open booking' : 'Sign in to book'}</a></article>`;
  }

  return services
    .map((service) => `<article class="service-card">
      <span class="service-kicker">${escapeHtml(service.category || 'Service')}</span>
      <h3>${escapeHtml(service.name)}</h3>
      <div class="service-meta"><span>${escapeHtml(service.duration || '')}</span><strong>${escapeHtml(service.price || '')}</strong></div>
      <a class="service-link" href="${authenticated ? `/my-shiloh/book?service=${encodeURIComponent(service.id)}` : bookingHref}">${authenticated ? 'Book this service' : 'Sign in to book'}</a>
    </article>`)
    .join('');
}

function smsRegisterButton(scope) {
  return `<button class="button button--primary button--wide register-choice" type="button" data-client-sms-open="register" aria-controls="${scope}-sms-setup" aria-expanded="false">${renderShilohIcon('register', { size: 24 })}<span>Register</span>${renderShilohIcon('next', { size: 18, className: 'auth-choice-summary__chevron' })}</button>`;
}

function smsSignInForm(scope) {
  return `<button class="auth-choice-summary sms-recovery-choice" type="button" data-client-sms-open="recover" aria-controls="${scope}-sms-setup" aria-expanded="false">${renderShilohIcon('phone', { size: 24, className: 'auth-choice-summary__icon' })}<span>Already registered, but using a new phone?</span>${renderShilohIcon('next', { size: 18, className: 'auth-choice-summary__chevron' })}</button>
  <section class="sms-setup-choice" id="${scope}-sms-setup" data-client-sms-choice aria-labelledby="${scope}-sms-title" hidden>
    <h2 id="${scope}-sms-title" data-client-sms-title>Register for My Shiloh</h2>
    <p data-client-sms-copy>Verify your number with an SMS code, then save a passkey for future sign-ins. If you already have a Shiloh profile, we’ll reconnect you to it.</p>
    <form class="sms-auth-form" data-client-sms-start>
    <label>Full name<input name="name" autocomplete="name" maxlength="120" required placeholder="Your name"></label>
    <label>Mobile number<input name="mobile" type="tel" autocomplete="tel-national" inputmode="tel" required placeholder="082 123 4567"></label>
    <button class="button button--primary button--wide" type="submit">Send my SMS code</button>
    </form>
    <form class="sms-auth-form sms-auth-code" data-client-sms-complete hidden>
    <label>6-digit code<input name="code" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9 ]{6,7}" maxlength="7" required placeholder="123 456"></label>
    <button class="button button--primary button--wide" type="submit">Open My Shiloh</button>
    <p>Sent to your phone. The code works for 10 minutes.</p>
    </form>
  </section>`;
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
  humanWhatsAppNumber = null,
  catalogue = [],
  selectedServiceId = '',
  client = null,
  passkeysAvailable = false,
  smsAvailable = false,
  signInMethod = null,
  now = new Date(),
} = {}) {
  const suppliedHumanDigits = String(humanWhatsAppNumber || '').replace(/\D/g, '');
  const humanDigits = /^0[678]\d{8}$/.test(suppliedHumanDigits) ? `27${suppliedHumanDigits.slice(1)}`
    : /^27[678]\d{8}$/.test(suppliedHumanDigits) ? suppliedHumanDigits : '';
  const receptionPhone = humanDigits || '27662399138';
  const receptionRecoveryWhatsApp = whatsappUrl(receptionPhone,
    'Hi Reception, I need help getting back into My Shiloh. Please tell me how to verify my identity.');
  const speakToReception = whatsappUrl(receptionPhone,
    'Hi Reception, I am using My Shiloh and would like to speak with a person.');
  const authenticated = Boolean(client?.id && client?.firstName);
  const selectedService = /^[1-9]\d*$/.test(String(selectedServiceId || ''))
    ? sanitizePublicCatalogue(catalogue).find((service) => String(service.id) === String(selectedServiceId)) : null;
  const bookingsHelpHref = authenticated ? '#shiloh' : speakToReception;
  const bookingsHelpLabel = !authenticated ? 'Ask Reception'
    : 'Ask Shiloh';
  const choosingHelpCopy = 'Tell Shiloh what you’re looking for and chat here in My Shiloh.';
  const greeting = authenticated ? johannesburgGreeting(now) : null;
  const clientName = authenticated ? escapeHtml(client.name || client.firstName) : '';
  const firstName = authenticated ? escapeHtml(client.firstName) : '';
  const passkeySignInButton = passkeysAvailable
    ? `<button class="button button--soft button--wide passkey-choice" type="button" data-passkey-sign-in>${renderShilohIcon('key', { size: 24 })}<span>Sign in with a passkey</span></button>`
    : '';
  const passkeyRecovery = passkeysAvailable
    ? `<details class="passkey-recovery"><summary class="auth-choice-summary">${renderShilohIcon('key', { size: 24, className: 'auth-choice-summary__icon' })}<span>Can’t use your passkey?</span>${renderShilohIcon('next', { size: 18, className: 'auth-choice-summary__chevron' })}</summary>
         <p>Use the recovery code you saved when setting up My Shiloh.${smsAvailable ? ' If you’re on a new phone, choose the new-phone option above to verify your number.' : ''}</p>
         <form data-passkey-recovery-form>
           <label>Recovery code <input required autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" placeholder="XXXXX-XXXXX-…" name="code"></label>
           <button class="button button--soft" type="submit">Use recovery code</button>
         </form>
         <p data-passkey-recovery-status role="status" aria-live="polite"></p>
         <p>${smsAvailable ? 'Can’t access your mobile number either? Contact Shiloh Reception for help.' : 'Lost your code too? Contact Shiloh Reception for help.'}</p>
       </details>`
    : '';
  const recoveryHelp = (id) => `<details class="recovery-help" id="${id}">
    <summary class="auth-choice-summary">${renderShilohIcon('help', { size: 24, className: 'auth-choice-summary__icon' })}<span>Lost access to your phone and recovery code?</span>${renderShilohIcon('next', { size: 18, className: 'auth-choice-summary__chevron' })}</summary>
    <div class="recovery-help__body">
      <p>Contact Reception if you no longer have your phone or recovery code. Please don’t share sign-in codes.</p>
      <div class="recovery-help__actions">
        <a class="button button--soft" href="tel:+${receptionPhone}">${renderShilohIcon('call', { size: 18 })}Call Reception</a>
        <a class="button button--soft" href="${escapeHtml(receptionRecoveryWhatsApp)}" rel="noopener noreferrer">${renderShilohIcon('message', { size: 18 })}WhatsApp Reception</a>
      </div>
      <small>Reception will verify your identity before helping.</small>
    </div>
  </details>`;

  const hero = authenticated
    ? `<div class="hero hero--client">
        <h1 id="home-title" class="hero-greeting" data-client-greeting data-first-name="${firstName}">${escapeHtml(greeting)}, <span>${firstName}.</span></h1>
        <p class="hero-copy">Your appointments, payments and forms.</p>
      </div>`
    : `<div class="hero">
        <p class="eyebrow">Welcome to My Shiloh</p>
        <h1 id="home-title">Your Shiloh, all in one place.</h1>
        <p class="hero-copy">${smsAvailable ? (passkeysAvailable ? 'New here? Register to get started. Already registered? Sign in with your passkey.' : 'New here? Register to get started. Already registered? Verify your number to open My Shiloh.') : passkeysAvailable ? 'Sign in with your saved passkey to open your personal Shiloh space.' : 'Sign-in is temporarily unavailable. Please contact Reception for help.'}</p>
        <div class="hero-actions${smsAvailable ? ' hero-actions--sms' : ''}">
          ${smsAvailable ? smsRegisterButton('home') : ''}
          ${passkeySignInButton}
          ${smsAvailable ? smsSignInForm('home') : ''}
          ${passkeyRecovery}
        </div>
        ${recoveryHelp('home-recovery-help')}
        <div class="auth-status" data-auth-status role="status" aria-live="polite"></div>
      </div>`;

  const focus = authenticated
    ? `<section class="focus-card" aria-labelledby="next-visit-title" data-client-experience-home>
        <div class="focus-card__top">
          <div><p class="eyebrow">Your next step</p><h2 id="next-visit-title">Checking your visit.</h2></div>
          <span class="status-pill">Checking</span>
        </div>
        <p>Checking your latest booking and anything to do before you arrive.</p>
        <div class="focus-grid" aria-label="Your Shiloh details">
          <button class="focus-fact" type="button" data-client-experience-fact data-fact-key="appointment"><span>Appointment</span><strong>Checking</strong><b aria-hidden="true">›</b></button>
          <button class="focus-fact" type="button" data-client-experience-fact data-fact-key="forms"><span>Forms</span><strong>Checking</strong><b aria-hidden="true">›</b></button>
          <button class="focus-fact" type="button" data-client-experience-fact data-fact-key="payment"><span>Payment</span><strong>Checking</strong><b aria-hidden="true">›</b></button>
        </div>
        <p class="focus-card__fact-status" data-client-experience-fact-status role="status" aria-live="polite"></p>
        <a class="button button--primary experience-primary" data-client-experience-primary href="/my-shiloh/book">Book an appointment</a>
        <p class="focus-card__hospitality">${escapeHtml(STANDARD_HOSPITALITY)}</p>
      </section>`
    : `<section class="focus-card focus-card--guest" id="how-booking-works" aria-labelledby="next-visit-title">
        <div class="focus-card__top">
          <div><p class="eyebrow">How booking works</p><h2 id="next-visit-title" tabindex="-1">Your visit starts here.</h2></div>
        </div>
        <ol class="booking-steps">
          <li><strong>Explore treatments</strong><span>See what feels right for you.</span></li>
          <li><strong>Confirm it’s you</strong><span>${passkeysAvailable ? 'Register if you’re new, or sign in with your saved passkey.' : smsAvailable ? 'Verify your number by SMS to get started.' : 'Sign in securely.'}</span></li>
          <li><strong>Request a time</strong><span>Reception reviews your request. Pay any required deposit to confirm.</span></li>
        </ol>
      </section>`;

  const giftVoucher = authenticated
    ? `<section class="quiet-card">
        <div class="quiet-icon" aria-hidden="true">♥</div>
        <div><p class="eyebrow">Voucher wallet</p><h2>Your vouchers, ready when you are.</h2><p>See vouchers linked to you, check the balance, or buy one for someone special.</p></div>
        <a class="circle-link" href="/my-shiloh/gift-vouchers" aria-label="Open your Shiloh voucher wallet">→</a>
      </section>`
    : '';

  const rewards = authenticated
    ? `<section class="quiet-card">
        <div class="quiet-icon" aria-hidden="true">R</div>
        <div><p class="eyebrow">Shiloh Rewards</p><h2>Your care gives a little back.</h2><p>See your 5% reward balance and choose when to use it.</p></div>
        <a class="circle-link" href="/my-shiloh/rewards" aria-label="View Shiloh Rewards">→</a>
      </section>`
    : '';

  const welcomeVoucher = authenticated
    ? `<section class="welcome-voucher" id="welcome-voucher" data-welcome-voucher aria-labelledby="welcome-voucher-title" hidden>
        <div class="welcome-voucher__value" aria-hidden="true">R100</div>
        <div class="welcome-voucher__body">
          <p class="eyebrow">My Shiloh welcome</p>
          <h2 id="welcome-voucher-title">Your R100 welcome voucher.</h2>
          <p data-welcome-voucher-copy>Checking your registration…</p>
          <ol class="welcome-voucher__steps" data-welcome-voucher-steps></ol>
          <div class="welcome-voucher__bookings" data-welcome-voucher-bookings></div>
          <details><summary>Voucher terms</summary><ul data-welcome-voucher-terms></ul></details>
          <p class="welcome-voucher__status" data-welcome-voucher-status role="status" aria-live="polite"></p>
        </div>
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
        <div class="profile-auth-card__identity"><span>Signed in as</span><strong>${clientName}</strong><small>${signInMethod === 'passkey' ? 'Signed in with a passkey' : signInMethod === 'passkey_recovery' ? 'Signed in with a recovery code' : signInMethod === 'sms_code' ? 'Verified by SMS' : 'Signed in securely'}</small></div>
      </div>
      ${passkeysAvailable ? `<section class="profile-editor" aria-labelledby="passkey-title">
        <div class="profile-editor__heading"><div><p class="eyebrow">Sign-in</p><h2 id="passkey-title">Make next time easier.</h2></div></div>
        <p>Save a passkey, then keep a one-time recovery code somewhere private in case you lose access to your device.</p>
        ${signInMethod === 'passkey_recovery' ? '<p role="status">Your recovery code has been used. Save a new passkey and create a new recovery code now.</p>' : ''}
        <button class="button button--soft button--wide" type="button" data-passkey-enroll>Save a passkey</button>
        <p class="profile-editor__status" data-passkey-enroll-status role="status" aria-live="polite"></p>
        <h3>Your saved passkeys</h3>
        <div data-passkey-devices aria-live="polite">Loading saved passkeys…</div>
        <p class="profile-editor__status" data-passkey-device-status role="status" aria-live="polite"></p>
        <h3>Your recovery code</h3>
        <p>Create a one-time code to use if you lose access to every passkey. Creating a new code replaces your old one. We cannot show it again.</p>
        <button class="button button--soft" type="button" data-passkey-recovery-create>Create a recovery code</button>
        <p class="profile-editor__status" data-passkey-recovery-create-status role="status" aria-live="polite"></p>
        <code class="passkey-recovery-code" data-passkey-recovery-code hidden></code>
      </section>` : ''}
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
              <input id="profile-date-of-birth" name="dateOfBirth" type="date" min="1900-01-01" autocomplete="bday" required disabled>
            </label>
            <label class="profile-field" for="profile-gender">
              <span>Gender</span>
              <select id="profile-gender" name="gender" required disabled>
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
            <div><span>Verified mobile number</span><strong data-client-profile-mobile>Checking…</strong></div>
            <p>Your sign-in number cannot be changed here. Please ask the clinic team if it needs to be updated.</p>
          </div>
          <p class="profile-editor__status" data-client-profile-status role="status" aria-live="polite">Loading your details…</p>
          <button class="button button--primary button--wide" type="submit" disabled>Save personal details</button>
        </form>
      </section>
      <section class="profile-editor notification-settings" aria-labelledby="notifications-title" data-push-settings>
        <div class="profile-editor__heading">
          <div><p class="eyebrow">Notifications</p><h2 id="notifications-title" tabindex="-1">Stay up to date with Shiloh.</h2></div>
          <span class="status-pill">Optional</span>
        </div>
        <p class="problem-report-copy">Stay ready for your next visit with appointment reminders and updates about bookings, forms, payments, vouchers and Shiloh Rewards on this phone.</p>
        <button class="button button--soft button--wide" type="button" data-push-toggle disabled>Checking notifications…</button>
        <p class="profile-editor__status" data-push-status role="status" aria-live="polite"></p>
        <p class="notification-settings__note">Operational updates only. Promotional messages stay separate and are never enabled by this setting.</p>
      </section>
      <details class="profile-editor profile-help" data-profile-archived-updates>
        <summary class="profile-help__summary"><span><span class="eyebrow">Updates</span><strong>Archived updates</strong><small>Booking confirmations and other updates you archived on this phone.</small></span><span class="profile-help__indicator" aria-hidden="true">+</span></summary>
        <div class="profile-help__content"><p class="problem-report-copy">Restore an update to show it in Current updates again. Your appointments stay in Bookings.</p><div class="notification-centre__list" data-client-archived-notification-list aria-live="polite"><p class="notification-centre__empty">Checking for archived updates…</p></div></div>
      </details>
      <details class="profile-editor profile-help" data-profile-help>
        <summary class="profile-help__summary"><span><span class="eyebrow">Help</span><strong id="report-problem-title">Report a problem</strong><small>Tell us when something in My Shiloh needs attention.</small></span><span class="profile-help__indicator" aria-hidden="true">+</span></summary>
        <div class="profile-help__content">
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
        </div>
      </details>
      <div class="profile-list" aria-label="Secure profile areas">
        <div><span>Consultation forms</span><strong>When required</strong></div>
        <div><span>Wallet</span><strong><a href="#wallet">Vouchers, rewards &amp; payments</a></strong></div>
      </div>
      <button class="button button--soft button--wide profile-signout" type="button" data-client-auth-logout>Sign out</button>
      <div class="auth-status" data-auth-status role="status" aria-live="polite"></div>`
    : `<div class="page-intro">
        <p class="eyebrow">Profile</p>
        <h1 id="profile-title">Your Shiloh, remembered.</h1>
        <p>${passkeysAvailable ? 'Sign in with your passkey.' : smsAvailable ? 'Verify your number to set up My Shiloh.' : 'Sign-in is temporarily unavailable. Please contact Reception for help.'}</p>
      </div>
      ${smsAvailable ? smsRegisterButton('profile') : ''}
      ${passkeySignInButton}
      ${smsAvailable ? smsSignInForm('profile') : ''}
      ${passkeyRecovery}
      ${recoveryHelp('profile-recovery-help')}
      <div class="auth-status" data-auth-status role="status" aria-live="polite"></div>
      <aside class="privacy-note">
        <span aria-hidden="true">✓</span>
        <div><strong>Privacy first.</strong><p>Your My Shiloh information stays private and appears only after you sign in.</p></div>
      </aside>`;

  const wallet = authenticated
    ? `<div class="page-intro wallet-intro">
        <p class="eyebrow">Wallet</p>
        <h1 id="wallet-title">Your Shiloh value, together.</h1>
        <p>Vouchers, rewards and payment shortcuts in one private place.</p>
      </div>
      ${welcomeVoucher}
      <div class="wallet-stack">
        ${giftVoucher}
        ${authenticated ? '<section class="wallet-card"><div><p class="eyebrow">Prepaid treatments</p><h2>Your packages</h2><p>Check available, booked and used treatments, then book your next session.</p></div><a class="circle-link" href="/my-shiloh/packages" aria-label="Open your prepaid treatment packages">→</a></section>' : ''}
        ${rewards}
        <section class="quiet-card" data-wallet-payments>
          <div class="quiet-icon" aria-hidden="true">P</div>
          <div><p class="eyebrow">Payments</p><h2>Payments stay with your bookings.</h2><p>Open Bookings to check the latest payment position or use a secure payment action when one is available.</p></div>
          <a class="circle-link" href="#bookings" aria-label="Open booking payments">→</a>
        </section>
      </div>`
    : `<div class="page-intro wallet-intro">
        <p class="eyebrow">Wallet</p>
        <h1 id="wallet-title">Your Shiloh value, together.</h1>
        <p>Sign in to see your vouchers, rewards and payment shortcuts.</p>
      </div>
      ${smsAvailable ? smsRegisterButton('wallet') : ''}
      ${passkeySignInButton}
      ${smsAvailable ? smsSignInForm('wallet') : ''}
      ${passkeyRecovery}
      ${recoveryHelp('wallet-recovery-help')}
      <div class="auth-status" data-auth-status role="status" aria-live="polite"></div>
      `;



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
  <link rel="apple-touch-icon" sizes="180x180" href="/my-shiloh/assets/apple-touch-icon-180.png?v=${MY_SHILOH_ASSET_VERSION}">
  <link rel="stylesheet" href="/my-shiloh/assets/app.css?v=${MY_SHILOH_ASSET_VERSION}">
  <title>My Shiloh</title>
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to content</a>
  <main class="install-gate" data-install-gate hidden aria-labelledby="install-gate-title">
    <section class="install-gate__card">
      <span class="brand-mark brand-mark--large install-gate__logo" aria-hidden="true"><img src="/my-shiloh/assets/icon-192.png" alt=""></span>
      <p class="eyebrow">My Shiloh</p>
      <h1 id="install-gate-title" data-install-gate-title>Add My Shiloh to your phone.</h1>
      <p class="install-gate__copy" data-install-gate-copy>Keep your bookings and vouchers close at hand.</p>
      ${selectedService ? `<div class="website-treatment-handoff" data-website-treatment-handoff data-service-code="${escapeHtml(selectedService.id)}" hidden>
        <p>Your website choice: <strong>${escapeHtml(selectedService.name)}</strong></p>
        <p>Already have My Shiloh? Copy this treatment code, open the app from your Home Screen, then tap Bookings to continue.</p>
        <div class="website-treatment-code">Code <strong>${escapeHtml(selectedService.id)}</strong></div>
        <button class="button button--soft button--wide" type="button" data-copy-treatment-code>Copy treatment code</button>
        <p role="status" data-copy-treatment-status></p>
      </div>` : ''}
      <button class="button button--primary button--wide" type="button" data-install-gate-action>Install My Shiloh</button>
      <p class="install-gate__sequence">After installing, open My Shiloh from your Home Screen. Register if you’re new, or sign in if you already have a profile.</p>
      <p class="install-gate__status" data-install-gate-status aria-live="polite"></p>
    </section>
  </main>

  <div class="app-frame" data-app-frame data-client-authenticated="${authenticated ? 'true' : 'false'}" data-notification-client-id="${authenticated ? Number(client.id) : ''}" data-client-payment-whatsapp="${escapeHtml(String(whatsappNumber || '').replace(/\D/g, ''))}" hidden>
    <div class="network-banner" data-offline-banner hidden role="status">You are offline. My Shiloh will reconnect automatically.</div>
    <div class="app-update-banner" data-app-update hidden role="status" aria-live="polite">
      <div><strong>A new My Shiloh update is ready.</strong><span>Update now to use the latest version.</span></div>
      <button class="button button--primary" type="button" data-app-update-action>Update now</button>
    </div>

    <main id="main-content" class="app-main">
      <section class="view is-active" id="home" data-view="home" aria-labelledby="home-title">
        ${authenticated && passkeysAvailable ? `<section class="client-setup" data-client-setup hidden aria-labelledby="client-setup-title">
          <p class="eyebrow" data-client-setup-step>One quick setup step</p>
          <h2 id="client-setup-title" data-client-setup-title>Save your Shiloh passkey.</h2>
          <p data-client-setup-copy>Use your phone’s screen lock to open My Shiloh next time, without waiting for an SMS code.</p>
          <button class="button button--primary button--wide" type="button" data-client-setup-action>Save my passkey</button>
          <button class="client-setup__later" type="button" data-client-setup-later hidden>Maybe later</button>
          <p class="client-setup__status" role="status" aria-live="polite" data-client-setup-status></p>
        </section>` : ''}
        ${hero}
        ${authenticated ? '<section class="home-payments stack" data-client-home-payments aria-label="Payments needing attention" hidden></section><section class="home-forms stack" data-client-home-forms aria-label="Forms to complete before your visit" hidden></section>' : ''}
        ${focus}
        ${authenticated ? `<aside class="notification-invite" data-push-invite hidden aria-labelledby="notification-invite-title">
          <div><p class="eyebrow">Appointment updates</p><h2 id="notification-invite-title">Stay ready for your next visit.</h2><p>Get reminders and booking updates on this phone so your next visit stays on your radar.</p></div>
          <a class="button button--soft" href="#profile-notifications">Set up notifications</a>
        </aside>` : ''}
        ${authenticated ? `<section class="notification-centre" aria-labelledby="notification-centre-title" data-client-notification-centre hidden>
          <div class="section-heading"><div><p class="eyebrow">Current updates</p><h2 id="notification-centre-title">Your latest Shiloh updates.</h2></div><a class="text-link" href="#profile-notifications">Notification settings</a></div>
          <div class="notification-centre__list" data-client-notification-list aria-live="polite"><p class="notification-centre__empty">Checking for updates…</p></div>
          <a class="notification-centre__toggle" href="#profile-archived-updates">Archived updates in Profile</a>
        </section>` : ''}

      </section>

      <section class="view" id="bookings" data-view="bookings" aria-labelledby="bookings-title" hidden>
        <div class="page-intro">
          <p class="eyebrow">Bookings</p>
          <h1 id="bookings-title">Your bookings.</h1>
          <p>${authenticated ? 'Check your appointment status and anything to complete before your visit.' : 'Sign in to see your appointments and request a new booking.'}</p>
        </div>
        ${authenticated ? '<a class="button button--primary bookings-new-action" href="/my-shiloh/book">Book another appointment</a>' : ''}
        ${authenticated ? `<details class="website-treatment-disclosure"><summary>Have a treatment code?</summary><form class="website-treatment-form" data-website-treatment-form>
          <label for="website-treatment-code">Have a treatment code from the website?</label>
          <div class="website-treatment-form__row"><input id="website-treatment-code" name="treatmentCode" inputmode="numeric" autocomplete="off" maxlength="12" placeholder="Enter or paste code" required pattern="[1-9][0-9]*"><button class="button button--soft" type="submit">Continue treatment</button></div>
          <p role="status" data-website-treatment-status></p>
        </form></details>` : ''}
        <p role="status" aria-live="polite" tabindex="-1" data-booking-proposal-status></p>
        <div class="stack" data-client-experience-bookings>
          <article class="action-card action-card--accent">
            <span class="action-number">01</span>
            <div><h2>${authenticated ? 'Loading your next booking…' : 'Book something new'}</h2><p>${authenticated ? 'We’re bringing your next appointment into view.' : 'Sign in securely first. Then choose your treatment and request a time in My Shiloh.'}</p></div>
            <a class="button button--primary" href="${authenticated ? '/my-shiloh/book' : '#home'}">${authenticated ? 'Book an appointment' : 'Sign in to book'}</a>
          </article>
          <article class="action-card">
            <span class="action-number">02</span>
            <div><h2>Change an appointment</h2><p>${authenticated ? 'Ask Shiloh here to help you reschedule or cancel your appointment.' : 'Ask for help to reschedule or cancel your appointment.'}</p></div>
            <a class="button button--soft" href="${escapeHtml(bookingsHelpHref)}"${bookingsHelpHref.startsWith('#') ? '' : ' rel="noopener noreferrer"'}>${bookingsHelpLabel}</a>
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
        <div class="quiet-card">
          <div><h2>Need help choosing?</h2><p>${choosingHelpCopy}</p></div>
          <button class="button button--soft" type="button" data-shiloh-prompt>Help me choose a treatment.</button>
        </div>
        <section class="assistant-chat" aria-label="Chat with Shiloh">
          <div class="assistant-chat__messages" data-shiloh-messages aria-live="polite" aria-relevant="additions">
            <div class="chat-bubble chat-bubble--shiloh">
              <span>Shiloh</span>
              <p>Hi ${firstName} 🌿 Ask me anything about your Shiloh visit, booking, forms or payment status.</p>
            </div>
          </div>
          <div class="assistant-continuation" data-whatsapp-continuation hidden>
            <p>You recently chatted with Shiloh on WhatsApp. Bring the last exchange into this private conversation?</p>
            <button class="button button--soft" type="button" data-whatsapp-continuation-accept>Continue from WhatsApp</button>
            <span role="status" data-whatsapp-continuation-status></span>
          </div>
          <div class="prompt-grid" aria-label="Suggested questions" data-client-experience-prompts>
            <button type="button" data-shiloh-prompt><span>Prepare</span><strong>What do I need before my appointment?</strong></button>
            <button type="button" data-shiloh-prompt><span>Manage</span><strong>Can I move my appointment?</strong></button>
            <button type="button" data-shiloh-prompt><span>Status</span><strong>What is my appointment status?</strong></button>
            <button type="button" data-shiloh-prompt><span>Payment</span><strong>What is my payment status?</strong></button>
          </div>
          <form class="assistant-composer" data-shiloh-chat-form>
            <label class="sr-only" for="my-shiloh-message">Message Shiloh</label>
            <textarea id="my-shiloh-message" data-shiloh-chat-input rows="1" maxlength="1000" placeholder="Ask Shiloh…" autocomplete="off"></textarea>
            <button class="button button--primary" type="submit" data-shiloh-chat-send>Send</button>
          </form>
          <p class="assistant-chat__note">For any change, Shiloh will show you what will happen and ask you to confirm.</p>
          <a class="text-link assistant-whatsapp-fallback" href="${escapeHtml(speakToReception)}" rel="noopener noreferrer">Message Reception →</a>
          <p class="assistant-chat__note">This opens WhatsApp so you can message Reception directly. You can still chat with Shiloh here.</p>
        </section>` : `
        <a class="button button--primary button--wide" href="${escapeHtml(speakToReception)}" rel="noopener noreferrer">Message Reception</a>
        <div class="prompt-grid" aria-label="Things Shiloh can help with">
          <article><span>Choose</span><strong>What would suit me?</strong></article>
          <article><span>Manage</span><strong>Move my appointment</strong></article>
          <article><span>Prepare</span><strong>What do I need before I arrive?</strong></article>
          <article><span>Visit</span><strong>Help me plan my visit</strong></article>
        </div>`}
      </section>

      <section class="view" id="wallet" data-view="wallet" aria-labelledby="wallet-title" hidden>
        ${wallet}
      </section>

      <section class="view" id="profile" data-view="profile" aria-labelledby="profile-title" hidden>
        ${profile}
      </section>
    </main>

    <nav class="bottom-nav" aria-label="My Shiloh">
      <a href="#home" data-view-target="home" aria-current="page">${renderShilohIcon('home', { size: 24, className: 'nav-icon' })}<span>Home</span></a>
      <a href="#bookings" data-view-target="bookings">${renderShilohIcon('calendar', { size: 24, className: 'nav-icon' })}<span>Bookings</span></a>
      <a class="nav-shiloh" href="#shiloh" data-view-target="shiloh"><span class="nav-orb" aria-hidden="true">S</span><span>Shiloh</span></a>
      <a href="#wallet" data-view-target="wallet">${renderShilohIcon('wallet', { size: 24, className: 'nav-icon' })}<span>Wallet</span></a>
      <a href="#profile" data-view-target="profile">${renderShilohIcon('person', { size: 24, className: 'nav-icon' })}<span>Profile</span></a>
    </nav>
  </div>

  <div class="install-sheet" data-install-sheet hidden>
    <button class="install-sheet__backdrop" type="button" data-install-close aria-label="Close install help"></button>
    <section class="install-sheet__panel" role="dialog" aria-modal="true" aria-labelledby="install-title">
      <button class="install-sheet__close" type="button" data-install-close aria-label="Close">×</button>
      <span class="brand-mark brand-mark--large" aria-hidden="true"><img src="/my-shiloh/assets/icon-192.png" alt=""></span>
      <p class="eyebrow" data-install-eyebrow>Install My Shiloh</p>
      <h2 id="install-title" data-install-title>Add My Shiloh to your Home Screen.</h2>
      <p class="install-sheet__lead" data-install-lead>It only takes a moment, and you’ll be able to open My Shiloh like any other app.</p>
      <ol class="install-steps" data-install-steps>
        <li><span class="install-step__number">1</span><div><strong data-install-step-title="1">Open your browser menu or Share button</strong><span data-install-step-copy="1">Use your browser’s sharing or install menu.</span></div></li>
        <li><span class="install-step__number">2</span><div><strong data-install-step-title="2">Choose Add to Home Screen or Install app</strong><span data-install-step-copy="2">Your phone will show the installation option.</span></div></li>
        <li><span class="install-step__number">3</span><div><strong data-install-step-title="3">Open My Shiloh</strong><span data-install-step-copy="3">Tap the new My Shiloh icon on your Home Screen.</span></div></li>
        <li data-install-step-extra hidden><span class="install-step__number">4</span><div><strong data-install-step-title="4"></strong><span data-install-step-copy="4"></span></div></li>
      </ol>
      <div class="install-tip" data-install-tip hidden></div>
      <button class="button button--primary button--wide" type="button" data-install-close>Got it</button>
    </section>
  </div>

  <link rel="stylesheet" href="/my-shiloh/assets/confirmation.css?v=${MY_SHILOH_ASSET_VERSION}">
  <script src="/my-shiloh/assets/confirmation.js?v=${MY_SHILOH_ASSET_VERSION}" defer></script>
  <script src="/my-shiloh/assets/app.js?v=${MY_SHILOH_ASSET_VERSION}" defer></script>
</body>
</html>`;
}

module.exports = {
  escapeHtml,
  whatsappUrl,
  serviceCards,
  johannesburgGreeting,
  renderMyShilohPage,
  PUBLIC_BRAND_NAME,
  PUBLIC_TAGLINE,
  MY_SHILOH_ASSET_VERSION,
};
