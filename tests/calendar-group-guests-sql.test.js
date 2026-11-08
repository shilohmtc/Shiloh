const test = require('node:test');
const assert = require('node:assert/strict');
const { createFixture } = require('./helpers/calendarCouplesCreationFixture');

async function setup(t, options = {}) {
  const f = await createFixture({ nativeUrl: null, guestBooking: true, ...options });
  t.after(f.close);
  await f.db.query("INSERT INTO crm_v2_clients(id,name,normalized_mobile,source) VALUES(201,'Synthetic Organiser','27810000201','test')");
  await f.db.query("INSERT INTO crm_v2_client_relationships(client_id,relationship_type,source) VALUES(201,'clinic','test')");
  f.guestInput = { ...f.groupInput, organiserClientId: 201, guests: f.groupInput.guests.map((g, i) =>
    i < 2 ? { ...g, noMobile: true, mobile: '' } : g) };
  return f;
}

test('enabled release defaults require compatible storage and unchanged operator authority', async t => {
  assert.equal(require('../src/services/groupGuestFeature').GUEST_BOOKINGS_ENABLED, true);
  const f = await setup(t);
  const { createCalendarGroupBookingService } = require('../src/services/calendarGroupBooking');
  const create = options => createCalendarGroupBookingService({ db: f.db, standardBooking: f.standardBooking, ...options });
  assert.equal((await create().listOptions(7)).guestBooking.available, true);
  assert.equal((await create({ guestBookingsEnabled: false }).listOptions(7)).guestBooking, undefined);
  const original = f.standardBooking.resolveOperator;
  f.standardBooking.resolveOperator = async () => ({ ...(await original()), calendarAuthority: { calendarScope: 'all_business', serviceScope: 'all_services', capabilities: [] } });
  assert.equal((await create().listOptions(7)).guestBooking, undefined);
  f.standardBooking.resolveOperator = original;
  await f.sql.exec('ALTER TABLE appointment_lifecycle DROP CONSTRAINT appointment_lifecycle_recipient_valid');
  assert.equal((await create().listOptions(7)).guestBooking, undefined);
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM appointments')).rows[0].n, 0);
});

test('review is read-only; mixed groups create separate guests and one organiser obligation, with exact interrupted-commit recovery', async t => {
  const f = await setup(t);
  assert.equal((await f.groupService.listOptions(7)).guestBooking.available, true);
  const prepared = await f.groupService.prepare(f.guestInput);
  const reviewKey = prepared.review.guestContact.reviewKey;
  assert.equal(prepared.review.guestContact.organiser.clientId, '201');
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM crm_v2_clients')).rows[0].n, 1);
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM appointments')).rows[0].n, 0);
  await assert.rejects(f.groupService.confirm({ adminId: 7, reviewKey: 'wrong' }), { code: 'GROUP_GUEST_CONTACT_REVIEW' });
  const created = await f.groupService.confirm({ adminId: 7, reviewKey });
  assert.equal(created.appointmentIds.length, 3);
  assert.deepEqual(created.guestObligation.guestAppointmentIds, created.appointmentIds.slice(0, 2));
  assert.deepEqual(f.state.sends, [created.appointmentIds[2]]);
  assert.deepEqual(f.state.organiserWakes, [201]);
  const guests = (await f.db.query("SELECT * FROM crm_v2_clients WHERE contact_mode='organiser' ORDER BY id")).rows;
  assert.equal(guests.length, 2);
  assert.notEqual(guests[0].id, guests[1].id);
  assert.ok(guests.every(g => g.normalized_mobile === null && g.profile_status === 'minimal'));
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM appointment_lifecycle WHERE phone IS NULL')).rows[0].n, 2);
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM my_shiloh_push_notifications')).rows[0].n, 1);
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM synthetic_confirmation_obligations')).rows[0].n, 1);
  const replay = await f.groupService.confirm({ adminId: 7, reviewKey });
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.appointmentIds, created.appointmentIds);
  assert.deepEqual(f.state.organiserWakes, [201]);
  assert.equal(f.state.sends.length, 1);
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM appointment_groups')).rows[0].n, 1);
  await assert.rejects(f.groupService.confirm({ adminId: 7, reviewKey: 'x'.repeat(32) }), { code: 'GROUP_NO_PENDING' });
});

