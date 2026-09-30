const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canAccessOwnFinalization,
  canAccessWorkspaceOwnFinalization,
  canAccessWorkspaceBackupFinalization,
  certificationStaffIds,
  canCertifyAppointment,
  authorityDescription,
} = require('../src/services/attendanceFinalizationAuthority');

const admins = {
  christel: { display_name: 'Christel', staff_id: 11 },
  abigail: { display_name: 'Abigail', staff_id: 22 },
  retired: { display_name: 'Former practitioner', staff_id: 33 },
  jp: { display_name: 'Jean-Pierre', staff_id: null },
};

function authorityDb(appointmentStaffIds = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM staff\s+WHERE id=\$1/.test(sql)) return { rows: [{ id: params[0] }] };
      if (/FROM appointment_staff/.test(sql)) return { rows: appointmentStaffIds.map((staff_id) => ({ staff_id })) };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test('current practitioners resolve exactly their linked canonical staff identity', async () => {
  for (const admin of [admins.christel, admins.abigail]) {
    const db = authorityDb();
    assert.equal(canAccessOwnFinalization(admin), true);
    assert.deepEqual(await certificationStaffIds(admin, db), [admin.staff_id]);
    assert.deepEqual(db.calls[0].params, [admin.staff_id, admin.display_name.toLowerCase()]);
    assert.equal(authorityDescription(admin), `${admin.display_name} appointments`);
  }
});

test('JP, unlinked practitioner Admins and unknown names fail closed before querying staff', async () => {
  const db = { query: async () => { throw new Error('fail-closed identities must not query'); } };
  for (const admin of [admins.jp, admins.retired, { display_name: 'Abigail', staff_id: null }, { display_name: 'Unknown', staff_id: 44 }]) {
    assert.equal(canAccessOwnFinalization(admin), false);
    assert.deepEqual(await certificationStaffIds(admin, db), []);
    assert.equal(authorityDescription(admin), 'review only');
  }
});

test('each practitioner can certify only appointments assigned entirely to their own staff ID', async () => {
  assert.equal(await canCertifyAppointment(admins.christel, 1, authorityDb([11])), true);
  assert.equal(await canCertifyAppointment(admins.christel, 2, authorityDb([22])), false);
  assert.equal(await canCertifyAppointment(admins.abigail, 3, authorityDb([22])), true);
  assert.equal(await canCertifyAppointment(admins.abigail, 4, authorityDb([11])), false);
  assert.equal(await canCertifyAppointment(admins.retired, 5, authorityDb([33])), false);
  assert.equal(await canCertifyAppointment(admins.retired, 6, authorityDb([33, 22])), false);
});

test('missing or ambiguous canonical identity evidence fails closed', async () => {
  const missing = { query: async () => ({ rows: [] }) };
  const ambiguous = { query: async () => ({ rows: [{ id: 22 }, { id: 22 }] }) };
  assert.deepEqual(await certificationStaffIds(admins.abigail, missing), []);
  assert.deepEqual(await certificationStaffIds(admins.abigail, ambiguous), []);
});

test('Workspace self-finalization uses current linked scope and capabilities without person-name policy', async () => {
  const admin = {
    display_name: 'Any Canonical Practitioner', staff_id: 44, staff_status: 'active', admin_active: true,
    calendar_scope: 'own_appointments', permissions: { 'appointment:view': true, 'booking:update': true },
  };
  const db = authorityDb([44]);
  assert.equal(canAccessOwnFinalization(admin), false);
  assert.equal(canAccessWorkspaceOwnFinalization(admin), true);
  assert.deepEqual(await certificationStaffIds(admin, db, { workspace: true }), [44]);
  assert.deepEqual(db.calls[0].params, [44]);
  assert.equal(await canCertifyAppointment(admin, 77, authorityDb([44]), { workspace: true }), true);
  assert.equal(await canCertifyAppointment(admin, 78, authorityDb([44, 55]), { workspace: true }), false);
});

test('owner backup is capability/scope-bound and only activates in explicit Workspace mode', async () => {
  const owner = {
    display_name: 'Canonical Owner', staff_id: null, admin_active: true,
    business_role: 'owner', calendar_scope: 'all_business',
    permissions: { 'appointment:view': true, 'booking:update': true },
  };
  assert.equal(canAccessWorkspaceBackupFinalization(owner), true);
  assert.equal(await canCertifyAppointment(owner, 80, authorityDb([44]), { workspace: true, allowBusinessBackup: true }), true);
  assert.equal(await canCertifyAppointment(owner, 81, authorityDb([44])), false);
  assert.equal(await canCertifyAppointment({ ...owner, permissions: { 'appointment:view': true } }, 82, authorityDb([44]), { workspace: true, allowBusinessBackup: true }), false);
  const reception = { ...owner, display_name: 'Shiloh Reception', business_role: 'booking_operator' };
  assert.equal(canAccessWorkspaceBackupFinalization(reception), true);
  assert.equal(await canCertifyAppointment(reception, 83, authorityDb([44]), { workspace: true, allowBusinessBackup: true }), true);
});
