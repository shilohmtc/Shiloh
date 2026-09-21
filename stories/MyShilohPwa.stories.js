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