test('failed organiser notice rolls back all new profiles, appointments, group, direct obligations and audit; unchanged review can retry', async t => {
  const f = await setup(t);
  const prepared = await f.groupService.prepare(f.guestInput);
  const input = { adminId: 7, reviewKey: prepared.review.guestContact.reviewKey };
  await f.sql.exec("ALTER TABLE my_shiloh_push_notifications ADD CONSTRAINT reject_confirmation CHECK(title <> 'Group booking confirmed')");
  await assert.rejects(f.groupService.confirm(input));
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM crm_v2_clients')).rows[0].n, 1);
  for (const table of ['appointments', 'appointment_groups', 'appointment_lifecycle', 'synthetic_confirmation_obligations', 'my_shiloh_push_notifications', 'crm_audit_events']) {
    assert.equal((await f.db.query(`SELECT COUNT(*)::int n FROM ${table}`)).rows[0].n, 0, table);
  }
  assert.deepEqual(f.state.sends, []);
  assert.deepEqual(f.state.organiserWakes, []);
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM admin_group_booking_sessions')).rows[0].n, 1);
  await f.sql.exec('ALTER TABLE my_shiloh_push_notifications DROP CONSTRAINT reject_confirmation');
  assert.equal((await f.groupService.confirm(input)).status, 'created');
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM crm_v2_clients')).rows[0].n, 4);
});

test('selected guest revision is derived by the server; profile drift and contact drift abort without creating a group', async t => {
  const f = await setup(t);
  await f.db.query("INSERT INTO crm_v2_clients(id,name,normalized_mobile,contact_mode,source,date_of_birth,gender) VALUES(301,'Synthetic Selected',NULL,'organiser','test','2000-01-01','female')");
  await f.db.query("INSERT INTO crm_v2_client_relationships(client_id,relationship_type,source) VALUES(301,'clinic','test')");
  f.guestInput.guests[0] = { name: 'Synthetic Selected', clientId: 301, mobile: '', noMobile: true, profileRevision: 'caller-spoof' };
  const prepared = await f.groupService.prepare(f.guestInput);
  assert.notEqual(prepared.review.guests[0].profileRevision, 'caller-spoof');
  await f.db.query("UPDATE crm_v2_clients SET name='Synthetic Changed',updated_at=updated_at+INTERVAL '1 second' WHERE id=301");
  await assert.rejects(f.groupService.confirm({ adminId: 7, reviewKey: prepared.review.guestContact.reviewKey }), { code: 'GROUP_GUEST_CHANGED' });
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM appointments')).rows[0].n, 0);
  const updated = await f.groupService.prepare(f.guestInput);
  await f.db.query("UPDATE crm_v2_clients SET normalized_mobile='27810000999',updated_at=updated_at+INTERVAL '1 second' WHERE id=201");
  await assert.rejects(f.groupService.confirm({ adminId: 7, reviewKey: updated.review.guestContact.reviewKey }), { code: 'GROUP_CONTACT_CHANGED' });
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM appointments')).rows[0].n, 0);
  assert.deepEqual(f.state.sends, []);
});

test('incomplete storage cannot enable optional phones and current authority is rechecked at commit', async t => {
  const f = await setup(t);
  const prepared = await f.groupService.prepare(f.guestInput);
  const original = f.standardBooking.resolveOperator;
  f.standardBooking.resolveOperator = async () => ({ ...(await original()), calendarAuthority: { capabilities: [] } });
  await assert.rejects(f.groupService.confirm({ adminId: 7, reviewKey: prepared.review.guestContact.reviewKey }), { code: 'GROUP_GUEST_CONTACT_REVIEW' });
  f.standardBooking.resolveOperator = original;
  await f.sql.exec('ALTER TABLE appointment_lifecycle DROP CONSTRAINT appointment_lifecycle_recipient_valid');
  assert.equal((await f.groupService.listOptions(7)).guestBooking, undefined);
  await assert.rejects(f.groupService.prepare(f.guestInput), { code: 'GROUP_GUEST_CONTACT_REVIEW' });
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM appointments')).rows[0].n, 0);
});

