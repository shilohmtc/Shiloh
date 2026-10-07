// Presentation bounds for the selected-day phone practitioner grid only.
// Scheduling authorities and the Day/Desktop/Month ranges remain independent.
const PHONE_SELECTED_DAY_START = 8 * 60;
const PHONE_SELECTED_DAY_END = 17 * 60;
const PHONE_DEFAULT_EXCLUDED_NAMES = Object.freeze(['Pieter', 'Savanna']);
// Exact canonical display identities: migrations 003, 025 and 088.
function phoneStaffDefaultIncluded(person) {
  return !PHONE_DEFAULT_EXCLUDED_NAMES.includes(person?.displayName);
}
module.exports = { PHONE_SELECTED_DAY_START, PHONE_SELECTED_DAY_END, phoneStaffDefaultIncluded };
