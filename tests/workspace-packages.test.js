const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { createWorkspacePackages, revision } = require('../src/services/workspacePackages');
const {
  createWorkspaceServicesService,
  serviceRevision,
} = require('../src/services/workspaceServices');
const {
  renderClientPackages,
  renderWorkspacePackages,
} = require('../src/presentation/workspacePackagesUx');
const fixture = fs.readFileSync('tests/fixtures/package-schema.sql', 'utf8');
async function setup() {
  const db = new PGlite();
  await db.exec(fixture);
  await db.exec(fs.readFileSync('migrations/061_massage_packages.sql', 'utf8'));
  await db.exec(
    "INSERT INTO client_package_entitlements(client_id,package_id,purchase_price,starts_at,expires_at,sessions_total) SELECT 1,id,1400,'2026-01-01','2026-01-31',4 FROM service_packages",
  );
  await db.exec(fs.readFileSync('migrations/185_workspace_packages_and_service_trash.sql', 'utf8'));
  return db;
}
const adapter = (db) => ({
  query: (...args) => db.query(...args),
  connect: async () => ({ query: (...args) => db.query(...args), release() {} }),
});
test('real PostgreSQL package purchase, booking, expiry, cancellation and catalogue recovery', async (t) => {
  const db = await setup();
  t.after(() => db.close());
  const conn = adapter(db);
  const service = createWorkspaceServicesService({ db: conn });
  const packages = createWorkspacePackages({ db: conn, serviceAuthority: service });
  let pkg = (await packages.list(1))[0];
  const sid = pkg.session_service_id;
  await t.test(
    'legacy purchases preserve historical windows; exact duplicate is recoverably removed',
    async () => {
      assert.equal(
        (await db.query('SELECT starts_at::text FROM client_package_entitlements')).rows[0]
          .starts_at,
        '2026-01-01 00:00:00+00',
      );
      assert.equal(
        (await db.query('SELECT deleted_at IS NOT NULL AS deleted FROM services WHERE id=2'))
          .rows[0].deleted,
        true,
      );
      assert.equal(
        (await db.query('SELECT deleted_at FROM services WHERE id=$1', [sid])).rows[0].deleted_at,
        null,
      );
    },
  );
  await t.test('calendar-month expiry clamps month-end in clinic timezone', async () => {
    const r = await db.query(
      "SELECT shiloh_package_expiry('2027-01-31T09:00:00+02',30,1) AS expiry",
    );
    assert.equal(new Date(r.rows[0].expiry).toISOString(), '2027-02-28T07:00:00.000Z');
  });
  await t.test(
    'full payment is mandatory and purchase starts with no expiry; duplicate payment replay is harmless',
    async () => {
      const input = {
        adminId: 1,
        packageId: pkg.id,
        crmV2ClientId: 101,
        paymentReference: 'Synthetic receipt',
        paymentMethod: 'cash',
        requestId: 'purchase_101',
        packageRevision: revision(pkg),
      };
      await assert.rejects(packages.recordPaid(input), /full upfront payment/);
      await packages.recordPaid({ ...input, paidConfirmed: true });
      await packages.recordPaid({ ...input, paidConfirmed: true });
      const e = (
        await db.query('SELECT * FROM client_package_entitlements WHERE crm_v2_client_id=101')
      ).rows[0];
      assert.equal(e.starts_at, null);
      assert.equal(e.expires_at, null);
      assert.equal(e.sessions_total, 4);
      assert.equal(Number(e.purchase_price), 1400);
      await assert.rejects(
        packages.recordPaid({ ...input, paidConfirmed: true, requestId: 'purchase_102' }),
        /already has an unused package/,
      );
    },
  );
  async function book(client, date) {
    const a = (
      await db.query(
        "INSERT INTO appointments(crm_v2_client_id,starts_at,ends_at,total_price) VALUES($1,$2,$2::timestamptz+interval '50 minutes',350) RETURNING id",
        [client, date],
      )
    ).rows[0];
    await db.query(
      'INSERT INTO appointment_services(appointment_id,service_id,price_snapshot) VALUES($1,$2,350)',
      [a.id, sid],
    );
    return a.id;
  }
  let first, second;
  await t.test(
    'booking reserves credits at zero additional charge; unpaid client cannot redeem',
    async () => {
      await assert.rejects(book(102, '2026-11-01T09:00:00+02'), /PACKAGE_ENTITLEMENT_REQUIRED/);
      first = await book(101, '2026-11-01T09:00:00+02');
      second = await book(101, '2026-11-08T09:00:00+02');
      const amount = (await db.query('SELECT total_price FROM appointments WHERE id=$1', [first]))
        .rows[0];
      assert.equal(Number(amount.total_price), 0);
      assert.equal((await packages.available(101, sid)).starts_at, null);
      await assert.rejects(book(101, '2026-12-01T09:00:00+02'), /PACKAGE_WINDOW_EXCEEDED/);
    },
  );
  await t.test(
    'a fifth reserved treatment fails, cancellation releases a credit, first completion sets validity',
    async () => {
      await book(101, '2026-11-15T09:00:00+02');
      await book(101, '2026-11-22T09:00:00+02');
      await assert.rejects(
        book(101, '2026-11-23T09:00:00+02'),
        /PACKAGE_ENTITLEMENT_REQUIRED|PACKAGE_CREDITS_EXHAUSTED/,
      );
      await db.query("UPDATE appointments SET status='cancelled' WHERE id=$1", [second]);
      await book(101, '2026-11-25T09:00:00+02');
      await db.query("UPDATE appointments SET status='completed' WHERE id=$1", [first]);
      const e = (
        await db.query('SELECT * FROM client_package_entitlements WHERE crm_v2_client_id=101')
      ).rows[0];
      assert.equal(new Date(e.starts_at).toISOString(), '2026-11-01T07:00:00.000Z');
      assert.equal(new Date(e.expires_at).toISOString(), '2026-12-01T07:00:00.000Z');
      assert.equal(
        (
          await db.query(
            "SELECT COUNT(*)::int AS n FROM package_session_redemptions WHERE status='redeemed'",
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    'rescheduling outside expiry and attaching extra treatments are blocked',
    async () => {
      await assert.rejects(
        db.query("UPDATE appointments SET starts_at='2026-12-02' WHERE id=$1", [first]),
        /PACKAGE_WINDOW_EXCEEDED/,
      );
      await assert.rejects(
        db.query(
          'INSERT INTO appointment_services(appointment_id,service_id,price_snapshot) VALUES($1,1,450)',
          [first],
        ),
        /PACKAGE_SINGLE_TREATMENT_REQUIRED/,
      );
    },
  );
  await t.test('retiring an offer keeps purchased entitlements and snapshot terms', async () => {
    await packages.mutate({
      adminId: 1,
      id: pkg.id,
      action: 'edit',
      expectedRevision: revision(pkg),
      requestId: 'edit_pkg_001',
      name: pkg.name,
      price: 1500,
      sessions: 5,
      validity: 2,
      validityUnit: 'months',
      description: 'A revised offer for future prepaid purchases.',
    });
    pkg = (await packages.list(1))[0];
    await packages.mutate({
      adminId: 1,
      id: pkg.id,
      action: 'delete',
      expectedRevision: revision(pkg),
      requestId: 'delete_pkg_001',
    });
    const e = (
      await db.query('SELECT * FROM client_package_entitlements WHERE crm_v2_client_id=101')
    ).rows[0];
    assert.equal(e.sessions_total, 4);
    assert.equal(e.validity_months, 1);
    assert.equal(Number(e.purchase_price), 1400);
  });
  await t.test(
    'ordinary service deletion preserves mappings; restore stays inactive; package service deletion blocked',
    async () => {
      const detail = await service.getServiceDetail({ adminId: 1, serviceId: 1 });
      await service.deleteService({
        adminId: 1,
        serviceId: 1,
        expectedRevision: detail.service.revision,
        requestId: 'delete_svc_001',
      });
      const deleted = await service.getServiceDetail({ adminId: 1, serviceId: 1 });
      assert.ok(deleted.service.deleted_at);
      assert.equal(deleted.assignedStaff.length, 1);
      await assert.rejects(
        service.setServiceStatus({
          adminId: 1,
          serviceId: 1,
          expectedRevision: deleted.service.revision,
          requestId: 'activate_svc_001',
          status: 'active',
        }),
        /Restore/,
      );
      await service.deleteService({
        adminId: 1,
        serviceId: 1,
        expectedRevision: deleted.service.revision,
        requestId: 'restore_svc_001',
        restore: true,
      });
      const restored = await service.getServiceDetail({ adminId: 1, serviceId: 1 });
      assert.equal(restored.service.deleted_at, null);
      assert.equal(restored.service.status, 'inactive');
      const row = (
        await db.query(
          'SELECT s.*,c.name AS category_name FROM services s JOIN service_categories c ON c.id=s.category_id WHERE s.id=$1',
          [sid],
        )
      ).rows[0];
      await assert.rejects(
        service.deleteService({
          adminId: 1,
          serviceId: sid,
          expectedRevision: serviceRevision(row, [1]),
          requestId: 'delete_internal',
        }),
        /Manage this prepaid service/,
      );
    },
  );
  await t.test(
    'Workspace creates a reusable package with a distinct session authority and practitioners',
    async () => {
      const made = await packages.mutate({
        adminId: 1,
        action: 'create',
        requestId: 'create_pkg_001',
        name: 'Recovery Treatment Pack',
        price: 900,
        sessions: 3,
        validity: 20,
        validityUnit: 'days',
        description:
          'Three prepaid recovery treatments, usable within twenty days of the first treatment.',
        categoryId: 1,
        durationMinutes: 45,
        staffIds: [1],
      });
      const row = (await db.query('SELECT * FROM service_packages WHERE id=$1', [made.id])).rows[0];
      assert.equal(row.sessions_included, 3);
      assert.equal(row.validity_days, 20);
      assert.notEqual(row.session_service_id, sid);
      assert.equal(
        (
          await db.query('SELECT COUNT(*)::int AS n FROM staff_services WHERE service_id=$1', [
            row.session_service_id,
          ])
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    'balance views show all three credit counts and do not offer expired booking',
    async () => {
      const rows = await packages.forClient(101);
      const html = renderClientPackages(rows);
      assert.match(html, /Available/);
      assert.match(html, /Booked/);
      assert.match(html, /Used/);
      assert.doesNotMatch(html, /workspace-link/);
      const expired = renderClientPackages([
        { ...rows[0], expires_at: '2020-01-01', booked: 0, used: 0 },
      ]);
      assert.doesNotMatch(expired, /Book a package treatment/);
      assert.match(
        renderWorkspacePackages({
          packages: [pkg],
          authority: { displayName: 'Owner' },
          options: { staffAccessScriptPath: '/test' },
        }),
        /Edit package/,
      );
    },
  );
});

test('prepaid booking selection requires the signed-in client balance and presents no further charge',async()=>{
 const {createMyShilohBookingService}=require('../src/services/myShilohBooking');
 const booking=createMyShilohBookingService({
  db:{async query(sql){return {rows:sql.includes('FROM services s')?[{id:3,name:'Prepaid session',status:'active',price:350,package_id:1,duration_minutes:50}]:[{id:1}]};}},
  eligibleStaff:async()=>[{id:1,display_name:'Therapist'}],
  depositPolicy:{async loadPolicy(){return {rateBasisPoints:5000,exemptStaffId:null};}},
  packages:{async available(clientId,serviceId){assert.equal(serviceId,3);if(clientId!==101)throw Object.assign(new Error('Paid package required'),{code:'PACKAGE_BALANCE_REQUIRED',httpStatus:409});return {id:9,name:'Paid Sports Package'};}}
 });
 await assert.rejects(booking.practitioners({serviceId:3,crmV2ClientId:102}),/Paid package required/);
 await assert.rejects(booking.practitioners({serviceId:3}),/Paid package required/);
 const model=await booking.practitioners({serviceId:3,crmV2ClientId:101});assert.equal(model.service.price,0);assert.equal(model.practitioners[0].depositExempt,true);
});
