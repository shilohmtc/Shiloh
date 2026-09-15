const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
  normalizeDayPayload,
  canonicalDays,
  revisionFor,
  createWorkspaceClinicHoursService,
} = require('../src/services/workspaceClinicHours');
const { createWorkspaceClinicHoursRouter } = require('../src/routes/workspaceClinicHours');
const {
  renderClinicHoursPage,
  clinicHoursClientScript,
} = require('../src/presentation/workspaceClinicHoursUx');
const { createWorkspaceNavigationService } = require('../src/services/workspaceNavigation');

const location = { id: 4, name: 'Synthetic Clinic', timezone: 'Africa/Johannesburg' };
const principal = {
  id: 61,
  staff_id: null,
  display_name: 'Synthetic Owner',
  permissions: { 'schedule:manage': true },
  admin_active: true,
  staff_status: null,
};
const initialRows = [
  { id: 1, day_of_week: 1, starts_local: '08:00:00', ends_local: '17:00:00' },
  { id: 2, day_of_week: 2, starts_local: '08:00:00', ends_local: '17:00:00' },
  { id: 3, day_of_week: 3, starts_local: '08:00:00', ends_local: '17:00:00' },
  { id: 4, day_of_week: 4, starts_local: '08:00:00', ends_local: '17:00:00' },
  { id: 5, day_of_week: 5, starts_local: '08:00:00', ends_local: '17:00:00' },
  { id: 6, day_of_week: 6, starts_local: '08:00:00', ends_local: '14:00:00' },
];

function desiredDays() {
  return [
    { dayOfWeek: 1, open: true, startsLocal: '08:30', endsLocal: '17:30' },
    { dayOfWeek: 2, open: true, startsLocal: '08:00', endsLocal: '17:00' },
    { dayOfWeek: 3, open: false },
    { dayOfWeek: 4, open: true, startsLocal: '09:00', endsLocal: '18:00' },
    { dayOfWeek: 5, open: true, startsLocal: '08:00', endsLocal: '16:00' },
    { dayOfWeek: 6, open: true, startsLocal: '08:00', endsLocal: '14:00' },
  ];
}

