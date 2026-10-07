import presentation from '../src/presentation/myShilohPwa.js';
import bookingPresentation from '../src/presentation/myShilohBooking.js';
import couplesBookingPresentation from '../src/presentation/myShilohCouplesBooking.js';
import bookingPolicyAuthority from '../src/config/bookingPolicyAuthority.js';

const { renderMyShilohPage } = presentation;
const { renderMyShilohBookingPage } = bookingPresentation;
const { BOOKING_POLICY_TEXT } = bookingPolicyAuthority;

const catalogue = [
  { id: 101, name: 'Full Body Swedish', category: 'Massage', duration: '60 min', price: 'R720' },
  { id: 102, name: 'Hot Stone Massage', category: 'Massage', duration: '75 min', price: 'R850' },
  { id: 103, name: 'Signature Pedicure', category: 'Pedicures & Foot Care', duration: '75 min', price: 'R620' },
  { id: 104, name: 'SQT BioMicroneedling', category: 'Aesthetic Services', duration: '60 min', price: 'R1 250' },
];

function productionSurface(client = null, options = {}) {
  const page = renderMyShilohPage({
    whatsappNumber: '27830000000',
    catalogue,
    client,
    ...options,
    now: new Date('2026-09-18T18:00:00.000Z'),
  });
  const body = String(page).match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || '';
  const root = document.createElement('div');
  root.innerHTML = `<link rel="stylesheet" href="/my-shiloh/assets/app.css"><div data-story-surface>${body.replace(/<script[\s\S]*?<\/script>/g, '')}</div>`;
  const frame = root.querySelector('[data-app-frame]');
  if (frame) frame.hidden = false;
  return root;
}


