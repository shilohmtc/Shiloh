const test = require('node:test');
const assert = require('node:assert/strict');
const { createFixture } = require('./helpers/calendarCouplesCreationFixture');

for (const discount of [null, { type: 'amount', value: 100 }]) {
  test(`new minimal couples guests save atomically ${discount ? 'with R100 discount' : 'without discount'}`, async t => {
    const f = await createFixture(); t.after(f.close);
    await f.service.prepare({ ...f.input, discount });
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM crm_v2_clients')).rows[0].n, 0);
    const result = await f.service.confirm({ adminId: 7 });
    assert.equal(result.status, 'created');
    assert.equal(result.appointmentIds.length, 2);
    const clients = (await f.db.query('SELECT * FROM crm_v2_clients ORDER BY id')).rows;
    assert.equal(clients.length, 2);
    assert.ok(clients.every(c => c.gender === null && c.date_of_birth === null && c.profile_status === 'minimal' && c.mobile_verified_at === null));
    const group = (await f.db.query('SELECT * FROM appointment_groups')).rows[0];
    assert.equal(Number(group.canonical_subtotal), 1180);
    assert.equal(Number(group.discount_amount), discount ? 100 : 0);
    assert.equal(Number(group.final_total), discount ? 1080 : 1180);
    const members = (await f.db.query('SELECT * FROM appointment_group_members ORDER BY guest_position')).rows;
    assert.deepEqual(members.map(m => Number(m.allocated_price)), discount ? [540, 540] : [590, 590]);
    assert.deepEqual(f.state.sends, result.appointmentIds);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM synthetic_confirmation_obligations')).rows[0].n, 2);
    await assert.rejects(f.service.confirm({ adminId: 7 }), { code: 'COUPLES_NO_PENDING' });
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM appointments')).rows[0].n, 2);
  });
}

test('new and selected CRM profiles retain complete and partial optional details', async t => {
  const f = await createFixture(); t.after(f.close);
  await f.db.query("INSERT INTO crm_v2_clients(name,normalized_mobile,date_of_birth,gender,profile_status,source) VALUES('Existing Guest','27820000001','1990-01-02','female','registered','test')");
  const existing = (await f.db.query('SELECT id FROM crm_v2_clients')).rows[0];
  await f.service.prepare({ ...f.input, guests: [
    { ...f.input.guests[0], clientId: existing.id },
    { ...f.input.guests[1], gender: 'male' },
  ] });
  await f.service.confirm({ adminId: 7 });
  const clients = (await f.db.query('SELECT gender,profile_status,date_of_birth::text AS dob FROM crm_v2_clients ORDER BY id')).rows;
  assert.deepEqual(clients, [
    { gender: 'female', profile_status: 'registered', dob: '1990-01-02' },
    { gender: 'male', profile_status: 'minimal', dob: null },
  ]);
  await f.service.prepare({ ...f.input, guests: [
    { name: 'Complete New Guest', mobile: '0820000003', dateOfBirth: '1991-03-04', gender: 'prefer_not_to_say' },
    { name: 'DOB Only Guest', mobile: '0820000004', dateOfBirth: '1992-04-05' },
  ] });
  await f.service.confirm({ adminId: 7 });
  const added = (await f.db.query('SELECT gender,profile_status,date_of_birth::text AS dob FROM crm_v2_clients ORDER BY id DESC LIMIT 2')).rows;
  assert.deepEqual(added, [
    { gender: null, profile_status: 'minimal', dob: '1992-04-05' },
    { gender: 'prefer_not_to_say', profile_status: 'registered', dob: '1991-03-04' },
  ]);
});

test('a later confirmation failure rolls back both guests and booking, retaining a retryable review', async t => {
  const f = await createFixture(); t.after(f.close);
  await f.service.prepare(f.input);
  f.state.failQueue = true;
  await assert.rejects(f.service.confirm({ adminId: 7 }), { code: 'COUPLES_CONFIRMATION_QUEUE_FAILED' });
  for (const table of ['crm_v2_clients', 'appointments', 'appointment_groups', 'appointment_group_members', 'crm_audit_events', 'synthetic_confirmation_obligations']) {
    assert.equal((await f.db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0, table);
  }
  assert.deepEqual(f.state.sends, []);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM admin_couples_booking_sessions')).rows[0].n, 1);
  f.state.failQueue = false;
  assert.equal((await f.service.confirm({ adminId: 7 })).status, 'created');
});

for (const discount of [null, { type: 'amount', value: 100 }]) {
  test(`staff groups also save new guests ${discount ? 'with a discount' : 'without a discount'} after atomic rollback`, async t => {
    const f = await createFixture(); t.after(f.close);
    await f.groupService.prepare({ ...f.groupInput, discount });
    f.state.failQueue = true;
    await assert.rejects(f.groupService.confirm({ adminId: 7 }), { code: 'GROUP_CONFIRMATION_QUEUE_FAILED' });
    for (const table of ['crm_v2_clients', 'appointments', 'appointment_groups', 'synthetic_confirmation_obligations']) {
      assert.equal((await f.db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0, table);
    }
    assert.deepEqual(f.state.sends, []);
    f.state.failQueue = false;
    const result = await f.groupService.confirm({ adminId: 7 });
    assert.equal(result.status, 'created');
    assert.equal(result.appointmentIds.length, 3);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM crm_v2_clients')).rows[0].n, 3);
    assert.equal(Number((await f.db.query('SELECT final_total FROM appointment_groups')).rows[0].final_total), discount ? 1670 : 1770);
    assert.deepEqual(f.state.sends, result.appointmentIds);
  });
}
