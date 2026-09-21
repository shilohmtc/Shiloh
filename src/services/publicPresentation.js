const PUBLIC_BRAND_NAME = 'Shiloh Massage & Aesthetic Clinic';
const PUBLIC_BRAND_SUBTITLE = 'Massage & Aesthetic Clinic';
const PUBLIC_TAGLINE = 'Personal care. Thoughtful touch.';

// Public families are a presentation layer over the canonical clinic
// catalogue. Keep the source category on each service so booking, pricing and
// internal ownership continue to use the existing business authority.
const PUBLIC_SERVICE_CATEGORY_ORDER = [
  'Massage',
  'Pedicures & Foot Care',
  'Facials & Skin',
  'Advanced Aesthetics',
  'Permanent Makeup',
  'Body & Wellness',
  'More Services',
];

// These aliases only shape how established catalogue services read on the
// public website. Canonical names stay attached to every service for booking
// identity and internal use.
const PUBLIC_SERVICE_NAME_ALIASES = new Map([
  ['Sports Massage Full Body', 'Full-Body Sports Massage'],
  ['Quick Relief: Back & Neck (45 min)', 'Quick Relief – Back & Neck'],
  ['Cupping Area Specific', 'Area-Specific Cupping'],
  ['Bamboo Sports Massage - Area Specific', 'Area-Specific Bamboo Sports Massage'],
  ['Permanent Makeup - Eyeliner', 'Permanent Makeup – Eyeliner'],
  ['Permanent Makeup - Brows', 'Permanent Makeup – Brows'],
  ['Permanent Makeup - Lips', 'Permanent Makeup – Lips'],
  ['VHC Standard Needling with Vitamins under Local Anesthetic.', 'VHC Vitamin Microneedling'],
  ['GF Needling with Growth Factors under Local Anesthetic', 'Growth Factor Microneedling'],
  ['Plasma Fybroblast', 'Plasma Fibroblast Consultation'],
  ['Priced according to area', 'Plasma Fibroblast – By Area'],
  [
    '1. SQT Anti-Aging Rejuvenation BioMicroneedling + SQT Revitalizing Beauty BioMicroneedling',
    'SQT Rejuvenation & Revitalising BioMicroneedling',
  ],
  [
    '2. SQT Resurfacing BioMicroneedling + SQT Nourishing Hydrating BioMicroneedling',
    'SQT Resurfacing & Hydrating BioMicroneedling',
  ],
  ['HIFU (High-Intensity Focused Ultrasound)', 'HIFU – High-Intensity Focused Ultrasound'],
]);

function neutralizePublicLabel(value = '') {
  return String(value)
    .replace(/\btherapeutic\b/gi, 'Wellness')
    .replace(/\btherapy\b/gi, 'Session')
    .replace(/\btherapists\b/gi, 'Practitioners')
    .replace(/\btherapist\b/gi, 'Practitioner')
    .replace(/\bclinical\b/gi, 'Professional')
    .replace(/\btreatments\b/gi, 'Services')
    .replace(/\btreatment\b/gi, 'Service');
}

function publicServiceNameFor(value = '') {
  const canonicalName = String(value).trim();
  return neutralizePublicLabel(PUBLIC_SERVICE_NAME_ALIASES.get(canonicalName) || canonicalName);
}

