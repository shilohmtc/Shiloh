const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const {
  createWorkspaceClinicHoursService,
} = require('../src/services/workspaceClinicHours');
const {
  createWorkspaceClinicHoursHolidayGuard,
} = require('../src/services/workspaceClinicHoursHolidayGuard');
const {
  createWorkspaceClinicHoursRouter,
} = require('../src/routes/workspaceClinicHours');
const {
  renderClinicHoursPage,
} = require('../src/presentation/workspaceClinicHoursUx');

const ENV = {
  SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true',
  SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true',
};

function principalRow(permissions = { 'schedule:manage': true }) {
  return {
    id: 41,
    staff_id: 8,
    display_name: 'Clinic operator',
    permissions,
    admin_active: true,
    staff_status: 'active',
  };
}

function canonicalWriteRow(exceptionType, startsLocal = null, endsLocal = null) {
  return {
    id: 91,
    exception_date: '2026-12-16',
    exception_type: exceptionType,
    starts_local: startsLocal,
    ends_local: endsLocal,
    actor_admin_id: 41,
    updated_at: new Date('2026-09-11T12:00:00Z'),
  };
}

test('holiday guard fails closed unless the date is a loaded ZA public holiday', async () => {
  const calls = [];
  const guard = createWorkspaceClinicHoursHolidayGuard({
    db: { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } },
  });
  await assert.rejects(
    guard.requireLoadedZaPublicHoliday('2026-12-15'),
    error => error.code === 'WORKSPACE_CLINIC_HOURS_HOLIDAY_NOT_LOADED' && error.httpStatus === 400
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /FROM public_holidays/);
  assert.match(calls[0].sql, /country_code='ZA'/);
  assert.deepEqual(calls[0].params, ['2026-12-15']);
});

test('exception mutation fails closed without schedule:manage before any canonical write', async () => {
  const calls = [];
  const db = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('workspaceClinicHours:principal')) return { rows: [principalRow({})] };
      throw new Error('No query is permitted after denied authority');
    },
  };
  const service = createWorkspaceClinicHoursService({
    db,
    locationResolver: async () => { throw new Error('Location must not resolve after denied authority'); },
  });
  await assert.rejects(
    service.upsertException({ adminId: 41, exceptionDate: '2026-12-16', exceptionType: 'closed' }),
    error => error.code === 'WORKSPACE_CLINIC_HOURS_FORBIDDEN' && error.httpStatus === 403
  );
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].sql, /location_hours_exceptions/);
});

test('canonical exception writer preserves provenance, same-date upsert, reopen and audit semantics', async () => {
  const calls = [];
  let mode = 'closed';
  const db = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('workspaceClinicHours:principal')) return { rows: [principalRow()] };
      if (sql.includes('workspaceClinicHours:upsertException')) {
        return { rows: [canonicalWriteRow(mode, mode === 'open' ? '09:00' : null, mode === 'open' ? '13:00' : null)] };
      }
      if (sql.includes('workspaceClinicHours:exceptionAudit')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const service = createWorkspaceClinicHoursService({
    db,
    locationResolver: async () => ({ id: 7, name: 'Shiloh', timezone: 'Africa/Johannesburg' }),
  });

  const closed = await service.upsertException({ adminId: 41, exceptionDate: '2026-12-16', exceptionType: 'closed' });
  assert.equal(closed.exception.exceptionType, 'closed');
  let write = calls.find(call => call.sql.includes('workspaceClinicHours:upsertException'));
  assert.match(write.sql, /INSERT INTO location_hours_exceptions/);
  assert.match(write.sql, /ON CONFLICT \(location_id, exception_date\)/);
  assert.match(write.sql, /actor_admin_id/);
  assert.deepEqual(write.params, [7, '2026-12-16', 'closed', null, null, 41]);
  let audit = calls.find(call => call.sql.includes('workspaceClinicHours:exceptionAudit'));
  assert.match(audit.sql, /admin\.holiday_hours_updated/);
  assert.equal(audit.params[0], 41);
  assert.equal(calls.some(call => /^BEGIN$/i.test(String(call.sql).trim())), false);

  calls.length = 0;
  mode = 'open';
  const reopened = await service.upsertException({
    adminId: 41,
    exceptionDate: '2026-12-16',
    exceptionType: 'open',
    startsLocal: '09:00',
    endsLocal: '13:00',
  });
  assert.equal(reopened.exception.exceptionType, 'open');
  assert.equal(reopened.exception.startsLocal, '09:00');
  write = calls.find(call => call.sql.includes('workspaceClinicHours:upsertException'));
  assert.deepEqual(write.params, [7, '2026-12-16', 'open', '09:00', '13:00', 41]);
});

