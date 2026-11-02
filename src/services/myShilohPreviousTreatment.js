'use strict';

// Only the existing last-completed-individual-visit projection may reach here.
// A historical name is a suggestion, never an authority for price/availability.
function previousTreatmentChoice(visit, catalogue) {
  const fallback = { available: false, message: 'Choose a treatment from the current catalogue, or ask Reception for help.', href: '/my-shiloh/book' };
  if (!visit?.found) return { ...fallback, message: 'There is no completed individual visit available to repeat yet.' };
  if (visit.ambiguous || !visit.complete || visit.multiService || visit.services?.length !== 1) {
    return { ...fallback, message: 'This visit needs a little more help to repeat. Choose your treatment or contact Reception.' };
  }
  if (!Array.isArray(catalogue)) return { ...fallback, message: 'Current treatments are temporarily unavailable. Please try again.' };
  const matches = catalogue.filter(item => (item.canonicalName || item.name) === visit.services[0]);
  const service = matches.length === 1 ? matches[0] : null;
  if (!service || !Number.isSafeInteger(Number(service.id)) || Number(service.id) <= 0) return fallback;
  return {
    available: true, service: service.name, startsAt: visit.startsAt,
    message: 'Review this treatment, then choose a new date and time. Current prices and availability apply. Nothing has been booked.',
    href: `/my-shiloh/book?service=${Number(service.id)}`,
  };
}

module.exports = { previousTreatmentChoice };