test('offer publication changes invalidate a phoneless guest review without any writes', async t => {
  const f = await setup(t, { morningOffer: true });
  f.guestInput.guests[0].firstVisitChoice = 'first_visit';
  await f.db.query("UPDATE website_content_posts SET published=NULL WHERE kind='offer'");
  const review = await f.groupService.prepare({ ...f.guestInput, date: '2099-10-26' });
  assert.equal(Number(review.review.pricing.total), 1770);
  await f.db.query("UPDATE website_content_posts SET published=draft WHERE kind='offer'");
  await assert.rejects(f.groupService.confirm({ adminId: 7, reviewKey: review.review.guestContact.reviewKey,
    quoteHash: review.review.quoteHash }), { code: 'BOOKING_OFFER_QUOTE_CHANGED' });
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM crm_v2_clients')).rows[0].n, 1);
  for (const table of ['appointments', 'appointment_groups', 'my_shiloh_push_notifications', 'morning_offer_booking_prices']) {
    assert.equal((await f.db.query(`SELECT COUNT(*)::int n FROM ${table}`)).rows[0].n, 0);
  }
  assert.deepEqual(f.state.sends, []);
  assert.deepEqual(f.state.organiserWakes, []);
});

test('each guest declaration prices only that profile; reviewed amounts, audit and exact replay stay atomic', async t => {
  const f = await setup(t, { morningOffer: true });
  f.guestInput.guests[0].firstVisitChoice = 'first_visit';
  f.guestInput.guests[1].firstVisitChoice = 'returning';
  const review = await f.groupService.prepare({ ...f.guestInput, date: '2099-10-26' });
  assert.deepEqual(review.review.offerPricing.items.map(p => p.discount), ['118.00', '0.00', '118.00']);
  assert.equal(review.review.pricing.total, 1534);
  const input = { adminId: 7, reviewKey: review.review.guestContact.reviewKey, quoteHash: review.review.quoteHash };
  // Client-supplied replacement choices are not the persisted, reviewed payload.
  const result = await f.groupService.confirm({ ...input, guests: [{ firstVisitChoice: 'first_visit' }] });
  assert.deepEqual((await f.db.query('SELECT total_price FROM appointments ORDER BY id')).rows.map(p => Number(p.total_price)), [472,590,472]);
  const snapshots = (await f.db.query('SELECT terms_snapshot FROM morning_offer_booking_prices ORDER BY appointment_id')).rows;
  assert.equal(snapshots[0].terms_snapshot.firstVisitChoice, 'first_visit');
  const audit = (await f.db.query("SELECT metadata FROM crm_audit_events WHERE action='admin.group_booking_created'")).rows[0].metadata;
  assert.deepEqual(audit.guestOfferDeclarations.map(p => p.firstVisitChoice), ['first_visit','returning']);
  assert.deepEqual(audit.guestOfferDeclarations.map(p => p.discount), ['118.00','0.00']);
  const replay = await f.groupService.confirm(input);
  assert.deepEqual(replay.appointmentIds, result.appointmentIds);
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM morning_offer_booking_prices')).rows[0].n, 2);
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM appointment_groups')).rows[0].n, 1);
});

test('unknown and missing declarations do not assume first visits; manual promotions and opt-out do not stack', async t => {
  const f = await setup(t, { morningOffer: true });
  const input = { ...f.guestInput, date: '2099-10-26' };
  let review = await f.groupService.prepare(input);
  assert.deepEqual(review.review.offerPricing.items.map(p => p.discount), ['0.00','0.00','118.00']);
  f.guestInput.guests[0].firstVisitChoice = 'first_visit';
  review = await f.groupService.prepare({ ...input, useMorningOffer: false });
  assert.equal(review.review.pricing.total, 1770);
  assert.equal(review.review.offerPricing.items[0].availableDiscount, '118.00');
  review = await f.groupService.prepare({ ...input, discount: { type: 'amount', value: 100 } });
  assert.equal(review.review.offerPricing.discount, '0.00');
  assert.equal(review.review.pricing.total, 1670);
  await assert.rejects(f.groupService.prepare({ ...input, guests: [{ ...input.guests[0], firstVisitChoice: 'yes-please' }, ...input.guests.slice(1)] }), { code: 'GROUP_GUEST_VISIT_CHOICE' });
});

