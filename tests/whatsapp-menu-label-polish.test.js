const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  WHATSAPP_LIST_LIMITS,
  compactListTitle,
  fullLabelDescription,
  presentNamedListRow,
} = require('../src/presentation/whatsappListRowPresentation');
const { serviceList } = require('../src/services/adminServicePricing');
const { serviceChangeListInteractive } = require('../src/services/adminAppointmentFinalization');
const { servicePageInteractive } = require('../src/services/clientDiscoveryMenu');
const { packageDirectoryInteractive } = require('../src/services/clientDiscoveryPackages');
const { presentTreatmentRow } = require('../src/presentation/clientTreatmentListPresentation');

const root = path.resolve(__dirname, '..');
const fullServiceName = 'Lower Back, Hip & Psoas Therapeutic Sports Massage';

function assertListLimits(row) {
  assert.ok(row.title.length >= 1 && row.title.length <= WHATSAPP_LIST_LIMITS.rowTitle, row.title);
  if (row.description) assert.ok(row.description.length <= WHATSAPP_LIST_LIMITS.rowDescription, row.description);
}

test('shared list presentation preserves a full canonical label whenever it fits', () => {
  assert.equal(compactListTitle(fullServiceName), 'Lower Back, Hip & Psoas…');
  assert.equal(
    fullLabelDescription(fullServiceName, 'Authoritative duration and pricing details that do not fit'),
    fullServiceName
  );
  const row = presentNamedListRow({ id: 'service_1', name: fullServiceName });
  assert.equal(row.description, fullServiceName);
  assertListLimits(row);
});

test('labels longer than the WhatsApp description limit remain bounded and explicit', () => {
  const value = 'A'.repeat(90);
  const description = fullLabelDescription(value);
  assert.equal(description.length, WHATSAPP_LIST_LIMITS.rowDescription);
  assert.ok(description.endsWith('…'));
});

test('technical Admin pricing and finalization lists prioritize full dynamic labels', () => {
  const pricingRow = serviceList([{ id: 7, name: fullServiceName, price: 650, variable_price: false }]).rows[0];
  assert.ok(pricingRow.description.startsWith(fullServiceName));
  assertListLimits(pricingRow);

  const finalizationRow = serviceChangeListInteractive(
    { id: 558, client_name: 'Client', services: 'Old service', staff: 'SHILOH MTC', starts_at: '2026-08-06T09:00:00+02:00' },
    [{ id: 7, name: fullServiceName, price: 650, variable_price: false, duration_minutes: 60 }],
    1
  ).rows[0];
  assert.ok(finalizationRow.description.startsWith(fullServiceName));
  assertListLimits(finalizationRow);

});

test('legacy pending-approval list module is retired', () => {
  assert.equal(fs.existsSync(path.join(root, 'src/services/adminPendingBookingApprovals.js')), false);
});

test('client discovery and package lists show full canonical names where they fit', () => {
  const discoveryRow = servicePageInteractive([{
    id: 7,
    name: fullServiceName,
    duration_minutes: 60,
    processing_time_minutes: 0,
    extra_time_minutes: 0,
    price: 650,
  }], 1).rows[0];
  assert.ok(discoveryRow.description.startsWith(fullServiceName));
  assertListLimits(discoveryRow);

  const packageName = 'Sports Massage — Monthly Performance Package';
  const packageRow = packageDirectoryInteractive([{
    slug: 'monthly-performance',
    name: packageName,
    package_price: 2400,
    sessions_included: 4,
    validity_days: 30,
  }]).rows[0];
  assert.ok(packageRow.description.startsWith(packageName));
  assertListLimits(packageRow);

  const treatmentRow = presentTreatmentRow({
    name: fullServiceName,
    duration_minutes: 60,
    display_price: 'R650',
  }, 'client_service_7');
  assert.ok(treatmentRow.description.startsWith(fullServiceName));
  assertListLimits(treatmentRow);
});

test('every dynamic Admin and client list producer in scope uses the shared full-label rule', () => {
  const files = [
    'src/services/adminBookingUpdate.js',
    'src/services/adminAppointmentFinalization.js',
    'src/services/adminServicePricing.js',
    'src/services/clientDiscoveryMenu.js',
    'src/services/clientDiscoveryPackages.js',
    'src/services/clientBookingAvailability.js',
    'src/services/clientRescheduleAvailability.js',
    'src/services/appointmentChange.js',
    'src/presentation/clientTreatmentListPresentation.js',
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, /fullLabelDescription/, file);
  }
});
