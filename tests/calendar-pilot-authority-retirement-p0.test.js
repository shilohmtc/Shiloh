const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const {
  CALENDAR_CAPABILITIES,
  CALENDAR_OPERATIONS,
  evaluateCalendarAuthority,
  hasCapability,
  operationsForAuthority,
} = require('../src/services/calendarAuthorization');
const {
  createStaffBrowserSessionService,
  sha256,
} = require('../src/services/staffBrowserSession');
const {
  createCalendarCreateBookingService,
} = require('../src/services/calendarCreateBooking');
const {
  buildCalendarHandoffUrl,
  isCalendarHandoffAuthority,
} = require('../src/services/staffCalendarHandoff');

const CREATE = {
  'appointment:view': true,
  'appointment:create': true,
  'client:lookup': true,
  'calendar:booking:reschedule': true,
  'calendar:booking:cancel': true,
  'calendar:booking:reassign': true,
};
const FULL = { ...CREATE, 'schedule:manage': true };

function principal(name, overrides = {}) {
  return {
    id: 100,
    staff_id: null,
    display_name: name,
    role: 'receptionist',
    business_role: 'booking_operator',
    calendar_scope: 'all_business',
    service_scope: 'all_services',
    permissions: { ...CREATE },
    admin_active: true,
    staff_status: null,
    ...overrides,
  };
}

