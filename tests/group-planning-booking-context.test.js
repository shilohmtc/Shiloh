const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFixture } = require('./helpers/calendarCouplesCreationFixture');
const { createClientPlanningRequestService } = require('../src/services/clientPlanningRequests');

async function setup(t) {
  const f = await createFixture({ nativeUrl: null, guestBooking: true });
  t.after(f.close);
  const original = f.standardBooking.resolveOperator;
  f.standardBooking.resolveOperator = async () => ({ ...(await original()), business_role: 'owner', permissions: { 'client:lookup': true } });
  await f.sql.exec(fs.readFileSync(path.join(__dirname, '../migrations/163_client_planning_requests.sql'), 'utf8'));
  await f.sql.exec(`ALTER TABLE appointment_services ADD COLUMN id bigserial;
    INSERT INTO crm_v2_clients(id,name,normalized_mobile,source) VALUES(201,'Synthetic Organiser','27810000201','test');
    INSERT INTO crm_v2_client_relationships(client_id,relationship_type,source) VALUES(201,'clinic','test');
    INSERT INTO client_planning_requests(id,submission_key,payload_digest,crm_v2_client_id,request_kind,service_detail,guest_count,preferred_date,special_occasion)
      OVERRIDING SYSTEM VALUE VALUES(501,'00000000-0000-4000-8000-000000000501',repeat('a',64),201,'group','Synthetic experience',25,'2030-12-12',false);`);
  f.context = await f.groupService.requestContext(7, 501);
  f.input = { ...f.groupInput, organiserClientId: '201', planningRequestId: 501, planningRequestRevision: f.context.revision };
  return f;
}

test('server context is read-only, preserves enquiry date/count and fails closed for malformed, missing, resolved, inactive and unauthorized requests', async t => {
  const f = await setup(t);
  assert.equal(f.context.preferredDate, '2030-12-12');
  assert.equal(f.context.guestCount, 25);
  assert.equal(f.context.organiser.clientId, '201');
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM appointments')).rows[0].n, 0);
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM admin_group_booking_sessions')).rows[0].n, 0);
  for (const id of [[], {}, '1e2', '501x', 0]) await assert.rejects(f.groupService.requestContext(7, id), { code: 'GROUP_REQUEST_INVALID' });
  await assert.rejects(f.groupService.requestContext(7, 999), { code: 'GROUP_REQUEST_UNAVAILABLE' });
  await f.db.query("UPDATE client_planning_requests SET status='declined',decided_at=NOW(),decided_by_admin_id=7 WHERE id=501");
  await assert.rejects(f.groupService.requestContext(7, 501), { code: 'GROUP_REQUEST_UNAVAILABLE' });
  await f.db.query("UPDATE client_planning_requests SET status='requested',decided_at=NULL,decided_by_admin_id=NULL WHERE id=501");
  await f.db.query("UPDATE crm_v2_clients SET status='archived' WHERE id=201");
  await assert.rejects(f.groupService.requestContext(7, 501), { code: 'GROUP_CONTACT_UNAVAILABLE' });
  f.standardBooking.resolveOperator = async () => ({ id: 7, business_role: 'practitioner', permissions: { 'client:lookup': true } });
  await assert.rejects(f.groupService.requestContext(7, 501), { code: 'GROUP_REQUEST_FORBIDDEN' });
});

