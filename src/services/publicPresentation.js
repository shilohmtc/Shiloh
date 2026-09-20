const PUBLIC_BRAND_NAME = 'Shiloh Massage & Aesthetic Clinic';
const PUBLIC_BRAND_SUBTITLE = 'Massage & Aesthetic Clinic';
const PUBLIC_TAGLINE = 'Personal care. Thoughtful touch.';

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

function toPublicService(service = {}) {
  const canonicalName = service.canonicalName || service.name || '';
  return {
    ...service,
    canonicalName,
    name: neutralizePublicLabel(service.name || ''),
    category: neutralizePublicLabel(service.category || 'Services'),
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
  neutralizePublicLabel,
  toPublicService,
  sanitizePublicCatalogue,
  normalizePublicServiceId,
  publicBookingPathForService,
};