function authorityDb(initial) {
  let current = initial;
  const calls = [];
  return {
    calls,
    setPrincipal(value) { current = value; },
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes('calendarAuthorization:principal')) {
        return { rows: current ? [{ ...current }] : [], rowCount: current ? 1 : 0 };
      }
      if (String(sql).includes('calendarAuthorization:services')) {
        return { rows: [{ service_id: 44 }], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${String(sql).slice(0, 80)}`);
    },
  };
}

function bookingService(db, env = {}) {
  return createCalendarCreateBookingService({
    db,
    env,
    crmV2Service: {
      async searchClients() { return []; },
      async getClientById() { return null; },
      async createClient() { return null; },
    },
  });
}

test('obsolete pilot and named emergency authority runtime is fully retired', () => {
  for (const file of [
    'src/services/staffBrowserPilotGate.js',
    'src/services/emergencyCalendarBootstrap.js',
    'src/presentation/emergencyCalendarBootstrapUx.js',
    'src/bootstrap/emergencyChristelCalendarBookingPatch.js',
    'scripts/ensure-emergency-calendar-bootstrap.js',
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, file)), false, `${file} must remain retired`);
  }

  const runtime = [
    'src/routes/calendar.js',
    'src/routes/calendarCreateBooking.js',
    'src/routes/calendarReadOnlyUx.js',
    'src/routes/staffBrowserSession.js',
    'src/routes/staffCalendarAccessUx.js',
    'src/services/adminInteractiveMenu.js',
    'src/services/calendarAccessDiagnostic.js',
    'src/services/calendarCreateBooking.js',
    'src/services/providerIndependentStaffAuth.js',
    'package.json',
  ].map(read).join('\n');
  assert.doesNotMatch(runtime, /SHILOH_STAFF_BROWSER_PILOT|EMERGENCY_ADMIN_ID|SHILOH_EMERGENCY_CHRISTEL_CALENDAR_BOOKING_ENABLED/);
  assert.doesNotMatch(runtime, /staffBrowserPilotGate|emergencyCalendarBootstrap|emergency-bootstrap|pilot_authority_mismatch/);
  assert.match(read('src/routes/calendar.js'), /const staffBrowserSessionService = createStaffBrowserSessionService/);
  assert.doesNotMatch(read('src/routes/calendar.js'), /Guarded|Pilot|baseStaffBrowserSessionService/);
  assert.match(read('src/services/staffBrowserSession.js'), /bs\.admin_id[\s\S]*a\.id, a\.staff_id/);
});

test('canonical capability and scope data produces the required staff matrix', () => {
  const matrix = [
    ['Naomi', principal('Naomi'), true, ['appointment:reschedule', 'appointment:cancel', 'appointment:reassign']],
    ['Christel', principal('Christel', { id: 101, staff_id: 9, staff_status: 'active', business_role: 'owner', permissions: FULL }), true, CALENDAR_OPERATIONS],
    ['Marietjie', principal('Marietjie', { id: 102, staff_id: 10, staff_status: 'active', business_role: 'tenant_practitioner', permissions: FULL }), true, CALENDAR_OPERATIONS],
    ['Jean-Pierre', principal('Jean-Pierre', { id: 103, role: 'admin', business_role: 'business_admin', permissions: FULL }), true, CALENDAR_OPERATIONS],
    ['Abigail', principal('Abigail', { id: 104, staff_id: 11, staff_status: 'active', business_role: 'employee_practitioner', permissions: { 'appointment:view': true } }), false, []],
    ['ILince', principal('ILince', { id: 105, staff_id: 12, staff_status: 'active', business_role: 'employee_practitioner', calendar_scope: 'own_appointments', service_scope: 'own_services', permissions: { 'appointment:view': true } }), false, []],
    ['Pieter', principal('Pieter', { id: 106, staff_id: 13, staff_status: 'active', business_role: 'employee_practitioner', permissions: {} }), false, []],
    ['Savanna', principal('Savanna', { id: 107, staff_id: 14, staff_status: 'active', business_role: 'employee_practitioner', permissions: {} }), false, []],
  ];

  for (const [name, row, canCreate, operations] of matrix) {
    const authority = evaluateCalendarAuthority(row, { allowedServiceIds: [44] });
    assert.ok(authority, `${name} canonical principal should resolve`);
    assert.equal(hasCapability(authority, CALENDAR_CAPABILITIES.BOOKING_CREATE), canCreate, `${name} Create Booking`);
    assert.deepEqual(operationsForAuthority(authority), operations, `${name} operations`);
  }

  assert.equal(evaluateCalendarAuthority({}), null, 'unknown principal');
  assert.equal(evaluateCalendarAuthority(principal('Inactive', { admin_active: false })), null, 'inactive admin');
  assert.equal(evaluateCalendarAuthority(principal('Inactive staff', { staff_id: 15, staff_status: 'inactive' })), null, 'inactive linked staff');
});

test('retired environment values cannot contradict canonical Create Booking authority', async () => {
  const db = authorityDb(principal('Naomi'));
  const service = bookingService(db, {
    SHILOH_STAFF_BROWSER_PILOT_MODE_ENABLED: 'true',
    SHILOH_STAFF_BROWSER_PILOT_ADMIN_IDS: '2',
    SHILOH_EMERGENCY_CHRISTEL_CALENDAR_BOOKING_ENABLED: 'false',
  });

  const allowed = await service.resolveOperator(100);
  assert.equal(allowed.display_name, 'Naomi');
  assert.equal(allowed.bookingScope.key, 'all_business:all_services');

  db.setPrincipal(principal('Abigail', {
    staff_id: 11,
    staff_status: 'active',
    permissions: { 'appointment:view': true },
  }));
  await assert.rejects(
    service.resolveOperator(100),
    (error) => error?.code === 'CALENDAR_BOOKING_FORBIDDEN',
  );
  assert.equal(db.calls.filter((call) => call.sql.includes('calendarAuthorization:principal')).length, 2, 'authority revalidated on each endpoint call');
});

test('ordinary session validation reloads current canonical active/view authority without pilot selection', async () => {
  let row = {
    session_id: 70,
    admin_id: 100,
    id: 100,
    csrf_hash: sha256(Buffer.alloc(32, 8).toString('base64url')),
    issued_at: '2026-08-29T08:00:00.000Z',
    expires_at: '2026-08-29T16:00:00.000Z',
    revoked_at: null,
    auth_method: 'totp',
    reauthenticated_at: '2026-08-29T08:00:00.000Z',
    recovery_required: false,
    staff_id: null,
    business_role: 'booking_operator',
    calendar_scope: 'all_business',
    service_scope: 'all_services',
    permissions: { 'appointment:view': true, 'appointment:create': true, 'client:lookup': true },
    admin_active: true,
    staff_status: null,
  };
  const db = {
    async query(sql) {
      if (String(sql).includes('FROM staff_browser_sessions')) return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
      if (String(sql).includes('UPDATE staff_browser_sessions')) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected query: ${String(sql).slice(0, 80)}`);
    },
  };
  const service = createStaffBrowserSessionService({ db, now: () => new Date('2026-08-29T09:00:00.000Z') });
  const token = Buffer.alloc(32, 7).toString('base64url');
  const active = await service.validateSessionToken(token);
  assert.equal(active.ok, true);
  assert.equal(active.adminId, 100);
  assert.deepEqual(active.viewer, { calendarScope: 'business_all_staff' });

  row = { ...row, admin_active: false };
  assert.deepEqual(await service.validateSessionToken(token), { ok: false, code: 'STAFF_SESSION_INVALID' });
  row = null;
  assert.deepEqual(await service.validateSessionToken(token), { ok: false, code: 'STAFF_SESSION_INVALID' });
});