async function withServer(app, callback) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('authenticated exception route checks holiday authority before delegating mutation and keeps CSRF/same-origin guards', async () => {
  let mutationCalls = 0;
  let holidayCalls = 0;
  const service = {
    buildModel: async () => { throw new Error('not used'); },
    updateHours: async () => { throw new Error('not used'); },
    upsertException: async payload => { mutationCalls++; return { status: 'updated', exception: payload }; },
  };
  const holidayGuard = {
    requireLoadedZaPublicHoliday: async date => {
      holidayCalls++;
      if (date !== '2026-12-16') {
        const error = new Error('Choose a loaded South African public-holiday date for this clinic-wide exception.');
        error.code = 'WORKSPACE_CLINIC_HOURS_HOLIDAY_NOT_LOADED';
        error.httpStatus = 400;
        throw error;
      }
    },
  };
  const sessionService = {
    validateSessionToken: async token => token === 'authorized' ? { ok: true, adminId: 41 } : { ok: false },
    validateCsrfToken: (_session, token) => token === 'csrf-ok',
  };
  const app = express();
  app.use(express.json());
  app.use('/calendar/clinic-hours', createWorkspaceClinicHoursRouter({ env: ENV, sessionService, service, holidayGuard }));

  await withServer(app, async origin => {
    const common = {
      method: 'POST',
      headers: {
        cookie: 'shiloh_staff_session=authorized',
        origin,
        'content-type': 'application/json',
        'x-shiloh-csrf-token': 'csrf-ok',
      },
    };
    let response = await fetch(`${origin}/calendar/clinic-hours/exceptions`, {
      ...common,
      body: JSON.stringify({ exceptionDate: '2026-12-15', exceptionType: 'closed' }),
    });
    assert.equal(response.status, 400);
    assert.equal(mutationCalls, 0);

    response = await fetch(`${origin}/calendar/clinic-hours/exceptions`, {
      ...common,
      body: JSON.stringify({ exceptionDate: '2026-12-16', exceptionType: 'open', startsLocal: '09:00', endsLocal: '13:00' }),
    });
    assert.equal(response.status, 200);
    assert.equal(mutationCalls, 1);

    response = await fetch(`${origin}/calendar/clinic-hours/exceptions`, {
      method: 'POST',
      headers: { cookie: 'shiloh_staff_session=authorized', origin, 'content-type': 'application/json' },
      body: JSON.stringify({ exceptionDate: '2026-12-16', exceptionType: 'closed' }),
    });
    assert.equal(response.status, 403);
    assert.equal(mutationCalls, 1);
    assert.equal(holidayCalls, 2);
  });
});

test('Clinic hours presentation keeps clinic-wide exceptions separate from practitioner leave/blocks and exposes edit/reopen only', () => {
  const html = renderClinicHoursPage({
    authority: { displayName: 'Clinic operator' },
    location: { id: 7, name: 'Shiloh', timezone: 'Africa/Johannesburg' },
    revision: 'a'.repeat(64),
    days: [
      { dayOfWeek: 1, name: 'Monday', open: true, startsLocal: '08:00', endsLocal: '17:00' },
      { dayOfWeek: 2, name: 'Tuesday', open: true, startsLocal: '08:00', endsLocal: '17:00' },
      { dayOfWeek: 3, name: 'Wednesday', open: true, startsLocal: '08:00', endsLocal: '17:00' },
      { dayOfWeek: 4, name: 'Thursday', open: true, startsLocal: '08:00', endsLocal: '17:00' },
      { dayOfWeek: 5, name: 'Friday', open: true, startsLocal: '08:00', endsLocal: '17:00' },
      { dayOfWeek: 6, name: 'Saturday', open: true, startsLocal: '08:00', endsLocal: '14:00' },
      { dayOfWeek: 0, name: 'Sunday', open: false, permanent: true },
    ],
    exceptions: [{ id: 91, exceptionDate: '2026-12-16', exceptionType: 'closed', holidayName: 'Day of Reconciliation' }],
  });
  assert.match(html, /Good to know/);
  assert.doesNotMatch(html, /Clinic-wide authority|Two clear boundaries/);
  assert.match(html, /Staff leave and blocked-off time will stay exactly as they are/);
  assert.match(html, /Day of Reconciliation/);
  assert.match(html, /data-edit-exception/);
  assert.match(html, /Changing a closed date back to Open reopens it/);
  assert.doesNotMatch(html, /data-delete-exception|Delete exception/);
});
