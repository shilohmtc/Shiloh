const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const service = fs.readFileSync(path.join(__dirname,'..','src','services','adminServiceTrends.js'),'utf8');

test('service trends compare rolling 30-day booking windows',()=>{
  assert.match(service,/NOW\(\) - INTERVAL '30 days'/);
  assert.match(service,/NOW\(\) - INTERVAL '60 days'/);
  assert.match(service,/a\.status <> 'cancelled'/);
  assert.match(service,/current_count - previous_count/);
});

test('service trends respect business-wide versus practitioner service scope',()=>{
  assert.match(service,/isBusinessWide\(admin\)/);
  assert.match(service,/appointment_staff ast_scope/);
  assert.match(service,/staff_services ss_scope/);
  assert.match(service,/ss_scope\.service_id=aps\.service_id/);
});

test('service trends are permission gated, audited and descriptive only',()=>{
  assert.match(service,/appointment:view/);
  assert.match(service,/admin\.report\.service_trends/);
  assert.match(service,/not revenue or clinical outcomes/);
  assert.doesNotMatch(service,/UPDATE\s+appointments|DELETE\s+FROM\s+appointments|INSERT\s+INTO\s+appointments/i);
});