test('Open Calendar uses one-time handoff while canonical capability remains sole human authority', () => {
  const token = Buffer.alloc(32, 7).toString('base64url');
  assert.equal(
    buildCalendarHandoffUrl(token, { SHILOH_CALENDAR_PUBLIC_ORIGIN: 'https://calendar.example.test/path' }),
    `https://calendar.example.test/calendar/staff/handoff#handoff=${token}`,
  );
  assert.equal(buildCalendarHandoffUrl(token, { SHILOH_CALENDAR_PUBLIC_ORIGIN: 'http://calendar.example.test' }), null);
  assert.equal(buildCalendarHandoffUrl(token, { SHILOH_CALENDAR_PUBLIC_ORIGIN: 'https://user:pass@calendar.example.test' }), null);

  assert.equal(isCalendarHandoffAuthority(principal('Canonical viewer')), true);
  assert.equal(isCalendarHandoffAuthority(principal('No view', { permissions: {} })), false);
  assert.equal(isCalendarHandoffAuthority(principal('Inactive', { admin_active: false })), false);
  assert.equal(isCalendarHandoffAuthority(principal('Inactive linked staff', { staff_id: 11, staff_status: 'inactive' })), false);

  const launcher = read('src/services/adminInteractiveMenu.js');
  const handoff = read('src/services/staffCalendarHandoff.js');
  assert.doesNotMatch(launcher, /issueForWhatsapp|secure one-time link|Open Calendar/);
  assert.match(launcher, /processRetiredAdminAuthorityMessage/);
  assert.doesNotMatch(handoff, /EMERGENCY_ADMIN_ID|staffBrowserPilotGate|SHILOH_STAFF_BROWSER_PILOT|SHILOH_EMERGENCY_CHRISTEL_CALENDAR_BOOKING_ENABLED/);
  assert.doesNotMatch(handoff, /display_name\s*===|Christel|Jean-Pierre|Naomi|Marietjie|Abigail/);
});

test('retired public fallback routes stay closed while controlled recovery, CSRF and endpoint revalidation remain installed', () => {
  const auth = read('src/services/providerIndependentStaffAuth.js');
  const authRoutes = read('src/routes/staffBrowserSession.js');
  const middleware = read('src/middleware/staffBrowserSession.js');
  const bookingRoutes = read('src/routes/calendarCreateBooking.js');
  const mutationRoutes = read('src/routes/calendarOperationalMutations.js');
  assert.match(auth, /verifyTotp/);
  assert.match(auth, /verifyRecovery/);
  assert.match(auth, /issueBreakGlass/);
  assert.match(auth, /exchangeBreakGlass/);
  assert.doesNotMatch(authRoutes, /router\.post\('\/totp\/verify'/);
  assert.doesNotMatch(authRoutes, /router\.post\('\/totp\/recovery\/verify'/);
  assert.match(authRoutes, /totp\/break-glass\/exchange/);
  assert.match(authRoutes, /calendar-handoff\/exchange/);
  assert.match(middleware, /sameOriginGuard/);
  assert.match(middleware, /csrfGuard/);
  assert.match(bookingRoutes, /sameOrigin, requireSession, requireCsrf/);
  assert.match(bookingRoutes, /bookingService\.prepare/);
  assert.match(mutationRoutes, /const mutationChain = \[sameOrigin, requireSession, requireCsrf, requireCapability\]/);
  assert.match(mutationRoutes, /mutationService\.resolveOperator\(req\.staffBrowserSession\.adminId\)/);
});
