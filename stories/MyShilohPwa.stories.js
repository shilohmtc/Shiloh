import presentation from '../src/presentation/myShilohPwa.js';

const { renderMyShilohPage } = presentation;

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
      action.href = '/book';
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
