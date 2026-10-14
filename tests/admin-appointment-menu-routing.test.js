const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const byDate = read('src/services/adminAppointmentsByDate.js');
const mobile = read('src/services/adminMobileMenu.js');

const { relativeCommand, lastWeekBounds } = require('../src/services/adminAppointmentsByDate');
const { commandForAdminButton } = require('../src/services/adminEarningsButtons');

test('Today and Tomorrow remain stable while the last-week appointment shortcut retires', () => {
  assert.equal(commandForAdminButton('admin_appointment_today'), 'Today');
  assert.equal(commandForAdminButton('admin_appointment_tomorrow'), 'Tomorrow');
  assert.equal(commandForAdminButton('admin_appointment_last_week'), 'admin_retired_last_week_appointments');
  assert.equal(relativeCommand('Today'), 'today');
  assert.equal(relativeCommand('Tomorrow'), 'tomorrow');

});

test('the alternate Appointments authority surface is removed', () => {
  assert.equal(fs.existsSync(path.join(root, 'src/services/adminAppointmentsMenu.js')), false);
  assert.doesNotMatch(mobile, /appointmentsInteractive|admin_menu_appointments|admin_appointment_booking/);

});

test('retained Today/Tomorrow query remains scope-bound and excludes cancelled appointments', () => {
  assert.match(byDate, /a\.status <> 'cancelled'/);
  assert.match(byDate, /staff_services ss_scope/);
  assert.match(byDate, /authorized service scope/);
  const { start, end } = lastWeekBounds();
  assert.equal((new Date(`${end}T12:00:00Z`) - new Date(`${start}T12:00:00Z`)) / 86400000, 7);
});