function fakeDatabase({ authority = principal, rows = initialRows } = {}) {
  const calls = [];
  let active = rows.map(row => ({ ...row }));
  let nextId = 100;
  const query = async (text, params = []) => {
    const sql = String(text).replace(/\s+/g, ' ').trim();
    calls.push({ sql, params });
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
    if (sql.includes('workspaceClinicHours:principal')) return { rows: authority ? [authority] : [], rowCount: authority ? 1 : 0 };
    if (sql.includes('workspaceClinicHours:activeRows')) return { rows: active.map(row => ({ ...row })), rowCount: active.length };
    if (sql.includes('workspaceClinicHours:assistantRows')) return { rows: active.map(row => ({ ...row })), rowCount: active.length };
    if (sql.includes('workspaceClinicHours:exceptionRows')) return { rows: [], rowCount: 0 };
    if (sql.includes('workspaceClinicHours:holidayRows')) return { rows: [], rowCount: 0 };
    if (sql.includes('workspaceClinicHours:deactivateWritable')) {
      active = active.filter(row => Number(row.day_of_week) === 0);
      return { rows: [], rowCount: 6 };
    }
    if (sql.includes('workspaceClinicHours:upsertWritable')) {
      const [locationId, dayOfWeek, startsLocal, endsLocal] = params;
      assert.equal(locationId, location.id);
      active = active.filter(row => !(Number(row.day_of_week) === Number(dayOfWeek) && String(row.starts_local).slice(0, 5) === startsLocal && String(row.ends_local).slice(0, 5) === endsLocal));
      active.push({ id: nextId++, day_of_week: Number(dayOfWeek), starts_local: `${startsLocal}:00`, ends_local: `${endsLocal}:00` });
      active.sort((a, b) => Number(a.day_of_week) - Number(b.day_of_week));
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('workspaceClinicHours:audit')) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const client = { query, release() {} };
  return { query, connect: async () => client, calls, active: () => active.map(row => ({ ...row })) };
}

function serviceFor(db) {
  return createWorkspaceClinicHoursService({ db, locationResolver: async () => location });
}

test('#751 validates one bounded Monday-Saturday window and never accepts Sunday mutation', () => {
  assert.equal(normalizeDayPayload(desiredDays()).length, 6);
  assert.throws(() => normalizeDayPayload([...desiredDays().slice(0, 5), { dayOfWeek: 0, open: true, startsLocal: '08:00', endsLocal: '12:00' }]), error => error.httpStatus === 400);
  assert.throws(() => normalizeDayPayload(desiredDays().map(day => day.dayOfWeek === 2 ? { ...day, startsLocal: '17:00', endsLocal: '08:00' } : day)), error => error.code === 'WORKSPACE_CLINIC_HOURS_INVALID_WINDOW');
  assert.throws(() => normalizeDayPayload(desiredDays().map(day => day.dayOfWeek === 2 ? { ...day, startsLocal: '8:00' } : day)), error => error.code === 'WORKSPACE_CLINIC_HOURS_INVALID_TIME');
});

test('#751 canonical projection keeps Sunday permanently closed and fails closed on multi-window days', () => {
  const days = canonicalDays(initialRows);
  assert.equal(days.length, 7);
  assert.deepEqual(days.at(-1), { dayOfWeek: 0, name: 'Sunday', open: false, startsLocal: null, endsLocal: null, permanent: true });
  assert.throws(() => canonicalDays([...initialRows, { id: 91, day_of_week: 1, starts_local: '18:00:00', ends_local: '19:00:00' }]), error => error.httpStatus === 409 && error.code === 'WORKSPACE_CLINIC_HOURS_AMBIGUOUS_DAY');
});

test('#751 authorized update mutates only recurring location hours and writes before/after audit evidence', async () => {
  const db = fakeDatabase();
  const service = serviceFor(db);
  const model = await service.buildModel({ adminId: 61 });
  const result = await service.updateHours({ adminId: 61, expectedRevision: model.revision, days: desiredDays() });
  assert.equal(result.status, 'updated');
  assert.equal(result.days.find(day => day.dayOfWeek === 3).open, false);
  assert.equal(result.days.find(day => day.dayOfWeek === 1).startsLocal, '08:30');
  assert.equal(result.days.find(day => day.dayOfWeek === 0).permanent, true);
  const writes = db.calls.filter(call => /\b(?:UPDATE|INSERT)\b/.test(call.sql));
  assert.ok(writes.some(call => call.sql.includes('location_working_hours')));
  assert.ok(writes.some(call => call.sql.includes('crm_audit_events')));
  for (const call of writes) {
    assert.doesNotMatch(call.sql, /appointments|location_hours_exceptions|staff_working_hours|staff_schedule_exceptions/);
  }
  const audit = db.calls.find(call => call.sql.includes('workspaceClinicHours:audit'));
  const metadata = JSON.parse(audit.params[2]);
  assert.equal(metadata.before.length, 7);
  assert.equal(metadata.after.length, 7);
  assert.equal(metadata.after.find(day => day.dayOfWeek === 0).permanent, true);
});

test('#751 unauthorized, stale and ambiguous authority fail closed before recurring-hours writes', async () => {
  const deniedDb = fakeDatabase({ authority: { ...principal, permissions: {} } });
  await assert.rejects(serviceFor(deniedDb).buildModel({ adminId: 61 }), error => error.httpStatus === 403);
  assert.equal(deniedDb.calls.some(call => call.sql.includes('deactivateWritable')), false);

  const staleDb = fakeDatabase();
  await assert.rejects(serviceFor(staleDb).updateHours({ adminId: 61, expectedRevision: '0'.repeat(64), days: desiredDays() }), error => error.httpStatus === 409);
  assert.equal(staleDb.calls.some(call => call.sql.includes('deactivateWritable')), false);

  const ambiguousDb = fakeDatabase({ rows: [...initialRows, { id: 50, day_of_week: 4, starts_local: '18:00:00', ends_local: '19:00:00' }] });
  await assert.rejects(serviceFor(ambiguousDb).buildModel({ adminId: 61 }), error => error.httpStatus === 409);
  assert.equal(ambiguousDb.calls.some(call => call.sql.includes('deactivateWritable')), false);
});

test('#751 model revision is deterministic and changes when canonical hours change', () => {
  const before = canonicalDays(initialRows);
  const after = canonicalDays(initialRows.map(row => Number(row.day_of_week) === 1 ? { ...row, starts_local: '09:00:00' } : row));
  assert.equal(revisionFor(location.id, before), revisionFor(location.id, before));
  assert.notEqual(revisionFor(location.id, before), revisionFor(location.id, after));
});

test('#751 presentation is explicit about existing appointments, holiday separation and permanent Sunday closure', () => {
  const days = canonicalDays(initialRows);
  const html = renderClinicHoursPage({ location, days, revision: revisionFor(location.id, days) });
  assert.match(html, /Clinic hours/);
  assert.match(html, /Existing appointments are not moved or cancelled/);
  assert.match(html, /Public holidays and one-off clinic closures remain separate/);
  assert.match(html, /Sunday cannot be opened here/);
  assert.match(html, /type="time"/);
  assert.match(clinicHoursClientScript(), /staff-auth\/csrf/);
  assert.match(clinicHoursClientScript(), /x-shiloh-csrf-token/);
  assert.match(html, /data-workspace-destination="clinicHours"/);
  assert.match(html, /data-clinic-hours-mobile-cohesion/);
  assert.match(html, /position:sticky/);
  assert.match(html, /data-open="false"/);
});

test('#751 Workspace navigation exposes Clinic hours only when schedule:manage access resolves', async () => {
  const allow = { resolveAccess: async () => ({ operatorAdminId: 61 }) };
  const deny = { resolveAccess: async () => null };
  const base = { resolveAccess: async () => ({ ok: true }) };
  const allowedService = createWorkspaceNavigationService({ clientAccessService: base, staffAccessService: base, servicesAccessService: base, reportsAccessService: base, clinicHoursAccessService: allow });
  const deniedService = createWorkspaceNavigationService({ clientAccessService: base, staffAccessService: base, servicesAccessService: base, reportsAccessService: base, clinicHoursAccessService: deny });
  assert.deepEqual((await allowedService.resolve({ session: { adminId: 61, viewer: {} } })).clinicHours, { allowed: true, href: '/calendar/clinic-hours' });
  assert.deepEqual((await deniedService.resolve({ session: { adminId: 61, viewer: {} } })).clinicHours, { allowed: false, href: null });
});

test('#751 POST route preserves authenticated session, same-origin and CSRF guards before bounded service mutation', async () => {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use('/calendar/clinic-hours', createWorkspaceClinicHoursRouter({
    env: { SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true', SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true' },
    sessionService: {
      validateSessionToken: async token => token ? ({ ok: true, adminId: 61, sessionId: 10 }) : ({ ok: false }),
      validateCsrfToken: (_session, token) => token === 'good-csrf',
    },
    service: {
      updateHours: async payload => { calls.push(payload); return { status: 'updated', revision: '1'.repeat(64) }; },
      buildModel: async () => ({ location, days: canonicalDays(initialRows), revision: '1'.repeat(64) }),
    },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const body = JSON.stringify({ expectedRevision: 'a'.repeat(64), days: desiredDays(), locationId: 999, sunday: { open: true } });
  try {
    const noOrigin = await fetch(`${origin}/calendar/clinic-hours`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'shiloh_staff_session=synthetic', 'x-shiloh-csrf-token': 'good-csrf' }, body });
    assert.equal(noOrigin.status, 403);
    const noCsrf = await fetch(`${origin}/calendar/clinic-hours`, { method: 'POST', headers: { 'content-type': 'application/json', origin, cookie: 'shiloh_staff_session=synthetic' }, body });
    assert.equal(noCsrf.status, 403);
    const ok = await fetch(`${origin}/calendar/clinic-hours`, { method: 'POST', headers: { 'content-type': 'application/json', origin, cookie: 'shiloh_staff_session=synthetic', 'x-shiloh-csrf-token': 'good-csrf' }, body });
    assert.equal(ok.status, 200);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { adminId: 61, expectedRevision: 'a'.repeat(64), days: desiredDays() });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
