const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const servicePath = path.join(__dirname, '..', 'src', 'services', 'adminBlockTime.js');
const availabilityPath = path.join(__dirname, '..', 'src', 'services', 'availabilityService.js');
const packagePath = path.join(__dirname, '..', 'package.json');
const source = fs.readFileSync(servicePath, 'utf8');
const availability = fs.readFileSync(availabilityPath, 'utf8');
const pkg = fs.readFileSync(packagePath, 'utf8');
const {
  canPresentBlockTime,
  resolveBlockTimeTargets,
  parseDate,
  parseTime,
  parseDuration,
  toInterval,
  blockTypeForReason,
  assertNoOverlap,
} = require(servicePath);

const christel = { id: 10, staff_id: 1, display_name: 'Christel', business_role: 'owner', calendar_scope: 'all_business' };
const abigail = { id: 11, staff_id: 2, display_name: 'Abigail', business_role: 'employee_practitioner', calendar_scope: 'own' };
const marietjie = { id: 12, staff_id: 3, display_name: 'Marietjie', business_role: 'tenant_practitioner', calendar_scope: 'own' };
const jp = { id: 13, staff_id: null, display_name: 'Jean-Pierre', business_role: 'business_admin', calendar_scope: 'all_business' };

test('block-time presentation authority is explicit and does not inherit broad booking authority', () => {
  assert.equal(canPresentBlockTime(christel), true);
  assert.equal(canPresentBlockTime(abigail), true);
  assert.equal(canPresentBlockTime(marietjie), true);
  assert.equal(canPresentBlockTime(jp), false);
  assert.equal(canPresentBlockTime({ ...jp, staff_id: 99 }), false);
});

test('Christel resolves Myself plus exactly one active Abigail target', async () => {
  const responses = [
    { rows: [{ id: 1, display_name: 'Christel' }] },
    { rows: [{ id: 2, display_name: 'Abigail' }] },
  ];
  const db = { query: async () => responses.shift() };
  assert.deepEqual(await resolveBlockTimeTargets(christel, db), [
    { id: 1, display_name: 'Christel' },
    { id: 2, display_name: 'Abigail' },
  ]);
});

test('Christel fails closed to own-only when Abigail identity is ambiguous', async () => {
  const responses = [
    { rows: [{ id: 1, display_name: 'Christel' }] },
    { rows: [{ id: 2, display_name: 'Abigail' }, { id: 22, display_name: 'Abigail' }] },
  ];
  const db = { query: async () => responses.shift() };
  assert.deepEqual(await resolveBlockTimeTargets(christel, db), [{ id: 1, display_name: 'Christel' }]);
});

test('Abigail and Marietjie resolve only their own practitioner target', async () => {
  const abigailDb = { query: async () => ({ rows: [{ id: 2, display_name: 'Abigail' }] }) };
  const marietjieDb = { query: async () => ({ rows: [{ id: 3, display_name: 'Marietjie' }] }) };
  assert.deepEqual(await resolveBlockTimeTargets(abigail, abigailDb), [{ id: 2, display_name: 'Abigail' }]);
  assert.deepEqual(await resolveBlockTimeTargets(marietjie, marietjieDb), [{ id: 3, display_name: 'Marietjie' }]);
});

test('date time duration and interval parsing are deterministic for Johannesburg block time', () => {
  const now = new Date('2026-08-20T10:00:00Z');
  assert.equal(parseDate('today', now), '2026-08-20');
  assert.equal(parseDate('tomorrow', now), '2026-08-21');
  assert.equal(parseDate('2026-08-24', now), '2026-08-24');
  assert.equal(parseDate('2026-08-19', now), null);
  assert.equal(parseTime('14:15'), '14:15');
  assert.equal(parseTime('2pm'), '14:00');
  assert.equal(parseTime('14:10'), null);
  assert.equal(parseDuration('30 min'), 30);
  assert.equal(parseDuration('75'), 75);
  assert.equal(parseDuration('17'), null);
  assert.deepEqual(toInterval('2026-08-24', '14:00', 60), {
    startsAt: '2026-08-24T12:00:00.000Z',
    endsAt: '2026-08-24T13:00:00.000Z',
  });
  assert.equal(blockTypeForReason('Personal'), 'personal_event');
  assert.equal(blockTypeForReason('Lunch'), 'other');
});

test('overlap guard rejects an existing appointment before any calendar block insert', async () => {
  let calls = 0;
  const db = { query: async () => { calls += 1; return { rowCount: 1, rows: [{ id: 570 }] }; } };
  await assert.rejects(
    () => assertNoOverlap(db, 1, '2026-08-24T12:00:00Z', '2026-08-24T13:00:00Z'),
    /overlaps an existing appointment/
  );
  assert.equal(calls, 1);
});

test('block-time writes remain calendar blocks and never manufacture appointments or client messaging', () => {
  assert.match(source, /INSERT INTO calendar_blocks/);
  assert.match(source, /schedule\.block_time_created/);
  assert.match(source, /schedule\.block_time_updated/);
  assert.match(source, /schedule\.block_time_removed/);
  assert.match(source, /source = 'shiloh'/);
  assert.doesNotMatch(source, /INSERT INTO appointments/);
  assert.doesNotMatch(source, /sendWhatsApp(?:Message|Template|ReplyButtons|List)/);
});

test('shared client slot generation already excludes calendar blocks', () => {
  assert.match(availability, /FROM calendar_blocks cb/);
  assert.match(availability, /cb\.starts_at < \(c\.local_end AT TIME ZONE/);
  assert.match(availability, /cb\.ends_at > \(c\.local_start AT TIME ZONE/);
});

test('Block time belongs to Calendar without a startup preload or ordinary WhatsApp action', () => {
  assert.doesNotMatch(pkg, /adminBlockTimePatch\.js/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'webhookController.js'), 'utf8'), /processAdminBlockTimeMessage/);
});
