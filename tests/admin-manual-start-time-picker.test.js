const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const flowSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'adminMobileBookingFlow.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const { slotsInteractive } = require('../src/services/adminMobileBookingFlow');

test('admin manual booking retains authoritative 15-minute candidate generation', () => {
  assert.match(flowSource, /intervalMinutes:\s*15/);
  assert.match(flowSource, /listAvailableSlots/);
});

test('admin manual booking presents start time as the primary choice', () => {
  const slots = Array.from({ length: 8 }, (_, i) => ({
    starts_at: new Date(`2026-08-19T${String(8 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}:00+02:00`),
    ends_at: new Date(`2026-08-19T${String(9 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}:00+02:00`),
  }));
  const session = { date: '2026-08-19', staff: { display_name: 'Abigail' }, service: { name: 'Swedish massage' }, slots };
  const first = slotsInteractive(session);
  assert.equal(first.rows[0].title, '08:00');
  assert.equal(first.rows[0].description, 'Ends 09:00 · available start');
  assert.equal(first.rows[0].id, 'admin_booking_slot:0');
  assert.equal(first.rows[7].id, 'admin_booking_page:1');
  assert.match(first.body, /available 15-minute start time/i);
  const next = slotsInteractive(session, 1);
  assert.equal(next.rows[0].id, 'admin_booking_slot:7');
  assert.equal(next.rows[0].title, '09:45');
  assert.equal(next.rows[1].id, 'admin_booking_page:0');
  assert.doesNotMatch(slotsInteractive(session, 99).body, /available 15-minute start time/i);
});

test('manual start-time presentation does not create override or mutation logic', () => {
  assert.doesNotMatch(flowSource.slice(flowSource.indexOf('function slotsInteractive'), flowSource.indexOf('function clientsInteractive')), /UPDATE\s+appointments|INSERT\s+INTO\s+appointments|override|double[- ]book/i);
});

test('production and development use the direct presentation without the startup hook', () => {
  for (const script of [pkg.scripts.start, pkg.scripts.dev]) assert.doesNotMatch(script, /adminManualStartTimePickerPatch\.js/);
});
