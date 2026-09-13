import websiteModule from '../src/services/publicWebsite.js';
import bookingModule from '../src/services/publicBookingPageEditorial.js';

const {
  renderHome,
  renderTreatments,
  renderAbout,
  renderContact,
  renderPrivacy,
} = websiteModule;
const { renderBookingPage } = bookingModule;

const catalogue = [
  {
    id: 101,
    name: 'Deep Tissue Massage',
    category: 'Massage',
    duration: '60 min',
    price: 'R850',
    description: 'Focused therapeutic massage.',
    bookingNote: '',
  },
  {
    id: 202,
    name: 'Signature Pedicure',
    category: 'Pedicures & Foot Care',
    duration: '75 min',
    price: 'R620',
    description: 'Restorative foot care.',
    bookingNote: '',
  },
  {
    id: 303,
    name: 'Hydrating Facial',
    category: 'Aesthetic Care',
    duration: '60 min',
    price: 'R720',
    description: 'Hydrating facial care.',
    bookingNote: '',
  },
];

function productionPage(pageHtml) {
  const styles = [...String(pageHtml).matchAll(/<style>([\s\S]*?)<\/style>/g)]
    .map((match) => match[1])
    .join('\n');
  const body = String(pageHtml).match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || '';
  return `<style>${styles}.public-site-story{min-height:100vh}</style><div class="public-site-story" data-public-site-story>${body}</div>`;
}

export default {
  title: 'Public Website/Production pages',
  parameters: { layout: 'fullscreen' },
};

export const Home = {
  render: () => productionPage(renderHome(catalogue)),
};

export const Treatments = {
  render: () => productionPage(renderTreatments(catalogue)),
};

export const About = {
  render: () => productionPage(renderAbout()),
};

export const Contact = {
  render: () => productionPage(renderContact()),
};

export const Privacy = {
  render: () => productionPage(renderPrivacy()),
};

export const Book = {
  render: () => productionPage(renderBookingPage('27830000000', catalogue)),
};

export const CatalogueUnavailable = {
  render: () => productionPage(renderTreatments([])),
};

export const WhatsAppUnavailable = {
  render: () => productionPage(renderBookingPage(null, catalogue)),
};
