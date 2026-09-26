import presentation from '../src/presentation/myShilohPwa.js';
import bookingPresentation from '../src/presentation/myShilohBooking.js';

const { renderMyShilohPage } = presentation;
const { renderMyShilohBookingPage } = bookingPresentation;

const catalogue = [
  { id: 101, name: 'Full Body Swedish', category: 'Massage', duration: '60 min', price: 'R720' },
  { id: 102, name: 'Hot Stone Massage', category: 'Massage', duration: '75 min', price: 'R850' },
  { id: 103, name: 'Signature Pedicure', category: 'Pedicures & Foot Care', duration: '75 min', price: 'R620' },
  { id: 104, name: 'SQT BioMicroneedling', category: 'Aesthetic Services', duration: '60 min', price: 'R1 250' },
];

function productionSurface(client = null) {
  const page = renderMyShilohPage({
    whatsappNumber: '27830000000',
    catalogue,
    client,
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

function applyInstallStep(surface, index, title, copy) {
  const number = String(index);
  const titleNode = surface.querySelector(`[data-install-step-title="${number}"]`);
  const copyNode = surface.querySelector(`[data-install-step-copy="${number}"]`);
  if (titleNode) {
    if (/^Tap Share/.test(title)) titleNode.innerHTML = `${installShareIconMarkup()} Tap Share`;
    else titleNode.textContent = title;
  }
  if (copyNode) copyNode.textContent = copy;
}

function bookingSurface() {
  const page = renderMyShilohBookingPage({
    catalogue: [
      { id: 101, name: 'Hot Stone Massage', category: 'Massage', duration: '75 min', price: 'R850' },
      { id: 103, name: 'Signature Pedicure', category: 'Pedicures & Foot Care', duration: '75 min', price: 'R620' },
    ],
    clientFirstName: 'Christel',
    csrfToken: 'storybook-csrf',
    bookingPolicyText: 'Shiloh Massage Therapy & Aesthetic Clinic — Booking Policy & Terms\n\nPlease arrive on time.\n\nTo continue, accept the terms below.',
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

export const WhatsAppAutomaticReturn = {
  render: () => {
    const surface = productionSurface();
    const form = surface.querySelector('[data-view="home"] [data-client-auth-code-form]');
    const status = surface.querySelector('[data-view="home"] [data-auth-status]');
    form?.classList.add('is-waiting');
    if (status) {
      status.dataset.state = 'waiting';
      status.textContent = 'Checking your WhatsApp verification… My Shiloh will open automatically.';
    }
    return surface;
  },
};

export const WhatsAppCodeFallback = {
  render: () => {
    const surface = productionSurface();
    const form = surface.querySelector('[data-view="home"] [data-client-auth-code-form]');
    const status = surface.querySelector('[data-view="home"] [data-auth-status]');
    form?.classList.add('is-waiting');
    if (status) {
      status.dataset.state = 'waiting';
      status.textContent = 'Still waiting? Enter the 6-digit fallback code from Shiloh.';
    }
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
      const action = document.createElement('a');
      action.className = 'button button--primary experience-primary';
      action.href = '#bookings';
      action.textContent = 'View request';
      home.appendChild(action);
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
    if (gateCopy) gateCopy.textContent = 'You’re in Safari. Add My Shiloh to your Home Screen in three quick steps.';
    const eyebrow = surface.querySelector('[data-install-eyebrow]');
    const title = surface.querySelector('[data-install-title]');
    const lead = surface.querySelector('[data-install-lead]');
    if (eyebrow) eyebrow.textContent = 'Install My Shiloh on iPhone';
    if (title) title.textContent = 'Three quick steps.';
    if (lead) lead.textContent = 'Stay in Safari — no App Store download is needed.';
    const steps = [
      ['Tap Share', 'Use Safari’s Share button.'],
      ['Choose Add to Home Screen', 'Scroll if you do not see it straight away.'],
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
    if (gateAction) gateAction.textContent = 'Show iPhone steps';
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
    if (gateCopy) gateCopy.textContent = 'Tap below and Android will add My Shiloh to your Home Screen.';
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


export const FirstLaunchWhatsAppVerification = {
  render: () => {
    const surface = productionSurface({
      id: '913',
      name: 'Jean-Pierre Botha',
      firstName: 'Jean-Pierre',
    });
    const installGate = surface.querySelector('[data-install-gate]');
    const verificationGate = surface.querySelector('[data-install-verification-gate]');
    const frame = surface.querySelector('[data-app-frame]');
    if (installGate) installGate.hidden = true;
    if (verificationGate) verificationGate.hidden = false;
    if (frame) frame.hidden = true;
    return surface;
  },
};


export const AuthenticatedDepositRequired = {
  render: () => {
    const surface = productionSurface({
      id: '912',
      name: 'Christel Botha',
      firstName: 'Christel',
    });
    const home = surface.querySelector('[data-client-experience-home]');
    if (home) {
      const eyebrow = home.querySelector('.eyebrow');
      const heading = home.querySelector('h2');
      const copy = home.querySelector(':scope > p');
      const status = home.querySelector('.status-pill');
      if (eyebrow) eyebrow.textContent = 'Before your visit';
      if (heading) heading.textContent = 'Your booking is awaiting its deposit.';
      if (copy) copy.textContent = 'Hot Stone Massage is held for Wed, 30 Sep at 10:00. Pay the 50% booking deposit to secure it.';
      if (status) status.textContent = 'Deposit';
      const values = {
        appointment: 'Wed, 30 Sep · 10:00',
        forms: 'None required',
        payment: 'R340 deposit required',
      };
      home.querySelectorAll('[data-client-experience-fact]').forEach((button) => {
        const value = button.querySelector('strong');
        if (value) value.textContent = values[button.dataset.factKey] || '';
      });
      const action = document.createElement('a');
      action.className = 'button button--primary experience-primary';
      action.dataset.clientExperiencePrimary = '';
      action.href = '/pay/dep_storybook123';
      action.textContent = 'Pay deposit';
      home.appendChild(action);
    }
    const voucher = surface.querySelector('[data-welcome-voucher]');
    if (voucher) voucher.hidden = true;
    return surface;
  },
};

export const AuthenticatedDepositLinkUnavailable = {
  render: () => {
    const surface = AuthenticatedDepositRequired.render();
    const home = surface.querySelector('[data-client-experience-home]');
    const copy = home?.querySelector(':scope > p');
    if (copy) copy.textContent = 'Hot Stone Massage is held for Wed, 30 Sep at 10:00. Your secure payment link is not available yet. Ask Shiloh for help with the deposit before your visit.';
    const action = home?.querySelector('[data-client-experience-primary]');
    if (action) {
      action.href = '#shiloh';
      action.textContent = 'Ask Shiloh about my deposit';
    }
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
      const action = document.createElement('a');
      action.className = 'button button--primary experience-primary';
      action.dataset.clientExperiencePrimary = '';
      action.href = '/my-shiloh/book';
      action.textContent = 'Book an appointment';
      home.appendChild(action);
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
