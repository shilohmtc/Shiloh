import renderIphoneInstallGuide from '../public/my-shiloh/assets/iphone-install-guide.js';
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
  window.ShilohIphoneInstallGuide = renderIphoneInstallGuide;
  const page = renderMyShilohPage({
    whatsappNumber: '27830000000',
    catalogue,
    crmAvailable: true,
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


function bookingSurface() {
  const page = renderMyShilohBookingPage({
    catalogue: [
      { id: 101, name: 'Hot Stone Massage', category: 'Massage', duration: '75 min', price: 'R850' },
      { id: 103, name: 'Signature Pedicure', category: 'Pedicures & Foot Care', duration: '75 min', price: 'R620' },
    ],
    clientFirstName: 'Synthetic Client AI',
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

// Historic story IDs remain links to the new details-first experience.
export const SmsAndPasskeyGuest = { render: () => productionSurface(null, { passkeysAvailable: true }) };
export const RegisterEntry = { render: () => productionSurface(null, { passkeysAvailable: true }) };
export const NewPhoneRecovery = { render: () => productionSurface(null, { passkeysAvailable: true }) };
export const SmsCodeEntry = { render: () => productionSurface(null, { passkeysAvailable: true }) };
export const PasskeyRecovery = { render: () => productionSurface(null, { passkeysAvailable: true }) };

export const AuthenticatedHome = {
  render: () => productionSurface({
    id: '9012',
    name: 'Synthetic Client AM',
    firstName: 'Synthetic Client AN',
  }),
};

export const FirstSignInPasskeySetup = {
  render: () => {
    const surface = productionSurface({ id: '9012', name: 'Synthetic Client AO', firstName: 'Synthetic Client AI' },
      { passkeysAvailable: true, signInMethod: 'sms_code' });
    const setup = surface.querySelector('[data-client-setup]');
    setup.hidden = false;
    setup.dataset.step = 'passkey';
    setup.querySelector('[data-client-setup-step]').textContent = 'Save a passkey';
    setup.querySelector('[data-client-setup-title]').textContent = 'Make next time easier.';
    setup.querySelector('[data-client-setup-copy]').textContent = 'Save a passkey for quicker sign-in next time.';
    setup.querySelector('[data-client-setup-action]').textContent = 'Save a passkey';
    return surface;
  },
};

export const FirstSignInNotificationSetup = {
  render: () => {
    const surface = FirstSignInPasskeySetup.render();
    const setup = surface.querySelector('[data-client-setup]');
    setup.dataset.step = 'notifications';
    setup.querySelector('[data-client-setup-step]').textContent = 'Optional notifications';
    setup.querySelector('[data-client-setup-title]').textContent = 'Appointment reminders';
    setup.querySelector('[data-client-setup-copy]').textContent = 'Get updates and reminders about your appointments.';
    setup.querySelector('[data-client-setup-action]').textContent = 'Turn on notifications';
    setup.querySelector('[data-client-setup-later]').hidden = false;
    return surface;
  },
};

export const LongNameNotificationInvite = {
  render: () => {
    const surface = productionSurface({
      id: '914',
      name: 'Synthetic Client AP',
      firstName: 'Synthetic Client AQ',
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
      name: 'Synthetic Client AO',
      firstName: 'Synthetic Client AI',
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
      form.elements.name.value = 'Synthetic Client AO';
      form.elements.dateOfBirth.value = '2000-01-01';
      form.elements.gender.value = 'male';
      form.querySelectorAll('input,select,button').forEach((control) => { control.disabled = false; });
    }
    const mobile = surface.querySelector('[data-client-profile-mobile]');
    if (mobile) mobile.textContent = '0•• ••• 2646';
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
      id: '913', name: 'Synthetic Client AO', firstName: 'Synthetic Client AI',
    }, { passkeysAvailable: true, signInMethod: 'passkey' });
    surface.querySelectorAll('[data-view]').forEach((view) => {
      const active = view.dataset.view === 'profile';
      view.hidden = !active;
      view.classList.toggle('is-active', active);
    });
    surface.querySelector('[data-passkey-enroll]').hidden = true;
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
    if (action) action.textContent = 'Show iPhone steps';
    if (gateTitle) gateTitle.textContent = 'Add My Shiloh to your iPhone.';
    if (gateCopy) gateCopy.textContent = 'You’re in Safari. Add My Shiloh to your Home Screen.';
    const eyebrow = surface.querySelector('[data-install-eyebrow]');
    const title = surface.querySelector('[data-install-title]');
    const lead = surface.querySelector('[data-install-lead]');
    if (eyebrow) eyebrow.hidden = true;
    if (title) title.textContent = 'Add My Shiloh to your iPhone.';
    if (lead) lead.textContent = 'You won’t find it in the App Store. Add it from Safari or Chrome.';
    surface.querySelector('[data-install-browser-choice]').hidden = false;
    surface.querySelector('[data-install-browser]').value = 'safari';
    surface.querySelector('[data-install-browser-note]').hidden = false;
    surface.querySelector('[data-install-browser-note]').textContent = 'Safari steps. Pictures are guides, not buttons.';
    renderIphoneInstallGuide(surface.querySelector('[data-install-steps]'), 'safari');
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
    if (gateAction) gateAction.textContent = 'Show iPhone steps';
    if (eyebrow) eyebrow.hidden = true;
    if (title) title.textContent = 'Add My Shiloh to your iPhone.';
    surface.querySelector('[data-install-browser]').value = 'chrome';
    surface.querySelector('[data-install-browser-note]').textContent = 'Chrome steps. Pictures are guides, not buttons.';
    renderIphoneInstallGuide(surface.querySelector('[data-install-steps]'), 'chrome');
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
    if (gateAction) gateAction.textContent = 'Show iPhone steps';
    surface.querySelector('[data-install-browser]').value = '';
    surface.querySelector('[data-install-browser-note]').textContent = 'Open in your browser first, not in the Google app. Choose Safari or Chrome for the next steps.';
    renderIphoneInstallGuide(surface.querySelector('[data-install-steps]'), '', { handoff: true });
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
      id: '9012',
      name: 'Synthetic Client AM',
      firstName: 'Synthetic Client AN',
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
      name: 'Synthetic Client AO',
      firstName: 'Synthetic Client AI',
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
    const surface = productionSurface({ id: '9012', name: 'Synthetic Client AM', firstName: 'Synthetic Client AN' });
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
      id: '9012',
      name: 'Synthetic Client AM',
      firstName: 'Synthetic Client AN',
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
      name: 'Synthetic Client AO',
      firstName: 'Synthetic Client AI',
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
      name: 'Synthetic Client AO',
      firstName: 'Synthetic Client AI',
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

export const UnfinishedBookingDraft = {
  render: () => {
    const surface = bookingSurface();
    surface.querySelectorAll('[data-step]').forEach(node => { node.hidden = node.dataset.step !== '4'; });
    surface.querySelector('[data-review-service]').textContent = 'Hot Stone Massage';
    surface.querySelector('[data-review-practitioner]').textContent = 'Synthetic Practitioner';
    surface.querySelector('[data-review-date]').textContent = 'Mon, 2 Nov 2026';
    surface.querySelector('[data-review-time]').textContent = '10:00–11:15';
    surface.querySelector('[data-confirm-status]').textContent = 'An unfinished booking draft is blocking this request. Review or discard the draft before sending a new request. Reload this page if the draft is not shown.';
    surface.querySelector('[data-booking-draft]').hidden = false;
    surface.querySelector('[data-booking-draft-detail]').textContent = 'Synthetic unfinished treatment · Fri, 16 Oct · 12:45';
    surface.querySelector('[data-discard-booking-draft]').disabled = false;
    surface.querySelector('[data-submit-booking]').disabled = true;
    return surface;
  },
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
    const source = couplesBookingPresentation.renderMyShilohCouplesBookingPage({ catalogue,clientFirstName:'Synthetic Client AI',csrfToken:'storybook-csrf',bookingPolicyText:BOOKING_POLICY_TEXT });
    const styles = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n');
    const body = source.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || '';
    const root = document.createElement('div');
    root.innerHTML = `<style>${styles}</style><div data-story-surface>${body.replace(/<script[\s\S]*?<\/script>/g, '')}</div>`;
    return root;
  },
};

export const LaterAppointmentDeposit = {
  render: () => {
    const surface = productionSurface({ id: '9012', name: 'Synthetic Client AO', firstName: 'Synthetic Client AI' });
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
    const surface = productionSurface({ id:'9012',name:'Synthetic Client AO',firstName:'Synthetic Client AI' });
    const home = surface.querySelector('[data-client-experience-home]');
    home.querySelector('h2').textContent = 'Ready when you are, Jean-Pierre.';
    home.querySelector(':scope > p').textContent = 'Choose a treatment for yourself or book together.';
    home.querySelector('.status-pill').textContent = 'Ready';
    home.querySelector('[data-client-home-couples]').hidden = false;
    return surface;
  },
};

function bookingsSurface(hasUpcoming = true) {
  const surface = AuthenticatedHome.render();
  surface.querySelectorAll('[data-view]').forEach(view => {
    view.hidden = view.dataset.view !== 'bookings';
    view.classList.toggle('is-active', !view.hidden);
  });
  surface.querySelectorAll('[data-view-target]').forEach(item => {
    if (item.dataset.viewTarget === 'bookings') item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  const primary = surface.querySelector('[data-client-experience-bookings] .action-card');
  primary.querySelector('h2').textContent = hasUpcoming ? 'Hot Stone Massage' : 'Book something new';
  primary.querySelector('p').textContent = hasUpcoming ? 'Fri, 9 Oct · 10:00 · Christel' : 'You don’t have an upcoming appointment at the moment.';
  primary.querySelector('a').textContent = hasUpcoming ? 'Pay deposit' : 'Start booking';
  primary.querySelector('a').href = hasUpcoming ? '/pay/synthetic_booking_901' : '/my-shiloh/book';
  return surface;
}
export const UpcomingBookings = { render: () => bookingsSurface() };
export const BookingsWithoutUpcoming = { render: () => bookingsSurface(false) };

export const MissingDobRequest = {render:()=>{
  const root=productionSurface({id:55,name:'Synthetic Client',firstName:'Synthetic'});
  const request=root.querySelector('[data-dob-request]');request.hidden=false;
  request.querySelector('[data-dob-request-copy]').textContent='Please add your date of birth in Profile when you have a moment. Your existing bookings stay as they are.';
  return root;
}};

export const NamedCouplesMassage = {
  render:()=>{
    const source=couplesBookingPresentation.renderMyShilohCouplesBookingPage({catalogue:[...catalogue,{id:901,name:'Couples Massage',duration:'90 min',price:'R1080.00 for two',couplesService:true}],
      selectedServiceId:901,clientFirstName:'Synthetic Organiser',csrfToken:'storybook-csrf',bookingPolicyText:BOOKING_POLICY_TEXT});
    const styles=[...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match=>match[1]).join('\n');
    const body=source.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1]||'';
    const root=document.createElement('div');root.innerHTML=`<style>${styles}</style><div data-story-surface>${body.replace(/<script[\s\S]*?<\/script>/g,'')}</div>`;return root;
  },
};

export const CrmOptionalInvitations = {
  render: () => productionSurface({ id: '9012', name: 'Synthetic Client', firstName: 'Synthetic' },
    { passkeysAvailable: true, signInMethod: 'crm_details' }),
};

export const DesktopBookingHandoff = {render:()=>productionSurface(null,{detailsRetired:true,codeAvailable:true,selectedServiceId:101})};
