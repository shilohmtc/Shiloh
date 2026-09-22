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
