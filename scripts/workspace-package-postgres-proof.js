const { Pool } = require('pg');
const fs = require('node:fs');
const assert = require('node:assert/strict');
async function main() {
  const pool = new Pool({ connectionString: process.env.TEST_PACKAGE_DATABASE_URL, max: 5 });
  try {
    await pool.query(fs.readFileSync('tests/fixtures/package-schema.sql', 'utf8'));
    for (const file of ['061_massage_packages.sql', '185_workspace_packages_and_service_trash.sql'])
      await pool.query(fs.readFileSync('migrations/' + file, 'utf8'));
    const pkg = (await pool.query('SELECT * FROM service_packages')).rows[0];
    await pool.query(
      `INSERT INTO client_package_entitlements(crm_v2_client_id,package_id,purchase_price,sessions_total,validity_days,validity_months) VALUES(101,$1,1400,4,30,1)`,
      [pkg.id],
    );
    async function book() {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const a = (
          await c.query(
            `INSERT INTO appointments(crm_v2_client_id,starts_at,ends_at,total_price) VALUES(101,NOW()+interval '10 days',NOW()+interval '10 days 50 minutes',350) RETURNING id`,
          )
        ).rows[0];
        await c.query(
          'INSERT INTO appointment_services(appointment_id,service_id,price_snapshot) VALUES($1,$2,350)',
          [a.id, pkg.session_service_id],
        );
        await c.query('COMMIT');
        return a.id;
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    }
    for (let i = 0; i < 3; i++) await book();
    const race = await Promise.allSettled([book(), book()]);
    assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(race.filter((r) => r.status === 'rejected').length, 1);
    assert.match(
      race.find((r) => r.status === 'rejected').reason.message,
      /PACKAGE_CREDITS_EXHAUSTED|PACKAGE_ENTITLEMENT_REQUIRED/,
    );
    assert.equal(
      (await pool.query('SELECT COUNT(*)::int AS count FROM package_session_redemptions')).rows[0]
        .count,
      4,
    );
    assert.equal(
      (await pool.query('SELECT SUM(total_price) AS total FROM appointments')).rows[0].total,
      '0',
    );
    console.log(
      'PostgreSQL concurrent bookings proof passed: exactly four credits, losing transaction rolled back, zero additional charge.',
    );
  } finally {
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
