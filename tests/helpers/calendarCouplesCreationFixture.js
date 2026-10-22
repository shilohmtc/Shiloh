const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

// Real SQL for the affected transaction; availability and outbound delivery are
// synthetic boundaries. Never uses DATABASE_URL or sends a communication.
async function createFixture({ nativeUrl = process.env.TEST_CALENDAR_COUPLES_DATABASE_URL } = {}) {
  let sql;
  if (nativeUrl) {
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(nativeUrl).hostname), 'Only a local synthetic PostgreSQL server is allowed');
    const { Client } = require('pg');
    const client = new Client({ connectionString: nativeUrl });
    await client.connect();
    const schema = `calendar_couples_creation_${process.pid}_${Date.now()}`;
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    sql = { query: (...args) => client.query(...args), exec: text => client.query(text),
      async close() { await client.query(`DROP SCHEMA ${schema} CASCADE`); await client.end(); } };
  } else {
    const { PGlite } = require('@electric-sql/pglite');
    sql = new PGlite();
    // Single-connection PGlite cannot prove concurrent advisory locking.
    await sql.exec("CREATE FUNCTION pg_advisory_xact_lock(bigint) RETURNS void LANGUAGE SQL AS 'SELECT NULL::void'");
  }
  const query = async (text, values = []) => {
    const result = await sql.query(text, values);
    return { ...result, rowCount: result.rowCount ?? (result.rows.length || result.affectedRows || 0) };
  };
  const db = { query, connect: async () => ({ query, release() {} }) };
  const read = file => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
  await sql.exec(read('tests/fixtures/couples-schema.sql'));
  for (const file of ['084_clean_crm_v2_foundation.sql', '120_couples_booking_groups.sql',
    '121_couples_booking_pricing_audit.sql', '124_group_bookings_and_optional_discount_note.sql']) {
    await sql.exec(read(`migrations/${file}`));
  }
  await sql.exec(`
    ALTER TABLE appointments ADD COLUMN notes text;
    ALTER TABLE crm_audit_events ADD COLUMN actor_admin_id bigint;
    CREATE TABLE synthetic_confirmation_obligations(appointment_id bigint REFERENCES appointments(id));
    INSERT INTO locations VALUES(1,'active');
    INSERT INTO staff_admin_accounts(id,active) VALUES(7,true);
    INSERT INTO staff VALUES(11,'Synthetic practitioner A','active','practitioner',true,'employee'),
      (12,'Synthetic practitioner B','active','practitioner',true,'employee'),
      (13,'Synthetic practitioner C','active','practitioner',true,'employee');
    INSERT INTO services(id,name,price,duration_minutes,status,external_source,external_id)
      VALUES(90,'Couples booking',1180,90,'active','shiloh_special','couples-massage-v1'),
      (81,'Synthetic Swedish',590,90,'active',NULL,NULL);
    INSERT INTO staff_services VALUES(11,81),(12,81),(13,81);
  `);
  const standardBooking = {
    resolveOperator: async () => ({ id: 7, display_name: 'Synthetic operator',
      calendarAuthority: { capabilities: ['appointment:couples:discount', 'appointment:group:discount'] } }),
    listBookableOptions: async () => ({ authority: {},
      staff: [{ id: 11, displayName: 'Synthetic practitioner A' }, { id: 12, displayName: 'Synthetic practitioner B' }, { id: 13, displayName: 'Synthetic practitioner C' }],
      services: [
        { id: 90, name: 'Couples booking', externalSource: 'shiloh_special', externalId: 'couples-massage-v1' },
        { id: 81, name: 'Synthetic Swedish', durationMinutes: 90, price: 590, staffIds: [11, 12, 13] },
      ] }),
  };
  const state = { failQueue: false, sends: [] };
  const replacements = [
    ['adminAvailability', { checkAuthoritativeSchedule: async () => ({ covered: true }), getConflicts: async () => [] }],
    ['clinicHours', { checkClinicHours: async () => ({ covered: true }), getDefaultActiveLocation: async () => ({ id: 1 }) }],
    ['customerBookingConfirmation', {
      queueCustomerBookingConfirmation: async (appointmentId, { db: tx }) => {
        await tx.query('INSERT INTO synthetic_confirmation_obligations VALUES($1)', [appointmentId]);
        if (state.failQueue && Number(appointmentId) % 2 === 0) return { queued: false };
        return { queued: true };
      },
      sendCustomerBookingConfirmationForAppointment: async appointmentId => {
        assert.equal((await query('SELECT count(*)::int AS n FROM admin_couples_booking_sessions')).rows[0].n, 0);
        assert.equal((await query('SELECT count(*)::int AS n FROM admin_group_booking_sessions')).rows[0].n, 0);
        state.sends.push(appointmentId);
        return { sent: false, deliveryStatus: 'synthetic_only' };
      },
    }],
  ];
  const originals = replacements.map(([name, overrides]) => {
    const resolved = require.resolve(`../../src/services/${name}`);
    const original = require(resolved);
    require.cache[resolved].exports = { ...original, ...overrides };
    return [resolved, original];
  });
  const servicePath = require.resolve('../../src/services/calendarCouplesBooking');
  const cachedService = require.cache[servicePath];
  const groupPath = require.resolve('../../src/services/calendarGroupBooking');
  const cachedGroup = require.cache[groupPath];
  let service, groupService;
  try {
    delete require.cache[servicePath];
    service = require(servicePath).createCalendarCouplesBookingService({ db, standardBooking });
    delete require.cache[groupPath];
    groupService = require(groupPath).createCalendarGroupBookingService({ db, standardBooking });
  } finally {
    for (const [resolved, original] of originals) require.cache[resolved].exports = original;
    delete require.cache[servicePath];
    if (cachedService) require.cache[servicePath] = cachedService;
    delete require.cache[groupPath];
    if (cachedGroup) require.cache[groupPath] = cachedGroup;
  }
  const input = {
    adminId: 7, date: '2099-10-24', time: '08:30', staffIds: [11, 12], serviceIds: [81, 81],
    guests: [{ name: 'Synthetic Guest A', mobile: '0820000001' }, { name: 'Synthetic Guest B', mobile: '0820000002' }],
  };
  const groupInput = { ...input, staffIds: [11, 12, 13], serviceIds: [81, 81, 81],
    guests: [...input.guests, { name: 'Synthetic Guest C', mobile: '0820000003' }] };
  return { sql, db, service, groupService, state, input, groupInput, close: () => sql.close() };
}

module.exports = { createFixture };