function installShareIconMarkup() {
  return '<svg class="install-share-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M12 15V3m0 0-4 4m4-4 4 4M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function installGuideIconMarkup(kind) {
  const path = kind === 'page-menu'
    ? 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm2 5h10M7 12h10M7 15h6'
    : 'M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm6 5v8m-4-4h8';
  return `<svg class="install-share-icon install-${kind}-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function applyInstallStep(surface, index, title, copy) {
  const number = String(index);
  const titleNode = surface.querySelector(`[data-install-step-title="${number}"]`);
  const copyNode = surface.querySelector(`[data-install-step-copy="${number}"]`);
  if (titleNode) {
    if (/^Tap Share/.test(title)) titleNode.innerHTML = `${installShareIconMarkup()} Tap Share`;
    else if (title === 'Open Safari’s page menu') titleNode.innerHTML = `${installGuideIconMarkup('page-menu')} ${title}`;
    else if (title === 'Choose Add to Home Screen') titleNode.innerHTML = `${installGuideIconMarkup('add-home')} ${title}`;
    else titleNode.textContent = title;
  }
  if (copyNode) {
    if (title === 'Open Safari’s page menu') {
      const splitAt = copy.indexOf('Share');
      const before = copy.slice(0, splitAt);
      const after = copy.slice(splitAt + 'Share'.length);
      copyNode.replaceChildren(document.createTextNode(before));
      const icon = document.createElement('span');
      icon.innerHTML = installShareIconMarkup();
      const share = icon.firstElementChild;
      share.classList.add('install-step-copy-icon');
      copyNode.append(share, document.createTextNode(`Share${after}`));
    } else copyNode.textContent = copy;
  }
}

function bookingSurface() {
  const page = renderMyShilohBookingPage({
    catalogue: [
      { id: 101, name: 'Hot Stone Massage', category: 'Massage', duration: '75 min', price: 'R850' },
      { id: 103, name: 'Signature Pedicure', category: 'Pedicures & Foot Care', duration: '75 min', price: 'R620' },
    ],
    clientFirstName: 'Jean-Pierre',
    csrfToken: 'storybook-csrf',
    bookingPolicyText: BOOKING_POLICY_TEXT,
    depositPolicy: {
      rateBasisPoints: 5000,
      freeNoticeHours: 48,
      partialNoticeHours: 24,
      partialForfeitBasisPoints: 5000,
      lateForfeitBasisPoints: 10000,
    },
  });
  const source = String(page);
  const body = source.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || '';
  const styles = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n');
  const root = document.createElement('div');
  root.innerHTML = `<style>${styles}</style><div data-story-surface>${body.replace(/<script[\s\S]*?<\/script>/g, '')}</div>`;
  return root;
}

export default {
  title: 'Client/My Shiloh PWA',
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
  },
};

export const GuestHome = {
  render: () => productionSurface(),
};

export const PasskeyGuest = {
  render: () => productionSurface(null, { passkeysAvailable: true }),
};

export const SmsAndPasskeyGuest = {
  render: () => productionSurface(null, { passkeysAvailable: true, smsAvailable: true }),
};

export const RegisterEntry = {
  render: () => {
    const surface = productionSurface(null, { passkeysAvailable: true, smsAvailable: true });
    surface.querySelector('[data-view="home"] [data-client-sms-choice]').hidden = false;
    surface.querySelector('[data-view="home"] [data-client-sms-open="register"]').setAttribute('aria-expanded', 'true');
    return surface;
  },
};

export const NewPhoneRecovery = {
  render: () => {
    const surface = productionSurface(null, { passkeysAvailable: true, smsAvailable: true });
    const home = surface.querySelector('[data-view="home"]');
    home.querySelector('[data-client-sms-choice]').hidden = false;
    home.querySelector('[data-client-sms-title]').textContent = 'Open My Shiloh on your new phone';
    home.querySelector('[data-client-sms-copy]').textContent = 'Verify the mobile number on your existing Shiloh profile with an SMS code, then save a passkey on this phone.';
    home.querySelector('[data-client-sms-open="recover"]').setAttribute('aria-expanded', 'true');
    return surface;
  },
};

export const SmsCodeEntry = {
  render: () => {
    const surface = productionSurface(null, { passkeysAvailable: true, smsAvailable: true });
    const choice = surface.querySelector('[data-view="home"] [data-client-sms-choice]');
    if (choice) choice.hidden = false;
    const code = surface.querySelector('[data-view="home"] [data-client-sms-complete]');
    if (code) code.hidden = false;
    const status = surface.querySelector('[data-view="home"] [data-auth-status]');
    if (status) status.textContent = 'Check your SMS and enter the code below.';
    return surface;
  },
};

export const PasskeyRecovery = {
  render: () => {
    const surface = productionSurface(null, { passkeysAvailable: true, smsAvailable: true });
    const home = surface.querySelector('[data-view="home"] .passkey-recovery');
    if (home) home.open = true;
    return surface;
  },
};

export const AuthenticatedHome = {
  render: () => productionSurface({
    id: '912',
    name: 'Christel Botha',
    firstName: 'Christel',
  }),
};

export const FirstSignInPasskeySetup = {
  render: () => {
    const surface = productionSurface({ id: '912', name: 'Jean-Pierre Botha', firstName: 'Jean-Pierre' },
      { passkeysAvailable: true, signInMethod: 'sms_code' });
    const setup = surface.querySelector('[data-client-setup]');
    setup.hidden = false;
    setup.dataset.step = 'passkey';
    return surface;
  },
};

export const FirstSignInNotificationSetup = {
  render: () => {
    const surface = FirstSignInPasskeySetup.render();
    const setup = surface.querySelector('[data-client-setup]');
    setup.dataset.step = 'notifications';
    setup.querySelector('[data-client-setup-step]').textContent = 'Next, stay in the know';
    setup.querySelector('[data-client-setup-title]').textContent = 'Stay ready for every visit.';
    setup.querySelector('[data-client-setup-copy]').textContent = 'Get appointment reminders and updates about your bookings, forms, payments, vouchers and Rewards on this phone. You can turn these off any time in Profile.';
    setup.querySelector('[data-client-setup-action]').textContent = 'Turn on notifications';
    setup.querySelector('[data-client-setup-later]').hidden = false;
    return surface;
  },
};

export const LongNameNotificationInvite = {
  render: () => {
    const surface = productionSurface({
      id: '914',
      name: 'Alexandra-Marguerite van der Merwe',
      firstName: 'Alexandra-Marguerite',
    });
    const invite = surface.querySelector('[data-push-invite]');
    if (invite) invite.hidden = false;
    return surface;
  },
};

export const AuthenticatedAssistantComposer = {
  render: () => {
    const surface = AuthenticatedHome.render();
    surface.querySelectorAll('[data-view]').forEach((view) => {
      const active = view.dataset.view === 'shiloh';
      view.hidden = !active;
      view.classList.toggle('is-active', active);
    });
    surface.querySelectorAll('[data-view-target]').forEach((item) => {
      if (item.dataset.viewTarget === 'shiloh') item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    return surface;
  },
};

export const BookingRequestPlanning = {
  render: () => {
    const surface = AuthenticatedHome.render();
    const home = surface.querySelector('[data-client-experience-home]');
    if (home) {
      const eyebrow = home.querySelector('.eyebrow');
      if (eyebrow) eyebrow.textContent = 'Your booking request';
      home.querySelector('h2').textContent = 'Shiloh is planning your request.';
      home.querySelector(':scope > p').textContent = 'You requested Hot Stone Massage for Fri, 2 Oct at 10:00. Reception will review the arrangement before confirming it. This appointment is not confirmed yet.';
      const status = home.querySelector('.status-pill');
      if (status) status.textContent = 'Requested';
      const values = { appointment: 'Requested', forms: 'Nothing to do yet', payment: 'No action yet' };
      home.querySelectorAll('[data-client-experience-fact]').forEach((button) => {
        const value = button.querySelector('strong');
        if (value) value.textContent = values[button.dataset.factKey] || '';
      });
      const action = home.querySelector('[data-client-experience-primary]');
      if (action) { action.href = '#bookings'; action.textContent = 'View request'; }
    }
    const bookings = surface.querySelector('[data-client-experience-bookings] .action-card');
    if (bookings) {
      bookings.querySelector('h2').textContent = 'Requested';
      bookings.querySelector('p').textContent = 'Hot Stone Massage · Fri, 2 Oct · 10:00 · Reception is reviewing your request. The appointment has not been confirmed.';
    }
    return surface;
  },
};

export const ReceptionPlanningStarted = {
  render: () => {
    const surface = BookingRequestPlanning.render();
    const home = surface.querySelector('[data-client-experience-home]');
    const status = home?.querySelector('.status-pill');
    if (status) status.textContent = 'Planning';
    const fact = home?.querySelector('[data-client-experience-fact][data-fact-key="appointment"] strong');
    if (fact) fact.textContent = 'Planning';
    const title = surface.querySelector('[data-client-experience-bookings] .action-card h2');
    if (title) title.textContent = 'Planning';
    return surface;
  },
};

export const AppointmentChangeRequested = {
  render: () => {
    const surface = AuthenticatedHome.render();
    const home = surface.querySelector('[data-client-experience-home]');
    if (home) {
      const eyebrow = home.querySelector('.eyebrow');
      if (eyebrow) eyebrow.textContent = 'Your appointment';
      home.querySelector('h2').textContent = 'Your time change is awaiting review.';
      home.querySelector(':scope > p').textContent = 'Hot Stone Massage: You asked to move to Wed, 30 Sept at 10:00. Your current appointment remains at Sun, 27 Sept at 10:00 until the change is approved.';
      const status = home.querySelector('.status-pill');
      if (status) status.textContent = 'Change requested';
      const fact = home.querySelector('[data-client-experience-fact][data-fact-key="appointment"] strong');
      if (fact) fact.textContent = 'Change requested';
      const action = home.querySelector('[data-client-experience-primary]');
      if (action) { action.href = '#bookings'; action.textContent = 'View request'; }
    }
    const bookings = surface.querySelector('[data-client-experience-bookings] .action-card');
    if (bookings) {
      bookings.querySelector('h2').textContent = 'Change requested';
      bookings.querySelector('p').textContent = 'Hot Stone Massage · Sun, 27 Sept · 10:00 · You asked to move to Wed, 30 Sept at 10:00. Your current appointment remains at Sun, 27 Sept at 10:00 until the change is approved.';
    }
    return surface;
  },
};

export const AuthenticatedProfile = {
  render: () => {
    const surface = productionSurface({
      id: '913',
      name: 'Jean-Pierre Botha',
      firstName: 'Jean-Pierre',
    });
    surface.querySelectorAll('[data-view]').forEach((view) => {
      const active = view.dataset.view === 'profile';
      view.hidden = !active;
      view.classList.toggle('is-active', active);
    });
    surface.querySelectorAll('[data-view-target]').forEach((item) => {
      if (item.dataset.viewTarget === 'profile') item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    const form = surface.querySelector('[data-client-profile-form]');
    if (form) {
      form.elements.name.value = 'Jean-Pierre Botha';
      form.elements.dateOfBirth.value = '1985-06-14';
      form.elements.gender.value = 'male';
      form.querySelectorAll('input,select,button').forEach((control) => { control.disabled = false; });
    }
    const mobile = surface.querySelector('[data-client-profile-mobile]');
    if (mobile) mobile.textContent = '+27 •• ••• 2646';
    const status = surface.querySelector('[data-client-profile-status]');
    if (status) {
      status.dataset.state = 'success';
      status.textContent = 'Your registration details are complete.';
    }
    return surface;
  },
};

export const PasskeyProfile = {
  render: () => {
    const surface = productionSurface({
      id: '913', name: 'Jean-Pierre Botha', firstName: 'Jean-Pierre',
    }, { passkeysAvailable: true, signInMethod: 'passkey' });
    surface.querySelectorAll('[data-view]').forEach((view) => {
      const active = view.dataset.view === 'profile';
      view.hidden = !active;
      view.classList.toggle('is-active', active);
    });
    const devices = surface.querySelector('[data-passkey-devices]');
    if (devices) devices.innerHTML = `<ul class="passkey-device-list">
      <li class="passkey-device"><div><strong>iPhone</strong><small>Saved 27 Sep 2026 · Last used 27 Sep 2026</small></div><button class="button button--soft" type="button" aria-label="Remove iPhone passkey">Remove</button></li>
      <li class="passkey-device"><div><strong>Mac</strong><small>Saved 26 Sep 2026 · Not used yet</small></div><button class="button button--soft" type="button" aria-label="Remove Mac passkey">Remove</button></li>
    </ul>`;
    return surface;
  },
};

export const PasskeyRecoveryCode = {
  render: () => {
    const surface = PasskeyProfile.render();
    const code = surface.querySelector('[data-passkey-recovery-code]');
    code.hidden = false;
    code.textContent = 'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z1234-56789-ABCDE';
    surface.querySelector('[data-passkey-recovery-create-status]').textContent =
      'Save this code privately now. It works once and will not be shown again.';
    return surface;
  },
};


export const BrowserInstallDoorway = {
  render: () => {
    const surface = productionSurface();
    const gate = surface.querySelector('[data-install-gate]');
    const frame = surface.querySelector('[data-app-frame]');
    if (gate) gate.hidden = false;
    if (frame) frame.hidden = true;
    const action = surface.querySelector('[data-install-gate-action]');
    if (action) action.textContent = 'Show install steps';
    return surface;
  },
};

export const IPhoneInstallGuide = {
  render: () => {
    const surface = productionSurface();
    const gate = surface.querySelector('[data-install-gate]');
    const frame = surface.querySelector('[data-app-frame]');
    const sheet = surface.querySelector('[data-install-sheet]');
    if (gate) gate.hidden = false;
    if (frame) frame.hidden = true;
    if (sheet) sheet.hidden = false;
    const action = surface.querySelector('[data-install-gate-action]');
    const gateTitle = surface.querySelector('[data-install-gate-title]');
    const gateCopy = surface.querySelector('[data-install-gate-copy]');
    if (action) action.textContent = 'Install My Shiloh';
    if (gateTitle) gateTitle.textContent = 'Add My Shiloh to your iPhone.';
    if (gateCopy) gateCopy.textContent = 'You’re in Safari. Add My Shiloh to your Home Screen in three quick steps.';
    const eyebrow = surface.querySelector('[data-install-eyebrow]');
    const title = surface.querySelector('[data-install-title]');
    const lead = surface.querySelector('[data-install-lead]');
    if (eyebrow) eyebrow.textContent = 'Install My Shiloh on iPhone';
    if (title) title.textContent = 'Three quick steps.';
    if (lead) lead.textContent = 'Stay in Safari — no App Store download is needed.';
    const steps = [
      ['Open Safari’s page menu', 'At the bottom, tap the page menu, then Share. If you see a Share button directly, tap it.'],
      ['Choose Add to Home Screen', 'Scroll down the Share list. If missing, use Edit Actions to add it.'],
      ['Turn on Open as Web App, then tap Add', 'My Shiloh will appear on your Home Screen.'],
    ];
    steps.forEach(([stepTitle, stepCopy], index) => {
      applyInstallStep(surface, index + 1, stepTitle, stepCopy);
    });
    const extra = surface.querySelector('[data-install-step-extra]');
    if (extra) extra.hidden = true;
    const tip = surface.querySelector('[data-install-tip]');
    if (tip) tip.hidden = true;
    return surface;
  },
};

export const IPhoneChromeInstallGuide = {
  render: () => {
    const surface = IPhoneInstallGuide.render();
    const gateTitle = surface.querySelector('[data-install-gate-title]');
    const gateCopy = surface.querySelector('[data-install-gate-copy]');
    const gateAction = surface.querySelector('[data-install-gate-action]');
    const eyebrow = surface.querySelector('[data-install-eyebrow]');
    const title = surface.querySelector('[data-install-title]');
    const lead = surface.querySelector('[data-install-lead]');
    if (gateTitle) gateTitle.textContent = 'Add My Shiloh to your iPhone.';
    if (gateCopy) gateCopy.textContent = 'You’re in Chrome. Use Share to add My Shiloh to your Home Screen.';
    if (gateAction) gateAction.textContent = 'Install My Shiloh';
    if (eyebrow) eyebrow.textContent = 'Install My Shiloh on iPhone';
    if (title) title.textContent = 'Three quick steps.';
    if (lead) lead.textContent = 'You can add My Shiloh straight from Chrome — no App Store download is needed.';
    const steps = [
      ['Tap Share', 'Use the Share button beside the address bar.'],
      ['Choose Add to Home Screen', 'Scroll if you do not see it straight away.'],
      ['Tap Add', 'My Shiloh will appear on your Home Screen.'],
    ];
    steps.forEach(([stepTitle, stepCopy], index) => {
      applyInstallStep(surface, index + 1, stepTitle, stepCopy);
    });
    return surface;
  },
};

export const IPhoneGoogleInstallGuide = {
  render: () => {
    const surface = IPhoneInstallGuide.render();
    const gateCopy = surface.querySelector('[data-install-gate-copy]');
    const gateAction = surface.querySelector('[data-install-gate-action]');
    const title = surface.querySelector('[data-install-title]');
    const lead = surface.querySelector('[data-install-lead]');
    if (gateCopy) gateCopy.textContent = 'You’re in the Google app. Open My Shiloh in Safari or Chrome first. Check that the address says app.shilohmtc.co.za before adding it to your Home Screen.';
    if (gateAction) gateAction.textContent = 'Install My Shiloh';
    if (title) title.textContent = 'Open in your browser first.';
    if (lead) lead.textContent = 'Use Safari or Chrome. The address must say app.shilohmtc.co.za, not share.google.';
    const steps = [
      ['Open in Safari or Chrome', 'Use Open in browser in the Google app’s Share menu.'],
      ['Check the address', 'If you see share.google, enter app.shilohmtc.co.za/my-shiloh/ in your browser.'],
      ['Tap Share', 'Choose Add to Home Screen in your browser’s Share menu.'],
      ['Tap Add', 'If offered, turn on Open as Web App. Then open the new My Shiloh icon.'],
    ];
    steps.forEach(([stepTitle, stepCopy], index) => applyInstallStep(surface, index + 1, stepTitle, stepCopy));
    const extra = surface.querySelector('[data-install-step-extra]');
    if (extra) extra.hidden = false;
    return surface;
  },
};

export const AndroidInstallDoorway = {
  render: () => {
    const surface = productionSurface();
    const gate = surface.querySelector('[data-install-gate]');
    const frame = surface.querySelector('[data-app-frame]');
    if (gate) gate.hidden = false;
    if (frame) frame.hidden = true;
    const gateTitle = surface.querySelector('[data-install-gate-title]');
    const gateCopy = surface.querySelector('[data-install-gate-copy]');
    const action = surface.querySelector('[data-install-gate-action]');
    if (gateTitle) gateTitle.textContent = 'Add My Shiloh to your phone.';
    if (gateCopy) gateCopy.textContent = 'Keep your bookings and vouchers close at hand.';
    if (action) action.textContent = 'Install My Shiloh';
    return surface;
  },
};


export const StandaloneGuestSignIn = {
  render: () => {
    const surface = productionSurface();
    const gate = surface.querySelector('[data-install-gate]');
    const frame = surface.querySelector('[data-app-frame]');
    if (gate) gate.hidden = true;
    if (frame) frame.hidden = false;
    return surface;
  },
};


export const AuthenticatedBrowserInstallDoorway = {
  render: () => {
    const surface = productionSurface({
      id: '912',
      name: 'Christel Botha',
      firstName: 'Christel',
    });
    const gate = surface.querySelector('[data-install-gate]');
    const frame = surface.querySelector('[data-app-frame]');
    if (gate) gate.hidden = false;
    if (frame) frame.hidden = true;
    const action = surface.querySelector('[data-install-gate-action]');
    if (action) action.textContent = 'Show install steps';
    return surface;
  },
};

export const WebsiteTreatmentHandoff = {
  render: () => {
    const surface = productionSurface(null, { selectedServiceId: '103' });
    const gate = surface.querySelector('[data-install-gate]');
    if (gate) gate.hidden = false;
    return surface;
  },
};


export const FirstLaunchAuthenticatedSession = {
  render: () => {
    const surface = productionSurface({
      id: '913',
      name: 'Jean-Pierre Botha',
      firstName: 'Jean-Pierre',
    });
    const installGate = surface.querySelector('[data-install-gate]');
    const frame = surface.querySelector('[data-app-frame]');
    if (installGate) installGate.hidden = true;
    if (frame) frame.hidden = false;
    return surface;
  },
};


export const AuthenticatedDepositRequired = {
  render: () => {
    const surface = productionSurface({ id: '912', name: 'Christel Botha', firstName: 'Christel' });
    const payments = surface.querySelector('[data-client-home-payments]');
    payments.hidden = false;
    payments.innerHTML = '<article class="action-card action-card--accent"><h2>R340 deposit required</h2><p>Hot Stone Massage · Wed, 30 Sep · 10:00</p><p data-story-payment-message>Pay your deposit to confirm your booking.</p><a class="button button--primary" href="/pay/dep_storybook123">Pay R340 deposit</a></article>';
    const home = surface.querySelector('[data-client-experience-home]');
    home.querySelector('.eyebrow').textContent = 'Next visit';
    home.querySelector('h2').textContent = 'Your next appointment';
    home.querySelector(':scope > p').textContent = 'Hot Stone Massage · Wed, 30 Sep · 10:00 · Christel';
    home.querySelector('.status-pill').textContent = 'Deposit required';
    const action = home.querySelector('[data-client-experience-primary]');
    action.href = '#bookings';
    action.textContent = 'View booking';
    const voucher = surface.querySelector('[data-welcome-voucher]');
    if (voucher) voucher.hidden = true;
    return surface;
  },
};

export const AuthenticatedDepositLinkUnavailable = {
  render: () => {
    const surface = AuthenticatedDepositRequired.render();
    const payments = surface.querySelector('[data-client-home-payments]');
    payments.querySelector('[data-story-payment-message]').textContent = 'Pay your deposit to confirm your booking. Your payment link is not ready. Please ask Shiloh for help.';
    const action = payments.querySelector('a');
    action.href = '#shiloh';
    action.textContent = 'Ask Shiloh about my deposit';
    return surface;
  },
};

export const AuthenticatedHomeSummaryActions = {
  render: () => {
    const surface = productionSurface({
      id: '912',
      name: 'Christel Botha',
      firstName: 'Christel',
    });
    const home = surface.querySelector('[data-client-experience-home]');
    if (home) {
      const heading = home.querySelector('h2');
      const copy = home.querySelector(':scope > p');
      const status = home.querySelector('.status-pill');
      if (heading) heading.textContent = 'Ready when you are, Christel.';
      if (copy) copy.textContent = 'There is no upcoming appointment linked to your secure client profile right now.';
      if (status) status.textContent = 'Ready';
      const values = {
        appointment: 'None upcoming',
        forms: 'Nothing waiting',
        payment: 'No active booking',
      };
      home.querySelectorAll('[data-client-experience-fact]').forEach((button) => {
        const value = button.querySelector('strong');
        if (value) value.textContent = values[button.dataset.factKey] || '';
      });
      const action = home.querySelector('[data-client-experience-primary]');
      if (action) { action.href = '/my-shiloh/book'; action.textContent = 'Book an appointment'; }
    }
    const voucher = surface.querySelector('[data-welcome-voucher]');
    if (voucher) voucher.hidden = true;
    return surface;
  },
};


export const AuthenticatedWallet = {
  render: () => {
    const surface = productionSurface({
      id: '913',
      name: 'Jean-Pierre Botha',
      firstName: 'Jean-Pierre',
    });
    surface.querySelectorAll('[data-view]').forEach((view) => {
      const active = view.dataset.view === 'wallet';
      view.hidden = !active;
      view.classList.toggle('is-active', active);
    });
    surface.querySelectorAll('[data-view-target]').forEach((item) => {
      if (item.dataset.viewTarget === 'wallet') item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    const voucher = surface.querySelector('[data-welcome-voucher]');
    if (voucher) voucher.hidden = true;
    return surface;
  },
};


export const UpdateAvailable = {
  render: () => {
    const surface = productionSurface({
      id: '913',
      name: 'Jean-Pierre Botha',
      firstName: 'Jean-Pierre',
    });
    const banner = surface.querySelector('[data-app-update]');
    if (banner) banner.hidden = false;
    return surface;
  },
};

export const AuthenticatedNotificationsProfile = {
  render: () => {
    const surface = AuthenticatedProfile.render();
    const button = surface.querySelector('[data-push-toggle]');
    const status = surface.querySelector('[data-push-status]');
    if (button) {
      button.disabled = false;
      button.textContent = 'Turn on notifications';
      button.dataset.enabled = 'false';
    }
    if (status) status.textContent = 'Notifications are off. Turn them on when you’re ready.';
    return surface;
  },
};


export const AuthenticatedNativeBooking = {
  render: () => bookingSurface(),
};

function proposalSurface({ busy = false, error = '', expired = false } = {}) {
  const surface = AuthenticatedHome.render();
  surface.querySelectorAll('[data-view]').forEach(view => { view.hidden = view.dataset.view !== 'bookings'; });
  const card = surface.querySelector('[data-client-experience-bookings] .action-card');
  card.querySelector('h2').textContent = expired ? 'Requested' : 'Awaiting your response';
  card.querySelector('p').textContent = expired
    ? 'The proposed time has expired. Reception is reviewing your request. Your appointment is not confirmed.'
    : 'Hot Stone Massage · Fri, 2 Oct · 10:00 · Abigail — Review this proposed time before accepting. Availability and any required deposit will be checked again.';
  card.querySelector('a').textContent = 'Ask Shiloh about this request';
  card.querySelector('a').href = '#shiloh';
  if (!expired) {
    const controls = document.createElement('div');
    controls.className = 'booking-proposal-controls';
    controls.dataset.bookingProposalControls = '';
    controls.innerHTML = `<p>Please respond before 1 Oct, 15:00.</p><div class="booking-proposal-choices"><button type="button" class="button button--primary" ${busy ? 'disabled' : ''}>Accept this time</button><button type="button" class="button button--soft" ${busy ? 'disabled' : ''}>Ask for another option</button></div>`;
    card.append(controls);
  }
  surface.querySelector('[data-booking-proposal-status]').textContent = error || (busy ? 'Checking this time and your booking details…' : '');
  return surface;
}
export const AlternativeTimeOffer = { render: () => proposalSurface() };
export const AlternativeTimeChecking = { render: () => proposalSurface({ busy:true }) };
export const AlternativeTimeReviewNeeded = { render: () => proposalSurface({ error:'Reception needs to review the price or deposit before this time can be accepted. Your proposal has not been confirmed.' }) };
export const AlternativeTimeExpired = { render: () => proposalSurface({ expired:true }) };

export const MultipleAppointmentReview = {
  render: () => {
    const root = bookingSurface();
    root.querySelectorAll('[data-step]').forEach(node => { node.hidden = node.dataset.step !== '4'; });
    root.querySelectorAll('[data-progress]').forEach(node => node.classList.toggle('is-active',node.dataset.progress === '4'));
    root.querySelector('[data-current-review]').hidden = true;
    const host = root.querySelector('[data-cart-items]'); host.hidden = false;
    host.innerHTML = '<div class="cart-item"><strong>1. Hot Stone Massage</strong><small>Christel · Mon, 02 Nov 2026 · 10:00–11:15</small><small>R850.00</small><button class="button button--soft" type="button" aria-label="Change appointment 1">Change</button><button class="button button--soft" type="button" aria-label="Remove appointment 1">Remove</button></div><div class="cart-item"><strong>2. Signature Pedicure</strong><small>Abigail · Tue, 03 Nov 2026 · 10:00–11:15</small><small>R620.00</small><button class="button button--soft" type="button" aria-label="Change appointment 2">Change</button><button class="button button--soft" type="button" aria-label="Remove appointment 2">Remove</button></div>';
    root.querySelector('[data-cart-totals]').hidden = false;
    root.querySelector('[data-cart-total]').textContent = 'R1470.00';
    root.querySelector('[data-cart-deposit]').textContent = 'R735.00';
    root.querySelector('[data-review-deposit]').textContent = 'One deposit payment after every appointment is approved';
    root.querySelector('[data-change-time]').hidden = true;
    root.querySelector('[data-submit-booking]').textContent = 'Send booking requests';
    return root;
  },
};

export const ArchivedUpdates = {
  render: () => {
    const surface = AuthenticatedProfile.render();
    surface.querySelector('[data-profile-archived-updates]').open = true;
    surface.querySelector('[data-client-archived-notification-list]').innerHTML = '<div class="notification-centre__row"><a class="notification-centre__item" href="#profile-reports"><strong>Your problem report is resolved</strong><span>Your personal details now save correctly. Thank you for reporting this.</span></a><button class="notification-centre__archive" type="button">Restore</button></div>';
    return surface;
  },
};

export const BookForTwo = {
  render: () => {
    const source = couplesBookingPresentation.renderMyShilohCouplesBookingPage({ catalogue,clientFirstName:'Jean-Pierre',csrfToken:'storybook-csrf',bookingPolicyText:BOOKING_POLICY_TEXT });
    const styles = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n');
    const body = source.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || '';
    const root = document.createElement('div');
    root.innerHTML = `<style>${styles}</style><div data-story-surface>${body.replace(/<script[\s\S]*?<\/script>/g, '')}</div>`;
    return root;
  },
};

export const LaterAppointmentDeposit = {
  render: () => {
    const surface = productionSurface({ id: '912', name: 'Jean-Pierre Botha', firstName: 'Jean-Pierre' });
    const payments = surface.querySelector('[data-client-home-payments]');
    payments.hidden = false;
    payments.innerHTML = '<article class="action-card action-card--accent"><h2>R295 deposit required</h2><p>Full Body Swedish · Tue, 6 Oct · 10:45</p><p>Pay your deposit to confirm your booking.</p><a class="button button--primary" href="/pay/story_deposit">Pay R295 deposit</a></article>';
    const home = surface.querySelector('[data-client-experience-home]');
    home.querySelector('h2').textContent = 'Your next visit';
    home.querySelector(':scope > p').textContent = 'Toe Gel Only · Tue, 6 Oct · 08:30 · Christel';
    return surface;
  },
};

export const CouplesBookingChoices = {
  render: () => {
    const surface = productionSurface({ id:'912',name:'Jean-Pierre Botha',firstName:'Jean-Pierre' });
    const home = surface.querySelector('[data-client-experience-home]');
    home.querySelector('h2').textContent = 'Ready when you are, Jean-Pierre.';
    home.querySelector(':scope > p').textContent = 'Choose a treatment for yourself or book together.';
    home.querySelector('.status-pill').textContent = 'Ready';
    home.querySelector('[data-client-home-couples]').hidden = false;
    return surface;
  },
};

function bookingHistorySurface({ hidden = true, expanded = false, busy = false, error = '' } = {}) {
  const surface = AuthenticatedHome.render();
  surface.querySelectorAll('[data-view]').forEach(view => {
    view.hidden = view.dataset.view !== 'bookings';
    view.classList.toggle('is-active', !view.hidden);
  });
  surface.querySelectorAll('[data-view-target]').forEach(item => {
    if (item.dataset.viewTarget === 'bookings') item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  const upcoming = surface.querySelector('[data-client-experience-bookings] .action-card');
  upcoming.querySelector('h2').textContent = 'Hot Stone Massage';
  upcoming.querySelector('p').textContent = 'Fri, 9 Oct · 10:00 · Christel';
  upcoming.querySelector('a').textContent = 'Pay deposit';
  const host = surface.querySelector('[data-booking-history]');
  host.hidden = false;
  const toggle = host.querySelector('[data-booking-history-toggle]');
  toggle.hidden = !hidden;
  toggle.textContent = expanded ? 'Close hidden requests (1)' : 'Show hidden requests (1)';
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.disabled = busy;
  const list = host.querySelector(hidden ? '[data-booking-history-hidden]' : '[data-booking-history-visible]');
  list.hidden = hidden && !expanded;
  list.innerHTML = `<article class="action-card booking-history-card"><div><h3>Quick Relief Back &amp; Neck</h3><p>Mon, 14 Sep · 10:00 · Christel</p><p>Could not accommodate</p></div><button class="button button--soft" type="button" ${busy ? 'disabled' : ''}>${hidden ? 'Restore to my bookings' : 'Hide from my bookings'}</button></article>`;
  surface.querySelector('[data-booking-history-status]').textContent = error || (busy ? 'Restoring this request…' : '');
  return surface;
}
export const BookingHistoryHidden = { render: () => bookingHistorySurface() };
export const BookingHistoryExpanded = { render: () => bookingHistorySurface({ expanded: true }) };
export const BookingHistoryRestored = { render: () => bookingHistorySurface({ hidden: false }) };
export const BookingHistorySaving = { render: () => bookingHistorySurface({ expanded: true, busy: true }) };
export const BookingHistoryError = { render: () => bookingHistorySurface({ expanded: true, error: 'We could not confirm this change. Reload Bookings and try again.' }) };

export const MissingDobRequest = {render:()=>{
  const root=productionSurface({id:55,name:'Synthetic Client',firstName:'Synthetic'});
  const request=root.querySelector('[data-dob-request]');request.hidden=false;
  request.querySelector('[data-dob-request-copy]').textContent='Please add your date of birth in Profile when you have a moment. Your existing bookings stay as they are.';
  return root;
}};