function formatRandAmount(value = '') {
  const normalized = String(value).replace(/[\s,]/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, decimals = ''] = normalized.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${grouped}${decimals && Number(decimals) !== 0 ? `.${decimals}` : ''}`;
}

function publicServicePriceFor(value = '') {
  const price = String(value ?? '').trim();
  const range = price.match(/^R?\s*([\d\s,.]+)\s*[-–—]\s*R?\s*([\d\s,.]+)$/i);
  if (range) {
    const minimum = formatRandAmount(range[1]);
    const maximum = formatRandAmount(range[2]);
    if (minimum && maximum) return `R${minimum}–R${maximum}`;
  }

  const fixed = price.match(/^R\s*([\d\s,.]+)$/i);
  if (fixed) {
    const amount = formatRandAmount(fixed[1]);
    if (amount) return `R${amount}`;
  }

  return price;
}

function publicServiceCategoryFor(service = {}) {
  const canonicalCategory = String(
    service.canonicalCategory || service.category || 'Services',
  ).trim();
  const name = String(service.canonicalName || service.name || '').trim();
  const category = canonicalCategory.toLowerCase();
  const serviceName = name.toLowerCase();

  if (/neo pelvic|vaginal tightening|ozone|far infrared/.test(category)) {
    return 'Body & Wellness';
  }
  if (/sqt|microneedl|needling|profosma|plasma|fybro|fibro|hifu/.test(category)) {
    return 'Advanced Aesthetics';
  }
  if (/permanent makeup|permanant makeup/.test(category)) return 'Permanent Makeup';
  if (/pedicure|foot|feet|mediheel/.test(category)) return 'Pedicures & Foot Care';
  if (/facial|skin|aesthetic care|brow|lash|wax/.test(category)) return 'Facials & Skin';

  // Specific service names come before broad legacy category names such as
  // "Massage Treatments", so a misplaced specialty retains its meaning.
  if (/neo pelvic|pelvic floor|vaginal tightening|ozone|far infrared/.test(serviceName)) {
    return 'Body & Wellness';
  }
  if (/sqt|microneedl|needling|profosma|plasma|fybro|fibro|hifu/.test(serviceName)) {
    return 'Advanced Aesthetics';
  }
  if (/permanent makeup|permanant makeup|areola|eyeliner/.test(serviceName)) {
    return 'Permanent Makeup';
  }
  if (/pedicure|heel|foot massage|feet|toe gel|mediheel/.test(serviceName)) {
    return 'Pedicures & Foot Care';
  }
  if (/facial|peel|derma|skin|brow|lash|wax/.test(serviceName)) return 'Facials & Skin';
  if (/massage/.test(category)) return 'Massage';
  if (/massage|lymphatic|cupping|psoas|back & neck|back, neck|sports|pregnancy/.test(serviceName)) {
    return 'Massage';
  }
  return 'More Services';
}

function toPublicService(service = {}) {
  const canonicalName = service.canonicalName || service.name || '';
  const canonicalCategory = service.canonicalCategory || service.category || 'Services';
  const canonicalPrice = service.canonicalPrice ?? service.price ?? '';
  return {
    ...service,
    canonicalName,
    canonicalCategory,
    canonicalPrice,
    name: publicServiceNameFor(canonicalName),
    price: publicServicePriceFor(canonicalPrice),
    category: publicServiceCategoryFor({ ...service, canonicalName, canonicalCategory }),
    // Public pages intentionally do not publish source descriptions or booking
    // notes. Those fields can contain clinical/therapeutic claims and remain
    // available to controlled internal/assistant workflows instead.
    description: '',
    bookingNote: '',
  };
}

function sanitizePublicCatalogue(catalogue = []) {
  return Array.isArray(catalogue) ? catalogue.map(toPublicService) : [];
}

function groupPublicCatalogue(catalogue = []) {
  const groups = new Map(PUBLIC_SERVICE_CATEGORY_ORDER.map((category) => [category, []]));
  for (const service of sanitizePublicCatalogue(catalogue)) {
    const category = groups.has(service.category) ? service.category : 'More Services';
    groups.get(category).push(service);
  }
  return new Map([...groups].filter(([, services]) => services.length));
}

function normalizePublicServiceId(value = '') {
  const id = String(value ?? '').trim();
  return /^[1-9]\d*$/.test(id) ? id : '';
}

function publicBookingPathForService(service = {}) {
  const id = normalizePublicServiceId(service.id);
  return id ? `/book?service=${encodeURIComponent(id)}#service-${encodeURIComponent(id)}` : '/book';
}

module.exports = {
  PUBLIC_BRAND_NAME,
  PUBLIC_BRAND_SUBTITLE,
  PUBLIC_TAGLINE,
  PUBLIC_SERVICE_CATEGORY_ORDER,
  PUBLIC_SERVICE_NAME_ALIASES,
  neutralizePublicLabel,
  publicServiceNameFor,
  publicServicePriceFor,
  publicServiceCategoryFor,
  toPublicService,
  sanitizePublicCatalogue,
  groupPublicCatalogue,
  normalizePublicServiceId,
  publicBookingPathForService,
};
