const test = require('node:test');
const assert = require('node:assert/strict');
const { dashboardAuthority, viewerMatchesPrincipal } = require('../src/services/workspaceDashboard');

function ownWorkspacePrincipal(overrides = {}) {
  return {
    permissions: { 'appointment:view': true, 'booking:update': true },
    calendarAuthority: {
      linkedStaffId: 12,
      businessRole: 'tenant_practitioner',
      calendarScope: 'own_appointments',
      capabilities: ['appointment:view', 'booking:update'],
      ...overrides,
    },
  };
}

test('own-workspace practitioner Dashboard accepts the broad read-only staff browser session while projecting only own appointments', () => {
  const principal = ownWorkspacePrincipal();
  const authority = dashboardAuthority(principal);

  assert.equal(authority.mode, 'my_day');
  assert.equal(authority.linkedStaffId, 12);
  assert.equal(authority.canFinalize, true);
  assert.deepEqual(authority.timelineViewer, { calendarScope: 'own_appointments', staffId: 12 });
  assert.equal(viewerMatchesPrincipal({ calendarScope: 'business_all_staff' }, principal), true);
});

test('own-workspace Dashboard still rejects an own-staff session bound to another practitioner', () => {
  const principal = ownWorkspacePrincipal();
  assert.equal(viewerMatchesPrincipal({ calendarScope: 'own_staff', staffId: 99 }, principal), false);
  assert.equal(viewerMatchesPrincipal({ calendarScope: 'own_staff', staffId: 12 }, principal), true);
});

test('own-workspace Dashboard fails closed without a canonical linked practitioner', () => {
  const principal = ownWorkspacePrincipal({ linkedStaffId: null });
  assert.equal(dashboardAuthority(principal), null);
  assert.equal(viewerMatchesPrincipal({ calendarScope: 'business_all_staff' }, principal), false);
});