test('NULL-mobile histories are separate and staff declarations cannot override recorded history or reuse a claim', async t => {
  const f = await setup(t, { morningOffer: true });
  for (const [id,name] of [[301,'Synthetic Returning'],[302,'Synthetic First']]) {
    await f.db.query("INSERT INTO crm_v2_clients(id,name,normalized_mobile,contact_mode,source) VALUES($1,$2,NULL,'organiser','test')", [id,name]);
    await f.db.query("INSERT INTO crm_v2_client_relationships(client_id,relationship_type,source) VALUES($1,'clinic','test')", [id]);
  }
  await f.db.query("INSERT INTO appointments(crm_v2_client_id,starts_at,ends_at,status,total_price) VALUES(301,'2026-10-01T06:00Z','2026-10-01T07:30Z','completed',590)");
  const offer = require('../src/services/morningWelcomeOffer').createMorningWelcomeOfferService({db:f.db});
  await assert.rejects(offer.quoteItems([{clientId:302,serviceId:81,staffId:11,price:'590',name:'Massage',category:'Massage',startsAt:'2099-10-26T06:00Z'}]), {code:'BOOKING_OFFER_QUOTE_CHANGED'});
  const input = { ...f.guestInput, date:'2099-10-26', guests: f.guestInput.guests.map((g,i) => i<2 ? { ...g,clientId:301+i,firstVisitChoice:'first_visit' } : g) };
  const review = await f.groupService.prepare(input);
  assert.deepEqual(review.review.offerPricing.items.map(p => p.discount), ['0.00','118.00','118.00']);
  assert.equal(review.review.offerPricing.items[0].eligibilityReason, 'recorded_history');
  await f.groupService.confirm({ adminId:7, reviewKey:review.review.guestContact.reviewKey, quoteHash:review.review.quoteHash });
  const next = await f.groupService.prepare(input);
  assert.equal(next.review.offerPricing.items[1].discount, '0.00');
  assert.equal(next.review.offerPricing.items[1].eligibilityReason, 'recorded_history');
});

test('a new canonical claim after review rejects the stale total and rolls back the entire group', async t => {
  const f = await setup(t, { morningOffer: true });
  await f.db.query("INSERT INTO crm_v2_clients(id,name,normalized_mobile,contact_mode,source) VALUES(301,'Synthetic Selected',NULL,'organiser','test')");
  await f.db.query("INSERT INTO crm_v2_client_relationships(client_id,relationship_type,source) VALUES(301,'clinic','test')");
  f.guestInput.guests[0] = { ...f.guestInput.guests[0],clientId:301,firstVisitChoice:'first_visit' };
  const review = await f.groupService.prepare({ ...f.guestInput,date:'2099-10-26' });
  const a = (await f.db.query("INSERT INTO appointments(crm_v2_client_id,starts_at,ends_at,status,total_price) VALUES(301,'2099-10-26T06:00Z','2099-10-26T07:30Z','scheduled',472) RETURNING id")).rows[0];
  await require('../src/services/morningWelcomeOffer').createMorningWelcomeOfferService({db:f.db}).record(f.db,{appointmentId:a.id,clientId:301,price:review.review.offerPricing.items[0]});
  await assert.rejects(f.groupService.confirm({adminId:7,reviewKey:review.review.guestContact.reviewKey,quoteHash:review.review.quoteHash}), {code:'BOOKING_OFFER_QUOTE_CHANGED'});
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM appointments')).rows[0].n, 1);
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM crm_v2_clients')).rows[0].n, 2);
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM appointment_groups')).rows[0].n, 0);
});

test('staff first-visit choice still requires an eligible treatment, morning time and permitted weekday', async t => {
  const f = await setup(t, { morningOffer: true });
  const guests = f.guestInput.guests.map(g => ({...g,firstVisitChoice:'first_visit'}));
  for (const change of [{date:'2099-10-24'}, {date:'2099-10-26',time:'12:00'}]) {
    const review = await f.groupService.prepare({...f.guestInput,guests,...change});
    assert.equal(review.review.offerPricing.discount, '0.00');
  }
  const original = f.standardBooking.listBookableOptions;
  f.standardBooking.listBookableOptions = async () => { const options = await original(); return {...options,services:options.services.map(s => ({...s,categoryName:'Other',name:'Synthetic Facial'}))}; };
  const review = await f.groupService.prepare({...f.guestInput,guests,date:'2099-10-26'});
  assert.equal(review.review.offerPricing.discount, '0.00');
});
