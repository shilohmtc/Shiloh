const test = require('node:test');
const assert = require('node:assert/strict');
const { createFixture } = require('./helpers/calendarCouplesCreationFixture');
const { createMorningWelcomeOfferService } = require('../src/services/morningWelcomeOffer');

test('concurrent phoneless guest claims serialize on that profile, including the same visit date',
  { skip: !process.env.TEST_CALENDAR_COUPLES_DATABASE_URL }, async t => {
    const f = await createFixture({ morningOffer: true, guestBooking: true });
    const { Client } = require('pg');
    const other = new Client({ connectionString: process.env.TEST_CALENDAR_COUPLES_DATABASE_URL,
      statement_timeout: 15000, lock_timeout: 10000 });
    await other.connect();
    t.after(async () => { await other.end(); await f.close(); });
    const schema = (await f.db.query('SELECT current_schema() AS name')).rows[0].name;
    assert.match(schema, /^calendar_couples_creation_[0-9_]+$/);
    await other.query(`SET search_path TO ${schema}`);
    await f.db.query("INSERT INTO crm_v2_clients(id,name,normalized_mobile,contact_mode,source) VALUES(301,'Synthetic Guest',NULL,'organiser','test')");
    const offer = createMorningWelcomeOfferService({ db: f.db });
    const item = { clientId: 301, noMobile: true, firstVisitChoice: 'first_visit', identityKey: 'client:301',
      serviceId: 81, staffId: 11, price: '590', name: 'Massage', category: 'Massage', startsAt: '2099-10-26T06:00:00Z' };
    await f.db.query('BEGIN');
    const first = await offer.quoteItems([item], { queryable: f.db, lock: true, allowNoMobile: true });
    assert.equal(first.discount, '118.00');
    await other.query('BEGIN');
    let finished = false;
    const pending = offer.quoteItems([item], { queryable: other, lock: true, allowNoMobile: true }).then(q => { finished = true; return q; });
    let blocked = false;
    for (let attempt = 0; attempt < 50 && !blocked; attempt++) {
      blocked = Number((await f.db.query('SELECT cardinality(pg_blocking_pids($1)) AS n', [other.processID])).rows[0].n) > 0;
      if (!blocked) await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(blocked, true);
    assert.equal(finished, false);
    const appointment = (await f.db.query("INSERT INTO appointments(crm_v2_client_id,starts_at,ends_at,status,total_price) VALUES(301,$1,$1::timestamptz+interval '90 minutes','scheduled',472) RETURNING id", [item.startsAt])).rows[0];
    await offer.record(f.db, { appointmentId: appointment.id, clientId: 301, price: first.items[0] });
    await f.db.query('COMMIT');
    const second = await pending;
    assert.equal(second.discount, '0.00');
    assert.equal(second.items[0].eligibilityReason, 'recorded_history');
    await other.query('ROLLBACK');
    assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM morning_offer_booking_prices')).rows[0].n, 1);
  });
