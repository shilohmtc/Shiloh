import presentation from '../src/presentation/myShilohPwa.js';

const { renderMyShilohPage } = presentation;

const catalogue = [
  { id: 101, name: 'Full Body Swedish', category: 'Massage', duration: '60 min', price: 'R720' },
  { id: 102, name: 'Hot Stone Massage', category: 'Massage', duration: '75 min', price: 'R850' },
  { id: 103, name: 'Signature Pedicure', category: 'Pedicures & Foot Care', duration: '75 min', price: 'R620' },
  { id: 104, name: 'SQT BioMicroneedling', category: 'Aesthetic Services', duration: '60 min', price: 'R1 250' },
];

function productionSurface(client = null, { launchMode = 'app', platform = 'generic' } = {}) {
  const page = renderMyShilohPage({
    whatsappNumber: '27830000000',
    catalogue,
    client,
    now: new Date('2026-09-18T18:00:00.000Z'),
  });
  const body = String(page).match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || '';
  const root = document.createElement('div');
  root.innerHTML = `<link rel="stylesheet" href="/my-shiloh/assets/app.css"><div data-story-surface>${body.replace(/<script[\s\S]*?<\/script>/g, '')}</div>`;

  const gate = root.querySelector('[data-install-gate]');
  const frame = root.querySelector('[data-app-frame]');
  if (launchMode === 'install') {
    if (gate) gate.hidden = false;
    if (frame) frame.hidden = true;
    const intro = root.querySelector('[data-install-platform-intro]');
    const one = root.querySelector('[data-install-step="one"]');
    const two = root.querySelector('[data-install-step="two"]');
    const three = root.querySelector('[data-install-step="three"]');
    const button = root.querySelector('[data-install-trigger]');
    if (platform === 'iphone') {
      if (intro) intro.textContent = 'On iPhone, add My Shiloh to your Home Screen first. Then open the new My Shiloh icon to sign in or register.';
      if (one) one.textContent = 'Tap the Share button in your browser.';
      if (two) two.textContent = 'Tap Add to Home Screen, then tap Add. Keep Open as Web App switched on if your iPhone shows that option.';
      if (three) three.textContent = 'Leave the browser and open My Shiloh from the new icon on your Home Screen.';
      if (button) button.hidden = true;
    }
    if (platform === 'android') {
      if (intro) intro.textContent = 'On Android, install My Shiloh first. Then open it from its new app icon to sign in or register.';
      if (one) one.textContent = 'Tap Install My Shiloh below when the button appears.';
      if (two) two.textContent = 'If the button does not appear, open your browser menu and choose Install app or Add to Home screen.';
      if (three) three.textContent = 'Leave the browser and open My Shiloh from the new icon in your apps list or Home Screen.';
      if (button) button.hidden = false;
    }
    if (platform === 'generic') {
      if (intro) intro.textContent = 'My Shiloh is designed to be installed on your phone. Open this page on your iPhone or Android phone, install it, then continue from the My Shiloh icon.';
      if (one) one.textContent = 'Open this page on your iPhone or Android phone.';
      if (two) two.textContent = 'Use Add to Home Screen or Install app.';
      if (three) three.textContent = 'Open My Shiloh from its new icon to sign in or register.';
      if (button) button.hidden = true;
    }
  } else {
    if (gate) gate.hidden = true;
    if (frame) frame.hidden = false;
  }
  return root;
}

export default {
  title: 'Client/My Shiloh PWA',
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
  },
};

export const BrowserInstallIPhone = {
  render: () => productionSurface(null, { launchMode: 'install', platform: 'iphone' }),
};

export const BrowserInstallAndroid = {
  render: () => productionSurface(null, { launchMode: 'install', platform: 'android' }),
};

export const BrowserInstallDesktop = {
  render: () => productionSurface(null, { launchMode: 'install', platform: 'generic' }),
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
