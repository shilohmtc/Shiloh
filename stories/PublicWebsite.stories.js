import websiteModule from '../src/services/publicWebsite.js';
import bookingModule from '../src/services/publicBookingPageEditorial.js';

const {
  renderHome,
  renderTreatments,
  renderAbout,
  renderContact,
  renderVisit,
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
  {
    id: 404,
    name: '1. SQT Anti-Aging Rejuvenation BioMicroneedling + SQT Revitalizing Beauty BioMicroneedling',
    category: '1. SQT BioMicroneedling',
    duration: '90 min',
    price: 'R1785-R2585',
  },
  {
    id: 505,
    name: 'Permanent Makeup – Brows',
    category: 'Permanent Makeup',
    duration: '180 min',
    price: 'R1 950–R2 200',
  },
  {
    id: 606,
    name: 'Pelvic Floor Strengthening',
    category: 'Neo Pelvic Therapy',
    duration: '30 min',
    price: 'R350–R450',
  },
  {
    id: 707,
    name: 'Shiloh Consultation',
    category: 'Services',
    duration: '30 min',
    price: 'Price on consultation',
  },
  {
    id: 808,
    name: 'Priced according to area',
    category: 'Plasma Fybroblast Prices',
    duration: '300 min',
    price: '1900 - 6500',
  },
  {
    id: 909,
    name: 'VHC Standard Needling with Vitamins under Local Anesthetic.',
    category: 'Mikroneedling',
    duration: '150 min',
    price: 'R500-R1250',
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

export const Visit = {
  render: () => productionPage(renderVisit()),
};

export const Privacy = {
  render: () => productionPage(renderPrivacy()),
};

export const Book = {
  render: () => productionPage(renderBookingPage('27830000000', catalogue)),
};

export const BookWithSelection = {
  render: () => productionPage(renderBookingPage('27830000000', catalogue, 101)),
};

export const CatalogueUnavailable = {
  render: () => productionPage(renderTreatments([])),
};

export const WhatsAppUnavailable = {
  render: () => productionPage(renderBookingPage(null, catalogue, 101)),
};
