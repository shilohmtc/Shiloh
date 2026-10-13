const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const servicePath = path.join(__dirname,'..','src','services','adminClientDemo.js');

const tableMigrationPath = path.join(__dirname,'..','migrations','041_christel_client_demo_mode.sql');
const staffMigrationPath = path.join(__dirname,'..','migrations','043_demo_client_staff_access.sql');
const source = fs.readFileSync(servicePath,'utf8');

const tableMigration = fs.readFileSync(tableMigrationPath,'utf8');
const staffMigration = fs.readFileSync(staffMigrationPath,'utf8');
const { exactTime, localDateTime, practitionerName, demoScope, practitionerAllowed } = require(servicePath);

test('demo session table remains isolated and demo permission is limited to the three named practitioners',()=>{
  assert.match(tableMigration,/CREATE TABLE IF NOT EXISTS admin_client_demo_sessions/);
  assert.match(staffMigration,/"demo:client":true/);
  assert.match(staffMigration,/LOWER\(display_name\) = 'christel'/);
  assert.match(staffMigration,/LOWER\(display_name\) = 'abigail'/);
  assert.match(staffMigration,/LOWER\(display_name\) = 'marietjie'/);
  assert.match(staffMigration,/business_role = 'owner'/);
  assert.match(staffMigration,/business_role = 'employee_practitioner'/);
  assert.match(staffMigration,/business_role = 'tenant_practitioner'/);
  assert.doesNotMatch(staffMigration,/LOWER\(display_name\) = 'jean-pierre'/);
  assert.match(staffMigration,/permissions \? 'demo:client'/);
  assert.match(staffMigration,/permissions = COALESCE\(permissions, '\{\}'::jsonb\) - 'demo:client'/);
});

test('demo mode uses isolated virtual identity and never imports outbound WhatsApp sender',()=>{
  assert.match(source,/virtual_phone/);
  assert.match(source,/isolatedVirtualIdentity: true/);
  assert.match(source,/source='whatsapp_demo'/);
  assert.doesNotMatch(source,/require\(['"]\.\/whatsapp['"]\)/);
  assert.doesNotMatch(source,/sendWhatsAppMessage\(/);
});

test('demo booking purge is proof-bound and cannot be an arbitrary appointment delete',()=>{
  assert.match(source,/demo_appointment_id/);
  assert.match(source,/a\.source !== 'shiloh_demo_whatsapp'/);
  assert.match(source,/a\.client_source !== 'whatsapp_demo'/);
  assert.match(source,/custom_attributes\?\.demo_admin_id/);
  assert.match(source,/CONFIRM DELETE DEMO BOOKING/);
  assert.match(source,/DELETE FROM appointments WHERE id=\$1/);
  assert.match(source,/loyalty_redemptions WHERE appointment_id=\$1/);
  assert.doesNotMatch(source,/delete\s+(?:appointment|booking)\s+#?\\d+/i);
});

test('Google Calendar cleanup happens before the demo appointment delete',()=>{
  const cancel = source.indexOf('await cancelBookingEvent(row.event_id)');
  const remove = source.indexOf('DELETE FROM appointments WHERE id=$1');
  assert.ok(cancel >= 0 && remove >= 0 && cancel < remove);
});

test('demo booking is tagged distinctly and audited without hardcoded Christel-only copy',()=>{
  assert.match(source,/source='shiloh_demo_whatsapp'/);
  assert.match(source,/admin\.demo_booking_created/);
  assert.match(source,/admin\.demo_booking_purged/);
  assert.match(source,/admin\.client_demo_started/);
  assert.match(source,/Controlled \$\{admin\.display_name\} WhatsApp client demonstration/);
  assert.match(source,/\$\{admin\.display_name\} is back in admin mode/);
  assert.doesNotMatch(source,/Controlled Christel WhatsApp client demonstration/);
  assert.doesNotMatch(source,/Christel is back in admin mode/);
  assert.doesNotMatch(source,/Christel’s controlled demo session/);
});

test('demo time parser accepts exact client-like clock forms safely',()=>{
  assert.equal(exactTime('14:30'),'14:30');
  assert.equal(exactTime('2pm'),'14:00');
  assert.equal(exactTime('2:30pm'),'14:30');
  assert.equal(exactTime('12am'),'00:00');
  assert.equal(exactTime('12pm'),'12:00');
  assert.equal(exactTime('morning'),null);
  assert.equal(exactTime('25:00'),null);
  assert.equal(localDateTime('2026-08-20','2pm'),'20/08/2026 14:00');
});

test('demo practitioner aliases remain limited to client-bookable named practitioners',()=>{
  assert.equal(practitionerName('Christel'),'Christel');
  assert.equal(practitionerName('Abigail'),'Abigail');
  assert.equal(practitionerName('Marietjie'),'Marietjie');
  assert.equal(practitionerName('Mariethie'),'Marietjie');
  assert.equal(practitionerName('Savanna'),null);
  assert.equal(practitionerName('Pieter'),null);
});

test('Marietjie is isolated while Christel and Abigail share the controlled demo practitioner pool',()=>{
  const marietjie = { display_name:'Marietjie', business_role:'tenant_practitioner' };
  const abigail = { display_name:'Abigail', business_role:'employee_practitioner' };
  const christel = { display_name:'Christel', business_role:'owner' };
  const jp = { display_name:'Jean-Pierre', business_role:'business_admin' };
  assert.deepEqual(demoScope(marietjie).staffNames,['marietjie']);
  assert.deepEqual(demoScope(abigail).staffNames,['christel','abigail']);
  assert.deepEqual(demoScope(christel).staffNames,['christel','abigail']);
  assert.equal(demoScope(jp),null);
  assert.equal(practitionerAllowed(marietjie,'Marietjie'),true);
  assert.equal(practitionerAllowed(marietjie,'Christel'),false);
  assert.equal(practitionerAllowed(abigail,'Christel'),true);
  assert.equal(practitionerAllowed(abigail,'Abigail'),true);
  assert.equal(practitionerAllowed(abigail,'Marietjie'),false);
});

test('final demo booking scope is checked against active client-bookable CRM staff-service mappings',()=>{
  assert.match(source,/JOIN staff_services ss ON ss\.staff_id=st\.id/);
  assert.match(source,/st\.client_bookable=TRUE/);
  assert.match(source,/s\.status='active'/);
  assert.match(source,/authorizeDemoStaffService\(admin, staffName, service\.canonicalName\)/);
  const scopeCheck = source.indexOf('const scopeCheck = await authorizeDemoStaffService');
  const prepare = source.indexOf('const prepared = await prepareAdminBooking');
  assert.ok(scopeCheck >= 0 && prepare >= 0 && scopeCheck < prepare);
});
