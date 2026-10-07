'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { dashboardCalendarHref } = require('../src/routes/workspaceOperational');

test('#895 Workspace Calendar entry opens Week with All staff by default', () => {
  assert.equal(
    dashboardCalendarHref({ operationalDateKey: '2026-09-11', mode: 'owner_overview' }),
    '/calendar/read-only?view=week&date=2026-09-11&staff=all&phoneStaff=default',
  );
});

test('#895 own-scope Workspace Calendar entry still requests all within canonical permitted scope', () => {
  assert.equal(
    dashboardCalendarHref({ operationalDateKey: '2026-09-11', mode: 'practitioner' }),
    '/calendar/read-only?view=week&date=2026-09-11&staff=all&phoneStaff=default',
  );
});
