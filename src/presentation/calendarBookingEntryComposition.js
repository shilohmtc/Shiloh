const { allowsStaffTarget } = require('../services/calendarAuthorization');
const { renderCalendarPage } = require('./calendarReadOnlyUx');
const { renderCalendarCreateBookingPage } = require('./calendarCreateBookingUx');

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function hasAvailabilityOperation(capability) {
  if (capability?.enabled !== true || !Array.isArray(capability.operations)) return false;
  return capability.operations.includes('calendar_block:manage')
    || capability.operations.includes('operational_leave:manage');
}

function alignScopedAvailabilityFocus(model = {}) {
  const capability = model?.mutationCapability;
  const linkedStaffId = positiveId(capability?.linkedStaffId);
  const activeStaffId = positiveId(model?.activeStaffId);
  if (!linkedStaffId || !hasAvailabilityOperation(capability)) return model;
  if (capability.calendarScope === 'all_business') return model;
  if (activeStaffId && allowsStaffTarget(capability, activeStaffId)) return model;
  if (!allowsStaffTarget(capability, linkedStaffId)) return model;
  model.activeStaffId = linkedStaffId;
  return model;
}

function renderCalendarPageWithScopedAvailabilityFocus(model, options) {
  alignScopedAvailabilityFocus(model);
  return renderCalendarPage(model, options);
}

function removeLinkedBookingShortcuts(html) {
  return String(html || '')
    .replace(/<a\b[^>]*\bdata-couples-booking-entry\b[^>]*>[\s\S]*?<\/a>/i, '')
    .replace(/<a\b[^>]*\bdata-group-booking-entry\b[^>]*>[\s\S]*?<\/a>/i, '');
}

function renderCalendarCreateBookingPageWithoutLinkedShortcuts(args) {
  return removeLinkedBookingShortcuts(renderCalendarCreateBookingPage(args));
}

module.exports = {
  alignScopedAvailabilityFocus,
  removeLinkedBookingShortcuts,
  renderCalendarPageWithScopedAvailabilityFocus,
  renderCalendarCreateBookingPageWithoutLinkedShortcuts,
};
