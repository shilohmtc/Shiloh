const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

// Real SQL for the affected transaction; availability and outbound delivery are
// synthetic boundaries. Never uses DATABASE_URL or sends a communication.
async function createFixture({ nativeUrl = process.env.TEST_CALENDAR_COUPLES_DATABASE_URL, morningOffer = false, guestBooking = false } = {}) {
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
  if (morningOffer) {
    await sql.exec(`CREATE TABLE client_contacts(client_id bigint,contact_type text,normalized_value text);
      CREATE TABLE admin_booking_sessions(admin_id bigint);
      CREATE TABLE booking_payment_accounts(id bigint PRIMARY KEY,appointment_id bigint);
      CREATE TABLE booking_welcome_voucher_allocations(id bigserial PRIMARY KEY,booking_payment_account_id bigint,state text DEFAULT 'applied');
      INSERT INTO service_categories VALUES(1,'Massage');UPDATE services SET category_id=1 WHERE id=81;`);
    await sql.exec(read('migrations/199_website_publishing_morning_offer.sql'));
    await sql.exec("UPDATE website_content_posts SET published=draft WHERE kind='offer'");
  }
  if (guestBooking) {
    await sql.exec(`CREATE TABLE service_visibility_policies(service_id BIGINT,visibility_scope TEXT,owner_staff_id BIGINT);
      ALTER TABLE appointments ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      ALTER TABLE crm_v2_clients ADD COLUMN first_name TEXT,ADD COLUMN surname TEXT;
      CREATE TABLE appointment_lifecycle(id BIGSERIAL PRIMARY KEY,appointment_id BIGINT REFERENCES appointments(id),
        client_id BIGINT,crm_v2_client_id BIGINT REFERENCES crm_v2_clients(id),client_name_snapshot TEXT,
        phone TEXT NOT NULL,service_text TEXT NOT NULL,appointment_at TIMESTAMPTZ NOT NULL,
        appointment_ends_at TIMESTAMPTZ,status TEXT DEFAULT 'confirmed',source TEXT,
        reminder_sent_at TIMESTAMPTZ,followup_sent_at TIMESTAMPTZ,updated_at TIMESTAMPTZ DEFAULT NOW());
      CREATE UNIQUE INDEX lifecycle_appointment ON appointment_lifecycle(appointment_id) WHERE appointment_id IS NOT NULL;`);
    await sql.exec(read('migrations/127_scoped_client_relationships.sql').split('-- Owner-authorized Marietjie client management.')[0]);
    await sql.exec(read('tests/fixtures/guest-profile-schema-candidate.sql'));
    await sql.exec(read('migrations/149_my_shiloh_push_notifications.sql'));
  }
  const promotion = morningOffer ? require('../../src/services/morningWelcomeOffer').createMorningWelcomeOfferService({db}) : null;
  const standardBooking = {
    resolveOperator: async () => ({ id: 7, display_name: 'Synthetic operator',
      calendarAuthority: { ...(guestBooking ? { calendarScope: 'all_business', serviceScope: 'all_services' } : {}), capabilities: ['appointment:couples:discount', 'appointment:group:discount', ...(guestBooking ? ['appointment:create', 'client:lookup'] : [])] } }),
    listBookableOptions: async () => ({ authority: guestBooking ? { operatorAdminId: 7 } : {},
      staff: [{ id: 11, displayName: 'Synthetic practitioner A' }, { id: 12, displayName: 'Synthetic practitioner B' }, { id: 13, displayName: 'Synthetic practitioner C' }],
      services: [
        { id: 90, name: 'Couples booking', externalSource: 'shiloh_special', externalId: 'couples-massage-v1' },
        { id: 81, name: 'Synthetic Swedish', categoryName: 'Massage', durationMinutes: 90, price: 590, staffIds: [11, 12, 13] },
      ] }),
  };
  const state = { failQueue: false, sends: [], organiserWakes: [] };
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
    service = require(servicePath).createCalendarCouplesBookingService({ db, standardBooking, morningOffer: promotion });
    delete require.cache[groupPath];
    groupService = require(groupPath).createCalendarGroupBookingService({ db, standardBooking, morningOffer: promotion,
      ...(guestBooking ? { guestBookingsEnabled: true,
        organiserService: require('../../src/services/groupBookingOrganiser').createGroupBookingOrganiserService({ authorityResolver: async () => standardBooking.resolveOperator(7) }),
        wakeOrganiser: async id => { state.organiserWakes.push(id); return { accepted: 0, synthetic: true }; },
      } : {}),
    });
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
  return { sql, db, service, groupService, standardBooking, state, input, groupInput, close: () => sql.close() };
}

module.exports = { createFixture };