test('context persists in review; all-direct group binds non-attending organiser, sends only guest confirmations and recovers interrupted commit', async t => {
  const f = await setup(t);
  await assert.rejects(f.groupService.prepare({ ...f.input, organiserClientId: 999 }), { code: 'GROUP_REQUEST_ORGANISER_MISMATCH' });
  await assert.rejects(f.groupService.prepare({ ...f.input, planningRequestRevision: 'old' }), { code: 'GROUP_REQUEST_CHANGED' });
  const prepared = await f.groupService.prepare(f.input);
  assert.deepEqual(prepared.review.requestContext, f.context);
  assert.equal(prepared.review.guests.length, 3);
  assert.ok(prepared.review.guests.every(g => g.clientId !== '201'));
  await assert.rejects(f.groupService.confirm({ adminId: 7, reviewKey: 'wrong' }), { code: 'GROUP_REQUEST_REVIEW_CHANGED' });
  const created = await f.groupService.confirm({ adminId: 7, reviewKey: prepared.review.requestReviewKey });
  assert.equal(created.planningRequestId, 501);
  assert.deepEqual(f.state.sends, created.appointmentIds);
  assert.deepEqual(f.state.organiserWakes, []);
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM my_shiloh_push_notifications')).rows[0].n, 0);
  assert.equal(Number((await f.db.query('SELECT organiser_crm_v2_client_id FROM appointment_group_booking_contacts')).rows[0].organiser_crm_v2_client_id), 201);
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM appointments WHERE crm_v2_client_id=201')).rows[0].n, 0);
  const audit = (await f.db.query("SELECT metadata FROM crm_audit_events WHERE action='admin.group_booking_created'")).rows[0].metadata;
  assert.equal(audit.planningRequestId, 501);
  const replay = await f.groupService.confirm({ adminId: 7, reviewKey: prepared.review.requestReviewKey });
  assert.equal(replay.replayed, true);
  assert.equal(replay.planningRequestId, 501);
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM appointment_groups')).rows[0].n, 1);
  assert.equal(f.state.sends.length, 3);
  assert.equal((await f.db.query('SELECT status FROM client_planning_requests WHERE id=501')).rows[0].status, 'requested');
  const service = createClientPlanningRequestService({ db: f.db });
  const principal = await f.standardBooking.resolveOperator();
  const candidates = await service.appointmentsForRequest({ principal, id: 501 });
  assert.equal(candidates.appointments.length, 1);
  assert.equal(candidates.appointments[0].linkedGroup, true);
  assert.match(candidates.appointments[0].serviceName, /^Linked group #/);
  await f.db.query("UPDATE appointments SET status='cancelled' WHERE id=$1", [created.appointmentIds[1]]);
  assert.equal((await service.appointmentsForRequest({ principal, id: 501 })).appointments.length, 0);
  await assert.rejects(service.decide({ principal, id: 501, action: 'arranged', appointmentId: created.appointmentIds[0] }), { code: 'PLANNING_APPOINTMENT_MISMATCH' });
  await f.db.query("UPDATE appointments SET status='scheduled' WHERE id=$1", [created.appointmentIds[1]]);
  assert.equal(Number(candidates.appointments[0].groupId), created.groupId);
  await assert.rejects(service.decide({ principal, id: 501, action: 'arranged', appointmentId: created.appointmentIds[1] }), { code: 'PLANNING_APPOINTMENT_MISMATCH' });
  await f.db.query("UPDATE client_planning_requests SET request_kind='flexible',guest_count=NULL WHERE id=501");
  assert.equal((await service.appointmentsForRequest({ principal, id: 501 })).appointments.length, 0);
  await assert.rejects(service.decide({ principal, id: 501, action: 'arranged', appointmentId: created.appointmentIds[0] }), { code: 'PLANNING_APPOINTMENT_MISMATCH' });
  await f.db.query("UPDATE client_planning_requests SET request_kind='group',guest_count=25 WHERE id=501");
  await f.db.query("INSERT INTO appointment_booking_approvals VALUES($1,'pending')", [created.appointmentIds[1]]);
  assert.equal((await service.appointmentsForRequest({ principal, id: 501 })).appointments.length, 0);
  await f.db.query("UPDATE appointment_booking_approvals SET status='approved'");
  assert.equal((await service.decide({ principal, id: 501, action: 'arranged', appointmentId: created.appointmentIds[0] })).status, 'arranged');
});

test('resolved or changed enquiry aborts confirm before any client or booking writes', async t => {
  const f = await setup(t);
  const prepared = await f.groupService.prepare(f.input);
  await f.db.query("UPDATE client_planning_requests SET service_detail='Changed' WHERE id=501");
  await assert.rejects(f.groupService.confirm({ adminId: 7, reviewKey: prepared.review.requestReviewKey }), { code: 'GROUP_REQUEST_CHANGED' });
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM crm_v2_clients')).rows[0].n, 1);
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM appointments')).rows[0].n, 0);
  assert.deepEqual(f.state.sends, []);
});

test('no-mobile context keeps existing organiser notification and direct guest decisions', async t => {
  const f = await setup(t);
  const prepared = await f.groupService.prepare({ ...f.input, guests: f.input.guests.map((guest, i) => i === 0 ? { ...guest, noMobile: true, mobile: '' } : guest) });
  const created = await f.groupService.confirm({ adminId: 7, reviewKey: prepared.review.requestReviewKey });
  assert.deepEqual(f.state.sends, created.appointmentIds.slice(1));
  assert.deepEqual(f.state.organiserWakes, [201]);
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM appointment_group_booking_contacts')).rows[0].n, 1);
});

test('explicit organiser participation preserves source profile and never bypasses sibling eligibility', async t => {
  const f = await setup(t);
  const guests = [{ ...f.input.guests[0], clientId: 201, name: 'Synthetic Organiser', mobile: '27810000201', dateOfBirth: '1990-01-01' }, ...f.input.guests.slice(1)];
  await assert.rejects(f.groupService.prepare({ ...f.input, guests: [{ ...guests[0], name: 'Different guest' }, ...guests.slice(1)] }), { code: 'GROUP_REQUEST_ORGANISER_MISMATCH' });
  const before = (await f.db.query('SELECT * FROM crm_v2_clients WHERE id=201')).rows[0];
  const prepared = await f.groupService.prepare({ ...f.input, guests });
  const created = await f.groupService.confirm({ adminId: 7, reviewKey: prepared.review.requestReviewKey });
  assert.deepEqual((await f.db.query('SELECT * FROM crm_v2_clients WHERE id=201')).rows[0], before);
  const planning = createClientPlanningRequestService({ db: f.db });
  const principal = await f.standardBooking.resolveOperator();
  await f.db.query("UPDATE appointments SET status='cancelled' WHERE id=$1", [created.appointmentIds[1]]);
  assert.equal((await planning.appointmentsForRequest({ principal, id: 501 })).appointments.length, 0);
  await assert.rejects(planning.decide({ principal, id: 501, action: 'arranged', appointmentId: created.appointmentIds[0] }), { code: 'PLANNING_APPOINTMENT_MISMATCH' });
});

test('current request authority and organiser revision are rechecked before confirm writes', async t => {
  const f = await setup(t);
  const prepared = await f.groupService.prepare(f.input);
  await f.db.query("UPDATE crm_v2_clients SET normalized_mobile='27810000202',updated_at=NOW() WHERE id=201");
  await assert.rejects(f.groupService.confirm({ adminId: 7, reviewKey: prepared.review.requestReviewKey }), { code: 'GROUP_REQUEST_CHANGED' });
  const original = f.standardBooking.resolveOperator;
  f.standardBooking.resolveOperator = async () => ({ ...(await original()), permissions: { 'client:lookup': true, 'booking_requests:manage': false } });
  await assert.rejects(f.groupService.confirm({ adminId: 7, reviewKey: prepared.review.requestReviewKey }), { code: 'GROUP_REQUEST_FORBIDDEN' });
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM appointments')).rows[0].n, 0);
  assert.deepEqual(f.state.sends, []);
});


test('saved enquiry key recovers its exact receipt without consuming a newer ordinary all-direct draft', async t => {
  const f = await setup(t);
  const prepared = await f.groupService.prepare(f.input);
  const reviewKey = prepared.review.requestReviewKey;
  const created = await f.groupService.confirm({ adminId: 7, reviewKey });
  await f.groupService.prepare({ ...f.groupInput, date: '2035-12-13' });
  const draftBefore = (await f.db.query('SELECT payload FROM admin_group_booking_sessions WHERE admin_id=7')).rows[0].payload;
  await assert.rejects(f.groupService.confirm({ adminId: 7, reviewKey: 'x'.repeat(32) }), { code: 'GROUP_REVIEW_CHANGED' });
  const replay = await f.groupService.confirm({ adminId: 7, reviewKey });
  assert.equal(replay.replayed, true);
  assert.equal(replay.planningRequestId, 501);
  assert.equal(replay.groupId, created.groupId);
  assert.deepEqual(replay.appointmentIds, created.appointmentIds);
  assert.deepEqual((await f.db.query('SELECT payload FROM admin_group_booking_sessions WHERE admin_id=7')).rows[0].payload, draftBefore);
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM appointment_groups')).rows[0].n, 1);
  assert.deepEqual(f.state.sends, created.appointmentIds);
});

test('context discard requires exact enquiry and retained draft key and preserves unrelated drafts', async t => {
  const f = await setup(t);
  const prepared = await f.groupService.prepare(f.input);
  const key = prepared.review.requestReviewKey;
  for (const input of [{ adminId: 7 }, { adminId: 7, planningRequestId: 501 },
    { adminId: 7, planningRequestId: 502, requestDraftKey: key },
    { adminId: 7, planningRequestId: 501, requestDraftKey: 'x'.repeat(32) }]) {
    await assert.rejects(f.groupService.discard(input), { code: 'GROUP_REQUEST_REVIEW_CHANGED' });
    assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM admin_group_booking_sessions')).rows[0].n, 1);
  }
  assert.equal((await f.groupService.discard({ adminId: 7, planningRequestId: 501, requestDraftKey: key })).status, 'discarded');
  assert.equal((await f.groupService.discard({ adminId: 7, planningRequestId: 501, requestDraftKey: key })).status, 'no_pending');
  await f.groupService.prepare(f.groupInput);
  await assert.rejects(f.groupService.discard({ adminId: 7, planningRequestId: 501, requestDraftKey: key }), { code: 'GROUP_REQUEST_REVIEW_CHANGED' });
  assert.equal((await f.groupService.discard({ adminId: 7 })).status, 'discarded');
});


test('linked group candidates and decisions require current full organiser authority without changing individual rules', async t => {
  const f = await setup(t);
  const prepared = await f.groupService.prepare(f.input);
  const created = await f.groupService.confirm({ adminId: 7, reviewKey: prepared.review.requestReviewKey });
  const planning = createClientPlanningRequestService({ db: f.db });
  const current = await f.standardBooking.resolveOperator();
  for (const principal of [
    { ...current, permissions: { ...current.permissions, 'client:lookup': false } },
    { ...current, calendarAuthority: { ...current.calendarAuthority, serviceScope: 'own_services' } },
    { ...current, calendarAuthority: { ...current.calendarAuthority, capabilities: ['client:lookup'] } },
  ]) {
    assert.equal((await planning.appointmentsForRequest({ principal, id: 501 })).appointments.length, 0);
    const queue = await planning.forReception(principal);
    assert.deepEqual(queue[0].candidate_appointments, []);
    await assert.rejects(planning.decide({ principal, id: 501, action: 'arranged', appointmentId: created.appointmentIds[0] }), { code: 'PLANNING_FORBIDDEN' });
  }
  assert.equal((await planning.appointmentsForRequest({ principal: current, id: 501 })).appointments.length, 1);
  assert.equal((await f.db.query('SELECT status FROM client_planning_requests WHERE id=501')).rows[0].status, 'requested');
});
