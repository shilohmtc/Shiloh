const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname,'..','src','services','adminBookingUpdate.js'),'utf8');

test('Manage a booking is appointment-list first with manual number fallback',()=>{
  assert.match(source,/upcomingAppointmentsInteractive/);
  assert.match(source,/a\.starts_at>=NOW\(\)/);
  assert.match(source,/a\.status NOT IN \('cancelled','no_show'\)/);
  assert.match(source,/manage_booking_select_/);
  assert.match(source,/manage_booking_manual/);
  assert.match(source,/Enter appointment no\./);
  assert.doesNotMatch(source,/Example: \*369\*/);
});

test('non-privileged appointment discovery remains practitioner scoped',()=>{
  assert.match(source,/ast_scope\.staff_id=\$1/);
  assert.match(source,/if \(!privileged\(admin\)\)/);
});

test('selected rows still re-load canonical appointment and enforce authorization',()=>{
  assert.match(source,/loadAppointment\(admin, Number\(selected\[1\]\)\)/);
  assert.match(source,/if \(a\.forbidden\)/);
});
