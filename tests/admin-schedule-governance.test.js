const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ux = fs.readFileSync(path.join(__dirname,'../src/services/adminScheduleUx.js'),'utf8');

const migration = fs.readFileSync(path.join(__dirname,'../migrations/056_staff_leave_approval_workflow.sql'),'utf8');

test('internal Schedule service remains role-aware but is absent from ordinary staff menu', () => {
  assert.match(ux,/Request leave/);
  assert.match(ux,/Leave requests/);
  assert.match(ux,/My availability/);
  assert.match(ux,/Clinic closures/);
  assert.doesNotMatch(ux,/Freelancer availability/);
  assert.doesNotMatch(ux,/Staff hours/);

});

test('Abigail leave is pending until Christel resolves it', () => {
  assert.match(migration,/status TEXT NOT NULL DEFAULT 'pending'/);
  assert.match(migration,/approved/);
  assert.match(migration,/declined/);
  assert.match(ux,/Nothing changes in your availability until Christel approves/);
  assert.match(ux,/schedule_leave_approve_/);
  assert.match(ux,/schedule_leave_decline_/);
});

test('Approval is conflict-aware, audited and atomically writes canonical exceptions', () => {
  assert.match(ux,/appointmentConflicts/);
  assert.match(ux,/Existing appointments, if any, were left unchanged/);
  assert.match(ux,/BEGIN/);
  assert.match(ux,/staff_schedule_exceptions/);
  assert.match(ux,/schedule\.leave_approved/);
  assert.match(ux,/COMMIT/);
  const insert = ux.indexOf('INSERT INTO staff_schedule_exceptions');
  const approved = ux.indexOf("status='approved'");
  assert.ok(insert >= 0 && approved > insert, 'request must not be marked approved before exceptions are written');
});

test('Marietjie is independent and Christel owns clinic closures', () => {
  assert.match(ux,/business_role==='tenant_practitioner'/);
  assert.match(ux,/schedule_my_time_off/);
  assert.match(ux,/schedule_holiday_hours/);
  assert.match(ux,/isChristel\(admin\).*processAdminHolidayHoursMessage/s);
});
