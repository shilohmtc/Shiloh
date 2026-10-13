const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const byDate = read('src/services/adminAppointmentsByDate.js');
const mobile = read('src/services/adminMobileMenu.js');
const interactive = read('src/services/adminInteractiveMenu.js');

const { relativeCommand, lastWeekBounds } = require('../src/services/adminAppointmentsByDate');
const { commandForAdminButton } = require('../src/services/adminEarningsButtons');
const { classifyRetiredAdminAction } = require('../src/services/adminAuthorityRetirement');

test('Today and Tomorrow remain stable while the last-week appointment shortcut retires', () => {
  assert.equal(commandForAdminButton('admin_appointment_today'), 'Today');
  assert.equal(commandForAdminButton('admin_appointment_tomorrow'), 'Tomorrow');
  assert.equal(commandForAdminButton('admin_appointment_last_week'), 'admin_retired_last_week_appointments');
  assert.equal(relativeCommand('Today'), 'today');
  assert.equal(relativeCommand('Tomorrow'), 'tomorrow');
  assert.equal(classifyRetiredAdminAction('admin_retired_last_week_appointments').kind, 'calendar');
});

test('the alternate Appointments authority surface is removed', () => {
  assert.equal(fs.existsSync(path.join(root, 'src/services/adminAppointmentsMenu.js')), false);
  assert.doesNotMatch(mobile, /appointmentsInteractive|admin_menu_appointments|admin_appointment_booking/);
  assert.doesNotMatch(interactive, /Appointments section|admin_section_appointments|APPOINTMENT_PRIORITY/);
});

test('stale Appointments and mutation IDs resolve to retirement instead of old execution', () => {
  for (const input of ['admin_menu_appointments', 'admin_appointment_booking', 'admin_appointment_manage', 'admin_booking_confirm']) {
    const normalized = commandForAdminButton(input) || input;
    assert.equal(classifyRetiredAdminAction(normalized).kind, 'calendar');
  }
  assert.equal(classifyRetiredAdminAction('admin_appointment_finalize').kind, 'internal_only');
});

test('retained Today/Tomorrow query remains scope-bound and excludes cancelled appointments', () => {
  assert.match(byDate, /a\.status <> 'cancelled'/);
  assert.match(byDate, /staff_services ss_scope/);
  assert.match(byDate, /authorized service scope/);
  const { start, end } = lastWeekBounds();
  assert.equal((new Date(`${end}T12:00:00Z`) - new Date(`${start}T12:00:00Z`)) / 86400000, 7);
});
